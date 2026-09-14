import type { Field } from '$lib/server/config/schema';

export function controlFor(
  field: Field
): 'text' | 'number' | 'checkbox' | 'select' | 'password' | 'list' {
  if (field.type === 'boolean') return 'checkbox';
  if (field.type === 'number') return 'number';
  if (field.type === 'enum') return 'select';
  if (field.type === 'array<number>') return 'list';
  return field.secret ? 'password' : 'text';
}

export function labelParts(field: Field): { label: string; hint: string } {
  return { label: field.label, hint: field.key };
}

// Number lists are edited as the comma-separated text the field help describes,
// but they must leave the form as numbers. Rendering them through the plain
// text control handed the draft a string, which the raw preview then showed as
// ant = "1, 2" and the file wrote back as the same string.
export function formatList(value: unknown): string {
  const list = Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
  return list
    .filter((n) => Number.isFinite(Number(n)) && String(n).trim() !== '')
    .map((n) => Number(n))
    .join(', ');
}

export function parseList(text: string): number[] {
  return text
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '' && Number.isFinite(Number(part)))
    .map(Number);
}
