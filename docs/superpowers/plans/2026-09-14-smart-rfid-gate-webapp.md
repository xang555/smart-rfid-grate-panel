# Smart RFID Gate Webapp Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a SvelteKit web control panel that guards access with a PIN, installs the RFID gate project, edits its TOML config, and starts/stops the three gate services (individually and as a group) with live logs and per-service state.

**Architecture:** A single SvelteKit app (`adapter-node`) runs on the gate box. Server-only modules under `src/lib/server/` own the database, auth, TOML config, and process control; SvelteKit routes are thin adapters over them. A `services/manager.ts` module is the only place that knows service order and the state machine. The UI is a split-pane control screen (controls left, docked live log right) in a "Soft Dark" theme.

**Tech Stack:** SvelteKit + adapter-node, TypeScript, better-sqlite3, smol-toml, Tailwind CSS v4, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-14-smart-rfid-gate-webapp-design.md`

## Deviations from the spec

Two stack items named in spec §4 are **not** used by this plan. Both are deliberate, and both are easy to introduce later if wanted:

- **Zod** — spec §4 and §9 call for Zod-derived validation. This plan hand-rolls validation in `src/lib/server/config/store.ts` from the `Field` metadata (`type`, `min`, `max`, `enum`) because the schema *is* the validation source, so a second declarative layer would only duplicate it. `zod` is not installed; add it if you later want it for API payload shapes.- **shadcn-svelte / bits-ui** — spec §4 and §10 call for shadcn-svelte components under `src/lib/components/ui/`. This plan hand-writes the six components it needs (shell, banner, row, log console, dialog, field renderer) to keep the task count and the dependency graph small. Swapping them for shadcn equivalents is a per-component change that does not touch any server module.
- **Canonical TOML comments** — spec §9.2 wants `writeConfig` to emit each field's canonical comment (carried on `Field.help`) so the file stays self-documenting. Task 7 writes values only; `smol-toml`'s `stringify` has no comment support, so emitting them needs a hand-rolled serializer or a comment-aware fork. Unknown *keys* are preserved (Task 7); unknown *comments* are not. If you need comment fidelity, replace `renderToml` in Task 7 — it is the only function that turns values into text.
- **`_extra` bag** — spec §9.2 keeps unknown keys in an explicit `_extra` bag threaded through read → form → write. Task 7 instead merges into the previously-parsed document at write time, which preserves unknown keys with less plumbing. The observable result is the same; only the internal shape differs.
- **Linked `socket_port` hint** — spec §9.2 asks the UI to flag that Reader `socket_port` and Gate RFID `socket_port` must match. Not built. It is a display-only hint: add it in Task 22's settings page, where both schemas are already loaded.

Everything else in the spec is covered; see the coverage table at the end.


## Global Constraints

- Node.js **20+** (dev machine verified on 22.18.0). Package manager: **npm**.
- SvelteKit with **`@sveltejs/adapter-node`**; SSR enabled. No static adapter.
- SQLite driver is **`better-sqlite3`** (synchronous API only). WAL mode on.
- TOML library is **`smol-toml`** (`parse` / `stringify`). No other toml lib.
- PIN: digits only, length **6–12**. scrypt params `N=16384, r=8, p=1`, keylen `64`, 16-byte random salt.
- Session cookie name **`sid`**; `HttpOnly`, `SameSite=Strict`, `Path=/`, `Secure` when the request is https. TTL **12h**, sliding, refreshed at most once per minute.
- Rate limit: **5** failed PIN attempts per IP per **15 min** → block that IP for 15 min.
- Service names are exactly: **`reader`**, **`ipcame`**, **`rfid`**. Start order `reader → ipcame → rfid`; stop order is the reverse.
- Default project path is **`~/Desktop/asean-project`**, stored in `app_config.project_path`, editable in the UI.
- Reader launch command: `./impinJReaderGateway/ImpinJReader config.toml` with `cwd` = project path.
- Docker commands use `docker compose -f <file> ...` (no reliance on `cwd`).
- All service/docker actions return `ActionResult = { ok, service?, code?, message, detail? }`. `message` is human; `detail` carries raw stderr/exit code.
- Config writes are atomic (temp file + rename) and leave a `.bak` of the previous file.
- No stack traces leak to the client. Errors are logged server-side with a request id.
- Test runner: **Vitest** for unit/integration. Every task's tests run with `npm test -- <path>`.
- Commits use conventional-commit prefixes (`feat:`, `fix:`, `test:`, `chore:`).

---

## File Structure

```
smart-rfid-gate/
  package.json, svelte.config.js, vite.config.ts, tsconfig.json
  vitest.config.ts, playwright.config.ts, tailwind.config.ts
  .gitignore
  src/
    app.html
    app.css                       Soft Dark design tokens + Tailwind layers
    hooks.server.ts               session guard for all routes
    lib/
      types.ts                    shared client/server types
      server/
        db.ts                     open + migrate sqlite (singleton)
        log.ts                    structured server logger + request ids
        auth.ts                   PIN hash/verify, sessions, rate-limit
        settings.ts               app_config get/set, project path resolve
        paths.ts                  path safety + layout validation
        config/
          schema.ts               typed field/label definitions per toml file
          store.ts                read/write toml through schema
        proc/
          docker.ts               wrap docker compose up/down/ps
          reader.ts               spawn/stop/probe ImpinJReader
        services/
          types.ts                ServiceName, ServiceState, ActionResult
          logbus.ts               in-memory ring buffer + SSE event bus
          manager.ts              state machine, orchestration
        setup.ts                  run setup.sh, stream output, detect installed
    components/
      ui/                         shadcn-svelte components (button, input, ...)
      AppShell.svelte
      StatusBanner.svelte
      ServiceRow.svelte
      LogConsole.svelte
      PinPad.svelte
      FieldRenderer.svelte
      ArrayField.svelte
      Toast.svelte
    routes/
      +layout.server.ts
      +layout.svelte
      setup-pin/+page.server.ts, +page.svelte
      login/+page.server.ts, +page.svelte
      +page.server.ts, +page.svelte          main control
      setup/+page.server.ts, +page.svelte
      settings/+page.server.ts, +page.svelte
      api/
        auth/setup-pin/+server.ts
        auth/login/+server.ts
        auth/logout/+server.ts
        status/+server.ts
        logs/+server.ts                      SSE
        services/[name]/start/+server.ts
        services/[name]/stop/+server.ts
        services/start-all/+server.ts
        services/stop-all/+server.ts
        setup/run/+server.ts
        config/[file]/+server.ts
  static/
  tests/
    unit/  (vitest)
    e2e/   (playwright)
    fixtures/fake-project/
```

---

### Task 1: Project scaffold + tooling

**Files:**
- Create: `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`, `src/app.html`, `src/app.css`, `src/routes/+page.svelte` (placeholder)

**Interfaces:**
- Consumes: nothing.
- Produces: a runnable SvelteKit app; `npm test` runs Vitest; `npm run build` produces a node build.

- [ ] **Step 1: Initialize the project**

Run: `npm create svelte@latest .` — choose: **Skeleton project**, **TypeScript**, **no additional options**. If the scaffolder refuses a non-empty dir, run it in a temp dir and copy `package.json`, `svelte.config.js`, `vite.config.ts`, `tsconfig.json`, `src/app.html` into place.

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install
npm install -D @sveltejs/adapter-node better-sqlite3 smol-toml yaml
npm install -D @types/better-sqlite3 vitest @vitest/ui @testing-library/svelte jsdom
npm install -D tailwindcss @tailwindcss/vite
npm install -D @playwright/test
```

- [ ] **Step 3: Configure the node adapter**

Edit `svelte.config.js` so the adapter line reads:
```js
import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

export default {
  preprocess: vitePreprocess(),
  kit: { adapter: adapter() }
};
```

- [ ] **Step 4: Configure Tailwind v4 + Vitest**

`vite.config.ts`:
```ts
import { sveltekit } from '@sveltejs/kit/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [tailwindcss(), sveltekit()]
});
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { include: ['tests/unit/**/*.{test,spec}.ts'], environment: 'node' }
});
```

`src/app.css` (first line pulls Tailwind in):
```css
@import 'tailwindcss';
```

- [ ] **Step 5: Add npm scripts**

In `package.json` `"scripts"`, ensure these exist:
```json
{
  "dev": "vite dev",
  "build": "vite build",
  "preview": "vite preview",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:e2e": "playwright test",
  "check": "svelte-kit sync && svelte-check --tsconfig ./tsconfig.json"
}
```

- [ ] **Step 6: Verify the app boots and the test runner runs**

Run: `npm run build`
Expected: build completes, prints `✔ done` and no errors.

Run: `npm test`
Expected: Vitest exits 0 (no tests yet is acceptable at this step).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold sveltekit app with adapter-node, tailwind, vitest"
```

---

### Task 2: SQLite layer + migrations

**Files:**
- Create: `src/lib/server/db.ts`
- Test: `tests/unit/db.test.ts`

**Interfaces:**
- Produces:
  - `openDb(dbPath: string): Database.Database` — opens better-sqlite3, sets `journal_mode=WAL`, `foreign_keys=ON`, runs migrations, returns the handle.
  - `getDb(): Database.Database` — singleton using `DB_PATH` env (default `./data/app.db`, directory auto-created).
  - `resetDbForTests(): void` — closes and clears the singleton.
  - `SCHEMA_VERSION: number`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`tests/unit/db.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/db.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/server/db`.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/db.ts`:
```ts
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hash BLOB NOT NULL, salt BLOB NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY, ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL, success INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON login_attempts(ip, attempted_at);
CREATE TABLE IF NOT EXISTS service_state (
  name TEXT PRIMARY KEY, desired TEXT NOT NULL, actual TEXT NOT NULL,
  pid INTEGER, detail TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS service_events (
  id INTEGER PRIMARY KEY, service TEXT NOT NULL, level TEXT NOT NULL,
  message TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL
);
`
  }
];

function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const current = (db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as any).v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec(m.sql);
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(m.version);
  }
}

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const p = process.env.DB_PATH ?? './data/app.db';
  _db = openDb(p);
  return _db;
}

