import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type Database from 'better-sqlite3';

const DEFAULT_PROJECT_REL = path.join('Desktop', 'asean-project');

export function getConfig(db: Database.Database, key: string): string | null {
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(key) as any;
  return row ? row.value : null;
}

export function setConfig(db: Database.Database, key: string, value: string): void {
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
}

export function getAllConfig(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM app_config').all() as any[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}

export function getProjectPath(db: Database.Database): string {
  const stored = getConfig(db, 'project_path');
  const raw = stored ?? path.join('~', DEFAULT_PROJECT_REL);
  return path.resolve(expandHome(raw));
}

export function setProjectPath(db: Database.Database, p: string): void {
  setConfig(db, 'project_path', path.resolve(expandHome(p)));
}

export function resolveProjectFile(projectPath: string, rel: string): string {
  const root = path.resolve(projectPath);
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('path_escape');
  return full;
}

const LAYOUT_FILES = [
  'impinJReaderGateway/ImpinJReader',
  'config.toml',
  'ipcame/docker-compose.yml',
  'ipcame/config.toml',
  'rfid/docker-compose.yml',
  'rfid/config/config.toml'
];

export function checkLayout(projectPath: string): { ok: boolean; missing: string[] } {
  const missing = LAYOUT_FILES.filter((f) => !fs.existsSync(resolveProjectFile(projectPath, f)));
  return { ok: missing.length === 0, missing };
}
