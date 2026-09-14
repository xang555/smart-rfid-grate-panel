import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, SCHEMA_VERSION } from '../../src/lib/server/db';

let dir: string;
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-')); });
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

describe('db migrations', () => {
  it('creates every required table', () => {
    const db = openDb(path.join(dir, 't.db'));
    const names = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r: any) => r.name);
    for (const t of [
      'app_config', 'pin', 'sessions', 'login_attempts',
      'service_state', 'service_events', 'schema_version'
    ]) expect(names).toContain(t);
    db.close();
  });

  it('records the schema version and is idempotent', () => {
    const p = path.join(dir, 't.db');
    const a = openDb(p);
    const v1 = a.prepare('SELECT MAX(version) AS v FROM schema_version').get() as any;
    a.close();
    const b = openDb(p); // re-open must not throw or duplicate
    const v2 = b.prepare('SELECT MAX(version) AS v FROM schema_version').get() as any;
    expect(v1.v).toBe(SCHEMA_VERSION);
    expect(v2.v).toBe(SCHEMA_VERSION);
    const count = b.prepare("SELECT COUNT(*) AS c FROM sqlite_master WHERE name='pin'").get() as any;
    expect(count.c).toBe(1);
    b.close();
  });

  it('enables WAL mode', () => {
    const db = openDb(path.join(dir, 't.db'));
    const mode = db.pragma('journal_mode', { simple: true });
    expect(String(mode).toLowerCase()).toBe('wal');
    db.close();
  });
});
