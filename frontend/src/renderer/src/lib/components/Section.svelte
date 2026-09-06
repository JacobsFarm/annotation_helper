<script lang="ts">
  import type { Snippet } from 'svelte'

  interface Props {
    title: string
    /** Right-hand slot for the section's own actions. */
    actions?: Snippet
    children: Snippet
  }

  const { title, actions, children }: Props = $props()
</script>

<section class="section">
  <header>
    <h3>{title}</h3>
    {#if actions}<div class="actions">{@render actions()}</div>{/if}
  </header>
  <div class="body">{@render children()}</div>
</section>

<style>
  .section {
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    margin-bottom: var(--space-4);
    overflow: hidden;
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--border);
    background: var(--bg-sunken);
  }

  .actions {
    display: flex;
    gap: var(--space-2);
  }

  .body {
    padding: var(--space-4);
  }
</style>
