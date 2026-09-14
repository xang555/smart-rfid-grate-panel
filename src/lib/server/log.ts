import crypto from 'node:crypto';

export function newRequestId(): string {
  return crypto.randomBytes(6).toString('hex');
}

function fmt(level: string, msg: string, meta?: Record<string, unknown>): string {
  const ts = new Date().toISOString();
  const tail = meta && Object.keys(meta).length ? ' ' + JSON.stringify(meta) : '';
  return `${ts} ${level} ${msg}${tail}\n`;
}

export function logInfo(msg: string, meta?: Record<string, unknown>): void {
  process.stdout.write(fmt('INFO', msg, meta));
}

export function logWarn(msg: string, meta?: Record<string, unknown>): void {
  process.stdout.write(fmt('WARN', msg, meta));
}

export function logError(msg: string, meta?: Record<string, unknown>): void {
  process.stderr.write(fmt('ERROR', msg, meta));
}

const SECRET_KEYS = /(password|passwd|pass|token|secret|pwd)\s*[:=]\s*\S+/gi;

export function redact(value: string): string {
  return value.replace(SECRET_KEYS, (m) => m.replace(/[:=]\s*\S+$/, '=***'));
}
