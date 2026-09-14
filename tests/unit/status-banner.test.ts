import { describe, it, expect } from 'vitest';
import { bannerState } from '../../src/lib/components/banner-logic';

const mk = (actuals: Record<string, string>) =>
  ['reader', 'ipcame', 'rfid'].map((name, i) => ({
    name: name as any,
    label: ['Reader', 'IP Camera', 'Gate RFID'][i],
    actual: actuals[name] as any
  }));

describe('bannerState', () => {
  it('is operational when all three run', () => {
    const s = bannerState(mk({ reader: 'running', ipcame: 'running', rfid: 'running' }));
    expect(s.kind).toBe('ok');
    expect(s.title).toBe('OPERATIONAL');
  });

  it('is degraded and names the failing service', () => {
    const s = bannerState(mk({ reader: 'running', ipcame: 'error', rfid: 'stopped' }));
    expect(s.kind).toBe('error');
    expect(s.title).toBe('DEGRADED');
    expect(s.detail).toContain('IP Camera');
  });

  it('is degraded while transitioning', () => {
    const s = bannerState(mk({ reader: 'starting', ipcame: 'running', rfid: 'running' }));
    expect(s.kind).toBe('warn');
    expect(s.detail).toContain('Reader');
  });

  it('is idle when everything is stopped', () => {
    const s = bannerState(mk({ reader: 'stopped', ipcame: 'stopped', rfid: 'stopped' }));
    expect(s.kind).toBe('idle');
    expect(s.title).toBe('ALL SERVICES STOPPED');
  });
});
