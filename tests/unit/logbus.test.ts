import { describe, it, expect, beforeEach } from 'vitest';
import { pushLog, recentLogs, subscribeLogs, clearLogs } from '../../src/lib/server/services/logbus';
import { SERVICE_ORDER, SERVICE_DEPS, SERVICE_LABELS } from '../../src/lib/server/services/types';

beforeEach(() => clearLogs());

describe('logbus', () => {
  it('pushes entries with increasing ids and timestamps', () => {
    const a = pushLog({ service: 'reader', level: 'info', message: 'one' });
    const b = pushLog({ service: 'reader', level: 'error', message: 'two', detail: 'stderr' });
    expect(b.id).toBeGreaterThan(a.id);
    expect(b.at).toBeGreaterThanOrEqual(a.at);
    expect(b.detail).toBe('stderr');
  });

  it('recentLogs returns the last N in order', () => {
    for (let i = 0; i < 10; i++) pushLog({ service: 's', level: 'info', message: `m${i}` });
    const r = recentLogs(3);
    expect(r.map((e) => e.message)).toEqual(['m7', 'm8', 'm9']);
  });

  it('caps the ring buffer size', () => {
    for (let i = 0; i < 1200; i++) pushLog({ service: 's', level: 'info', message: `m${i}` });
    expect(recentLogs(2000).length).toBe(1000);
  });

  it('notifies subscribers and unsubscribes cleanly', () => {
    const seen: string[] = [];
    const unsub = subscribeLogs((e) => seen.push(e.message));
    pushLog({ service: 's', level: 'info', message: 'a' });
    unsub();
    pushLog({ service: 's', level: 'info', message: 'b' });
    expect(seen).toEqual(['a']);
  });
});

describe('service constants', () => {
  it('defines order, labels, and deps', () => {
    expect(SERVICE_ORDER).toEqual(['reader', 'ipcame', 'rfid']);
    expect(SERVICE_LABELS.rfid).toBe('Gate RFID');
    expect(SERVICE_DEPS.rfid).toEqual(['reader', 'ipcame']);
    expect(SERVICE_DEPS.reader).toEqual([]);
  });
});
