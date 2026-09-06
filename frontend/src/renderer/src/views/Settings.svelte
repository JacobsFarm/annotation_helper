<script lang="ts">
  /**
   * Settings: appearance, project, classes, prediction, Python.
   *
   * Two kinds of setting live on this screen and they are stored in different places.
   * Appearance and the interpreter path describe this machine and go to `userData`;
   * everything else describes the data and goes into the project folder, so it travels
   * with it.
   */
  import { onMount } from 'svelte'
  import type { AppSettings, Compute, RecycleStatus } from '@shared/ipc'
  import type { AiSettings } from '@shared/project'
  import { api, safeCall } from '../lib/api'
  import Button from '../lib/components/Button.svelte'
  import Field from '../lib/components/Field.svelte'
  import Icon from '../lib/components/Icon.svelte'
  import PathPicker from '../lib/components/PathPicker.svelte'
  import Section from '../lib/components/Section.svelte'
  import { LOCALES, t, type Locale } from '../lib/i18n/index.svelte'
  import {
    cancelInstall,
    installLog,
    isInstalling,
    packageStatus,
    pythonStatus,
    refreshPackages,
    restartEngine,
    startInstall
  } from '../lib/state/ai.svelte'
  import {
    addClass,
    classes,
    patchProject,
    project,
    removeClass,
    updateClass
  } from '../lib/state/project.svelte'
  import { settings, updateSettings } from '../lib/state/settings.svelte'
  import { pushToast } from '../lib/state/toast.svelte'

  const SHORTCUTS: { keys: string; label: 'shortcut_next' | 'shortcut_previous' | 'shortcut_save' | 'shortcut_delete' | 'shortcut_tool_select' | 'shortcut_tool_box' | 'shortcut_tool_polygon' | 'shortcut_fit' | 'shortcut_background' | 'shortcut_predict' | 'shortcut_undo' | 'shortcut_class' }[] = [
    { keys: '→ / PageDown', label: 'shortcut_next' },
    { keys: '← / PageUp', label: 'shortcut_previous' },
    { keys: 'Ctrl+S', label: 'shortcut_save' },
    { keys: 'Del', label: 'shortcut_delete' },
    { keys: 'V', label: 'shortcut_tool_select' },
    { keys: 'B', label: 'shortcut_tool_box' },
    { keys: 'P', label: 'shortcut_tool_polygon' },
    { keys: 'F', label: 'shortcut_fit' },
    { keys: 'N', label: 'shortcut_background' },
    { keys: 'E', label: 'shortcut_predict' },
    { keys: 'Ctrl+Z', label: 'shortcut_undo' },
    { keys: '1-9', label: 'shortcut_class' }
  ]

  let newClassName = $state('')
  let compute = $state<Compute>('auto')
  let logBox = $state<HTMLPreElement | null>(null)
  let recycle = $state<RecycleStatus | null>(null)
  let emptying = $state(false)

  const open = $derived(project())
  const status = $derived(pythonStatus())
  const app = $derived(settings())
  const packages = $derived(packageStatus())
  const installing = $derived(isInstalling())
  const log = $derived(installLog())

  onMount(() => {
    void refreshPackages()
    void refreshRecycle()
  })

  async function refreshRecycle(): Promise<void> {
    if (!open) return
    recycle = await safeCall(() => api.files.recycle(open.root))
  }

  /** kB / MB / GB, so "how much would emptying free" is answerable at a glance. */
  function humanSize(bytes: number): string {
    const units = ['B', 'kB', 'MB', 'GB']
    let value = bytes
    let unit = 0
    while (value >= 1024 && unit < units.length - 1) {
      value /= 1024
      unit++
    }
    return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`
  }

  /**
   * The one destructive action in the application, so it asks first and says exactly
   * how many files it is about to take. Everything else here is reversible.
   */
  async function empty(): Promise<void> {
    if (!open || !recycle || recycle.files === 0) return
    if (!window.confirm(t('settings_recycle_confirm', { files: recycle.files }))) return
    emptying = true
    const result = await safeCall(() => api.files.emptyRecycle(open.root))
    emptying = false
    if (result) pushToast('success', t('settings_recycle_emptied', { files: result.removed }))
    await refreshRecycle()
  }

  // Follow the tail while uv talks. Reading `log` is what subscribes this effect.
  $effect(() => {
    const box = logBox
    if (box && log.length) box.scrollTop = box.scrollHeight
  })

  async function patchAi(patch: Partial<AiSettings>): Promise<void> {
    if (!open) return
    await patchProject({ ai: { ...open.ai, ...patch } })
  }

  async function submitClass(): Promise<void> {
    const name = newClassName.trim()
    if (!name) return
    if (await addClass(name)) newClassName = ''
  }

  async function deleteClass(id: number): Promise<void> {
    if (!(await removeClass(id))) pushToast('info', t('settings_class_delete_last'))
  }
</script>

<div class="page scroll">
  <header><h1>{t('settings_title')}</h1></header>

  <Section title={t('settings_appearance')}>
    <div class="grid">
      <Field label={t('settings_language')}>
        <select
          value={app.locale}
          onchange={(event) => updateSettings({ locale: event.currentTarget.value as Locale })}
        >
          {#each LOCALES as item (item.id)}
            <option value={item.id}>{item.label}</option>
          {/each}
        </select>
      </Field>
      <Field label={t('settings_theme')}>
        <select
          value={app.theme}
          onchange={(event) =>
            updateSettings({ theme: event.currentTarget.value as AppSettings['theme'] })}
        >
          <option value="system">{t('settings_theme_system')}</option>
          <option value="light">{t('settings_theme_light')}</option>
          <option value="dark">{t('settings_theme_dark')}</option>
        </select>
      </Field>
    </div>
    <Field label={t('settings_autosave')} inline>
      <input
        type="checkbox"
        checked={app.autosave}
        onchange={(event) => updateSettings({ autosave: event.currentTarget.checked })}
      />
    </Field>
  </Section>

  <Section title={t('settings_project')}>
    <div class="grid">
      <Field label={t('settings_project_name')}>
        <input
          type="text"
          value={open?.name ?? ''}
          onchange={(event) => patchProject({ name: event.currentTarget.value })}
        />
      </Field>
      <Field label={t('settings_task')}>
        <select
          value={open?.task ?? 'detect'}
          onchange={(event) =>
            patchProject({ task: event.currentTarget.value as 'detect' | 'segment' | 'both' })}
        >
          <option value="detect">{t('welcome_task_detect')}</option>
          <option value="segment">{t('welcome_task_segment')}</option>
          <option value="both">{t('welcome_task_both')}</option>
        </select>
      </Field>
    </div>
    <p class="mono muted path">{open?.root}</p>
    <Button size="sm" icon="folder" onclick={() => open && safeCall(() => api.app.openPath(open.root))}>
      {t('common_open_folder')}
    </Button>
  </Section>

  <Section title={t('settings_recycle')}>
    {#snippet actions()}
      <Button size="sm" variant="ghost" icon="refresh" title={t('common_refresh')} onclick={refreshRecycle} />
    {/snippet}

    <p class="muted">{t('settings_recycle_hint')}</p>
    {#if recycle}
      <p>
        {recycle.files === 0
          ? t('settings_recycle_empty')
          : t('settings_recycle_count', { files: recycle.files, size: humanSize(recycle.bytes) })}
      </p>
      <p class="mono muted path">{recycle.path}</p>
      <div class="row">
        <Button size="sm" icon="folder" onclick={() => safeCall(() => api.app.openPath(recycle!.path))}>
          {t('common_open_folder')}
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon="trash"
          disabled={recycle.files === 0 || emptying}
          onclick={empty}
        >
          {emptying ? t('settings_recycle_emptying') : t('settings_recycle_empty_action')}
        </Button>
      </div>
    {/if}
  </Section>

  <Section title={t('settings_classes')}>
    <ul class="classes">
      {#each classes() as item (item.id)}
        <li>
          <span class="id mono">{item.id}</span>
          <input
            class="name"
            type="text"
            value={item.name}
            aria-label={t('settings_class_name')}
            onchange={(event) => updateClass(item.id, { name: event.currentTarget.value })}
          />
          <input
            class="colour"
            type="color"
            value={item.color}
            aria-label={t('settings_class_colour')}
            onchange={(event) => updateClass(item.id, { color: event.currentTarget.value })}
          />
          <button
            class="remove"
            title={t('common_delete')}
            aria-label={t('common_delete')}
            onclick={() => deleteClass(item.id)}
          >
            <Icon name="close" size={14} />
          </button>
        </li>
      {/each}
    </ul>
    <div class="add">
      <input
        type="text"
        bind:value={newClassName}
        placeholder={t('settings_class_name')}
        onkeydown={(event) => event.key === 'Enter' && submitClass()}
      />
      <Button size="sm" icon="plus" onclick={submitClass}>{t('settings_class_add')}</Button>
    </div>
  </Section>

  <Section title={t('settings_ai')}>
    <Field label={t('settings_pipeline')} hint={t('settings_pipeline_hint')}>
      <select
        value={open?.ai.pipeline ?? 'detect'}
        onchange={(event) => patchAi({ pipeline: event.currentTarget.value as AiSettings['pipeline'] })}
      >
        <option value="detect">{t('settings_pipeline_detect')}</option>
        <option value="segment">{t('settings_pipeline_segment')}</option>
        <option value="detect_then_segment">{t('settings_pipeline_dual')}</option>
      </select>
    </Field>

    <Field label={t('settings_detect_model')}>
      <PathPicker
        value={open?.ai.detectModel ?? ''}
        filters={[{ name: 'PyTorch', extensions: ['pt'] }]}
        onchange={(value) => patchAi({ detectModel: value })}
      />
    </Field>
    <Field label={t('settings_segment_model')}>
      <PathPicker
        value={open?.ai.segmentModel ?? ''}
        filters={[{ name: 'PyTorch', extensions: ['pt'] }]}
        onchange={(value) => patchAi({ segmentModel: value })}
      />
    </Field>

    <div class="grid">
      <Field label={t('settings_confidence')}>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={open?.ai.confidence ?? 0.25}
          onchange={(event) => patchAi({ confidence: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('settings_iou')}>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={open?.ai.iou ?? 0.45}
          onchange={(event) => patchAi({ iou: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('settings_max_detections')}>
        <input
          type="number"
          min="1"
          value={open?.ai.maxDetections ?? 300}
          onchange={(event) => patchAi({ maxDetections: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('settings_expand_ratio')}>
        <input
          type="number"
          step="0.05"
          min="0"
          value={open?.ai.expandRatio ?? 0.1}
          onchange={(event) => patchAi({ expandRatio: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('settings_simplify')} hint={t('settings_simplify_hint')}>
        <input
          type="number"
          step="0.5"
          min="0"
          value={open?.ai.simplifyTolerance ?? 1.5}
          onchange={(event) => patchAi({ simplifyTolerance: Number(event.currentTarget.value) })}
        />
      </Field>
    </div>
  </Section>

  <Section title={t('settings_python')}>
    {#snippet actions()}
      <Button size="sm" icon="refresh" onclick={restartEngine}>
        {t('settings_python_restart')}
      </Button>
    {/snippet}

    <Field label={t('settings_python_path')} hint={t('settings_python_path_hint')}>
      <PathPicker
        value={app.pythonPath}
        filters={[{ name: 'Python', extensions: ['exe'] }]}
        onchange={(value) => updateSettings({ pythonPath: value })}
      />
    </Field>

    {#if status.available}
      <p class="ok">{t('settings_python_ok', { version: status.version ?? '' })}</p>
      {#if status.capabilities?.cuda}
        <p class="muted">{t('settings_python_cuda', { devices: status.capabilities.devices.join(', ') })}</p>
      {:else}
        <p class="muted">{t('settings_python_cpu')}</p>
      {/if}
    {:else}
      <p class="warn">{t('settings_python_missing')}</p>
    {/if}
  </Section>

  <Section title={t('packages_title')}>
    {#if packages?.bundled}
      <p class="ok">{t('packages_bundled')}</p>
    {:else if packages?.installed}
      <p class="ok">{t('packages_installed')}</p>
      <p class="mono muted path">{packages?.target}</p>
    {:else if !packages?.runtimeBundled}
      <!-- A build without the bundled interpreter has nothing to install into, so it
           says so rather than offering a button that cannot work. -->
      <p class="warn">{t('packages_no_runtime')}</p>
    {:else}
      <p class="muted">{t('packages_explainer')}</p>
    {/if}

    {#if packages && !packages.bundled && packages.runtimeBundled}
      <div class="grid">
        <Field label={t('packages_compute')} hint={t('packages_compute_hint')}>
          <select
            value={compute}
            disabled={installing}
            onchange={(event) => (compute = event.currentTarget.value as Compute)}
          >
            <option value="auto">
              {t('packages_compute_auto', { suggested: t(`packages_compute_${packages.suggested}`) })}
            </option>
            <option value="cuda">{t('packages_compute_cuda')}</option>
            <option value="cpu">{t('packages_compute_cpu')}</option>
          </select>
        </Field>
      </div>

      {#if installing}
        <Button size="sm" icon="close" onclick={cancelInstall}>{t('common_cancel')}</Button>
        <p class="muted">{t('packages_installing')}</p>
      {:else}
        <Button size="sm" icon="play" onclick={() => startInstall(compute)}>
          {packages.installed ? t('packages_reinstall') : t('packages_install')}
        </Button>
      {/if}
    {/if}

    {#if log.length}
      <pre class="log mono" bind:this={logBox}>{log.join('\n')}</pre>
    {/if}
  </Section>

  <Section title={t('settings_shortcuts')}>
    <ul class="shortcuts">
      {#each SHORTCUTS as item (item.keys)}
        <li><kbd>{item.keys}</kbd><span>{t(item.label)}</span></li>
      {/each}
    </ul>
  </Section>
</div>

<style>
  .page {
    height: 100%;
    padding: var(--space-5);
    max-width: 860px;
    margin: 0 auto;
  }

  header {
    margin-bottom: var(--space-4);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0 var(--space-4);
  }

  .path {
    font-size: var(--text-xs);
    overflow-wrap: anywhere;
    margin: 0 0 var(--space-2);
  }

  .row {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .classes {
    list-style: none;
    margin: 0 0 var(--space-3);
    padding: 0;
    display: grid;
    gap: var(--space-2);
  }

  /* Siblings in a flex row, never nested buttons: a nested button is invalid HTML and
     the two swallow each other's clicks. */
  .classes li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .id {
    width: 2ch;
    text-align: right;
    color: var(--text-muted);
    font-size: var(--text-xs);
  }

  .name {
    flex: 1;
    height: 30px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
  }

  .colour {
    width: 40px;
    height: 30px;
    padding: 2px;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
    cursor: pointer;
  }

  .remove {
    background: none;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
    padding: 5px;
  }

  .remove:hover {
    color: var(--danger);
    border-color: var(--border);
  }

  .add {
    display: flex;
    gap: var(--space-2);
  }

  .add input {
    flex: 1;
    height: 30px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
  }

  .ok {
    color: var(--brand);
    margin: 0 0 var(--space-1);
  }

  .warn {
    color: var(--amber);
    margin: 0;
  }

  /* uv's own output, followed to the tail. Capped in height so a long install cannot
     push the rest of the page out of reach. */
  .log {
    margin: var(--space-3) 0 0;
    padding: var(--space-2);
    max-height: 220px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font-size: var(--text-xs);
    color: var(--text-muted);
    background: var(--bg-raised);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  .shortcuts {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: var(--space-1) var(--space-4);
  }

  .shortcuts li {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--text-sm);
    padding: 2px 0;
    border-bottom: 1px dotted var(--border);
  }

  kbd {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    padding: 1px 6px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-muted);
    min-width: 7ch;
    text-align: center;
  }
</style>