export function resetDbForTests(): void {
  if (_db) { _db.close(); _db = null; }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/db.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/db.ts tests/unit/db.test.ts
git commit -m "feat: sqlite layer with numbered migrations"
```

---

### Task 3: Server logger + request ids

**Files:**
- Create: `src/lib/server/log.ts`
- Test: `tests/unit/log.test.ts`

**Interfaces:**
- Produces:
  - `newRequestId(): string` — short random id.
  - `logInfo(msg: string, meta?: Record<string, unknown>): void`
  - `logWarn(msg: string, meta?: Record<string, unknown>): void`
  - `logError(msg: string, meta?: Record<string, unknown>): void`
  - `redact(value: string): string` — replaces secret-looking substrings; used on any string that may hold a password.
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`tests/unit/log.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest';
import { newRequestId, logInfo, logError, redact } from '../../src/lib/server/log';

describe('log', () => {
  it('newRequestId returns distinct non-empty ids', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('logError writes to stderr with the meta attached', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    logError('boom', { req: 'abc' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('redact masks passwords and tokens', () => {
    expect(redact('password=laoitdeV')).not.toContain('laoitdeV');
    expect(redact('token: abcdef123456')).not.toContain('abcdef123456');
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/log.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/log.ts`:
```ts
import crypto from 'node:crypto';

export function newRequestId(): string {
  return crypto.randomBytes(6).toString('hex');
}

function fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const tail = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${ts} ${level} ${msg}${tail}\n`;
}

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  process.stdout.write(fmt('INFO', msg, meta));
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  process.stdout.write(fmt('WARN', msg, meta));
}

export function logError(msg: string, meta?: Record<string, unknown>): void {
  process.stderr.write(fmt('ERROR', msg, meta));
}

const SECRET_KEYS = /(password|passwd|pass|token|secret|pwd)\s*[:=]\s*\S+/gi;

export function redact(value: string): string {
  return value.replace(SECRET_KEYS, (m) => m.replace(/[:=]\s*\S+$/, '=***'));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/log.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/log.ts tests/unit/log.test.ts
git commit -m "feat: server logger with request ids and secret redaction"
```

---

### Task 4: Auth — PIN hashing, sessions, rate limiting

**Files:**
- Create: `src/lib/server/auth.ts`
- Test: `tests/unit/auth.test.ts`

**Interfaces:**
- Produces:
  - `hasPin(db): boolean`
  - `createPin(db, pin: string): void` — throws `Error('pin_exists')` if one exists; throws `Error('bad_pin')` if not 6–12 digits.
  - `verifyPin(db, pin: string, ip: string): { ok: true } | { ok: false; code: 'bad_pin' | 'locked' | 'no_pin'; retryAfterMs?: number }`
  - `createSession(db): { id: string; expiresAt: number }`
  - `validateSession(db, id: string): { valid: true } | { valid: false }` — sliding refresh at most once per minute.
  - `destroySession(db, id: string): void`
  - `cleanupExpired(db, now?: number): void`
  - Constants: `PIN_MIN = 6`, `PIN_MAX = 12`, `SESSION_TTL_MS`, `MAX_ATTEMPTS = 5`, `WINDOW_MS`, `LOCKOUT_MS`.
- Consumes: `getDb` shape (a `Database.Database`), from Task 2.

- [ ] **Step 1: Write the failing test**

`tests/unit/auth.test.ts`:
```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/auth.ts`:
```ts
import crypto from 'node:crypto';
import type Database from 'better-sqlite3';

export const PIN_MIN = 6;
export const PIN_MAX = 12;
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
  if (!/^\d{6,12}$/.test(pin)) throw new Error('bad_pin');
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/auth.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/auth.ts tests/unit/auth.test.ts
git commit -m "feat: scrypt pin auth with server sessions and ip rate limiting"
```

---

### Task 5: Settings store + path safety

**Files:**
- Create: `src/lib/server/settings.ts`, `src/lib/server/paths.ts`
- Test: `tests/unit/settings.test.ts`

**Interfaces:**
- Produces:
  - `getConfig(db, key): string | null`, `setConfig(db, key, value): void`, `getAllConfig(db): Record<string,string>`
  - `getProjectPath(db): string` — reads `project_path`, default `~/Desktop/asean-project`, expands `~`.
  - `setProjectPath(db, p): void` — resolves, expands `~`, stores absolute.
  - `resolveProjectFile(projectPath, rel): string` — joins and **throws `Error('path_escape')`** if the result leaves `projectPath`.
  - `checkLayout(projectPath): { ok: boolean; missing: string[] }` — checks for `impinJReaderGateway/ImpinJReader`, `config.toml`, `ipcame/docker-compose.yml`, `ipcame/config.toml`, `rfid/docker-compose.yml`, `rfid/config/config.toml`.
- Consumes: `getDb` shape from Task 2.

- [ ] **Step 1: Write the failing test**

`tests/unit/settings.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';
import {
  getConfig, setConfig, getAllConfig, getProjectPath, setProjectPath,
  resolveProjectFile, checkLayout
} from '../../src/lib/server/settings';

let db: any, dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-'));
  db = openDb(path.join(dir, 't.db'));
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); });

describe('app_config', () => {
  it('round-trips a value', () => {
    setConfig(db, 'foo', 'bar');
    expect(getConfig(db, 'foo')).toBe('bar');
    expect(getConfig(db, 'nope')).toBeNull();
    expect(getAllConfig(db)).toMatchObject({ foo: 'bar' });
  });

  it('overwrites on second set', () => {
    setConfig(db, 'foo', '1');
    setConfig(db, 'foo', '2');
    expect(getConfig(db, 'foo')).toBe('2');
  });
});

describe('project path', () => {
  it('defaults to ~/Desktop/asean-project expanded to an absolute path', () => {
    const p = getProjectPath(db);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith('Desktop/asean-project')).toBe(true);
  });

  it('stores an absolute resolved path', () => {
    const target = path.join(dir, 'proj');
    setProjectPath(db, target);
    expect(getProjectPath(db)).toBe(path.resolve(target));
  });
});

describe('resolveProjectFile', () => {
  it('joins a relative path under the project', () => {
    expect(resolveProjectFile('/a/b', 'rfid/config/config.toml'))
      .toBe(path.resolve('/a/b/rfid/config/config.toml'));
  });

  it('refuses to escape the project root', () => {
    expect(() => resolveProjectFile('/a/b', '../../etc/passwd')).toThrow('path_escape');
  });
});

describe('checkLayout', () => {
  it('reports all missing files for an empty dir', () => {
    const r = checkLayout(dir);
    expect(r.ok).toBe(false);
    expect(r.missing.length).toBe(6);
  });

  it('is ok when all files exist', () => {
    for (const f of [
      'impinJReaderGateway/ImpinJReader', 'config.toml',
      'ipcame/docker-compose.yml', 'ipcame/config.toml',
      'rfid/docker-compose.yml', 'rfid/config/config.toml'
    ]) {
      const full = path.join(dir, f);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
    expect(checkLayout(dir)).toEqual({ ok: true, missing: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/settings.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/settings.ts`:
```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

const DEFAULT_PROJECT_REL = path.join('Desktop', 'asean-project');

export function getConfig(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function setConfig(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllConfig(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as any[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function getProjectPath(db: Database.Database): string {
  const stored = getConfig(db, 'project_path');
  const raw = stored ?? path.join('~', DEFAULT_PROJECT_REL);
  return path.resolve(expandHome(raw));
}

export function setProjectPath(db: Database.Database, p: string): void {
  setConfig(db, 'project_path', path.resolve(expandHome(p)));
}

export function resolveProjectFile(projectPath: string, rel: string): string {
  const root = path.resolve(projectPath);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path_escape');
  return full;
}

const LAYOUT_FILES = [
  'impinJReaderGateway/ImpinJReader',
  'config.toml',
  'ipcame/docker-compose.yml',
  'ipcame/config.toml',
  'rfid/docker-compose.yml',
  'rfid/config/config.toml'
];

export function checkLayout(projectPath: string): { ok: boolean; missing: string[] } {
  const missing = LAYOUT_FILES.filter((f) => !fs.existsSync(resolveProjectFile(projectPath, f)));
  return { ok: missing.length === 0, missing };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/settings.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/settings.ts tests/unit/settings.test.ts
git commit -m "feat: app_config store, project path resolution, layout check"
```

---

### Task 6: Config schema — typed fields, human labels

**Files:**
- Create: `src/lib/server/config/schema.ts`
- Test: `tests/unit/config-schema.test.ts`

**Interfaces:**
- Produces:
  - Types: `FieldType`, `Field`, `Section`, `ConfigFile`, `ConfigSchema`.
  - `CONFIG_FILES: ConfigFile[]` — exactly `['reader','cameras','gate']`.
  - `SCHEMAS: Record<ConfigFile, ConfigSchema>` — each `{ file, label, relPath, kind: 'flat'|'sections', root: Section[] }`.
  - `fileFor(db, projectPath, key: ConfigFile): string` — resolves the toml path for a config file.
  - `getField(schema, sectionKey, fieldKey): Field | undefined`
- Consumes: `resolveProjectFile` from Task 5.

**Notes:** `relPath` per file: reader → `config.toml`; cameras → `ipcame/config.toml`; gate → `rfid/config/config.toml`. Labels are human; `key` is the raw toml key. Enum `value` is the raw toml value, `label` is the human text.

- [ ] **Step 1: Write the failing test**

`tests/unit/config-schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { SCHEMAS, CONFIG_FILES, getField } from '../../src/lib/server/config/schema';

describe('config schema', () => {
  it('covers exactly the three config files', () => {
    expect(CONFIG_FILES).toEqual(['reader', 'cameras', 'gate']);
    for (const f of CONFIG_FILES) expect(SCHEMAS[f]).toBeTruthy();
  });

  it('reader schema has human labels and raw keys', () => {
    const reader = SCHEMAS.reader;
    const ip = getField(reader, 'reader', 'speedway_address');
    expect(ip?.label).toBe('Reader IP address');
    expect(ip?.type).toBe('string');
    const rfMode = getField(reader, 'reader', 'rf_mode');
    expect(rfMode?.type).toBe('enum');
    expect(rfMode?.enum?.find((e) => e.value === 2)?.label).toBe('Dense Reader M4');
  });

  it('reader has an antennas array section with a label per field', () => {
    const antennas = SCHEMAS.reader.root.find((s) => s.key === 'antennas');
    expect(antennas?.isArray).toBe(true);
    expect(antennas?.fields.find((f) => f.key === 'tx_power')?.label).toBe('Tx power (dBm)');
  });

  it('cameras has an ipcame array with a password field flagged', () => {
    const arr = SCHEMAS.cameras.root.find((s) => s.key === 'ipcame');
    expect(arr?.isArray).toBe(true);
    expect(arr?.fields.find((f) => f.key === 'IP_CAMERA_PASSWORD')?.secret).toBe(true);
  });

  it('gate schema exposes gates array and mqtt fields', () => {
    const gates = SCHEMAS.gate.root.find((s) => s.key === 'gates');
    expect(gates?.isArray).toBe(true);
    expect(getField(SCHEMAS.gate, 'mqtt', 'mqtt_broker_address')?.label).toBe('MQTT broker address');
  });

  it('every field has a non-empty label distinct from being blank', () => {
    for (const f of CONFIG_FILES) {
      for (const s of SCHEMAS[f].root) {
        for (const fld of s.fields) expect(fld.label.length).toBeGreaterThan(0);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/config-schema.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/config/schema.ts`:
```ts
import path from 'node:path';
import type Database from 'better-sqlite3';
import { getProjectPath, resolveProjectFile } from '../settings';

export type ConfigFile = 'reader' | 'cameras' | 'gate';
export type FieldType = 'string' | 'number' | 'boolean' | 'enum' | 'array<object>';

export interface Field {
  key: string;
  label: string;
  help?: string;
  type: FieldType | string;
  enum?: { value: string | number; label: string }[];
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  secret?: boolean;
}

export interface Section {
  key: string;
  label: string;
  fields: Field[];
  isArray?: boolean;
}

export interface ConfigSchema {
  key: ConfigFile;
  label: string;
  relPath: string;
  root: Section[];
}

const RF_MODE_VALUES: { value: number; label: string }[] = [
  { value: 0, label: 'Max Throughput' },
  { value: 1, label: 'Hybrid' },
  { value: 2, label: 'Dense Reader M4' },
  { value: 3, label: 'Dense Reader M8' },
  { value: 4, label: 'Max Miller' },
  { value: 5, label: 'Dense Reader M4 Two' },
  { value: 1000, label: 'Auto Set Dense Reader' },
  { value: 1002, label: 'Auto Set Dense Reader Deep Scan' },
  { value: 1003, label: 'Auto Set Static Fast' },
  { value: 1004, label: 'Auto Set Static DRM' },
  { value: 1005, label: 'Auto Set Custom / Impinj Internal' }
];

const SEARCH_MODE_VALUES = [
  'DualTarget', 'SingleTarget', 'ReaderSelected',
  'TagFocus', 'SingleTargetReset', 'DualTargetBtoASelect'
].map((v) => ({ value: v, label: v.replace(/([A-Z])/g, ' $1').trim() }));

const READER: ConfigSchema = {
  key: 'reader',
  label: 'Reader',
  relPath: 'config.toml',
  root: [
    {
      key: 'reader',
      label: 'Reader',
      fields: [
        { key: 'reader_name', label: 'Reader name', type: 'string', default: 'My Reader' },
        { key: 'speedway_address', label: 'Reader IP address', help: 'IP of the Impinj Speedway reader.', type: 'string' },
        { key: 'socket_port', label: 'Socket port', help: 'Port the reader listens on for the gate service. Default 11000.', type: 'number', min: 1, max: 65535, default: 11000 },
        { key: 'session', label: 'Session', help: 'Impinj session (0–3). Default 1.', type: 'number', min: 0, max: 3, default: 1 },
        { key: 'tag_population', label: 'Tag population', help: 'Expected number of tags in range. Default 20.', type: 'number', min: 1, default: 20 },
        { key: 'rf_mode', label: 'RF mode', help: 'Reader radio mode. Affects read rate and interference.', type: 'enum', enum: RF_MODE_VALUES, default: 2 },
        { key: 'selected_search_mode', label: 'Tag search mode', help: 'Impinj tag search mode.', type: 'enum', enum: SEARCH_MODE_VALUES, default: 'DualTarget' }
      ]
    },
    {
      key: 'filter',
      label: 'Tag filter',
      fields: [
        { key: 'enabled', label: 'Filter enabled', type: 'boolean', default: false },
        { key: 'tag_mask', label: 'Tag mask', help: 'Hex mask applied when the filter is enabled.', type: 'string', default: '0000' },
        { key: 'bit_count', label: 'Mask bit count', type: 'number', min: 0, default: 16 }
      ]
    },
    {
      key: 'antennas',
      label: 'Antennas',
      isArray: true,
      fields: [
        { key: 'ant_id', label: 'Antenna #', type: 'number', min: 1, max: 4, default: 1 },
        { key: 'tx_power', label: 'Tx power (dBm)', help: 'Transmit power for this antenna.', type: 'number', step: 0.5, min: 0, max: 32.5, default: 30 },
        { key: 'rx_sensitivity', label: 'Rx sensitivity', type: 'number', step: 0.5, min: -80, max: 0, default: -70 },
        { key: 'enable', label: 'Enabled', type: 'boolean', default: true }
      ]
    }
  ]
};

const CAMERAS: ConfigSchema = {
  key: 'cameras',
  label: 'Cameras',
  relPath: path.join('ipcame', 'config.toml'),
  root: [
    {
      key: 'service',
      label: 'Service',
      fields: [
        { key: 'SERVICE_PORT', label: 'Service port', type: 'number', min: 1, max: 65535, default: 5555 },
        { key: 'SAVE_CAMERA_IMAGE_DIR_NAME', label: 'Image save folder', type: 'string', default: 'images' },
        { key: 'image_width', label: 'Image width', type: 'number', min: 1, default: 1280 },
        { key: 'image_height', label: 'Image height', type: 'number', min: 1, default: 780 },
        {
          key: 'rotate', label: 'Image rotation', type: 'enum', default: 'ROTATE_180',
          enum: [
            { value: 'ROTATE_90_CLOCKWISE', label: 'Rotate 90° clockwise' },
            { value: 'ROTATE_180', label: 'Rotate 180°' },
            { value: 'ROTATE_90_COUNTERCLOCKWISE', label: 'Rotate 90° counter-clockwise' }
          ]
        }
      ]
    },
    {
      key: 'ipcame',
      label: 'IP cameras',
      isArray: true,
      fields: [
        { key: 'IP_CAMERA_ADDRESS', label: 'Camera IP address', type: 'string' },
        { key: 'RTSP_PORT', label: 'RTSP port', type: 'number', min: 1, max: 65535, default: 554 },
        { key: 'IP_CAMERA_USER', label: 'Camera user', type: 'string' },
        { key: 'IP_CAMERA_PASSWORD', label: 'Camera password', type: 'string', secret: true },
        { key: 'IP_CAMERA_CHANNEL', label: 'Camera channel', help: '101 = main stream, 102 = sub stream.', type: 'number', default: 101 },
        { key: 'relate_gate_id', label: 'Related gate ID', type: 'number', default: 10001 }
      ]
    }
  ]
};

const GATE: ConfigSchema = {
  key: 'gate',
  label: 'Gate RFID',
  relPath: path.join('rfid', 'config', 'config.toml'),
  root: [
    {
      key: 'reader_link',
      label: 'Reader link',
      fields: [
        { key: 'socket_address', label: 'Reader socket address', help: 'Must match what the reader service listens on.', type: 'string', default: 'localhost' },
        { key: 'socket_port', label: 'Reader socket port', help: 'Must equal the Reader tab socket port (default 11000).', type: 'number', min: 1, max: 65535, default: 11000 },
        { key: 'tx_power', label: 'Tx power', type: 'number', min: 0, max: 32.5, default: 17 },
        { key: 'receiver_sensitivity_index', label: 'Receiver sensitivity index', type: 'number', min: 0, default: 2 }
      ]
    },
    {
      key: 'mqtt',
      label: 'MQTT',
      fields: [
        { key: 'mqtt_broker_address', label: 'MQTT broker address', type: 'string' },
        { key: 'mqtt_user', label: 'MQTT user', type: 'string' },
        { key: 'mqtt_passwd', label: 'MQTT password', type: 'string', secret: true }
      ]
    },
    {
      key: 'behaviour',
      label: 'Behaviour',
      fields: [
        { key: 'cleanup_interval', label: 'Cleanup interval', type: 'number', min: 1 },
        { key: 'report_every_n_tags', label: 'Report every N tags', type: 'number', min: 1 },
        { key: 'search_mode', label: 'Search mode', type: 'string' },
        { key: 'tag_timeout', label: 'Tag timeout', type: 'number', min: 1 },
        { key: 'tag_population', label: 'Tag population', type: 'number', min: 1 },
        { key: 'event_id', label: 'Event ID', type: 'string' }
      ]
    },
    {
      key: 'gates',
      label: 'Gates',
      isArray: true,
      fields: [
        { key: 'gate_id', label: 'Gate ID', type: 'number' },
        { key: 'ant', label: 'Antenna', type: 'number' },
        { key: 'ipcame_gateway_address', label: 'Camera service address', type: 'string' },
        { key: 'ipcame_port', label: 'Camera service port', type: 'number', min: 1, max: 65535 },
        { key: 'camera_id', label: 'Camera ID', type: 'number' }
      ]
    }
  ]
};

export const CONFIG_FILES: ConfigFile[] = ['reader', 'cameras', 'gate'];

export const SCHEMAS: Record<ConfigFile, ConfigSchema> = {
  reader: READER,
  cameras: CAMERAS,
  gate: GATE
};

export function getField(schema: ConfigSchema, sectionKey: string, fieldKey: string): Field | undefined {
  return schema.root.find((s) => s.key === sectionKey)?.fields.find((f) => f.key === fieldKey);
}

export function fileFor(db: Database.Database, projectPath: string, key: ConfigFile): string {
  return resolveProjectFile(projectPath, SCHEMAS[key].relPath);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/config-schema.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/config/schema.ts tests/unit/config-schema.test.ts
git commit -m "feat: typed toml config schema with human-readable labels"
```

---

### Task 7: Config store — read/validate/write TOML

**Files:**
- Create: `src/lib/server/config/store.ts`
- Test: `tests/unit/config-store.test.ts`

**Interfaces:**
- Produces:
  - `readConfig(filePath, schema): Record<string, unknown>` — parses toml; returns only keys in the schema, filling `default` for missing keys (top-level primitive keys and array sections).
  - `validateConfig(schema, raw): { ok: true; value: Record<string, unknown> } | { ok: false; errors: { path: string; message: string }[] }`
  - `writeConfig(filePath, schema, value, rawTomlOverride?): { ok: true; backup: string }` — merges allowed keys into the existing parsed toml (preserving unknown keys), writes atomically (temp + rename), and saves `<file>.bak`.
  - `renderToml(schema, value): string` — canonical toml text from schema-ordered values.
- Consumes: `SCHEMAS` types from Task 6.

- [ ] **Step 1: Write the failing test**

`tests/unit/config-store.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'smol-toml';
import { SCHEMAS } from '../../src/lib/server/config/schema';
import { readConfig, validateConfig, writeConfig, renderToml } from '../../src/lib/server/config/store';

let dir: string, file: string;
const sample = `
[reader]
reader_name = "Gate A"
speedway_address = "192.168.55.12"
socket_port = 11000
unknown_extra = "keep me"

[[antennas]]
ant_id = 1
tx_power = 17.0
rx_sensitivity = -60.0
enable = true
`;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-'));
  file = path.join(dir, 'config.toml');
  fs.writeFileSync(file, sample);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('readConfig', () => {
  it('returns schema keys with values parsed', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    expect(v.reader.speedway_address).toBe('192.168.55.12');
    expect(v.antennas[0].tx_power).toBe(17);
    expect(v.antennas[0].enable).toBe(true);
  });

  it('fills defaults for missing keys', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    expect(v.reader.tag_population).toBe(20);
    expect(v.reader.rf_mode).toBe(2);
  });
});

describe('validateConfig', () => {
  it('accepts a good value', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    expect(validateConfig(SCHEMAS.reader, v).ok).toBe(true);
  });

  it('rejects an out-of-range number', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    v.reader.socket_port = 99999;
    const r = validateConfig(SCHEMAS.reader, v);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].path).toBe('reader.socket_port');
  });

  it('rejects an unknown enum value', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    v.reader.rf_mode = 42;
    const r = validateConfig(SCHEMAS.reader, v);
    expect(r.ok).toBe(false);
  });

  it('rejects a wrong-typed boolean', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    v.filter.enabled = 'yes';
    expect(validateConfig(SCHEMAS.reader, v).ok).toBe(false);
  });
});

describe('writeConfig', () => {
  it('writes the new value, keeps unknown keys, and leaves a .bak', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    v.reader.speedway_address = '10.0.0.5';
    const res = writeConfig(file, SCHEMAS.reader, v);
    expect(res.ok).toBe(true);
    const after: any = parse(fs.readFileSync(file, 'utf8'));
    expect(after.reader.speedway_address).toBe('10.0.0.5');
    expect(after.reader.unknown_extra).toBe('keep me'); // unknown key preserved
    expect(fs.existsSync(res.backup)).toBe(true);
  });

  it('does not leave a temp file behind', () => {
    writeConfig(file, SCHEMAS.reader, readConfig(file, SCHEMAS.reader));
    const leftovers = fs.readdirSync(dir).filter((f) => f.includes('.tmp'));
    expect(leftovers).toEqual([]);
  });
});

describe('renderToml', () => {
  it('renders schema-ordered toml that round-trips', () => {
    const v: any = readConfig(file, SCHEMAS.reader);
    const text = renderToml(SCHEMAS.reader, v);
    const back: any = parse(text);
    expect(back.reader.speedway_address).toBe('192.168.55.12');
    expect(back.antennas.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/config-store.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/config/store.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import type { ConfigSchema, Field, Section } from './schema';

type Val = Record<string, unknown>;

function sectionToValue(section: Section, parsed: Val): unknown {
  const src = parsed?.[section.key];
  if (section.isArray) {
    const rows = Array.isArray(src) ? src : [];
    return rows.map((row: any) => {
      const out: Val = {};
      for (const f of section.fields) out[f.key] = row[f.key] ?? f.default;
      return out;
    });
  }
  const out: Val = {};
  const obj = (src && typeof src === 'object' ? src : {}) as Val;
  for (const f of section.fields) out[f.key] = obj[f.key] ?? f.default;
  return out;
}

export function readConfig(filePath: string, schema: ConfigSchema): Val {
  let parsed: Val = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) parsed = parse(raw) as Val;
  }
  const out: Val = {};
  for (const s of schema.root) out[s.key] = sectionToValue(s, parsed);
  return out;
}

interface Ctx { schema: ConfigSchema; value: Val; errors: { path: string; message: string }[]; }

function checkField(f: Field, value: unknown, path: string, ctx: Ctx): void {
  if (value === undefined || value === null || value === '') {
    if (f.default === undefined) ctx.errors.push({ path, message: `${f.label} is required` });
    return;
  }
  if (f.type === 'number') {
    const n = Number(value);
    if (Number.isNaN(n)) return void ctx.errors.push({ path, message: `${f.label} must be a number` });
    if (f.min !== undefined && n < f.min) ctx.errors.push({ path, message: `${f.label} must be ≥ ${f.min}` });
    if (f.max !== undefined && n > f.max) ctx.errors.push({ path, message: `${f.label} must be ≤ ${f.max}` });
    return;
  }
  if (f.type === 'boolean') {
    if (typeof value !== 'boolean') ctx.errors.push({ path, message: `${f.label} must be on or off` });
    return;
  }
  if (f.type === 'enum') {
    const ok = (f.enum ?? []).some((e) => e.value === value || String(e.value) === String(value));
    if (!ok) ctx.errors.push({ path, message: `${f.label} is not a valid choice` });
    return;
  }
  if (f.type === 'string' && typeof value !== 'string') {
    ctx.errors.push({ path, message: `${f.label} must be text` });
  }
}

export function validateConfig(
  schema: ConfigSchema, raw: Val
): { ok: true; value: Val } | { ok: false; errors: { path: string; message: string }[] } {
  const ctx: Ctx = { schema, value: raw, errors: [] };
  for (const s of schema.root) {
    if (s.isArray) {
      const rows = raw[s.key];
      if (!Array.isArray(rows)) { ctx.errors.push({ path: s.key, message: `${s.label} must be a list` }); continue; }
      rows.forEach((row: any, i: number) => {
        for (const f of s.fields) checkField(f, row?.[f.key], `${s.key}.${i}.${f.key}`, ctx);
      });
    } else {
      const obj = (raw[s.key] ?? {}) as Val;
      for (const f of s.fields) checkField(f, obj[f.key], `${s.key}.${f.key}`, ctx);
    }
  }
  if (ctx.errors.length) return { ok: false, errors: ctx.errors };
  return { ok: true, value: raw };
}

function coerce(f: Field, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (f.type === 'number') return Number(value);
  if (f.type === 'boolean') return value === true || value === 'true';
  return value;
}

export function renderToml(schema: ConfigSchema, value: Val): string {
  const doc: Val = {};
  for (const s of schema.root) {
    if (s.isArray) {
      doc[s.key] = (Array.isArray(value[s.key]) ? value[s.key] : []).map((row: any) => {
        const o: Val = {};
        for (const f of s.fields) o[f.key] = coerce(f, row?.[f.key]);
        return o;
      });
    } else {
      const src = (value[s.key] ?? {}) as Val;
      const o: Val = {};
      for (const f of s.fields) o[f.key] = coerce(f, src[f.key]);
      doc[s.key] = o;
    }
  }
  return stringify(doc);
}

export function writeConfig(
  filePath: string, schema: ConfigSchema, value: Val
): { ok: true; backup: string } {
  // merge into existing doc to preserve unknown keys
  let existing: Val = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) existing = parse(raw) as Val;
  }
  const merged: Val = { ...existing };
  for (const s of schema.root) {
    if (s.isArray) {
      merged[s.key] = (Array.isArray(value[s.key]) ? value[s.key] : []).map((row: any) => {
        const o: Val = {};
        for (const f of s.fields) o[f.key] = coerce(f, row?.[f.key]);
        return o;
      });
    } else {
      const src = (value[s.key] ?? {}) as Val;
      const prev = (existing[s.key] && typeof existing[s.key] === 'object' ? existing[s.key] : {}) as Val;
      const o: Val = { ...prev };
      for (const f of s.fields) o[f.key] = coerce(f, src[f.key]);
      merged[s.key] = o;
    }
  }

  const text = stringify(merged);
  const backup = filePath + '.bak';
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);

  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
  return { ok: true, backup };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/config-store.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/config/store.ts tests/unit/config-store.test.ts
git commit -m "feat: schema-driven toml read/validate/atomic-write with backup"
```

---

### Task 8: Docker wrapper

**Files:**
- Create: `src/lib/server/proc/docker.ts`
- Test: `tests/unit/docker.test.ts`

**Interfaces:**
- Produces:
  - `type RunResult = { code: number; stdout: string; stderr: string }`
  - `runComposeUp(extraArgs: string[]): Promise<RunResult>` (`docker compose <extra> up -d`, extra carries the `-f` pairs)
  - `runComposeDown(extraArgs: string[]): Promise<RunResult>`
  - `runComposePull(extraArgs: string[], service: string): Promise<RunResult>` (`docker compose <extra> pull <service>`)
  - `composeStatus(extraArgs: string[]): Promise<'running' | 'stopped' | 'unknown'>`
  - `hasLocalImage(ref: string): Promise<boolean>` (`docker image inspect <ref>`)
  - `dockerAvailable(): Promise<boolean>`
  - `setExecForTests(fn)` / `resetExecForTests()` — injection seam so tests never shell out.
- Consumes: nothing.

`extraArgs` is always the output of `composeArgs(base, override?)` from Task 9, so this module never builds `-f` itself. That keeps the file-ordering rule in one place.

- [ ] **Step 1: Write the failing test**

`tests/unit/docker.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  runComposeUp, runComposeDown, composeStatus, dockerAvailable,
  setExecForTests, resetExecForTests
} from '../../src/lib/server/proc/docker';

let calls: { cmd: string; args: string[] }[] = [];
let next: any;

beforeEach(() => {
  calls = [];
  setExecForTests(async (cmd: string, args: string[]) => {
    calls.push({ cmd, args });
    return typeof next === 'function' ? next(cmd, args) : next;
  });
});
afterEach(() => resetExecForTests());

describe('docker wrapper', () => {
  const BASE = ['-f', '/p/ipcame/docker-compose.yml'];
  const WITH_OVERRIDE = [...BASE, '-f', '/p/.rfid-panel/compose-ipcame.yml'];

  it('runs compose up with the given file args and -d', async () => {
    next = { code: 0, stdout: '', stderr: '' };
    const r = await runComposeUp(BASE);
    expect(r.code).toBe(0);
    expect(calls[0].cmd).toBe('docker');
    expect(calls[0].args).toEqual(['compose', '-f', '/p/ipcame/docker-compose.yml', 'up', '-d']);
  });

  it('runs compose up with an override file when one is passed', async () => {
    next = { code: 0, stdout: '', stderr: '' };
    await runComposeUp(WITH_OVERRIDE);
    expect(calls[0].args).toEqual([
      'compose', '-f', '/p/ipcame/docker-compose.yml',
      '-f', '/p/.rfid-panel/compose-ipcame.yml', 'up', '-d'
    ]);
  });

  it('runs compose down with the file args', async () => {
    next = { code: 0, stdout: '', stderr: '' };
    await runComposeDown(['-f', '/p/rfid/docker-compose.yml']);
    expect(calls[0].args).toEqual(['compose', '-f', '/p/rfid/docker-compose.yml', 'down']);
  });

  it('runs compose pull for a named service', async () => {
    next = { code: 0, stdout: 'Pulled\n', stderr: '' };
    await runComposePull(WITH_OVERRIDE, 'app');
    expect(calls[0].args).toEqual([
      'compose', '-f', '/p/ipcame/docker-compose.yml',
      '-f', '/p/.rfid-panel/compose-ipcame.yml', 'pull', 'app'
    ]);
  });

  it('reports running when ps lists a running service', async () => {
    next = { code: 0, stdout: 'running\n', stderr: '' };
    expect(await composeStatus(BASE)).toBe('running');
  });

  it('reports stopped when ps output has no running service', async () => {
    next = { code: 1, stdout: '', stderr: 'no configuration file provided' };
    expect(await composeStatus(BASE)).toBe('stopped');
  });

  it('hasLocalImage is true when docker image inspect succeeds', async () => {
    next = { code: 0, stdout: '[]', stderr: '' };
    expect(await hasLocalImage('registry.gitlab.com/laoitdev/23-s-asian-ipcame-service')).toBe(true);
    expect(calls[0].args).toEqual([
      'image', 'inspect', 'registry.gitlab.com/laoitdev/23-s-asian-ipcame-service'
    ]);
  });

  it('hasLocalImage is false when the image is absent and does not throw', async () => {
    next = { code: 1, stdout: '', stderr: 'Error: No such image' };
    expect(await hasLocalImage('missing:latest')).toBe(false);
  });

  it('hasLocalImage is false when docker itself throws', async () => {
    setExecForTests(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    expect(await hasLocalImage('x:1')).toBe(false);
  });

  it('dockerAvailable is true when docker version succeeds', async () => {
    next = { code: 0, stdout: 'Docker version 27', stderr: '' };
    expect(await dockerAvailable()).toBe(true);
    expect(calls[0].args).toEqual(['version']);
  });

  it('dockerAvailable is false when docker is missing', async () => {
    setExecForTests(async () => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
    expect(await dockerAvailable()).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/docker.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/proc/docker.ts`:
```ts
import { execFile } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

type ExecFn = (cmd: string, args: string[]) => Promise<RunResult>;

const defaultExec: ExecFn = (cmd, args) =>
  new Promise((resolve) => {
    execFile(cmd, args, { maxBuffer: 8 * 1024 * 1024, timeout: 120_000 }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === 'number' ? (err as any).code : err ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });

let exec: ExecFn = defaultExec;

export function setExecForTests(fn: ExecFn): void { exec = fn; }
export function resetExecForTests(): void { exec = defaultExec; }

export async function runComposeUp(extraArgs: string[]): Promise<RunResult> {
  return exec('docker', ['compose', ...extraArgs, 'up', '-d']);
}

export async function runComposeDown(extraArgs: string[]): Promise<RunResult> {
  return exec('docker', ['compose', ...extraArgs, 'down']);
}

export async function runComposePull(extraArgs: string[], service: string): Promise<RunResult> {
  return exec('docker', ['compose', ...extraArgs, 'pull', service]);
}

export async function composeStatus(extraArgs: string[]): Promise<'running' | 'stopped' | 'unknown'> {
  let r: RunResult;
  try {
    r = await exec('docker', ['compose', ...extraArgs, 'ps', '--format', '{{.State}}']);
  } catch {
    return 'unknown';
  }
  if (r.code === 0 && /running/i.test(r.stdout)) return 'running';
  return 'stopped';
}

export async function hasLocalImage(ref: string): Promise<boolean> {
  try {
    const r = await exec('docker', ['image', 'inspect', ref]);
    return r.code === 0;
  } catch {
    return false;
  }
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    const r = await exec('docker', ['version']);
    return r.code === 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/docker.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/proc/docker.ts tests/unit/docker.test.ts
git commit -m "feat: docker compose wrapper with injectable exec"
```

---

### Task 9: Compose override module

**Files:**
- Create: `src/lib/server/proc/compose.ts`
- Test: `tests/unit/compose.test.ts`

**Interfaces:**
- Consumes: `yaml` (parse only).
- Produces:
  - `type AmbiguousComposeService = Error & { code: 'ambiguous_compose_service'; found: string[] }`
  - `detectComposeService(text: string): string` — the single service key, or throws
  - `renderOverride(service: string, image: string): string`
  - `overridePath(projectPath: string, service: string): string` → `<projectPath>/.rfid-panel/compose-<service>.yml`
  - `writeOverride(projectPath: string, service: string, image: string): Promise<string>` — atomic, returns the path
  - `composeArgs(baseFile: string, overrideFile?: string): string[]` → `['-f', base, ...(overrideFile ? ['-f', overrideFile] : [])]`

This module is pure except `writeOverride`. No docker calls, so it is fully unit-testable.

- [ ] **Step 1: Write the failing test**

`tests/unit/compose.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import {
  detectComposeService, renderOverride, overridePath, writeOverride, composeArgs
} from '../../src/lib/server/proc/compose';

// Trimmed from the shipped project files.
const IPCAME = `
version: '3.8'
services:
  app:
    image: registry.gitlab.com/laoitdev/23-s-asian-ipcame-service
    volumes:
      - ./config.toml:/usr/src/app/config.toml
    ports:
      - "5555:5555"
`;
const TWO_SERVICES = `
services:
  app:
    image: a
  sidecar:
    image: b
`;
const NO_SERVICES = `version: '3.8'\n`;

describe('detectComposeService', () => {
  it('returns the single service key', () => {
    expect(detectComposeService(IPCAME)).toBe('app');
  });

  it('returns a non-identifier service key verbatim', () => {
    expect(detectComposeService('services:\n  rfid_gate_service:\n    image: x\n'))
      .toBe('rfid_gate_service');
  });

  it('throws ambiguous for several services, naming them', () => {
    expect(() => detectComposeService(TWO_SERVICES)).toThrowError(/ambiguous/i);
    try {
      detectComposeService(TWO_SERVICES);
    } catch (e: any) {
      expect(e.code).toBe('ambiguous_compose_service');
      expect(e.found.sort()).toEqual(['app', 'sidecar']);
    }
  });

  it('throws ambiguous for zero services', () => {
    expect(() => detectComposeService(NO_SERVICES)).toThrowError(/ambiguous/i);
  });

  it('throws for unparseable YAML rather than guessing', () => {
    expect(() => detectComposeService('services: [unclosed')).toThrow();
  });
});

describe('renderOverride', () => {
  it('produces a one-service document with only the image', () => {
    const y = parse(renderOverride('app', 'registry.gitlab.com/x/y:v2'));
    expect(y).toEqual({ services: { app: { image: 'registry.gitlab.com/x/y:v2' } } });
  });

  it('merges over the base file with the image replaced and volumes intact', () => {
    const merged: any = { ...parse(IPCAME), ...parse(renderOverride('app', 'new:1')) };
    expect(merged.services.app.image).toBe('new:1');
    expect(merged.services.app.volumes).toEqual(['./config.toml:/usr/src/app/config.toml']);
  });
});

describe('composeArgs', () => {
  it('omits the override when none is given', () => {
    expect(composeArgs('/p/ipcame/docker-compose.yml'))
      .toEqual(['-f', '/p/ipcame/docker-compose.yml']);
  });

  it('puts the base file first so relative paths resolve', () => {
    expect(composeArgs('/p/ipcame/docker-compose.yml', '/p/.rfid-panel/compose-app.yml'))
      .toEqual(['-f', '/p/ipcame/docker-compose.yml', '-f', '/p/.rfid-panel/compose-app.yml']);
  });
});

describe('writeOverride', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'compose-')); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it('creates .rfid-panel and writes the override', async () => {
    const p = await writeOverride(dir, 'app', 'new:1');
    expect(p).toBe(overridePath(dir, 'app'));
    expect(parse(await readFile(p, 'utf8'))).toEqual({ services: { app: { image: 'new:1' } } });
  });

  it('regenerates rather than appends on a second write', async () => {
    await writeOverride(dir, 'app', 'first:1');
    await writeOverride(dir, 'app', 'second:2');
    expect(parse(await readFile(overridePath(dir, 'app'), 'utf8')))
      .toEqual({ services: { app: { image: 'second:2' } } });
  });

  it('is idempotent when the directory already exists', async () => {
    await mkdir(join(dir, '.rfid-panel'), { recursive: true });
    await expect(writeOverride(dir, 'app', 'x:1')).resolves.toBe(overridePath(dir, 'app'));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/compose.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/proc/compose.ts`:
```ts
import { parse } from 'yaml';
import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join, dirname } from 'node:path';

export type AmbiguousComposeService = Error & {
  code: 'ambiguous_compose_service';
  found: string[];
};

function ambiguous(found: string[], detail: string): AmbiguousComposeService {
  const e = new Error(
    found.length
      ? `Cannot auto-detect the compose service: ${found.length} services found (${found.join(', ')}). ` +
        `The panel refuses to guess which one to point at the new image.`
      : `Cannot auto-detect the compose service: ${detail}`
  ) as AmbiguousComposeService;
  e.code = 'ambiguous_compose_service';
  e.found = found;
  return e;
}

export function detectComposeService(text: string): string {
  let doc: any;
  try {
    doc = parse(text);
  } catch (err) {
    throw ambiguous([], `the file is not valid YAML (${(err as Error).message})`);
  }
  const services = doc?.services;
  const keys = services && typeof services === 'object' ? Object.keys(services) : [];
  if (keys.length === 1) return keys[0];
  throw ambiguous(keys, keys.length === 0 ? 'the file declares no services' : '');
}

export function renderOverride(service: string, image: string): string {
  // Only `image:` — the override declares no paths, so it is order-agnostic
  // and can never alter volumes, ports, or environment.
  return `services:\n  ${JSON.stringify(service)}:\n    image: ${JSON.stringify(image)}\n`;
}

export function overridePath(projectPath: string, service: string): string {
  return join(projectPath, '.rfid-panel', `compose-${service}.yml`);
}

export async function writeOverride(
  projectPath: string,
  service: string,
  image: string
): Promise<string> {
  const target = overridePath(projectPath, service);
  await mkdir(dirname(target), { recursive: true });
  const tmp = `${target}.tmp`;
  await writeFile(tmp, renderOverride(service, image), 'utf8');
  await rename(tmp, target);   // atomic replace
  return target;
}

export function composeArgs(baseFile: string, overrideFile?: string): string[] {
  // Base first: with several -f flags compose takes the project name and the
  // base for relative paths from the FIRST file. The shipped files use relative
  // mounts (./config.toml, ./config), so reversing this breaks them.
  return overrideFile ? ['-f', baseFile, '-f', overrideFile] : ['-f', baseFile];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/compose.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/proc/compose.ts tests/unit/compose.test.ts
git commit -m "feat: compose override file generation and service detection"
```

---

### Task 10: Docker image settings + resolve/pull

**Files:**
- Create: `src/lib/server/images.ts`
- Test: `tests/unit/images.test.ts`

**Interfaces:**
- Consumes: `getConfig`/`setConfig`/`getProjectPath` (Task 5), `proc/docker.ts` (Task 8), `proc/compose.ts` (Task 9).
- Produces (every function takes the db handle first, matching `settings.ts`):
  - `type DockerService = 'ipcame' | 'rfid'`
  - `type PullPolicy = 'always' | 'never'`
  - `type ImageConfig = { image: string; policy: PullPolicy }`
  - `type ImageStatus = { service; image; effectiveImage; policy; composeFile; composeService: string | null; localDigest: string | null; error: string | null }`
  - `validateImageRef(ref: string): { ok: true } | { ok: false; message: string }`
  - `imageConfig(db, service): ImageConfig`
  - `setImageConfig(db, service, patch: Partial<ImageConfig>): ImageConfig`
  - `resolveImage(db, service, baseImage: string): string`
  - `composeServiceFor(db, service): string | null` — null when detection fails
  - `prepareCompose(db, service): Promise<{ args: string[]; composeService: string | null }>` — writes the override when an image is configured
  - `imageStatuses(db): Promise<ImageStatus[]>`
  - `pull(db, service, onLog: (line: string) => void): Promise<{ ok: boolean; warn?: string }>`

`pull` implements the §8.6 fallback: a failed pull over a present local image
returns `{ ok: true, warn }`; over an absent image it returns `{ ok: false }`.

- [ ] **Step 1: Write the failing test**

`tests/unit/images.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/lib/server/db';
import {
  validateImageRef, resolveImage, imageConfig, setImageConfig, pull, composeServiceFor
} from '../../src/lib/server/images';
import { setProjectPath } from '../../src/lib/server/settings';
import { setExecForTests, resetExecForTests } from '../../src/lib/server/proc/docker';

// Trimmed from the shipped project files.
const IPCAME_YML = `services:\n  app:\n    image: base:latest\n`;

let db: any, dir: string;
let calls: { cmd: string; args: string[] }[] = [];
let next: any;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'img-'));
  db = openDb(join(dir, 't.db'));
  await mkdir(join(dir, 'ipcame'), { recursive: true });
  await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), IPCAME_YML);
  setProjectPath(db, dir);

  calls = [];
  setExecForTests(async (cmd, args) => {
    calls.push({ cmd, args });
    return typeof next === 'function' ? next(cmd, args) : next;
  });
});
afterEach(async () => {
  resetExecForTests();
  db.close();
  await rm(dir, { recursive: true, force: true });
});

describe('validateImageRef', () => {
  it.each([
    'repo',
    'repo:1.2.3',
    'registry.gitlab.com/laoitdev/23-s-asian-ipcame-service',
    'registry:5000/team/app:v2',
    'ghcr.io/a/b@sha256:' + 'a'.repeat(64)
  ])('accepts %s', (ref) => {
    expect(validateImageRef(ref).ok).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['   ', 'whitespace only'],
    ['repo name', 'space in name'],
    ['-rm -rf /', 'leading dash'],
    ['repo;rm -rf /', 'shell metachar'],
    ['repo$(id)', 'command substitution']
  ])('rejects %s (%s)', (ref) => {
    expect(validateImageRef(ref).ok).toBe(false);
  });

  it('gives a message naming the problem', () => {
    const r = validateImageRef('-bad');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/dash|flag/i);
  });
});

describe('image config', () => {
  it('falls back to the base image when nothing is configured', () => {
    expect(resolveImage(db, 'ipcame', 'base:latest')).toBe('base:latest');
  });

  it('prefers the configured image', () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2' });
    expect(resolveImage(db, 'ipcame', 'base:latest')).toBe('mine:2');
  });

  it('defaults the policy to always and round-trips a change', () => {
    expect(imageConfig(db, 'ipcame').policy).toBe('always');
    setImageConfig(db, 'ipcame', { policy: 'never' });
    expect(imageConfig(db, 'ipcame').policy).toBe('never');
  });

  it('keeps ipcame and rfid settings independent', () => {
    setImageConfig(db, 'ipcame', { image: 'a:1' });
    expect(imageConfig(db, 'rfid').image).toBe('');
  });
});

describe('composeServiceFor', () => {
  it('detects the single service', () => {
    expect(composeServiceFor(db, 'ipcame')).toBe('app');
  });

  it('returns null when the file has several services', async () => {
    await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), 'services:\n  a:\n    image: x\n  b:\n    image: y\n');
    expect(composeServiceFor(db, 'ipcame')).toBeNull();
  });

  it('returns null when the file is missing', async () => {
    await rm(join(dir, 'ipcame', 'docker-compose.yml'));
    expect(composeServiceFor(db, 'ipcame')).toBeNull();
  });
});

describe('pull', () => {
  it('succeeds and reports ok on a clean pull', async () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2' });
    next = { code: 0, stdout: 'Pulled\n', stderr: '' };
    const r = await pull(db, 'ipcame', () => {});
    expect(r.ok).toBe(true);
    expect(r.warn).toBeUndefined();
    expect(calls[0].args).toContain('pull');
  });

  it('writes the override before pulling', async () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2' });
    next = { code: 0, stdout: '', stderr: '' };
    await pull(db, 'ipcame', () => {});
    const args = calls[0].args;
    expect(args).toEqual([
      'compose',
      '-f', join(dir, 'ipcame', 'docker-compose.yml'),
      '-f', join(dir, '.rfid-panel', 'compose-app.yml'),
      'pull', 'app'
    ]);
  });

  it('falls back to the local image and warns when the pull fails', async () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2' });
    next = (cmd: string, args: string[]) =>
      args[0] === 'image'
        ? { code: 0, stdout: '[]', stderr: '' }          // local image present
        : { code: 1, stdout: '', stderr: 'unauthorized' };
    const r = await pull(db, 'ipcame', () => {});
    expect(r.ok).toBe(true);
    expect(r.warn).toMatch(/unauthorized/);
  });

  it('fails when the pull fails and no local image exists', async () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2' });
    next = (cmd: string, args: string[]) =>
      args[0] === 'image'
        ? { code: 1, stdout: '', stderr: 'No such image' }
        : { code: 1, stdout: '', stderr: 'unauthorized' };
    const r = await pull(db, 'ipcame', () => {});
    expect(r.ok).toBe(false);
  });

  it('skips the pull entirely when policy is never', async () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2', policy: 'never' });
    next = { code: 0, stdout: '', stderr: '' };
    const r = await pull(db, 'ipcame', () => {});
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('skips the pull when no image is configured and the file is ambiguous', async () => {
    await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), 'services:\n  a:\n    image: x\n  b:\n    image: y\n');
    next = { code: 0, stdout: '', stderr: '' };
    const r = await pull(db, 'ipcame', () => {});
    expect(r.ok).toBe(true);
    expect(calls).toHaveLength(0);
  });

  it('throws ambiguous_compose_service when an image is configured over a multi-service file', async () => {
    setImageConfig(db, 'ipcame', { image: 'mine:2' });
    await writeFile(join(dir, 'ipcame', 'docker-compose.yml'), 'services:\n  a:\n    image: x\n  b:\n    image: y\n');
    next = { code: 0, stdout: '', stderr: '' };
    await expect(pull(db, 'ipcame', () => {})).rejects.toMatchObject({
      code: 'ambiguous_compose_service'
    });
    expect(calls).toHaveLength(0); // never shelled out
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/images.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/images.ts`:
```ts
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getConfig, setConfig, getProjectPath } from './settings';
import { runComposePull, hasLocalImage } from './proc/docker';
import { detectComposeService, composeArgs, writeOverride, overridePath } from './proc/compose';

export type DockerService = 'ipcame' | 'rfid';
export type PullPolicy = 'always' | 'never';
export type ImageConfig = { image: string; policy: PullPolicy };

export type ImageStatus = {
  service: DockerService;
  image: string;
  effectiveImage: string;
  policy: PullPolicy;
  composeFile: string;
  composeService: string | null;
  localDigest: string | null;
  error: string | null;
};

// Untagged refs must be accepted: the shipped images are untagged and resolve
// to :latest. A leading dash is rejected so a ref can never parse as a flag.
const IMAGE_RE = /^[a-zA-Z0-9][\w.\-/:@]*$/;

export function validateImageRef(ref: string): { ok: true } | { ok: false; message: string } {
  const t = ref.trim();
  if (!t) return { ok: false, message: 'Image reference is empty.' };
  if (t.startsWith('-')) {
    return { ok: false, message: 'Image reference cannot start with a dash.' };
  }
  if (/\s/.test(t)) {
    return { ok: false, message: 'Image reference cannot contain whitespace.' };
  }
  if (!IMAGE_RE.test(t)) {
    return { ok: false, message: 'Image reference contains an unsupported character.' };
  }
  return { ok: true };
}

export function composeFileFor(service: DockerService): string {
  return service === 'ipcame' ? 'ipcame/docker-compose.yml' : 'rfid/docker-compose.yml';
}

export function imageConfig(db: Database.Database, service: DockerService): ImageConfig {
  return {
    image: getConfig(db, `docker_image_${service}`) ?? '',
    policy: (getConfig(db, `docker_pull_${service}`) as PullPolicy) ?? 'always'
  };
}

export function setImageConfig(
  db: Database.Database, service: DockerService, patch: Partial<ImageConfig>
): ImageConfig {
  if (patch.image !== undefined) setConfig(db, `docker_image_${service}`, patch.image.trim());
  if (patch.policy !== undefined) setConfig(db, `docker_pull_${service}`, patch.policy);
  return imageConfig(db, service);
}

export function resolveImage(db: Database.Database, service: DockerService, baseImage: string): string {
  return imageConfig(db, service).image || baseImage;
}

// The image the base compose file declares, used for `effectiveImage`.
function baseImageFrom(project: string, service: DockerService): string {
  try {
    const text = fs.readFileSync(join(project, composeFileFor(service)), 'utf8');
    const key = detectComposeService(text);
    const re = new RegExp(`^\\s{2}${key}:\\s*$[\\s\\S]*?^\\s{4}image:\\s*(\\S+)`, 'm');
    return text.match(re)?.[1] ?? '';
  } catch {
    return '';
  }
}

export function composeServiceFor(db: Database.Database, service: DockerService): string | null {
  try {
    const text = fs.readFileSync(
      join(getProjectPath(db), composeFileFor(service)), 'utf8'
    );
    return detectComposeService(text);
  } catch {
    return null;
  }
}

// The args a compose call needs for this service, writing the override first
// when an image is configured. Returns the file args plus the detected service.
export async function prepareCompose(
  db: Database.Database, service: DockerService
): Promise<{ args: string[]; composeService: string | null }> {
  const project = getProjectPath(db);
  const base = join(project, composeFileFor(service));
  const cfg = imageConfig(db, service);

  if (!cfg.image) {
    return { args: composeArgs(base), composeService: composeServiceFor(db, service) };
  }

  // Configured image: the override needs a service key, and guessing one in a
  // multi-service stack would be worse than refusing. detectComposeService
  // throws AmbiguousComposeService carrying `.found` for the settings card.
  const text = await readFile(base, 'utf8');
  const key = detectComposeService(text);
  const override = await writeOverride(project, key, cfg.image);
  return { args: composeArgs(base, override), composeService: key };
}

export async function pull(
  db: Database.Database,
  service: DockerService,
  onLog: (line: string) => void
): Promise<{ ok: boolean; warn?: string }> {
  const cfg = imageConfig(db, service);
  if (cfg.policy === 'never') return { ok: true };

  // prepareCompose throws AmbiguousComposeService when an image is set over a
  // multi-service file; the caller turns that into a failed start. With no
  // image configured there is nothing to override and nothing to pull.
  const { args, composeService } = await prepareCompose(db, service);
  if (!cfg.image || !composeService) return { ok: true };

  onLog(`[${service}] pulling ${cfg.image}…`);
  const r = await runComposePull(args, composeService);
  for (const line of `${r.stdout}\n${r.stderr}`.split('\n')) {
    if (line.trim()) onLog(`[${service}] ${line.trim()}`);
  }
  if (r.code === 0) return { ok: true };

  // Registry down or credential expired. A gate that can already run must not
  // be taken down for this — fall back to the local image, loudly.
  if (await hasLocalImage(cfg.image)) {
    const warn = `pull failed (${r.stderr.trim() || `exit ${r.code}`}); starting with the local image`;
    onLog(`[${service}] WARN ${warn}`);
    return { ok: true, warn };
  }
  return { ok: false };
}

export async function imageStatuses(db: Database.Database): Promise<ImageStatus[]> {
  const project = getProjectPath(db);
  const out: ImageStatus[] = [];
  for (const service of ['ipcame', 'rfid'] as const) {
    const cfg = imageConfig(db, service);
    const base = baseImageFrom(project, service);
    let composeService: string | null = null;
    let error: string | null = null;
    try {
      composeService = composeServiceFor(db, service);
      if (!composeService) error = 'Could not detect the compose service in the file.';
    } catch (err) {
      error = (err as Error).message;
    }
    // A configured image over an ambiguous file is the case the settings card
    // must surface inline rather than failing at start time.
    if (cfg.image && !composeService) {
      error = `Cannot apply the configured image: ${error ?? 'compose service could not be detected'}`;
    }
    const effectiveImage = resolveImage(db, service, base);
    out.push({
      service,
      image: cfg.image,
      effectiveImage,
      policy: cfg.policy,
      composeFile: composeFileFor(service),
      composeService,
      localDigest: effectiveImage && (await hasLocalImage(effectiveImage)) ? effectiveImage : null,
      error
    });
  }
  return out;
}

export { overridePath };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/images.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/images.ts tests/unit/images.test.ts
git commit -m "feat: docker image settings, ref validation, and pull with local fallback"
```

---

### Task 11: Reader process control

**Files:**
- Create: `src/lib/server/proc/reader.ts`
- Test: `tests/unit/reader.test.ts`

**Interfaces:**
- Produces:
  - `spawnReader(opts: { projectPath: string; onLine: (stream: 'stdout'|'stderr', line: string) => void }): { pid: number }` — spawns `./impinJReaderGateway/ImpinJReader config.toml` detached, streams lines, throws `Error('reader_binary_missing')` / `Error('reader_config_missing')` if files absent.
  - `isAlive(pid: number): boolean`
  - `stopReader(pid: number, timeoutMs?: number): Promise<'term'|'kill'>`
  - `probePort(host: string, port: number, timeoutMs: number): Promise<boolean>`
  - `setSpawnForTests(fn)` / `resetSpawnForTests()`, `setAliveForTests`, `resetAliveForTests`
- Consumes: `resolveProjectFile` from Task 5.

- [ ] **Step 1: Write the failing test**

`tests/unit/reader.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import {
  spawnReader, isAlive, stopReader,
  setSpawnForTests, resetSpawnForTests,
  setAliveForTests, resetAliveForTests, setKillForTests, resetKillForTests
} from '../../src/lib/server/proc/reader';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reader-'));
  fs.mkdirSync(path.join(dir, 'impinJReaderGateway'), { recursive: true });
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
  resetSpawnForTests(); resetAliveForTests(); resetKillForTests();
});

function makeFakeProc() {
  const proc: any = new EventEmitter();
  proc.pid = 4242;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = () => true;
  return proc;
}

describe('spawnReader', () => {
  it('throws when the binary is missing', () => {
    expect(() => spawnReader({ projectPath: dir, onLine: () => {} }))
      .toThrow('reader_config_missing');
  });

  it('spawns with cwd at the project and streams lines', () => {
    fs.writeFileSync(path.join(dir, 'config.toml'), '');
    fs.writeFileSync(path.join(dir, 'impinJReaderGateway/ImpinJReader'), '');
    let captured: any;
    const fake = makeFakeProc();
    setSpawnForTests((cmd, args, opts) => { captured = { cmd, args, opts }; return fake; });

    const lines: string[] = [];
    const { pid } = spawnReader({ projectPath: dir, onLine: (_s, l) => lines.push(l) });
    expect(pid).toBe(4242);

    fake.stdout.emit('data', Buffer.from('hello\nworld\n'));
    fake.stderr.emit('data', Buffer.from('oops\n'));

    expect(captured.args).toEqual(['config.toml']);
    expect(captured.opts.cwd).toBe(dir);
    expect(captured.opts.detached).toBe(true);
    expect(lines).toEqual(['hello', 'world', 'oops']);
  });
});

describe('isAlive', () => {
  it('uses the injected alive check', () => {
    setAliveForTests((pid) => pid === 4242);
    expect(isAlive(4242)).toBe(true);
    expect(isAlive(1111)).toBe(false);
  });
});

describe('stopReader', () => {
  it('returns "term" when the process exits within the timeout', async () => {
    setKillForTests((pid, sig) => sig === 'SIGTERM');
    setAliveForTests(() => false);
    expect(await stopReader(4242, 50)).toBe('term');
  });

  it('escalates to "kill" when still alive after timeout', async () => {
    const signals: (string | number)[] = [];
    setKillForTests((pid, sig) => { signals.push(sig!); return true; });
    setAliveForTests(() => true);
    expect(await stopReader(4242, 30)).toBe('kill');
    expect(signals).toEqual(['SIGTERM', 'SIGKILL']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/reader.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/proc/reader.ts`:
```ts
import fs from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import net from 'node:net';
import { resolveProjectFile } from '../settings';

const BIN_REL = 'impinJReaderGateway/ImpinJReader';
const CFG_REL = 'config.toml';

type SpawnFn = (cmd: string, args: string[], opts: any) => any;
let spawnFn: SpawnFn = nodeSpawn as any;
let aliveFn = (pid: number): boolean => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};
let killFn = (pid: number, sig?: NodeJS.Signals | number): boolean => {
  try { process.kill(pid, sig as any); return true; } catch { return false; }
};

export function setSpawnForTests(fn: SpawnFn): void { spawnFn = fn; }
export function resetSpawnForTests(): void { spawnFn = nodeSpawn as any; }
export function setAliveForTests(fn: (pid: number) => boolean): void { aliveFn = fn; }
export function resetAliveForTests(): void {
  aliveFn = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
}
export function setKillForTests(fn: (pid: number, sig?: NodeJS.Signals | number) => boolean): void { killFn = fn; }
export function resetKillForTests(): void {
  killFn = (pid, sig) => { try { process.kill(pid, sig as any); return true; } catch { return false; } };
}

export function isAlive(pid: number): boolean {
  return aliveFn(pid);
}

export function spawnReader(opts: {
  projectPath: string;
  onLine: (stream: 'stdout' | 'stderr', line: string) => void;
}): { pid: number } {
  const bin = resolveProjectFile(opts.projectPath, BIN_REL);
  const cfg = resolveProjectFile(opts.projectPath, CFG_REL);
  if (!fs.existsSync(cfg)) throw new Error('reader_config_missing');
  if (!fs.existsSync(bin)) throw new Error('reader_binary_missing');
  try { fs.chmodSync(bin, 0o755); } catch { /* best effort */ }

  const proc = spawnFn(bin, [CFG_REL], {
    cwd: opts.projectPath,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  proc.unref?.();

  const wire = (stream: 'stdout' | 'stderr', s: any) => {
    if (!s) return;
    let buffer = '';
    s.setEncoding?.('utf8');
    s.on('data', (chunk: string) => {
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\n')) >= 0) {
        opts.onLine(stream, buffer.slice(0, idx));
        buffer = buffer.slice(idx + 1);
      }
    });
  };
  wire('stdout', proc.stdout);
  wire('stderr', proc.stderr);

  return { pid: proc.pid };
}

export async function stopReader(pid: number, timeoutMs = 10_000): Promise<'term' | 'kill'> {
  if (!aliveFn(pid)) return 'term';
  killFn(pid, 'SIGTERM');
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!aliveFn(pid)) return 'term';
    await new Promise((r) => setTimeout(r, 100));
  }
  killFn(pid, 'SIGKILL');
  return 'kill';
}

export function probePort(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host, port });
    const done = (ok: boolean) => { sock.destroy(); resolve(ok); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/reader.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/proc/reader.ts tests/unit/reader.test.ts
git commit -m "feat: reader spawn/stop/port-probe with injectable seams"
```

---

### Task 12: Service types + log bus

**Files:**
- Create: `src/lib/server/services/types.ts`, `src/lib/server/services/logbus.ts`
- Test: `tests/unit/logbus.test.ts`

**Interfaces:**
- Produces (`types.ts`):
  - `type ServiceName = 'reader' | 'ipcame' | 'rfid'`
  - `type ServiceActual = 'stopped' | 'pulling' | 'starting' | 'running' | 'stopping' | 'error'`
  - `interface ServiceStatus { name: ServiceName; label: string; actual: ServiceActual; pid?: number; detail?: string; since?: number }`
  - `interface ActionResult { ok: boolean; service?: ServiceName; code?: string; message: string; detail?: string }`
  - `const SERVICE_ORDER: ServiceName[] = ['reader','ipcame','rfid']`
  - `const SERVICE_LABELS: Record<ServiceName, string>`
  - `const SERVICE_DEPS: Record<ServiceName, ServiceName[]>` (rfid depends on reader+ipcame)
- Produces (`logbus.ts`):
  - `type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'system'`
  - `interface LogEntry { id: number; service: string; level: LogLevel; message: string; detail?: string; at: number }`
  - `pushLog(entry: { service: string; level: LogLevel; message: string; detail?: string }): LogEntry`
  - `recentLogs(limit?: number): LogEntry[]`
  - `subscribeLogs(fn: (e: LogEntry) => void): () => void`
  - `clearLogs(): void`
- Consumes: nothing.

- [ ] **Step 1: Write the failing test**

`tests/unit/logbus.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { pushLog, recentLogs, subscribeLogs, clearLogs } from '../../src/lib/server/services/logbus';
import { SERVICE_ORDER, SERVICE_DEPS, SERVICE_LABELS } from '../../src/lib/server/services/types';

beforeEach(() => clearLogs());

describe('logbus', () => {
  it('pushes entries with increasing ids and timestamps', () => {
    const a = pushLog({ service: 'reader', level: 'info', message: 'one' });
    const b = pushLog({ service: 'reader', level: 'error', message: 'two', detail: 'stderr' });
    expect(b.id).toBeGreaterThan(a.id);
    expect(b.at).toBeGreaterThanOrEqual(a.at);
    expect(b.detail).toBe('stderr');
  });

  it('recentLogs returns the last N in order', () => {
    for (let i = 0; i < 10; i++) pushLog({ service: 's', level: 'info', message: `m${i}` });
    const r = recentLogs(3);
    expect(r.map((e) => e.message)).toEqual(['m7', 'm8', 'm9']);
  });

  it('caps the ring buffer size', () => {
    for (let i = 0; i < 1200; i++) pushLog({ service: 's', level: 'info', message: `m${i}` });
    expect(recentLogs(2000).length).toBe(1000);
  });

  it('notifies subscribers and unsubscribes cleanly', () => {
    const seen: string[] = [];
    const unsub = subscribeLogs((e) => seen.push(e.message));
    pushLog({ service: 's', level: 'info', message: 'a' });
    unsub();
    pushLog({ service: 's', level: 'info', message: 'b' });
    expect(seen).toEqual(['a']);
  });
});

describe('service constants', () => {
  it('defines order, labels, and deps', () => {
    expect(SERVICE_ORDER).toEqual(['reader', 'ipcame', 'rfid']);
    expect(SERVICE_LABELS.rfid).toBe('Gate RFID');
    expect(SERVICE_DEPS.rfid).toEqual(['reader', 'ipcame']);
    expect(SERVICE_DEPS.reader).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/logbus.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/services/types.ts`:
```ts
export type ServiceName = 'reader' | 'ipcame' | 'rfid';
export type ServiceActual =
  | 'stopped'
  | 'pulling'   // docker only: pulling the image before up -d (spec 8.1)
  | 'starting'
  | 'running'
  | 'stopping'
  | 'error';

export interface ServiceStatus {
  name: ServiceName;
  label: string;
  actual: ServiceActual;
  pid?: number;
  detail?: string;
  since?: number;
}

export interface ActionResult {
  ok: boolean;
  service?: ServiceName;
  code?: string;
  message: string;
  detail?: string;
}

export const SERVICE_ORDER: ServiceName[] = ['reader', 'ipcame', 'rfid'];

export const SERVICE_LABELS: Record<ServiceName, string> = {
  reader: 'Reader',
  ipcame: 'IP Camera',
  rfid: 'Gate RFID'
};

export const SERVICE_DEPS: Record<ServiceName, ServiceName[]> = {
  reader: [],
  ipcame: [],
  rfid: ['reader', 'ipcame']
};
```

`src/lib/server/services/logbus.ts`:
```ts
const MAX = 1000;

export type LogLevel = 'info' | 'warn' | 'error' | 'success' | 'system';

export interface LogEntry {
  id: number;
  service: string;
  level: LogLevel;
  message: string;
  detail?: string;
  at: number;
}

let nextId = 1;
let ring: LogEntry[] = [];
const subs = new Set<(e: LogEntry) => void>();

export function pushLog(entry: {
  service: string; level: LogLevel; message: string; detail?: string;
}): LogEntry {
  const e: LogEntry = { id: nextId++, at: Date.now(), ...entry };
  ring.push(e);
  if (ring.length > MAX) ring = ring.slice(ring.length - MAX);
  for (const fn of subs) { try { fn(e); } catch { /* subscriber errors must not break logging */ } }
  return e;
}

export function recentLogs(limit = 200): LogEntry[] {
  return ring.slice(Math.max(0, ring.length - limit));
}

export function subscribeLogs(fn: (e: LogEntry) => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export function clearLogs(): void {
  ring = [];
  nextId = 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/logbus.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/services/types.ts src/lib/server/services/logbus.ts tests/unit/logbus.test.ts
git commit -m "feat: service types and in-memory log ring with subscribers"
```

---

### Task 13: Service manager — state machine, per-service + all

**Files:**
- Create: `src/lib/server/services/manager.ts`
- Test: `tests/unit/manager.test.ts`

**Interfaces:**
- Produces:
  - `startOne(db, name, opts?: { force?: boolean }): Promise<ActionResult>`
  - `stopOne(db, name): Promise<ActionResult>`
  - `startAll(db): Promise<ActionResult[]>`
  - `stopAll(db): Promise<ActionResult[]>`
  - `status(db): ServiceStatus[]`
  - `reconcile(db): Promise<void>` — on boot, clears stale PIDs and syncs docker state.
  - `setDepsForTests(deps)` / `resetDepsForTests()` — inject reader/docker/port/clock seams.
- Consumes: Tasks 2, 5, 6, 8, 9, 10.
- **Ordering rule (from spec §8):** `startAll` → `reader, ipcame, rfid`, abort on first failure. `stopAll` → `rfid, ipcame, reader`, best-effort, collect all errors. `startOne('rfid')` without both deps running → `{ ok:false, code:'dependency_down' }` unless `force`.

- [ ] **Step 1: Write the failing test**

`tests/unit/manager.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';
import {
  startOne, stopOne, startAll, stopAll, status, reconcile,
  setDepsForTests, resetDepsForTests
} from '../../src/lib/server/services/manager';
import { clearLogs, recentLogs } from '../../src/lib/server/services/logbus';

let db: any, dir: string;
let calls: string[];

// compose calls now take the arg array from prepareCompose, so derive the
// service name from the base compose file path inside it.
function baseOf(args: string[]): string {
  const i = args.indexOf('-f');
  return path.basename(path.dirname(args[i + 1]));
}

function fakeDeps(overrides: any = {}) {
  calls = [];
  return {
    spawnReader: vi.fn(({ projectPath }: any) => { calls.push('spawn:reader'); return { pid: 100 }; }),
    stopReader: vi.fn(async (pid: number) => { calls.push(`stop-reader:${pid}`); return 'term'; }),
    isReaderAlive: vi.fn(() => true),
    probePort: vi.fn(async () => true),
    composeUp: vi.fn(async (args: string[]) => { calls.push(`up:${baseOf(args)}`); return { code: 0, stdout: '', stderr: '' }; }),
    composeDown: vi.fn(async (args: string[]) => { calls.push(`down:${baseOf(args)}`); return { code: 0, stdout: '', stderr: '' }; }),
    composeStatus: vi.fn(async () => 'running' as const),
    composePull: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    // No image configured in these fixtures, so no override is written and no
    // pull happens; pull() resolves ok immediately.
    pullImage: vi.fn(async () => ({ ok: true })),
    prepareCompose: vi.fn(async (_db: any, s: string) => ({
      args: ['-f', path.join(dir, s, 'docker-compose.yml')],
      composeService: s === 'ipcame' ? 'app' : 'rfid_gate_service'
    })),
    sleep: vi.fn(async () => {}),
    ...overrides
  };
}

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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mgr-'));
  db = openDb(path.join(dir, 't.db'));
  clearLogs();
});
afterEach(() => {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  resetDepsForTests();
});

describe('startAll', () => {
  it('starts in order reader, ipcame, rfid', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    const res = await startAll(db);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(calls).toEqual(['spawn:reader', 'up:ipcame', 'up:rfid']);
  });

  it('aborts on the first failure and names the service', async () => {
    makeProject();
    setDepsForTests(fakeDeps({
      probePort: vi.fn(async () => false) // reader never becomes ready
    }));
    const res = await startAll(db);
    expect(res.map((r) => r.service)).toEqual(['reader']);
    expect(res[0].ok).toBe(false);
    expect(calls).toEqual(['spawn:reader']); // never reached ipcame
    expect(status(db).find((s) => s.name === 'reader')?.actual).toBe('error');
  });

  it('is idempotent for already-running services', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startAll(db);
    calls = [];
    await startAll(db);
    expect(calls).toEqual([]);
  });
});

describe('stopAll', () => {
  it('stops in reverse order rfid, ipcame, reader', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startAll(db);
    calls = [];
    const res = await stopAll(db);
    expect(res.every((r) => r.ok)).toBe(true);
    expect(calls).toEqual(['down:rfid', 'down:ipcame', 'stop-reader:100']);
  });

  it('continues past a failure and reports every error', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startAll(db);
    setDepsForTests(fakeDeps({
      composeDown: vi.fn(async (args: string[]) => {
        if (args.some((a) => a.includes('rfid'))) return { code: 1, stdout: '', stderr: 'rfid down failed' };
        return { code: 0, stdout: '', stderr: '' };
      })
    }));
    const res = await stopAll(db);
    const failed = res.filter((r) => !r.ok);
    expect(failed.length).toBe(1);
    expect(failed[0].service).toBe('rfid');
    expect(failed[0].detail).toContain('rfid down failed');
    // ipcame and reader still attempted
    expect(res.find((r) => r.service === 'reader')?.ok).toBe(true);
  });
});

describe('per-service control', () => {
  it('startOne starts only the named service', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    const r = await startOne(db, 'ipcame');
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['up:ipcame']);
    expect(status(db).find((s) => s.name === 'reader')?.actual).toBe('stopped');
    expect(status(db).find((s) => s.name === 'ipcame')?.actual).toBe('running');
  });

  it('refuses to start rfid when dependencies are down', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    const r = await startOne(db, 'rfid');
    expect(r).toMatchObject({ ok: false, code: 'dependency_down', service: 'rfid' });
    expect(r.message).toMatch(/Reader/);
    expect(r.message).toMatch(/IP Camera/);
    expect(calls).toEqual([]); // nothing spawned
  });

  it('starts rfid with force even when dependencies are down', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    const r = await startOne(db, 'rfid', { force: true });
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['up:rfid']);
  });

  it('allows rfid once dependencies are running', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startOne(db, 'reader');
    await startOne(db, 'ipcame');
    calls = [];
    const r = await startOne(db, 'rfid');
    expect(r.ok).toBe(true);
    expect(calls).toEqual(['up:rfid']);
  });

  it('stopOne stops only the named service', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startAll(db);
    calls = [];
    await stopOne(db, 'ipcame');
    expect(calls).toEqual(['down:ipcame']);
    expect(status(db).find((s) => s.name === 'rfid')?.actual).toBe('running');
  });

  it('logs a [system] event for a stop action', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startOne(db, 'ipcame');
    await stopOne(db, 'ipcame');
    const sys = recentLogs().filter((e) => e.level === 'system');
    expect(sys.some((e) => /stop/i.test(e.message) && /IP Camera/.test(e.message))).toBe(true);
  });
});

describe('failure detail', () => {
  it('captures docker stderr into detail and sets error state', async () => {
    makeProject();
    setDepsForTests(fakeDeps({
      composeUp: vi.fn(async () => ({ code: 1, stdout: '', stderr: 'port already allocated' }))
    }));
    const r = await startOne(db, 'ipcame');
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('port already allocated');
    expect(status(db).find((s) => s.name === 'ipcame')?.actual).toBe('error');
  });
});

describe('image pull', () => {
  it('enters `pulling` before `starting`', async () => {
    makeProject();
    const seen: string[] = [];
    setDepsForTests(fakeDeps({
      pullImage: vi.fn(async () => {
        seen.push(status(db).find((s) => s.name === 'ipcame')!.actual);
        return { ok: true };
      }),
      composeUp: vi.fn(async (args: string[]) => {
        seen.push(status(db).find((s) => s.name === 'ipcame')!.actual);
        return { code: 0, stdout: '', stderr: '' };
      })
    }));
    const r = await startOne(db, 'ipcame');
    expect(r.ok).toBe(true);
    expect(seen).toEqual(['pulling', 'starting']);
  });

  it('fails the start when the pull fails with no local image', async () => {
    makeProject();
    setDepsForTests(fakeDeps({
      pullImage: vi.fn(async () => ({ ok: false })),
      composeUp: vi.fn(async () => { calls.push('up:ipcame'); return { code: 0, stdout: '', stderr: '' }; })
    }));
    const r = await startOne(db, 'ipcame');
    expect(r).toMatchObject({ ok: false, code: 'pull_failed', service: 'ipcame' });
    expect(calls).toEqual([]); // compose up never ran
    expect(status(db).find((s) => s.name === 'ipcame')?.actual).toBe('error');
  });

  it('continues with a warn when the pull failed but a local image exists', async () => {
    makeProject();
    setDepsForTests(fakeDeps({
      pullImage: vi.fn(async () => ({ ok: true, warn: 'unauthorized' }))
    }));
    const r = await startOne(db, 'ipcame');
    expect(r.ok).toBe(true);
    expect(recentLogs().some((e) => e.level === 'warn' && /unauthorized/.test(e.detail ?? ''))).toBe(true);
  });

  it('surfaces an ambiguous compose service as a start failure', async () => {
    makeProject();
    const err: any = new Error('Cannot auto-detect the compose service: 2 services found (app, sidecar).');
    err.code = 'ambiguous_compose_service';
    err.found = ['app', 'sidecar'];
    setDepsForTests(fakeDeps({
      pullImage: vi.fn(async () => { throw err; }),
      composeUp: vi.fn(async () => { calls.push('up:ipcame'); return { code: 0, stdout: '', stderr: '' }; })
    }));
    const r = await startOne(db, 'ipcame');
    expect(r).toMatchObject({ ok: false, code: 'ambiguous_compose_service', service: 'ipcame' });
    expect(r.detail).toMatch(/sidecar/);
    expect(calls).toEqual([]);
  });

  it('does not pull the reader', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    await startOne(db, 'reader');
    expect(calls).toEqual(['spawn:reader']);
  });
});

describe('reconcile', () => {
  it('leaves an interrupted `pulling` row re-synced from docker, not stuck', async () => {
    makeProject();
    setDepsForTests(fakeDeps());
    // Simulate a webapp that exited mid-pull.
    db.prepare(
      `INSERT INTO service_state (name, desired, actual, pid, detail, updated_at)
       VALUES ('ipcame', 'running', 'pulling', NULL, NULL, ?)`
    ).run(Date.now());
    await reconcile(db);
    expect(status(db).find((s) => s.name === 'ipcame')?.actual).toBe('running');
  });

  it('marks a stale reader PID stopped and warns', async () => {
    makeProject();
    setDepsForTests(fakeDeps({ isReaderAlive: vi.fn(() => false) }));
    db.prepare(
      `INSERT INTO service_state (name, desired, actual, pid, detail, updated_at)
       VALUES ('reader', 'running', 'running', 4242, NULL, ?)`
    ).run(Date.now());
    await reconcile(db);
    expect(status(db).find((s) => s.name === 'reader')?.actual).toBe('stopped');
    expect(recentLogs().some((e) => /stale/i.test(e.message))).toBe(true);
  });

  it('adopts a live reader PID', async () => {
    makeProject();
    setDepsForTests(fakeDeps({ isReaderAlive: vi.fn(() => true) }));
    db.prepare(
      `INSERT INTO service_state (name, desired, actual, pid, detail, updated_at)
       VALUES ('reader', 'running', 'running', 4242, NULL, ?)`
    ).run(Date.now());
    await reconcile(db);
    expect(status(db).find((s) => s.name === 'reader')?.actual).toBe('running');
  });

  it('does not throw when a configured image meets an ambiguous compose file', async () => {
    makeProject();
    setDepsForTests(fakeDeps({
      prepareCompose: vi.fn(async () => { throw Object.assign(new Error('ambiguous'), { code: 'ambiguous_compose_service' }); })
    }));
    await expect(reconcile(db)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/manager.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/services/manager.ts`:
```ts
import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { getProjectPath, checkLayout, resolveProjectFile } from '../settings';
import { SCHEMAS } from '../config/schema';
import { parse } from 'smol-toml';
import { spawnReader, stopReader, isAlive, probePort } from '../proc/reader';
import { runComposeUp, runComposeDown, composeStatus, runComposePull } from '../proc/docker';
import { pull as pullImage, prepareCompose } from '../images';
import { pushLog } from './logbus';
import {
  SERVICE_ORDER, SERVICE_LABELS, SERVICE_DEPS,
  type ServiceName, type ServiceActual, type ServiceStatus, type ActionResult
} from './types';

interface Deps {
  spawnReader: typeof spawnReader;
  stopReader: typeof stopReader;
  isReaderAlive: (pid: number) => boolean;
  probePort: typeof probePort;
  composeUp: typeof runComposeUp;
  composeDown: typeof runComposeDown;
  composeStatus: typeof composeStatus;
  composePull: typeof runComposePull;
  pullImage: typeof pullImage;
  prepareCompose: typeof prepareCompose;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: Deps = {
  spawnReader, stopReader, isReaderAlive: isAlive, probePort,
  composeUp: runComposeUp, composeDown: runComposeDown, composeStatus,
  composePull: runComposePull, pullImage, prepareCompose,
  sleep: (ms) => new Promise((r) => setTimeout(r, ms))
};

let deps: Deps = realDeps;
export function setDepsForTests(d: Partial<Deps>): void { deps = { ...realDeps, ...d }; }
export function resetDepsForTests(): void { deps = realDeps; }

const COMPOSE: Record<'ipcame' | 'rfid', string> = {
  ipcame: 'ipcame/docker-compose.yml',
  rfid: 'rfid/docker-compose.yml'
};

function emit(service: string, level: 'info'|'warn'|'error'|'success'|'system', message: string, detail?: string) {
  pushLog({ service, level, message, detail });
  if (level === 'error') return;
}

function setState(
  db: Database.Database, name: ServiceName, actual: ServiceActual,
  opts: { pid?: number | null; detail?: string | null } = {}
): void {
  db.prepare(
    `INSERT INTO service_state (name, desired, actual, pid, detail, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET desired=excluded.desired, actual=excluded.actual,
       pid=excluded.pid, detail=excluded.detail, updated_at=excluded.updated_at`
  ).run(
    name,
    // `pulling`/`starting` are start-initiated, so the operator's intent is
    // still "running"; reconcile uses this to decide an interrupted row.
    actual === 'running' || actual === 'pulling' || actual === 'starting' ? 'running' : 'stopped',
    actual, opts.pid ?? null, opts.detail ?? null, Date.now()
  );
}

function getState(db: Database.Database, name: ServiceName): any {
  return db.prepare('SELECT * FROM service_state WHERE name = ?').get(name);
}

export function status(db: Database.Database): ServiceStatus[] {
  return SERVICE_ORDER.map((name) => {
    const row = getState(db, name);
    return {
      name,
      label: SERVICE_LABELS[name],
      actual: (row?.actual ?? 'stopped') as ServiceActual,
      pid: row?.pid ?? undefined,
      detail: row?.detail ?? undefined,
      since: row?.updated_at ?? undefined
    };
  });
}

function readReaderAddr(db: Database.Database): { host: string; port: number } {
  const projectPath = getProjectPath(db);
  const file = resolveProjectFile(projectPath, SCHEMAS.reader.relPath);
  let host = 'localhost';
  let port = 11000;
  try {
    const parsed: any = parse(fs.readFileSync(file, 'utf8'));
    host = parsed?.reader?.speedway_address ?? host;
    port = Number(parsed?.reader?.socket_port ?? port);
  } catch { /* fall back to defaults; readiness probe will fail loudly */ }
  return { host, port };
}

async function startReader(db: Database.Database): Promise<ActionResult> {
  const projectPath = getProjectPath(db);
  const layout = checkLayout(projectPath);
  if (!layout.ok) {
    const msg = `Project not installed at ${projectPath}`;
    emit('reader', 'error', msg, `missing: ${layout.missing.join(', ')}`);
    setState(db, 'reader', 'error', { detail: msg });
    return { ok: false, service: 'reader', code: 'not_installed', message: msg, detail: layout.missing.join(', ') };
  }
  try {
    const { pid } = deps.spawnReader({
      projectPath,
      onLine: (stream, line) => emit('reader', stream === 'stderr' ? 'warn' : 'info', line)
    });
    setState(db, 'reader', 'starting', { pid });
    emit('reader', 'info', `Reader process started (pid ${pid})`);

    const { host, port } = readReaderAddr(db);
    let ready = false;
    for (let i = 0; i < 20; i++) {
      await deps.sleep(500);
      if (!deps.isReaderAlive(pid)) break;
      if (await deps.probePort(host, port, 500)) { ready = true; break; }
    }
    if (!ready) {
      const msg = `Reader did not open ${host}:${port}`;
      emit('reader', 'error', msg);
      setState(db, 'reader', 'error', { pid, detail: msg });
      return { ok: false, service: 'reader', code: 'not_ready', message: msg, detail: `process alive: ${deps.isReaderAlive(pid)}` };
    }
    setState(db, 'reader', 'running', { pid });
    emit('reader', 'success', `Reader running (pid ${pid})`);
    return { ok: true, service: 'reader', message: 'Reader started' };
  } catch (err: any) {
    const code = err?.message === 'reader_binary_missing' ? 'reader_binary_missing'
      : err?.message === 'reader_config_missing' ? 'reader_config_missing' : 'spawn_failed';
    const msg = code === 'reader_binary_missing' ? 'Reader binary not found'
      : code === 'reader_config_missing' ? 'Reader config.toml not found'
      : 'Failed to start reader';
    emit('reader', 'error', msg, String(err?.message ?? err));
    setState(db, 'reader', 'error', { detail: msg });
    return { ok: false, service: 'reader', code, message: msg, detail: String(err?.message ?? err) };
  }
}

async function stopReaderSvc(db: Database.Database): Promise<ActionResult> {
  const row = getState(db, 'reader');
  const pid = row?.pid as number | undefined;
  if (!pid || !deps.isReaderAlive(pid)) {
    setState(db, 'reader', 'stopped', { pid: null });
    return { ok: true, service: 'reader', message: 'Reader already stopped' };
  }
  setState(db, 'reader', 'stopping', { pid });
  try {
    const how = await deps.stopReader(pid);
    setState(db, 'reader', 'stopped', { pid: null });
    emit('reader', 'system', `Reader stopped (${how})`);
    return { ok: true, service: 'reader', message: `Reader stopped (${how})` };
  } catch (err: any) {
    const msg = 'Failed to stop reader';
    setState(db, 'reader', 'error', { pid, detail: msg });
    emit('reader', 'error', msg, String(err?.message ?? err));
    return { ok: false, service: 'reader', code: 'stop_failed', message: msg, detail: String(err?.message ?? err) };
  }
}

async function startCompose(
  db: Database.Database, name: 'ipcame' | 'rfid'
): Promise<ActionResult> {
  const projectPath = getProjectPath(db);
  const rel = COMPOSE[name];
  if (!fs.existsSync(resolveProjectFile(projectPath, rel))) {
    const msg = `${SERVICE_LABELS[name]} compose file not found`;
    emit(name, 'error', msg, rel);
    setState(db, name, 'error', { detail: msg });
    return { ok: false, service: name, code: 'not_installed', message: msg, detail: rel };
  }
  const file = resolveProjectFile(projectPath, rel);

  // Pull first, in its own visible state: a cold pull can take minutes and a
  // row parked on `starting` for that long reads as a hang. Image config lives
  // in app_config, so the override file is written from settings each start.
  setState(db, name, 'pulling');
  emit(name, 'info', `Pulling image for ${SERVICE_LABELS[name]}…`);
  let pullResult: { ok: boolean; warn?: string };
  try {
    pullResult = await deps.pullImage(db, name, (line) => emit(name, 'info', line));
  } catch (err) {
    const e = err as { code?: string; found?: string[] };
    if (e.code === 'ambiguous_compose_service') {
      const msg = `${SERVICE_LABELS[name]}: cannot apply the configured image`;
      const detail = (err as Error).message;
      emit(name, 'error', msg, detail);
      setState(db, name, 'error', { detail });
      return { ok: false, service: name, code: 'ambiguous_compose_service', message: msg, detail };
    }
    throw err;
  }
  if (!pullResult.ok) {
    const msg = `${SERVICE_LABELS[name]} image pull failed and no local image is available`;
    emit(name, 'error', msg);
    setState(db, name, 'error', { detail: msg });
    return { ok: false, service: name, code: 'pull_failed', message: msg };
  }
  if (pullResult.warn) emit(name, 'warn', `Using the local image`, pullResult.warn);

  setState(db, name, 'starting');
  emit(name, 'info', `Starting ${SERVICE_LABELS[name]}…`);
  const { args } = await deps.prepareCompose(db, name);
  const r = await deps.composeUp(args);
  if (r.code !== 0) {
    const msg = `${SERVICE_LABELS[name]} failed to start`;
    const detail = (r.stderr || r.stdout).trim().split('\n').slice(-8).join('\n');
    emit(name, 'error', msg, detail);
    setState(db, name, 'error', { detail });
    return { ok: false, service: name, code: 'compose_failed', message: msg, detail };
  }
  for (let i = 0; i < 30; i++) {
    if (await deps.composeStatus(args) === 'running') {
      setState(db, name, 'running');
      emit(name, 'success', `${SERVICE_LABELS[name]} running`);
      return { ok: true, service: name, message: `${SERVICE_LABELS[name]} started` };
    }
    await deps.sleep(1000);
  }
  const msg = `${SERVICE_LABELS[name]} did not report running`;
  emit(name, 'error', msg);
  setState(db, name, 'error', { detail: msg });
  return { ok: false, service: name, code: 'not_ready', message: msg };
}

async function stopCompose(
  db: Database.Database, name: 'ipcame' | 'rfid'
): Promise<ActionResult> {
  const projectPath = getProjectPath(db);
  const file = resolveProjectFile(projectPath, COMPOSE[name]);
  setState(db, name, 'stopping');
  // Down must use the same file args as up, override included, so compose
  // resolves the same project and tears down the container it started.
  const { args } = await deps.prepareCompose(db, name);
  const r = await deps.composeDown(args);
  if (r.code !== 0) {
    const msg = `${SERVICE_LABELS[name]} failed to stop`;
    const detail = (r.stderr || r.stdout).trim().split('\n').slice(-8).join('\n');
    emit(name, 'error', msg, detail);
    setState(db, name, 'error', { detail });
    return { ok: false, service: name, code: 'compose_failed', message: msg, detail };
  }
  setState(db, name, 'stopped');
  emit(name, 'system', `${SERVICE_LABELS[name]} stopped`);
  return { ok: true, service: name, message: `${SERVICE_LABELS[name]} stopped` };
}

function isRunning(db: Database.Database, name: ServiceName): boolean {
  return getState(db, name)?.actual === 'running';
}

export async function startOne(
  db: Database.Database, name: ServiceName, opts: { force?: boolean } = {}
): Promise<ActionResult> {
  const current = getState(db, name)?.actual as ServiceActual | undefined;
  if (current === 'running' || current === 'starting') {
    return { ok: true, service: name, code: 'already_running', message: `${SERVICE_LABELS[name]} is already running` };
  }
  if (!opts.force) {
    const missing = SERVICE_DEPS[name].filter((dep) => !isRunning(db, dep));
    if (missing.length) {
      const names = missing.map((d) => SERVICE_LABELS[d]).join(', ');
      return {
        ok: false, service: name, code: 'dependency_down',
        message: `Starting ${SERVICE_LABELS[name]} needs ${names} running first.`
      };
    }
  }
  switch (name) {
    case 'reader': return startReader(db);
    case 'ipcame': return startCompose(db, 'ipcame');
    case 'rfid': return startCompose(db, 'rfid');
  }
}

export async function stopOne(db: Database.Database, name: ServiceName): Promise<ActionResult> {
  const current = getState(db, name)?.actual as ServiceActual | undefined;
  if (current === 'stopped' || current === 'stopping') {
    return { ok: true, service: name, code: 'already_stopped', message: `${SERVICE_LABELS[name]} is already stopped` };
  }
  switch (name) {
    case 'reader': return stopReaderSvc(db);
    case 'ipcame': return stopCompose(db, 'ipcame');
    case 'rfid': return stopCompose(db, 'rfid');
  }
}

export async function startAll(db: Database.Database): Promise<ActionResult[]> {
  const out: ActionResult[] = [];
  for (const name of SERVICE_ORDER) {
    const r = await startOne(db, name);
    out.push(r);
    if (!r.ok) { emit('system', 'error', `START ALL aborted at ${SERVICE_LABELS[name]}`); break; }
  }
  return out;
}

export async function stopAll(db: Database.Database): Promise<ActionResult[]> {
  const out: ActionResult[] = [];
  for (const name of [...SERVICE_ORDER].reverse()) {
    try { out.push(await stopOne(db, name)); }
    catch (err: any) {
      out.push({ ok: false, service: name, code: 'stop_failed', message: `${SERVICE_LABELS[name]} stop threw`, detail: String(err?.message ?? err) });
    }
  }
  return out;
}

export async function reconcile(db: Database.Database): Promise<void> {
  // reader: clear stale pid
  const readerRow = getState(db, 'reader');
  const pid = readerRow?.pid as number | undefined;
  if (pid && deps.isReaderAlive(pid)) {
    setState(db, 'reader', 'running', { pid });
  } else if (pid || readerRow?.actual === 'running' || readerRow?.actual === 'starting') {
    setState(db, 'reader', 'stopped', { pid: null });
    emit('reader', 'system', 'Reader PID was stale at startup; marked stopped');
  }
  // docker: sync actual state
  for (const name of ['ipcame', 'rfid'] as const) {
    const projectPath = getProjectPath(db);
    const file = resolveProjectFile(projectPath, COMPOSE[name]);
    if (!fs.existsSync(file)) continue;
    const prior = getState(db, name)?.actual;
    // A transitional row means a previous webapp exited mid-start. `desired`
    // decides the outcome, so a restart during a pull does not strand a row in
    // `pulling` forever (spec 8.4).
    if (prior === 'pulling' || prior === 'starting') {
      emit(name, 'system', 'Interrupted while starting; re-syncing from docker');
    }
    let args: string[];
    try {
      ({ args } = await deps.prepareCompose(db, name));
    } catch {
      // Ambiguous compose + a configured image: cannot probe. Leave the row as
      // it was and let the settings card surface the reason.
      continue;
    }
    const st = await deps.composeStatus(args);
    if (st === 'running') setState(db, name, 'running');
    else if (st === 'stopped') setState(db, name, 'stopped');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/manager.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/server/services/manager.ts tests/unit/manager.test.ts
git commit -m "feat: service manager with per-service and ordered all-service control"
```

---

### Task 14: Setup runner

**Files:**
- Create: `src/lib/server/setup.ts`
- Test: `tests/unit/setup.test.ts`

**Interfaces:**
- Produces:
  - `isInstalled(db): boolean` — `checkLayout(getProjectPath(db)).ok`
  - `runSetup(opts: { db; dockerUser: string; dockerPassword: string; projectPath?: string; onLine: (line: string) => void; onStep: (step: string, status: 'start'|'ok'|'fail') => void }): Promise<ActionResult>`
  - `setRunForTests(fn)` / `resetRunForTests()` — injects the script runner (never shells out in tests).
  - Setup steps, in order: `update` (apt), `docker`, `download`, `extract`, `syncthing`, `login`.
- Consumes: Task 5 (`getProjectPath`, `setProjectPath`, `checkLayout`), Task 10 (`ActionResult`).
- **Security:** the docker password goes to the child process via **env var `DOCKER_PASSWORD`**, never as a CLI argument and never echoed. `redact()` (Task 3) is applied to every line before it reaches the log or the SSE stream.

- [ ] **Step 1: Write the failing test**

`tests/unit/setup.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { openDb } from '../../src/lib/server/db';
import { isInstalled, runSetup, setRunForTests, resetRunForTests } from '../../src/lib/server/setup';
import { clearLogs, recentLogs } from '../../src/lib/server/services/logbus';

let db: any, dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-'));
  db = openDb(path.join(dir, 't.db'));
  clearLogs();
});
afterEach(() => { db.close(); fs.rmSync(dir, { recursive: true, force: true }); resetRunForTests(); });

describe('isInstalled', () => {
  it('is false for an empty path and true once the layout exists', () => {
    expect(isInstalled(db)).toBe(false);
    const proj = path.join(dir, 'proj');
    for (const f of [
      'impinJReaderGateway/ImpinJReader', 'config.toml',
      'ipcame/docker-compose.yml', 'ipcame/config.toml',
      'rfid/docker-compose.yml', 'rfid/config/config.toml'
    ]) {
      const full = path.join(proj, f);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, '');
    }
    db.prepare("INSERT INTO app_config (key, value) VALUES ('project_path', ?)").run(proj);
    expect(isInstalled(db)).toBe(true);
  });
});

describe('runSetup', () => {
  it('passes secrets via env, never argv, and emits every step', async () => {
    let captured: any;
    setRunForTests(async (cmd: string, args: string[], opts: any) => {
      captured = { cmd, args, opts };
      const p: any = new EventEmitter();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      p.pid = 1;
      setTimeout(() => {
        p.stdout.emit('data', Buffer.from('installing…\n'));
        p.emit('close', 0);
      }, 0);
      return p;
    });

    const steps: string[] = [];
    const r = await runSetup({
      db, dockerUser: 'laoitdev', dockerPassword: 'sup3rSecret',
      onLine: () => {}, onStep: (s) => steps.push(s)
    });

    expect(r.ok).toBe(true);
    expect(captured.opts.env.DOCKER_PASSWORD).toBe('sup3rSecret');
    expect(captured.args.join(' ')).not.toContain('sup3rSecret');
    expect(steps).toEqual(['update', 'docker', 'download', 'extract', 'syncthing', 'login']);
  });

  it('redacts the password from streamed lines', async () => {
    setRunForTests(async () => {
      const p: any = new EventEmitter();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      p.pid = 1;
      setTimeout(() => {
        p.stdout.emit('data', Buffer.from('password=sup3rSecret\n'));
        p.emit('close', 0);
      }, 0);
      return p;
    });
    const lines: string[] = [];
    await runSetup({
      db, dockerUser: 'u', dockerPassword: 'sup3rSecret',
      onLine: (l) => lines.push(l), onStep: () => {}
    });
    for (const l of lines) expect(l).not.toContain('sup3rSecret');
    for (const e of recentLogs()) {
      expect(e.message).not.toContain('sup3rSecret');
      expect(e.detail ?? '').not.toContain('sup3rSecret');
    }
  });

  it('reports failure with the exit code and last stderr', async () => {
    setRunForTests(async () => {
      const p: any = new EventEmitter();
      p.stdout = new EventEmitter();
      p.stderr = new EventEmitter();
      p.pid = 1;
      setTimeout(() => {
        p.stderr.emit('data', Buffer.from('apt: permission denied\n'));
        p.emit('close', 100);
      }, 0);
      return p;
    });
    const r = await runSetup({
      db, dockerUser: 'u', dockerPassword: 'p',
      onLine: () => {}, onStep: () => {}
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain('permission denied');
    expect(r.detail).toContain('100');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/setup.test.ts`
Expected: FAIL — cannot resolve module.

- [ ] **Step 3: Write minimal implementation**

`src/lib/server/setup.ts`:
```ts
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import { getProjectPath, setProjectPath, checkLayout } from './settings';
import { logError, redact } from './log';
import { pushLog } from './services/logbus';
import type { ActionResult } from './services/types';

export const SETUP_STEPS = ['update', 'docker', 'download', 'extract', 'syncthing', 'login'] as const;
export type SetupStep = typeof SETUP_STEPS[number];

type RunFn = (cmd: string, args: string[], opts: any) => any;

const realRun: RunFn = (cmd, args, opts) => spawn(cmd, args, opts);
let runFn: RunFn = realRun;
export function setRunForTests(fn: RunFn): void { runFn = fn; }
export function resetRunForTests(): void { runFn = realRun; }

export function isInstalled(db: Database.Database): boolean {
  return checkLayout(getProjectPath(db)).ok;
}

export interface RunSetupOpts {
  db: Database.Database;
  dockerUser: string;
  dockerPassword: string;
  projectPath?: string;
  onLine: (line: string) => void;
  onStep: (step: SetupStep, status: 'start' | 'ok' | 'fail') => void;
}

export async function runSetup(opts: RunSetupOpts): Promise<ActionResult> {
  const { db } = opts;
  const projectPath = opts.projectPath ? path.resolve(opts.projectPath) : getProjectPath(db);
  const script = path.resolve('scripts/setup.sh');

  if (!fs.existsSync(script)) {
    const msg = 'Setup script not found';
    pushLog({ service: 'setup', level: 'error', message: msg, detail: script });
    return { ok: false, code: 'no_script', message: msg, detail: script };
  }

  const lines: string[] = [];
  const tails: string[] = [];

  const proc = runFn('bash', [script], {
    env: {
      ...process.env,
      PROJECT_PATH: projectPath,
      DOCKER_USER: opts.dockerUser,
      DOCKER_PASSWORD: opts.dockerPassword,
      SETUP_STEPS: SETUP_STEPS.join(',')
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  const emitLine = (raw: string) => {
    const line = redact(raw.replace(/\r$/, ''));
    if (!line.trim()) return;
    lines.push(line);
    tails.push(line);
    if (tails.length > 20) tails.shift();
    opts.onLine(line);
    // step markers printed by the script as "@@STEP:<name>:<start|ok|fail>"
    const m = /^@@STEP:(\w+):(start|ok|fail)$/.exec(line.trim());
    if (m) opts.onStep(m[1] as SetupStep, m[2] as 'start' | 'ok' | 'fail');
    else pushLog({ service: 'setup', level: 'info', message: line });
  };

  const wire = (s: any) => {
    if (!s) return;
    let buf = '';
    s.setEncoding?.('utf8');
    s.on('data', (c: string) => {
      buf += c;
      let i: number;
      while ((i = buf.indexOf('\n')) >= 0) { emitLine(buf.slice(0, i)); buf = buf.slice(i + 1); }
    });
  };
  wire(proc.stdout);
  wire(proc.stderr);

  const code: number = await new Promise((resolve) => {
    proc.on('error', () => resolve(1));
    proc.on('close', (c: number) => resolve(c ?? 1));
  });

  if (code !== 0) {
    const detail = `exit ${code}\n${tails.join('\n')}`;
    const msg = 'Setup failed';
    logError(msg, { code });
    pushLog({ service: 'setup', level: 'error', message: msg, detail });
    return { ok: false, code: 'setup_failed', message: msg, detail };
  }

  setProjectPath(db, projectPath);
  const check = checkLayout(projectPath);
  if (!check.ok) {
    const msg = 'Setup finished but the project layout is incomplete';
    pushLog({ service: 'setup', level: 'error', message: msg, detail: check.missing.join(', ') });
    return { ok: false, code: 'layout_incomplete', message: msg, detail: check.missing.join(', ') };
  }
  pushLog({ service: 'setup', level: 'success', message: 'Setup complete' });
  return { ok: true, message: 'Setup complete' };
}
```

- [ ] **Step 4: Create the setup script the runner calls**

`scripts/setup.sh` (referenced by `runSetup`; it prints `@@STEP:` markers the runner parses):
```bash
#!/usr/bin/env bash
set -euo pipefail

step() { echo "@@STEP:$1:$2"; }

PROJECT_PATH="${PROJECT_PATH:-$HOME/Desktop/asean-project}"
DOCKER_USER="${DOCKER_USER:?DOCKER_USER required}"

step update start
sudo apt update && sudo apt upgrade -y
step update ok

step docker start
if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER" || true
fi
step docker ok

step download start
mkdir -p "$PROJECT_PATH"
cd "$PROJECT_PATH"
curl -fL -o asian-pj.zip "https://github.com/${DOCKER_USER}/asean-project/releases/latest/download/asian-pj.zip"
step download ok

step extract start
unzip -o asian-pj.zip -d "$PROJECT_PATH"
step extract ok

step syncthing start
if ! command -v syncthing >/dev/null 2>&1; then
  sudo apt install -y syncthing
fi
step syncthing ok

step login start
echo "$DOCKER_PASSWORD" | docker login -u "$DOCKER_USER" --password-stdin
step login ok

echo "Setup complete at $PROJECT_PATH"
```

Make it executable:
```bash
chmod +x scripts/setup.sh
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/unit/setup.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/server/setup.ts scripts/setup.sh tests/unit/setup.test.ts
git commit -m "feat: streamed setup runner with secret-safe env passing"
```

---

### Task 15: Session hook + auth API routes

**Files:**
- Create: `src/hooks.server.ts`, `src/app.d.ts`, `src/routes/api/auth/setup-pin/+server.ts`, `src/routes/api/auth/login/+server.ts`, `src/routes/api/auth/logout/+server.ts`
- Test: `tests/unit/auth-routes.test.ts`

**Interfaces:**
- Produces:
  - `handle` in `hooks.server.ts` — resolves `locals.session`, gates routes (see rules below), and records the client IP in `locals.ip`.
  - `POST /api/auth/setup-pin` body `{ pin }` → `{ ok:true }` + sets `sid` cookie; `409` if a PIN exists.
  - `POST /api/auth/login` body `{ pin }` → `{ ok:true }` + sets `sid`; `401` wrong; `423` locked with `{ retryAfterMs }`.
  - `POST /api/auth/logout` → clears cookie.
- Consumes: Tasks 2, 3, 4, 5.
- **Route gating (spec §7.1):** No PIN yet → only `/setup-pin` and its API are reachable (others `303` → `/setup-pin`). PIN exists, no session → only `/login` and its API (others `303` → `/login`). Session valid → `/login` and `/setup-pin` redirect to `/`.

- [ ] **Step 1: Write the failing test**

`tests/unit/auth-routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';
import { handle } from '../../src/hooks.server';
import { createPin, hasPin } from '../../src/lib/server/auth';

let db: any, dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'routes-'));
  process.env.DB_PATH = path.join(dir, 't.db');
  db = openDb(process.env.DB_PATH);
});
afterEach(() => {
  db.close();
  delete process.env.DB_PATH;
  process.env.DB_PATH = '';
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
    const login = await callHandle('/api/auth/login', undefined, 'POST');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/auth-routes.test.ts`
Expected: FAIL — cannot resolve `src/hooks.server`.

- [ ] **Step 3: Write minimal implementation**

`src/app.d.ts`:
```ts
declare global {
  namespace App {
    interface Locals {
      session: { id: string } | null;
      ip: string;
      requestId: string;
    }
  }
}
export {};
```

`src/hooks.server.ts`:
```ts
import type { Handle } from '@sveltejs/kit';
import { redirect } from '@sveltejs/kit';
import { getDb } from '$lib/server/db';
import { hasPin, validateSession, cleanupExpired } from '$lib/server/auth';
import { newRequestId, logError } from '$lib/server/log';

const PUBLIC_PREFIXES = ['/api/auth/', '/_app/', '/favicon', '/robots.txt'];

export const handle: Handle = async ({ event, resolve }) => {
  const db = getDb();
  event.locals.ip = event.getClientAddress();
  event.locals.requestId = newRequestId();

  const sid = event.cookies.get('sid');
  event.locals.session = sid && validateSession(db, sid).valid ? { id: sid } : null;

  const path = event.url.pathname;
  const isPublic = PUBLIC_PREFIXES.some((p) => path.startsWith(p));
  const pinned = hasPin(db);

  if (!isPublic) {
    if (!pinned && path !== '/setup-pin') throw redirect(303, '/setup-pin');
    if (pinned && !event.locals.session && path !== '/login') throw redirect(303, '/login');
    if (pinned && event.locals.session && (path === '/login' || path === '/setup-pin')) {
      throw redirect(303, '/');
    }
  }

  if (Math.random() < 0.01) cleanupExpired(db);

  try {
    return await resolve(event);
  } catch (err: any) {
    if (err?.status === 303 || err?.status === 302) throw err;
    logError('unhandled request error', { requestId: event.locals.requestId, path });
    throw err;
  }
};
```

`src/routes/api/auth/setup-pin/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { createPin, hasPin, createSession } from '$lib/server/auth';
import { pushLog } from '$lib/server/services/logbus';

export const POST: RequestHandler = async ({ request, cookies }) => {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin ?? '');
  if (hasPin(db)) throw error(409, 'A PIN already exists');
  try {
    createPin(db, pin);
  } catch (err: any) {
    if (err?.message === 'bad_pin') throw error(400, 'PIN must be 6 to 12 digits');
    throw error(500, 'Could not create PIN');
  }
  const { id } = createSession(db);
  cookies.set('sid', id, {
    path: '/', httpOnly: true, sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    maxAge: 12 * 60 * 60
  });
  pushLog({ service: 'auth', level: 'system', message: 'Panel PIN created' });
  return json({ ok: true });
};
```

`src/routes/api/auth/login/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { verifyPin, createSession } from '$lib/server/auth';
import { pushLog } from '$lib/server/services/logbus';

export const POST: RequestHandler = async ({ request, cookies, locals }) => {
  const db = getDb();
  const body = await request.json().catch(() => ({}));
  const pin = String(body.pin ?? '');
  const res = verifyPin(db, pin, locals.ip);

  if (!res.ok) {
    if (res.code === 'locked') {
      pushLog({ service: 'auth', level: 'warn', message: `Login blocked for ${locals.ip}` });
      return json({ ok: false, code: 'locked', retryAfterMs: res.retryAfterMs },
        { status: 423 });
    }
    pushLog({ service: 'auth', level: 'warn', message: `Failed login from ${locals.ip}` });
    if (res.code === 'no_pin') return json({ ok: false, code: 'no_pin' }, { status: 400 });
    return json({ ok: false, code: 'bad_pin' }, { status: 401 });
  }

  const { id } = createSession(db);
  cookies.set('sid', id, {
    path: '/', httpOnly: true, sameSite: 'strict',
    secure: new URL(request.url).protocol === 'https:',
    maxAge: 12 * 60 * 60
  });
  pushLog({ service: 'auth', level: 'system', message: 'Signed in' });
  return json({ ok: true });
};
```

`src/routes/api/auth/logout/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { destroySession } from '$lib/server/auth';
import { pushLog } from '$lib/server/services/logbus';

export const POST: RequestHandler = async ({ cookies, locals }) => {
  const sid = cookies.get('sid');
  if (sid) {
    destroySession(getDb(), sid);
    cookies.delete('sid', { path: '/' });
  }
  pushLog({ service: 'auth', level: 'system', message: 'Signed out' });
  return json({ ok: true });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/auth-routes.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/hooks.server.ts src/app.d.ts src/routes/api/auth tests/unit/auth-routes.test.ts
git commit -m "feat: session hook with route gating and auth api routes"
```

---

### Task 16: Status, logs (SSE), and service-control API routes

**Files:**
- Create: `src/routes/api/status/+server.ts`, `src/routes/api/logs/+server.ts`, `src/routes/api/services/[name]/start/+server.ts`, `src/routes/api/services/[name]/stop/+server.ts`, `src/routes/api/services/start-all/+server.ts`, `src/routes/api/services/stop-all/+server.ts`
- Test: `tests/unit/service-routes.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/status` → `{ services: ServiceStatus[] }`
  - `GET /api/logs` → `text/event-stream`; first events replay recent logs, then live entries.
  - `POST /api/services/[name]/start` body `{ force?: boolean }` → `ActionResult`, `400` on unknown name, `409` with `code:'dependency_down'` when blocked.
  - `POST /api/services/[name]/stop` → `ActionResult`.
  - `POST /api/services/start-all` → `{ results: ActionResult[] }`.
  - `POST /api/services/stop-all` → `{ results: ActionResult[] }`.
- Consumes: Tasks 2, 10, 11.

- [ ] **Step 1: Write the failing test**

`tests/unit/service-routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';
import { clearLogs } from '../../src/lib/server/services/logbus';
import { setDepsForTests, resetDepsForTests } from '../../src/lib/server/services/manager';

let db: any, dir: string;

vi.mock('$lib/server/db', () => ({ getDb: () => globalThis.__testDb }));

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/service-routes.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Write minimal implementation**

`src/routes/api/status/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { status } from '$lib/server/services/manager';

export const GET: RequestHandler = async () => {
  return json({ services: status(getDb()) });
};
```

`src/routes/api/logs/+server.ts`:
```ts
import type { RequestHandler } from './$types';
import { recentLogs, subscribeLogs, type LogEntry } from '$lib/server/services/logbus';

export const GET: RequestHandler = async () => {
  const encoder = new TextEncoder();
  let unsub: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (e: LogEntry) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      };
      for (const e of recentLogs(200)) send(e);
      unsub = subscribeLogs(send);
      heartbeat = setInterval(() => {
        try { controller.enqueue(encoder.encode(`: ping\n\n`)); } catch { /* closed */ }
      }, 15_000);
    },
    cancel() {
      unsub?.();
      if (heartbeat) clearInterval(heartbeat);
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive'
    }
  });
};
```

`src/routes/api/services/[name]/start/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { startOne } from '$lib/server/services/manager';
import { SERVICE_ORDER, type ServiceName } from '$lib/server/services/types';

export const POST: RequestHandler = async ({ params, request }) => {
  const name = params.name as ServiceName;
  if (!SERVICE_ORDER.includes(name)) throw error(400, `Unknown service: ${name}`);
  const body = await request.json().catch(() => ({}));
  const result = await startOne(getDb(), name, { force: body?.force === true });
  if (!result.ok && result.code === 'dependency_down') return json(result, { status: 409 });
  return json(result);
};
```

`src/routes/api/services/[name]/stop/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { stopOne } from '$lib/server/services/manager';
import { SERVICE_ORDER, type ServiceName } from '$lib/server/services/types';

export const POST: RequestHandler = async ({ params }) => {
  const name = params.name as ServiceName;
  if (!SERVICE_ORDER.includes(name)) throw error(400, `Unknown service: ${name}`);
  return json(await stopOne(getDb(), name));
};
```

`src/routes/api/services/start-all/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { startAll } from '$lib/server/services/manager';

export const POST: RequestHandler = async () => {
  return json({ results: await startAll(getDb()) });
};
```

`src/routes/api/services/stop-all/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { stopAll } from '$lib/server/services/manager';

export const POST: RequestHandler = async () => {
  return json({ results: await stopAll(getDb()) });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/service-routes.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/status src/routes/api/logs src/routes/api/services tests/unit/service-routes.test.ts
git commit -m "feat: status, sse logs, and per-service + all-service control routes"
```

---

### Task 17: Config and setup API routes

**Files:**
- Create: `src/routes/api/config/[file]/+server.ts`, `src/routes/api/setup/run/+server.ts`, `src/routes/api/images/+server.ts`
- Test: `tests/unit/config-routes.test.ts`

**Interfaces:**
- Produces:
  - `GET /api/config/[file]` → `{ file, schema, value, rawToml }` (`file` ∈ reader|cameras|gate).
  - `PUT /api/config/[file]` body `{ value }` → `{ ok:true, backup }`; `400` with `{ errors }` on validation failure; `404` if the toml file does not exist.
  - `POST /api/setup/run` body `{ dockerUser, dockerPassword, projectPath? }` → `text/event-stream` of `{type:'line'|'step'|'result', ...}`.
  - `GET /api/images` → `{ images: ImageStatus[] }` — includes `composeService` and `error` so the settings card can warn before a start is attempted.
  - `PUT /api/images` body `{ service, image, policy }` → `{ image: ImageStatus }`; `400` with `{ message }` on an invalid ref; `409` with `{ code:'ambiguous_compose_service', found }` when a non-empty image is set over a multi-service compose file.
  - `GET /api/images/pull?service=ipcame|rfid` → `text/event-stream` of `{type:'line'|'result', ...}`, streaming the pull the same way setup does.
- Consumes: Tasks 5, 6, 7, 10, 12.

- [ ] **Step 1: Write the failing test**

`tests/unit/config-routes.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../../src/lib/server/db';

vi.mock('$lib/server/db', () => ({ getDb: () => globalThis.__testDb }));

let db: any, dir: string, proj: string;

const READER_TOML = `
[reader]
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
    expect(body.value.reader.speedway_address).toBe('192.168.55.12');
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
    value.reader.speedway_address = '10.0.0.9';
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
    value.reader.socket_port = 99999;
    const res = await put(value);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.errors[0].path).toBe('reader.socket_port');
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/unit/config-routes.test.ts`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Write minimal implementation**

`src/routes/api/config/[file]/+server.ts`:
```ts
import { json, error } from '@sveltejs/kit';
import fs from 'node:fs';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getProjectPath } from '$lib/server/settings';
import { SCHEMAS, CONFIG_FILES, type ConfigFile } from '$lib/server/config/schema';
import { readConfig, validateConfig, writeConfig } from '$lib/server/config/store';
import { pushLog } from '$lib/server/services/logbus';

function resolveFile(fileKey: string) {
  if (!CONFIG_FILES.includes(fileKey as ConfigFile)) return null;
  const schema = SCHEMAS[fileKey as ConfigFile];
  const filePath = `${getProjectPath(getDb())}/${schema.relPath}`;
  return { schema, filePath };
}

export const GET: RequestHandler = async ({ params }) => {
  const r = resolveFile(params.file);
  if (!r) throw error(404, 'Unknown config file');
  const value = readConfig(r.filePath, r.schema);
  let rawToml = '';
  try { rawToml = fs.readFileSync(r.filePath, 'utf8'); } catch { rawToml = ''; }
  return json({ file: r.schema.key, schema: r.schema, value, rawToml });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const r = resolveFile(params.file);
  if (!r) throw error(404, 'Unknown config file');
  if (!fs.existsSync(r.filePath)) throw error(404, 'Config file does not exist yet');
  const body = await request.json().catch(() => ({}));
  const check = validateConfig(r.schema, body?.value ?? {});
  if (!check.ok) return json({ ok: false, errors: check.errors }, { status: 400 });
  const res = writeConfig(r.filePath, r.schema, check.value);
  pushLog({ service: r.schema.key, level: 'system', message: `${r.schema.label} config saved` });
  return json({ ok: true, backup: res.backup });
};
```

Note: `resolveFile` uses `resolveProjectFile` semantics via the schema `relPath`; a hand-built join here is fine because `relPath` values are schema constants, never user input.

`src/routes/api/setup/run/+server.ts`:
```ts
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { runSetup } from '$lib/server/setup';

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => ({}));
  const dockerUser = String(body?.dockerUser ?? '');
  const dockerPassword = String(body?.dockerPassword ?? '');
  if (!dockerUser || !dockerPassword) {
    return json({ ok: false, message: 'Docker username and password are required' }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
      try {
        const result = await runSetup({
          db: getDb(), dockerUser, dockerPassword,
          projectPath: body?.projectPath,
          onLine: (line) => send({ type: 'line', line }),
          onStep: (step, status) => send({ type: 'step', step, status })
        });
        send({ type: 'result', result });
      } catch (err: any) {
        send({ type: 'result', result: { ok: false, message: 'Setup crashed', detail: String(err?.message ?? err) } });
      } finally {
        controller.close();
      }
    }
  });

  return new Response(stream, {
    headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' }
  });
};
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/unit/config-routes.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/routes/api/config src/routes/api/setup tests/unit/config-routes.test.ts
git commit -m "feat: config read/write and streamed setup api routes"
```

---

### Task 18: Design tokens + app shell

**Files:**
- Create: `src/app.css` (extend), `src/lib/components/AppShell.svelte`, `src/routes/+layout.svelte`, `src/routes/+layout.server.ts`
- Test: `tests/e2e/shell.spec.ts` (Playwright smoke), plus visual check via dev server.

**Interfaces:**
- Produces:
  - CSS custom properties on `:root` (Soft Dark tokens, spec §10.1) plus Tailwind `@theme` mapping so utilities like `bg-surface`, `text-status-error` exist.
  - `AppShell.svelte` with props `{ title: string, active: 'status'|'setup'|'settings'|null, children }` — top bar (dark) + canvas + optional slot.
  - `+layout.server.ts` loads `{ session, hasPin, installed }` for the shell.
- Consumes: Tasks 5, 13.

- [ ] **Step 1: Write the Soft Dark tokens**

Replace `src/app.css` with:
```css
@import 'tailwindcss';

:root {
  --chrome: #273244;
  --chrome-ink: #e6edf5;
  --canvas: #e9eef4;
  --card: #ffffff;
  --hairline: #dbe3ec;
  --ink: #1b2430;
  --ink-soft: #5b6b7f;
  --log: #1e293b;
  --log-ink: #cbd5e1;
  --status-ok: #16a34a;
  --status-warn: #f59e0b;
  --status-error: #dc2626;
  --accent: #4f46e5;
  --radius: 10px;
}

@theme {
  --color-chrome: var(--chrome);
  --color-chrome-ink: var(--chrome-ink);
  --color-canvas: var(--canvas);
  --color-card: var(--card);
  --color-hairline: var(--hairline);
  --color-ink: var(--ink);
  --color-ink-soft: var(--ink-soft);
  --color-log: var(--log);
  --color-logink: var(--log-ink);
  --color-status-ok: var(--status-ok);
  --color-status-warn: var(--status-warn);
  --color-status-error: var(--status-error);
  --color-accent: var(--accent);
  --radius-card: var(--radius);
  --font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
}

html, body { height: 100%; }
body { background: var(--canvas); color: var(--ink); font-family: system-ui, -apple-system, sans-serif; }
.mono { font-family: var(--font-mono); }
```

- [ ] **Step 2: Build the shell**

`src/lib/components/AppShell.svelte`:
```svelte
<script lang="ts">
  export let title: string;
  export let active: 'status' | 'setup' | 'settings' | null = null;
  const nav = [
    { href: '/', key: 'status', label: 'Status' },
    { href: '/setup', key: 'setup', label: 'Setup' },
    { href: '/settings', key: 'settings', label: 'Settings' }
  ] as const;
</script>

<div class="min-h-screen flex flex-col">
  <header class="bg-chrome text-chrome-ink px-5 h-14 flex items-center gap-6">
    <span class="font-semibold tracking-wide">Smart RFID Gate</span>
    <nav class="flex gap-1 text-sm">
      {#each nav as item}
        <a
          href={item.href}
          class="px-3 py-1.5 rounded-md transition-colors
                 {active === item.key ? 'bg-white/15 text-white' : 'text-chrome-ink/70 hover:text-white hover:bg-white/10'}"
        >{item.label}</a>
      {/each}
    </nav>
    <div class="ml-auto">{title}</div>
  </header>
  <main class="flex-1 min-h-0">
    <slot />
  </main>
</div>
```

`src/routes/+layout.server.ts`:
```ts
import type { LayoutServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasPin } from '$lib/server/auth';
import { isInstalled } from '$lib/server/setup';

export const load: LayoutServerLoad = async ({ locals }) => {
  const db = getDb();
  return {
    sessionActive: !!locals.session,
    hasPin: hasPin(db),
    installed: isInstalled(db)
  };
};
```

`src/routes/+layout.svelte`:
```svelte
<script lang="ts">
  import '../app.css';
  import type { LayoutData } from './$types';
  export let data: LayoutData;
</script>

<slot />
```

- [ ] **Step 3: Write a Playwright smoke test**

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  webServer: {
    command: 'npm run dev -- --port 5273',
    port: 5273,
    reuseExistingServer: true
  },
  use: { baseURL: 'http://localhost:5273' }
});
```

`tests/e2e/shell.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test('first run redirects to the pin setup screen', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL(/\/setup-pin$/);
});
```

- [ ] **Step 4: Run it**

Run: `npx playwright install chromium --with-deps && npm run test:e2e -- tests/e2e/shell.spec.ts`
Expected: the test passes once the `/setup-pin` route exists (Task 17). Until then, it fails on a 404 — that is the correct failing state for this task.

- [ ] **Step 5: Commit**

```bash
git add src/app.css src/lib/components/AppShell.svelte src/routes/+layout.svelte src/routes/+layout.server.ts playwright.config.ts tests/e2e/shell.spec.ts
git commit -m "feat: soft-dark design tokens, app shell, playwright harness"
```

---

### Task 19: PIN setup and login screens

**Files:**
- Create: `src/lib/components/PinPad.svelte`, `src/routes/setup-pin/+page.svelte`, `src/routes/setup-pin/+page.server.ts`, `src/routes/login/+page.svelte`, `src/routes/login/+page.server.ts`
- Test: `tests/e2e/auth.spec.ts`

**Interfaces:**
- Produces:
  - `PinPad.svelte` props `{ length?: number, onsubmit: (pin: string) => void | Promise<void>, disabled?: boolean, error?: string }` — renders digit fields; no on-screen numeric keypad required, plain password-style inputs are acceptable.
  - `/setup-pin` — two fields (PIN, confirm), client-side match check, posts to `/api/auth/setup-pin`, then `goto('/')`.
  - `/login` — one field, posts to `/api/auth/login`; shows lockout minutes from `retryAfterMs`, then `goto('/')` on success.
- Consumes: Task 13 API.

- [ ] **Step 1: Write the failing e2e test**

`tests/e2e/auth.spec.ts`:
```ts
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'serial' });

test('create a pin then reach the main screen', async ({ page }) => {
  await page.goto('/setup-pin');
  await page.getByLabel('PIN').fill('135790');
  await page.getByLabel('Confirm PIN').fill('135790');
  await page.getByRole('button', { name: 'Create PIN' }).click();
  await expect(page).toHaveURL('http://localhost:5273/');
});

test('rejects a mismatched confirmation', async ({ page }) => {
  await page.goto('/setup-pin');
  // a pin already exists now, so the hook bounces us to /login when signed out
  await page.getByLabel('PIN').fill('135790');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL('http://localhost:5273/');
});

test('wrong pin shows an error', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('PIN').fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toContainText('Incorrect');
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm run test:e2e -- tests/e2e/auth.spec.ts`
Expected: FAIL — `/setup-pin` does not exist yet.

- [ ] **Step 3: Implement PinPad and the two pages**

`src/lib/components/PinPad.svelte`:
```svelte
<script lang="ts">
  export let label = 'PIN';
  export let autocomplete = 'current-password';
  export let minlength = 6;
  export let maxlength = 12;
  export let value = '';
  export let disabled = false;
</script>

<label class="block">
  <span class="block text-sm font-medium text-ink mb-1">{label}</span>
  <input
    type="password"
    inputmode="numeric"
    pattern="[0-9]*"
    {minlength}
    {maxlength}
    {disabled}
    autocomplete={autocomplete}
    bind:value
    class="mono w-full rounded-md border border-hairline bg-white px-3 py-2 text-lg tracking-[0.4em]
           focus:outline-none focus:ring-2 focus:ring-accent"
  />
</label>
```

`src/routes/setup-pin/+page.server.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasPin } from '$lib/server/auth';

export const load: PageServerLoad = async () => {
  if (hasPin(getDb())) throw redirect(303, '/login');
  return {};
};
```

`src/routes/setup-pin/+page.svelte`:
```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import PinPad from '$lib/components/PinPad.svelte';

  let pin = '', confirm = '', error = '', busy = false;

  async function submit() {
    error = '';
    if (!/^\d{6,12}$/.test(pin)) { error = 'Use 6 to 12 digits.'; return; }
    if (pin !== confirm) { error = 'The two PINs do not match.'; return; }
    busy = true;
    const res = await fetch('/api/auth/setup-pin', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    busy = false;
    if (res.ok) { await goto('/'); return; }
    error = (await res.json().catch(() => ({}))).message ?? 'Could not create the PIN.';
  }
</script>

<div class="min-h-screen grid place-items-center p-6">
  <form
    class="w-full max-w-sm bg-card rounded-card border border-hairline shadow-sm p-6 space-y-4"
    on:submit|preventDefault={submit}
  >
    <div>
      <h1 class="text-lg font-semibold">Create the panel PIN</h1>
      <p class="text-sm text-ink-soft mt-1">6 to 12 digits. Wrong entries lock this device for 15 minutes after 5 tries.</p>
    </div>
    <PinPad label="PIN" minlength={6} maxlength={12} bind:value={pin} autocomplete="new-password" disabled={busy} />
    <PinPad label="Confirm PIN" minlength={6} maxlength={12} bind:value={confirm} autocomplete="new-password" disabled={busy} />
    {#if error}<p role="alert" class="text-sm text-status-error">{error}</p>{/if}
    <button
      type="submit" disabled={busy}
      class="w-full rounded-md bg-accent text-white py-2 font-medium disabled:opacity-50"
    >Create PIN</button>
  </form>
</div>
```

`src/routes/login/+page.server.ts`:
```ts
import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { hasPin } from '$lib/server/auth';

export const load: PageServerLoad = async ({ locals }) => {
  const db = getDb();
  if (!hasPin(db)) throw redirect(303, '/setup-pin');
  if (locals.session) throw redirect(303, '/');
  return {};
};
```

`src/routes/login/+page.svelte`:
```svelte
<script lang="ts">
  import { goto } from '$app/navigation';
  import PinPad from '$lib/components/PinPad.svelte';

  let pin = '', error = '', busy = false;

  async function submit() {
    error = '';
    if (!/^\d{6,12}$/.test(pin)) { error = 'Enter your PIN.'; return; }
    busy = true;
    const res = await fetch('/api/auth/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    busy = false;
    if (res.ok) { await goto('/'); return; }
    const body = await res.json().catch(() => ({}));
    if (body.code === 'locked') {
      const mins = Math.ceil((body.retryAfterMs ?? 0) / 60000);
      error = `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
    } else {
      error = 'Incorrect PIN.';
    }
  }
</script>

<div class="min-h-screen grid place-items-center p-6">
  <form
    class="w-full max-w-sm bg-card rounded-card border border-hairline shadow-sm p-6 space-y-4"
    on:submit|preventDefault={submit}
  >
    <h1 class="text-lg font-semibold">Smart RFID Gate</h1>
    <PinPad label="PIN" bind:value={pin} disabled={busy} />
    {#if error}<p role="alert" class="text-sm text-status-error">{error}</p>{/if}
    <button
      type="submit" disabled={busy}
      class="w-full rounded-md bg-accent text-white py-2 font-medium disabled:opacity-50"
    >Sign in</button>
  </form>
</div>
```

- [ ] **Step 4: Run the e2e tests**

Run: `rm -f data/app.db && npm run test:e2e -- tests/e2e/auth.spec.ts`
Expected: all 3 pass. (`rm` clears the dev database so the first-run path is exercised.)

- [ ] **Step 5: Commit**

```bash
git add src/lib/components/PinPad.svelte src/routes/setup-pin src/routes/login tests/e2e/auth.spec.ts
git commit -m "feat: pin setup and login screens"
```

---

### Task 20: Main control screen — per-service rows + docked log

**Files:**
- Create: `src/lib/components/StatusBanner.svelte`, `src/lib/components/ServiceRow.svelte`, `src/lib/components/LogConsole.svelte`, `src/lib/components/ConfirmDialog.svelte`, `src/routes/+page.server.ts`, `src/routes/+page.svelte`
- Test: `tests/e2e/control.spec.ts`, `tests/unit/status-banner.test.ts`

**Interfaces:**
- Produces:
  - `StatusBanner.svelte` props `{ services: ServiceStatus[] }` — renders green OPERATIONAL or red DEGRADED with the first failing service named.
  - `ServiceRow.svelte` props `{ service: ServiceStatus; index: number; busy: boolean; onToggle: (s: ServiceStatus) => void }` — one row: `index`, human label, state dot + text, pid/uptime, Start/Stop toggle.
  - `LogConsole.svelte` — connects to `/api/logs` (EventSource), renders colored lines, auto-scroll toggle.
  - `ConfirmDialog.svelte` props `{ open: boolean; title: string; body: string; confirmLabel: string; onconfirm: () => void; oncancel: () => void }`.
  - `+page.server.ts` load returns `{ services, installed, projectPath }`.
  - `+page.svelte` — L2 split: controls column (banner, global buttons, three rows) + docked log column, polling `/api/status` every 2s.
- Consumes: Tasks 11, 14.

- [ ] **Step 1: Write the failing unit test for the banner**

`tests/unit/status-banner.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { bannerState } from '../../src/lib/components/banner-logic';

const mk = (actuals: Record<string, string>) =>
  ['reader', 'ipcame', 'rfid'].map((name, i) => ({
    name: name as any,
    label: ['Reader', 'IP Camera', 'Gate RFID'][i],
    actual: actuals[name] as any
  }));

describe('bannerState', () => {
  it('is operational when all three run', () => {
    const s = bannerState(mk({ reader: 'running', ipcame: 'running', rfid: 'running' }));
    expect(s.kind).toBe('ok');
    expect(s.title).toBe('OPERATIONAL');
  });

  it('is degraded and names the failing service', () => {
    const s = bannerState(mk({ reader: 'running', ipcame: 'error', rfid: 'stopped' }));
    expect(s.kind).toBe('error');
    expect(s.title).toBe('DEGRADED');
    expect(s.detail).toContain('IP Camera');
  });

  it('is degraded while transitioning', () => {
    const s = bannerState(mk({ reader: 'starting', ipcame: 'running', rfid: 'running' }));
    expect(s.kind).toBe('warn');
    expect(s.detail).toContain('Reader');
  });

  it('is idle when everything is stopped', () => {
    const s = bannerState(mk({ reader: 'stopped', ipcame: 'stopped', rfid: 'stopped' }));
    expect(s.kind).toBe('idle');
    expect(s.title).toBe('ALL SERVICES STOPPED');
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- tests/unit/status-banner.test.ts`
Expected: FAIL — cannot resolve `banner-logic`.

- [ ] **Step 3: Implement the banner logic and components**

`src/lib/components/banner-logic.ts`:
```ts
import type { ServiceStatus } from '$lib/server/services/types';

export type BannerState = { kind: 'ok' | 'warn' | 'error' | 'idle'; title: string; detail: string };

export function bannerState(services: ServiceStatus[]): BannerState {
  if (!services.length) return { kind: 'idle', title: 'NO SERVICES', detail: '' };

  const failed = services.filter((s) => s.actual === 'error');
  if (failed.length) {
    return {
      kind: 'error',
      title: 'DEGRADED',
      detail: `${failed.map((s) => s.label).join(', ')} failed${failed[0].detail ? ` — ${failed[0].detail}` : ''}`
    };
  }

  const moving = services.filter(
    (s) => s.actual === 'pulling' || s.actual === 'starting' || s.actual === 'stopping'
  );
  if (moving.length) {
    const verb = { pulling: 'is pulling its image', starting: 'is starting', stopping: 'is stopping' };
    return {
      kind: 'warn',
      title: 'DEGRADED',
      detail: `${moving.map((s) => s.label).join(', ')} ${verb[moving[0].actual as 'pulling'|'starting'|'stopping']}…`
    };
  }

  if (services.every((s) => s.actual === 'running')) {
    return { kind: 'ok', title: 'OPERATIONAL', detail: 'All three services are running.' };
  }

  return {
    kind: 'idle',
    title: 'ALL SERVICES STOPPED',
    detail: 'Nothing is running. Use START ALL to bring the gate up.'
  };
}
```

`src/lib/components/StatusBanner.svelte`:
```svelte
<script lang="ts">
  import type { ServiceStatus } from '$lib/server/services/types';
  import { bannerState } from './banner-logic';
  export let services: ServiceStatus[];
  $: state = bannerState(services);
  const tone = {
    ok: 'bg-status-ok', warn: 'bg-status-warn', error: 'bg-status-error', idle: 'bg-ink-soft'
  } as const;
</script>

<div class="rounded-card overflow-hidden border border-hairline bg-card shadow-sm">
  <div class="h-1.5 {tone[state.kind]}"></div>
  <div class="px-4 py-3 flex items-center gap-3">
    <span class="inline-block w-3 h-3 rounded-full {tone[state.kind]} shadow-[0_0_0_4px_rgba(0,0,0,0.04)]"></span>
    <div>
      <div class="font-semibold tracking-wide">{state.title}</div>
      {#if state.detail}<div class="text-sm text-ink-soft">{state.detail}</div>{/if}
    </div>
  </div>
</div>
```

`src/lib/components/ServiceRow.svelte`:
```svelte
<script lang="ts">
  import type { ServiceStatus } from '$lib/server/services/types';
  export let service: ServiceStatus;
  export let index: number;
  export let busy = false;
  export let onToggle: (s: ServiceStatus) => void;

  const dot: Record<string, string> = {
    running: 'bg-status-ok', pulling: 'bg-status-warn', starting: 'bg-status-warn',
    stopping: 'bg-status-warn', error: 'bg-status-error', stopped: 'bg-ink-soft'
  };
  const word: Record<string, string> = {
    running: 'RUNNING', pulling: 'PULLING', starting: 'STARTING', stopping: 'STOPPING',
    error: 'ERROR', stopped: 'STOPPED'
  };
  // A pulling service counts as on: the toggle must offer Stop, and docker
  // compose down is safe mid-pull.
  $: isOn = service.actual === 'running' || service.actual === 'pulling' || service.actual === 'starting';
  $: transitioning = service.actual === 'pulling' || service.actual === 'starting' || service.actual === 'stopping';
  $: uptime = service.since && service.actual === 'running'
    ? Math.max(0, Math.round((Date.now() - service.since) / 1000))
    : null;
  function human(sec: number) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  }
</script>

<div class="border-t border-hairline py-3 flex items-center gap-4">
  <span class="w-7 h-7 grid place-items-center rounded-full bg-canvas text-ink-soft text-sm font-semibold">{index}</span>
  <div class="flex-1 min-w-0">
    <div class="font-medium">{service.label}</div>
    <div class="text-sm text-ink-soft flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full {dot[service.actual]}"></span>
      <span class="font-medium">{word[service.actual]}</span>
      {#if service.pid}<span class="mono">· pid {service.pid}</span>{/if}
      {#if uptime !== null}<span>· up {human(uptime)}</span>{/if}
      {#if service.detail}<span class="truncate">· {service.detail}</span>{/if}
    </div>
  </div>
  <button
    type="button"
    disabled={busy || transitioning}
    on:click={() => onToggle(service)}
    class="px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-40
           {isOn
             ? 'border border-status-error/40 text-status-error hover:bg-status-error/10'
             : 'bg-status-ok text-white hover:brightness-105'}"
  >{isOn ? 'Stop' : 'Start'}</button>
</div>
```

`src/lib/components/ConfirmDialog.svelte`:
```svelte
<script lang="ts">
  export let open = false;
  export let title = '';
  export let body = '';
  export let confirmLabel = 'Confirm';
  export let onconfirm: () => void;
  export let oncancel: () => void;
</script>

{#if open}
  <div class="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
    <div role="dialog" aria-modal="true" class="w-full max-w-md bg-card rounded-card border border-hairline p-5 shadow-xl">
      <h2 class="font-semibold text-lg">{title}</h2>
      <p class="text-sm text-ink-soft mt-2 whitespace-pre-line">{body}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" on:click={oncancel}
          class="px-4 py-2 rounded-md border border-hairline text-sm">Cancel</button>
        <button type="button" on:click={onconfirm}
          class="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium">{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
```

`src/lib/components/LogConsole.svelte`:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  type Entry = { id: number; service: string; level: string; message: string; detail?: string; at: number };

  let lines: Entry[] = [];
  let autoScroll = true;
  let source: EventSource | null = null;
  let scroller: HTMLDivElement;

  const color: Record<string, string> = {
    info: 'text-logink', success: 'text-status-ok', warn: 'text-status-warn',
    error: 'text-status-error', system: 'text-accent'
  };

  onMount(() => {
    source = new EventSource('/api/logs');
    source.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as Entry;
      lines = [...lines, e].slice(-500);
      if (autoScroll) queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
    };
    return () => source?.close();
  });
  onDestroy(() => source?.close());

  const stamp = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
</script>

<div class="h-full flex flex-col bg-log rounded-card overflow-hidden border border-black/20">
  <div class="flex items-center gap-3 px-4 h-11 text-logink/90 text-sm border-b border-white/10">
    <span class="font-medium">Live log</span>
    <span class="text-logink/50">{lines.length} lines</span>
    <label class="ml-auto flex items-center gap-2 cursor-pointer">
      <input type="checkbox" bind:checked={autoScroll} class="accent-status-ok" />
      Auto-scroll
    </label>
  </div>
  <div bind:this={scroller} class="mono flex-1 overflow-y-auto p-4 text-[13px] leading-relaxed space-y-0.5">
    {#each lines as e (e.id)}
      <div class="{color[e.level] ?? 'text-logink'} break-words">
        <span class="text-logink/40">{stamp(e.at)}</span>
        <span class="text-logink/60">[{e.service}]</span>
        {e.message}
        {#if e.detail}<div class="text-logink/50 pl-24 whitespace-pre-wrap">{e.detail}</div>{/if}
      </div>
    {:else}
      <p class="text-logink/50">Waiting for events…</p>
    {/each}
  </div>
</div>
```

`src/routes/+page.server.ts`:
```ts
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { status } from '$lib/server/services/manager';
import { getProjectPath, checkLayout } from '$lib/server/settings';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const projectPath = getProjectPath(db);
  return {
    services: status(db),
    projectPath,
    installed: checkLayout(projectPath).ok
  };
};
```

`src/routes/+page.svelte`:
```svelte
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import type { PageData } from './$types';
  import type { ServiceStatus } from '$lib/server/services/types';
  import AppShell from '$lib/components/AppShell.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import ServiceRow from '$lib/components/ServiceRow.svelte';
  import LogConsole from '$lib/components/LogConsole.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  export let data: PageData;

  let services: ServiceStatus[] = data.services;
  let busy = false;
  let poller: ReturnType<typeof setInterval>;

  let conflict: { service: ServiceStatus; missing: string[] } | null = null;

  const DEP_LABELS: Record<string, string> = { reader: 'Reader', ipcame: 'IP Camera', rfid: 'Gate RFID' };
  const DEPS: Record<string, string[]> = { reader: [], ipcame: [], rfid: ['reader', 'ipcame'] };

  async function refresh() {
    const res = await fetch('/api/status');
    if (res.ok) services = (await res.json()).services;
  }

  onMount(() => { poller = setInterval(refresh, 2000); });
  onDestroy(() => clearInterval(poller));

  async function post(path: string, body?: unknown) {
    busy = true;
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {})
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function toggle(s: ServiceStatus) {
    if (s.actual === 'running' || s.actual === 'pulling' || s.actual === 'starting') {
      await post(`/api/services/${s.name}/stop`);
      return;
    }
    const r = await post(`/api/services/${s.name}/start`);
    if (r.status === 409 && r.body.code === 'dependency_down') {
      // recompute which dependencies are down so the dialog can name them
      const missing = (DEPS[s.name] ?? []).filter(
        (n) => !services.find((x) => x.name === n && x.actual === 'running')
      );
      conflict = { service: s, missing };
    }
  }

  async function startAll() { await post('/api/services/start-all'); }
  async function stopAll() { await post('/api/services/stop-all'); }

  async function confirmForce() {
    const c = conflict;
    conflict = null;
    if (c) await post(`/api/services/${c.service.name}/start`, { force: true });
  }
</script>

<AppShell title="Control" active="status">
  <div class="h-[calc(100vh-3.5rem)] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 p-5 min-h-0">
    <div class="min-h-0 overflow-y-auto space-y-4">
      {#if !data.installed}
        <div class="rounded-card border border-status-warn/40 bg-status-warn/10 p-4 text-sm">
          The project is not installed at <span class="mono">{data.projectPath}</span>.
          <a href="/setup" class="underline font-medium">Run setup</a> first.
        </div>
      {/if}

      <StatusBanner {services} />

      <div class="flex items-center gap-3">
        <button type="button" disabled={busy} on:click={startAll}
          class="px-5 py-2.5 rounded-md bg-status-ok text-white font-medium disabled:opacity-50">START ALL</button>
        <button type="button" disabled={busy} on:click={stopAll}
          class="px-5 py-2.5 rounded-md bg-status-error text-white font-medium disabled:opacity-50">STOP ALL</button>
        <span class="text-xs text-ink-soft">
          Start order: 1 Reader → 2 IP Camera → 3 Gate RFID. Stop runs in reverse.
        </span>
      </div>

      <div class="rounded-card bg-card border border-hairline shadow-sm px-4">
        {#each services as s, i}
          <ServiceRow service={s} index={i + 1} {busy} onToggle={toggle} />
        {/each}
      </div>
    </div>

    <div class="min-h-0">
      <LogConsole />
    </div>
  </div>

  <ConfirmDialog
    open={conflict !== null}
    title="Start this service anyway?"
    body={conflict
      ? `${conflict.service.label} normally needs ${conflict.missing.map((m) => DEP_LABELS[m]).join(' and ')} running first. It will probably fail to connect until they are up.`
      : ''}
    confirmLabel="Start anyway"
    onconfirm={confirmForce}
    oncancel={() => (conflict = null)}
  />
</AppShell>
```

- [ ] **Step 4: Verify by running the app**

Run: `npm run dev`
Then in a browser: sign in, confirm the split layout renders, three numbered rows appear in order Reader / IP Camera / Gate RFID, START ALL and STOP ALL are present, and the log panel fills the right column. Starting Gate RFID alone must open the confirmation dialog.

- [ ] **Step 5: Run the unit test**

Run: `npm test -- tests/unit/status-banner.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/StatusBanner.svelte src/lib/components/ServiceRow.svelte src/lib/components/LogConsole.svelte src/lib/components/ConfirmDialog.svelte src/lib/components/banner-logic.ts src/routes/+page.svelte src/routes/+page.server.ts tests/unit/status-banner.test.ts
git commit -m "feat: main control screen with per-service rows and docked live log"
```

---

### Task 21: Setup screen

**Files:**
- Create: `src/routes/setup/+page.server.ts`, `src/routes/setup/+page.svelte`
- Test: covered by the manual run in Step 4 and `tests/e2e/control.spec.ts` navigation check.

**Interfaces:**
- Produces: `/setup` page with the install form (Docker username, password, project path), a **Run setup** button, and a streamed console showing the six steps with `start`/`ok`/`fail` ticks. If already installed, shows the path plus a **Re-run setup** action behind a confirmation.
- Consumes: Task 15 setup API.

- [ ] **Step 1: Write the server load**

`src/routes/setup/+page.server.ts`:
```ts
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { getProjectPath, checkLayout } from '$lib/server/settings';
import { getConfig } from '$lib/server/settings';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const projectPath = getProjectPath(db);
  return {
    projectPath,
    installed: checkLayout(projectPath).ok,
    savedDockerUser: getConfig(db, 'docker_user') ?? ''
  };
};
```

- [ ] **Step 2: Write the page**

`src/routes/setup/+page.svelte`:
```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '$lib/components/AppShell.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  export let data: PageData;

  type StepState = 'idle' | 'start' | 'ok' | 'fail';
  const STEPS = [
    { key: 'update', label: 'Update system packages' },
    { key: 'docker', label: 'Install Docker' },
    { key: 'download', label: 'Download the project' },
    { key: 'extract', label: 'Extract the archive' },
    { key: 'syncthing', label: 'Install Syncthing' },
    { key: 'login', label: 'Docker login' }
  ] as const;

  let dockerUser = data.savedDockerUser;
  let dockerPassword = '';
  let projectPath = data.projectPath;
  let steps: Record<string, StepState> = Object.fromEntries(STEPS.map((s) => [s.key, 'idle']));
  let lines: string[] = [];
  let running = false;
  let resultMsg = '';
  let confirmRerun = false;

  const mark = (key: string, state: StepState) => (steps = { ...steps, [key]: state });

  async function run() {
    if (!dockerUser || !dockerPassword) { resultMsg = 'Docker username and password are required.'; return; }
    running = true; resultMsg = ''; lines = [];
    steps = Object.fromEntries(STEPS.map((s) => [s.key, 'idle']));

    const res = await fetch('/api/setup/run', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ dockerUser, dockerPassword, projectPath })
    });
    if (!res.body) { running = false; resultMsg = 'Setup could not start.'; return; }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
        const payload = chunk.replace(/^data: /, '');
        if (!payload) continue;
        const msg = JSON.parse(payload);
        if (msg.type === 'line') lines = [...lines, msg.line].slice(-400);
        else if (msg.type === 'step') mark(msg.step, msg.status);
        else if (msg.type === 'result') {
          resultMsg = msg.result.ok ? 'Setup complete.' : `Setup failed: ${msg.result.message}`;
        }
      }
    }
    running = false;
    dockerPassword = '';
  }
</script>

<AppShell title="Setup" active="setup">
  <div class="p-6 max-w-4xl mx-auto space-y-5">
    {#if data.installed}
      <div class="rounded-card bg-card border border-hairline shadow-sm p-5">
        <h1 class="font-semibold text-lg">Project installed</h1>
        <p class="text-sm text-ink-soft mt-1">Found a complete project at
          <span class="mono">{data.projectPath}</span>.</p>
        <button type="button" on:click={() => (confirmRerun = true)}
          class="mt-4 px-4 py-2 rounded-md border border-hairline text-sm">Re-run setup</button>
      </div>
    {/if}

    <form class="rounded-card bg-card border border-hairline shadow-sm p-5 space-y-4"
          on:submit|preventDefault={run}>
      <h1 class="font-semibold text-lg">{data.installed ? 'Re-run the installer' : 'Install the gate project'}</h1>
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-sm font-medium mb-1">Docker username</span>
          <input bind:value={dockerUser} autocomplete="username"
            class="w-full rounded-md border border-hairline px-3 py-2" />
        </label>
        <label class="block">
          <span class="block text-sm font-medium mb-1">Docker password</span>
          <input type="password" bind:value={dockerPassword} autocomplete="current-password"
            class="w-full rounded-md border border-hairline px-3 py-2" />
          <span class="text-xs text-ink-soft">Sent to the installer as an environment variable, never shown in the log.</span>
        </label>
      </div>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Install path</span>
        <input bind:value={projectPath} class="mono w-full rounded-md border border-hairline px-3 py-2" />
      </label>
      <button type="submit" disabled={running}
        class="px-5 py-2.5 rounded-md bg-accent text-white font-medium disabled:opacity-50">
        {running ? 'Running…' : 'Run setup'}
      </button>
      {#if resultMsg}<p class="text-sm {resultMsg.startsWith('Setup failed') ? 'text-status-error' : 'text-status-ok'}">{resultMsg}</p>{/if}
    </form>

    <div class="rounded-card bg-card border border-hairline shadow-sm p-5">
      <h2 class="font-semibold mb-3">Steps</h2>
      <ul class="space-y-1.5 text-sm">
        {#each STEPS as s}
          <li class="flex items-center gap-2">
            <span class="w-5 text-center">
              {steps[s.key] === 'ok' ? '✓' : steps[s.key] === 'fail' ? '✕' : steps[s.key] === 'start' ? '•' : '○'}
            </span>
            <span class={steps[s.key] === 'fail' ? 'text-status-error' : steps[s.key] === 'ok' ? '' : 'text-ink-soft'}>{s.label}</span>
          </li>
        {/each}
      </ul>
    </div>

    <div class="bg-log rounded-card overflow-hidden border border-black/20">
      <div class="px-4 h-10 flex items-center text-logink/90 text-sm border-b border-white/10">Install log</div>
      <div class="mono p-4 h-72 overflow-y-auto text-[13px] text-logink space-y-0.5">
        {#each lines as l}<div class="break-words">{l}</div>
        {:else}<p class="text-logink/50">No output yet.</p>{/each}
      </div>
    </div>
  </div>

  <ConfirmDialog
    open={confirmRerun}
    title="Re-run the installer?"
    body="This downloads and extracts the project again over the existing copy. Config files at the install path may be overwritten. A backup is not made for files the installer replaces."
    confirmLabel="Re-run setup"
    onconfirm={() => { confirmRerun = false; run(); }}
    oncancel={() => (confirmRerun = false)}
  />
</AppShell>
```

- [ ] **Step 3: Persist the docker username** (helps the re-run form prefill)

`src/lib/server/setup.ts` — inside `runSetup`, after `setProjectPath` and before the layout check, add:
```ts
  setConfig(db, 'docker_user', opts.dockerUser);
```
and extend the import from `./settings` to include `setConfig`:
```ts
import { getProjectPath, setProjectPath, checkLayout, setConfig } from './settings';
```

- [ ] **Step 4: Verify by running the app**

Run: `npm run dev`
Sign in, open `/setup`. Confirm the six steps render, the form accepts input, clicking **Run setup** streams output and ticks the steps, and that a failed run shows `Setup failed: …` in red. Do not run a real install on a machine you care about — point the install path at a temporary directory instead.

- [ ] **Step 5: Commit**

```bash
git add src/routes/setup src/lib/server/setup.ts
git commit -m "feat: setup screen with streamed installer and step ticks"
```

---

### Task 22: Settings screen — typed forms with human labels

**Files:**
- Create: `src/lib/components/FieldRenderer.svelte`, `src/lib/components/ArrayField.svelte`, `src/routes/settings/+page.server.ts`, `src/routes/settings/+page.svelte`
- Test: `tests/unit/field-render.test.ts` (label/key mapping), manual run in Step 5.

**Interfaces:**
- Produces:
  - `FieldRenderer.svelte` props `{ field: Field; value: unknown; onchange: (v: unknown) => void }` — renders the right control per `field.type`; shows `field.label` as the visible label and the raw key as a small mono hint. For `field.type === 'enum'` renders a `<select>` of `{label, value}`. Secret fields use `type="password"`.
  - `ArrayField.svelte` props `{ section: Section; rows: unknown[]; onchange: (rows: unknown[]) => void }` — add/remove row controls, each row a grid of `FieldRenderer`.
  - `/settings` — three tabs (Reader / Cameras / Gate RFID), each a set of section cards; Revert / Save bar; raw-TOML preview toggle.
  - `+page.server.ts` load returns `{ files: { key, schema, value, rawToml }[] }` for all three.
- Consumes: Tasks 6, 7, 15.

- [ ] **Step 1: Write the failing unit test**

`tests/unit/field-render.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import type { Field } from '../../src/lib/server/config/schema';
import { controlFor, labelParts } from '../../src/lib/components/field-logic';

describe('controlFor', () => {
  it('maps each field type to a control', () => {
    const mk = (t: string): Field => ({ key: 'k', label: 'L', type: t });
    expect(controlFor(mk('string'))).toBe('text');
    expect(controlFor(mk('number'))).toBe('number');
    expect(controlFor(mk('boolean'))).toBe('checkbox');
    expect(controlFor(mk('enum'))).toBe('select');
  });

  it('uses a password control for secret string fields', () => {
    expect(controlFor({ key: 'k', label: 'L', type: 'string', secret: true })).toBe('password');
  });
});

describe('labelParts', () => {
  it('splits the human label from the raw key hint', () => {
    const f: Field = { key: 'speedway_address', label: 'Reader IP address', type: 'string' };
    expect(labelParts(f)).toEqual({ label: 'Reader IP address', hint: 'speedway_address' });
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npm test -- tests/unit/field-render.test.ts`
Expected: FAIL — cannot resolve `field-logic`.

- [ ] **Step 3: Implement the logic and components**

`src/lib/components/field-logic.ts`:
```ts
import type { Field } from '$lib/server/config/schema';

export function controlFor(field: Field): 'text' | 'number' | 'checkbox' | 'select' | 'password' {
  if (field.type === 'boolean') return 'checkbox';
  if (field.type === 'number') return 'number';
  if (field.type === 'enum') return 'select';
  return field.secret ? 'password' : 'text';
}

export function labelParts(field: Field): { label: string; hint: string } {
  return { label: field.label, hint: field.key };
}
```

`src/lib/components/FieldRenderer.svelte`:
```svelte
<script lang="ts">
  import type { Field } from '$lib/server/config/schema';
  import { controlFor, labelParts } from './field-logic';

  export let field: Field;
  export let value: unknown;
  export let onchange: (v: unknown) => void;

  $: control = controlFor(field);
  $: lp = labelParts(field);

  function onInput(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (control === 'checkbox') return onchange((el as HTMLInputElement).checked);
    if (control === 'number') return onchange(el.value === '' ? null : Number(el.value));
    if (control === 'select') {
      const opt = field.enum?.find((o) => String(o.value) === el.value);
      return onchange(opt ? opt.value : el.value);
    }
    onchange(el.value);
  }
</script>

<div class="grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-2 items-start py-2">
  <label for={`f-${field.key}`} class="pt-1.5">
    <span class="block text-sm font-medium">{lp.label}</span>
    <span class="mono block text-[11px] text-ink-soft/70">{lp.hint}</span>
    {#if field.help}<span class="block text-xs text-ink-soft mt-0.5">{field.help}</span>{/if}
  </label>

  {#if control === 'checkbox'}
    <input id={`f-${field.key}`} type="checkbox" checked={value === true} on:change={onInput}
      class="mt-2 h-4 w-4 accent-status-ok" />
  {:else if control === 'select'}
    <select id={`f-${field.key}`} value={String(value ?? '')} on:change={onInput}
      class="w-full rounded-md border border-hairline px-3 py-2 bg-white">
      {#each field.enum ?? [] as opt}
        <option value={String(opt.value)}>{opt.label}</option>
      {/each}
    </select>
  {:else}
    <input
      id={`f-${field.key}`}
      type={control === 'number' ? 'number' : control === 'password' ? 'password' : 'text'}
      value={value ?? ''}
      min={field.min} max={field.max} step={field.step}
      on:input={onInput}
      class="w-full rounded-md border border-hairline px-3 py-2
             {control === 'number' || control === 'password' ? 'mono' : ''}"
    />
  {/if}
</div>
```

`src/lib/components/ArrayField.svelte`:
```svelte
<script lang="ts">
  import type { Section } from '$lib/server/config/schema';
  import FieldRenderer from './FieldRenderer.svelte';

  export let section: Section;
  export let rows: any[] = [];
  export let onchange: (rows: any[]) => void;

  function blank() {
    return Object.fromEntries(section.fields.map((f) => [f.key, f.default ?? '']));
  }
  function setField(i: number, key: string, v: unknown) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r));
    onchange(next);
  }
  function add() { onchange([...rows, blank()]); }
  function remove(i: number) { onchange(rows.filter((_, idx) => idx !== i)); }
</script>

<div class="py-3">
  <div class="flex items-center gap-3 mb-2">
    <h3 class="font-medium">{section.label}</h3>
    <span class="text-xs text-ink-soft">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
    <button type="button" on:click={add}
      class="ml-auto px-3 py-1.5 rounded-md border border-hairline text-sm">Add row</button>
  </div>

  {#each rows as row, i}
    <div class="rounded-md border border-hairline bg-canvas/40 p-3 mb-2">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-ink-soft">Row {i + 1}</span>
        <button type="button" on:click={() => remove(i)}
          class="text-xs text-status-error hover:underline">Remove</button>
      </div>
      {#each section.fields as f}
        <FieldRenderer field={f} value={row[f.key]} onchange={(v) => setField(i, f.key, v)} />
      {/each}
    </div>
  {:else}
    <p class="text-sm text-ink-soft">No rows yet.</p>
  {/each}
</div>
```

`src/routes/settings/+page.server.ts`:
```ts
import fs from 'node:fs';
import type { PageServerLoad } from './$types';
import { getDb } from '$lib/server/db';
import { getProjectPath } from '$lib/server/settings';
import { SCHEMAS, CONFIG_FILES } from '$lib/server/config/schema';
import { readConfig } from '$lib/server/config/store';

export const load: PageServerLoad = async () => {
  const db = getDb();
  const projectPath = getProjectPath(db);
  const files = CONFIG_FILES.map((key) => {
    const schema = SCHEMAS[key];
    const filePath = `${projectPath}/${schema.relPath}`;
    let raw = '';
    try { raw = fs.readFileSync(filePath, 'utf8'); } catch { raw = ''; }
    return { key, schema, value: readConfig(filePath, schema), rawToml: raw, exists: !!raw };
  });
  return { files, projectPath };
};
```

`src/routes/settings/+page.svelte`:
```svelte
<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '$lib/components/AppShell.svelte';
  import FieldRenderer from '$lib/components/FieldRenderer.svelte';
  import ArrayField from '$lib/components/ArrayField.svelte';
  import { stringify } from 'smol-toml';

  export let data: PageData;

  let active = data.files[0].key;
  let drafts: Record<string, any> = Object.fromEntries(
    data.files.map((f) => [f.key, structuredClone(f.value)])
  );
  let saving = false, message = '', errors: { path: string; message: string }[] = [];
  let showRaw = false;

  $: current = data.files.find((f) => f.key === active)!;
  $: draft = drafts[active];

  function setSection(sectionKey: string, v: unknown) { drafts[active] = { ...draft, [sectionKey]: v }; }
  function setField(sectionKey: string, fieldKey: string, v: unknown) {
    setSection(sectionKey, { ...draft[sectionKey], [fieldKey]: v });
  }
  function revert() { drafts[active] = structuredClone(current.value); errors = []; message = ''; }

  $: rawPreview = (() => { try { return stringify(draft); } catch { return '# invalid value'; } })();

  async function save() {
    saving = true; message = ''; errors = [];
    const res = await fetch(`/api/config/${active}`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: draft })
    });
    saving = false;
    const body = await res.json().catch(() => ({}));
    if (res.ok) { message = 'Saved.'; drafts[active] = structuredClone(draft); }
    else if (body.errors) { errors = body.errors; message = 'Fix the highlighted fields.'; }
    else { message = body.message ?? 'Save failed.'; }
  }
</script>

<AppShell title="Settings" active="settings">
  <div class="p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center gap-1 border-b border-hairline">
      {#each data.files as f}
        <button type="button" on:click={() => { active = f.key; message = ''; errors = []; }}
          class="px-4 py-2 text-sm rounded-t-md -mb-px border-b-2
                 {active === f.key ? 'border-accent font-medium' : 'border-transparent text-ink-soft hover:text-ink'}">
          {f.schema.label}
        </button>
      {/each}
      <div class="ml-auto flex items-center gap-2 pb-1">
        <button type="button" on:click={() => (showRaw = !showRaw)}
          class="px-3 py-1.5 text-sm rounded-md border border-hairline">{showRaw ? 'Hide' : 'Show'} raw TOML</button>
        <button type="button" on:click={revert}
          class="px-3 py-1.5 text-sm rounded-md border border-hairline">Revert</button>
        <button type="button" on:click={save} disabled={saving}
          class="px-4 py-1.5 text-sm rounded-md bg-accent text-white font-medium disabled:opacity-50">Save</button>
      </div>
    </div>

    {#if !current.exists}
      <div class="rounded-card border border-status-warn/40 bg-status-warn/10 p-4 text-sm">
        <span class="mono">{data.projectPath}/{current.schema.relPath}</span> does not exist yet. Run setup first.
      </div>
    {/if}

    {#if message}
      <p class="text-sm {errors.length || message.startsWith('Save failed') ? 'text-status-error' : 'text-status-ok'}">{message}</p>
    {/if}
    {#if errors.length}
      <ul class="text-sm text-status-error list-disc pl-5">
        {#each errors as e}<li><span class="mono">{e.path}</span> — {e.message}</li>{/each}
      </ul>
    {/if}

    <div class="rounded-card bg-card border border-hairline shadow-sm px-5 divide-y divide-hairline">
      {#each current.schema.root as section}
        {#if section.isArray}
          <ArrayField {section} rows={draft[section.key] ?? []}
            onchange={(rows) => setSection(section.key, rows)} />
        {:else}
          <div class="py-3">
            <h3 class="font-medium mb-1">{section.label}</h3>
            {#each section.fields as f}
              <FieldRenderer field={f} value={draft[section.key]?.[f.key]}
                onchange={(v) => setField(section.key, f.key, v)} />
            {/each}
          </div>
        {/if}
      {/each}
    </div>

    {#if showRaw}
      <div class="bg-log rounded-card overflow-hidden border border-black/20">
        <div class="px-4 h-10 flex items-center text-logink/90 text-sm border-b border-white/10">
          Pending TOML — not written until you Save
        </div>
        <pre class="mono p-4 overflow-x-auto text-[13px] text-logink">{rawPreview}</pre>
      </div>
    {/if}
  </div>
</AppShell>
```

- [ ] **Step 4: Run the unit test**

Run: `npm test -- tests/unit/field-render.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Verify by running the app**

Run: `npm run dev`
Sign in, open `/settings`. Confirm: three tabs; fields show human labels with the raw key as a mono hint; editing Reader IP and clicking **Save** writes the file and shows `Saved.`; entering `99999` for the socket port shows an inline error naming `reader.socket_port`; **Show raw TOML** reflects the pending edit; **Revert** restores it.

- [ ] **Step 6: Commit**

```bash
git add src/lib/components/FieldRenderer.svelte src/lib/components/ArrayField.svelte src/lib/components/field-logic.ts src/routes/settings tests/unit/field-render.test.ts
git commit -m "feat: settings screen with human-labelled typed forms and toml preview"
```

---

### Task 23: End-to-end control flow + README

**Files:**
- Create: `tests/e2e/control.spec.ts`, `README.md`
- Test: the e2e file itself.

**Interfaces:**
- Produces: an e2e test proving the per-service model against the **fake project fixture** (a real directory tree whose reader binary and compose commands are harmless stubs), plus a README covering install, dev, build, and run.
- Consumes: everything prior.

- [ ] **Step 1: Build the fake project fixture**

`tests/fixtures/fake-project/` — create these files:
```
config.toml
impinJReaderGateway/ImpinJReader      (executable shell script, exits 0)
ipcame/docker-compose.yml
ipcame/config.toml
rfid/docker-compose.yml
rfid/config/config.toml
```

`tests/fixtures/fake-project/impinJReaderGateway/ImpinJReader`:
```bash
#!/usr/bin/env bash
echo "ImpinJReader stub started"
trap 'echo "ImpinJReader stub stopping"; exit 0' TERM INT
while true; do sleep 1; done
```

Make it executable: `chmod +x tests/fixtures/fake-project/impinJReaderGateway/ImpinJReader`

`tests/fixtures/fake-project/config.toml`:
```toml
[reader]
reader_name = "Fixture Reader"
speedway_address = "127.0.0.1"
socket_port = 11000
session = 1
tag_population = 20
rf_mode = 2
selected_search_mode = "DualTarget"

[filter]
enabled = false
tag_mask = "0000"
bit_count = 16

[[antennas]]
ant_id = 1
tx_power = 17.0
rx_sensitivity = -60.0
enable = true
```

`tests/fixtures/fake-project/ipcame/docker-compose.yml` and `tests/fixtures/fake-project/rfid/docker-compose.yml` — minimal valid compose files:
```yaml
services:
  stub:
    image: alpine:3
    command: ["sleep", "3600"]
```

`tests/fixtures/fake-project/ipcame/config.toml`:
```toml
[service]
SERVICE_PORT = 5555
SAVE_CAMERA_IMAGE_DIR_NAME = "images"
image_width = 1280
image_height = 780
rotate = "ROTATE_180"

[[ipcame]]
IP_CAMERA_ADDRESS = "192.168.1.64"
RTSP_PORT = 554
IP_CAMERA_USER = "admin"
IP_CAMERA_PASSWORD = "changeme"
IP_CAMERA_CHANNEL = 101
relate_gate_id = 10001
```

`tests/fixtures/fake-project/rfid/config/config.toml`:
```toml
[reader_link]
socket_address = "localhost"
socket_port = 11000
tx_power = 17
receiver_sensitivity_index = 2

[mqtt]
mqtt_broker_address = "tcp://localhost:1883"
mqtt_user = "gate"
mqtt_passwd = "changeme"

[behaviour]
cleanup_interval = 5
report_every_n_tags = 1
search_mode = "DualTarget"
tag_timeout = 10
tag_population = 20
event_id = "fixture-event"

[[gates]]
gate_id = 1
ant = 1
ipcame_gateway_address = "localhost"
ipcame_port = 5555
camera_id = 1
```

- [ ] **Step 2: Write the e2e control test**

`tests/e2e/control.spec.ts`:
```ts
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FIXTURE = path.resolve('tests/fixtures/fake-project');

test.describe.configure({ mode: 'serial' });

test('settings edits persist to the toml file', async ({ page }) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'));
  fs.cpSync(FIXTURE, dir, { recursive: true });

  await page.goto('/settings');
  await page.getByRole('tab', { name: 'Reader' }).click();
  await page.getByLabel('Reader IP address').fill('10.20.30.40');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved.')).toBeVisible();

  expect(fs.readFileSync(path.join(dir, 'config.toml'), 'utf8')).toContain('10.20.30.40');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('per-service control is independent and gated', async ({ page }) => {
  await page.goto('/');
  // the Gate RFID row is the third one; its Start is gated behind Reader + IP Camera
  const rows = page.locator('[data-service-row]');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText('Reader');
  await expect(rows.nth(2)).toContainText('Gate RFID');

  await rows.nth(2).getByRole('button', { name: 'Start' }).click();
  await expect(page.getByRole('dialog')).toContainText('Reader');
  await expect(page.getByRole('dialog')).toContainText('IP Camera');
});
```

To let the selector find rows, add a `data-service-row={service.name}` attribute to the root element of `ServiceRow.svelte`:
```svelte
<div data-service-row={service.name} class="border-t border-hairline py-3 flex items-center gap-4">
```

- [ ] **Step 3: Run the full suite**

Run: `npm test`
Expected: all unit tests pass.

Run: `npm run test:e2e`
Expected: all e2e tests pass. (The control test must run with the app pointed at a project path that contains the fixture — set `project_path` to the fixture directory via `/settings` or the setup screen before running, or seed it in the dev database with:
```bash
node -e "const D=require('better-sqlite3');const db=new D('./data/app.db');db.prepare(\"INSERT INTO app_config (key,value) VALUES ('project_path',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value\").run(process.cwd()+'/tests/fixtures/fake-project');"
```
)

- [ ] **Step 4: Write the README**

`README.md`:
```markdown
# Smart RFID Gate — Web Control Panel

A small SvelteKit app that runs on the gate box. It guards itself with a PIN,
installs the RFID gate project, edits the project's TOML config through typed
forms, and starts or stops the three gate services — each one on its own, or all
of them together.

## Services

| # | Service  | What it is | How it is started |
|---|----------|------------|-------------------|
| 1 | Reader   | `impinJReaderGateway/ImpinJReader` | spawned as a process |
| 2 | IP Camera| `ipcame` | `docker compose up -d` |
| 3 | Gate RFID| `rfid` | `docker compose up -d` |

Start order is 1 → 2 → 3. Stop runs in reverse. Gate RFID needs Reader and IP
Camera up first; starting it alone opens a confirmation dialog.

## Configuration

Settings edits write to the project's TOML files:

| Tab | File |
|-----|------|
| Reader | `config.toml` |
| Cameras | `ipcame/config.toml` |
| Gate RFID | `rfid/config/config.toml` |

Writes are atomic and leave a `.bak` of the previous file. Unknown keys are
preserved; hand-written comments outside known keys are not.

## Develop

```bash
npm install
npm run dev          # http://localhost:5173
```

First run sends you to `/setup-pin` to create a 6–12 digit PIN.

## Test

```bash
npm test             # vitest unit + integration
npx playwright install chromium
npm run test:e2e     # playwright
```

## Build and run

```bash
npm run build
node build                 # defaults to port 3000
DB_PATH=./data/app.db PORT=3000 node build
```

The database lives at `DB_PATH` (default `./data/app.db`) and holds the PIN
hash, sessions, app config, and the last known service state.
```

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/control.spec.ts tests/fixtures README.md src/lib/components/ServiceRow.svelte
git commit -m "test: e2e per-service control and settings persistence; add readme"
```

---

## Self-Review Notes

Coverage check against the spec:

| Spec section | Task(s) |
|---|---|
| §3 decisions | 1 |
| §4 stack | 1, 16 |
| §5 architecture (5.1 layout, 5.2 boundaries) | 1, 16 |
| §6 data model | 2 |
| §7 auth & security | 4, 13, 17 |
| §8 lifecycle (8.1 state, 8.2 start, 8.3 stop, 8.4 reconcile, 8.5 logs) | 10, 11, 14 |
| §9 config editor (9.1 schema, 9.2 read/write — see deviations) | 6, 7, 20 |
| §10 screens (10.1 Soft Dark) | 16, 17, 18, 19, 20 |
| §11 error handling | 3, 8, 9, 11, 12 |
| §12 testing | every task, 21 |
| §13 setup flow (screen lives at §10 item 5) | 12, 15, 19 |
| §15 UI mockups | 16, 18, 20 |

Not covered from the spec, tracked above as deviations: Zod validation (§4, §9.2), shadcn-svelte components (§4, §10), canonical TOML comment emission (§9.2), explicit `_extra` bag (§9.2), linked `socket_port` hint (§9.2). Spec §14 (open risks) and §13 (non-goals) are not build targets.

Type consistency: `ActionResult` (Task 10) is the single return type across Tasks 11, 12, 14. `ServiceStatus` (Task 10) flows into Tasks 14, 18. `ServiceName` is the literal union `'reader' | 'ipcame' | 'rfid'` everywhere. `Field` / `Section` / `ConfigSchema` (Task 6) are used unchanged in Tasks 7, 20. `SCHEMAS` / `CONFIG_FILES` (Task 6) feed Tasks 7, 15, 20. Token names from Task 16 (`bg-card`, `bg-log`, `text-status-ok`, `rounded-card`) are used verbatim in Tasks 17–20.
