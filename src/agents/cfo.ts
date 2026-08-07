import type { MetricsDaily, Tenant, WeeklyReport } from '../types.js';
import { getStore } from '../lib/store.js';
import { isoDateOnly, nowIso } from '../lib/time.js';
import { sendEmail } from '../lib/email.js';
import { cfg } from '../config.js';
import { PLAN_PRICES_USD } from '../lib/stripe.js';
import { runAgent } from './runner.js';

/**
 * Weekly CFO/analyst run: aggregates real metrics + costs, has Gemini Pro
 * write the P&L narrative, stores the report, and emails the founder.
 * The stored report doubles as the hackathon P&L evidence.
 */
export async function runCfo(triggerDetail: string): Promise<{ runId: string; summary: string; status: string }> {
  const result = await runAgent('cfo', { type: 'cron', detail: triggerDetail }, undefined, async (ctx) => {
    const store = getStore();
    const weekAgo = isoDateOnly(new Date(Date.now() - 7 * 86_400_000));
    const days = await store.query<MetricsDaily>('metrics_daily', {
      where: [['date', '>=', weekAgo]],
      orderBy: ['date', 'asc'],
    });
    const tenants = await store.query<Tenant>('tenants', {});
    const paying = tenants.filter(
      (t) => t.billing.plan && ['active', 'trialing'].includes(t.billing.status ?? ''),
    );
    const mrrUsd = paying.reduce((s, t) => s + (PLAN_PRICES_USD[t.billing.plan!] ?? 0), 0);
    const totals = {
      conversations: days.reduce((s, d) => s + d.conversations, 0),
      bookings: days.reduce((s, d) => s + d.bookings, 0),
      costUsd: Number(days.reduce((s, d) => s + d.smsCostUsd + d.geminiCostUsd, 0).toFixed(4)),
    };

    const prompt = `You are the CFO agent of RingBack, an AI-receptionist SaaS. Write a concise weekly report (max 250 words) for the founder covering: MRR and paying tenants, conversation/booking volume, unit costs vs the subscription price, and one concrete recommendation. Use ONLY these numbers, do not invent any:
MRR: $${mrrUsd}/mo across ${paying.length} paying tenants (${tenants.length} total tenants).
Last 7 days: ${totals.conversations} conversations, ${totals.bookings} bookings, variable costs $${totals.costUsd} (SMS + Gemini).
Daily detail: ${JSON.stringify(days)}`;

    const res = await ctx.gemini({
      model: 'pro',
      system: 'You write terse, numerate financial updates. Never invent numbers.',
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      mockKind: 'report',
      stepName: 'write-weekly-report',
    });

    const weekOf = isoDateOnly(new Date());
    const report: WeeklyReport = {
      weekOf,
      narrative: res.text,
      mrrUsd,
      activeTenants: paying.length,
      totals,
      createdAt: nowIso(),
      agentRunId: ctx.runId,
    };
    await store.set('reports', weekOf, report);

    await ctx.action('email_weekly_report', { to: cfg.FOUNDER_EMAIL, weekOf }, {
      execute: async () => {
        if (cfg.FOUNDER_EMAIL) {
          await sendEmail({
            to: cfg.FOUNDER_EMAIL,
            subject: `RingBack weekly report — MRR $${mrrUsd}, ${totals.bookings} bookings`,
            text: res.text,
          });
        }
      },
    });

    // Unit-economics alert: any tenant whose SMS spend eats >30% of their plan.
    for (const t of paying) {
      const smsRows = await store.query<{ costUsd: number }>('sms_out', {
        where: [
          ['tenantId', '==', t.id],
          ['createdAt', '>=', `${weekAgo}T00:00:00.000Z`],
        ],
      });
      const weekSms = smsRows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
      const monthlyPrice = PLAN_PRICES_USD[t.billing.plan!] ?? 0;
      if (monthlyPrice > 0 && weekSms * 4 > monthlyPrice * 0.3) {
        await ctx.log('unit-economics-alert', {
          result: `Tenant ${t.name}: projected SMS cost $${(weekSms * 4).toFixed(2)}/mo exceeds 30% of $${monthlyPrice} plan`,
        });
      }
    }

    return `CFO report ${weekOf}: MRR $${mrrUsd} (${paying.length} paying tenants), ${totals.conversations} conversations, ${totals.bookings} bookings, $${totals.costUsd} variable cost this week.`;
  });
  return { runId: result.runId, summary: result.summary, status: result.status };
}
