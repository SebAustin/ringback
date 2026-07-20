import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { Appointment, Conversation, Message, Tenant } from '../types.js';
import { cfg } from '../config.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { sendEmail } from '../lib/email.js';
import { sendSms } from '../lib/twilio.js';
import {
  SESSION_COOKIE,
  createMagicToken,
  createSessionCookie,
  getSessionUser,
  verifyMagicToken,
  type SessionUser,
} from '../lib/auth.js';
import { createCheckoutSession, createPortalSession, stripeConfigured } from '../lib/stripe.js';

function requireUser(req: FastifyRequest, reply: FastifyReply): SessionUser | null {
  const user = getSessionUser(req);
  if (!user) {
    reply.code(401).send({ error: 'login required' });
    return null;
  }
  return user;
}

async function requireTenant(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ user: SessionUser; tenantId: string; tenant: Tenant } | null> {
  const user = requireUser(req, reply);
  if (!user) return null;
  const tenantId = user.tenantId ?? (user.role === 'founder' ? cfg.DEMO_TENANT_ID : undefined);
  if (!tenantId) {
    reply.code(404).send({ error: 'no tenant for this account' });
    return null;
  }
  const tenant = await getStore().get<Tenant>('tenants', tenantId);
  if (!tenant) {
    reply.code(404).send({ error: 'tenant not found' });
    return null;
  }
  return { user, tenantId, tenant };
}

const ProfileSchema = z
  .object({
    services: z
      .array(
        z.object({
          name: z.string().min(1).max(120),
          durationMin: z.number().int().min(5).max(480),
          price: z.string().max(20).optional(),
        }),
      )
      .max(20)
      .optional(),
    faqs: z
      .array(z.object({ q: z.string().min(1).max(300), a: z.string().min(1).max(600) }))
      .max(20)
      .optional(),
    hours: z
      .record(
        z.enum(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']),
        z.array(z.tuple([z.string().regex(/^\d{2}:\d{2}$/), z.string().regex(/^\d{2}:\d{2}$/)])),
      )
      .optional(),
    timezone: z.string().max(60).optional(),
    bookingPolicy: z.string().max(500).optional(),
    tone: z.string().max(200).optional(),
  })
  .strict();

const PatchTenantSchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    forwardPhone: z.string().regex(/^\+\d{7,15}$/).optional(),
    ownerPhone: z.string().regex(/^\+\d{7,15}$/).optional(),
    profile: ProfileSchema.optional(),
    goLive: z.boolean().optional(),
  })
  .strict();

