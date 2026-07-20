const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Formats an ISO timestamp as a short relative string, e.g. "4m ago". */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return iso;

  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  if (diffMs < MINUTE_MS) return 'just now';
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}m ago`;
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}h ago`;
  return `${Math.floor(diffMs / DAY_MS)}d ago`;
}

/** Formats an ISO timestamp as a short date + time for tables. */
export function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
