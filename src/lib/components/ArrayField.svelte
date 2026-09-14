<script lang="ts">
  import type { Section } from '$lib/server/config/schema';
  import FieldRenderer from './FieldRenderer.svelte';

  let {
    section,
    rows,
    onchange
  }: {
    section: Section;
    rows: Record<string, unknown>[];
    onchange: (rows: Record<string, unknown>[]) => void;
  } = $props();

  function blank(): Record<string, unknown> {
    return Object.fromEntries(section.fields.map((f) => [f.key, f.default ?? '']));
  }
  function setField(i: number, key: string, v: unknown) {
    onchange(rows.map((r, idx) => (idx === i ? { ...r, [key]: v } : r)));
  }
  function add() { onchange([...rows, blank()]); }
  function remove(i: number) { onchange(rows.filter((_, idx) => idx !== i)); }
</script>

<div class="py-3">
  <div class="flex items-center gap-3 mb-2">
    <h3 class="font-medium">{section.label}</h3>
    <span class="text-xs text-ink-soft">{rows.length} row{rows.length === 1 ? '' : 's'}</span>
    <button type="button" onclick={add}
      class="ml-auto px-3 py-1.5 rounded-md border border-hairline text-sm">Add row</button>
  </div>

  {#each rows as row, i (i)}
    <div class="rounded-md border border-hairline bg-canvas/40 p-3 mb-2">
      <div class="flex items-center justify-between mb-1">
        <span class="text-xs text-ink-soft">Row {i + 1}</span>
        <button type="button" onclick={() => remove(i)}
          class="text-xs text-status-error hover:underline">Remove</button>
      </div>
      {#each section.fields as f (f.key)}
        <FieldRenderer field={f} value={row[f.key]} onchange={(v) => setField(i, f.key, v)} />
      {/each}
    </div>
  {:else}
    <p class="text-sm text-ink-soft">No rows yet.</p>
  {/each}
</div>
