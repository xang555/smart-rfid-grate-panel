<script lang="ts">
  import type { Snippet } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';

  let {
    title,
    active = null,
    children
  }: {
    title: string;
    active?: 'status' | 'setup' | 'settings' | null;
    children: Snippet;
  } = $props();

  let signingOut = $state(false);

  // The endpoint drops the session row and the sid cookie; leaving the page is
  // ours to do, and the layout guard has nothing left to honour.
  async function signOut() {
    if (signingOut) return;
    signingOut = true;
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      signingOut = false;
      await goto('/login');
    }
  }

  const nav = [
    { href: '/', key: 'status', label: 'Status' },
    { href: '/setup', key: 'setup', label: 'Setup' },
    { href: '/settings', key: 'settings', label: 'Settings' }
  ] as const;

  // Monitor is an external webapp; only offer the shortcut once the gate
  // project is installed and an URL has been configured.
  const monitorUrl = $derived(
    page.data.installed && typeof page.data.monitorUrl === 'string' && page.data.monitorUrl !== ''
      ? page.data.monitorUrl
      : null
  );
</script>

<div class="min-h-screen flex flex-col">
  <header class="bg-chrome text-chrome-ink px-5 h-14 flex items-center gap-6">
    <span class="font-semibold tracking-wide">Smart RFID Gate</span>
    <nav class="flex gap-1 text-sm">
      {#each nav as item (item.key)}
        <a
          href={item.href}
          class="px-3 py-1.5 rounded-md transition-colors
                 {active === item.key ? 'bg-white/15 text-white' : 'text-chrome-ink/70 hover:text-white hover:bg-white/10'}"
        >{item.label}</a>
      {/each}
    </nav>
    <div class="ml-auto text-sm text-chrome-ink/80">{title}</div>
    {#if monitorUrl}
      <a
        href={monitorUrl}
        target="_blank"
        rel="noopener noreferrer"
        title="Open monitor ({monitorUrl})"
        aria-label="Open monitor in a new tab"
        class="px-2 py-1.5 rounded-md text-chrome-ink/70 hover:text-white hover:bg-white/10"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
          class="w-5 h-5" aria-hidden="true">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
      </a>
    {/if}
    <button
      type="button"
      disabled={signingOut}
      onclick={signOut}
      class="text-sm px-3 py-1.5 rounded-md text-chrome-ink/70 hover:text-white hover:bg-white/10 disabled:opacity-50"
    >Sign out</button>
  </header>
  <main class="flex-1 min-h-0">
    {@render children()}
  </main>
</div>
