import type { Conversation, Tenant } from '../types.js';
import { getStore } from '../lib/store.js';
import { isoDateOnly, nowIso } from '../lib/time.js';

/** Carrier-standard opt-out and help keywords, handled BEFORE any LLM call. */
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'cancel', 'end', 'quit']);
const HELP_WORDS = new Set(['help', 'info']);

export type KeywordAction = 'stop' | 'help' | null;

export function checkInboundKeywords(body: string): KeywordAction {
  const normalized = body.trim().toLowerCase();
  if (STOP_WORDS.has(normalized)) return 'stop';
  if (HELP_WORDS.has(normalized)) return 'help';
  return null;
}

export function stopAckText(tenant: Tenant): string {
  return `You have been unsubscribed from ${tenant.name} messages. No more texts will be sent. Reply START to re-subscribe.`;
}

export function helpText(tenant: Tenant): string {
  return `${tenant.name} appointment assistant. Msg&data rates may apply. Reply STOP to opt out. Questions? Contact the business directly.`;
}

export function optOutId(tenantId: string, phone: string): string {
  return `${tenantId}:${phone.replace(/[^+\d]/g, '')}`;
}

export async function isOptedOut(tenantId: string, phone: string): Promise<boolean> {
  return (await getStore().get('optouts', optOutId(tenantId, phone))) !== null;
}

export async function recordOptOut(tenantId: string, phone: string): Promise<void> {
  await getStore().set('optouts', optOutId(tenantId, phone), {
    phone,
    tenantId,
    createdAt: nowIso(),
  });
}

export async function clearOptOut(tenantId: string, phone: string): Promise<void> {
  await getStore().delete('optouts', optOutId(tenantId, phone));
}

/** Per-tenant daily SMS segment budget — the runaway-loop kill switch. */
export async function segmentsUsedToday(tenantId: string): Promise<number> {
  const today = isoDateOnly(new Date());
  const rows = await getStore().query<{ segments: number }>('sms_out', {
    where: [
      ['tenantId', '==', tenantId],
      ['createdAt', '>=', `${today}T00:00:00.000Z`],
    ],
  });
  return rows.reduce((sum, r) => sum + (r.segments ?? 1), 0);
}

export async function isOverDailyBudget(tenantId: string, tenant: Tenant): Promise<boolean> {
  const used = await segmentsUsedToday(tenantId);
  return used >= tenant.limits.dailySmsSegments;
}

export function isOverTurnCap(conversation: Conversation, tenant: Tenant): boolean {
  return conversation.turnCount >= tenant.limits.maxTurns;
}

export const TURN_CAP_MESSAGE =
  'Looping in the owner so you get a proper answer — someone will reach out shortly. Thanks for your patience!';

export interface PriceCheckResult {
  flagged: boolean;
  reply: string;
  flaggedAmounts?: string[];
}

/**
 * Post-generation guardrail: the model must never quote a dollar amount that
 * is not present in the tenant's own configuration. If it does, the reply is
 * replaced with a safe fallback and the incident is flagged.
 */
export function checkPrices(reply: string, tenant: Tenant): PriceCheckResult {
  const amounts = reply.match(/\$\s?\d+(?:[.,]\d{1,2})?/g);
  if (!amounts) return { flagged: false, reply };

  const allowedText = [
    ...tenant.profile.services.map((s) => s.price ?? ''),
    ...tenant.profile.faqs.map((f) => `${f.q} ${f.a}`),
    tenant.profile.bookingPolicy ?? '',
  ].join(' ');
  const allowed = new Set(
    (allowedText.match(/\$\s?\d+(?:[.,]\d{1,2})?/g) ?? []).map((a) => a.replace(/\s/g, '')),
  );

  const flaggedAmounts = amounts
    .map((a) => a.replace(/\s/g, ''))
    .filter((a) => !allowed.has(a));
  if (flaggedAmounts.length === 0) return { flagged: false, reply };

  return {
    flagged: true,
    flaggedAmounts,
    reply:
      "For exact pricing the owner will confirm with you directly — I don't want to misquote. Want me to book you in meanwhile?",
  };
}

/** Max Gemini tool-loop iterations within a single inbound message. */
export const MAX_TOOL_ITERATIONS = 4;
