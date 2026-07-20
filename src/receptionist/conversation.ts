import type { Content } from '@google/genai';
import type { Conversation, Message, Tenant } from '../types.js';
import { getStore, type WithId } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { generate } from '../lib/gemini.js';
import { maskPhone, sendSms } from '../lib/twilio.js';
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

function convPath(tenantId: string): string {
  return `tenants/${tenantId}/conversations`;
}
function msgPath(tenantId: string, conversationId: string): string {
  return `${convPath(tenantId)}/${conversationId}/messages`;
}

async function addMessage(
  tenantId: string,
  conversationId: string,
  msg: Message,
  fixedId?: string,
): Promise<boolean> {
  const store = getStore();
  if (fixedId) return store.createIfAbsent(msgPath(tenantId, conversationId), fixedId, msg);
  await store.add(msgPath(tenantId, conversationId), msg);
  return true;
}

/** Rebuild Gemini `contents` from persisted messages (incl. tool call pairs). */
function messagesToContents(messages: WithId<Message>[]): Content[] {
  const contents: Content[] = [];
  for (const m of messages) {
    if (m.role === 'caller') {
      contents.push({ role: 'user', parts: [{ text: m.body }] });
    } else if (m.role === 'assistant' || m.role === 'owner') {
      contents.push({ role: 'model', parts: [{ text: m.body }] });
    } else if (m.role === 'system' && m.body.startsWith(TOOL_CALL_PREFIX)) {
      const { name, args } = JSON.parse(m.body.slice(TOOL_CALL_PREFIX.length));
      contents.push({ role: 'model', parts: [{ functionCall: { name, args } }] });
    } else if (m.role === 'system' && m.body.startsWith(TOOL_RESULT_PREFIX)) {
      const { name, response } = JSON.parse(m.body.slice(TOOL_RESULT_PREFIX.length));
      contents.push({ role: 'user', parts: [{ functionResponse: { name, response } }] });
    }
  }
  return contents;
}

export async function findOrCreateConversation(opts: {
  tenantId: string;
  callerPhone: string;
  channel: 'sms' | 'web_sim';
  source: Conversation['source'];
  missedCallSid?: string;
}): Promise<WithId<Conversation>> {
  const store = getStore();
  const existing = await store.query<Conversation>(convPath(opts.tenantId), {
    where: [
      ['callerPhone', '==', opts.callerPhone],
      ['status', 'in', ['active', 'escalated', 'owner_takeover']],
    ],
    orderBy: ['lastMessageAt', 'desc'],
    limit: 1,
  });
  if (existing[0]) return existing[0];

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
  return { ...conversation, id };
}

/** Missed call → create conversation + instant textback + owner alert. */
export async function startMissedCallConversation(opts: {
  tenantId: string;
  tenant: Tenant;
  callerPhone: string;
  callSid: string;
}): Promise<{ conversationId: string | null; skipped?: string }> {
  const { tenantId, tenant, callerPhone, callSid } = opts;
  const store = getStore();
  const t0 = Date.now();

  // Idempotency: one conversation per CallSid, even if Twilio retries.
  const dedupeCreated = await store.createIfAbsent('events', `call_${callSid}`, {
    type: 'missed_call',
    tenantId,
    createdAt: nowIso(),
  });
  if (!dedupeCreated) return { conversationId: null, skipped: 'duplicate_webhook' };

  if (await isOptedOut(tenantId, callerPhone)) {
    return { conversationId: null, skipped: 'opted_out' };
  }
  if (await isOverDailyBudget(tenantId, tenant)) {
    return { conversationId: null, skipped: 'daily_budget' };
  }

  const conversation = await findOrCreateConversation({
    tenantId,
    callerPhone,
    channel: 'sms',
    source: 'missed_call',
    missedCallSid: callSid,
  });

  const greeting = textbackGreeting(tenant);
  const sent = await sendSms({
    to: callerPhone,
    from: tenant.twilioNumber,
    body: greeting,
    tenantId,
  });
  await addMessage(tenantId, conversation.id, {
    role: 'assistant',
    body: greeting,
    createdAt: nowIso(),
    deliveryStatus: 'sent',
  });
  await store.merge(convPath(tenantId), conversation.id, {
    lastMessageAt: nowIso(),
    smsSegmentsUsed: conversation.smsSegmentsUsed + sent.segments,
    textbackLatencyMs: Date.now() - t0,
  });

  if (tenant.ownerPhone) {
    await sendSms({
      to: tenant.ownerPhone,
      body: ownerMissedCallAlert(tenant, maskPhone(callerPhone)),
      tenantId,
    });
  }
  return { conversationId: conversation.id };
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

  // Idempotency on Twilio webhook retries.
  const stored = await addMessage(
    tenantId,
    conversationId,
    { role: 'caller', body, createdAt: nowIso() },
    opts.messageSid ? `in_${opts.messageSid}` : undefined,
  );
  if (!stored) return { reply: null, conversationId, guardrail: 'duplicate_webhook', usage };

  const send = async (reply: string): Promise<void> => {
    if (channel === 'sms') {
      await sendSms({ to: callerPhone, from: tenant.twilioNumber, body: reply, tenantId });
    }
    await addMessage(tenantId, conversationId, {
      role: 'assistant',
      body: reply,
      createdAt: nowIso(),
    });
    await store.merge(convPath(tenantId), conversationId, {
      lastMessageAt: nowIso(),
      turnCount: conversation.turnCount + 1,
    });
  };

  // ── Deterministic compliance handling BEFORE any LLM call ──────────────────
  const keyword = checkInboundKeywords(body);
  if (keyword === 'stop') {
    await recordOptOut(tenantId, callerPhone);
    await store.merge(convPath(tenantId), conversationId, { status: 'opted_out' });
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

  // ── Gemini tool loop ────────────────────────────────────────────────────────
  const history = await store.query<Message>(msgPath(tenantId, conversationId), {
    orderBy: ['createdAt', 'asc'],
    limit: 60,
  });
  const contents = messagesToContents(history);
  const system = buildSystemPrompt(tenant, new Date());
  const toolCtx: ToolContext = { tenantId, tenant, conversationId, conversation };

  let booked: ReplyResult['booked'];
  let finalReply = '';
  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    const res = await generate({
      model: 'flash',
      system,
      contents,
      tools: TOOL_DECLARATIONS,
      mockKind: 'receptionist',
    });
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

  if (!finalReply) {
    finalReply = booked
      ? `You're booked: ${booked.service}, ${booked.label}. See you then! Reply here if you need to change anything.`
      : 'Let me get the owner to follow up with you directly — thanks for your patience!';
  }

  // Post-generation guardrail: no invented prices.
  const priceCheck = checkPrices(finalReply, tenant);
  if (priceCheck.flagged) {
    await getStore().add('guardrail_flags', {
      tenantId,
      conversationId,
      kind: 'price_invention',
      flaggedAmounts: priceCheck.flaggedAmounts,
      original: finalReply,
      createdAt: nowIso(),
    });
    finalReply = priceCheck.reply;
  }

  await send(finalReply);
  return {
    reply: finalReply,
    conversationId,
    booked,
    guardrail: priceCheck.flagged ? 'price_invention' : undefined,
    usage,
  };
}
