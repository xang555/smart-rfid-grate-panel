import { describe, it, expect } from 'vitest';
import { isOn } from '../../src/lib/components/service-logic';

describe('isOn', () => {
  it('counts running, pulling and starting as on', () => {
    expect(isOn('running')).toBe(true);
    expect(isOn('pulling')).toBe(true);
    expect(isOn('starting')).toBe(true);
  });

  it('counts stopped, stopping and error as off', () => {
    expect(isOn('stopped')).toBe(false);
    expect(isOn('stopping')).toBe(false);
    expect(isOn('error')).toBe(false);
  });
});
