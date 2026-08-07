import type { AgentRun, Conversation, MetricsDaily, Tenant, WeeklyReport } from '../types.js';
import { getStore } from './store.js';
import { isoDateOnly, nowIso } from './time.js';
import { PLAN_PRICES_USD } from './stripe.js';

/** Bounded inputs — this must stay cheap even as data grows (H10). */
const MAX_TENANTS = 100;
const MAX_RUNS = 500;
const MAX_CONVS_PER_TENANT = 100;

export interface OpsSummary {
  kpis: {
    mrrUsd: number;
    activeTenants: number;
    conversations7d: number;
    bookings7d: number;
    aiResolutionRate: number;
    totalAgentRuns: number;
    autonomousActions: number;
    humanApprovals: number;
  };
  latestReport: null | {
    weekOf: string;
    narrative: string;
    mrrUsd: number;
    totals: WeeklyReport['totals'];
  };
  computedAt: string;
}

/**
 * Bounded KPI computation. Runs inside the watchdog every 15 min and is
 * persisted to `ops_summary/current`; the public endpoint reads that one doc.
 */
export async function computeOpsSummary(): Promise<OpsSummary> {
  const store = getStore();
  const weekAgo = isoDateOnly(new Date(Date.now() - 7 * 86_400_000));
  const days = await store.query<MetricsDaily>('metrics_daily', {
    where: [['date', '>=', weekAgo]],
    limit: 8,
  });
  const tenants = await store.query<Tenant>('tenants', { limit: MAX_TENANTS });
  const runs = await store.query<AgentRun>('agent_runs', {
    orderBy: ['startedAt', 'desc'],
    limit: MAX_RUNS,
  });

  let resolved = 0;
  let withOutcome = 0;
  for (const t of tenants) {
    const convs = await store.query<Conversation>(`tenants/${t.id}/conversations`, {
      where: [['lastMessageAt', '>=', `${weekAgo}T00:00:00.000Z`]],
      limit: MAX_CONVS_PER_TENANT,
    });
    for (const c of convs) {
      if (c.outcome) {
        withOutcome++;
        if (['booked', 'answered_faq', 'qualified'].includes(c.outcome)) resolved++;
      }
    }
  }

  const reports = await store.query<WeeklyReport>('reports', {
    orderBy: ['weekOf', 'desc'],
    limit: 1,
  });

  const mrrUsd = tenants
    .filter((t) => t.billing.plan && ['active', 'trialing'].includes(t.billing.status ?? ''))
    .reduce((sum, t) => sum + (PLAN_PRICES_USD[t.billing.plan!] ?? 0), 0);

  const allActions = runs.flatMap((r) => r.actions);
  return {
    kpis: {
      mrrUsd,
      activeTenants: tenants.filter((t) => t.status === 'live').length,
      conversations7d: days.reduce((s, d) => s + d.conversations, 0),
      bookings7d: days.reduce((s, d) => s + d.bookings, 0),
      aiResolutionRate: withOutcome > 0 ? resolved / withOutcome : 0,
      totalAgentRuns: runs.length,
      autonomousActions: allActions.filter((a) => a.executed && !a.requiresApproval).length,
      humanApprovals: allActions.filter((a) => a.approvedAt).length,
    },
    latestReport: reports[0]
      ? {
          weekOf: reports[0].weekOf,
          narrative: reports[0].narrative,
          mrrUsd: reports[0].mrrUsd,
          totals: reports[0].totals,
        }
      : null,
    computedAt: nowIso(),
  };
}

export async function persistOpsSummary(): Promise<OpsSummary> {
  const summary = await computeOpsSummary();
  await getStore().set('ops_summary', 'current', summary);
  return summary;
}
