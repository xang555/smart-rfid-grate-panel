import fs from 'node:fs';
import type Database from 'better-sqlite3';
import { getProjectPath, checkLayout, resolveProjectFile } from '../settings';
import { SCHEMAS } from '../config/schema';
import { parse } from 'smol-toml';
import { spawnReader, stopReader, isAlive, probePort, findReaderPids } from '../proc/reader';
import { runComposeUp, runComposeDown, composeStatus, runComposePull } from '../proc/docker';
import { pull as pullImage, prepareCompose } from '../images';
import { pushLog, type LogLevel } from './logbus';
import {
  SERVICE_ORDER, SERVICE_LABELS, SERVICE_DEPS,
  type ServiceName, type ServiceActual, type ServiceStatus, type ActionResult
} from './types';

interface Deps {
  spawnReader: typeof spawnReader;
  stopReader: typeof stopReader;
  isReaderAlive: (pid: number) => boolean;
  probePort: typeof probePort;
  findReaderPids: typeof findReaderPids;
  composeUp: typeof runComposeUp;
  composeDown: typeof runComposeDown;
  composeStatus: typeof composeStatus;
  composePull: typeof runComposePull;
  pullImage: typeof pullImage;
  prepareCompose: typeof prepareCompose;
  sleep: (ms: number) => Promise<void>;
}

const realDeps: Deps = {
  spawnReader, stopReader, isReaderAlive: isAlive, probePort, findReaderPids,
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

function emit(service: string, level: LogLevel, message: string, detail?: string): void {
  pushLog({ service, level, message, detail });
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
  // The gateway binary binds IPAddress.Any:socket_port on THIS machine;
  // speedway_address is the Impinj hardware it connects out to over LLRP.
  // Readiness/adoption probes must target the local socket — probing the
  // hardware at socket_port never connects and fails every panel start.
  const projectPath = getProjectPath(db);
  const file = resolveProjectFile(projectPath, SCHEMAS.reader.relPath);
  const host = 'localhost';
  let port = 11000;
  try {
    const parsed: any = parse(fs.readFileSync(file, 'utf8'));
    port = Number(parsed?.socket_port ?? 11000);
  } catch { /* fall back to default; readiness probe will fail loudly */ }
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
    // An already-running reader (start.sh, a terminal) owns the socket port;
    // spawning a second one would fail its readiness probe. Adopt instead.
    const { host, port } = readReaderAddr(db);
    if (await deps.probePort(host, port, 500)) {
      const pids = await deps.findReaderPids();
      const pid = pids[0] ?? null;
      setState(db, 'reader', 'running', { pid, detail: pid ? null : 'external' });
      emit('reader', 'info', pid
        ? `Reader already running (pid ${pid}); adopted`
        : 'Reader already running; adopted');
      return { ok: true, service: 'reader', message: 'Reader already running' };
    }

    const { pid } = deps.spawnReader({
      projectPath,
      onLine: (stream, line) => emit('reader', stream === 'stderr' ? 'warn' : 'info', line)
    });
    setState(db, 'reader', 'starting', { pid });
    emit('reader', 'info', `Reader process started (pid ${pid})`);

    let ready = false;
    for (let i = 0; i < 20; i++) {
      await deps.sleep(500);
      if (!deps.isReaderAlive(pid)) break;
      if (await deps.probePort(host, port, 500)) { ready = true; break; }
    }
    if (!ready) {
      const msg = `Reader did not open ${host}:${port}`;
      emit('reader', 'error', msg);
      // The spawn is detached; leaving it alive on a failed start leaks a
      // zombie that no later Stop knows how to reach.
      await deps.stopReader(pid);
      setState(db, 'reader', 'error', { detail: msg });
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
    // Stale/unknown pid, but the reader may have been started outside the
    // panel: if its port answers, find and stop those processes.
    const { host, port } = readReaderAddr(db);
    if (await deps.probePort(host, port, 500)) {
      const pids = await deps.findReaderPids();
      if (pids.length) {
        setState(db, 'reader', 'stopping', { pid: pids[0] });
        for (const p of pids) await deps.stopReader(p);
        setState(db, 'reader', 'stopped', { pid: null });
        emit('reader', 'system', `Reader stopped (external, ${pids.length} process${pids.length > 1 ? 'es' : ''})`);
        return { ok: true, service: 'reader', message: 'Reader stopped' };
      }
    }
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
  if (pullResult.warn) emit(name, 'warn', 'Using the local image', pullResult.warn);

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
  // reader: adopt an externally started reader, else clear a stale pid
  const readerRow = getState(db, 'reader');
  const pid = readerRow?.pid as number | undefined;
  if (pid && deps.isReaderAlive(pid)) {
    setState(db, 'reader', 'running', { pid });
  } else {
    const { host, port } = readReaderAddr(db);
    if (await deps.probePort(host, port, 500)) {
      const pids = await deps.findReaderPids();
      if (pids.length) {
        setState(db, 'reader', 'running', { pid: pids[0] });
        emit('reader', 'system', `Reader already running (pid ${pids[0]}); adopted`);
      }
    } else if (pid || readerRow?.actual === 'running' || readerRow?.actual === 'starting') {
      setState(db, 'reader', 'stopped', { pid: null });
      emit('reader', 'system', 'Reader PID was stale at startup; marked stopped');
    }
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
