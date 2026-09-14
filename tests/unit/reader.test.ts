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
    fs.writeFileSync(path.join(dir, 'config.toml'), '');
    expect(() => spawnReader({ projectPath: dir, onLine: () => {} }))
      .toThrow('reader_binary_missing');
  });

  it('throws when the config is missing', () => {
    fs.writeFileSync(path.join(dir, 'impinJReaderGateway/ImpinJReader'), '');
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
