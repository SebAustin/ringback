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

  registerTwilioRoutes(app);
  registerStripeRoutes(app);
  registerAgentRoutes(app);
  registerApiRoutes(app);
  registerOpsRoutes(app);

  app.get('/healthz', async () => ({ ok: true, store: cfg.STORE }));

  // Built SPA (web/ → public/). Missing in pure-API test runs — that's fine.
  const publicDir = path.resolve(__dirname, '..', 'public');
  await app.register(fastifyStatic, { root: publicDir, wildcard: false }).after(() => {
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
