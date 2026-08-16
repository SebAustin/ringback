import { beforeEach, describe, expect, test } from 'vitest';
import { MemoryStore, getStore, setStore } from '../src/lib/store.js';
import { ensureDemoTenant } from '../src/demo-seed.js';
import { handleInboundMessage } from '../src/receptionist/conversation.js';
import { runWatchdog } from '../src/agents/watchdog.js';
import type { Tenant } from '../src/types.js';

/**
 * Firestore rejects a document whose array contains another array
 * ("Property X contains an invalid nested entity"). MemoryStore accepts it via
 * structuredClone, so this divergence is invisible to every other test — it
 * only surfaces as a crash-looping production deploy. These tests assert the
 * documents we actually persist are Firestore-legal.
 */
function findNestedArray(value: unknown, path = ''): string | null {
  if (Array.isArray(value)) {
    for (const [i, item] of value.entries()) {
      if (Array.isArray(item)) return `${path}[${i}]`;
      const deeper = findNestedArray(item, `${path}[${i}]`);
      if (deeper) return deeper;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const deeper = findNestedArray(v, path ? `${path}.${k}` : k);
      if (deeper) return deeper;
    }
  }
  return null;
}

beforeEach(() => {
  setStore(new MemoryStore());
});

describe('persisted documents are Firestore-legal', () => {
  test('the guard itself detects a nested array', () => {
    expect(findNestedArray({ profile: { hours: { mon: [['09:00', '17:00']] } } })).toBe(
      'profile.hours.mon[0]',
    );
    expect(findNestedArray({ profile: { hours: { mon: [{ open: '09:00' }] } } })).toBeNull();
  });

  test('demo tenant document has no nested arrays', async () => {
    const tenantId = await ensureDemoTenant();
    const tenant = await getStore().get<Tenant>('tenants', tenantId);
    expect(findNestedArray(tenant)).toBeNull();
  });

  test('conversation, message and appointment documents have no nested arrays', async () => {
    const tenantId = await ensureDemoTenant();
    const tenant = (await getStore().get<Tenant>('tenants', tenantId))!;
    const r1 = await handleInboundMessage({
      tenantId, tenant, callerPhone: '+15550003030',
      body: 'can I book an appointment?', channel: 'web_sim',
    });
    await handleInboundMessage({
      tenantId, tenant, callerPhone: '+15550003030', body: 'My name is Sam',
      channel: 'web_sim', conversationId: r1.conversationId,
    });

    for (const path of [
      `tenants/${tenantId}/conversations`,
      `tenants/${tenantId}/conversations/${r1.conversationId}/messages`,
      `tenants/${tenantId}/appointments`,
    ]) {
      for (const doc of await getStore().query(path, {})) {
        expect(findNestedArray(doc), `${path}/${doc.id}`).toBeNull();
      }
    }
  });

  test('agent_runs documents have no nested arrays', async () => {
    await ensureDemoTenant();
    await runWatchdog('firestore-shape-test');
    for (const run of await getStore().query('agent_runs', {})) {
      expect(findNestedArray(run), `agent_runs/${run.id}`).toBeNull();
    }
  });
});
