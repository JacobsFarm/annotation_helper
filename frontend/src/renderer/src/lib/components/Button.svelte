<script lang="ts">
  import type { Snippet } from 'svelte'
  import Icon, { type IconName } from './Icon.svelte'

  interface Props {
    /** `cta` is the single highest-visibility action on a screen. Use it once. */
    variant?: 'default' | 'primary' | 'cta' | 'ghost' | 'danger'
    size?: 'sm' | 'md'
    icon?: IconName
    disabled?: boolean
    title?: string
    active?: boolean
    type?: 'button' | 'submit'
    onclick?: (event: MouseEvent) => void
    children?: Snippet
  }

  const {
    variant = 'default',
    size = 'md',
    icon,
    disabled = false,
    title,
    active = false,
    type = 'button',
    onclick,
    children
  }: Props = $props()
</script>

<button
  {type}
  {title}
  {disabled}
  {onclick}
  class="btn {variant} {size}"
  class:active
  class:icon-only={icon !== undefined && children === undefined}
  aria-pressed={active ? 'true' : undefined}
>
  {#if icon}<Icon name={icon} size={size === 'sm' ? 15 : 17} />{/if}
  {#if children}<span>{@render children()}</span>{/if}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--space-2);
    padding: 0 var(--space-3);
    height: 34px;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    white-space: nowrap;
    transition:
      background 120ms ease,
      border-color 120ms ease,
      color 120ms ease;
  }

  .btn.sm {
    height: 28px;
    padding: 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .btn.icon-only {
    width: 34px;
    padding: 0;
  }

  .btn.sm.icon-only {
    width: 28px;
  }

  .btn:hover:not(:disabled) {
    border-color: var(--border-strong);
    background: var(--bg-sunken);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn.active {
    background: var(--brand-soft);
    border-color: var(--brand);
    color: var(--brand);
  }

  .btn.primary {
    background: var(--brand);
    border-color: var(--brand);
    color: var(--text-inverse);
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--brand-hover);
    border-color: var(--brand-hover);
  }

  .btn.cta {
    background: var(--amber);
    border-color: var(--amber);
    color: var(--ink);
    font-weight: 600;
  }

  .btn.cta:hover:not(:disabled) {
    background: var(--amber-strong);
    border-color: var(--amber-strong);
  }

  .btn.ghost {
    background: transparent;
    border-color: transparent;
  }

  .btn.ghost:hover:not(:disabled) {
    background: var(--bg-sunken);
    border-color: var(--border);
  }

  .btn.danger {
    color: var(--danger);
    border-color: var(--border);
  }

  .btn.danger:hover:not(:disabled) {
    background: var(--danger);
    border-color: var(--danger);
    color: var(--white);
  }
</style>
