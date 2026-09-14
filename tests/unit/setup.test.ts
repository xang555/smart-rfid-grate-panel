import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { openDb } from '../../src/lib/server/db';
import { isInstalled, runSetup, setRunForTests, resetRunForTests } from '../../src/lib/server/setup';
import { clearLogs, recentLogs } from '../../src/lib/server/services/logbus';
import { setProjectPath } from '../../src/lib/server/settings';

let db: any, dir: string;

// Seed a complete project layout so a successful script run also passes the
// post-run layout verification.
function makeLayout(project: string) {
  for (const f of [
    'impinJReaderGateway/ImpinJReader', 'config.toml',
    'ipcame/docker-compose.yml', 'ipcame/config.toml',
    'rfid/docker-compose.yml', 'rfid/config/config.toml'
  ]) {
    const full = path.join(project, f);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, '');
  }
}

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
    makeLayout(proj);
    setProjectPath(db, proj);
    expect(isInstalled(db)).toBe(true);
  });
});

describe('runSetup', () => {
  it('passes secrets via env, never argv, and emits every step', async () => {
    const proj = path.join(dir, 'proj');
    makeLayout(proj);
    setProjectPath(db, proj);

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
    // The script only reported the first marker; the runner completes the rest
    // on success so the UI never leaves steps unticked.
    expect(steps).toEqual(['update', 'docker', 'download', 'extract', 'syncthing', 'login']);
    expect(fs.existsSync(path.join(proj, 'config.toml'))).toBe(true);
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
    const proj = path.join(dir, 'proj');
    makeLayout(proj);
    setProjectPath(db, proj);

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
