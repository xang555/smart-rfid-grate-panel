import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDb: () => (globalThis as any).__testDb };
});

import { pushLog, recentLogs } from '../../src/lib/server/services/logbus';
import { DELETE } from '../../src/routes/api/logs/+server';

let db: any, dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logclr-'));
  db = openDb(path.join(dir, 't.db'));
  (globalThis as any).__testDb = db;
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('DELETE /api/logs', () => {
  it('clears the server buffer so a reconnect replays nothing', async () => {
    pushLog({ service: 'reader', level: 'info', message: 'one' });
    pushLog({ service: 'reader', level: 'info', message: 'two' });
    expect(recentLogs().length).toBeGreaterThan(0);

    const res = await DELETE({} as any);
    expect(res.status).toBe(204);
    expect(recentLogs()).toEqual([]);
  });
});
