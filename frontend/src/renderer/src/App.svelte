<script lang="ts">
  /**
   * The shell: a rail, a screen, and the one place main-process events are wired in.
   */
  import { onMount } from 'svelte'
  import { api } from './lib/api'
  import Icon, { type IconName } from './lib/components/Icon.svelte'
  import Toasts from './lib/components/Toasts.svelte'
  import { t, type MessageKey } from './lib/i18n/index.svelte'
  import { setPredictProgress, setPythonStatus } from './lib/state/ai.svelte'
  import { activeView, goToView, type ViewId } from './lib/state/nav.svelte'
  import { isOpen, project } from './lib/state/project.svelte'
  import { loadSettings } from './lib/state/settings.svelte'
  import { appendTrainLine, finishRun } from './lib/state/training.svelte'
  import Annotate from './views/Annotate.svelte'
  import Dataset from './views/Dataset.svelte'
  import Settings from './views/Settings.svelte'
  import Train from './views/Train.svelte'
  import Welcome from './views/Welcome.svelte'

  const NAV: { id: ViewId; icon: IconName; label: MessageKey }[] = [
    { id: 'annotate', icon: 'box', label: 'nav_annotate' },
    { id: 'dataset', icon: 'dataset', label: 'nav_dataset' },
    { id: 'train', icon: 'train', label: 'nav_train' },
    { id: 'settings', icon: 'settings', label: 'nav_settings' }
  ]

  onMount(() => {
    void loadSettings()

    // One subscription for every main-process event, dispatched to the store that owns it.
    return api.on((event) => {
      switch (event.type) {
        case 'python:status':
          setPythonStatus(event.status)
          break
        case 'predict:progress':
          setPredictProgress(event.stage, event.pct)
          break
        case 'train:output':
          appendTrainLine(event.line, event.epoch, event.epochs)
          break
        case 'train:done':
          finishRun(event.exitCode)
          break
      }
    })
  })
</script>

{#if !isOpen()}
  <Welcome />
{:else}
  <div class="shell">
    <nav class="rail" aria-label={t('common_app_name')}>
      <div class="brand" title={project()?.root}>
        <span class="mark">AH</span>
        <span class="name">{project()?.name}</span>
      </div>
      {#each NAV as item (item.id)}
        <button
          class="tab"
          class:active={activeView() === item.id}
          title={t(item.label)}
          aria-current={activeView() === item.id ? 'page' : undefined}
          onclick={() => goToView(item.id)}
        >
          <Icon name={item.icon} size={20} />
          <span>{t(item.label)}</span>
        </button>
      {/each}
    </nav>

    <main>
      {#if activeView() === 'annotate'}
        <Annotate />
      {:else if activeView() === 'dataset'}
        <Dataset />
      {:else if activeView() === 'train'}
        <Train />
      {:else}
        <Settings />
      {/if}
    </main>
  </div>
{/if}

<Toasts />

<style>
  .shell {
    display: grid;
    grid-template-columns: var(--rail-width) 1fr;
    height: 100%;
  }

  main {
    min-width: 0;
    overflow: hidden;
  }

  .rail {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    padding: var(--space-2);
    background: var(--bg-sunken);
    border-right: 1px solid var(--border);
  }

  .brand {
    display: grid;
    justify-items: center;
    gap: 2px;
    padding: var(--space-2) 0 var(--space-4);
  }

  .mark {
    font-family: var(--font-display);
    font-size: var(--text-xl);
    color: var(--brand);
    letter-spacing: 0.06em;
  }

  .name {
    font-size: 9px;
    color: var(--text-muted);
    text-align: center;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tab {
    display: grid;
    justify-items: center;
    gap: 3px;
    padding: var(--space-2) 0;
    border: none;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 10px;
  }

  .tab:hover {
    background: var(--bg-raised);
    color: var(--text);
  }

  .tab.active {
    background: var(--brand-soft);
    color: var(--brand);
  }

  /* A desktop app still gets resized to half a screen: below 860px the rail becomes a
     horizontal strip along the top. */
  @media (max-width: 860px) {
    .shell {
      grid-template-columns: 1fr;
      grid-template-rows: auto 1fr;
    }

    .rail {
      flex-direction: row;
      align-items: center;
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .brand {
      padding: 0 var(--space-3) 0 var(--space-2);
    }

    .tab {
      grid-auto-flow: column;
      align-items: center;
      padding: var(--space-2) var(--space-3);
      font-size: var(--text-sm);
    }
  }
</style>
