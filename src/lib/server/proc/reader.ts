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
