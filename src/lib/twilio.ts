import twilio from 'twilio';
import { cfg, twilioMock } from '../config.js';
import { getStore } from './store.js';
import { nowIso } from './time.js';
import { isRetriable, retryOnce, TimeoutError, withTimeout } from './async.js';

/** Approximate cost per outbound SMS segment (US long code / toll-free). */
export const SMS_SEGMENT_COST_USD = 0.0079;

let client: twilio.Twilio | null = null;
function getClient(): twilio.Twilio {
  if (!client) client = twilio(cfg.TWILIO_ACCOUNT_SID, cfg.TWILIO_AUTH_TOKEN);
  return client;
}

/** Non-ASCII characters that are still GSM-7 (approximation of the GSM charset). */
const GSM_EXTRA = new Set('\u00a3\u00a5\u20ac\u00a7\u00bf\u00a1\u00c4\u00d6\u00d1\u00dc\u00e4\u00f6\u00f1\u00fc\u00e0\u00e8\u00e9\u00ec\u00f2\u00f9\u00df\u00c5\u00e5\u00c6\u00e6\u00d8\u00f8\u00c9');

export function segmentCount(body: string): number {
  const len = body.length;
  // Any character outside GSM-7 (emoji, most non-Latin scripts) switches the
  // whole message to UCS-2: 70 chars single segment, 67 concatenated.
  const isUcs2 = [...body].some((ch) => ch.charCodeAt(0) > 0x7f && !GSM_EXTRA.has(ch));
  if (isUcs2) return len <= 70 ? 1 : Math.ceil(len / 67);
  // GSM-7: 160 chars single segment, 153 per segment when concatenated.
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

export interface SendSmsResult {
  sid: string;
  segments: number;
  costUsd: number;
}

/**
 * Send an SMS. In mock mode (no Twilio credentials) the message is only
 * recorded to the `sms_out` collection so local/demo flows still work.
 */
export async function sendSms(opts: {
  to: string;
  body: string;
  from?: string;
  tenantId?: string;
}): Promise<SendSmsResult> {
  const segments = segmentCount(opts.body);
  const costUsd = segments * SMS_SEGMENT_COST_USD;

  let sid: string;
  if (twilioMock) {
    sid = `SMmock${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;
  } else {
    const msg = await retryOnce(
      () =>
        withTimeout(
          getClient().messages.create({
            to: opts.to,
            body: opts.body,
            ...(cfg.TWILIO_MESSAGING_SERVICE_SID
              ? { messagingServiceSid: cfg.TWILIO_MESSAGING_SERVICE_SID }
              : { from: opts.from }),
          }),
          6_000,
          'twilio:sendSms',
        ),
      'twilio:sendSms',
      // NEVER retry on our own timeout — Twilio may have queued the message and
      // a blind retry double-texts the customer (R3). Retry only explicit 429/5xx.
      (err) => !(err instanceof TimeoutError) && isRetriable(err),
    );
    sid = msg.sid;
  }

  await getStore().add('sms_out', {
    sid,
    to: maskPhone(opts.to),
    tenantId: opts.tenantId ?? null,
    segments,
    costUsd,
    mock: twilioMock,
    createdAt: nowIso(),
  });
  return { sid, segments, costUsd };
}

/** Validate an incoming Twilio webhook signature. Bypassed only in mock mode. */
export function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string | undefined,
): boolean {
  if (twilioMock) return true;
  if (!signature) return false;
  return twilio.validateRequest(cfg.TWILIO_AUTH_TOKEN, signature, url, params);
}

/** Buy a local number (Onboarding agent). Mocked without credentials. */
export async function buyNumber(areaCode?: string): Promise<{ phoneNumber: string; sid: string }> {
  if (twilioMock) {
    const n = `+1555${String(Math.floor(1000000 + Math.random() * 8999999))}`;
    return { phoneNumber: n, sid: `PNmock${Date.now().toString(36)}` };
  }
  const available = await getClient()
    .availablePhoneNumbers('US')
    .local.list({ areaCode: areaCode ? Number(areaCode) : undefined, smsEnabled: true, limit: 1 });
  const first = available[0];
  if (!first) throw new Error('No Twilio numbers available for purchase');
  const purchased = await getClient().incomingPhoneNumbers.create({
    phoneNumber: first.phoneNumber,
    voiceUrl: `${cfg.APP_BASE_URL}/webhooks/twilio/voice`,
    smsUrl: `${cfg.APP_BASE_URL}/webhooks/twilio/sms`,
  });
  return { phoneNumber: purchased.phoneNumber, sid: purchased.sid };
}

export function maskPhone(phone: string): string {
  if (phone.length < 4) return '***';
  return `${phone.slice(0, 2)}***${phone.slice(-4)}`;
}

// ── TwiML builders (plain XML — no heavy builder needed) ─────────────────────

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Forward the call to the owner's phone; report the outcome to `actionUrl`. */
export function twimlDial(forwardPhone: string, actionUrl: string, callerId?: string): string {
  const callerIdAttr = callerId ? ` callerId="${xmlEscape(callerId)}"` : '';
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial timeout="20" action="${xmlEscape(actionUrl)}"${callerIdAttr}>
    <Number>${xmlEscape(forwardPhone)}</Number>
  </Dial>
</Response>`;
}

/** Spoken fallback when the owner does not pick up. */
export function twimlMissedCall(businessName: string): string {
  const msg = `Thanks for calling ${businessName}. We can't pick up right now, but we're texting you as we speak — check your messages and we'll get you booked in.`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">${xmlEscape(msg)}</Say>
  <Hangup/>
</Response>`;
}

export function twimlEmpty(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response/>`;
}
