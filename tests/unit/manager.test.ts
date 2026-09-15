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

// compose calls take the arg array from prepareCompose, so derive the
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
    // Port answers only once a reader has been spawned: the pre-spawn
    // "already running?" probe sees a free port, the readiness probe succeeds.
    probePort: vi.fn(async () => calls.includes('spawn:reader')),
    composeUp: vi.fn(async (args: string[]) => { calls.push(`up:${baseOf(args)}`); return { code: 0, stdout: '', stderr: '' }; }),
    composeDown: vi.fn(async (args: string[]) => { calls.push(`down:${baseOf(args)}`); return { code: 0, stdout: '', stderr: '' }; }),
    composeStatus: vi.fn(async () => 'running' as const),
    composePull: vi.fn(async () => ({ code: 0, stdout: '', stderr: '' })),
    // No image configured in these fixtures, so no override is written and no
    // pull happens; pull() resolves ok immediately.
    pullImage: vi.fn(async () => ({ ok: true })),
    findReaderPids: vi.fn(async () => [] as number[]),
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
    expect(calls).toEqual(['spawn:reader', 'stop-reader:100']); // kill the failed spawn; never reached ipcame
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
    const err: any = new Error('Ambiguous compose service: 2 services found (app, sidecar).');
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

describe('existing install adoption', () => {
  it('adopts an externally running reader instead of double-spawning', async () => {
    makeProject();
    const d = fakeDeps({
      probePort: vi.fn(async () => true),
      findReaderPids: vi.fn(async () => [4242])
    });
    setDepsForTests(d);
    const r = await startOne(db, 'reader');
    expect(r.ok).toBe(true);
    expect(d.spawnReader).not.toHaveBeenCalled();
    expect(status(db)[0].actual).toBe('running');
    expect(status(db)[0].pid).toBe(4242);
  });

  it('adopts without a pid when pgrep finds none but the port answers', async () => {
    makeProject();
    const d = fakeDeps({
      probePort: vi.fn(async () => true),
      findReaderPids: vi.fn(async () => [])
    });
    setDepsForTests(d);
    const r = await startOne(db, 'reader');
    expect(r.ok).toBe(true);
    expect(d.spawnReader).not.toHaveBeenCalled();
    expect(status(db)[0].actual).toBe('running');
  });

  it('kills a spawned reader that never opens its port', async () => {
    makeProject();
    const d = fakeDeps({
      probePort: vi.fn(async () => false),
      findReaderPids: vi.fn(async () => [])
    });
    setDepsForTests(d);
    const r = await startOne(db, 'reader');
    expect(r.ok).toBe(false);
    expect(d.stopReader).toHaveBeenCalledWith(100);
  });

  it('stops an externally started reader via the pgrep fallback', async () => {
    makeProject();
    db.prepare(
      `INSERT INTO service_state (name, desired, actual, pid, detail, updated_at)
       VALUES ('reader', 'running', 'running', 9999, NULL, ?)`
    ).run(Date.now());
    const d = fakeDeps({
      isReaderAlive: vi.fn(() => false),
      probePort: vi.fn(async () => true),
      findReaderPids: vi.fn(async () => [55, 56])
    });
    setDepsForTests(d);
    const r = await stopOne(db, 'reader');
    expect(r.ok).toBe(true);
    expect(d.stopReader).toHaveBeenCalledWith(55);
    expect(d.stopReader).toHaveBeenCalledWith(56);
    expect(status(db)[0].actual).toBe('stopped');
  });

  it('reconcile adopts an externally running reader', async () => {
    makeProject();
    const d = fakeDeps({
      probePort: vi.fn(async () => true),
      findReaderPids: vi.fn(async () => [777])
    });
    setDepsForTests(d);
    await reconcile(db);
    expect(status(db)[0].actual).toBe('running');
    expect(status(db)[0].pid).toBe(777);
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
