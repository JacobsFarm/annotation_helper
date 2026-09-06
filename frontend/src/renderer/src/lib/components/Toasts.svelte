<script lang="ts">
  import { t } from '../i18n/index.svelte'
  import { dismissToast, toasts } from '../state/toast.svelte'
  import Icon from './Icon.svelte'
</script>

<div class="toasts" role="status" aria-live="polite">
  {#each toasts() as toast (toast.id)}
    <div class="toast {toast.kind}">
      <div class="text">
        <span class="message">{toast.message}</span>
        {#if toast.detail}<span class="detail mono">{toast.detail}</span>{/if}
      </div>
      <button
        class="dismiss"
        title={t('common_close')}
        aria-label={t('common_close')}
        onclick={() => dismissToast(toast.id)}
      >
        <Icon name="close" size={14} />
      </button>
    </div>
  {/each}
</div>

<style>
  .toasts {
    position: fixed;
    right: var(--space-4);
    bottom: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    z-index: 100;
    max-width: min(420px, calc(100vw - 2rem));
  }

  .toast {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-left: 3px solid var(--teal);
    border-radius: var(--radius);
    background: var(--bg-raised);
    box-shadow: var(--shadow);
  }

  .toast.error {
    border-left-color: var(--danger);
  }

  .toast.success {
    border-left-color: var(--brand);
  }

  .text {
    display: grid;
    gap: 2px;
    min-width: 0;
  }

  .message {
    font-size: var(--text-sm);
  }

  .detail {
    color: var(--text-muted);
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
    max-height: 6em;
    overflow: hidden;
  }

  .dismiss {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 2px;
    border-radius: var(--radius-sm);
  }

  .dismiss:hover {
    color: var(--text);
    background: var(--bg-sunken);
  }
</style>
