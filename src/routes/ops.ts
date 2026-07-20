import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentRun, Conversation, Message, MetricsDaily, Prospect, Tenant, WeeklyReport } from '../types.js';
import { cfg } from '../config.js';
import { getStore, type WithId } from '../lib/store.js';
import { isoDateOnly } from '../lib/time.js';
import { getSessionUser, isFounder } from '../lib/auth.js';
import { computeMrrUsd } from '../agents/watchdog.js';
import { resolveApproval } from '../agents/runner.js';
import { runAgent } from '../agents/runner.js';
import { ensureDemoTenant } from '../demo-seed.js';
import { handleInboundMessage, findOrCreateConversation } from '../receptionist/conversation.js';
import { textbackGreeting } from '../receptionist/prompts.js';
import { nowIso } from '../lib/time.js';

/** Mask anything phone- or email-shaped in public output. */
function redactText(s: string): string {
  return s
    .replace(/\+?\d[\d\s().-]{6,}\d/g, (m) => {
      const digits = m.replace(/\D/g, '');
      return `+${digits.slice(0, 1)}***${digits.slice(-4)}`;
    })
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, (m) => {
      const [local = '', domain = ''] = m.split('@');
      return `${local.slice(0, 1)}***@${domain}`;
    });
}

/** Agents whose transcripts always contain real-customer communication. */
const PRIVATE_TRANSCRIPT_AGENTS = new Set(['support', 'onboarding']);

function redactRun(run: WithId<AgentRun>): WithId<AgentRun> {
  const isPrivateReceptionist =
    run.agent === 'receptionist' && run.tenantId !== undefined && run.tenantId !== cfg.DEMO_TENANT_ID;
  const isPrivate = isPrivateReceptionist || PRIVATE_TRANSCRIPT_AGENTS.has(run.agent);
  return {
    ...run,
    publicSummary: redactText(run.publicSummary),
    error: run.error ? redactText(run.error) : undefined,
    transcript: run.transcript.map((t) => ({
      ...t,
      // Real-customer message bodies never appear on the public feed.
      prompt: isPrivate ? '[redacted — customer communication]' : t.prompt && redactText(t.prompt),
      response: isPrivate ? '[redacted]' : t.response && redactText(t.response),
      result: t.result ? redactText(t.result) : undefined,
    })),
    actions: run.actions.map((a) => ({ ...a, payload: JSON.parse(redactText(JSON.stringify(a.payload))) })),
  };
}

