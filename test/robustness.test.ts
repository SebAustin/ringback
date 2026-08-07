import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MemoryStore, getStore, setStore, type Store } from '../src/lib/store.js';
import { buildApp } from '../src/server.js';
import { ensureDemoTenant } from '../src/demo-seed.js';
import { handleInboundMessage } from '../src/receptionist/conversation.js';
import { inboundEmailKey } from '../src/routes/agents.js';
import type { Conversation, Tenant } from '../src/types.js';

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
