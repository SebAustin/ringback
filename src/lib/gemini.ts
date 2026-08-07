import { GoogleGenAI, type FunctionDeclaration, type Content } from '@google/genai';
import { cfg, geminiMock } from '../config.js';
import { retryOnce, withTimeout } from './async.js';

/** Webhook-bound flash calls get a tight budget; pro (cron reports) can run longer. */
const TIMEOUT_MS: Record<ModelKey, number> = { flash: 8_000, pro: 30_000 };

export const MODELS = {
  flash: 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
} as const;
export type ModelKey = keyof typeof MODELS;

/** $/1M tokens — estimates for cost accounting on agent runs. */
const PRICING: Record<ModelKey, { in: number; out: number }> = {
  flash: { in: 0.3, out: 2.5 },
  pro: { in: 1.25, out: 10 },
};

export interface FunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface GenResult {
  text: string;
  functionCalls: FunctionCall[];
  usage: { inTokens: number; outTokens: number; costUsd: number };
  model: string;
}

export type MockKind =
  | 'receptionist'
  | 'report'
  | 'qa'
  | 'prospect'
  | 'profile'
  | 'support'
  | 'summary';

export interface GenerateOpts {
  model: ModelKey;
  system: string;
  contents: Content[];
  tools?: FunctionDeclaration[];
  temperature?: number;
  /** Selects the canned response family when running without an API key. */
  mockKind?: MockKind;
}

let client: GoogleGenAI | null = null;
function getClient(): GoogleGenAI {
  if (!client) client = new GoogleGenAI({ apiKey: cfg.GEMINI_API_KEY });
  return client;
}

export async function generate(opts: GenerateOpts): Promise<GenResult> {
  if (geminiMock) return mockGenerate(opts);

  const res = await retryOnce(
    () =>
      withTimeout(
        getClient().models.generateContent({
          model: MODELS[opts.model],
          contents: opts.contents,
          config: {
            systemInstruction: opts.system,
            temperature: opts.temperature ?? 0.4,
            ...(opts.tools && opts.tools.length > 0
              ? { tools: [{ functionDeclarations: opts.tools }] }
              : {}),
          },
        }),
        TIMEOUT_MS[opts.model],
        `gemini:${opts.model}`,
      ),
    `gemini:${opts.model}`,
  );

  const inTokens = res.usageMetadata?.promptTokenCount ?? 0;
  const outTokens =
    (res.usageMetadata?.candidatesTokenCount ?? 0) +
    (res.usageMetadata?.thoughtsTokenCount ?? 0);
  const price = PRICING[opts.model];
  return {
    text: res.text ?? '',
    functionCalls: (res.functionCalls ?? []).map((fc) => ({
      name: fc.name ?? '',
      args: (fc.args ?? {}) as Record<string, unknown>,
    })),
    usage: {
      inTokens,
      outTokens,
      costUsd: (inTokens * price.in + outTokens * price.out) / 1_000_000,
    },
    model: MODELS[opts.model],
  };
}

