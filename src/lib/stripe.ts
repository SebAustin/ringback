import Stripe from 'stripe';
import { cfg } from '../config.js';

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (!client) {
    if (!cfg.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not configured');
    client = new Stripe(cfg.STRIPE_SECRET_KEY, { timeout: 8000, maxNetworkRetries: 1 });
  }
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(cfg.STRIPE_SECRET_KEY && cfg.STRIPE_WEBHOOK_SECRET);
}

/** Verify + parse a Stripe webhook from the raw request body. */
export function constructWebhookEvent(rawBody: string | Buffer, signature: string): Stripe.Event {
  return getStripe().webhooks.constructEvent(rawBody, signature, cfg.STRIPE_WEBHOOK_SECRET);
}

export function planForPrice(priceId: string): 'starter' | 'pro' | 'founding' {
  if (priceId === cfg.STRIPE_PRICE_PRO) return 'pro';
  if (priceId === cfg.STRIPE_PRICE_STARTER) return 'starter';
  return 'founding';
}

export const PLAN_PRICES_USD: Record<'starter' | 'pro' | 'founding', number> = {
  starter: 49,
  pro: 99,
  founding: 1,
};

export async function createCheckoutSession(opts: {
  priceId: string;
  customerEmail: string;
  metadata: Record<string, string>;
}): Promise<{ url: string }> {
  const session = await getStripe().checkout.sessions.create({
    mode: 'subscription',
    line_items: [{ price: opts.priceId, quantity: 1 }],
    customer_email: opts.customerEmail,
    metadata: opts.metadata,
    success_url: `${cfg.APP_BASE_URL}/welcome?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${cfg.APP_BASE_URL}/`,
    allow_promotion_codes: true,
  });
  if (!session.url) throw new Error('Stripe did not return a checkout URL');
  return { url: session.url };
}

export async function createPortalSession(customerId: string): Promise<{ url: string }> {
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${cfg.APP_BASE_URL}/dashboard`,
  });
  return { url: session.url };
}
