import type { FastifyInstance } from 'fastify';
import type Stripe from 'stripe';
import type { Tenant } from '../types.js';
import { constructWebhookEvent, planForPrice, stripeConfigured } from '../lib/stripe.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { claimEvent, completeEvent } from '../lib/events.js';
import { sendSms } from '../lib/twilio.js';
import { cfg } from '../config.js';
import { runOnboarding } from '../agents/onboarding.js';

/**
 * Stripe webhook. Registered as its own plugin scope so we can keep the RAW
 * body (required for signature verification) without affecting other routes.
 */
export function registerStripeRoutes(app: FastifyInstance): void {
  app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
      done(null, body);
    });

    scope.post('/webhooks/stripe', async (req, reply) => {
      if (!stripeConfigured()) return reply.code(503).send({ error: 'stripe not configured' });

      let event: Stripe.Event;
      try {
        event = constructWebhookEvent(
          req.body as Buffer,
          String(req.headers['stripe-signature'] ?? ''),
        );
      } catch {
        return reply.code(400).send({ error: 'invalid signature' });
      }

      const store = getStore();
      // Two-phase idempotency: the marker only flips to done AFTER successful
      // processing, so a mid-work crash lets Stripe's retry re-run it (C4).
      const eventKey = `stripe_${event.id}`;
      if (!(await claimEvent(eventKey, 5 * 60_000))) {
        return { received: true, duplicate: true };
      }

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const email = session.customer_details?.email ?? session.customer_email;
          if (!email) break;
          const onboarding = await runOnboarding({
            businessName: session.metadata?.businessName ?? 'New business',
            email,
            website: session.metadata?.website || undefined,
            plan: (session.metadata?.plan as 'starter' | 'pro' | undefined) ?? 'founding',
            stripeCustomerId: typeof session.customer === 'string' ? session.customer : undefined,
            stripeSubId:
              typeof session.subscription === 'string' ? session.subscription : undefined,
          });
          if (onboarding.status === 'failed') {
            // A charged customer with no service is a page-the-founder event.
            // 5xx → Stripe retries; marker stays 'processing' so the retry re-runs.
            if (cfg.FOUNDER_PHONE) {
              await sendSms({
                to: cfg.FOUNDER_PHONE,
                body: `RingBack URGENT: onboarding FAILED for paid checkout (${email}). Run ${onboarding.runId}. Stripe will retry.`,
              }).catch(() => undefined);
            }
            return reply.code(500).send({ error: 'onboarding failed — will retry' });
          }
          break;
        }
        case 'customer.subscription.updated':
        case 'customer.subscription.deleted': {
          const sub = event.data.object;
          const rows = await store.query<Tenant>('tenants', {
            where: [['billing.stripeSubId', '==', sub.id]],
            limit: 1,
          });
          const tenant = rows[0];
          if (!tenant) break;
          const priceId = sub.items.data[0]?.price?.id ?? '';
          const churned = event.type === 'customer.subscription.deleted' || sub.status === 'canceled';
          await store.merge('tenants', tenant.id, {
            'billing.status': churned ? 'canceled' : sub.status,
            'billing.plan': planForPrice(priceId),
            ...(churned ? { status: 'churned', churnedAt: nowIso() } : {}),
          });
          break;
        }
        case 'invoice.paid':
        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          // Payment trail — revenue evidence for the CFO agent and judges.
          await store.add('payments', {
            stripeInvoiceId: invoice.id,
            customerId: typeof invoice.customer === 'string' ? invoice.customer : null,
            amountUsd: (invoice.amount_paid ?? invoice.amount_due ?? 0) / 100,
            status: event.type === 'invoice.paid' ? 'paid' : 'failed',
            createdAt: nowIso(),
          });
          break;
        }
        default:
          break;
      }
      await completeEvent(eventKey);
      return { received: true };
    });
  });
}
