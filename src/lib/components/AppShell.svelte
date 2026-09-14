<script lang="ts">
  import type { Snippet } from 'svelte';

  let {
    title,
    active = null,
    children
  }: {
    title: string;
    active?: 'status' | 'setup' | 'settings' | null;
    children: Snippet;
  } = $props();

  const nav = [
    { href: '/', key: 'status', label: 'Status' },
    { href: '/setup', key: 'setup', label: 'Setup' },
    { href: '/settings', key: 'settings', label: 'Settings' }
  ] as const;
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
  </header>
  <main class="flex-1 min-h-0">
    {@render children()}
  </main>
</div>
