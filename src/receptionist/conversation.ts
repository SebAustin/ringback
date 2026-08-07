import type { Content } from '@google/genai';
import type { Conversation, Message, Tenant } from '../types.js';
import { getStore, type WithId } from '../lib/store.js';
import { localHour, nowIso } from '../lib/time.js';
import { generate } from '../lib/gemini.js';
import { maskPhone, sendSms } from '../lib/twilio.js';
import { claimEvent, completeEvent } from '../lib/events.js';
import { sleep } from '../lib/async.js';
import { buildSystemPrompt, ownerMissedCallAlert, textbackGreeting } from './prompts.js';
import { executeTool, TOOL_DECLARATIONS, type ToolContext } from './tools.js';
import {
  MAX_TOOL_ITERATIONS,
  TURN_CAP_MESSAGE,
  checkInboundKeywords,
  checkPrices,
  clearOptOut,
  helpText,
  isOptedOut,
  isOverDailyBudget,
  isOverTurnCap,
  recordOptOut,
  stopAckText,
} from './guardrails.js';

export interface ReplyResult {
  reply: string | null;
  conversationId: string;
  booked?: { service: string; startsAt: string; label: string };
  guardrail?: string;
  usage: { inTokens: number; outTokens: number; costUsd: number; toolCalls: string[] };
}

const TOOL_CALL_PREFIX = 'TOOL_CALL:';
const TOOL_RESULT_PREFIX = 'TOOL_RESULT:';
/** Whole Gemini tool loop must finish inside this budget (Twilio webhook ~15s). */
const TOOL_LOOP_DEADLINE_MS = 10_000;
/** No AI-initiated first-texts between 21:00 and 08:00 tenant-local (TCPA hygiene). */
const QUIET_HOUR_START = 21;
const QUIET_HOUR_END = 8;

function convPath(tenantId: string): string {
  return `tenants/${tenantId}/conversations`;
}
function msgPath(tenantId: string, conversationId: string): string {
  return `${convPath(tenantId)}/${conversationId}/messages`;
}
function pointerId(tenantId: string, phone: string): string {
  return `${tenantId}:${phone.replace(/[^+\d]/g, '')}`;
}

// Monotonic message ordering: ISO timestamps collide within a millisecond,
// which scrambles tool-call/response pairs. Time-based so it also orders
// approximately across instances.
let seqCounter = 0;
export function nextMessageSeq(): number {
  seqCounter = (seqCounter + 1) % 1000;
  return Date.now() * 1000 + seqCounter;
}

async function addMessage(
  tenantId: string,
  conversationId: string,
  msg: Message,
  fixedId?: string,
): Promise<boolean> {
  const store = getStore();
  const doc = { ...msg, seq: msg.seq ?? nextMessageSeq() };
  if (fixedId) return store.createIfAbsent(msgPath(tenantId, conversationId), fixedId, doc);
  await store.add(msgPath(tenantId, conversationId), doc);
  return true;
}

/** Rebuild Gemini `contents` from persisted messages (incl. tool call pairs).
 * Malformed tool docs are skipped, never fatal (a bad doc must not wedge the thread). */
function messagesToContents(messages: WithId<Message>[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === 'caller') {
      contents.push({ role: 'user', parts: [{ text: m.body }] });
    } else if (m.role === 'assistant' || m.role === 'owner') {
      contents.push({ role: 'model', parts: [{ text: m.body }] });
    } else if (m.role === 'system' && m.body.startsWith(TOOL_CALL_PREFIX)) {
      try {
        const { name, args } = JSON.parse(m.body.slice(TOOL_CALL_PREFIX.length));
        contents.push({ role: 'model', parts: [{ functionCall: { name, args } }] });
      } catch {
        /* skip malformed tool doc */
      }
    } else if (m.role === 'system' && m.body.startsWith(TOOL_RESULT_PREFIX)) {
      try {
        const { name, response } = JSON.parse(m.body.slice(TOOL_RESULT_PREFIX.length));
        contents.push({ role: 'user', parts: [{ functionResponse: { name, response } }] });
      } catch {
        /* skip malformed tool doc */
      }
    }
  }
  return sanitizeToolPairs(contents);
}

/** Gemini rejects a functionCall without its functionResponse (and vice versa) —
 * drop orphans that a history-window cut or skipped doc can produce. */
