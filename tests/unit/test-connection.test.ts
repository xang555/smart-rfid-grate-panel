import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDb: () => (globalThis as any).__testDb };
});

// Probe results are injected: default refuses nothing, each test seeds the
// behavior it needs through this mutable bag.
const probeState = { ok: true, ms: 3 };
vi.mock('$lib/server/proc/reader', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    probePort: vi.fn(async () => {
      if (probeState.ok) return true;
      throw Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
    })
  };
});

import { POST } from '../../src/routes/api/config/test-connection/+server';

function post(body: any) {
  return POST({
    request: new Request('http://localhost/api/config/test-connection', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as any);
}

beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tconn-'));
  const db = openDb(path.join(dir, 't.db'));
  (globalThis as any).__testDb = db;
  probeState.ok = true;
  (globalThis as any).__tconnDir = dir;
});
afterEach(() => {
  (globalThis as any).__testDb.close();
  fs.rmSync((globalThis as any).__tconnDir, { recursive: true, force: true });
});

describe('POST /api/config/test-connection', () => {
  it('reports ok with latency for a reachable target', async () => {
    const res = await post({ targets: [{ label: 'Reader', host: '10.0.0.5', port: 11000 }] });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.results[0]).toMatchObject({ label: 'Reader', host: '10.0.0.5', port: 11000, ok: true });
    expect(typeof body.results[0].ms).toBe('number');
  });

  it('reports the errno detail for a refused target', async () => {
    probeState.ok = false;
    const res = await post({ targets: [{ label: 'Reader', host: '10.0.0.5', port: 11000 }] });
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toContain('ECONNREFUSED');
  });

  it('marks a target with an empty host as invalid without probing', async () => {
    const { probePort } = await import('$lib/server/proc/reader');
    const res = await post({ targets: [{ label: 'Reader', host: '', port: 11000 }] });
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/host/i);
    expect(probePort).not.toHaveBeenCalled();
  });

  it('marks a target with an out-of-range port as invalid', async () => {
    const res = await post({ targets: [{ label: 'Reader', host: '10.0.0.5', port: 70000 }] });
    const body = await res.json();
    expect(body.results[0].ok).toBe(false);
    expect(body.results[0].error).toMatch(/port/i);
  });

  it('mixes valid and invalid targets in order', async () => {
    probeState.ok = false;
    const res = await post({
      targets: [
        { label: 'Bad', host: 'nope', port: 0 },
        { label: 'Good', host: '10.0.0.9', port: 554 }
      ]
    });
    const body = await res.json();
    expect(body.results).toHaveLength(2);
    expect(body.results[0].ok).toBe(false);
    expect(body.results[1].ok).toBe(false);
    expect(body.results[1].error).toContain('ECONNREFUSED');
  });

  it('rejects a non-array or oversized target list', async () => {
    expect((await post({ targets: 'nope' })).status).toBe(400);
    const many = Array.from({ length: 17 }, (_, i) => ({ label: `t${i}`, host: '10.0.0.1', port: 80 }));
    expect((await post({ targets: many })).status).toBe(400);
  });

  it('rejects a malformed body', async () => {
    expect((await post(null)).status).toBe(400);
  });
});
