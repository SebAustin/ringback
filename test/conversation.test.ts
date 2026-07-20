import { beforeEach, describe, expect, test } from 'vitest';
import { MemoryStore, getStore, setStore } from '../src/lib/store.js';
import { ensureDemoTenant } from '../src/demo-seed.js';
import {
  handleInboundMessage,
  startMissedCallConversation,
} from '../src/receptionist/conversation.js';
import type { Appointment, Conversation, Message, Tenant } from '../src/types.js';
import { cfg } from '../src/config.js';

const CALLER = '+15550009999';
let tenantId: string;
let tenant: Tenant;

beforeEach(async () => {
  setStore(new MemoryStore());
  tenantId = await ensureDemoTenant();
  tenant = (await getStore().get<Tenant>('tenants', tenantId))!;
});

async function conversations(): Promise<(Conversation & { id: string })[]> {
  return getStore().query<Conversation>(`tenants/${tenantId}/conversations`, {});
}

describe('missed call → textback', () => {
  test('creates conversation, sends greeting, is idempotent per CallSid', async () => {
    const r1 = await startMissedCallConversation({ tenantId, tenant, callerPhone: CALLER, callSid: 'CA1' });
    expect(r1.conversationId).toBeTruthy();

    const convs = await conversations();
    expect(convs).toHaveLength(1);
    expect(convs[0]!.source).toBe('missed_call');

    const msgs = await getStore().query<Message>(
      `tenants/${tenantId}/conversations/${r1.conversationId}/messages`,
      {},
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0]!.body).toContain('Reply STOP to opt out');

    // Twilio webhook retry with the same CallSid does nothing.
    const r2 = await startMissedCallConversation({ tenantId, tenant, callerPhone: CALLER, callSid: 'CA1' });
    expect(r2.skipped).toBe('duplicate_webhook');
    expect(await conversations()).toHaveLength(1);
  });

  test('skips opted-out callers entirely', async () => {
    await handleInboundMessage({ tenantId, tenant, callerPhone: CALLER, body: 'hi', channel: 'sms' });
    await handleInboundMessage({ tenantId, tenant, callerPhone: CALLER, body: 'STOP', channel: 'sms' });
    const r = await startMissedCallConversation({ tenantId, tenant, callerPhone: CALLER, callSid: 'CA2' });
    expect(r.skipped).toBe('opted_out');
  });
});

describe('conversation flow (mock Gemini)', () => {
  test('books an appointment end-to-end via tools', async () => {
    const r1 = await handleInboundMessage({
      tenantId,
      tenant,
      callerPhone: CALLER,
      body: 'Do you have anything available this week?',
      channel: 'web_sim',
    });
    // Mock calls get_availability then proposes slots + asks for a name.
    expect(r1.usage.toolCalls).toContain('get_availability');
    expect(r1.reply).toMatch(/name/i);

    const r2 = await handleInboundMessage({
      tenantId,
      tenant,
      callerPhone: CALLER,
      body: 'I am Alex',
      channel: 'web_sim',
      conversationId: r1.conversationId,
    });
    expect(r2.booked).toBeTruthy();

    const appts = await getStore().query<Appointment>(`tenants/${tenantId}/appointments`, {});
    expect(appts).toHaveLength(1);
    expect(appts[0]!.callerName).toBe('Alex');
    expect(appts[0]!.createdByAgent).toBe(true);
    expect(new Date(appts[0]!.startsAt).getTime()).toBeGreaterThan(Date.now());

    const conv = await getStore().get<Conversation>(`tenants/${tenantId}/conversations`, r1.conversationId);
    expect(conv?.outcome).toBe('booked');
  });

  test('STOP opts out deterministically without an LLM call', async () => {
    const r = await handleInboundMessage({
      tenantId,
      tenant,
      callerPhone: CALLER,
      body: 'STOP',
      channel: 'sms',
    });
    expect(r.guardrail).toBe('opt_out');
    expect(r.reply).toContain('unsubscribed');
    const convs = await conversations();
    expect(convs[0]!.status).toBe('opted_out');

    // Further messages are not answered.
    const r2 = await handleInboundMessage({
      tenantId,
      tenant,
      callerPhone: CALLER,
      body: 'hello?',
      channel: 'sms',
    });
    expect(r2.guardrail).toBe('opted_out');
    expect(r2.reply).toBeNull();
  });

  test('duplicate MessageSid is ignored (webhook retry)', async () => {
    const r1 = await handleInboundMessage({
      tenantId, tenant, callerPhone: CALLER, body: 'hi', channel: 'sms', messageSid: 'SM1',
    });
    expect(r1.reply).toBeTruthy();
    const r2 = await handleInboundMessage({
      tenantId, tenant, callerPhone: CALLER, body: 'hi', channel: 'sms', messageSid: 'SM1',
    });
    expect(r2.guardrail).toBe('duplicate_webhook');
    expect(r2.reply).toBeNull();
  });

  test('turn cap escalates instead of looping forever', async () => {
    const first = await handleInboundMessage({
      tenantId, tenant, callerPhone: CALLER, body: 'hi', channel: 'sms',
    });
    await getStore().merge(`tenants/${tenantId}/conversations`, first.conversationId, {
      turnCount: tenant.limits.maxTurns,
    });
    const r = await handleInboundMessage({
      tenantId, tenant, callerPhone: CALLER, body: 'still there?', channel: 'sms',
      conversationId: first.conversationId,
    });
    expect(r.guardrail).toBe('turn_cap');
    const conv = await getStore().get<Conversation>(`tenants/${tenantId}/conversations`, first.conversationId);
    expect(conv?.status).toBe('escalated');
  });

  test('owner takeover silences the AI', async () => {
    const first = await handleInboundMessage({
      tenantId, tenant, callerPhone: CALLER, body: 'hi', channel: 'sms',
    });
    await getStore().merge(`tenants/${tenantId}/conversations`, first.conversationId, {
      status: 'owner_takeover',
    });
    const r = await handleInboundMessage({
      tenantId, tenant, callerPhone: CALLER, body: 'question for you', channel: 'sms',
      conversationId: first.conversationId,
    });
    expect(r.guardrail).toBe('owner_takeover');
    expect(r.reply).toBeNull();
  });
});

describe('demo tenant', () => {
  test('is seeded idempotently with a mock number in local mode', async () => {
    const again = await ensureDemoTenant();
    expect(again).toBe(cfg.DEMO_TENANT_ID);
    expect(tenant.twilioNumber).toBe('+15551110000');
    expect(tenant.status).toBe('live');
  });
});
