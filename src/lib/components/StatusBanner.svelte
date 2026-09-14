<script lang="ts">
  import type { ServiceStatus } from '$lib/server/services/types';
  import { bannerState } from './banner-logic';

  let { services }: { services: ServiceStatus[] } = $props();

  const state = $derived(bannerState(services));
  const tone = {
    ok: 'bg-status-ok', warn: 'bg-status-warn', error: 'bg-status-error', idle: 'bg-ink-soft'
  } as const;
</script>

<div class="rounded-card overflow-hidden border border-hairline bg-card shadow-sm">
  <div class="h-1.5 {tone[state.kind]}"></div>
  <div class="px-4 py-3 flex items-center gap-3">
    <span class="inline-block w-3 h-3 rounded-full {tone[state.kind]} shadow-[0_0_0_4px_rgba(0,0,0,0.04)]"></span>
    <div>
      <div class="font-semibold tracking-wide">{state.title}</div>
      {#if state.detail}<div class="text-sm text-ink-soft">{state.detail}</div>{/if}
    </div>
  </div>
</div>
