<script lang="ts">
  import { onMount } from 'svelte'
  import type { RecentProject } from '@shared/ipc'
  import type { ProjectFile } from '@shared/project'
  import { api, safeCall } from '../lib/api'
  import Button from '../lib/components/Button.svelte'
  import Field from '../lib/components/Field.svelte'
  import Icon from '../lib/components/Icon.svelte'
  import { t } from '../lib/i18n/index.svelte'
  import { createProject, openProject } from '../lib/state/project.svelte'

  let recent = $state<RecentProject[]>([])
  let creating = $state(false)
  let folder = $state('')
  let name = $state('')
  let task = $state<ProjectFile['task']>('detect')

  onMount(async () => {
    recent = (await safeCall(() => api.project.recent())) ?? []
  })

  async function chooseExisting(): Promise<void> {
    const picked = await safeCall(() => api.dialog.chooseDirectory(t('welcome_open')))
    if (picked) await openProject(picked)
  }

  async function chooseNewFolder(): Promise<void> {
    const picked = await safeCall(() => api.dialog.chooseDirectory(t('welcome_new')))
    if (!picked) return
    folder = picked
    if (!name) name = picked.split(/[\\/]/).pop() ?? ''
    creating = true
  }

  async function confirmCreate(): Promise<void> {
    if (!folder) return
    await createProject({ root: folder, name: name || folder, task })
  }
</script>

<div class="welcome">
  <header>
    <span class="mark">AH</span>
    <h1>{t('welcome_title')}</h1>
    <p class="muted">{t('welcome_subtitle')}</p>
  </header>

  {#if creating}
    <div class="card">
      <Field label={t('welcome_folder_label')}>
        <input type="text" value={folder} readonly />
      </Field>
      <Field label={t('welcome_name_label')}>
        <input type="text" bind:value={name} />
      </Field>
      <Field label={t('welcome_task_label')}>
        <select bind:value={task}>
          <option value="detect">{t('welcome_task_detect')}</option>
          <option value="segment">{t('welcome_task_segment')}</option>
          <option value="both">{t('welcome_task_both')}</option>
        </select>
      </Field>
      <div class="row">
        <Button onclick={() => (creating = false)}>{t('common_cancel')}</Button>
        <div class="spacer"></div>
        <Button variant="cta" icon="check" onclick={confirmCreate}>{t('welcome_create')}</Button>
      </div>
    </div>
  {:else}
    <div class="choices">
      <button class="choice" onclick={chooseNewFolder}>
        <Icon name="plus" size={22} />
        <strong>{t('welcome_new')}</strong>
        <span class="muted">{t('welcome_new_hint')}</span>
      </button>
      <button class="choice" onclick={chooseExisting}>
        <Icon name="folder" size={22} />
        <strong>{t('welcome_open')}</strong>
        <span class="muted">{t('welcome_open_hint')}</span>
      </button>
    </div>

    <div class="recent">
      <h3>{t('welcome_recent')}</h3>
      {#if recent.length === 0}
        <p class="muted">{t('welcome_recent_empty')}</p>
      {:else}
        <ul>
          {#each recent as item (item.root)}
            <li>
              <button onclick={() => openProject(item.root)}>
                <strong>{item.name}</strong>
                <span class="mono muted">{item.root}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</div>

<style>
  .welcome {
    height: 100%;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: var(--space-6) var(--space-4);
    gap: var(--space-5);
  }

  header {
    text-align: center;
    display: grid;
    gap: var(--space-2);
    justify-items: center;
  }

  .mark {
    font-family: var(--font-display);
    font-size: 2.5rem;
    color: var(--brand);
    letter-spacing: 0.08em;
  }

  header p {
    margin: 0;
    max-width: 46ch;
  }

  .choices {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-3);
    width: min(720px, 100%);
  }

  .choice {
    display: grid;
    justify-items: start;
    gap: var(--space-2);
    padding: var(--space-4);
    text-align: left;
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-raised);
    color: var(--text);
    cursor: pointer;
    transition: border-color 120ms ease;
  }

  .choice:hover {
    border-color: var(--brand);
  }

  .card {
    width: min(520px, 100%);
    padding: var(--space-4);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--bg-raised);
  }

  .recent {
    width: min(720px, 100%);
  }

  .recent ul {
    list-style: none;
    margin: var(--space-2) 0 0;
    padding: 0;
    display: grid;
    gap: var(--space-1);
  }

  .recent button {
    width: 100%;
    display: grid;
    gap: 2px;
    text-align: left;
    padding: var(--space-2) var(--space-3);
    border: 1px solid transparent;
    border-radius: var(--radius);
    background: transparent;
    color: var(--text);
    cursor: pointer;
  }

  .recent button:hover {
    background: var(--bg-raised);
    border-color: var(--border);
  }

  .recent span {
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
  }
</style>
