<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    label: string
    hint?: string
    /** Put the control on the same row as the label. Good for switches. */
    inline?: boolean
    children: Snippet
  }

  const { label, hint, inline = false, children }: Props = $props()
</script>

<label class="field" class:inline>
  <span class="label">{label}</span>
  <div class="control">{@render children()}</div>
  {#if hint}<span class="hint">{hint}</span>{/if}
</label>

<style>
  .field {
    display: grid;
    gap: var(--space-1);
    margin-bottom: var(--space-3);
  }

  .field.inline {
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: var(--space-3);
  }

  .field.inline .hint {
    grid-column: 1 / -1;
  }

  .label {
    font-size: var(--text-sm);
    font-weight: 600;
    color: var(--text);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-muted);
    line-height: 1.4;
  }

  .control :global(input),
  .control :global(select) {
    width: 100%;
    height: 32px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
    color: var(--text);
  }

  .control :global(input[type='color']) {
    padding: 2px;
    cursor: pointer;
  }

  .control :global(input[type='checkbox']) {
    width: auto;
    height: auto;
    accent-color: var(--brand);
  }

  .control :global(input:focus),
  .control :global(select:focus) {
    border-color: var(--focus);
    outline: none;
  }

  .control :global(input[type='range']) {
    accent-color: var(--brand);
  }
</style>