/** Parse a JSON object out of a model reply (tolerates ``` fences). */
export function parseJson<T>(text: string): T | null {
  const cleaned = text.replace(/```(?:json)?/g, '').trim();
  const start = cleaned.indexOf('{');
  const startArr = cleaned.indexOf('[');
  const first = start === -1 ? startArr : startArr === -1 ? start : Math.min(start, startArr);
  if (first === -1) return null;
  try {
    return JSON.parse(cleaned.slice(first)) as T;
  } catch {
    return null;
  }
}

// ── Mock mode ────────────────────────────────────────────────────────────────

const MOCK_USAGE = { inTokens: 0, outTokens: 0, costUsd: 0 };

function lastUserText(contents: Content[]): string {
  for (let i = contents.length - 1; i >= 0; i--) {
    const c = contents[i]!;
    if (c.role !== 'user') continue;
    const textPart = (c.parts ?? []).find((p) => 'text' in p && p.text);
    if (textPart && 'text' in textPart) return textPart.text ?? '';
  }
  return '';
}

function findFunctionResponse(contents: Content[], name: string): Record<string, unknown> | null {
  for (let i = contents.length - 1; i >= 0; i--) {
    for (const p of contents[i]!.parts ?? []) {
      if ('functionResponse' in p && p.functionResponse?.name === name) {
        return (p.functionResponse.response ?? {}) as Record<string, unknown>;
      }
    }
  }
  return null;
}

function mockReceptionist(opts: GenerateOpts): GenResult {
  const base = { usage: MOCK_USAGE, model: 'gemini-mock', functionCalls: [] as FunctionCall[] };
  const userText = lastUserText(opts.contents);
  const availability = findFunctionResponse(opts.contents, 'get_availability');
  const bookingDone = findFunctionResponse(opts.contents, 'book_appointment');

  if (bookingDone) {
    return { ...base, text: 'You are all booked! We look forward to seeing you. Reply here if you need to change anything.' };
  }

  if (availability) {
    const slots = (availability.slots ?? []) as { startsAt: string; label: string }[];
    const nameMatch = userText.match(/(?:i\s*am|i'?m|my name is|it'?s|this is|under)\s+([A-Za-z][A-Za-z\s'-]{1,30})/i);
    const bareName = /^[A-Za-z][A-Za-z'-]{1,20}(\s[A-Za-z'-]{1,20})?$/.test(userText.trim());
    const name = nameMatch?.[1]?.trim() ?? (bareName ? userText.trim() : null);
    if (name && slots.length > 0) {
      return {
        ...base,
        text: '',
        functionCalls: [
          {
            name: 'book_appointment',
            args: { slotStartsAt: slots[0]!.startsAt, callerName: name, service: 'first available service' },
          },
        ],
      };
    }
    const list = slots.slice(0, 3).map((s) => s.label).join(', ');
    return {
      ...base,
      text: slots.length > 0
        ? `We have openings at: ${list}. Which works for you, and what name should I put it under?`
        : 'I could not find an open slot in the next few days — the owner will call you back shortly.',
    };
  }

  if (/\b(book|appointment|schedule|come in|slot|available|availability|open|opening|reserve)\b/i.test(userText)) {
    return { ...base, text: '', functionCalls: [{ name: 'get_availability', args: { days: 7 } }] };
  }
  if (/\b(price|cost|how much|rates?)\b/i.test(userText)) {
    return { ...base, text: 'Our current service list and prices are on our website — happy to book you in so you can chat details in person. Would you like an appointment?' };
  }
  if (/\b(hours?|close|closing)\b/i.test(userText)) {
    return { ...base, text: 'We are open our regular business hours — want me to book you a spot?' };
  }
  return {
    ...base,
    text: 'Thanks for reaching out! I can answer questions or book you an appointment — what do you need?',
  };
}

const MOCK_TEXTS: Record<Exclude<MockKind, 'receptionist'>, string> = {
  report:
    'Weekly report (mock): MRR steady, conversations up, response latency healthy. Unit economics within targets. No anomalies detected.',
  qa: '{"score": 4, "issues": [], "notes": "Polite, on-script, no invented prices (mock evaluation)."}',
  prospect:
    '[{"businessName":"Sunset Barbers","category":"barber","city":"Austin","fitScore":82,"rationale":"No online booking found; likely misses walk-in calls.","draftSubject":"Missed calls at Sunset Barbers?","draftEmail":"Hi — I built a tool that texts back your missed calls and books the appointment automatically. 2-minute demo?"}]',
  profile:
    '{"services":[{"name":"Consultation","durationMin":30}],"faqs":[{"q":"Do you take walk-ins?","a":"Yes, when capacity allows."}],"tone":"friendly and concise"}',
  support:
    '{"classification":"question","reply":"Thanks for reaching out! Here is how that works... (mock support reply)","needsApproval":false}',
  summary: 'Caller asked about availability and booked an appointment. Outcome: booked. (mock)',
};

function mockGenerate(opts: GenerateOpts): GenResult {
  if ((opts.mockKind ?? 'receptionist') === 'receptionist') return mockReceptionist(opts);
  return {
    text: MOCK_TEXTS[opts.mockKind as Exclude<MockKind, 'receptionist'>],
    functionCalls: [],
    usage: MOCK_USAGE,
    model: 'gemini-mock',
  };
}
