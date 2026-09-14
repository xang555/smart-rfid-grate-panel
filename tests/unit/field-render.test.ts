import { describe, it, expect } from 'vitest';
import type { Field } from '../../src/lib/server/config/schema';
import { controlFor, labelParts } from '../../src/lib/components/field-logic';

describe('controlFor', () => {
  it('maps each field type to a control', () => {
    const mk = (t: string): Field => ({ key: 'k', label: 'L', type: t });
    expect(controlFor(mk('string'))).toBe('text');
    expect(controlFor(mk('number'))).toBe('number');
    expect(controlFor(mk('boolean'))).toBe('checkbox');
    expect(controlFor(mk('enum'))).toBe('select');
  });

  it('uses a password control for secret string fields', () => {
    expect(controlFor({ key: 'k', label: 'L', type: 'string', secret: true })).toBe('password');
  });
});

describe('labelParts', () => {
  it('splits the human label from the raw key hint', () => {
    const f: Field = { key: 'speedway_address', label: 'Reader IP address', type: 'string' };
    expect(labelParts(f)).toEqual({ label: 'Reader IP address', hint: 'speedway_address' });
  });
});
