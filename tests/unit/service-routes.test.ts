import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, resetDbForTests } from '../../src/lib/server/db';
import { clearLogs } from '../../src/lib/server/services/logbus';
import { setDepsForTests, resetDepsForTests } from '../../src/lib/server/services/manager';

let db: any, dir: string;

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDb: () => globalThis.__testDb };
});

function makeProject() {
  for (const f of [
    'impinJReaderGateway/ImpinJReader', 'config.toml',
    'ipcame/docker-compose.yml', 'ipcame/config.toml',
    'rfid/docker-compose.yml', 'rfid/config/config.toml'
  ]) {
    const full = path.join(dir, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }
  db.prepare("INSERT INTO app_config (key, value) VALUES ('project_path', ?)").run(dir);
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sroutes-'));
  db = openDb(path.join(dir, 't.db'));
  (globalThis as any).__testDb = db;
  clearLogs();
  setDepsForTests({
    spawnReader: vi.fn(() => ({ pid: 55 })),
    stopReader: vi.fn(async () => 'term'),
    isReaderAlive: vi.fn(() => true),
    probePort: vi.fn(async () => true),
    composeUp: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    composeDown: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    composeStatus: vi.fn(async () => 'running' as const),
    sleep: vi.fn(async () => {})
  });
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetDepsForTests();
});

const ev = (name?: string, body?: any) => ({
  params: { name: name ?? '' },
  request: new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {})
  })
});

describe('status route', () => {
  it('returns all three services', async () => {
    const { GET } = await import('../../src/routes/api/status/+server');
    const res = await GET({} as any);
    const body = await res.json();
    expect(body.services.map((s: any) => s.name)).toEqual(['reader', 'ipcame', 'rfid']);
  });
});

describe('per-service routes', () => {
  it('starts one service and returns ok', async () => {
    makeProject();
    const { POST } = await import('../../src/routes/api/services/[name]/start/+server');
    const res = await POST(ev('ipcame') as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, service: 'ipcame' });
  });

  it('rejects an unknown service name with 400', async () => {
    const { POST } = await import('../../src/routes/api/services/[name]/start/+server');
    const res = await POST(ev('bogus') as any);
    expect(res.status).toBe(400);
  });

  it('returns 409 with dependency_down when starting rfid alone', async () => {
    makeProject();
    const { POST } = await import('../../src/routes/api/services/[name]/start/+server');
    const res = await POST(ev('rfid') as any);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ ok: false, code: 'dependency_down' });
  });

  it('starts rfid with force=true', async () => {
    makeProject();
    const { POST } = await import('../../src/routes/api/services/[name]/start/+server');
    const res = await POST(ev('rfid', { force: true }) as any);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('stops a service', async () => {
    makeProject();
    const { POST: start } = await import('../../src/routes/api/services/[name]/start/+server');
    await start(ev('ipcame') as any);
    const { POST: stop } = await import('../../src/routes/api/services/[name]/stop/+server');
    const res = await stop(ev('ipcame') as any);
    expect(await res.json()).toMatchObject({ ok: true, service: 'ipcame' });
  });
});

describe('all-service routes', () => {
  it('starts all and returns three results in order', async () => {
    makeProject();
    const { POST } = await import('../../src/routes/api/services/start-all/+server');
    const res = await POST({} as any);
    const body = await res.json();
    expect(body.results.map((r: any) => r.service)).toEqual(['reader', 'ipcame', 'rfid']);
  });

  it('stops all and returns three results in reverse order', async () => {
    makeProject();
    const { POST: startAll } = await import('../../src/routes/api/services/start-all/+server');
    await startAll({} as any);
    const { POST } = await import('../../src/routes/api/services/stop-all/+server');
    const res = await POST({} as any);
    const body = await res.json();
    expect(body.results.map((r: any) => r.service)).toEqual(['rfid', 'ipcame', 'reader']);
  });
});

describe('logs route', () => {
  it('streams an SSE response with recent and live entries', async () => {
    const { pushLog } = await import('../../src/lib/server/services/logbus');
    pushLog({ service: 'reader', level: 'info', message: 'historic' });
    const { GET } = await import('../../src/routes/api/logs/+server');
    const res = await GET({} as any);
    expect(res.headers.get('content-type')).toContain('text/event-stream');

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    const first = dec.decode((await reader.read()).value);
    expect(first).toContain('historic');

    pushLog({ service: 'rfid', level: 'success', message: 'live' });
    const second = dec.decode((await reader.read()).value);
    expect(second).toContain('live');
    await reader.cancel();
  });
});
