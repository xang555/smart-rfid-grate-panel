<script lang="ts">
  import { onMount } from 'svelte';

  type Entry = { id: number; service: string; level: string; message: string; detail?: string; at: number };

  let lines = $state<Entry[]>([]);
  let autoScroll = $state(true);
  let scroller = $state<HTMLDivElement | null>(null);
  let source: EventSource | null = null;

  const color: Record<string, string> = {
    info: 'text-logink', success: 'text-status-ok', warn: 'text-status-warn',
    error: 'text-status-error', system: 'text-accent'
  };

  onMount(() => {
    source = new EventSource('/api/logs');
    source.onmessage = (ev) => {
      const e = JSON.parse(ev.data) as Entry;
      lines = [...lines, e].slice(-500);
      if (autoScroll) queueMicrotask(() => scroller?.scrollTo({ top: scroller.scrollHeight }));
    };
    return () => source?.close();
  });

  const stamp = (ms: number) => new Date(ms).toTimeString().slice(0, 8);
</script>

<div class="h-full flex flex-col bg-log rounded-card overflow-hidden border border-black/20">
  <div class="flex items-center gap-3 px-4 h-11 text-logink/90 text-sm border-b border-white/10">
    <span class="font-medium">Live log</span>
    <span class="text-logink/50">{lines.length} lines</span>
    <button
      type="button"
      onclick={() => {
        lines = [];
        // Server-side too: a refresh replays the buffer via recentLogs().
        fetch('/api/logs', { method: 'DELETE' }).catch(() => {});
      }}
      class="px-2 py-0.5 rounded border border-white/15 text-logink/70 hover:text-white hover:bg-white/10"
      title="Clear the log (also clears it for future refreshes)"
    >Clear</button>
    <label class="ml-auto flex items-center gap-2 cursor-pointer">
      <input type="checkbox" bind:checked={autoScroll} class="accent-status-ok" />
      Auto-scroll
    </label>
  </div>
  <div bind:this={scroller} class="mono flex-1 overflow-y-auto p-4 text-[13px] leading-relaxed space-y-0.5">
    {#each lines as e (e.id)}
      <div class="{color[e.level] ?? 'text-logink'} break-words">
        <span class="text-logink/40">{stamp(e.at)}</span>
        <span class="text-logink/60">[{e.service}]</span>
        {e.message}
        {#if e.detail}<div class="text-logink/50 pl-24 whitespace-pre-wrap">{e.detail}</div>{/if}
      </div>
    {:else}
      <p class="text-logink/50">Waiting for events…</p>
    {/each}
  </div>
</div>
