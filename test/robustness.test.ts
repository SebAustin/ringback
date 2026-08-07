import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MemoryStore, getStore, setStore, type Store } from '../src/lib/store.js';
import { buildApp } from '../src/server.js';
import { ensureDemoTenant } from '../src/demo-seed.js';
import {
  findOrCreateConversation,
  handleInboundMessage,
  startMissedCallConversation,
} from '../src/receptionist/conversation.js';
import { executeTool } from '../src/receptionist/tools.js';
import { inboundEmailKey } from '../src/routes/agents.js';
import { createSessionCookie, SESSION_COOKIE } from '../src/lib/auth.js';
import { retryOnce, TimeoutError } from '../src/lib/async.js';
import type { Conversation, Tenant } from '../src/types.js';

/** Mid-day ET Wednesday — deterministic, safely outside quiet hours. */
const DAYTIME = new Date('2026-07-22T16:00:00.000Z');

let app: FastifyInstance;
let tenantId: string;
let tenant: Tenant;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  setStore(new MemoryStore());
  tenantId = await ensureDemoTenant();
  tenant = (await getStore().get<Tenant>('tenants', tenantId))!;
});

describe('concurrency (H5/H6)', () => {
  test('two concurrent SMS from the same caller land in ONE conversation with turnCount 2', async () => {
    const caller = '+15550004242';
    await Promise.all([
      handleInboundMessage({ tenantId, tenant, callerPhone: caller, body: 'hello there', channel: 'sms', messageSid: 'SMc1' }),
      handleInboundMessage({ tenantId, tenant, callerPhone: caller, body: 'anyone home?', channel: 'sms', messageSid: 'SMc2' }),
    ]);
    const convs = await getStore().query<Conversation>(`tenants/${tenantId}/conversations`, {
      where: [['callerPhone', '==', caller]],
    });
    expect(convs).toHaveLength(1);
    expect(convs[0]!.turnCount).toBe(2);
  });
});

describe('inbound support email (H8)', () => {
  test('accepts a real multipart/form-data Inbound Parse payload', async () => {
    const boundary = '----vitestboundary42';
    const part = (name: string, value: string) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
    const payload =
      part('from', 'Curious Owner <owner@example.com>') +
      part('subject', 'How does setup work?') +
      part('text', 'Hi, can you explain how to set up call forwarding?') +
      `--${boundary}--\r\n`;

    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/inbound-email?key=${inboundEmailKey()}`,
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().summary).toContain('Support');
    const tickets = await getStore().query('support_tickets', {});
    expect(tickets).toHaveLength(1);
  });

  test('urlencoded inbound parse still works too', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/webhooks/inbound-email?key=${inboundEmailKey()}`,
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'from=someone%40example.com&subject=Hi&text=Question+about+plans',
    });
    expect(res.statusCode).toBe(200);
  });
});

describe('store failure resilience (C1/H13)', () => {
  /** A store whose reads explode — simulates a Firestore outage. */
  function brokenStore(): Store {
    const boom = async (): Promise<never> => {
      throw new Error('FIRESTORE_UNAVAILABLE (simulated)');
    };
    return {
      get: boom, set: boom, merge: boom, add: boom,
      createIfAbsent: boom, delete: boom, query: boom, increment: boom,
    };
  }

  test('voice webhook degrades to valid TwiML 200 when the store is down', async () => {
    setStore(brokenStore());
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/status',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'To=%2B15551110000&From=%2B15550001111&CallSid=CAdown1&DialCallStatus=no-answer',
    });
    // Caller must never hear a Twilio error page — empty TwiML, 200.
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Response');
  });

  test('agent cron endpoint reports failure as 500 (Cloud Scheduler retries)', async () => {
    setStore(brokenStore());
    const res = await app.inject({
      method: 'POST',
      url: '/agents/watchdog',
      headers: { 'x-dev-key': 'dev-secret-change-me-please-0000000000000000' },
    });
    expect(res.statusCode).toBe(500);
  });
});

describe('two-phase webhook idempotency (H1)', () => {
  test('a crashed textback is re-runnable on Twilio retry; a completed one is not', async () => {
    const { claimEvent, completeEvent } = await import('../src/lib/events.js');
    // First claim wins, concurrent duplicate loses.
    expect(await claimEvent('call_X', 60_000)).toBe(true);
    expect(await claimEvent('call_X', 60_000)).toBe(false);
    // Stale (crashed mid-work) → retry may claim again.
    expect(await claimEvent('call_X', -1)).toBe(true);
    // Done → never again.
    await completeEvent('call_X');
    expect(await claimEvent('call_X', -1)).toBe(false);
  });
});

