import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';
import {
  hasPin, createPin, verifyPin, createSession, validateSession,
  destroySession, cleanupExpired, SESSION_TTL_MS, LOCKOUT_MS
} from '../../src/lib/server/auth';

let db: any, dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'));
  db = openDb(path.join(dir, 't.db'));
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('pin', () => {
  it('starts without a pin and stores a hash, not the plaintext', () => {
    expect(hasPin(db)).toBe(false);
    createPin(db, '123456');
    expect(hasPin(db)).toBe(true);
    const row = db.prepare('SELECT hash, salt FROM pin').get();
    expect(row.hash.toString('utf8')).not.toContain('123456');
    expect(row.salt.length).toBe(16);
  });

  it('rejects non-digit or out-of-range pins', () => {
    expect(() => createPin(db, 'abcdef')).toThrow('bad_pin');
    expect(() => createPin(db, '12345')).toThrow('bad_pin');
    expect(() => createPin(db, '1234567890123')).toThrow('bad_pin');
  });

  it('refuses to overwrite an existing pin', () => {
    createPin(db, '123456');
    expect(() => createPin(db, '654321')).toThrow('pin_exists');
  });

  it('verifies the right pin and rejects the wrong one', () => {
    createPin(db, '123456');
    expect(verifyPin(db, '123456', '1.1.1.1')).toEqual({ ok: true });
    expect(verifyPin(db, '000000', '1.1.1.1')).toMatchObject({ ok: false, code: 'bad_pin' });
  });

  it('locks an ip after 5 failures and reports retryAfterMs', () => {
    createPin(db, '123456');
    for (let i = 0; i < 5; i++) verifyPin(db, '000000', '9.9.9.9');
    const res = verifyPin(db, '123456', '9.9.9.9');
    expect(res).toMatchObject({ ok: false, code: 'locked' });
    if (!res.ok) expect(res.retryAfterMs).toBeGreaterThan(0);
    expect(res.ok ? 0 : (res.retryAfterMs ?? 0)).toBeLessThanOrEqual(LOCKOUT_MS);
  });

  it('successful login clears that ip attempts', () => {
    createPin(db, '123456');
    verifyPin(db, '000000', '2.2.2.2');
    verifyPin(db, '123456', '2.2.2.2');
    expect(verifyPin(db, '123456', '2.2.2.2')).toEqual({ ok: true });
  });
});

describe('sessions', () => {
  it('creates, validates, and destroys a session', () => {
    const { id } = createSession(db);
    expect(validateSession(db, id)).toEqual({ valid: true });
    destroySession(db, id);
    expect(validateSession(db, id)).toEqual({ valid: false });
  });

  it('rejects an unknown session id', () => {
    expect(validateSession(db, 'nope')).toEqual({ valid: false });
  });

  it('expires old sessions on cleanup', () => {
    const { id } = createSession(db);
    cleanupExpired(db, Date.now() + SESSION_TTL_MS + 1000);
    expect(validateSession(db, id)).toEqual({ valid: false });
  });
});
