import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export const PIN_MIN = 6;
export const PIN_MAX = 6;
export const PIN_RE = new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`);
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const LOCKOUT_MS = 15 * 60 * 1000;

const SCRYPT = { N: 16384, r: 8, p: 1 };
const KEYLEN = 64;

function hashPin(pin: string, salt: Buffer): Buffer {
  return crypto.scryptSync(pin, salt, KEYLEN, SCRYPT);
}

export function hasPin(db: Database.Database): boolean {
  return !!db.prepare('SELECT 1 FROM pin WHERE id = 1').get();
}

export function createPin(db: Database.Database, pin: string): void {
  if (hasPin(db)) throw new Error('pin_exists');
  if (!PIN_RE.test(pin)) throw new Error('bad_pin');
  const salt = crypto.randomBytes(16);
  const hash = hashPin(pin, salt);
  db.prepare(
    'INSERT INTO pin (id, hash, salt, params, created_at) VALUES (1, ?, ?, ?, ?)'
  ).run(hash, salt, JSON.stringify(SCRYPT), Date.now());
}

type VerifyResult =
  | { ok: true }
  | { ok: false; code: 'bad_pin' | 'locked' | 'no_pin'; retryAfterMs?: number };

export function verifyPin(db: Database.Database, pin: string, ip: string): VerifyResult {
  const now = Date.now();
  if (!hasPin(db)) return { ok: false, code: 'no_pin' };

  // lockout check
  const recent = db
    .prepare(
      `SELECT COUNT(*) AS c, MAX(attempted_at) AS last FROM login_attempts
       WHERE ip = ? AND success = 0 AND attempted_at > ?`
    )
    .get(ip, now - WINDOW_MS) as any;
  if (recent.c >= MAX_ATTEMPTS) {
    const unlockAt = (recent.last ?? now) + LOCKOUT_MS;
    if (unlockAt > now) {
      db.prepare('INSERT INTO login_attempts (ip, attempted_at, success) VALUES (?, ?, 0)')
        .run(ip, now);
      return { ok: false, code: 'locked', retryAfterMs: unlockAt - now };
    }
  }

  const row = db.prepare('SELECT hash, salt FROM pin WHERE id = 1').get() as any;
  const candidate = hashPin(pin, row.salt as Buffer);
  const good =
    candidate.length === (row.hash as Buffer).length &&
    crypto.timingSafeEqual(candidate, row.hash as Buffer);

  db.prepare('INSERT INTO login_attempts (ip, attempted_at, success) VALUES (?, ?, ?)')
    .run(ip, now, good ? 1 : 0);

  if (!good) return { ok: false, code: 'bad_pin' };
  db.prepare('DELETE FROM login_attempts WHERE ip = ? AND success = 0').run(ip);
  return { ok: true };
}

export function createSession(db: Database.Database): { id: string; expiresAt: number } {
  const id = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (id, created_at, expires_at, last_seen) VALUES (?, ?, ?, ?)')
    .run(id, now, expiresAt, now);
  return { id, expiresAt };
}

export function validateSession(db: Database.Database, id: string): { valid: boolean } {
  const now = Date.now();
  const row = db.prepare('SELECT expires_at, last_seen FROM sessions WHERE id = ?').get(id) as any;
  if (!row || row.expires_at < now) return { valid: false };
  if (now - row.last_seen > 60_000) {
    db.prepare('UPDATE sessions SET last_seen = ?, expires_at = ? WHERE id = ?')
      .run(now, now + SESSION_TTL_MS, id);
  }
  return { valid: true };
}

export function destroySession(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
}

export function cleanupExpired(db: Database.Database, now = Date.now()): void {
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
}
