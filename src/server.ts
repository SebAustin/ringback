import Fastify from 'fastify';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
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
    bodyLimit: 1024 * 256,
  });

  await app.register(fastifyCookie);
  await app.register(fastifyFormbody);
  await app.register(fastifyRateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
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

async function main(): Promise<void> {
  assertProdConfig();
  if (cfg.STORE === 'firestore') initFirestoreStore();
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
