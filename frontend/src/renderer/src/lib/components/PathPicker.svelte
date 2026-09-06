<script lang="ts">
  import { api, safeCall } from '../api'
  import { t } from '../i18n/index.svelte'
  import Button from './Button.svelte'

  interface Props {
    value: string
    placeholder?: string
    /** Pick a file with these filters, or a directory when omitted. */
    filters?: { name: string; extensions: string[] }[]
    onchange: (value: string) => void
  }

  const { value, placeholder = '', filters, onchange }: Props = $props()

  async function browse(): Promise<void> {
    const picked = filters
      ? await safeCall(() => api.dialog.chooseFile(filters))
      : await safeCall(() => api.dialog.chooseDirectory())
    if (picked) onchange(picked)
  }
</script>

<div class="picker">
  <input
    type="text"
    {value}
    {placeholder}
    spellcheck="false"
    oninput={(event) => onchange(event.currentTarget.value)}
  />
  <Button size="sm" icon="folder" onclick={browse}>{t('common_browse')}</Button>
</div>

<style>
  .picker {
    display: flex;
    gap: var(--space-2);
    align-items: center;
  }

  input {
    flex: 1;
    min-width: 0;
    font-family: var(--font-mono);
    font-size: var(--text-sm);
  }
</style>
