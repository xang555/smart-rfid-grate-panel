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
