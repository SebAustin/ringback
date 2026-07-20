import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import { cfg } from '../config.js';

export interface SessionUser {
  email: string;
  role: 'founder' | 'owner';
  tenantId?: string;
}

interface TokenPayload {
  [key: string]: unknown;
  exp: number;
}

function b64url(buf: Buffer): string {
  return buf.toString('base64url');
}

/** HMAC-signed compact token: base64url(payload).base64url(sig) */
export function signToken(payload: Record<string, unknown>, ttlSeconds: number): string {
  const body: TokenPayload = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const data = b64url(Buffer.from(JSON.stringify(body)));
  const sig = b64url(createHmac('sha256', cfg.SESSION_SECRET).update(data).digest());
  return `${data}.${sig}`;
}

export function verifyToken<T extends Record<string, unknown>>(token: string): T | null {
  const [data, sig] = token.split('.');
  if (!data || !sig) return null;
  const expected = b64url(createHmac('sha256', cfg.SESSION_SECRET).update(data).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(data, 'base64url').toString()) as TokenPayload;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload as unknown as T;
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = 'rb_session';
const SESSION_TTL_SECONDS = 7 * 24 * 3600;
export const MAGIC_LINK_TTL_SECONDS = 15 * 60;

export function createSessionCookie(user: SessionUser): string {
  return signToken({ ...user, kind: 'session' }, SESSION_TTL_SECONDS);
}

export function createMagicToken(email: string): string {
  return signToken({ email, kind: 'magic', jti: randomUUID() }, MAGIC_LINK_TTL_SECONDS);
}

/** Returns email + single-use id; the caller must burn the jti in the store. */
export function verifyMagicToken(token: string): { email: string; jti: string } | null {
  const payload = verifyToken<{ email: string; kind: string; jti?: string }>(token);
  if (!payload || payload.kind !== 'magic') return null;
  return { email: payload.email, jti: payload.jti ?? 'legacy' };
}

export function getSessionUser(req: FastifyRequest): SessionUser | null {
  const raw = (req.cookies ?? {})[SESSION_COOKIE];
  if (!raw) return null;
  const payload = verifyToken<Record<string, unknown>>(raw);
  if (!payload || payload.kind !== 'session') return null;
  return {
    email: String(payload.email),
    role: payload.role === 'founder' ? 'founder' : 'owner',
    tenantId: typeof payload.tenantId === 'string' ? payload.tenantId : undefined,
  };
}

export function isFounder(user: SessionUser | null): boolean {
  return Boolean(user && user.role === 'founder');
}
