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
