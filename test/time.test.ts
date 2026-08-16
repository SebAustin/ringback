import { describe, expect, test } from 'vitest';
import { computeAvailability, localHour, zonedToUtc } from '../src/lib/time.js';

describe('zonedToUtc', () => {
  test('converts New York wall time to UTC (summer = UTC-4)', () => {
    const d = zonedToUtc({ y: 2026, m: 7, d: 22 }, '09:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-07-22T13:00:00.000Z');
  });

  test('handles winter offset (UTC-5)', () => {
    const d = zonedToUtc({ y: 2026, m: 1, d: 15 }, '09:00', 'America/New_York');
    expect(d.toISOString()).toBe('2026-01-15T14:00:00.000Z');
  });
});

describe('computeAvailability', () => {
  const hours = { wed: [{ open: '09:00', close: '11:00' }] };

  test('generates slots inside business hours only', () => {
    // Wed Jul 22 2026. "now" = Tuesday, so Wednesday is within the window.
    const now = new Date('2026-07-21T12:00:00.000Z');
    const slots = computeAvailability({
      hours,
      timezone: 'America/New_York',
      durationMin: 30,
      days: 3,
      now,
      booked: [],
    });
    expect(slots.length).toBe(4); // 9:00, 9:30, 10:00, 10:30 ET
    expect(slots[0]!.startsAt).toBe('2026-07-22T13:00:00.000Z');
    expect(slots[3]!.startsAt).toBe('2026-07-22T14:30:00.000Z');
  });

  test('excludes booked overlaps', () => {
    const now = new Date('2026-07-21T12:00:00.000Z');
    const slots = computeAvailability({
      hours,
      timezone: 'America/New_York',
      durationMin: 30,
      days: 3,
      now,
      booked: [{ startsAt: '2026-07-22T13:00:00.000Z', endsAt: '2026-07-22T14:00:00.000Z' }],
    });
    expect(slots.map((s) => s.startsAt)).toEqual([
      '2026-07-22T14:00:00.000Z',
      '2026-07-22T14:30:00.000Z',
    ]);
  });

  test('never offers slots in the past', () => {
    const now = new Date('2026-07-22T13:45:00.000Z'); // mid-window Wednesday
    const slots = computeAvailability({
      hours,
      timezone: 'America/New_York',
      durationMin: 30,
      days: 1,
      now,
      booked: [],
    });
    for (const s of slots) {
      expect(new Date(s.startsAt).getTime()).toBeGreaterThan(now.getTime());
    }
  });

  test('localHour reflects timezone', () => {
    expect(localHour(new Date('2026-07-22T01:00:00.000Z'), 'America/New_York')).toBe(21);
  });
});
