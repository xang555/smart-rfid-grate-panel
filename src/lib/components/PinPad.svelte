<script lang="ts">
  let {
    label = 'PIN',
    autocomplete = 'current-password',
    minlength = 6,
    maxlength = 12,
    value = $bindable(''),
    disabled = false
  }: {
    label?: string;
    autocomplete?: string;
    minlength?: number;
    maxlength?: number;
    value?: string;
    disabled?: boolean;
  } = $props();
</script>

<label class="block">
  <span class="block text-sm font-medium text-ink mb-1">{label}</span>
  <input
    type="password"
    inputmode="numeric"
    pattern="[0-9]*"
    {minlength}
    {maxlength}
    {disabled}
    autocomplete={autocomplete}
    bind:value
    class="mono w-full rounded-md border border-hairline bg-white px-3 py-2 text-lg tracking-[0.4em]
           focus:outline-none focus:ring-2 focus:ring-accent"
  />
</label>
