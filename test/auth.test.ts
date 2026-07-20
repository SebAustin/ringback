import { describe, expect, test, vi, afterEach } from 'vitest';
import {
  createMagicToken,
  signToken,
  verifyMagicToken,
  verifyToken,
} from '../src/lib/auth.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('token signing', () => {
  test('round-trips a payload', () => {
    const token = signToken({ email: 'a@b.c', role: 'owner' }, 60);
    const payload = verifyToken<{ email: string; role: string }>(token);
    expect(payload?.email).toBe('a@b.c');
    expect(payload?.role).toBe('owner');
  });

  test('rejects tampered tokens', () => {
    const token = signToken({ email: 'a@b.c' }, 60);
    const [data, sig] = token.split('.');
    const evil = Buffer.from(JSON.stringify({ email: 'evil@x.y', exp: 9999999999 })).toString('base64url');
    expect(verifyToken(`${evil}.${sig}`)).toBeNull();
    expect(verifyToken(`${data}.AAAA`)).toBeNull();
    expect(verifyToken('garbage')).toBeNull();
  });

  test('rejects expired tokens', () => {
    const token = signToken({ email: 'a@b.c' }, 60);
    vi.useFakeTimers();
    vi.setSystemTime(Date.now() + 120_000);
    expect(verifyToken(token)).toBeNull();
  });
});

describe('magic tokens', () => {
  test('valid magic token returns email + unique single-use id', () => {
    const token = createMagicToken('owner@shop.com');
    const result = verifyMagicToken(token);
    expect(result?.email).toBe('owner@shop.com');
    expect(result?.jti).toMatch(/^[0-9a-f-]{36}$/);
    // Two tokens for the same email must have distinct jtis (single-use burn).
    const second = verifyMagicToken(createMagicToken('owner@shop.com'));
    expect(second?.jti).not.toBe(result?.jti);
  });

  test('session tokens are not magic tokens', () => {
    const sessionish = signToken({ email: 'a@b.c', kind: 'session' }, 60);
    expect(verifyMagicToken(sessionish)).toBeNull();
  });
});
