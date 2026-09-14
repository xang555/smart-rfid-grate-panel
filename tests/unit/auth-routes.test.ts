import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb, resetDbForTests } from '../../src/lib/server/db';
import { handle } from '../../src/hooks.server';
import { createPin } from '../../src/lib/server/auth';

let db: any, dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
  process.env.DB_PATH = path.join(dir, 't.db');
  resetDbForTests(); // the hook resolves its handle through getDb()
  db = openDb(process.env.DB_PATH);
});
afterEach(() => {
  db.close();
  resetDbForTests();
  delete process.env.DB_PATH;
  fs.rmSync(dir, { recursive: true, force: true });
});

// helper: drive the hook like SvelteKit would
async function callHandle(url: string, sessionCookie?: string, method = 'GET') {
  let redirected: string | null = null;
  const event: any = {
    url: new URL(`http://localhost${url}`),
    request: new Request(`http://localhost${url}`, { method }),
    cookies: {
      get: (n: string) => (n === 'sid' ? sessionCookie : undefined),
      set: () => {},
      delete: () => {}
    },
    locals: {},
    getClientAddress: () => '127.0.0.1'
  };
  const resolve = async (e: any) => {
    // mirror a page handler returning a body
    return new Response(JSON.stringify({ ip: e.locals.ip ?? null }), { status: 200 });
  };
  const res = await handle({ event, resolve });
  if (res.status === 303) redirected = res.headers.get('location');
  return { res, redirected };
}

describe('hooks gating', () => {
  it('redirects page routes to /setup-pin before a pin exists', async () => {
    const { redirected } = await callHandle('/');
    expect(redirected).toBe('/setup-pin');
  });

  it('allows /setup-pin through before a pin exists', async () => {
    const { res, redirected } = await callHandle('/setup-pin');
    expect(redirected).toBeNull();
    expect(res.status).toBe(200);
  });

  it('redirects to /login once a pin exists but no session', async () => {
    createPin(db, '123456');
    const { redirected } = await callHandle('/');
    expect(redirected).toBe('/login');
  });

  it('allows the main page with a valid session', async () => {
    createPin(db, '123456');
    await callHandle('/api/auth/login', undefined, 'POST');
    // simulate a real login by creating a session directly
    const { createSession } = await import('../../src/lib/server/auth');
    const { id } = createSession(db);
    const { res, redirected } = await callHandle('/', id);
    expect(redirected).toBeNull();
    expect(res.status).toBe(200);
  });

  it('always allows the auth API endpoints', async () => {
    const { redirected } = await callHandle('/api/auth/login', undefined, 'POST');
    expect(redirected).toBeNull();
  });

  it('records the client ip in locals', async () => {
    const { res } = await callHandle('/setup-pin');
    expect(await res.json()).toMatchObject({ ip: '127.0.0.1' });
  });
});
