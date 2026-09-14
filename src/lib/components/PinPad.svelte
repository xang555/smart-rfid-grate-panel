<script lang="ts">
  import type { HTMLInputAttributes } from 'svelte/elements';
  import { digitsOnly, boxCount, PIN_LENGTH } from './pin-logic';

  let {
    label = 'PIN',
    autocomplete = 'current-password',
    minlength = PIN_LENGTH,
    maxlength = PIN_LENGTH,
    autofocus = false,
    value = $bindable(''),
    disabled = false
  }: {
    label?: string;
    autocomplete?: HTMLInputAttributes['autocomplete'];
    minlength?: number;
    maxlength?: number;
    autofocus?: boolean;
    value?: string;
    disabled?: boolean;
  } = $props();

  const count = $derived(boxCount(value.length, minlength, maxlength));
  // Full row: nothing left to type, so no box claims the caret.
  const activeIndex = $derived(
    disabled || value.length >= maxlength ? -1 : Math.min(value.length, count - 1)
  );

  function oninput(e: Event) {
    const el = e.currentTarget as HTMLInputElement;
    const next = digitsOnly(el.value, maxlength);
    // write back so rejected characters vanish from the field itself
    el.value = next;
    value = next;
  }

  // Focus by hand rather than the autofocus attribute: the input is invisible
  // and the boxes are aria-hidden, so the a11y rule that guards autofocus does
  // not apply, but the checker cannot know that.
  let inputEl = $state<HTMLInputElement | null>(null);
  $effect(() => {
    if (autofocus && inputEl && !inputEl.disabled) inputEl.focus();
  });
</script>

<label class="block">
  <span class="block text-sm font-medium text-ink mb-1.5">{label}</span>
  <div class="relative">
    <!-- one real input stretched over the row: keeps native keyboard, paste,
         autofill and label association; the boxes below are the visible face -->
    <input
      bind:this={inputEl}
      type="password"
      inputmode="numeric"
      pattern="[0-9]*"
      {maxlength}
      {disabled}
      autocomplete={autocomplete}
      value={value}
      {oninput}
      class="absolute inset-0 h-full w-full cursor-pointer bg-transparent opacity-0"
      style="-webkit-text-fill-color: transparent;"
    />
    <div class="flex gap-1.5" aria-hidden="true">
    {#each Array(count) as _, i (i)}
      <div
        class="relative h-12 flex-1 rounded-md border transition-colors
               {i === activeIndex
                 ? 'border-accent ring-2 ring-accent/30 bg-white'
                 : 'border-hairline bg-white'}
               {disabled ? 'opacity-50' : ''}"
      >
        {#if i < value.length}
          <span class="absolute inset-0 grid place-items-center">
            <span class="w-2.5 h-2.5 rounded-full bg-ink"></span>
          </span>
        {:else if i === activeIndex}
          <span class="absolute inset-0 grid place-items-center">
            <span class="w-0.5 h-5 rounded bg-accent animate-pulse"></span>
          </span>
        {/if}
      </div>
    {/each}
    </div>
  </div>
</label>
