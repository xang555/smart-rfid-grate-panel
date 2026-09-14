import { describe, it, expect } from 'vitest';
import type { Field } from '../../src/lib/server/config/schema';
import { controlFor, labelParts, formatList, parseList } from '../../src/lib/components/field-logic';

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

  it('gives number lists the list control, not a bare text box', () => {
    expect(controlFor({ key: 'ant', label: 'Antennas', type: 'array<number>' })).toBe('list');
  });
});

describe('formatList', () => {
  it('joins numbers the way the help text shows them', () => {
    expect(formatList([1, 2])).toBe('1, 2');
    expect(formatList([3])).toBe('3');
  });

  it('renders an empty list as nothing', () => {
    expect(formatList([])).toBe('');
    expect(formatList(undefined)).toBe('');
    expect(formatList(null)).toBe('');
  });

  it('tolerates a bare number from a hand-written config', () => {
    expect(formatList(1)).toBe('1');
  });
});

describe('parseList', () => {
  it('reads a comma-separated list into numbers', () => {
    expect(parseList('1, 2')).toEqual([1, 2]);
    expect(parseList('3')).toEqual([3]);
  });

  it('returns an empty list for blank input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList('   ')).toEqual([]);
  });

  it('drops empty and non-numeric entries instead of smuggling them through', () => {
    expect(parseList('1,,2')).toEqual([1, 2]);
    expect(parseList('1,')).toEqual([1]);
    expect(parseList('a, 2')).toEqual([2]);
  });
});

describe('labelParts', () => {
  it('splits the human label from the raw key hint', () => {
    const f: Field = { key: 'speedway_address', label: 'Reader IP address', type: 'string' };
    expect(labelParts(f)).toEqual({ label: 'Reader IP address', hint: 'speedway_address' });
  });
});
