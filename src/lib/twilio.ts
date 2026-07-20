import twilio from 'twilio';
import { cfg, twilioMock } from '../config.js';
import { getStore } from './store.js';
import { nowIso } from './time.js';

/** Approximate cost per outbound SMS segment (US long code / toll-free). */
export const SMS_SEGMENT_COST_USD = 0.0079;

let client: twilio.Twilio | null = null;
function getClient(): twilio.Twilio {
  if (!client) client = twilio(cfg.TWILIO_ACCOUNT_SID, cfg.TWILIO_AUTH_TOKEN);
  return client;
}

export function segmentCount(body: string): number {
  // GSM-7: 160 chars single segment, 153 per segment when concatenated.
  const len = body.length;
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
    const msg = await getClient().messages.create({
      to: opts.to,
      body: opts.body,
      ...(cfg.TWILIO_MESSAGING_SERVICE_SID
        ? { messagingServiceSid: cfg.TWILIO_MESSAGING_SERVICE_SID }
        : { from: opts.from }),
    });
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
