<script lang="ts">
  import type { PageData } from './$types';
  import AppShell from '$lib/components/AppShell.svelte';
  import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';

  let { data }: { data: PageData } = $props();

  type StepState = 'idle' | 'start' | 'ok' | 'fail';
  const STEPS = [
    { key: 'update', label: 'Update system packages' },
    { key: 'docker', label: 'Install Docker' },
    { key: 'download', label: 'Download the project' },
    { key: 'extract', label: 'Extract the archive' },
    { key: 'syncthing', label: 'Install Syncthing' },
    { key: 'login', label: 'Docker login' }
  ] as const;

  // snapshot the server load once; a re-run refreshes via the streamed result
  // svelte-ignore state_referenced_locally
  let dockerUser = $state(data.savedDockerUser);
  let dockerPassword = $state('');
  // where the installer fetches the project archive from
  // svelte-ignore state_referenced_locally
  let zipUrl = $state(data.savedZipUrl);
  // svelte-ignore state_referenced_locally
  let projectPath = $state(data.projectPath);
  let steps = $state<Record<string, StepState>>(
    Object.fromEntries(STEPS.map((s) => [s.key, 'idle']))
  );
  let lines = $state<string[]>([]);
  let running = $state(false);
  let resultMsg = $state('');
  let confirmRerun = $state(false);

  const mark = (key: string, state: StepState) => (steps = { ...steps, [key]: state });

  async function run() {
    if (!dockerUser || !dockerPassword) { resultMsg = 'Docker username and password are required.'; return; }
    if (!zipUrl) { resultMsg = 'A download URL for the project archive is required.'; return; }
    running = true; resultMsg = ''; lines = [];
    steps = Object.fromEntries(STEPS.map((s) => [s.key, 'idle']));

    try {
      const res = await fetch('/api/setup/run', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dockerUser, dockerPassword, zipUrl, projectPath })
      });
      if (!res.ok) {
        // the endpoint refuses a bad URL before it ever spawns the script
        const body = await res.json().catch(() => ({}));
        resultMsg = body.message ?? 'Setup could not start.';
        return;
      }
      if (!res.body) { resultMsg = 'Setup could not start.'; return; }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const chunk = buf.slice(0, idx); buf = buf.slice(idx + 2);
          const payload = chunk.replace(/^data: /, '');
          if (!payload) continue;
          const msg = JSON.parse(payload);
          if (msg.type === 'line') lines = [...lines, msg.line].slice(-400);
          else if (msg.type === 'step') mark(msg.step, msg.status);
          else if (msg.type === 'result') {
            resultMsg = msg.result.ok ? 'Setup complete.' : `Setup failed: ${msg.result.message}`;
          }
        }
      }
    } finally {
      running = false;
      dockerPassword = '';
    }
  }
</script>

<AppShell title="Setup" active="setup">
  <div class="p-6 max-w-4xl mx-auto space-y-5">
    {#if data.installed}
      <div class="rounded-card bg-card border border-hairline shadow-sm p-5">
        <h1 class="font-semibold text-lg">Project installed</h1>
        <p class="text-sm text-ink-soft mt-1">Found a complete project at
          <span class="mono">{data.projectPath}</span>.</p>
        <button type="button" onclick={() => (confirmRerun = true)}
          class="mt-4 px-4 py-2 rounded-md border border-hairline text-sm">Re-run setup</button>
      </div>
    {/if}

    <form class="rounded-card bg-card border border-hairline shadow-sm p-5 space-y-4"
          onsubmit={(e) => { e.preventDefault(); run(); }}>
      <h1 class="font-semibold text-lg">{data.installed ? 'Re-run the installer' : 'Install the gate project'}</h1>
      <div class="grid sm:grid-cols-2 gap-4">
        <label class="block">
          <span class="block text-sm font-medium mb-1">Docker username</span>
          <input bind:value={dockerUser} autocomplete="username"
            class="w-full rounded-md border border-hairline px-3 py-2" />
        </label>
        <label class="block">
          <span class="block text-sm font-medium mb-1">Docker password</span>
          <input type="password" bind:value={dockerPassword} autocomplete="current-password"
            class="w-full rounded-md border border-hairline px-3 py-2" />
          <span class="text-xs text-ink-soft">Sent to the installer as an environment variable, never shown in the log.</span>
        </label>
      </div>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Download URL</span>
        <input bind:value={zipUrl} type="url" inputmode="url" placeholder="https://example.com/releases/asian-pj.zip"
          class="mono w-full rounded-md border border-hairline px-3 py-2" />
        <span class="text-xs text-ink-soft">
          Link to the project .zip the installer downloads and extracts. Must be http or https.
        </span>
      </label>
      <label class="block">
        <span class="block text-sm font-medium mb-1">Install path</span>
        <input bind:value={projectPath} class="mono w-full rounded-md border border-hairline px-3 py-2" />
      </label>
      <button type="submit" disabled={running}
        class="px-5 py-2.5 rounded-md bg-accent text-white font-medium disabled:opacity-50">
        {running ? 'Running…' : 'Run setup'}
      </button>
      {#if resultMsg}<p class="text-sm {resultMsg.startsWith('Setup failed') ? 'text-status-error' : 'text-status-ok'}">{resultMsg}</p>{/if}
    </form>

    <div class="rounded-card bg-card border border-hairline shadow-sm p-5">
      <h2 class="font-semibold mb-3">Steps</h2>
      <ul class="space-y-1.5 text-sm">
        {#each STEPS as s (s.key)}
          <li class="flex items-center gap-2">
            <span class="w-5 text-center">
              {steps[s.key] === 'ok' ? '✓' : steps[s.key] === 'fail' ? '✕' : steps[s.key] === 'start' ? '•' : '○'}
            </span>
            <span class={steps[s.key] === 'fail' ? 'text-status-error' : steps[s.key] === 'ok' ? '' : 'text-ink-soft'}>{s.label}</span>
          </li>
        {/each}
      </ul>
    </div>

    <div class="bg-log rounded-card overflow-hidden border border-black/20">
      <div class="px-4 h-10 flex items-center text-logink/90 text-sm border-b border-white/10">Install log</div>
      <div class="mono p-4 h-72 overflow-y-auto text-[13px] text-logink space-y-0.5">
        {#each lines as l}<div class="break-words">{l}</div>
        {:else}<p class="text-logink/50">No output yet.</p>{/each}
      </div>
    </div>
  </div>

  <ConfirmDialog
    open={confirmRerun}
    title="Re-run the installer?"
    body="This downloads and extracts the project again over the existing copy. Config files at the install path may be overwritten. A backup is not made for files the installer replaces."
    confirmLabel="Re-run setup"
    onconfirm={() => { confirmRerun = false; run(); }}
    oncancel={() => (confirmRerun = false)}
  />
</AppShell>
