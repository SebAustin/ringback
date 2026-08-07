import { initializeApp, getApps, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Firestore, FieldValue } from 'firebase-admin/firestore';
import { cfg } from '../config.js';
import type { Store, StoreQuery, WithId } from './store.js';
import { setStore } from './store.js';

/** Firestore-backed implementation of the Store interface. */
export class FirestoreStore implements Store {
  constructor(private db: Firestore) {}

  async get<T>(path: string, id: string): Promise<WithId<T> | null> {
    const snap = await this.db.collection(path).doc(id).get();
    return snap.exists ? ({ ...(snap.data() as T), id } as WithId<T>) : null;
  }

  async set<T extends object>(path: string, id: string, data: T): Promise<void> {
    await this.db.collection(path).doc(id).set(data);
  }

  async merge(path: string, id: string, data: Record<string, unknown>): Promise<void> {
    await this.db.collection(path).doc(id).set(data, { merge: true });
  }

  async add<T extends object>(path: string, data: T): Promise<string> {
    const ref = await this.db.collection(path).add(data);
    return ref.id;
  }

  async createIfAbsent<T extends object>(path: string, id: string, data: T): Promise<boolean> {
    try {
      await this.db.collection(path).doc(id).create(data);
      return true;
    } catch (err) {
      const code = (err as { code?: number }).code;
      if (code === 6 /* ALREADY_EXISTS */) return false;
      throw err;
    }
  }

  async delete(path: string, id: string): Promise<void> {
    await this.db.collection(path).doc(id).delete();
  }

  async increment(path: string, id: string, field: string, delta: number): Promise<void> {
    await this.db
      .collection(path)
      .doc(id)
      .set({ [field]: FieldValue.increment(delta) }, { merge: true });
  }

  async query<T>(path: string, q: StoreQuery = {}): Promise<WithId<T>[]> {
    let ref: FirebaseFirestore.Query = this.db.collection(path);
    for (const [field, op, value] of q.where ?? []) {
      ref = ref.where(field, op, value);
    }
    if (q.orderBy) ref = ref.orderBy(q.orderBy[0], q.orderBy[1]);
    if (q.limit !== undefined) ref = ref.limit(q.limit);
    const snap = await ref.get();
    return snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }) as WithId<T>);
  }
}

export function initFirestoreStore(): void {
  if (getApps().length === 0) {
    initializeApp({
      credential: applicationDefault(),
      projectId: cfg.GOOGLE_CLOUD_PROJECT || undefined,
    });
  }
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  setStore(new FirestoreStore(db));
}
