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
