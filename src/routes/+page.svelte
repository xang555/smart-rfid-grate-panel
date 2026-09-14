<script lang="ts">
  import { onMount } from 'svelte';
  import type { PageData } from './$types';
  import type { ServiceStatus } from '$lib/server/services/types';
  import AppShell from '$lib/components/AppShell.svelte';
  import StatusBanner from '$lib/components/StatusBanner.svelte';
  import ServiceRow from '$lib/components/ServiceRow.svelte';
  import LogConsole from '$lib/components/LogConsole.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  let { data }: { data: PageData } = $props();

  // snapshot the server load once; fresh values arrive via /api/status polling
  // svelte-ignore state_referenced_locally
  let services = $state<ServiceStatus[]>(data.services);
  let busy = $state(false);
  let conflict = $state<{ service: ServiceStatus; missing: string[] } | null>(null);

  const DEP_LABELS: Record<string, string> = { reader: 'Reader', ipcame: 'IP Camera', rfid: 'Gate RFID' };
  const DEPS: Record<string, string[]> = { reader: [], ipcame: [], rfid: ['reader', 'ipcame'] };

  async function refresh() {
    const res = await fetch('/api/status');
    if (res.ok) services = (await res.json()).services;
  }

  onMount(() => {
    const poller = setInterval(refresh, 2000);
    return () => clearInterval(poller);
  });

  async function post(path: string, body?: unknown) {
    busy = true;
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {})
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    } finally {
      busy = false;
      await refresh();
    }
  }

  async function toggle(s: ServiceStatus) {
    if (s.actual === 'running' || s.actual === 'pulling' || s.actual === 'starting') {
      await post(`/api/services/${s.name}/stop`);
      return;
    }
    const r = await post(`/api/services/${s.name}/start`);
    if (r.status === 409 && r.body.code === 'dependency_down') {
      // recompute which dependencies are down so the dialog can name them
      const missing = (DEPS[s.name] ?? []).filter(
        (n) => !services.find((x) => x.name === n && x.actual === 'running')
      );
      conflict = { service: s, missing };
    }
  }

  async function startAll() { await post('/api/services/start-all'); }
  async function stopAll() { await post('/api/services/stop-all'); }

  async function confirmForce() {
    const c = conflict;
    conflict = null;
    if (c) await post(`/api/services/${c.service.name}/start`, { force: true });
  }
</script>

<AppShell title="Control" active="status">
  <div class="h-[calc(100vh-3.5rem)] grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-5 p-5 min-h-0">
    <div class="min-h-0 overflow-y-auto space-y-4">
      {#if !data.installed}
        <div class="rounded-card border border-status-warn/40 bg-status-warn/10 p-4 text-sm">
          The project is not installed at <span class="mono">{data.projectPath}</span>.
          <a href="/setup" class="underline font-medium">Run setup</a> first.
        </div>
      {/if}

      <StatusBanner {services} />

      <div class="flex items-center gap-3">
        <button type="button" disabled={busy} onclick={startAll}
          class="px-5 py-2.5 rounded-md bg-status-ok text-white font-medium disabled:opacity-50">START ALL</button>
        <button type="button" disabled={busy} onclick={stopAll}
          class="px-5 py-2.5 rounded-md bg-status-error text-white font-medium disabled:opacity-50">STOP ALL</button>
        <span class="text-xs text-ink-soft">
          Start order: 1 Reader → 2 IP Camera → 3 Gate RFID. Stop runs in reverse.
        </span>
      </div>

      <div class="rounded-card bg-card border border-hairline shadow-sm px-4">
        {#each services as s, i (s.name)}
          <ServiceRow service={s} index={i + 1} {busy} onToggle={toggle} />
        {/each}
      </div>
    </div>

    <div class="min-h-0">
      <LogConsole />
    </div>
  </div>

  <ConfirmDialog
    open={conflict !== null}
    title="Start this service anyway?"
    body={conflict
      ? `${conflict.service.label} normally needs ${conflict.missing.map((m) => DEP_LABELS[m]).join(' and ')} running first. It will probably fail to connect until they are up.`
      : ''}
    confirmLabel="Start anyway"
    onconfirm={confirmForce}
    oncancel={() => (conflict = null)}
  />
</AppShell>
