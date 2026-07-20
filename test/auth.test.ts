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
  test('valid magic token returns email', () => {
    const token = createMagicToken('owner@shop.com');
    expect(verifyMagicToken(token)).toBe('owner@shop.com');
  });

  test('session tokens are not magic tokens', () => {
    const sessionish = signToken({ email: 'a@b.c', kind: 'session' }, 60);
    expect(verifyMagicToken(sessionish)).toBeNull();
  });
});
