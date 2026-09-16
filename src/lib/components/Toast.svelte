<script lang="ts">
  let {
    toast,
    ondismiss
  }: {
    toast: { kind: 'ok' | 'error'; message: string } | null;
    ondismiss: () => void;
  } = $props();

  // Auto-dismiss: long enough to read an errno line, short enough to ignore.
  $effect(() => {
    if (!toast) return;
    const t = setTimeout(ondismiss, toast.kind === 'error' ? 8000 : 4000);
    return () => clearTimeout(t);
  });
</script>

{#if toast}
  <div
    class="fixed bottom-5 right-5 z-50 max-w-md rounded-card border px-4 py-3 text-sm shadow-lg
           {toast.kind === 'error'
      ? 'border-status-error/50 bg-status-error/10 text-status-error'
      : 'border-status-ok/50 bg-status-ok/10 text-status-ok'}"
    role="status"
  >
    <div class="flex items-start gap-3">
      <span class="flex-1 whitespace-pre-wrap">{toast.message}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onclick={ondismiss}
        class="opacity-60 hover:opacity-100"
      >✕</button>
    </div>
  </div>
{/if}
