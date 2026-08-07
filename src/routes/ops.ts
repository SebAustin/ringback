import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AgentRun, Conversation, Message, Prospect, Tenant } from '../types.js';
import { cfg } from '../config.js';
import { getStore, type WithId } from '../lib/store.js';
import { isoDateOnly } from '../lib/time.js';
import { getSessionUser, isFounder, signToken, verifyToken } from '../lib/auth.js';
import { persistOpsSummary, type OpsSummary } from '../lib/ops-summary.js';
import { resolveApproval, runAgent } from '../agents/runner.js';
import { ensureDemoTenant } from '../demo-seed.js';
import { handleInboundMessage, findOrCreateConversation, nextMessageSeq } from '../receptionist/conversation.js';
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
    actions: run.actions.map((a) => ({ ...a, payload: redactPayload(a.payload) as Record<string, unknown> })),
  };
}

/** Redact by walking the object and rewriting STRING leaves only — regexing a
 * serialized JSON blob can corrupt numeric literals into invalid JSON (M1). */
function redactPayload(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactPayload(v)]));
  }
  return value;
}

export function registerOpsRoutes(app: FastifyInstance): void {
  // ── Public, read-only operations dashboard data ────────────────────────────
  // Served from the watchdog-precomputed doc + a short in-process cache — a
  // public endpoint must never fan out N+1 Firestore reads per request (H10).
  let summaryCache: { value: OpsSummary; at: number } | null = null;
  let summaryInFlight: Promise<OpsSummary> | null = null;
  const SUMMARY_CACHE_MS = 30_000;

  app.get('/api/ops/summary', async () => {
    if (summaryCache && Date.now() - summaryCache.at < SUMMARY_CACHE_MS) {
      return summaryCache.value;
    }
    // Single-flight: N concurrent requests share one recompute instead of
    // each fanning out the full Firestore read.
    if (!summaryInFlight) {
      summaryInFlight = (async () => {
        try {
          const stored = await getStore().get<OpsSummary>('ops_summary', 'current');
          const fresh =
            stored && Date.now() - new Date(stored.computedAt).getTime() < 20 * 60_000
              ? stored
              : await persistOpsSummary();
          summaryCache = { value: fresh, at: Date.now() };
          return fresh;
        } finally {
          summaryInFlight = null;
        }
      })();
    }
    return summaryInFlight;
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
  }, async (_req, reply) => {
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
      seq: nextMessageSeq(),
    });
    // Bind the demo conversation to this browser session — no cross-session
    // read/write of someone else's demo thread (M7).
    reply.setCookie('rb_demo', signToken({ cid: conversation.id, kind: 'demo' }, 24 * 3600), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cfg.APP_BASE_URL.startsWith('https'),
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

    const demoToken = verifyToken<{ cid: string; kind: string }>(
      String((req.cookies ?? {}).rb_demo ?? ''),
    );
    if (!demoToken || demoToken.kind !== 'demo' || demoToken.cid !== conversationId) {
      return reply.code(403).send({ error: 'demo session mismatch — refresh to restart' });
    }

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
      { orderBy: ['seq', 'asc'], limit: 100 },
    );
    return {
      messages: messages
        .filter((m) => m.role === 'caller' || m.role === 'assistant')
        .map((m) => ({ role: m.role, body: m.body, createdAt: m.createdAt })),
      ...(booked ? { booked } : {}),
    };
  });
}
