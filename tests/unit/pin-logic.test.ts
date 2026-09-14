import { describe, it, expect } from 'vitest';
import { digitsOnly, boxCount, isValidPin, PIN_LENGTH } from '../../src/lib/components/pin-logic';

describe('digitsOnly', () => {
  it('strips non-digits', () => {
    expect(digitsOnly('a1b2c3', 12)).toBe('123');
  });

  it('caps at the maximum length', () => {
    expect(digitsOnly('123456789012345', 12)).toBe('123456789012');
  });

  it('handles paste with mixed content', () => {
    expect(digitsOnly(' 13-57.90 ', 12)).toBe('135790');
  });
});

describe('boxCount', () => {
  it('starts at the minimum length', () => {
    expect(boxCount(0, 6, 12)).toBe(6);
    expect(boxCount(3, 6, 12)).toBe(6);
  });

  it('grows by one when the last box is filled', () => {
    expect(boxCount(6, 6, 12)).toBe(7);
    expect(boxCount(7, 6, 12)).toBe(8);
  });

  it('stops growing at the maximum length', () => {
    expect(boxCount(12, 6, 12)).toBe(12);
    expect(boxCount(20, 6, 12)).toBe(12);
  });

  it('stays put when min and max are equal', () => {
    expect(boxCount(0, 6, 6)).toBe(6);
    expect(boxCount(6, 6, 6)).toBe(6);
  });
});

describe('isValidPin', () => {
  it('accepts exactly six digits', () => {
    expect(PIN_LENGTH).toBe(6);
    expect(isValidPin('135790')).toBe(true);
  });

  it('rejects any other length', () => {
    expect(isValidPin('')).toBe(false);
    expect(isValidPin('13579')).toBe(false);
    expect(isValidPin('1357901')).toBe(false);
    expect(isValidPin('135790123456')).toBe(false);
  });

  it('rejects non-digits', () => {
    expect(isValidPin('13579a')).toBe(false);
    expect(isValidPin(' 135790')).toBe(false);
    expect(isValidPin('135-90')).toBe(false);
  });
});
