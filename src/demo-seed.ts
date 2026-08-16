import type { Tenant } from './types.js';
import { getStore } from './lib/store.js';
import { nowIso } from './lib/time.js';
import { cfg, twilioMock } from './config.js';

/**
 * The public demo tenant, "Luxe Cuts Salon". Judges interact with it via
 * /demo (web simulator) and, once a Twilio number is attached, by phone.
 * Idempotent — safe to call on every boot.
 */
export async function ensureDemoTenant(): Promise<string> {
  const store = getStore();
  const id = cfg.DEMO_TENANT_ID;
  const existing = await store.get<Tenant>('tenants', id);
  if (existing) return id;

  const tenant: Tenant = {
    name: 'Luxe Cuts Salon',
    ownerName: 'Demo Owner',
    ownerEmail: cfg.FOUNDER_EMAIL || 'demo-owner@ringback.local',
    ownerPhone: cfg.FOUNDER_PHONE,
    forwardPhone: cfg.FOUNDER_PHONE || undefined,
    // Local/mock mode gets a fixed fake number so webhook simulation works.
    ...(twilioMock ? { twilioNumber: '+15551110000' } : {}),
    status: 'live',
    profile: {
      services: [
        { name: "Women's Cut & Style", durationMin: 45, price: '$65' },
        { name: "Men's Cut", durationMin: 30, price: '$35' },
        { name: 'Full Color', durationMin: 90, price: '$120' },
        { name: 'Blowout', durationMin: 30, price: '$40' },
      ],
      faqs: [
        { q: 'Do you take walk-ins?', a: 'We do when a chair is free, but booking ahead guarantees your spot.' },
        { q: 'Is there parking?', a: 'Free lot behind the building, plus street parking on Main St.' },
        { q: 'What is the cancellation policy?', a: 'Life happens! Just give us 24 hours notice so we can offer the slot to someone else.' },
        { q: 'Do you sell gift cards?', a: 'Yes — any amount, available in person at the front desk.' },
      ],
      hours: {
        tue: [{ open: '09:00', close: '18:00' }],
        wed: [{ open: '09:00', close: '18:00' }],
        thu: [{ open: '09:00', close: '20:00' }],
        fri: [{ open: '09:00', close: '18:00' }],
        sat: [{ open: '09:00', close: '16:00' }],
      },
      timezone: 'America/New_York',
      bookingPolicy: 'Book any open slot during business hours. New color clients need a 15-min consult first.',
      tone: 'warm, upbeat, a little playful',
    },
    limits: { dailySmsSegments: 200, maxTurns: 20 },
    billing: {},
    createdAt: nowIso(),
  };
  await store.set('tenants', id, tenant);
  return id;
}
