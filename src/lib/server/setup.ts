import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import type Database from 'better-sqlite3';
import { getProjectPath, setProjectPath, checkLayout, setConfig } from './settings';
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
  zipUrl: string;
  projectPath?: string;
  onLine: (line: string) => void;
  onStep: (step: SetupStep, status: 'start' | 'ok' | 'fail') => void;
}

// The archive URL is handed to a shell script. Restricting it to http(s) keeps
// `file:` and friends out — the value still reaches curl quoted, never as a
// bare word, so it cannot be split or re-parsed into a second command.
export function isZipUrl(value: string): boolean {
  if (!value) return false;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return false;
  }
  return parsed.protocol === 'http:' || parsed.protocol === 'https:';
}

export async function runSetup(opts: RunSetupOpts): Promise<ActionResult> {
  const { db } = opts;
  const projectPath = opts.projectPath ? path.resolve(opts.projectPath) : getProjectPath(db);
  const script = path.resolve('scripts/setup.sh');

  if (!isZipUrl(opts.zipUrl)) {
    const msg = 'Download URL must be an http or https link';
    pushLog({ service: 'setup', level: 'error', message: msg, detail: opts.zipUrl });
    return { ok: false, code: 'bad_zip_url', message: msg, detail: opts.zipUrl };
  }

  if (!fs.existsSync(script)) {
    const msg = 'Setup script not found';
    pushLog({ service: 'setup', level: 'error', message: msg, detail: script });
    return { ok: false, code: 'no_script', message: msg, detail: script };
  }

  const lines: string[] = [];
  const tails: string[] = [];
  // Steps the script reported ok itself; anything left unreported when the
  // script exits 0 is completed here so the UI never shows a stuck step.
  const reported = new Set<SetupStep>();

  const proc = await runFn('bash', [script], {
    env: {
      ...process.env,
      PROJECT_PATH: projectPath,
      DOCKER_USER: opts.dockerUser,
      DOCKER_PASSWORD: opts.dockerPassword,
      ZIP_URL: opts.zipUrl,
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
    if (m) {
      const step = m[1] as SetupStep;
      if (m[2] === 'ok') reported.add(step);
      opts.onStep(step, m[2] as 'start' | 'ok' | 'fail');
    } else {
      pushLog({ service: 'setup', level: 'info', message: line });
    }
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

  for (const step of SETUP_STEPS) {
    if (!reported.has(step)) opts.onStep(step, 'ok');
  }

  setProjectPath(db, projectPath);
  setConfig(db, 'docker_user', opts.dockerUser);
  setConfig(db, 'zip_url', opts.zipUrl);
  const check = checkLayout(projectPath);
  if (!check.ok) {
    const msg = 'Setup finished but the project layout is incomplete';
    pushLog({ service: 'setup', level: 'error', message: msg, detail: check.missing.join(', ') });
    return { ok: false, code: 'layout_incomplete', message: msg, detail: check.missing.join(', ') };
  }
  pushLog({ service: 'setup', level: 'success', message: 'Setup complete' });
  return { ok: true, message: 'Setup complete' };
}
