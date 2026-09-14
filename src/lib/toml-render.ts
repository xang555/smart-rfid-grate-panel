import { stringify } from 'smol-toml';
import type { ConfigSchema, Field, Section } from '$lib/server/config/schema';

// Type-only import above, so this module stays usable from client components:
// the settings screen renders its live TOML preview through renderToml and must
// agree with what the server writes to disk.
type Val = Record<string, unknown>;

export function coerce(f: Field, value: unknown): unknown {
  if (value === undefined || value === null) return value;
  if (f.type === 'number') return Number(value);
  if (f.type === 'boolean') return value === true || value === 'true';
  if (f.type === 'array<number>') {
    return Array.isArray(value) ? value.map((n) => Number(n)) : value;
  }
  return value;
}

export function sectionToToml(section: Section, value: Val): unknown {
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
    // The flat section has no TOML key of its own — and the draft carries it
    // under the key ''. Letting that through as a key emitted a bogus `[""]`
    // line at the top of every preview, so its fields are hoisted instead.
    else Object.assign(doc, sectionToToml(s, value) as Val);
  }
  return stringify(doc);
}
