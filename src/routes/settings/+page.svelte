<script lang="ts">
  import type { PageData } from './$types';
  import { invalidateAll } from '$app/navigation';
  import AppShell from '$lib/components/AppShell.svelte';
  import FieldRenderer from '$lib/components/FieldRenderer.svelte';
  import ArrayField from '$lib/components/ArrayField.svelte';
  import Toast from '$lib/components/Toast.svelte';
  import { renderToml } from '$lib/toml-render';
  import { buildTargets, type ConnResult } from '$lib/connection-logic';

  let { data }: { data: PageData } = $props();

  // snapshot the server load once; revert and save re-seed from these values
  // svelte-ignore state_referenced_locally
  let active = $state<string>(data.files[0].key);
  // Section values arrive as untyped JSON over the network; the server
  // re-validates the whole draft against the schema on save.
  // svelte-ignore state_referenced_locally
  let drafts = $state<Record<string, any>>(
    Object.fromEntries(data.files.map((f) => [f.key, structuredClone(f.value)]))
  );
  let saving = $state(false);
  let message = $state('');
  // Set by whoever writes `message`, not inferred from its wording.
  let messageOk = $state(false);
  let errors = $state<{ path: string; message: string }[]>([]);
  let showRaw = $state(false);

  // connection test (per config tab)
  let testing = $state(false);
  let testResults = $state<ConnResult[] | null>(null);
  // monitor url card
  // svelte-ignore state_referenced_locally
  let monitorUrl = $state<string>(data.monitorUrl);
  let savingMonitor = $state(false);
  let toast = $state<{ kind: 'ok' | 'error'; message: string } | null>(null);

  const isMonitor = $derived(active === 'monitor');
  const current = $derived(isMonitor ? undefined : data.files.find((f) => f.key === active)!);
  const draft = $derived(isMonitor ? null : drafts[active]);

  function setSection(sectionKey: string, v: unknown) {
    drafts[active] = { ...drafts[active], [sectionKey]: v };
  }
  function setField(sectionKey: string, fieldKey: string, v: unknown) {
    setSection(sectionKey, { ...drafts[active][sectionKey], [fieldKey]: v });
  }
  function revert() {
    if (!current) return; // monitor tab has no draft to revert
    drafts[active] = structuredClone(current.value);
    errors = [];
    message = '';
  }
  function switchTab(key: string) {
    active = key;
    message = '';
    errors = [];
    testResults = null;
  }

  const rawPreview = $derived.by(() => {
    if (isMonitor) return '';
    // Same renderer the server writes with, so the preview cannot drift from
    // the file — and the flat section's '' key never reaches TOML as a name.
    try { return renderToml(current!.schema, draft); } catch { return '# invalid value'; }
  });

  async function save() {
    saving = true; message = ''; errors = [];
    try {
      const res = await fetch(`/api/config/${active}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: draft })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { messageOk = true; message = 'Saved.'; }
      else if (body.errors) { messageOk = false; errors = body.errors; message = 'Fix the highlighted fields.'; }
      else { messageOk = false; message = body.message ?? 'Save failed.'; }
    } finally {
      saving = false;
    }
  }

  // Probes what the form currently shows (not the saved file), so an edited
  // IP can be checked before committing it.
  async function testConnection() {
    if (testing) return;
    testing = true; testResults = null; toast = null;
    try {
      const targets = buildTargets(active, draft);
      const res = await fetch('/api/config/test-connection', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets })
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast = { kind: 'error', message: body.message ?? 'Connection test failed.' };
        return;
      }
      testResults = body.results;
      const failed = body.results.filter((r: ConnResult) => !r.ok);
      if (failed.length) {
        toast = { kind: 'error', message: `${failed.length} connection${failed.length > 1 ? 's' : ''} failed:\n` +
          failed.map((r: ConnResult) => `${r.label}: ${r.error}`).join('\n') };
      }
    } catch (err: any) {
      toast = { kind: 'error', message: `Connection test failed: ${err?.message ?? err}` };
    } finally {
      testing = false;
    }
  }

  async function saveMonitor() {
    if (savingMonitor) return;
    savingMonitor = true;
    try {
      const res = await fetch('/api/monitor', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: monitorUrl.trim() })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        toast = { kind: 'ok', message: 'Monitor URL saved.' };
        await invalidateAll(); // layout refetch → topbar button updates
      } else {
        toast = { kind: 'error', message: body.message ?? 'Could not save the monitor URL.' };
      }
    } finally {
      savingMonitor = false;
    }
  }
</script>

<AppShell title="Settings" active="settings">
  <div class="p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center gap-1 border-b border-hairline">
      {#each [...data.files.map((f) => ({ key: f.key, label: f.schema.label })), { key: 'monitor', label: 'Monitor' }] as t (t.key)}
        <button type="button" onclick={() => switchTab(t.key)}
          class="px-4 py-2 text-sm rounded-t-md -mb-px border-b-2
                 {active === t.key ? 'border-accent font-medium' : 'border-transparent text-ink-soft hover:text-ink'}">
          {t.label}
        </button>
      {/each}
      {#if !isMonitor}
        <div class="ml-auto flex items-center gap-2 pb-1">
          <button type="button" onclick={testConnection} disabled={testing}
            class="px-3 py-1.5 text-sm rounded-md border border-hairline disabled:opacity-50"
            title="Probe the addresses configured on this tab">
            {testing ? 'Testing…' : 'Test connection'}
          </button>
          <button type="button" onclick={() => (showRaw = !showRaw)}
            class="px-3 py-1.5 text-sm rounded-md border border-hairline">{showRaw ? 'Hide' : 'Show'} raw TOML</button>
          <button type="button" onclick={revert}
            class="px-3 py-1.5 text-sm rounded-md border border-hairline">Revert</button>
          <button type="button" onclick={save} disabled={saving}
            class="px-4 py-1.5 text-sm rounded-md bg-accent text-white font-medium disabled:opacity-50">Save</button>
        </div>
      {/if}
    </div>

    {#if isMonitor}
      <div class="rounded-card bg-card border border-hairline shadow-sm px-5 py-4 max-w-2xl">
        <h3 class="font-medium">Monitor</h3>
        <p class="text-sm text-ink-soft mt-1 mb-3">
          URL of your monitoring webapp. When setup is complete, a monitor button
          appears in the top bar and opens this URL in a new tab.
        </p>
        <div class="flex items-center gap-2">
          <input
            type="url"
            bind:value={monitorUrl}
            placeholder="https://monitor.example.com"
            class="flex-1 rounded-md border border-hairline bg-transparent px-3 py-1.5 text-sm mono"
          />
          <button type="button" onclick={saveMonitor} disabled={savingMonitor}
            class="px-4 py-1.5 text-sm rounded-md bg-accent text-white font-medium disabled:opacity-50">
            {savingMonitor ? 'Saving…' : 'Save monitor URL'}
          </button>
        </div>
      </div>
    {:else}
      {#if !current!.exists}
        <div class="rounded-card border border-status-warn/40 bg-status-warn/10 p-4 text-sm">
          <span class="mono">{data.projectPath}/{current!.schema.relPath}</span> does not exist yet. Run setup first.
        </div>
      {/if}

      {#if message}
        <p class="text-sm {messageOk ? 'text-status-ok' : 'text-status-error'}">{message}</p>
      {/if}
      {#if errors.length}
        <ul class="text-sm text-status-error list-disc pl-5">
          {#each errors as e (e.path)}<li><span class="mono">{e.path}</span> — {e.message}</li>{/each}
        </ul>
      {/if}

      {#if testResults}
        <div class="rounded-card border border-hairline bg-card px-5 py-3 text-sm">
          <h3 class="font-medium mb-2">Connection test — {current!.schema.label}</h3>
          <ul class="space-y-1">
            {#each testResults as r (r.label + r.host + r.port)}
              <li class="flex items-baseline gap-2">
                <span class="{r.ok ? 'text-status-ok' : 'text-status-error'} font-medium">
                  {r.ok ? '✓' : '✕'}
                </span>
                <span class="font-medium">{r.label}</span>
                <span class="mono text-ink-soft">{r.host}:{r.port}</span>
                {#if r.ok}
                  <span class="text-ink-soft">({r.ms}ms)</span>
                {:else}
                  <span class="text-status-error">{r.error}</span>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/if}

      <div class="rounded-card bg-card border border-hairline shadow-sm px-5 divide-y divide-hairline">
        {#each current!.schema.root as section (section.key)}
          {#if section.isArray}
            <ArrayField {section} rows={draft![section.key] ?? []}
              onchange={(rows) => setSection(section.key, rows)} />
          {:else}
            <div class="py-3">
              <h3 class="font-medium mb-1">{section.label}</h3>
              {#each section.fields as f (f.key)}
                <FieldRenderer field={f} value={draft![section.key]?.[f.key]}
                  onchange={(v) => setField(section.key, f.key, v)} />
              {/each}
            </div>
          {/if}
        {/each}
      </div>

      {#if showRaw}
        <div class="bg-log rounded-card overflow-hidden border border-black/20">
          <div class="px-4 h-10 flex items-center text-logink/90 text-sm border-b border-white/10">
            Pending TOML — not written until you Save
          </div>
          <pre class="mono p-4 overflow-x-auto text-[13px] text-logink">{rawPreview}</pre>
        </div>
      {/if}
    {/if}
  </div>
  <Toast toast={toast} ondismiss={() => (toast = null)} />
</AppShell>
