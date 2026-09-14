import { json } from '@sveltejs/kit';
import fs from 'node:fs';
import type { RequestHandler } from './$types';
import { getDb } from '$lib/server/db';
import { getProjectPath, resolveProjectFile } from '$lib/server/settings';
import { SCHEMAS, CONFIG_FILES, type ConfigFile } from '$lib/server/config/schema';
import { readConfig, validateConfig, writeConfig } from '$lib/server/config/store';
import { pushLog } from '$lib/server/services/logbus';

function resolveFile(fileKey: string) {
  if (!CONFIG_FILES.includes(fileKey as ConfigFile)) return null;
  const schema = SCHEMAS[fileKey as ConfigFile];
  // relPath is a schema constant, never user input, but resolve it through the
  // same path-safety helper as everything else.
  const filePath = resolveProjectFile(getProjectPath(getDb()), schema.relPath);
  return { schema, filePath };
}

function notFound(): Response {
  return json({ ok: false, message: 'Unknown config file' }, { status: 404 });
}

export const GET: RequestHandler = async ({ params }) => {
  const r = resolveFile(params.file);
  if (!r) return notFound();
  const value = readConfig(r.filePath, r.schema);
  let rawToml = '';
  try { rawToml = fs.readFileSync(r.filePath, 'utf8'); } catch { rawToml = ''; }
  return json({ file: r.schema.key, schema: r.schema, value, rawToml });
};

export const PUT: RequestHandler = async ({ params, request }) => {
  const r = resolveFile(params.file);
  if (!r) return notFound();
  if (!fs.existsSync(r.filePath)) {
    return json({ ok: false, message: 'Config file does not exist yet' }, { status: 404 });
  }
  const body = await request.json().catch(() => ({}));
  const check = validateConfig(r.schema, body?.value ?? {});
  if (!check.ok) return json({ ok: false, errors: check.errors }, { status: 400 });
  const res = writeConfig(r.filePath, r.schema, check.value);
  pushLog({ service: r.schema.key, level: 'system', message: `${r.schema.label} config saved` });
  return json({ ok: true, backup: res.backup });
};
