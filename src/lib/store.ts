import { cfg } from '../config.js';

export type WhereOp = '==' | '<' | '<=' | '>' | '>=' | 'in';

export interface StoreQuery {
  where?: [string, WhereOp, unknown][];
  orderBy?: [string, 'asc' | 'desc'];
  limit?: number;
}

export type WithId<T> = T & { id: string };

/**
 * Minimal document-store abstraction. `path` is a collection path like
 * "tenants" or "tenants/abc/conversations". Two implementations:
 * Firestore (production) and in-memory (dev/test/CI — zero credentials).
 */
export interface Store {
  get<T>(path: string, id: string): Promise<WithId<T> | null>;
  set<T extends object>(path: string, id: string, data: T): Promise<void>;
  merge(path: string, id: string, data: Record<string, unknown>): Promise<void>;
  add<T extends object>(path: string, data: T): Promise<string>;
  /** Creates only if absent. Returns true when created — the idempotency primitive. */
  createIfAbsent<T extends object>(path: string, id: string, data: T): Promise<boolean>;
  delete(path: string, id: string): Promise<void>;
  query<T>(path: string, q?: StoreQuery): Promise<WithId<T>[]>;
}

function valueAtPath(obj: unknown, dotted: string): unknown {
  let cur: unknown = obj;
  for (const part of dotted.split('.')) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function compare(a: unknown, b: unknown): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function matches(doc: unknown, [field, op, value]: [string, WhereOp, unknown]): boolean {
  const v = valueAtPath(doc, field);
  switch (op) {
    case '==':
      return v === value;
    case '<':
      return compare(v, value) < 0;
    case '<=':
      return compare(v, value) <= 0;
    case '>':
      return compare(v, value) > 0;
    case '>=':
      return compare(v, value) >= 0;
    case 'in':
      return Array.isArray(value) && value.includes(v);
  }
}

/** In-memory store. Deep-clones on read/write so callers can't mutate state. */
export class MemoryStore implements Store {
  private collections = new Map<string, Map<string, object>>();
  private counter = 0;

  private coll(path: string): Map<string, object> {
    let c = this.collections.get(path);
    if (!c) {
      c = new Map();
      this.collections.set(path, c);
    }
    return c;
  }

  async get<T>(path: string, id: string): Promise<WithId<T> | null> {
    const doc = this.coll(path).get(id);
    return doc ? ({ ...structuredClone(doc), id } as WithId<T>) : null;
  }

  async set<T extends object>(path: string, id: string, data: T): Promise<void> {
    this.coll(path).set(id, structuredClone(data));
  }

  async merge(path: string, id: string, data: Record<string, unknown>): Promise<void> {
    const existing = (this.coll(path).get(id) ?? {}) as Record<string, unknown>;
    const next = { ...existing };
    for (const [key, value] of Object.entries(data)) {
      // Support Firestore-style dotted field paths in merges.
      if (key.includes('.')) {
        const parts = key.split('.');
        let cur = next as Record<string, unknown>;
        for (let i = 0; i < parts.length - 1; i++) {
          const p = parts[i]!;
          const child = cur[p];
          cur[p] = child && typeof child === 'object' ? { ...(child as object) } : {};
          cur = cur[p] as Record<string, unknown>;
        }
        cur[parts[parts.length - 1]!] = structuredClone(value);
      } else {
        next[key] = structuredClone(value);
      }
    }
    this.coll(path).set(id, next);
  }

  async add<T extends object>(path: string, data: T): Promise<string> {
    const id = `m${Date.now().toString(36)}${(this.counter++).toString(36)}`;
    await this.set(path, id, data);
    return id;
  }

  async createIfAbsent<T extends object>(path: string, id: string, data: T): Promise<boolean> {
    if (this.coll(path).has(id)) return false;
    await this.set(path, id, data);
    return true;
  }

  async delete(path: string, id: string): Promise<void> {
    this.coll(path).delete(id);
  }

  async query<T>(path: string, q: StoreQuery = {}): Promise<WithId<T>[]> {
    let docs = [...this.coll(path).entries()].map(
      ([id, doc]) => ({ ...structuredClone(doc), id }) as WithId<T>,
    );
    for (const clause of q.where ?? []) {
      docs = docs.filter((d) => matches(d, clause));
    }
    if (q.orderBy) {
      const [field, dir] = q.orderBy;
      docs.sort((a, b) => compare(valueAtPath(a, field), valueAtPath(b, field)) * (dir === 'asc' ? 1 : -1));
    }
    if (q.limit !== undefined) docs = docs.slice(0, q.limit);
    return docs;
  }
}

let storeInstance: Store | null = null;

export function getStore(): Store {
  if (!storeInstance) {
    if (cfg.STORE === 'firestore') {
      // Lazy import keeps firebase-admin out of memory-store test runs.
      throw new Error('Firestore store must be initialized via initFirestoreStore() at startup');
    }
    storeInstance = new MemoryStore();
  }
  return storeInstance;
}

export function setStore(store: Store): void {
  storeInstance = store;
}
