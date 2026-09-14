<script lang="ts">
  import { goto } from '$app/navigation';
  import PinPad from '$lib/components/PinPad.svelte';
  import { isValidPin } from '$lib/components/pin-logic';

  let pin = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e?: SubmitEvent) {
    e?.preventDefault();
    if (busy || !isValidPin(pin)) return;
    error = '';
    busy = true;
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (res.ok) { await goto('/'); return; }
      const body = await res.json().catch(() => ({}));
      if (body.code === 'locked') {
        const mins = Math.ceil((body.retryAfterMs ?? 0) / 60000);
        error = `Too many wrong attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.`;
      } else {
        error = 'Incorrect PIN.';
      }
    } finally {
      // Clear the pad after a failure so the next attempt starts fresh — and so
      // the effect below does not fire again on the value we just rejected.
      pin = '';
      busy = false;
    }
  }

  // No button to press: the sixth digit is the submit. Enter still works for
  // anyone with a keyboard, since the fields live in a form.
  $effect(() => {
    if (!busy && isValidPin(pin)) submit();
  });
</script>

<div class="min-h-screen grid place-items-center p-6">
  <form
    class="w-full max-w-sm bg-card rounded-card border border-hairline shadow-sm p-6 space-y-4"
    onsubmit={submit}
  >
    <h1 class="text-lg font-semibold">Smart RFID Gate</h1>
    <PinPad label="PIN" bind:value={pin} disabled={busy} autofocus />
    {#if error}<p role="alert" class="text-sm text-status-error">{error}</p>{/if}
  </form>
</div>