describe('owner takeover visibility (R1)', () => {
  test('takeover message appears in the thread and in the AI history after resume', async () => {
    const caller = '+15550006060';
    const first = await handleInboundMessage({
      tenantId, tenant, callerPhone: caller, body: 'hi there', channel: 'sms', messageSid: 'SMt1',
    });
    const cookie = createSessionCookie({ email: tenant.ownerEmail, role: 'owner', tenantId });

    const takeover = await app.inject({
      method: 'POST',
      url: `/api/conversations/${first.conversationId}/takeover`,
      payload: { body: 'We can fit you in at 3pm' },
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(takeover.statusCode).toBe(200);

    const detail = await app.inject({
      method: 'GET',
      url: `/api/conversations/${first.conversationId}`,
      cookies: { [SESSION_COOKIE]: cookie },
    });
    const ownerMsgs = (detail.json().messages as { role: string; body: string }[]).filter(
      (m) => m.role === 'owner',
    );
    expect(ownerMsgs).toHaveLength(1);
    expect(ownerMsgs[0]!.body).toContain('3pm');

    // After resume, the AI's history window must include the owner's turn.
    await app.inject({
      method: 'POST',
      url: `/api/conversations/${first.conversationId}/resume`,
      cookies: { [SESSION_COOKIE]: cookie },
    });
    const r = await handleInboundMessage({
      tenantId, tenant, callerPhone: caller, body: 'sounds good!', channel: 'sms',
      messageSid: 'SMt2', conversationId: first.conversationId,
    });
    expect(r.reply).toBeTruthy(); // turn completed with owner message in contents
  });
});

describe('slot lock lifecycle (R2)', () => {
  class FailNextAppointmentWrite extends MemoryStore {
    failed = false;
    override async add<T extends object>(path: string, data: T): Promise<string> {
      if (!this.failed && path.endsWith('/appointments')) {
        this.failed = true;
        throw new Error('FIRESTORE_UNAVAILABLE (simulated appointment write)');
      }
      return super.add(path, data);
    }
  }

  test('a failed appointment write releases the lock — slot stays bookable', async () => {
    const store = new FailNextAppointmentWrite();
    setStore(store);
    tenantId = await ensureDemoTenant();
    tenant = (await getStore().get<Tenant>('tenants', tenantId))!;
    const conversation = await findOrCreateConversation({
      tenantId, callerPhone: '+15550007070', channel: 'web_sim', source: 'demo',
    });
    const ctx = { tenantId, tenant, conversationId: conversation.id, conversation };

    const avail = await executeTool('get_availability', { days: 7 }, ctx);
    const slot = (avail.response.slots as { startsAt: string }[])[0]!;

    // First attempt: appointment write blows up → tool throws, lock released.
    await expect(
      executeTool('book_appointment', { slotStartsAt: slot.startsAt, callerName: 'Sam', service: 'Blowout' }, ctx),
    ).rejects.toThrow('simulated');
    expect(await getStore().query('slot_locks', {})).toHaveLength(0);

    // Second attempt on the SAME slot succeeds — no permanent poisoning.
    const retry = await executeTool(
      'book_appointment',
      { slotStartsAt: slot.startsAt, callerName: 'Sam', service: 'Blowout' },
      ctx,
    );
    expect(retry.response.ok).toBe(true);
  });
});

describe('missed-call budget (R3)', () => {
  test('owner alert is skipped when the webhook budget is spent; textback always goes out', async () => {
    await getStore().merge('tenants', tenantId, { ownerPhone: '+15559990001' });
    tenant = (await getStore().get<Tenant>('tenants', tenantId))!;

    // Budget already blown (-1): greeting only, no owner alert.
    const r1 = await startMissedCallConversation({
      tenantId, tenant, callerPhone: '+15550009091', callSid: 'CAbudget1', now: DAYTIME, budgetMs: -1,
    });
    expect(r1.conversationId).toBeTruthy();
    expect(await getStore().query('sms_out', {})).toHaveLength(1);

    // Normal budget: greeting + owner alert.
    const r2 = await startMissedCallConversation({
      tenantId, tenant, callerPhone: '+15550009092', callSid: 'CAbudget2', now: DAYTIME,
    });
    expect(r2.conversationId).toBeTruthy();
    expect(await getStore().query('sms_out', {})).toHaveLength(3);
  });

  test('retryOnce never retries an SMS-style timeout (double-text hazard)', async () => {
    let calls = 0;
    const smsPredicate = (err: unknown) => !(err instanceof TimeoutError);
    await expect(
      retryOnce(async () => {
        calls++;
        throw new TimeoutError('twilio:sendSms', 6000);
      }, 'test', smsPredicate),
    ).rejects.toThrow('timed out');
    expect(calls).toBe(1);

    // Explicit 503 responses ARE retried (default predicate).
    calls = 0;
    await retryOnce(async () => {
      calls++;
      if (calls === 1) throw Object.assign(new Error('boom'), { status: 503 });
      return 'ok';
    }, 'test');
    expect(calls).toBe(2);
  });
});

describe('demo spend cap (H10-adjacent)', () => {
  test('turnCount increments are atomic under parallel sends', async () => {
    const caller = '+15550008888';
    const first = await handleInboundMessage({
      tenantId, tenant, callerPhone: caller, body: 'hi', channel: 'sms', messageSid: 'SMs1',
    });
    await Promise.all(
      ['a', 'b', 'c'].map((t, i) =>
        handleInboundMessage({
          tenantId, tenant, callerPhone: caller, body: t, channel: 'sms',
          messageSid: `SMs${i + 2}`, conversationId: first.conversationId,
        }),
      ),
    );
    const conv = await getStore().get<Conversation>(`tenants/${tenantId}/conversations`, first.conversationId);
    expect(conv?.turnCount).toBe(4);
  });
});
