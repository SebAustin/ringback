import type { Conversation, Message, Tenant } from '../types.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { parseJson } from '../lib/gemini.js';
import { runAgent, registerApprovalExecutor } from './runner.js';

interface QaVerdict {
  score: number;
  issues: string[];
  notes: string;
}

const RUBRIC = `Score this AI receptionist SMS conversation 1-5 against the rubric:
5 = accurate, on-tone, correct booking flow, no invented facts;
3 = acceptable but missed a booking opportunity or was verbose;
1 = invented prices/services, ignored an opt-out, or was rude.
Also list concrete issues (empty array if none) and one-line notes.
Respond as JSON: {"score": n, "issues": ["..."], "notes": "..."}`;

/** Nightly QA: score yesterday's conversations, propose prompt fixes as gated suggestions. */
export async function runQa(triggerDetail: string): Promise<{ runId: string; summary: string }> {
  const result = await runAgent('qa', { type: 'cron', detail: triggerDetail }, undefined, async (ctx) => {
    const store = getStore();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const tenants = await store.query<Tenant>('tenants', {});
    let scored = 0;
    let flagged = 0;
    const allIssues: string[] = [];

    for (const tenant of tenants) {
      const convs = await store.query<Conversation>(`tenants/${tenant.id}/conversations`, {
        where: [['lastMessageAt', '>=', since]],
        limit: 10,
      });
      for (const conv of convs.filter((c) => c.qaScore === undefined && c.turnCount > 0)) {
        if (scored >= 20) break;
        const messages = await store.query<Message>(
          `tenants/${tenant.id}/conversations/${conv.id}/messages`,
          { orderBy: ['createdAt', 'asc'], limit: 40 },
        );
        const transcript = messages
          .filter((m) => m.role === 'caller' || m.role === 'assistant')
          .map((m) => `${m.role}: ${m.body}`)
          .join('\n');
        if (!transcript) continue;

        const res = await ctx.gemini({
          model: 'pro',
          system: RUBRIC,
          contents: [{ role: 'user', parts: [{ text: transcript.slice(0, 8000) }] }],
          mockKind: 'qa',
          stepName: `score-conversation:${conv.id}`,
        });
        const verdict = parseJson<QaVerdict>(res.text);
        if (!verdict) continue;
        scored++;
        await store.merge(`tenants/${tenant.id}/conversations`, conv.id, {
          qaScore: Math.min(5, Math.max(1, Math.round(verdict.score))),
          qaNotes: verdict.notes?.slice(0, 300) ?? '',
        });
        if (verdict.issues.length > 0) {
          flagged++;
          allIssues.push(...verdict.issues.map((i) => `[${tenant.name}] ${i}`));
        }
      }
    }

    if (allIssues.length > 0) {
      // Prompt changes are never auto-applied — they land in an approval queue.
      await ctx.action(
        'prompt_suggestion',
        {
          issues: allIssues.slice(0, 10),
          suggestion:
            'Review flagged conversations and tighten the receptionist system prompt for the issues listed.',
        },
        { requiresApproval: true },
      );
    }

    return `QA reviewed ${scored} conversations: ${flagged} flagged, ${allIssues.length} issues${allIssues.length > 0 ? ' (prompt suggestion queued for approval)' : ''}.`;
  });
  return { runId: result.runId, summary: result.summary };
}

registerApprovalExecutor('prompt_suggestion', async (payload) => {
  await getStore().add('prompt_suggestions', {
    ...payload,
    acceptedAt: nowIso(),
  });
  return 'Suggestion accepted and recorded to prompt_suggestions for founder application.';
});
