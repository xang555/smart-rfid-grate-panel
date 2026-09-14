import type { ServiceActual } from '$lib/server/services/types';

// A pulling or starting service counts as on: the toggle must offer Stop, and
// docker compose down is safe mid-pull. Stopping is also the action that asks
// for confirmation, so the caller uses this one rule for both.
export function isOn(actual: ServiceActual): boolean {
  return actual === 'running' || actual === 'pulling' || actual === 'starting';
}
