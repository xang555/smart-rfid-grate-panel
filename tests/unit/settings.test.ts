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
