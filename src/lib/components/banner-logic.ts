import type { ServiceStatus, ServiceActual } from '$lib/server/services/types';

export type BannerState = { kind: 'ok' | 'warn' | 'error' | 'idle'; title: string; detail: string };

const MOVING_VERB: Record<'pulling' | 'starting' | 'stopping', string> = {
  pulling: 'is pulling its image',
  starting: 'is starting',
  stopping: 'is stopping'
};

export function bannerState(services: ServiceStatus[]): BannerState {
  if (!services.length) return { kind: 'idle', title: 'NO SERVICES', detail: '' };

  const failed = services.filter((s) => s.actual === 'error');
  if (failed.length) {
    return {
      kind: 'error',
      title: 'DEGRADED',
      detail: `${failed.map((s) => s.label).join(', ')} failed${failed[0].detail ? ` — ${failed[0].detail}` : ''}`
    };
  }

  const moving = services.filter(
    (s) => s.actual === 'pulling' || s.actual === 'starting' || s.actual === 'stopping'
  );
  if (moving.length) {
    const first = moving[0].actual as 'pulling' | 'starting' | 'stopping';
    return {
      kind: 'warn',
      title: 'DEGRADED',
      detail: `${moving.map((s) => s.label).join(', ')} ${MOVING_VERB[first]}…`
    };
  }

  if (services.every((s) => s.actual === 'running')) {
    return { kind: 'ok', title: 'OPERATIONAL', detail: 'All three services are running.' };
  }

  return {
    kind: 'idle',
    title: 'ALL SERVICES STOPPED',
    detail: 'Nothing is running. Use START ALL to bring the gate up.'
  };
}

export type { ServiceActual };