export function registerOpsRoutes(app: FastifyInstance): void {
  // ── Public, read-only operations dashboard data ────────────────────────────
  app.get('/api/ops/summary', async () => {
    const store = getStore();
    const weekAgo = isoDateOnly(new Date(Date.now() - 7 * 86_400_000));
    const days = await store.query<MetricsDaily>('metrics_daily', {
      where: [['date', '>=', weekAgo]],
    });
    const tenants = await store.query<Tenant>('tenants', {});
    const runs = await store.query<AgentRun>('agent_runs', { limit: 1000 });

    let resolved = 0;
    let withOutcome = 0;
    for (const t of tenants) {
      const convs = await store.query<Conversation>(`tenants/${t.id}/conversations`, {
        where: [['lastMessageAt', '>=', `${weekAgo}T00:00:00.000Z`]],
        limit: 200,
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

    const allActions = runs.flatMap((r) => r.actions);
    return {
      kpis: {
        mrrUsd: await computeMrrUsd(tenants),
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
    };
  });

  app.get('/api/ops/runs', async (req) => {
    const limit = Math.min(Number((req.query as { limit?: string }).limit) || 50, 100);
    const runs = await getStore().query<AgentRun>('agent_runs', {
      orderBy: ['startedAt', 'desc'],
      limit,
    });
    return { runs: runs.map(redactRun) };
  });

  app.get('/api/ops/queue', async () => {
    const runs = await getStore().query<AgentRun>('agent_runs', {
      where: [['status', '==', 'awaiting_approval']],
      orderBy: ['startedAt', 'desc'],
      limit: 50,
    });
    return {
      items: runs.map((r) => ({
        runId: r.id,
        agent: r.agent,
        startedAt: r.startedAt,
        summary: redactText(r.publicSummary),
        actions: r.actions
          .map((a, index) => ({ type: a.type, payload: a.payload, index }))
          .filter((_, i) => r.actions[i]!.requiresApproval && !r.actions[i]!.executed && !r.actions[i]!.approvedAt),
      })),
    };
  });

  // ── Founder-gated approvals ────────────────────────────────────────────────
  app.post('/api/agents/approve/:runId', async (req, reply) => {
    const user = getSessionUser(req);
    if (!isFounder(user)) return reply.code(403).send({ error: 'founder login required' });
    const { runId } = req.params as { runId: string };
    const { actionIndex, approve } = z
      .object({ actionIndex: z.number().int().min(0), approve: z.boolean() })
      .parse(req.body ?? {});
    const result = await resolveApproval({
      runId,
      actionIndex,
      approve,
      approvedBy: user!.email,
    });
    if (!result.ok) return reply.code(400).send({ error: result.error });
    return { ok: true };
  });

  app.get('/api/prospects', async (req, reply) => {
    const user = getSessionUser(req);
    if (!isFounder(user)) return reply.code(403).send({ error: 'founder login required' });
    const status = (req.query as { status?: string }).status;
    const prospects = await getStore().query<Prospect>('prospects', {
      ...(status ? { where: [['status', '==', status]] as [string, '==', unknown][] } : {}),
      orderBy: ['createdAt', 'desc'],
      limit: 100,
    });
    return { prospects };
  });

  // ── Public demo simulator (same pipeline, web_sim channel) ─────────────────
  app.post('/api/demo/start', {
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } },
  }, async () => {
    const tenantId = await ensureDemoTenant();
    const store = getStore();
    const tenant = (await store.get<Tenant>('tenants', tenantId))!;
    // Unique pseudo-caller per demo session.
    const callerPhone = `+1999${String(Math.floor(1000000 + Math.random() * 8999999))}`;
    const conversation = await findOrCreateConversation({
      tenantId,
      callerPhone,
      channel: 'web_sim',
      source: 'demo',
    });
    const greeting = textbackGreeting(tenant);
    await store.add(`tenants/${tenantId}/conversations/${conversation.id}/messages`, {
      role: 'assistant',
      body: greeting,
      createdAt: nowIso(),
    });
    return {
      conversationId: conversation.id,
      tenant: {
        name: tenant.name,
        services: tenant.profile.services,
        hoursNote: 'Tue–Sat, Eastern Time',
      },
      messages: [{ role: 'assistant', body: greeting, createdAt: nowIso() }],
    };
  });

  app.post('/api/demo/message', {
    config: { rateLimit: { max: 15, timeWindow: '1 minute' } },
  }, async (req, reply) => {
    const parsed = z
      .object({ conversationId: z.string().min(1).max(80), text: z.string().min(1).max(500) })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { conversationId, text } = parsed.data;

    const tenantId = cfg.DEMO_TENANT_ID;
    const store = getStore();

    // Public-demo spend cap: bounded Gemini usage per day regardless of rate limits.
    const today = isoDateOnly(new Date());
    const demoRunsToday = await store.query('agent_runs', {
      where: [
        ['trigger.detail', '==', 'demo:web-simulator'],
        ['startedAt', '>=', `${today}T00:00:00.000Z`],
      ],
      limit: 501,
    });
    if (demoRunsToday.length > 500) {
      return reply.code(429).send({ error: 'demo is very popular today — try again tomorrow!' });
    }

    const tenant = await store.get<Tenant>('tenants', tenantId);
    const conversation = await store.get<Conversation>(
      `tenants/${tenantId}/conversations`,
      conversationId,
    );
    if (!tenant || !conversation || conversation.channel !== 'web_sim') {
      return reply.code(404).send({ error: 'demo session not found — refresh to restart' });
    }

    let booked: { service: string; startsAt: string; label: string } | undefined;
    await runAgent(
      'receptionist',
      { type: 'webhook', detail: 'demo:web-simulator' },
      tenantId,
      async (ctx) => {
        const result = await handleInboundMessage({
          tenantId,
          tenant,
          callerPhone: conversation.callerPhone,
          body: text,
          channel: 'web_sim',
          conversationId,
        });
        ctx.addCost('gemini', result.usage.costUsd);
        booked = result.booked;
        return `Demo conversation turn: ${result.booked ? `booked ${result.booked.service}` : (result.guardrail ?? 'replied')} (web simulator).`;
      },
    );

    const messages = await store.query<Message>(
      `tenants/${tenantId}/conversations/${conversationId}/messages`,
      { orderBy: ['createdAt', 'asc'], limit: 100 },
    );
    return {
      messages: messages
        .filter((m) => m.role === 'caller' || m.role === 'assistant')
        .map((m) => ({ role: m.role, body: m.body, createdAt: m.createdAt })),
      ...(booked ? { booked } : {}),
    };
  });
}
