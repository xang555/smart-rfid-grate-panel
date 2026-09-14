<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '$lib/components/AppShell.svelte';
  import FieldRenderer from '$lib/components/FieldRenderer.svelte';
  import ArrayField from '$lib/components/ArrayField.svelte';
  import { renderToml } from '$lib/toml-render';

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
  let errors = $state<{ path: string; message: string }[]>([]);
  let showRaw = $state(false);

  const current = $derived(data.files.find((f) => f.key === active)!);
  const draft = $derived(drafts[active]);

  function setSection(sectionKey: string, v: unknown) {
    drafts[active] = { ...drafts[active], [sectionKey]: v };
  }
  function setField(sectionKey: string, fieldKey: string, v: unknown) {
    setSection(sectionKey, { ...drafts[active][sectionKey], [fieldKey]: v });
  }
  function revert() {
    drafts[active] = structuredClone(current.value);
    errors = [];
    message = '';
  }
  function switchTab(key: string) {
    active = key;
    message = '';
    errors = [];
  }

  const rawPreview = $derived.by(() => {
    // Same renderer the server writes with, so the preview cannot drift from
    // the file — and the flat section's '' key never reaches TOML as a name.
    try { return renderToml(current.schema, draft); } catch { return '# invalid value'; }
  });

  async function save() {
    saving = true; message = ''; errors = [];
    try {
      const res = await fetch(`/api/config/${active}`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ value: draft })
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) { message = 'Saved.'; }
      else if (body.errors) { errors = body.errors; message = 'Fix the highlighted fields.'; }
      else { message = body.message ?? 'Save failed.'; }
    } finally {
      saving = false;
    }
  }
</script>

<AppShell title="Settings" active="settings">
  <div class="p-6 max-w-5xl mx-auto space-y-4">
    <div class="flex items-center gap-1 border-b border-hairline">
      {#each data.files as f (f.key)}
        <button type="button" onclick={() => switchTab(f.key)}
          class="px-4 py-2 text-sm rounded-t-md -mb-px border-b-2
                 {active === f.key ? 'border-accent font-medium' : 'border-transparent text-ink-soft hover:text-ink'}">
          {f.schema.label}
        </button>
      {/each}
      <div class="ml-auto flex items-center gap-2 pb-1">
        <button type="button" onclick={() => (showRaw = !showRaw)}
          class="px-3 py-1.5 text-sm rounded-md border border-hairline">{showRaw ? 'Hide' : 'Show'} raw TOML</button>
        <button type="button" onclick={revert}
          class="px-3 py-1.5 text-sm rounded-md border border-hairline">Revert</button>
        <button type="button" onclick={save} disabled={saving}
          class="px-4 py-1.5 text-sm rounded-md bg-accent text-white font-medium disabled:opacity-50">Save</button>
      </div>
    </div>

    {#if !current.exists}
      <div class="rounded-card border border-status-warn/40 bg-status-warn/10 p-4 text-sm">
        <span class="mono">{data.projectPath}/{current.schema.relPath}</span> does not exist yet. Run setup first.
      </div>
    {/if}

    {#if message}
      <p class="text-sm {errors.length || message.startsWith('Save failed') ? 'text-status-error' : 'text-status-ok'}">{message}</p>
    {/if}
    {#if errors.length}
      <ul class="text-sm text-status-error list-disc pl-5">
        {#each errors as e (e.path)}<li><span class="mono">{e.path}</span> — {e.message}</li>{/each}
      </ul>
    {/if}

    <div class="rounded-card bg-card border border-hairline shadow-sm px-5 divide-y divide-hairline">
      {#each current.schema.root as section (section.key)}
        {#if section.isArray}
          <ArrayField {section} rows={draft[section.key] ?? []}
            onchange={(rows) => setSection(section.key, rows)} />
        {:else}
          <div class="py-3">
            <h3 class="font-medium mb-1">{section.label}</h3>
            {#each section.fields as f (f.key)}
              <FieldRenderer field={f} value={draft[section.key]?.[f.key]}
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
  </div>
</AppShell>
