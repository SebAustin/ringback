import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Tenant } from '../types.js';
import { cfg } from '../config.js';
import { getStore, type WithId } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import {
  maskPhone,
  twimlDial,
  twimlEmpty,
  twimlMissedCall,
  validateTwilioSignature,
} from '../lib/twilio.js';
import { handleInboundMessage, startMissedCallConversation } from '../receptionist/conversation.js';
import { runAgent } from '../agents/runner.js';

type TwilioParams = Record<string, string>;

function params(req: FastifyRequest): TwilioParams {
  return (req.body ?? {}) as TwilioParams;
}

function verified(req: FastifyRequest): boolean {
  const url = `${cfg.APP_BASE_URL}${req.raw.url ?? req.url}`;
  return validateTwilioSignature(url, params(req), req.headers['x-twilio-signature'] as string | undefined);
}

async function tenantByNumber(to: string | undefined): Promise<WithId<Tenant> | null> {
  if (!to) return null;
  const rows = await getStore().query<Tenant>('tenants', {
    where: [['twilioNumber', '==', to]],
    limit: 1,
  });
  return rows[0] ?? null;
}

export function registerTwilioRoutes(app: FastifyInstance): void {
  // Inbound call → forward to the owner; the action callback tells us the outcome.
  app.post('/webhooks/twilio/voice', async (req, reply) => {
    if (!verified(req)) return reply.code(403).send('invalid signature');
    const p = params(req);
    const tenant = await tenantByNumber(p.To);
    reply.type('text/xml');
    if (!tenant) return twimlEmpty();
    if (!tenant.forwardPhone || tenant.status !== 'live') {
      // No forwarding target — treat every call as missed, textback immediately.
      void fireMissedCall(tenant, p);
      return twimlMissedCall(tenant.name);
    }
    return twimlDial(tenant.forwardPhone, `${cfg.APP_BASE_URL}/webhooks/twilio/voice/status`);
  });

  // <Dial> outcome. Anything except "completed" is a missed call → textback.
  app.post('/webhooks/twilio/voice/status', async (req, reply) => {
    if (!verified(req)) return reply.code(403).send('invalid signature');
    const p = params(req);
    const tenant = await tenantByNumber(p.To);
    reply.type('text/xml');
    if (!tenant) return twimlEmpty();
    if (p.DialCallStatus === 'completed') return twimlEmpty();
    void fireMissedCall(tenant, p);
    return twimlMissedCall(tenant.name);
  });

  // Inbound SMS → the receptionist agent takes the turn.
  app.post('/webhooks/twilio/sms', async (req, reply) => {
    if (!verified(req)) return reply.code(403).send('invalid signature');
    const p = params(req);
    const tenant = await tenantByNumber(p.To);
    reply.type('text/xml');
    if (!tenant || !p.From || !p.Body) return twimlEmpty();

    await runAgent(
      'receptionist',
      { type: 'webhook', detail: 'twilio:sms' },
      tenant.id,
      async (ctx) => {
        const result = await handleInboundMessage({
          tenantId: tenant.id,
          tenant,
          callerPhone: p.From!,
          body: p.Body!.slice(0, 1600),
          channel: 'sms',
          messageSid: p.MessageSid,
        });
        ctx.addCost('gemini', result.usage.costUsd);
        await ctx.log('turn', {
          result: JSON.stringify({
            guardrail: result.guardrail ?? null,
            toolCalls: result.usage.toolCalls,
            booked: result.booked ?? null,
          }),
        });
        const outcome = result.booked
          ? `booked ${result.booked.service}`
          : (result.guardrail ?? 'replied');
        return `Receptionist handled SMS from ${maskPhone(p.From!)} for ${tenant.name}: ${outcome}.`;
      },
    );
    return twimlEmpty();
  });

  // Delivery receipts — recorded for the watchdog's error-rate checks.
  app.post('/webhooks/twilio/sms/status', async (req, reply) => {
    if (!verified(req)) return reply.code(403).send('invalid signature');
    const p = params(req);
    if (p.MessageSid) {
      await getStore().set('sms_status', p.MessageSid, {
        status: p.MessageStatus ?? 'unknown',
        errorCode: p.ErrorCode ?? null,
        updatedAt: nowIso(),
      });
    }
    return reply.code(204).send();
  });
}

async function fireMissedCall(tenant: WithId<Tenant>, p: TwilioParams): Promise<void> {
  if (!p.From || !p.CallSid) return;
  await runAgent(
    'receptionist',
    { type: 'webhook', detail: 'twilio:missed-call' },
    tenant.id,
    async (ctx) => {
      const result = await startMissedCallConversation({
        tenantId: tenant.id,
        tenant,
        callerPhone: p.From!,
        callSid: p.CallSid!,
      });
      await ctx.log('textback', { result: JSON.stringify(result) });
      return result.skipped
        ? `Missed call from ${maskPhone(p.From!)} for ${tenant.name}: skipped (${result.skipped}).`
        : `Missed call from ${maskPhone(p.From!)} for ${tenant.name}: textback sent within seconds.`;
    },
  );
}
