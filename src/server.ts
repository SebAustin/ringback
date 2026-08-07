import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import fastifyMultipart from '@fastify/multipart';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { assertProdConfig, cfg, isTest } from './config.js';
import { initFirestoreStore } from './lib/firestore.js';
import { registerTwilioRoutes } from './routes/twilio.js';
import { registerStripeRoutes } from './routes/stripe.js';
import { registerAgentRoutes } from './routes/agents.js';
import { registerApiRoutes } from './routes/api.js';
import { registerOpsRoutes } from './routes/ops.js';
import { ensureDemoTenant } from './demo-seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// A rejected floating promise must never take the instance (and every
// in-flight webhook) down with it. Log loudly, keep serving.
process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error(JSON.stringify({ severity: 'error', msg: 'unhandledRejection', reason: String(reason) }));
});

export async function buildApp() {
  const app = Fastify({
    logger: isTest
      ? false
      : {
          level: 'info',
          // Structured JSON logs → Cloud Logging → BigQuery sink.
          formatters: { level: (label) => ({ severity: label }) },
        },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  // SendGrid Inbound Parse posts multipart/form-data.
  await app.register(fastifyMultipart, {
    attachFieldsToBody: 'keyValues',
    limits: { fileSize: 2 * 1024 * 1024, files: 3, fields: 40 },
  });
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    // Twilio/Stripe webhooks are signature-authenticated; a burst of carrier
    // callbacks must never be 429'd into lost calls.
    allowList: (req) => (req.url ?? '').startsWith('/webhooks/twilio') || (req.url ?? '').startsWith('/webhooks/stripe'),
  });

  // Uniform error handling: Twilio webhooks degrade to valid empty TwiML so a
  // store blip never plays a carrier error to a live caller (H13).
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, url: req.url }, 'request failed');
    if ((req.url ?? '').startsWith('/webhooks/twilio')) {
      return reply.code(200).type('text/xml').send('<?xml version="1.0" encoding="UTF-8"?>\n<Response/>');
    }
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    return reply.code(status).send({ error: status === 500 ? 'internal error' : (e.message ?? 'error') });
  });

  // Security headers on every response (CSP allows only same-origin assets).
  app.addHook('onSend', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
    );
    if (cfg.APP_BASE_URL.startsWith('https')) {
      reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }
  });

  registerTwilioRoutes(app);
  registerStripeRoutes(app);
  registerAgentRoutes(app);
  registerApiRoutes(app);
  registerOpsRoutes(app);

  app.get('/healthz', async () => ({ ok: true, store: cfg.STORE }));

  // Built SPA (web/ → public/). Missing in pure-API test runs — that's fine.
  const publicDir = path.resolve(__dirname, '..', 'public');
  // wildcard:true resolves files at request time (freshly built assets included).
  await app.register(fastifyStatic, { root: publicDir, wildcard: true }).after(() => {
    app.setNotFoundHandler((req, reply) => {
      const url = req.raw.url ?? '';
      if (url.startsWith('/api') || url.startsWith('/webhooks') || url.startsWith('/agents')) {
        return reply.code(404).send({ error: 'not found' });
      }
      return reply.sendFile('index.html');
    });
  });

  return app;
}

/** Fail fast and loudly at boot if a required composite index is missing —
 * otherwise the first production SMS dies invisibly (C3). */
async function verifyIndexes(): Promise<void> {
  const { getStore } = await import('./lib/store.js');
  const probes: [string, Parameters<ReturnType<typeof getStore>['query']>[1]][] = [
    [`tenants/${cfg.DEMO_TENANT_ID}/appointments`, { where: [['status', '==', 'confirmed'], ['startsAt', '>=', '2020-01-01']] , limit: 1 }],
    ['sms_out', { where: [['tenantId', '==', 'probe'], ['createdAt', '>=', '2020-01-01']], limit: 1 }],
    ['agent_runs', { where: [['status', '==', 'awaiting_approval']], orderBy: ['startedAt', 'desc'], limit: 1 }],
    ['agent_runs', { where: [['trigger.detail', '==', 'probe'], ['startedAt', '>=', '2020-01-01']], limit: 1 }],
    ['tenants', { where: [['ownerEmail', '==', 'probe@probe.invalid']], orderBy: ['createdAt', 'desc'], limit: 1 }],
    ['prospects', { where: [['status', '==', 'drafted']], orderBy: ['createdAt', 'desc'], limit: 1 }],
  ];
  for (const [path, q] of probes) {
    try {
      await getStore().query(path, q);
    } catch (err) {
      throw new Error(
        `Missing Firestore index for query on "${path}" — run infra/setup.sh (indexes step) and wait for builds to finish. Underlying: ${String(err)}`,
      );
    }
  }
}

async function main(): Promise<void> {
  assertProdConfig();
  if (cfg.STORE === 'firestore') {
    initFirestoreStore();
    await verifyIndexes();
  }
  await ensureDemoTenant();

  const app = await buildApp();
  await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
  app.log.info(`RingBack listening on :${cfg.PORT} (store=${cfg.STORE})`);
}

// Only start the server when run directly (tests import buildApp instead).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('Fatal startup error:', err);
    process.exit(1);
  });
}
