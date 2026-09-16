import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDb: () => (globalThis as any).__testDb };
});

import { PUT } from '../../src/routes/api/monitor/+server';

function put(url: any) {
  return PUT({
    request: new Request('http://localhost/api/monitor', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url })
    })
  } as any);
}

let db: any, dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mon-'));
  db = openDb(path.join(dir, 't.db'));
  (globalThis as any).__testDb = db;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('PUT /api/monitor', () => {
  it('stores a valid http(s) url', async () => {
    const res = await put('https://monitor.example.com/grafana');
    expect(res.status).toBe(200);
    const stored = db.prepare("SELECT value FROM app_config WHERE key = 'monitor_url'").get();
    expect(stored.value).toBe('https://monitor.example.com/grafana');
  });

  it('accepts an empty url (clears the setting)', async () => {
    await put('https://x.example.com');
    const res = await put('');
    expect(res.status).toBe(200);
    expect(db.prepare("SELECT value FROM app_config WHERE key = 'monitor_url'").get()).toBeUndefined();
  });

  it('rejects a non-http scheme and plain text', async () => {
    expect((await put('ftp://x')).status).toBe(400);
    expect((await put('not a url')).status).toBe(400);
  });
});
