<script lang="ts">
  import type { Field } from '$lib/server/config/schema';
  import { controlFor, labelParts, formatList, parseList } from './field-logic';

  let {
    field,
    value,
    onchange
  }: {
    field: Field;
    value: unknown;
    onchange: (v: unknown) => void;
  } = $props();

  const control = $derived(controlFor(field));
  const lp = $derived(labelParts(field));

  function onInput(e: Event) {
    const el = e.target as HTMLInputElement | HTMLSelectElement;
    if (control === 'checkbox') return onchange((el as HTMLInputElement).checked);
    if (control === 'number') return onchange(el.value === '' ? null : Number(el.value));
    if (control === 'list') return onchange(parseList(el.value));
    if (control === 'select') {
      const opt = field.enum?.find((o) => String(o.value) === el.value);
      return onchange(opt ? opt.value : el.value);
    }
    onchange(el.value);
  }
</script>

<div class="grid sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)] gap-2 items-start py-2">
  <label for={`f-${field.key}`} class="pt-1.5">
    <span class="block text-sm font-medium">{lp.label}</span>
    <span class="mono block text-[11px] text-ink-soft/70">{lp.hint}</span>
    {#if field.help}<span class="block text-xs text-ink-soft mt-0.5">{field.help}</span>{/if}
  </label>

  {#if control === 'checkbox'}
    <input id={`f-${field.key}`} type="checkbox" checked={value === true} onchange={onInput}
      class="mt-2 h-4 w-4 accent-status-ok" />
  {:else if control === 'select'}
    <select id={`f-${field.key}`} value={String(value ?? '')} onchange={onInput}
      class="w-full rounded-md border border-hairline px-3 py-2 bg-white">
      {#each field.enum ?? [] as opt (String(opt.value))}
        <option value={String(opt.value)}>{opt.label}</option>
      {/each}
    </select>
  {:else}
    <input
      id={`f-${field.key}`}
      type={control === 'number' ? 'number' : control === 'password' ? 'password' : 'text'}
      value={control === 'list' ? formatList(value) : value ?? ''}
      min={field.min} max={field.max} step={field.step}
      oninput={onInput}
      class="w-full rounded-md border border-hairline px-3 py-2
             {control === 'number' || control === 'password' || control === 'list' ? 'mono' : ''}"
    />
  {/if}
</div>
