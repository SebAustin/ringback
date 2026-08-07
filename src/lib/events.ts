import { getStore } from './store.js';
import { nowIso } from './time.js';

/**
 * Two-phase webhook idempotency (H1/C4). A marker is `processing` while work
 * runs and `done` only after success — so a crash mid-work lets the
 * provider's retry actually re-run the work instead of being swallowed as a
 * duplicate.
 */
const DEFAULT_STALE_MS = 60_000;

interface EventMarker {
  status: 'processing' | 'done';
  createdAt: string;
}

/** True when the caller should process this event (first claim OR stale retry). */
export async function claimEvent(id: string, staleMs = DEFAULT_STALE_MS): Promise<boolean> {
  const store = getStore();
  const created = await store.createIfAbsent<EventMarker>('events', id, {
    status: 'processing',
    createdAt: nowIso(),
  });
  if (created) return true;
  const existing = await store.get<EventMarker>('events', id);
  if (!existing) return true;
  if (existing.status === 'done') return false;
  if (Date.now() - new Date(existing.createdAt).getTime() > staleMs) {
    await store.merge('events', id, { createdAt: nowIso() });
    return true;
  }
  return false;
}

export async function completeEvent(id: string): Promise<void> {
  await getStore().merge('events', id, { status: 'done' });
}
