import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHmac } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { cfg, isProd } from '../config.js';
import { getSessionUser, isFounder } from '../lib/auth.js';
import { runWatchdog } from '../agents/watchdog.js';
import { runCfo } from '../agents/cfo.js';
import { runQa } from '../agents/qa.js';
import { runProspector } from '../agents/prospector.js';
import { runOnboardingCheckins } from '../agents/onboarding.js';
import { runSupport } from '../agents/support.js';

const oidcClient = new OAuth2Client();

/**
 * Agent endpoints are invoked by Cloud Scheduler with an OIDC identity token
 * (audience = APP_BASE_URL). Locally, a founder session or the dev key works.
 */
async function isAuthorizedInvoker(req: FastifyRequest): Promise<boolean> {
  if (isFounder(getSessionUser(req))) return true;

  const auth = String(req.headers.authorization ?? '');
  if (auth.startsWith('Bearer ')) {
    try {
      const ticket = await oidcClient.verifyIdToken({
        idToken: auth.slice(7),
        audience: cfg.APP_BASE_URL,
      });
      const payload = ticket.getPayload();
      // Exact-match the scheduler SA — any-GCP-customer tokens must not pass.
      const expected = `scheduler-invoker@${cfg.GOOGLE_CLOUD_PROJECT}.iam.gserviceaccount.com`;
      return payload?.email === expected && payload.email_verified === true;
    } catch {
      return false;
    }
  }
  if (!isProd && req.headers['x-dev-key'] === cfg.SESSION_SECRET) return true;
  return false;
}

/** Shared-secret for SendGrid inbound-parse (query param — SendGrid can't set headers). */
export function inboundEmailKey(): string {
  return createHmac('sha256', cfg.SESSION_SECRET).update('inbound-email').digest('hex').slice(0, 32);
}

export function registerAgentRoutes(app: FastifyInstance): void {
  const guard = async (req: FastifyRequest, reply: { code: (n: number) => { send: (b: unknown) => unknown } }) => {
    if (!(await isAuthorizedInvoker(req))) {
      reply.code(403).send({ error: 'forbidden' });
      return false;
    }
    return true;
  };

  // Failed runs MUST surface as 5xx so Cloud Scheduler retries and alerts —
  // a watchdog that fails silently is worse than no watchdog (H9).
  const respond = (
    reply: { code: (n: number) => { send: (b: unknown) => unknown } },
    result: { runId: string; summary: string; status: string },
  ) => {
    if (result.status === 'failed') return reply.code(500).send(result);
    return result;
  };

  app.post('/agents/watchdog', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return respond(reply, await runWatchdog('cloud-scheduler:watchdog-15min'));
  });

  app.post('/agents/cfo', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return respond(reply, await runCfo('cloud-scheduler:cfo-weekly'));
  });

  app.post('/agents/qa', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return respond(reply, await runQa('cloud-scheduler:qa-nightly'));
  });

  app.post('/agents/prospector', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return respond(reply, await runProspector('cloud-scheduler:prospector-daily'));
  });

  app.post('/agents/onboarding', async (req, reply) => {
    if (!(await guard(req, reply))) return;
    return respond(reply, await runOnboardingCheckins('cloud-scheduler:onboarding-checkin'));
  });

  // SendGrid Inbound Parse → support agent. Multipart/urlencoded form fields.
  app.post('/webhooks/inbound-email', {
    config: { rateLimit: { max: 20, timeWindow: '15 minutes' } },
  }, async (req, reply) => {
    const key = (req.query as { key?: string }).key ?? '';
    if (key !== inboundEmailKey()) return reply.code(403).send({ error: 'forbidden' });
    const body = (req.body ?? {}) as Record<string, string>;
    const fromRaw = body.from ?? '';
    const fromEmail = (fromRaw.match(/<([^>]+)>/)?.[1] ?? fromRaw).trim().toLowerCase();
    if (!fromEmail) return reply.code(400).send({ error: 'missing from' });
    const result = await runSupport({
      fromEmail,
      subject: (body.subject ?? '(no subject)').slice(0, 300),
      body: (body.text ?? body.html ?? '').slice(0, 8000),
    });
    if (result.status === 'failed') return reply.code(500).send(result);
    return result;
  });
}
