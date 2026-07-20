import type { Tenant, TenantProfile } from '../types.js';
import { getStore } from '../lib/store.js';
import { nowIso } from '../lib/time.js';
import { parseJson } from '../lib/gemini.js';
import { buyNumber } from '../lib/twilio.js';
import { sendEmail } from '../lib/email.js';
import { createMagicToken } from '../lib/auth.js';
import { cfg } from '../config.js';
import { runAgent } from './runner.js';

const DEFAULT_HOURS = {
  mon: [['09:00', '17:00']],
  tue: [['09:00', '17:00']],
  wed: [['09:00', '17:00']],
  thu: [['09:00', '17:00']],
  fri: [['09:00', '17:00']],
} as TenantProfile['hours'];

const PRIVATE_HOST_RE =
  /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?|172\.(1[6-9]|2\d|3[01])\.)/i;

async function fetchWebsiteText(url: string): Promise<string> {
  try {
    const target = new URL(url.startsWith('http') ? url : `https://${url}`);
    // SSRF guard: public http(s) hosts only — never internal/metadata ranges.
    if (!['http:', 'https:'].includes(target.protocol)) return '';
    if (PRIVATE_HOST_RE.test(target.hostname) || target.hostname === 'metadata.google.internal') {
      return '';
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(target, {
      signal: controller.signal,
      redirect: 'error',
      headers: { 'User-Agent': 'RingBackOnboarding/1.0' },
    });
    clearTimeout(timer);
    if (!res.ok) return '';
    const html = await res.text();
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .slice(0, 6000);
  } catch {
    return '';
  }
}

export interface CheckoutInfo {
  businessName: string;
  email: string;
  website?: string;
  plan: 'starter' | 'pro' | 'founding';
  stripeCustomerId?: string;
  stripeSubId?: string;
}

/**
 * Fires on Stripe checkout completion: provisions the tenant end-to-end
 * (number, AI-drafted profile, welcome email). The tenant goes live only
 * after the owner reviews the drafted profile (`pending_review` gate).
 */
export async function runOnboarding(info: CheckoutInfo): Promise<{ runId: string; tenantId: string | null }> {
  let tenantId: string | null = null;
  const result = await runAgent(
    'onboarding',
    { type: 'webhook', detail: 'stripe:checkout.session.completed' },
    undefined,
    async (ctx) => {
      const store = getStore();

      // Idempotency: one tenant per Stripe subscription.
      if (info.stripeSubId) {
        const existing = await store.query<Tenant>('tenants', {
          where: [['billing.stripeSubId', '==', info.stripeSubId]],
          limit: 1,
        });
        if (existing[0]) {
          tenantId = existing[0].id;
          return `Onboarding skipped — tenant already provisioned for this subscription (${existing[0].name}).`;
        }
      }

      const number = await buyNumber();
      await ctx.action('provision_twilio_number', { phoneNumber: number.phoneNumber }, {
        execute: async () => undefined,
      });

      let profile: TenantProfile = {
        services: [],
        faqs: [],
        hours: DEFAULT_HOURS,
        timezone: 'America/New_York',
        tone: 'warm, brief, professional',
        website: info.website,
      };

      if (info.website) {
        const siteText = await fetchWebsiteText(info.website);
        if (siteText) {
          const res = await ctx.gemini({
            model: 'flash',
            system:
              'Extract a business profile from this website text for an SMS receptionist. Respond as JSON: {"services":[{"name":"...","durationMin":30,"price":"$45"}],"faqs":[{"q":"...","a":"..."}],"tone":"..."} — include prices ONLY if explicitly stated on the site.',
            contents: [{ role: 'user', parts: [{ text: siteText }] }],
            mockKind: 'profile',
            stepName: 'draft-profile-from-website',
          });
          const drafted = parseJson<Partial<TenantProfile>>(res.text);
          if (drafted) {
            profile = {
              ...profile,
              services: (drafted.services ?? []).slice(0, 12),
              faqs: (drafted.faqs ?? []).slice(0, 12),
              tone: drafted.tone ?? profile.tone,
            };
          }
        }
      }

      const tenant: Tenant = {
        name: info.businessName,
        ownerName: '',
        ownerEmail: info.email,
        ownerPhone: '',
        twilioNumber: number.phoneNumber,
        twilioNumberSid: number.sid,
        status: 'pending_review',
        profile,
        limits: { dailySmsSegments: 200, maxTurns: 20 },
        billing: {
          stripeCustomerId: info.stripeCustomerId,
          stripeSubId: info.stripeSubId,
          plan: info.plan,
          status: 'active',
        },
        createdAt: nowIso(),
        onboardedByAgentRunId: ctx.runId,
      };
      tenantId = await store.add('tenants', tenant);

      const magic = createMagicToken(info.email);
      await ctx.action('send_welcome_email', { to: info.email }, {
        execute: async () => {
          await sendEmail({
            to: info.email,
            subject: `Welcome to RingBack — your AI receptionist is almost live`,
            text: `Hi!\n\nYour RingBack number is ${number.phoneNumber}.\n\nI read your website and pre-filled your services, FAQs and hours — please review them before we go live (this takes ~3 minutes):\n${cfg.APP_BASE_URL}/api/auth/callback?token=${magic}\n\nOnce you confirm, forward your business line to ${number.phoneNumber} (or set it as your conditional call-forward target) and every missed call gets texted back within seconds.\n\n— RingBack's onboarding agent (yes, an AI wrote and executed this onboarding — a human reviews everything you flag)`,
          });
        },
      });

      return `Onboarded "${info.businessName}" (${info.plan}): number ${number.phoneNumber} provisioned, profile drafted from ${info.website ? 'website' : 'defaults'}, welcome email sent. Awaiting owner review.`;
    },
  );
  return { runId: result.runId, tenantId };
}

/** Daily check-ins: day-3 nudge to unconfigured tenants, day-7 testimonial ask. */
export async function runOnboardingCheckins(triggerDetail: string): Promise<{ runId: string; summary: string }> {
  const result = await runAgent('onboarding', { type: 'cron', detail: triggerDetail }, undefined, async (ctx) => {
    const store = getStore();
    const tenants = await store.query<Tenant & { day3SentAt?: string; day7SentAt?: string }>('tenants', {});
    let sent = 0;
    for (const t of tenants) {
      const ageDays = (Date.now() - new Date(t.createdAt).getTime()) / 86_400_000;
      if (ageDays >= 3 && !t.day3SentAt && t.status === 'pending_review') {
        const magic = createMagicToken(t.ownerEmail);
        await sendEmail({
          to: t.ownerEmail,
          subject: `${t.name}: 3 minutes to switch on your AI receptionist`,
          text: `Your RingBack setup is waiting for a quick review of your services and hours. Confirm here and you're live:\n${cfg.APP_BASE_URL}/api/auth/callback?token=${magic}\n\nStuck? Just reply to this email — our support agent answers in minutes.`,
        });
        await store.merge('tenants', t.id, { day3SentAt: nowIso() });
        sent++;
        await ctx.log('day3-nudge', { result: t.name });
      } else if (ageDays >= 7 && !t.day7SentAt && t.status === 'live') {
        await sendEmail({
          to: t.ownerEmail,
          subject: `How's RingBack working for ${t.name}?`,
          text: `Quick check-in from RingBack's onboarding agent: how are the texted-back calls going?\n\nIf it's been useful, would you reply with one or two sentences we can quote? Real words from real owners help us more than anything.\n\nAnd if anything is off — reply and a human will jump in.`,
        });
        await store.merge('tenants', t.id, { day7SentAt: nowIso() });
        sent++;
        await ctx.log('day7-checkin', { result: t.name });
      }
    }
    return `Onboarding check-ins: ${sent} emails sent across ${tenants.length} tenants.`;
  });
  return { runId: result.runId, summary: result.summary };
}
