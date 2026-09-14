import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/lib/server/db';
import { setProjectPath } from '../../src/lib/server/settings';
import { setExecForTests, resetExecForTests } from '../../src/lib/server/proc/docker';

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDb: () => (globalThis as any).__testDb };
});

let db: any, dir: string;
let next: any;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'imgroute-'));
  db = openDb(join(dir, 't.db'));
  (globalThis as any).__testDb = db;
  await mkdir(join(dir, 'ipcame'), { recursive: true });
  await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), 'services:\n  app:\n    image: base:latest\n');
  await mkdir(join(dir, 'rfid'), { recursive: true });
  await writeFile(join(dir, 'rfid', 'docker-compose.yml'), 'services:\n  rfid_gate_service:\n    image: base2:latest\n');
  await mkdir(join(dir, 'rfid', 'config'), { recursive: true });
  await writeFile(join(dir, 'rfid', 'config', 'config.toml'), '');
  setProjectPath(db, dir);
  next = { code: 0, stdout: '', stderr: '' };
  setExecForTests(async () => (typeof next === 'function' ? next() : next));
});
afterEach(async () => {
  resetExecForTests();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

const put = async (body: any) => {
  const { PUT } = await import('../../src/routes/api/images/+server');
  return PUT({
    request: new Request('http://localhost/api/images', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as any);
};

describe('GET /api/images', () => {
  it('lists both docker services', async () => {
    const { GET } = await import('../../src/routes/api/images/+server');
    const res = await GET({} as any);
    const body = await res.json();
    expect(body.images.map((i: any) => i.service)).toEqual(['ipcame', 'rfid']);
    expect(body.images[0].composeService).toBe('app');
    expect(body.images[1].composeService).toBe('rfid_gate_service');
  });
});

describe('PUT /api/images', () => {
  it('saves a valid ref and policy', async () => {
    const res = await put({ service: 'ipcame', image: 'mine:2', policy: 'never' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.image.image).toBe('mine:2');
    expect(body.image.policy).toBe('never');
  });

  it('rejects an unsafe ref with 400', async () => {
    const res = await put({ service: 'ipcame', image: '-rm -rf /' });
    expect(res.status).toBe(400);
    expect((await res.json()).message).toMatch(/dash/i);
  });

  it('rejects an unknown service with 400', async () => {
    const res = await put({ service: 'reader', image: 'x:1' });
    expect(res.status).toBe(400);
  });

  it('409s with found services over an ambiguous compose file', async () => {
    await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), 'services:\n  a:\n    image: x\n  b:\n    image: y\n');
    const res = await put({ service: 'ipcame', image: 'mine:2' });
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('ambiguous_compose_service');
    expect(body.found.sort()).toEqual(['a', 'b']);
  });

  it('clearing the image is always safe', async () => {
    await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), 'services:\n  a:\n    image: x\n  b:\n    image: y\n');
    const res = await put({ service: 'ipcame', image: '' });
    expect(res.status).toBe(200);
  });
});

describe('POST /api/images/pull', () => {
  it('streams a result event', async () => {
    const { POST } = await import('../../src/routes/api/images/+server');
    const res = await POST({ url: new URL('http://localhost/api/images/pull?service=ipcame') } as any);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('"type":"result"');
  });

  it('400s for an unknown service', async () => {
    const { POST } = await import('../../src/routes/api/images/+server');
    const res = await POST({ url: new URL('http://localhost/api/images/pull?service=nope') } as any);
    expect(res.status).toBe(400);
  });
});
