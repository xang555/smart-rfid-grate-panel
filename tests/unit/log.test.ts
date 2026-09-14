import { describe, it, expect, vi } from 'vitest';
import { newRequestId, logInfo, logError, redact } from '../../src/lib/server/log';

describe('log', () => {
  it('newRequestId returns distinct non-empty ids', () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it('logError writes to stderr with the meta attached', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    logError('boom', { req: 'abc' });
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('redact masks passwords and tokens', () => {
    expect(redact('password=laoitdeV')).not.toContain('laoitdeV');
    expect(redact('token: abcdef123456')).not.toContain('abcdef123456');
    expect(redact('nothing secret here')).toBe('nothing secret here');
  });
});
