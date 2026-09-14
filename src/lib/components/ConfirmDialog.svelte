<script lang="ts">
  let {
    open = false,
    title = '',
    body = '',
    confirmLabel = 'Confirm',
    onconfirm,
    oncancel
  }: {
    open?: boolean;
    title?: string;
    body?: string;
    confirmLabel?: string;
    onconfirm: () => void;
    oncancel: () => void;
  } = $props();
</script>

{#if open}
  <div class="fixed inset-0 bg-black/40 grid place-items-center p-4 z-50">
    <div role="dialog" aria-modal="true" class="w-full max-w-md bg-card rounded-card border border-hairline p-5 shadow-xl">
      <h2 class="font-semibold text-lg">{title}</h2>
      <p class="text-sm text-ink-soft mt-2 whitespace-pre-line">{body}</p>
      <div class="mt-5 flex justify-end gap-2">
        <button type="button" onclick={oncancel}
          class="px-4 py-2 rounded-md border border-hairline text-sm">Cancel</button>
        <button type="button" onclick={onconfirm}
          class="px-4 py-2 rounded-md bg-accent text-white text-sm font-medium">{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
