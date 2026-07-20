import type { Conversation, MetricsDaily, Tenant } from '../types.js';
import { getStore, type WithId } from '../lib/store.js';
import { isoDateOnly, nowIso } from '../lib/time.js';
import { segmentsUsedToday } from '../receptionist/guardrails.js';
import { PLAN_PRICES_USD } from '../lib/stripe.js';
import { sendSms } from '../lib/twilio.js';
import { cfg } from '../config.js';
import { runAgent, type AgentContext } from './runner.js';

const IDLE_CLOSE_MS = 24 * 3600_000;
const STUCK_MS = 30 * 60_000;

function inferOutcome(c: Conversation): Conversation['outcome'] {
  if (c.outcome) return c.outcome;
  return c.turnCount > 1 ? 'answered_faq' : 'lost';
}

async function sweepTenant(
  ctx: AgentContext,
  tenant: WithId<Tenant>,
): Promise<{ closed: number; stuck: number; paused: boolean }> {
  const store = getStore();
  const convPath = `tenants/${tenant.id}/conversations`;
  let closed = 0;
  let stuck = 0;

  const active = await store.query<Conversation>(convPath, {
    where: [['status', 'in', ['active', 'escalated']]],
  });

  for (const conv of active) {
    const idleMs = Date.now() - new Date(conv.lastMessageAt).getTime();
    if (idleMs > IDLE_CLOSE_MS) {
      const summary =
        conv.summary ??
        (
          await ctx.gemini({
            model: 'flash',
            system: 'Summarize this SMS conversation in one sentence for the business owner.',
            contents: [{ role: 'user', parts: [{ text: `Conversation with ${conv.turnCount} turns, outcome so far: ${conv.outcome ?? 'none'}.` }] }],
            mockKind: 'summary',
            stepName: 'summarize-idle-conversation',
          })
        ).text;
      await store.merge(convPath, conv.id, {
        status: 'closed',
        outcome: inferOutcome(conv),
        summary: summary.slice(0, 300),
      });
      closed++;
    } else if (conv.status === 'active' && idleMs > STUCK_MS) {
      // A caller message with no AI reply for 30+ min means something broke.
      const msgs = await store.query<{ role: string; createdAt: string }>(
        `${convPath}/${conv.id}/messages`,
        { orderBy: ['createdAt', 'desc'], limit: 1 },
      );
      if (msgs[0]?.role === 'caller') {
        stuck++;
        await store.add('incidents', {
          severity: 'medium',
          detectedBy: 'watchdog',
          description: `Conversation ${conv.id} (tenant ${tenant.name}) has an unanswered caller message for 30+ min`,
          status: 'open',
          createdAt: nowIso(),
          agentRunId: ctx.runId,
        });
      }
    }
  }

  // Budget kill switch — pause tenants that breached their daily SMS cap.
  let paused = false;
  if (tenant.status === 'live') {
    const used = await segmentsUsedToday(tenant.id);
    if (used >= tenant.limits.dailySmsSegments) {
      await store.merge('tenants', tenant.id, { status: 'paused' });
      paused = true;
      await ctx.action('pause_tenant_over_budget', { tenantId: tenant.id, segmentsUsed: used }, {
        execute: async () => {
          if (cfg.FOUNDER_PHONE) {
            await sendSms({
              to: cfg.FOUNDER_PHONE,
              body: `RingBack watchdog: paused tenant "${tenant.name}" — daily SMS budget breached (${used} segments).`,
            });
          }
        },
      });
    }
  }
  return { closed, stuck, paused };
}

export async function computeMrrUsd(tenants: WithId<Tenant>[]): Promise<number> {
  return tenants
    .filter((t) => t.billing.plan && ['active', 'trialing'].includes(t.billing.status ?? ''))
    .reduce((sum, t) => sum + (PLAN_PRICES_USD[t.billing.plan!] ?? 0), 0);
}

async function writeDailyMetrics(tenants: WithId<Tenant>[]): Promise<MetricsDaily> {
  const store = getStore();
  const today = isoDateOnly(new Date());
  const startOfDay = `${today}T00:00:00.000Z`;

  let conversations = 0;
  let bookings = 0;
  let missedCallsCaptured = 0;
  const latencies: number[] = [];
  let smsCostUsd = 0;

  for (const t of tenants) {
    const convs = await store.query<Conversation & { textbackLatencyMs?: number }>(
      `tenants/${t.id}/conversations`,
      { where: [['createdAt', '>=', startOfDay]] },
    );
    conversations += convs.length;
    missedCallsCaptured += convs.filter((c) => c.source === 'missed_call').length;
    for (const c of convs) if (c.textbackLatencyMs) latencies.push(c.textbackLatencyMs);
    const appts = await store.query(`tenants/${t.id}/appointments`, {
      where: [['createdAt', '>=', startOfDay]],
    });
    bookings += appts.length;
  }
  const smsRows = await store.query<{ costUsd: number }>('sms_out', {
    where: [['createdAt', '>=', startOfDay]],
  });
  smsCostUsd = smsRows.reduce((s, r) => s + (r.costUsd ?? 0), 0);

  const runs = await store.query<{ costUsd?: { gemini: number } }>('agent_runs', {
    where: [['startedAt', '>=', startOfDay]],
  });
  const geminiCostUsd = runs.reduce((s, r) => s + (r.costUsd?.gemini ?? 0), 0);

  latencies.sort((a, b) => a - b);
  const metrics: MetricsDaily = {
    date: today,
    conversations,
    bookings,
    missedCallsCaptured,
    medianTextbackMs: latencies.length > 0 ? latencies[Math.floor(latencies.length / 2)]! : 0,
    smsCostUsd: Number(smsCostUsd.toFixed(4)),
    geminiCostUsd: Number(geminiCostUsd.toFixed(4)),
    mrrUsd: await computeMrrUsd(tenants),
    activeTenants: tenants.filter((t) => t.status === 'live').length,
  };
  await store.set('metrics_daily', today, metrics);
  return metrics;
}

/** Every-15-min sweep: close idle threads, flag stuck ones, enforce budgets, refresh daily metrics. */
export async function runWatchdog(triggerDetail: string): Promise<{ runId: string; summary: string }> {
  const result = await runAgent('watchdog', { type: 'cron', detail: triggerDetail }, undefined, async (ctx) => {
    const store = getStore();
    const tenants = await store.query<Tenant>('tenants', {
      where: [['status', 'in', ['live', 'pending_review', 'paused']]],
    });
    let closed = 0;
    let stuck = 0;
    let paused = 0;
    for (const tenant of tenants) {
      const r = await sweepTenant(ctx, tenant);
      closed += r.closed;
      stuck += r.stuck;
      if (r.paused) paused++;
    }
    const metrics = await writeDailyMetrics(tenants);
    await ctx.log('daily-metrics', { result: JSON.stringify(metrics) });
    return `Watchdog swept ${tenants.length} tenants: ${closed} idle conversations closed, ${stuck} stuck flagged, ${paused} paused for budget. Today: ${metrics.conversations} conversations, ${metrics.bookings} bookings.`;
  });
  return { runId: result.runId, summary: result.summary };
}
