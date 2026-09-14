import type { Field } from '$lib/server/config/schema';

export function controlFor(field: Field): 'text' | 'number' | 'checkbox' | 'select' | 'password' {
  if (field.type === 'boolean') return 'checkbox';
  if (field.type === 'number') return 'number';
  if (field.type === 'enum') return 'select';
  return field.secret ? 'password' : 'text';
}

export function labelParts(field: Field): { label: string; hint: string } {
  return { label: field.label, hint: field.key };
}
