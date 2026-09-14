<script lang="ts">
  import type { ServiceStatus } from '$lib/server/services/types';
  import { isOn as isServiceOn } from '$lib/components/service-logic';

  let {
    service,
    index,
    busy = false,
    onToggle
  }: {
    service: ServiceStatus;
    index: number;
    busy?: boolean;
    onToggle: (s: ServiceStatus) => void;
  } = $props();

  const dot: Record<string, string> = {
    running: 'bg-status-ok', pulling: 'bg-status-warn', starting: 'bg-status-warn',
    stopping: 'bg-status-warn', error: 'bg-status-error', stopped: 'bg-ink-soft'
  };
  const word: Record<string, string> = {
    running: 'RUNNING', pulling: 'PULLING', starting: 'STARTING', stopping: 'STOPPING',
    error: 'ERROR', stopped: 'STOPPED'
  };
  // A pulling service counts as on: the toggle must offer Stop, and docker
  // compose down is safe mid-pull.
  const isOn = $derived(isServiceOn(service.actual));
  const transitioning = $derived(
    service.actual === 'pulling' || service.actual === 'starting' || service.actual === 'stopping'
  );
  const uptime = $derived(
    service.since && service.actual === 'running'
      ? Math.max(0, Math.round((Date.now() - service.since) / 1000))
      : null
  );

  function human(sec: number) {
    if (sec < 60) return `${sec}s`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m`;
    return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
  }
</script>

<div data-service-row={service.name} class="border-t border-hairline py-3 flex items-center gap-4">
  <span class="w-7 h-7 grid place-items-center rounded-full bg-canvas text-ink-soft text-sm font-semibold">{index}</span>
  <div class="flex-1 min-w-0">
    <div class="font-medium">{service.label}</div>
    <div class="text-sm text-ink-soft flex items-center gap-2">
      <span class="inline-block w-2 h-2 rounded-full {dot[service.actual]}"></span>
      <span class="font-medium">{word[service.actual]}</span>
      {#if service.pid}<span class="mono">· pid {service.pid}</span>{/if}
      {#if uptime !== null}<span>· up {human(uptime)}</span>{/if}
      {#if service.detail}<span class="truncate">· {service.detail}</span>{/if}
    </div>
  </div>
  <button
    type="button"
    disabled={busy || transitioning}
    onclick={() => onToggle(service)}
    class="px-4 py-1.5 rounded-md text-sm font-medium disabled:opacity-40
           {isOn
             ? 'border border-status-error/40 text-status-error hover:bg-status-error/10'
             : 'bg-status-ok text-white hover:brightness-105'}"
  >{isOn ? 'Stop' : 'Start'}</button>
</div>
