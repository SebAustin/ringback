import { beforeEach, describe, expect, test } from 'vitest';
import { MemoryStore, setStore } from '../src/lib/store.js';
import {
  checkInboundKeywords,
  checkPrices,
  isOptedOut,
  isOverTurnCap,
  recordOptOut,
  clearOptOut,
} from '../src/receptionist/guardrails.js';
import type { Conversation, Tenant } from '../src/types.js';

const tenant = {
  name: 'Testers',
  limits: { dailySmsSegments: 200, maxTurns: 20 },
  profile: {
    services: [{ name: 'Cut', durationMin: 30, price: '$35' }],
    faqs: [{ q: 'Deposit?', a: 'We take a $10 deposit for color.' }],
    hours: {},
    timezone: 'America/New_York',
  },
} as unknown as Tenant;

beforeEach(() => {
  setStore(new MemoryStore());
});

describe('opt-out keywords (handled before any LLM call)', () => {
  test.each(['STOP', 'stop', ' Stop ', 'UNSUBSCRIBE', 'cancel', 'END', 'quit'])(
    'detects %s as stop',
    (word) => {
      expect(checkInboundKeywords(word)).toBe('stop');
    },
  );

  test.each(['HELP', 'info'])('detects %s as help', (word) => {
    expect(checkInboundKeywords(word)).toBe('help');
  });

  test('normal messages pass through', () => {
    expect(checkInboundKeywords('Can I book a stop by tomorrow?')).toBeNull();
    expect(checkInboundKeywords('help me book something')).toBeNull();
  });
});

describe('opt-out blocklist', () => {
  test('records and reports opt-out per tenant+phone', async () => {
    expect(await isOptedOut('t1', '+15551234567')).toBe(false);
    await recordOptOut('t1', '+15551234567');
    expect(await isOptedOut('t1', '+15551234567')).toBe(true);
    expect(await isOptedOut('t2', '+15551234567')).toBe(false);
    await clearOptOut('t1', '+15551234567');
    expect(await isOptedOut('t1', '+15551234567')).toBe(false);
  });
});

describe('price-invention guardrail', () => {
  test('allows prices listed in tenant config', () => {
    const r = checkPrices('A cut is $35, see you soon!', tenant);
    expect(r.flagged).toBe(false);
  });

  test('allows prices mentioned in FAQs', () => {
    const r = checkPrices('There is a $10 deposit for color.', tenant);
    expect(r.flagged).toBe(false);
  });

  test('replaces replies quoting invented prices', () => {
    const r = checkPrices('Sure, that will be $500 total.', tenant);
    expect(r.flagged).toBe(true);
    expect(r.flaggedAmounts).toContain('$500');
    expect(r.reply).not.toContain('$500');
  });

  test('no dollar amounts → untouched', () => {
    const r = checkPrices('See you Tuesday at 10!', tenant);
    expect(r.flagged).toBe(false);
  });
});

describe('turn cap', () => {
  test('caps at tenant limit', () => {
    const conv = { turnCount: 20 } as Conversation;
    expect(isOverTurnCap(conv, tenant)).toBe(true);
    expect(isOverTurnCap({ turnCount: 19 } as Conversation, tenant)).toBe(false);
  });
});
