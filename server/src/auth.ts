import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { parse } from 'cookie';

const SESSION_TTL_DAYS = 30;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function generateSessionToken(): string {
  return randomBytes32();
}

function randomBytes32(): string {
  return randomBytes(32).toString('hex');
}

export function sessionExpiryDate(): string {
  const expires = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  return expires.toISOString().slice(0, 19).replace('T', ' ');
}

export const SESSION_COOKIE_NAME = '3doku_session';
export const SESSION_MAX_AGE_SECONDS = SESSION_TTL_DAYS * 24 * 60 * 60;

/** Shared by the HTTP auth middleware (routes/auth.ts) and the Socket.io handshake auth (race.ts) - both start from a raw Cookie header. */
export function getSessionTokenFromCookieHeader(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  return parse(cookieHeader)[SESSION_COOKIE_NAME];
}
