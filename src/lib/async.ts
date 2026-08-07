/** Timeout + bounded-retry primitives for every external call (H2). */

export class TimeoutError extends Error {
  constructor(label: string, ms: number) {
    super(`${label} timed out after ${ms}ms`);
    this.name = 'TimeoutError';
  }
}

/** Reject after `ms` if the promise hasn't settled. Never leaves a dangling timer. */
export async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(label, ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function statusOf(err: unknown): number {
  const e = err as { status?: number; statusCode?: number; code?: number | string };
  const n = e?.status ?? e?.statusCode ?? (typeof e?.code === 'number' ? e.code : undefined);
  return typeof n === 'number' ? n : 0;
}

export function isRetriable(err: unknown): boolean {
  if (err instanceof TimeoutError) return true;
  const status = statusOf(err);
  return status === 429 || (status >= 500 && status < 600);
}

/** One bounded retry with jittered backoff. Default predicate: 429/5xx/timeout.
 * Pass a custom predicate for non-idempotent calls — e.g. an SMS send must
 * NOT retry on a client-side timeout (the message may already be queued). */
export async function retryOnce<T>(
  fn: () => Promise<T>,
  label: string,
  retriable: (err: unknown) => boolean = isRetriable,
): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (!retriable(err)) throw err;
    await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
    // eslint-disable-next-line no-console
    console.error(JSON.stringify({ severity: 'warning', msg: `retrying ${label}`, err: String(err) }));
    return fn();
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
