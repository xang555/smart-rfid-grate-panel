import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parse, stringify } from 'smol-toml';
import type { ConfigSchema, Field, Section } from './schema';

type Val = Record<string, unknown>;

function fieldSource(section: Section, parsed: Val): Val {
  // A flat section (key '') draws from the document root itself.
  if (!section.key) return parsed ?? {};
  const src = parsed?.[section.key];
  return src && typeof src === 'object' && !Array.isArray(src) ? (src as Val) : {};
}

function sectionToValue(section: Section, parsed: Val): unknown {
  const src = fieldSource(section, parsed);
  if (section.isArray) {
    const rows = Array.isArray(parsed?.[section.key]) ? (parsed[section.key] as any[]) : [];
    return rows.map((row) => {
      const out: Val = {};
      for (const f of section.fields) out[f.key] = row?.[f.key] ?? f.default;
      return out;
    });
  }
  const out: Val = {};
  for (const f of section.fields) out[f.key] = src[f.key] ?? f.default;
  return out;
}

export function readConfig(filePath: string, schema: ConfigSchema): Val {
  let parsed: Val = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) parsed = parse(raw) as Val;
  }
  const out: Val = {};
  for (const s of schema.root) out[s.key] = sectionToValue(s, parsed);
  return out;
}

interface Ctx { errors: { path: string; message: string }[]; }

function fieldPath(sectionKey: string, fieldKey: string): string {
  return sectionKey ? `${sectionKey}.${fieldKey}` : fieldKey;
}

function checkField(f: Field, value: unknown, at: string, ctx: Ctx): void {
  if (value === undefined || value === null || value === '') {
    if (f.default === undefined) ctx.errors.push({ path: at, message: `${f.label} is required` });
    return;
  }
  if (f.type === 'number') {
    const n = Number(value);
    if (Number.isNaN(n)) return void ctx.errors.push({ path: at, message: `${f.label} must be a number` });
    if (f.min !== undefined && n < f.min) ctx.errors.push({ path: at, message: `${f.label} must be ≥ ${f.min}` });
    if (f.max !== undefined && n > f.max) ctx.errors.push({ path: at, message: `${f.label} must be ≤ ${f.max}` });
    return;
  }
  if (f.type === 'boolean') {
    if (typeof value !== 'boolean') ctx.errors.push({ path: at, message: `${f.label} must be on or off` });
    return;
  }
  if (f.type === 'enum') {
    const ok = (f.enum ?? []).some((e) => e.value === value || String(e.value) === String(value));
    if (!ok) ctx.errors.push({ path: at, message: `${f.label} is not a valid choice` });
    return;
  }
  if (f.type === 'array<number>') {
    if (!Array.isArray(value) || !value.every((n) => Number.isFinite(Number(n)))) {
      ctx.errors.push({ path: at, message: `${f.label} must be a list of numbers` });
    }
    return;
  }
  if (f.type === 'string' && typeof value !== 'string') {
    ctx.errors.push({ path: at, message: `${f.label} must be text` });
  }
}

export function validateConfig(
  schema: ConfigSchema, raw: Val
): { ok: true; value: Val } | { ok: false; errors: { path: string; message: string }[] } {
  const ctx: Ctx = { errors: [] };
  for (const s of schema.root) {
    if (s.isArray) {
      const rows = raw[s.key];
      if (!Array.isArray(rows)) { ctx.errors.push({ path: s.key, message: `${s.label} must be a list` }); continue; }
      rows.forEach((row: any, i: number) => {
        for (const f of s.fields) checkField(f, row?.[f.key], `${s.key}.${i}.${f.key}`, ctx);
      });
    } else {
      const obj = (raw[s.key] ?? {}) as Val;
      for (const f of s.fields) checkField(f, obj[f.key], fieldPath(s.key, f.key), ctx);
    }
  }
  if (ctx.errors.length) return { ok: false, errors: ctx.errors };
  return { ok: true, value: raw };
}

function coerce(f: Field, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (f.type === 'number') return Number(value);
  if (f.type === 'boolean') return value === true || value === 'true';
  if (f.type === 'array<number>') {
    return Array.isArray(value) ? value.map((n) => Number(n)) : value;
  }
  return value;
}

function sectionToToml(section: Section, value: Val): unknown {
  if (section.isArray) {
    const rows = Array.isArray(value[section.key]) ? (value[section.key] as any[]) : [];
    return rows.map((row) => {
      const o: Val = {};
      for (const f of section.fields) o[f.key] = coerce(f, row?.[f.key]);
      return o;
    });
  }
  const src = (value[section.key] ?? {}) as Val;
  const o: Val = {};
  for (const f of section.fields) o[f.key] = coerce(f, src[f.key]);
  return o;
}

export function renderToml(schema: ConfigSchema, value: Val): string {
  const doc: Val = {};
  // Flat sections must come first: smol-toml refuses scalar keys after tables.
  const ordered = [...schema.root].sort((a, b) => Number(!!a.key) - Number(!!b.key));
  for (const s of ordered) {
    if (s.key) doc[s.key] = sectionToToml(s, value) as Val;
    else Object.assign(doc, sectionToToml(s, value) as Val);
  }
  return stringify(doc);
}

export function writeConfig(
  filePath: string, schema: ConfigSchema, value: Val
): { ok: true; backup: string } {
  // Merge into the existing document so unknown keys survive the round trip.
  let existing: Val = {};
  if (fs.existsSync(filePath)) {
    const raw = fs.readFileSync(filePath, 'utf8');
    if (raw.trim()) existing = parse(raw) as Val;
  }
  const merged: Val = { ...existing };
  const ordered = [...schema.root].sort((a, b) => Number(!!a.key) - Number(!!b.key));
  for (const s of ordered) {
    if (s.isArray) {
      merged[s.key] = sectionToToml(s, value);
    } else if (s.key) {
      const prev = (existing[s.key] && typeof existing[s.key] === 'object' && !Array.isArray(existing[s.key])
        ? existing[s.key] : {}) as Val;
      const src = (value[s.key] ?? {}) as Val;
      const o: Val = { ...prev };
      for (const f of s.fields) o[f.key] = coerce(f, src[f.key]);
      merged[s.key] = o;
    } else {
      // Flat: known fields overwrite top-level keys, unknown keys stay.
      const src = (value[''] ?? {}) as Val;
      for (const f of s.fields) merged[f.key] = coerce(f, src[f.key]);
    }
  }

  const text = stringify(merged);
  const backup = filePath + '.bak';
  if (fs.existsSync(filePath)) fs.copyFileSync(filePath, backup);

  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${crypto.randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, text, 'utf8');
  fs.renameSync(tmp, filePath);
  return { ok: true, backup };
}