function sanitizeToolPairs(contents: Content[]): Content[] {
  const out: Content[] = [];
  for (let i = 0; i < contents.length; i++) {
    const c = contents[i]!;
    const isCall = (c.parts ?? []).some((p) => 'functionCall' in p && p.functionCall);
    const isResponse = (c.parts ?? []).some((p) => 'functionResponse' in p && p.functionResponse);
    if (isCall) {
      const next = contents[i + 1];
      const nextIsResponse = next && (next.parts ?? []).some((p) => 'functionResponse' in p && p.functionResponse);
      if (!nextIsResponse) continue; // orphan call
    } else if (isResponse) {
      const prev = out[out.length - 1];
      const prevIsCall = prev && (prev.parts ?? []).some((p) => 'functionCall' in p && p.functionCall);
      if (!prevIsCall) continue; // orphan response
    }
    out.push(c);
  }
  return out;
}

const ACTIVE_STATUSES = ['active', 'escalated', 'owner_takeover'];

interface ActivePointer {
  conversationId: string | null;
  claimedAt: string;
}

/**
 * One active conversation per (tenant, caller), enforced by a claimable
 * pointer doc — concurrent webhooks on different instances converge on the
 * same thread instead of splitting it (H5).
 */
export async function findOrCreateConversation(opts: {
  tenantId: string;
  callerPhone: string;
  channel: 'sms' | 'web_sim';
  source: Conversation['source'];
  missedCallSid?: string;
}): Promise<WithId<Conversation>> {
  const store = getStore();
  const pid = pointerId(opts.tenantId, opts.callerPhone);

  const resolve = async (): Promise<WithId<Conversation> | null> => {
    const pointer = await store.get<ActivePointer>('active_conv', pid);
    if (!pointer?.conversationId) return null;
    const conv = await store.get<Conversation>(convPath(opts.tenantId), pointer.conversationId);
    return conv && ACTIVE_STATUSES.includes(conv.status) ? conv : null;
  };

  const existing = await resolve();
  if (existing) return existing;

  const claimed = await store.createIfAbsent<ActivePointer>('active_conv', pid, {
    conversationId: null,
    claimedAt: nowIso(),
  });
  if (!claimed) {
    // Someone else is creating right now — give them a beat, then reuse theirs.
    await sleep(300);
    const theirs = await resolve();
    if (theirs) return theirs;
  }

  const conversation: Conversation = {
    tenantId: opts.tenantId,
    callerPhone: opts.callerPhone,
    channel: opts.channel,
    source: opts.source,
    status: 'active',
    turnCount: 0,
    smsSegmentsUsed: 0,
    createdAt: nowIso(),
    lastMessageAt: nowIso(),
    missedCallSid: opts.missedCallSid,
  };
  const id = await store.add(convPath(opts.tenantId), conversation);
  await store.set<ActivePointer>('active_conv', pid, { conversationId: id, claimedAt: nowIso() });
  return { ...conversation, id };
}

/** Call when a conversation leaves the active set (closed / opted out). */
export async function releaseActiveConversation(tenantId: string, callerPhone: string): Promise<void> {
  await getStore().delete('active_conv', pointerId(tenantId, callerPhone));
}

function inQuietHours(tenant: Tenant, now: Date): boolean {
  const hour = localHour(now, tenant.profile.timezone);
  return hour >= QUIET_HOUR_START || hour < QUIET_HOUR_END;
}

/** Missed call → create conversation + instant textback + owner alert. */
export async function startMissedCallConversation(opts: {
  tenantId: string;
  tenant: Tenant;
  callerPhone: string;
  callSid: string;
  now?: Date;
}): Promise<{ conversationId: string | null; skipped?: string }> {
  const { tenantId, tenant, callerPhone, callSid } = opts;
  const store = getStore();
  const t0 = Date.now();
  const eventId = `call_${callSid}`;

  // Two-phase idempotency: a crash mid-work lets Twilio's retry re-run it (H1).
  if (!(await claimEvent(eventId))) return { conversationId: null, skipped: 'duplicate_webhook' };

  const skip = async (reason: string): Promise<{ conversationId: null; skipped: string }> => {
    await completeEvent(eventId);
    return { conversationId: null, skipped: reason };
  };

  if (await isOptedOut(tenantId, callerPhone)) return skip('opted_out');
  if (await isOverDailyBudget(tenantId, tenant)) return skip('daily_budget');
  if (inQuietHours(tenant, opts.now ?? new Date())) {
    // Owner still hears about it; the caller isn't texted at 3am.
    await notifyOwner(tenant, tenantId, ownerMissedCallAlert(tenant, maskPhone(callerPhone)));
    return skip('quiet_hours');
  }

  const conversation = await findOrCreateConversation({
    tenantId,
    callerPhone,
    channel: 'sms',
    source: 'missed_call',
    missedCallSid: callSid,
  });

  const greeting = textbackGreeting(tenant);
  const sent = await sendSms({ to: callerPhone, from: tenant.twilioNumber, body: greeting, tenantId });
  await addMessage(tenantId, conversation.id, {
    role: 'assistant',
    body: greeting,
    createdAt: nowIso(),
    deliveryStatus: 'sent',
  });
  await store.increment(convPath(tenantId), conversation.id, 'smsSegmentsUsed', sent.segments);
  await store.merge(convPath(tenantId), conversation.id, {
    lastMessageAt: nowIso(),
    textbackLatencyMs: Date.now() - t0,
  });

  await notifyOwner(tenant, tenantId, ownerMissedCallAlert(tenant, maskPhone(callerPhone)));
  await completeEvent(eventId);
  return { conversationId: conversation.id };
}

