import { beforeEach, describe, expect, test } from 'vitest';
import { MemoryStore, getStore, setStore } from '../src/lib/store.js';
import { ensureDemoTenant } from '../src/demo-seed.js';
import { runAgent, resolveApproval } from '../src/agents/runner.js';
import { runWatchdog } from '../src/agents/watchdog.js';
import { runCfo } from '../src/agents/cfo.js';
import { runSupport } from '../src/agents/support.js';
import type { AgentRun, MetricsDaily, SupportTicket } from '../src/types.js';

beforeEach(async () => {
  setStore(new MemoryStore());
  await ensureDemoTenant();
});

describe('runAgent wrapper', () => {
  test('records success with transcript and summary', async () => {
    const r = await runAgent('watchdog', { type: 'manual', detail: 'test' }, undefined, async (ctx) => {
      await ctx.log('step-one', { result: 'did a thing' });
      return 'all done';
    });
    expect(r.status).toBe('succeeded');
    const run = await getStore().get<AgentRun>('agent_runs', r.runId);
    expect(run?.publicSummary).toBe('all done');
    expect(run?.transcript.some((t) => t.step === 'step-one')).toBe(true);
    expect(run?.durationMs).toBeGreaterThanOrEqual(0);
  });

  test('records failure without throwing', async () => {
    const r = await runAgent('cfo', { type: 'manual', detail: 'test' }, undefined, async () => {
      throw new Error('boom');
    });
    expect(r.status).toBe('failed');
    const run = await getStore().get<AgentRun>('agent_runs', r.runId);
    expect(run?.error).toContain('boom');
  });

  test('gated actions put the run in awaiting_approval; approval executes', async () => {
    let executed = false;
    const { registerApprovalExecutor } = await import('../src/agents/runner.js');
    registerApprovalExecutor('test_action', async () => {
      executed = true;
      return 'done';
    });

    const r = await runAgent('prospector', { type: 'manual', detail: 'test' }, undefined, async (ctx) => {
      await ctx.action('test_action', { foo: 'bar' }, { requiresApproval: true });
      return 'queued one action';
    });
    expect(r.status).toBe('awaiting_approval');

    const bad = await resolveApproval({ runId: r.runId, actionIndex: 5, approve: true, approvedBy: 'f' });
    expect(bad.ok).toBe(false);

    const ok = await resolveApproval({ runId: r.runId, actionIndex: 0, approve: true, approvedBy: 'founder@x' });
    expect(ok.ok).toBe(true);
    expect(executed).toBe(true);
    const run = await getStore().get<AgentRun>('agent_runs', r.runId);
    expect(run?.status).toBe('approved');
    expect(run?.actions[0]?.approvedBy).toBe('founder@x');

    // Double-approval is rejected.
    const dup = await resolveApproval({ runId: r.runId, actionIndex: 0, approve: true, approvedBy: 'f' });
    expect(dup.ok).toBe(false);
  });

  test('rejection marks run rejected without executing', async () => {
    const r = await runAgent('prospector', { type: 'manual', detail: 'test' }, undefined, async (ctx) => {
      await ctx.action('test_action_2', { x: 1 }, { requiresApproval: true });
      return 'queued';
    });
    const res = await resolveApproval({ runId: r.runId, actionIndex: 0, approve: false, approvedBy: 'f' });
    expect(res.ok).toBe(true);
    const run = await getStore().get<AgentRun>('agent_runs', r.runId);
    expect(run?.status).toBe('rejected');
    expect(run?.actions[0]?.executed).toBe(false);
  });
});

describe('watchdog', () => {
  test('writes daily metrics and sweeps tenants', async () => {
    const { summary } = await runWatchdog('test');
    expect(summary).toContain('swept');
    const today = new Date().toISOString().slice(0, 10);
    const metrics = await getStore().get<MetricsDaily>('metrics_daily', today);
    expect(metrics).toBeTruthy();
    expect(metrics?.activeTenants).toBe(1);
  });
});

describe('cfo', () => {
  test('produces a stored weekly report', async () => {
    await runWatchdog('test'); // seed metrics
    const { summary } = await runCfo('test');
    expect(summary).toContain('CFO report');
    const reports = await getStore().query('reports', {});
    expect(reports).toHaveLength(1);
  });
});

describe('support agent', () => {
  test('answers informational email autonomously (mock)', async () => {
    const { summary } = await runSupport({
      fromEmail: 'someone@example.com',
      subject: 'How does setup work?',
      body: 'Hi, how do I set this up for my salon?',
    });
    expect(summary).toContain('autonomously');
    const tickets = await getStore().query<SupportTicket>('support_tickets', {});
    expect(tickets[0]?.status).toBe('auto_resolved');
    const emails = await getStore().query('emails_out', {});
    expect(emails.length).toBeGreaterThanOrEqual(1);
  });
});
