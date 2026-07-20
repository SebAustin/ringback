import type { AgentAction, AgentName, AgentRun, TranscriptStep } from '../types.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { generate, type GenerateOpts, type GenResult } from '../lib/gemini.js';

const TRANSCRIPT_FIELD_MAX = 4_000;
const TRANSCRIPT_MAX_STEPS = 60;

export interface AgentContext {
  runId: string;
  /** Append a transcript step (persisted — powers the /ops live feed). */
  log(step: string, data?: Partial<Pick<TranscriptStep, 'prompt' | 'response' | 'toolCall' | 'result'>>): Promise<void>;
  /** Gemini call that auto-records prompt/response + cost on the run. */
  gemini(opts: GenerateOpts & { stepName?: string }): Promise<GenResult>;
  /** Record an action. Auto-executed actions pass `execute`; gated ones set requiresApproval. */
  action(
    type: string,
    payload: Record<string, unknown>,
    opts?: { requiresApproval?: boolean; execute?: () => Promise<void> },
  ): Promise<void>;
  addCost(kind: 'gemini' | 'twilio' | 'other', usd: number): void;
}

function truncate(s: string | undefined): string | undefined {
  if (s === undefined) return undefined;
  return s.length > TRANSCRIPT_FIELD_MAX ? `${s.slice(0, TRANSCRIPT_FIELD_MAX)}…[truncated]` : s;
}

/**
 * Every agent execution flows through this wrapper: it creates the
 * `agent_runs` document up front, records every Gemini exchange and action,
 * and finalizes with status + duration + cost. This collection IS the
 * "AI running the business" evidence trail.
 */
export async function runAgent(
  agent: AgentName,
  trigger: AgentRun['trigger'],
  tenantId: string | undefined,
  fn: (ctx: AgentContext) => Promise<string>,
): Promise<{ runId: string; status: AgentRun['status']; summary: string }> {
  const store = getStore();
  const startedAt = nowIso();
  const start = Date.now();
  const transcript: TranscriptStep[] = [];
  const actions: AgentAction[] = [];
  const costUsd = { gemini: 0, twilio: 0, other: 0 };

  const run: AgentRun = {
    agent,
    trigger,
    ...(tenantId ? { tenantId } : {}),
    startedAt,
    status: 'running',
    transcript: [],
    actions: [],
    costUsd,
    publicSummary: `${agent} run started`,
  };
  const runId = await store.add('agent_runs', run);

  const persist = async (): Promise<void> => {
    await store.merge('agent_runs', runId, {
      transcript: transcript.slice(0, TRANSCRIPT_MAX_STEPS),
      actions,
      costUsd,
    });
  };

  const ctx: AgentContext = {
    runId,
    async log(step, data) {
      transcript.push({
        step,
        at: nowIso(),
        prompt: truncate(data?.prompt),
        response: truncate(data?.response),
        toolCall: data?.toolCall,
        result: truncate(data?.result),
      });
      await persist();
    },
    async gemini(opts) {
      const res = await generate(opts);
      costUsd.gemini += res.usage.costUsd;
      await ctx.log(opts.stepName ?? `gemini:${opts.model}`, {
        prompt: opts.contents
          .map((c) => (c.parts ?? []).map((p) => ('text' in p ? p.text : '')).join(' '))
          .join('\n')
          .trim(),
        response: res.text || res.functionCalls.map((f) => `→ ${f.name}`).join(', '),
      });
      return res;
    },
    async action(type, payload, opts2) {
      const requiresApproval = opts2?.requiresApproval ?? false;
      let executed = false;
      if (!requiresApproval && opts2?.execute) {
        await opts2.execute();
        executed = true;
      }
      actions.push({ type, payload, executed, requiresApproval });
      await persist();
    },
    addCost(kind, usd) {
      costUsd[kind] += usd;
    },
  };

  try {
    const summary = await fn(ctx);
    const pendingApproval = actions.some((a) => a.requiresApproval && !a.executed);
    const status: AgentRun['status'] = pendingApproval ? 'awaiting_approval' : 'succeeded';
    await store.merge('agent_runs', runId, {
      status,
      finishedAt: nowIso(),
      durationMs: Date.now() - start,
      transcript: transcript.slice(0, TRANSCRIPT_MAX_STEPS),
      actions,
      costUsd,
      publicSummary: summary,
    });
    return { runId, status, summary };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await store.merge('agent_runs', runId, {
      status: 'failed',
      finishedAt: nowIso(),
      durationMs: Date.now() - start,
      transcript: transcript.slice(0, TRANSCRIPT_MAX_STEPS),
      actions,
      costUsd,
      error: message.slice(0, 500),
      publicSummary: `${agent} run failed: ${message.slice(0, 120)}`,
    });
    return { runId, status: 'failed', summary: message };
  }
}

// ── Approval execution registry ──────────────────────────────────────────────
// Gated actions can't store closures, so approval executes by action type.

export type ApprovalExecutor = (payload: Record<string, unknown>) => Promise<string>;

const approvalExecutors = new Map<string, ApprovalExecutor>();

export function registerApprovalExecutor(type: string, executor: ApprovalExecutor): void {
  approvalExecutors.set(type, executor);
}

export async function resolveApproval(opts: {
  runId: string;
  actionIndex: number;
  approve: boolean;
  approvedBy: string;
}): Promise<{ ok: boolean; error?: string }> {
  const store = getStore();
  const run = await store.get<AgentRun>('agent_runs', opts.runId);
  if (!run) return { ok: false, error: 'run not found' };
  const action = run.actions[opts.actionIndex];
  if (!action) return { ok: false, error: 'action not found' };
  if (!action.requiresApproval) return { ok: false, error: 'action does not require approval' };
  if (action.executed || action.approvedAt) return { ok: false, error: 'action already resolved' };

  const actions = [...run.actions];
  if (opts.approve) {
    const executor = approvalExecutors.get(action.type);
    if (!executor) return { ok: false, error: `no executor registered for ${action.type}` };
    const result = await executor(action.payload);
    actions[opts.actionIndex] = {
      ...action,
      executed: true,
      approvedBy: opts.approvedBy,
      approvedAt: nowIso(),
    };
    const stillPending = actions.some((a) => a.requiresApproval && !a.executed && !a.approvedAt);
    await store.merge('agent_runs', opts.runId, {
      actions,
      status: stillPending ? 'awaiting_approval' : 'approved',
      transcript: [
        ...run.transcript,
        { step: `approval:${action.type}`, at: nowIso(), result: result.slice(0, 500) },
      ],
    });
  } else {
    actions[opts.actionIndex] = {
      ...action,
      executed: false,
      approvedBy: opts.approvedBy,
      approvedAt: nowIso(),
    };
    const stillPending = actions.some((a) => a.requiresApproval && !a.executed && !a.approvedAt);
    await store.merge('agent_runs', opts.runId, {
      actions,
      status: stillPending ? 'awaiting_approval' : 'rejected',
    });
  }
  return { ok: true };
}