/** Owner alerts are best-effort — they must never fail the caller-facing flow. */
async function notifyOwner(tenant: Tenant, tenantId: string, body: string): Promise<void> {
  if (!tenant.ownerPhone) return;
  try {
    await sendSms({ to: tenant.ownerPhone, body, tenantId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ severity: 'warning', msg: 'owner alert failed', tenantId, err: String(err) }));
  }
}

/** Inbound customer message → guardrails → Gemini tool loop → reply. */
export async function handleInboundMessage(opts: {
  tenantId: string;
  tenant: Tenant;
  callerPhone: string;
  body: string;
  channel: 'sms' | 'web_sim';
  messageSid?: string;
  conversationId?: string;
}): Promise<ReplyResult> {
  const eventId = opts.messageSid ? `sms_${opts.messageSid}` : null;
  if (eventId && !(await claimEvent(eventId))) {
    return {
      reply: null,
      conversationId: opts.conversationId ?? '',
      guardrail: 'duplicate_webhook',
      usage: { inTokens: 0, outTokens: 0, costUsd: 0, toolCalls: [] },
    };
  }
  const result = await processInboundMessage(opts);
  if (eventId) await completeEvent(eventId);
  return result;
}

async function processInboundMessage(opts: {
  tenantId: string;
  tenant: Tenant;
  callerPhone: string;
  body: string;
  channel: 'sms' | 'web_sim';
  messageSid?: string;
  conversationId?: string;
}): Promise<ReplyResult> {
  const { tenantId, tenant, callerPhone, body, channel } = opts;
  const store = getStore();
  const usage = { inTokens: 0, outTokens: 0, costUsd: 0, toolCalls: [] as string[] };

  const conversation = opts.conversationId
    ? await store.get<Conversation>(convPath(tenantId), opts.conversationId)
    : await findOrCreateConversation({
        tenantId,
        callerPhone,
        channel,
        source: channel === 'web_sim' ? 'demo' : 'inbound_sms',
      });
  if (!conversation) throw new Error('conversation not found');
  const conversationId = conversation.id;

  await addMessage(
    tenantId,
    conversationId,
    { role: 'caller', body, createdAt: nowIso() },
    opts.messageSid ? `in_${opts.messageSid}` : undefined,
  );

  const send = async (reply: string): Promise<void> => {
    if (channel === 'sms') {
      const sent = await sendSms({ to: callerPhone, from: tenant.twilioNumber, body: reply, tenantId });
      await store.increment(convPath(tenantId), conversationId, 'smsSegmentsUsed', sent.segments);
    }
    await addMessage(tenantId, conversationId, { role: 'assistant', body: reply, createdAt: nowIso() });
    await store.increment(convPath(tenantId), conversationId, 'turnCount', 1);
    await store.merge(convPath(tenantId), conversationId, { lastMessageAt: nowIso() });
  };

  // ── Deterministic compliance handling BEFORE any LLM call ──────────────────
  const keyword = checkInboundKeywords(body);
  if (keyword === 'stop') {
    await recordOptOut(tenantId, callerPhone);
    await store.merge(convPath(tenantId), conversationId, { status: 'opted_out' });
    await releaseActiveConversation(tenantId, callerPhone);
    const ack = stopAckText(tenant);
    if (channel === 'sms') {
      await sendSms({ to: callerPhone, from: tenant.twilioNumber, body: ack, tenantId });
    }
    await addMessage(tenantId, conversationId, { role: 'system', body: `Opt-out recorded. Ack: ${ack}`, createdAt: nowIso() });
    return { reply: ack, conversationId, guardrail: 'opt_out', usage };
  }
  if (keyword === 'help') {
    const help = helpText(tenant);
    await send(help);
    return { reply: help, conversationId, guardrail: 'help', usage };
  }
  if (body.trim().toLowerCase() === 'start') {
    await clearOptOut(tenantId, callerPhone);
  }

  // Blocklist is per caller — a new conversation must not resurrect an opt-out.
  if (await isOptedOut(tenantId, callerPhone)) {
    await store.merge(convPath(tenantId), conversationId, { status: 'opted_out' });
    await releaseActiveConversation(tenantId, callerPhone);
    return { reply: null, conversationId, guardrail: 'opted_out', usage };
  }

  if (conversation.status === 'owner_takeover') {
    return { reply: null, conversationId, guardrail: 'owner_takeover', usage };
  }
  if (conversation.status === 'opted_out') {
    return { reply: null, conversationId, guardrail: 'opted_out', usage };
  }
  if (isOverTurnCap(conversation, tenant)) {
    await store.merge(convPath(tenantId), conversationId, { status: 'escalated' });
    await send(TURN_CAP_MESSAGE);
    return { reply: TURN_CAP_MESSAGE, conversationId, guardrail: 'turn_cap', usage };
  }
  if (channel === 'sms' && (await isOverDailyBudget(tenantId, tenant))) {
    return { reply: null, conversationId, guardrail: 'daily_budget', usage };
  }

  // ── Gemini tool loop (bounded by iterations AND wall clock) ────────────────
  // History: the LATEST 60 messages (ascending order restored after the cut).
  const historyDesc = await store.query<Message>(msgPath(tenantId, conversationId), {
    orderBy: ['seq', 'desc'],
    limit: 60,
  });
  const contents = messagesToContents(historyDesc.reverse());
  const system = buildSystemPrompt(tenant, new Date());
  const toolCtx: ToolContext = { tenantId, tenant, conversationId, conversation };
  const deadline = Date.now() + TOOL_LOOP_DEADLINE_MS;

  let booked: ReplyResult['booked'];
  let finalReply = '';
  let llmFailed = false;
  for (let i = 0; i < MAX_TOOL_ITERATIONS && Date.now() < deadline; i++) {
    let res;
    try {
      res = await generate({
        model: 'flash',
        system,
        contents,
        tools: TOOL_DECLARATIONS,
        mockKind: 'receptionist',
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(JSON.stringify({ severity: 'error', msg: 'gemini turn failed', conversationId, err: String(err) }));
      llmFailed = true;
      break;
    }
    usage.inTokens += res.usage.inTokens;
    usage.outTokens += res.usage.outTokens;
    usage.costUsd += res.usage.costUsd;

    if (res.functionCalls.length === 0) {
      finalReply = res.text.trim();
      break;
    }
    for (const fc of res.functionCalls) {
      usage.toolCalls.push(fc.name);
      const outcome = await executeTool(fc.name, fc.args, toolCtx);
      if (outcome.booked) booked = outcome.booked;
      contents.push({ role: 'model', parts: [{ functionCall: { name: fc.name, args: fc.args } }] });
      contents.push({
        role: 'user',
        parts: [{ functionResponse: { name: fc.name, response: outcome.response } }],
      });
      await addMessage(tenantId, conversationId, {
        role: 'system',
        body: `${TOOL_CALL_PREFIX}${JSON.stringify({ name: fc.name, args: fc.args })}`,
        createdAt: nowIso(),
      });
      await addMessage(tenantId, conversationId, {
        role: 'system',
        body: `${TOOL_RESULT_PREFIX}${JSON.stringify({ name: fc.name, response: outcome.response })}`,
        createdAt: nowIso(),
      });
    }
  }

  let guardrail: string | undefined;
  if (!finalReply) {
    if (booked) {
      finalReply = `You're booked: ${booked.service}, ${booked.label}. See you then! Reply here if you need to change anything.`;
    } else {
      // The promise in the fallback text must be enforced: escalate + alert owner.
      finalReply = 'Let me get the owner to follow up with you directly — thanks for your patience!';
      guardrail = llmFailed ? 'llm_failure_escalated' : 'loop_exhausted_escalated';
      await store.merge(convPath(tenantId), conversationId, { status: 'escalated' });
      await notifyOwner(
        tenant,
        tenantId,
        `RingBack: ${maskPhone(callerPhone)} needs a human follow-up (assistant hit its limit). Open the dashboard to reply.`,
      );
    }
  }

  // Post-generation guardrail: no invented prices.
  const priceCheck = checkPrices(finalReply, tenant);
  if (priceCheck.flagged) {
    await store.add('guardrail_flags', {
      tenantId,
      conversationId,
      kind: 'price_invention',
      flaggedAmounts: priceCheck.flaggedAmounts,
      original: finalReply,
      createdAt: nowIso(),
    });
    finalReply = priceCheck.reply;
    guardrail = 'price_invention';
  }

  await send(finalReply);
  return { reply: finalReply, conversationId, booked, guardrail, usage };
}
