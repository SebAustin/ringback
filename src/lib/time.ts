import type { Weekday, WeeklyHours } from '../types.js';

export const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function nowIso(): string {
  return new Date().toISOString();
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
export function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return asUtc - date.getTime();
}

/** Convert a local wall-clock time in `timeZone` to a UTC Date. */
export function zonedToUtc(
  ymd: { y: number; m: number; d: number },
  hhmm: string,
  timeZone: string,
): Date {
  const [hh, mm] = hhmm.split(':').map(Number);
  const naive = Date.UTC(ymd.y, ymd.m - 1, ymd.d, hh, mm ?? 0);
  // Two-pass: estimate offset at the naive instant, then refine (handles DST edges).
  let offset = tzOffsetMs(new Date(naive), timeZone);
  offset = tzOffsetMs(new Date(naive - offset), timeZone);
  return new Date(naive - offset);
}

/** Y/M/D + weekday of an instant as seen in `timeZone`. */
export function localParts(date: Date, timeZone: string): { y: number; m: number; d: number; weekday: Weekday; hour: number } {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(dtf.formatToParts(date).map((p) => [p.type, p.value]));
  const weekday = (parts.weekday ?? 'Sun').slice(0, 3).toLowerCase() as Weekday;
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday,
    hour: Number(parts.hour),
  };
}

export interface Slot {
  startsAt: string;
  endsAt: string;
  label: string;
}

/**
 * Compute open slots for the next `days` days from tenant weekly hours,
 * excluding intervals that overlap existing appointments.
 */
export function computeAvailability(opts: {
  hours: WeeklyHours;
  timezone: string;
  durationMin: number;
  days: number;
  now?: Date;
  booked: { startsAt: string; endsAt: string }[];
  maxSlots?: number;
}): Slot[] {
  const { hours, timezone, durationMin, days, booked } = opts;
  const now = opts.now ?? new Date();
  const maxSlots = opts.maxSlots ?? 30;
  const slots: Slot[] = [];
  const stepMs = durationMin * 60_000;

  for (let dayOffset = 0; dayOffset < days && slots.length < maxSlots; dayOffset++) {
    const dayInstant = new Date(now.getTime() + dayOffset * 86_400_000);
    const lp = localParts(dayInstant, timezone);
    const ranges = hours[lp.weekday] ?? [];
    for (const [open, close] of ranges) {
      const openUtc = zonedToUtc({ y: lp.y, m: lp.m, d: lp.d }, open, timezone);
      const closeUtc = zonedToUtc({ y: lp.y, m: lp.m, d: lp.d }, close, timezone);
      for (let t = openUtc.getTime(); t + stepMs <= closeUtc.getTime(); t += stepMs) {
        if (slots.length >= maxSlots) break;
        if (t <= now.getTime()) continue;
        const startsAt = new Date(t).toISOString();
        const endsAt = new Date(t + stepMs).toISOString();
        const overlaps = booked.some(
          (b) => !(endsAt <= b.startsAt || startsAt >= b.endsAt),
        );
        if (overlaps) continue;
        slots.push({ startsAt, endsAt, label: formatSlotLabel(new Date(t), timezone) });
      }
    }
  }
  return slots;
}

/**
 * True when [startsAt, startsAt+durationMin) fits entirely inside one of the
 * tenant's business-hours windows for that local day.
 *
 * Booking validates against this directly rather than against a generated slot
 * grid: the grid's step size depends on which service was used to build it, so
 * a slot offered by one call can be absent from another call's grid even though
 * the time is genuinely free.
 */
export function isWithinBusinessHours(opts: {
  hours: WeeklyHours;
  timezone: string;
  startsAt: Date;
  durationMin: number;
}): boolean {
  const { hours, timezone, startsAt, durationMin } = opts;
  const lp = localParts(startsAt, timezone);
  const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
  for (const [open, close] of hours[lp.weekday] ?? []) {
    const openUtc = zonedToUtc({ y: lp.y, m: lp.m, d: lp.d }, open, timezone);
    const closeUtc = zonedToUtc({ y: lp.y, m: lp.m, d: lp.d }, close, timezone);
    if (startsAt.getTime() >= openUtc.getTime() && endsAt.getTime() <= closeUtc.getTime()) {
      return true;
    }
  }
  return false;
}

/** True when [startsAt, endsAt) overlaps any existing booking. */
export function overlapsBooked(
  startsAt: string,
  endsAt: string,
  booked: { startsAt: string; endsAt: string }[],
): boolean {
  return booked.some((b) => !(endsAt <= b.startsAt || startsAt >= b.endsAt));
}

export function formatSlotLabel(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

/** Local hour (0-23) in timezone — used for SMS quiet-hours checks. */
export function localHour(date: Date, timeZone: string): number {
  return localParts(date, timeZone).hour;
}

export function isoDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}
