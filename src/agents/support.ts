import type { SupportTicket, Tenant } from '../types.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { parseJson } from '../lib/gemini.js';
import { sendEmail } from '../lib/email.js';
import { runAgent, registerApprovalExecutor } from './runner.js';

interface SupportVerdict {
  classification: string;
  reply: string;
  needsApproval: boolean;
}

const KNOWLEDGE = `RingBack product facts (answer ONLY from these):
- RingBack texts back missed calls for local businesses within seconds; a Gemini-powered AI answers questions and books appointments over SMS.
- Plans: Starter $49/mo (textback + booking), Pro $99/mo (adds FAQ training + weekly lead report). Founding customers: first month $1.
- Setup: after checkout we provision a phone number automatically; the owner reviews the AI-drafted profile, then forwards their business line (conditional call forwarding) to the RingBack number.
- Callers can opt out anytime by replying STOP (handled instantly, never by the AI).
- Owners can take over any conversation live from the dashboard; the AI pauses immediately.
- Cancellations, refunds, and billing disputes are ALWAYS escalated to the founder — never resolve these yourself.
- Data: conversations are stored securely on Google Cloud (Firestore); we never sell data.`;

/**
 * Inbound support email → classify → answer from the knowledge doc.
 * Billing/cancellation topics always require founder approval before a reply
 * is sent; everything else is answered autonomously.
 */
export async function runSupport(inbound: {
  fromEmail: string;
  subject: string;
  body: string;
}): Promise<{ runId: string; summary: string }> {
  const result = await runAgent(
    'support',
    { type: 'webhook', detail: 'inbound-email' },
    undefined,
    async (ctx) => {
      const store = getStore();

      // Try to associate the sender with a tenant for context.
      const tenants = await store.query<Tenant>('tenants', {
        where: [['ownerEmail', '==', inbound.fromEmail.toLowerCase()]],
        limit: 1,
      });
      const tenant = tenants[0];

      const res = await ctx.gemini({
        model: 'flash',
        system: `${KNOWLEDGE}\n\nClassify the email (question | setup_help | bug_report | billing | cancellation | spam) and draft a friendly, concise reply signed "— RingBack support (an AI agent — a human reviews anything billing-related)". Set needsApproval=true for billing, cancellation, refunds, or anything you are not sure about. Respond as JSON: {"classification":"...","reply":"...","needsApproval":true|false}`,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `From: ${inbound.fromEmail}${tenant ? ` (owner of tenant "${tenant.name}")` : ' (no tenant match)'}\nSubject: ${inbound.subject}\n\n${inbound.body.slice(0, 4000)}`,
              },
            ],
          },
        ],
        mockKind: 'support',
        stepName: 'classify-and-draft',
      });
      const verdict = parseJson<SupportVerdict>(res.text);
      if (!verdict) throw new Error('support agent produced unparseable verdict');

      const forceApproval = ['billing', 'cancellation'].includes(verdict.classification);
      const needsApproval = verdict.needsApproval || forceApproval;

      const ticket: SupportTicket = {
        fromEmail: inbound.fromEmail,
        tenantId: tenant?.id,
        subject: inbound.subject.slice(0, 200),
        body: inbound.body.slice(0, 4000),
        classification: verdict.classification,
        status: needsApproval ? 'awaiting_approval' : 'auto_resolved',
        agentRunId: ctx.runId,
        replyBody: verdict.reply.slice(0, 4000),
        createdAt: nowIso(),
      };
      const ticketId = await store.add('support_tickets', ticket);

      if (verdict.classification === 'spam') {
        await store.merge('support_tickets', ticketId, { status: 'closed' });
        return `Support: classified email from ${inbound.fromEmail} as spam — no reply sent.`;
      }

      if (needsApproval) {
        await ctx.action(
          'send_support_reply',
          { ticketId, classification: verdict.classification },
          { requiresApproval: true },
        );
        return `Support: "${inbound.subject}" classified as ${verdict.classification} — reply drafted, awaiting founder approval.`;
      }

      await ctx.action('send_support_reply', { ticketId }, {
        execute: async () => {
          await sendEmail({
            to: inbound.fromEmail,
            subject: `Re: ${inbound.subject}`,
            text: verdict.reply,
          });
        },
      });
      return `Support: answered "${inbound.subject}" (${verdict.classification}) autonomously.`;
    },
  );
  return { runId: result.runId, summary: result.summary };
}

registerApprovalExecutor('send_support_reply', async (payload) => {
  const store = getStore();
  const ticketId = String(payload.ticketId ?? '');
  const ticket = await store.get<SupportTicket>('support_tickets', ticketId);
  if (!ticket || !ticket.replyBody || !ticket.fromEmail) throw new Error('ticket or reply missing');
  await sendEmail({
    to: ticket.fromEmail,
    subject: `Re: ${ticket.subject}`,
    text: ticket.replyBody,
  });
  await store.merge('support_tickets', ticketId, { status: 'closed' });
  return `Approved reply sent to ${ticket.fromEmail}.`;
});
