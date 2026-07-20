import { z } from 'zod';

/**
 * Environment parsing. Fails fast in production when a required secret is
 * missing; falls back to safe local defaults in development and test so the
 * app (memory store + Gemini mock) runs with zero credentials.
 */
const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(8080),
  APP_BASE_URL: z.string().default('http://localhost:8080'),
  STORE: z.enum(['firestore', 'memory']).default('memory'),

  GOOGLE_CLOUD_PROJECT: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MOCK: z.string().default(''),

  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_MESSAGING_SERVICE_SID: z.string().default(''),

  STRIPE_SECRET_KEY: z.string().default(''),
  STRIPE_WEBHOOK_SECRET: z.string().default(''),
  STRIPE_PRICE_STARTER: z.string().default(''),
  STRIPE_PRICE_PRO: z.string().default(''),

  SENDGRID_API_KEY: z.string().default(''),
  EMAIL_FROM: z.string().default('hello@ringback.local'),

  SESSION_SECRET: z.string().min(16).default('dev-secret-change-me-please-0000000000000000'),
  FOUNDER_EMAIL: z.string().default(''),
  FOUNDER_PHONE: z.string().default(''),
  DEMO_TENANT_ID: z.string().default('demo-luxe-cuts'),

  PLACES_API_KEY: z.string().default(''),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('Invalid environment:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const cfg = parsed.data;

export const isProd = cfg.NODE_ENV === 'production';
export const isTest = cfg.NODE_ENV === 'test';

/** True when Gemini should return canned responses (no key or explicit mock).
 * Never true in production — prod requires a real key and ignores the flag. */
export const geminiMock = !isProd && (cfg.GEMINI_MOCK === '1' || !cfg.GEMINI_API_KEY);

/** True when Twilio calls should be faked (no credentials configured). */
export const twilioMock = !cfg.TWILIO_ACCOUNT_SID || !cfg.TWILIO_AUTH_TOKEN;

const REQUIRED_IN_PROD: (keyof typeof cfg)[] = [
  'GEMINI_API_KEY',
  'TWILIO_ACCOUNT_SID',
  'TWILIO_AUTH_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'SESSION_SECRET',
  'APP_BASE_URL',
  'GOOGLE_CLOUD_PROJECT',
];

export function assertProdConfig(): void {
  if (!isProd) return;
  const missing = REQUIRED_IN_PROD.filter((k) => !cfg[k]);
  if (cfg.SESSION_SECRET.startsWith('dev-secret')) missing.push('SESSION_SECRET');
  if (missing.length > 0) {
    throw new Error(`Missing required production env vars: ${[...new Set(missing)].join(', ')}`);
  }
}
