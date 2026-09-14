<script lang="ts">
  import { goto } from '$app/navigation';
  import PinPad from '$lib/components/PinPad.svelte';
  import { isValidPin } from '$lib/components/pin-logic';

  let pin = $state('');
  let confirm = $state('');
  let error = $state('');
  let busy = $state(false);

  async function submit(e: SubmitEvent) {
    e.preventDefault();
    error = '';
    if (!isValidPin(pin)) { error = 'Use exactly 6 digits.'; return; }
    if (pin !== confirm) { error = 'The two PINs do not match.'; return; }
    busy = true;
    try {
      const res = await fetch('/api/auth/setup-pin', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pin })
      });
      if (res.ok) { await goto('/'); return; }
      const body = await res.json().catch(() => ({}));
      error = body.message ?? 'Could not create the PIN.';
    } finally {
      busy = false;
    }
  }
</script>

<div class="min-h-screen grid place-items-center p-6">
  <form
    class="w-full max-w-sm bg-card rounded-card border border-hairline shadow-sm p-6 space-y-4"
    onsubmit={submit}
  >
    <div>
      <h1 class="text-lg font-semibold">Create the panel PIN</h1>
      <p class="text-sm text-ink-soft mt-1">Exactly 6 digits. Wrong entries lock this device for 15 minutes after 5 tries.</p>
    </div>
    <PinPad label="PIN" bind:value={pin} autocomplete="new-password" disabled={busy} />
    <PinPad label="Confirm PIN" bind:value={confirm} autocomplete="new-password" disabled={busy} />
    {#if error}<p role="alert" class="text-sm text-status-error">{error}</p>{/if}
    <button
      type="submit" disabled={busy}
      class="w-full rounded-md bg-accent text-white py-2 font-medium disabled:opacity-50"
    >Create PIN</button>
  </form>
</div>
