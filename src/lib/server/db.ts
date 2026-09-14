import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export const SCHEMA_VERSION = 1;

const MIGRATIONS: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS app_config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS pin (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  hash BLOB NOT NULL, salt BLOB NOT NULL, params TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, last_seen INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY, ip TEXT NOT NULL,
  attempted_at INTEGER NOT NULL, success INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts_ip_time ON login_attempts(ip, attempted_at);
CREATE TABLE IF NOT EXISTS service_state (
  name TEXT PRIMARY KEY, desired TEXT NOT NULL, actual TEXT NOT NULL,
  pid INTEGER, detail TEXT, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS service_events (
  id INTEGER PRIMARY KEY, service TEXT NOT NULL, level TEXT NOT NULL,
  message TEXT NOT NULL, detail TEXT, at INTEGER NOT NULL
);
`
  }
];

function migrate(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY)');
  const current = (db.prepare('SELECT MAX(version) AS v FROM schema_version').get() as any).v ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    db.exec(m.sql);
    db.prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)').run(m.version);
  }
}

export function openDb(dbPath: string): Database.Database {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

let _db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (_db) return _db;
  const p = process.env.DB_PATH ?? './data/app.db';
  _db = openDb(p);
  return _db;
}

export function resetDbForTests(): void {
  if (_db) { _db.close(); _db = null; }
}
