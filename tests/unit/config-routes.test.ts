import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';

vi.mock('$lib/server/db', async (importOriginal) => {
  const actual: any = await importOriginal();
  return { ...actual, getDb: () => (globalThis as any).__testDb };
});

let db: any, dir: string, proj: string;

const READER_TOML = `
reader_name = "Gate A"
speedway_address = "192.168.55.12"
socket_port = 11000
[[antennas]]
ant_id = 1
tx_power = 17.0
rx_sensitivity = -60.0
enable = true
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfgroute-'));
  db = openDb(path.join(dir, 't.db'));
  (globalThis as any).__testDb = db;
  proj = path.join(dir, 'proj');
  fs.mkdirSync(proj, { recursive: true });
  fs.writeFileSync(path.join(proj, 'config.toml'), READER_TOML);
  db.prepare("INSERT INTO app_config (key, value) VALUES ('project_path', ?)").run(proj);
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('GET config', () => {
  it('returns schema and parsed value for the reader file', async () => {
    const { GET } = await import('../../src/routes/api/config/[file]/+server');
    const res = await GET({ params: { file: 'reader' } } as any);
    const body = await res.json();
    expect(body.file).toBe('reader');
    expect(body.schema.label).toBe('Reader');
    expect(body.value[''].speedway_address).toBe('192.168.55.12');
    expect(typeof body.rawToml).toBe('string');
  });

  it('404s for an unknown config file key', async () => {
    const { GET } = await import('../../src/routes/api/config/[file]/+server');
    const res = await GET({ params: { file: 'nope' } } as any);
    expect(res.status).toBe(404);
  });
});

describe('PUT config', () => {
  const put = async (value: any) => {
    const { PUT } = await import('../../src/routes/api/config/[file]/+server');
    return PUT({
      params: { file: 'reader' },
      request: new Request('http://localhost/api/config/reader', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value })
      })
    } as any);
  };

  it('saves a valid change and creates a backup', async () => {
    const get = await (await import('../../src/routes/api/config/[file]/+server'))
      .GET({ params: { file: 'reader' } } as any);
    const { value } = await get.json();
    value[''].speedway_address = '10.0.0.9';
    const res = await put(value);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(fs.existsSync(body.backup)).toBe(true);
    expect(fs.readFileSync(path.join(proj, 'config.toml'), 'utf8')).toContain('10.0.0.9');
  });

  it('rejects an invalid value with 400 and field errors', async () => {
    const get = await (await import('../../src/routes/api/config/[file]/+server'))
      .GET({ params: { file: 'reader' } } as any);
    const { value } = await get.json();
    value[''].socket_port = 99999;
    const res = await put(value);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].path).toBe('socket_port');
  });
});

describe('POST setup/run', () => {
  it('streams step and result events', async () => {
    const { EventEmitter } = await import('node:events');
    const { setRunForTests, resetRunForTests } = await import('../../src/lib/server/setup');
    setRunForTests(async () => {
      const p: any = new EventEmitter();
      p.stdout = new EventEmitter(); p.stderr = new EventEmitter(); p.pid = 1;
      setTimeout(() => {
        p.stdout.emit('data', Buffer.from('@@STEP:update:ok\n'));
        p.emit('close', 0);
      }, 0);
      return p;
    });

    const { POST } = await import('../../src/routes/api/setup/run/+server');
    const res = await POST({
      request: new Request('http://localhost/api/setup/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dockerUser: 'u', dockerPassword: 'p' })
      })
    } as any);

    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const text = await res.text();
    expect(text).toContain('"type":"step"');
    expect(text).toContain('"type":"result"');
    resetRunForTests();
  });
});
