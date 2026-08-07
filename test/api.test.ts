import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { MemoryStore, getStore, setStore } from '../src/lib/store.js';
import { buildApp } from '../src/server.js';
import { ensureDemoTenant } from '../src/demo-seed.js';
import { createSessionCookie, SESSION_COOKIE } from '../src/lib/auth.js';
import { runWatchdog } from '../src/agents/watchdog.js';
import type { AgentRun } from '../src/types.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});
beforeEach(async () => {
  setStore(new MemoryStore());
  await ensureDemoTenant();
});

describe('health & static', () => {
  test('healthz responds', async () => {
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  test('unknown API route is JSON 404 (not SPA fallback)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not found');
  });
});

/** The browser carries the demo-session cookie set by /start (M7 binding). */
function demoCookie(start: { cookies: { name: string; value: string }[] }): Record<string, string> {
  const c = start.cookies.find((x) => x.name === 'rb_demo');
  return c ? { rb_demo: c.value } : {};
}

describe('demo simulator (the judge path)', () => {
  test('start → chat → booking, all through the real pipeline', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/demo/start', payload: {} });
    expect(start.statusCode).toBe(200);
    const { conversationId, tenant } = start.json();
    expect(tenant.name).toBe('Luxe Cuts Salon');
    expect(conversationId).toBeTruthy();
    const cookies = demoCookie(start);

    const m1 = await app.inject({
      method: 'POST',
      url: '/api/demo/message',
      payload: { conversationId, text: 'Can I book a cut this week?' },
      cookies,
    });
    expect(m1.statusCode).toBe(200);
    const msgs1 = m1.json().messages;
    expect(msgs1.at(-1).role).toBe('assistant');

    const m2 = await app.inject({
      method: 'POST',
      url: '/api/demo/message',
      payload: { conversationId, text: 'My name is Jordan' },
      cookies,
    });
    expect(m2.statusCode).toBe(200);
    expect(m2.json().booked).toBeTruthy();
    expect(m2.json().booked.service).toBeTruthy();
  });

  test('a demo session cannot touch another session\'s conversation', async () => {
    const a = await app.inject({ method: 'POST', url: '/api/demo/start', payload: {} });
    const b = await app.inject({ method: 'POST', url: '/api/demo/start', payload: {} });
    const hijack = await app.inject({
      method: 'POST',
      url: '/api/demo/message',
      payload: { conversationId: a.json().conversationId, text: 'hi' },
      cookies: demoCookie(b),
    });
    expect(hijack.statusCode).toBe(403);
  });

  test('validates input', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/demo/message',
      payload: { conversationId: '', text: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  test('demo agent runs appear on the public ops feed', async () => {
    const start = await app.inject({ method: 'POST', url: '/api/demo/start', payload: {} });
    const { conversationId } = start.json();
    await app.inject({
      method: 'POST',
      url: '/api/demo/message',
      payload: { conversationId, text: 'hello!' },
      cookies: demoCookie(start),
    });
    const runs = await app.inject({ method: 'GET', url: '/api/ops/runs' });
    expect(runs.statusCode).toBe(200);
    const list = runs.json().runs as AgentRun[];
    expect(list.some((r) => r.agent === 'receptionist')).toBe(true);
  });
});

describe('ops endpoints', () => {
  test('summary returns KPI shape', async () => {
    await runWatchdog('test');
    const res = await app.inject({ method: 'GET', url: '/api/ops/summary' });
    expect(res.statusCode).toBe(200);
    const { kpis } = res.json();
    expect(kpis.totalAgentRuns).toBeGreaterThanOrEqual(1);
    expect(typeof kpis.mrrUsd).toBe('number');
    expect(kpis.activeTenants).toBe(1);
  });

  test('phone numbers are redacted in public run feed', async () => {
    const store = getStore();
    await store.add('agent_runs', {
      agent: 'receptionist',
      trigger: { type: 'webhook', detail: 'twilio:sms' },
      tenantId: 'real-tenant-1',
      startedAt: new Date().toISOString(),
      status: 'succeeded',
      transcript: [{ step: 'turn', at: new Date().toISOString(), prompt: 'caller +15559998888 said hi', response: 'hello +15559998888' }],
      actions: [],
      costUsd: { gemini: 0, twilio: 0, other: 0 },
      publicSummary: 'Replied to +15559998888',
    });
    const res = await app.inject({ method: 'GET', url: '/api/ops/runs' });
    const body = res.body;
    expect(body).not.toContain('+15559998888');
    // Non-demo receptionist transcripts are fully redacted.
    expect(body).toContain('[redacted');
  });
});

describe('auth boundaries', () => {
  test('owner APIs require login', async () => {
    for (const url of ['/api/me', '/api/tenant', '/api/conversations', '/api/appointments']) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode).toBe(401);
    }
  });

  test('approvals require founder role', async () => {
    const anon = await app.inject({
      method: 'POST',
      url: '/api/agents/approve/run1',
      payload: { actionIndex: 0, approve: true },
    });
    expect(anon.statusCode).toBe(403);

    const ownerCookie = createSessionCookie({ email: 'owner@x.y', role: 'owner', tenantId: 't1' });
    const owner = await app.inject({
      method: 'POST',
      url: '/api/agents/approve/run1',
      payload: { actionIndex: 0, approve: true },
      cookies: { [SESSION_COOKIE]: ownerCookie },
    });
    expect(owner.statusCode).toBe(403);
  });

  test('agent cron endpoints reject unauthenticated calls in absence of dev key', async () => {
    const res = await app.inject({ method: 'POST', url: '/agents/watchdog' });
    expect(res.statusCode).toBe(403);
  });

  test('owner session can read own tenant', async () => {
    const cookie = createSessionCookie({
      email: 'demo-owner@ringback.local',
      role: 'owner',
      tenantId: (await ensureDemoTenant()),
    });
    const res = await app.inject({
      method: 'GET',
      url: '/api/tenant',
      cookies: { [SESSION_COOKIE]: cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().name).toBe('Luxe Cuts Salon');
  });
});

describe('twilio webhooks (mock signature mode)', () => {
  test('missed call triggers textback + agent run', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/voice/status',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'To=%2B15551110000&From=%2B15550007777&CallSid=CAtest1&DialCallStatus=no-answer',
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('<Say');

    // Fire-and-forget textback task needs a beat to finish.
    await new Promise((r) => setTimeout(r, 50));
    const runs = await app.inject({ method: 'GET', url: '/api/ops/runs' });
    expect(runs.body).toContain('missed');
  });

  test('inbound SMS gets handled and answered', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/webhooks/twilio/sms',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'To=%2B15551110000&From=%2B15550007777&Body=hi+there&MessageSid=SMtest1',
    });
    expect(res.statusCode).toBe(200);
    const smsOut = await getStore().query('sms_out', {});
    expect(smsOut.length).toBeGreaterThanOrEqual(1);
  });
});