export function registerApiRoutes(app: FastifyInstance): void {
  // ── Auth ────────────────────────────────────────────────────────────────────
  app.post('/api/auth/magic-link', {
    config: { rateLimit: { max: 5, timeWindow: '15 minutes' } },
  }, async (req) => {
    const { email } = z.object({ email: z.string().email() }).parse(req.body ?? {});
    const normalized = email.toLowerCase();
    const isKnownFounder = normalized === cfg.FOUNDER_EMAIL.toLowerCase();
    const tenants = await getStore().query<Tenant>('tenants', {
      where: [['ownerEmail', '==', normalized]],
      limit: 1,
    });
    // Only send when the account exists — but always return ok (no user enumeration).
    if (isKnownFounder || tenants[0]) {
      const token = createMagicToken(normalized);
      await sendEmail({
        to: normalized,
        subject: 'Your RingBack login link',
        text: `Click to log in (valid 15 minutes):\n${cfg.APP_BASE_URL}/api/auth/callback?token=${token}\n\nIf you didn't request this, ignore it.`,
      });
    }
    return { ok: true };
  });

  app.get('/api/auth/callback', async (req, reply) => {
    const token = (req.query as { token?: string }).token ?? '';
    const verifiedMagic = verifyMagicToken(token);
    if (!verifiedMagic) return reply.redirect('/login?error=expired');
    // Single-use: burn the token id; replays bounce.
    const firstUse = await getStore().createIfAbsent('used_tokens', verifiedMagic.jti, {
      email: verifiedMagic.email,
      usedAt: nowIso(),
    });
    if (!firstUse) return reply.redirect('/login?error=expired');
    const email = verifiedMagic.email;

    let user: SessionUser;
    if (email === cfg.FOUNDER_EMAIL.toLowerCase()) {
      user = { email, role: 'founder' };
    } else {
      const tenants = await getStore().query<Tenant>('tenants', {
        where: [['ownerEmail', '==', email]],
        orderBy: ['createdAt', 'desc'],
        limit: 1,
      });
      if (!tenants[0]) return reply.redirect('/login?error=unknown');
      user = { email, role: 'owner', tenantId: tenants[0].id };
    }
    reply.setCookie(SESSION_COOKIE, createSessionCookie(user), {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: cfg.APP_BASE_URL.startsWith('https'),
      maxAge: 7 * 24 * 3600,
    });
    return reply.redirect(user.role === 'founder' ? '/ops' : '/dashboard');
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/me', async (req, reply) => {
    const user = requireUser(req, reply);
    if (!user) return;
    return user;
  });

  // ── Tenant ─────────────────────────────────────────────────────────────────
  app.get('/api/tenant', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const { billing, ...safe } = ctx.tenant as Tenant & { id?: string };
    return { id: ctx.tenantId, ...safe, plan: billing.plan ?? null };
  });

  app.patch('/api/tenant', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const parsed = PatchTenantSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues[0]?.message });
    const { goLive, profile, ...rest } = parsed.data;

    const update: Record<string, unknown> = { ...rest };
    if (profile) {
      update.profile = { ...ctx.tenant.profile, ...profile };
    }
    if (goLive && ctx.tenant.status === 'pending_review') {
      update.status = 'live';
    }
    await getStore().merge('tenants', ctx.tenantId, update);
    const updated = await getStore().get<Tenant>('tenants', ctx.tenantId);
    return { id: ctx.tenantId, ...updated };
  });

  // ── Conversations ──────────────────────────────────────────────────────────
  app.get('/api/conversations', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const limit = Math.min(Number((req.query as { limit?: string }).limit) || 50, 200);
    const conversations = await getStore().query<Conversation>(
      `tenants/${ctx.tenantId}/conversations`,
      { orderBy: ['lastMessageAt', 'desc'], limit },
    );
    return { conversations };
  });

  app.get('/api/conversations/:id', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const { id } = req.params as { id: string };
    const conversation = await getStore().get<Conversation>(
      `tenants/${ctx.tenantId}/conversations`,
      id,
    );
    if (!conversation) return reply.code(404).send({ error: 'not found' });
    const messages = await getStore().query<Message>(
      `tenants/${ctx.tenantId}/conversations/${id}/messages`,
      { orderBy: ['createdAt', 'asc'], limit: 200 },
    );
    return { conversation, messages };
  });

  app.post('/api/conversations/:id/takeover', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const { id } = req.params as { id: string };
    const { body } = z.object({ body: z.string().min(1).max(1000) }).parse(req.body ?? {});
    const convPath = `tenants/${ctx.tenantId}/conversations`;
    const conversation = await getStore().get<Conversation>(convPath, id);
    if (!conversation) return reply.code(404).send({ error: 'not found' });
    if (conversation.status === 'opted_out') {
      return reply.code(400).send({ error: 'caller opted out — no further messages allowed' });
    }
    if (conversation.channel === 'sms') {
      await sendSms({
        to: conversation.callerPhone,
        from: ctx.tenant.twilioNumber,
        body,
        tenantId: ctx.tenantId,
      });
    }
    await getStore().add(`${convPath}/${id}/messages`, {
      role: 'owner',
      body,
      createdAt: nowIso(),
    });
    await getStore().merge(convPath, id, { status: 'owner_takeover', lastMessageAt: nowIso() });
    return { ok: true };
  });

  app.post('/api/conversations/:id/resume', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const { id } = req.params as { id: string };
    const convPath = `tenants/${ctx.tenantId}/conversations`;
    const conversation = await getStore().get<Conversation>(convPath, id);
    if (!conversation) return reply.code(404).send({ error: 'not found' });
    if (conversation.status !== 'owner_takeover') {
      return reply.code(400).send({ error: 'conversation is not in takeover' });
    }
    await getStore().merge(convPath, id, { status: 'active' });
    return { ok: true };
  });

  app.get('/api/appointments', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const appointments = await getStore().query<Appointment>(
      `tenants/${ctx.tenantId}/appointments`,
      { orderBy: ['startsAt', 'asc'], limit: 100 },
    );
    return { appointments };
  });

  // ── Billing / checkout ─────────────────────────────────────────────────────
  app.post('/api/checkout', {
    config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    if (!stripeConfigured()) {
      return reply.code(503).send({ error: 'Checkout is not live yet — email us and we will onboard you by hand.' });
    }
    const parsed = z
      .object({
        plan: z.enum(['starter', 'pro']),
        email: z.string().email(),
        businessName: z.string().min(1).max(120),
        website: z.string().max(300).optional(),
      })
      .safeParse(req.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid input' });
    const { plan, email, businessName, website } = parsed.data;
    const priceId = plan === 'pro' ? cfg.STRIPE_PRICE_PRO : cfg.STRIPE_PRICE_STARTER;
    if (!priceId) return reply.code(503).send({ error: 'plan not configured' });
    return createCheckoutSession({
      priceId,
      customerEmail: email,
      metadata: { businessName, website: website ?? '', plan },
    });
  });

  app.post('/api/billing/portal', async (req, reply) => {
    const ctx = await requireTenant(req, reply);
    if (!ctx) return;
    const customerId = ctx.tenant.billing.stripeCustomerId;
    if (!customerId || !stripeConfigured()) {
      return reply.code(400).send({ error: 'no billing on file' });
    }
    return createPortalSession(customerId);
  });
}
