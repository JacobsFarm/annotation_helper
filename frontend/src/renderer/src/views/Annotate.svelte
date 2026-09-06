<script lang="ts">
  /**
   * The annotate screen: image list, canvas, class and shape panels.
   *
   * Everything here is arrangement. The drawing logic lives in `lib/canvas`, the data in
   * `lib/state`, and this file only wires keys and buttons to them.
   */
  import { onMount } from 'svelte'
  import Button from '../lib/components/Button.svelte'
  import Icon from '../lib/components/Icon.svelte'
  import Viewport from '../lib/canvas/Viewport.svelte'
  import { toolById } from '../lib/canvas/tools'
  import { t } from '../lib/i18n/index.svelte'
  import { api, safeCall } from '../lib/api'
  import {
    canRedo,
    canUndo,
    clearAnnotation,
    current,
    isDirty,
    isSaving,
    loadAnnotation,
    redo,
    removePredicted,
    removeSelected,
    removeShape,
    saveAnnotation,
    saveAsBackground,
    select,
    selectedIds,
    setClassOfSelected,
    shapes,
    undo
  } from '../lib/state/annotations.svelte'
  import {
    cancelPredict,
    canPredict,
    isPredicting,
    predictCurrent,
    predictProgress
  } from '../lib/state/ai.svelte'
  import {
    currentEntry,
    currentIndex,
    datasetFilter,
    loadDataset,
    removeEntry,
    searchQuery,
    setFilter,
    setSearchQuery,
    step,
    total,
    visibleEntries,
    goTo,
    type DatasetFilter
  } from '../lib/state/dataset.svelte'
  import { activeClassId, classes, colorFor, nameFor, project } from '../lib/state/project.svelte'
  import { setActiveClass } from '../lib/state/project.svelte'
  import { settings } from '../lib/state/settings.svelte'
  import { activeTool, cursorPosition, setActiveTool, type ToolId } from '../lib/state/tool.svelte'
  import { actualSize, fit, viewport, zoomStep } from '../lib/state/viewport.svelte'

  const FILTERS: DatasetFilter[] = ['all', 'todo', 'done']
  const FILTER_LABELS = {
    all: 'annotate_filter_all',
    todo: 'annotate_filter_todo',
    done: 'annotate_filter_done'
  } as const

  const TOOL_BUTTONS: { id: ToolId; icon: 'select' | 'box' | 'polygon' | 'pan'; label: string }[] = [
    { id: 'select', icon: 'select', label: 'annotate_tool_select' },
    { id: 'box', icon: 'box', label: 'annotate_tool_box' },
    { id: 'polygon', icon: 'polygon', label: 'annotate_tool_polygon' },
    { id: 'pan', icon: 'pan', label: 'annotate_tool_pan' }
  ]

  let lastLoaded = $state<string | null>(null)

  const entry = $derived(currentEntry())
  const annotation = $derived(current())
  const projectRoot = $derived(project()?.root ?? '')

  onMount(() => {
    const open = project()
    if (open) void loadDataset(open.root)
    return () => clearAnnotation()
  })

  // Load the label file whenever a different image becomes current. Guarded on the file
  // name so the effect cannot re-trigger itself.
  $effect(() => {
    const file = entry?.file ?? null
    if (file === lastLoaded) return
    lastLoaded = file
    if (projectRoot && file) void loadAnnotation(projectRoot, file)
    else clearAnnotation()
  })

  async function navigate(delta: number): Promise<void> {
    if (isDirty() && settings().autosave && projectRoot) {
      await saveAnnotation(projectRoot, true)
    }
    step(delta)
  }

  async function save(): Promise<void> {
    if (projectRoot) await saveAnnotation(projectRoot)
  }

  async function markBackground(): Promise<void> {
    if (projectRoot) await saveAsBackground(projectRoot)
  }

  async function trashCurrent(): Promise<void> {
    if (!entry || !projectRoot) return
    const { file, area } = entry
    if (!window.confirm(t('annotate_delete_confirm'))) return
    const result = await safeCall(() => api.files.trash({ root: projectRoot, file, area }))
    if (result) removeEntry(file)
  }

  /** The inbox, so dropping images in is one click rather than a path to remember. */
  async function openInbox(): Promise<void> {
    const open = project()
    if (open) await safeCall(() => api.app.openPath(`${open.root}/${open.paths.input}`))
  }

  async function predict(): Promise<void> {
    if (entry) await predictCurrent(entry.file)
  }

  function refit(): void {
    if (annotation) fit({ width: annotation.width, height: annotation.height })
  }

  function onKeyDown(event: KeyboardEvent): void {
    const target = event.target as HTMLElement | null
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

    // Tools get first refusal, so Esc and Enter mean what the active tool needs.
    if (toolById(activeTool()).onKeyDown?.(event)) {
      event.preventDefault()
      return
    }

    const ctrl = event.ctrlKey || event.metaKey
    if (ctrl && event.key.toLowerCase() === 's') {
      event.preventDefault()
      void save()
      return
    }
    if (ctrl && event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
      return
    }
    if (ctrl && event.key === '0') {
      event.preventDefault()
      if (annotation) actualSize({ width: annotation.width, height: annotation.height })
      return
    }
    if (ctrl) return

    switch (event.key) {
      case 'ArrowRight':
      case 'PageDown':
        void navigate(1)
        break
      case 'ArrowLeft':
      case 'PageUp':
        void navigate(-1)
        break
      case 'Delete':
      case 'Backspace':
        removeSelected()
        break
      case 'Escape':
        select(null)
        break
      case 'v':
        setActiveTool('select')
        break
      case 'b':
        setActiveTool('box')
        break
      case 'p':
        setActiveTool('polygon')
        break
      case 'h':
        setActiveTool('pan')
        break
      case 'f':
        refit()
        break
      case 'n':
        void markBackground()
        break
      case 'e':
        void predict()
        break
      default:
        // 1-9 pick a class, and re-class the selection if there is one.
        if (/^[1-9]$/.test(event.key)) {
          const picked = classes()[Number(event.key) - 1]
          if (picked) {
            setActiveClass(picked.id)
            if (selectedIds().length > 0) setClassOfSelected(picked.id)
          }
        }
        return
    }
    event.preventDefault()
  }
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="annotate">
  <!-- image list -->
  <aside class="sidebar">
    <div class="panel-head">
      <h3>{t('annotate_images')}</h3>
      <div class="group">
        <Button
          size="sm"
          variant="ghost"
          icon="folder"
          title={t('annotate_open_input')}
          onclick={openInbox}
        />
        <Button
          size="sm"
          variant="ghost"
          icon="refresh"
          title={t('common_refresh')}
          onclick={() => projectRoot && loadDataset(projectRoot)}
        />
      </div>
    </div>
    <div class="filters">
      {#each FILTERS as id (id)}
        <button class="chip" class:active={datasetFilter() === id} onclick={() => setFilter(id)}>
          {t(FILTER_LABELS[id])}
        </button>
      {/each}
    </div>
    <input
      class="search"
      type="search"
      placeholder={t('annotate_search')}
      value={searchQuery()}
      oninput={(event) => setSearchQuery(event.currentTarget.value)}
    />
    <ul class="scroll files">
      {#each visibleEntries() as item, index (item.file)}
        <li>
          <button class="file" class:active={index === currentIndex()} onclick={() => goTo(index)}>
            <span class="dot" class:done={item.labelled} class:background={item.labelled && item.shapeCount === 0}
            ></span>
            <span class="filename">{item.file}</span>
            {#if item.area === 'input'}
              <span class="badge" title={t('annotate_pending_hint')}>{t('annotate_pending')}</span>
            {/if}
            <span class="count muted">{item.shapeCount}</span>
          </button>
        </li>
      {:else}
        <li class="empty">
          <p>{t('annotate_no_images')}</p>
          <p class="muted">{t('annotate_no_images_hint')}</p>
          <Button size="sm" icon="folder" onclick={openInbox}>{t('annotate_open_input')}</Button>
        </li>
      {/each}
    </ul>
  </aside>

  <!-- canvas column -->
  <section class="canvas-column">
    <div class="toolbar">
      <div class="group">
        {#each TOOL_BUTTONS as button (button.id)}
          <Button
            size="sm"
            variant="ghost"
            icon={button.icon}
            title={t(button.label as never)}
            active={activeTool() === button.id}
            onclick={() => setActiveTool(button.id)}
          />
        {/each}
      </div>

      <div class="group">
        <Button size="sm" variant="ghost" icon="zoomOut" title={t('annotate_zoom_out')} onclick={() => zoomStep(-1)} />
        <Button size="sm" variant="ghost" icon="zoomIn" title={t('annotate_zoom_in')} onclick={() => zoomStep(1)} />
        <Button size="sm" variant="ghost" icon="fit" title={t('annotate_zoom_fit')} onclick={refit} />
      </div>

      <div class="group">
        <Button size="sm" variant="ghost" icon="undo" title={t('common_undo')} disabled={!canUndo()} onclick={undo} />
        <Button size="sm" variant="ghost" icon="redo" title={t('common_redo')} disabled={!canRedo()} onclick={redo} />
      </div>

      <div class="spacer"></div>

      <div class="group">
        <Button
          size="sm"
          variant="ghost"
          icon="previous"
          title={t('annotate_previous')}
          disabled={currentIndex() === 0}
          onclick={() => navigate(-1)}
        />
        <span class="counter mono">
          {t('annotate_status_counter', { index: total() === 0 ? 0 : currentIndex() + 1, total: total() })}
        </span>
        <Button
          size="sm"
          variant="ghost"
          icon="next"
          title={t('annotate_next')}
          disabled={currentIndex() >= total() - 1}
          onclick={() => navigate(1)}
        />
      </div>

      <div class="group">
        <Button
          size="sm"
          icon="background"
          title={t('annotate_mark_background_hint')}
          disabled={!annotation}
          onclick={markBackground}>{t('annotate_mark_background')}</Button
        >
        <Button
          size="sm"
          variant="danger"
          icon="trash"
          title={t('annotate_delete_image')}
          disabled={!entry}
          onclick={trashCurrent}
        />
        <Button
          size="sm"
          variant="cta"
          icon="save"
          disabled={!annotation || isSaving()}
          onclick={save}
        >
          {isSaving() ? t('common_saving') : t('common_save')}
        </Button>
      </div>
    </div>

    <div class="canvas">
      {#if entry && annotation}
        <Viewport
          url={entry.url}
          width={annotation.width}
          height={annotation.height}
          shapes={shapes()}
          selected={selectedIds()}
        />
      {:else}
        <div class="empty">{t('annotate_no_images')}</div>
      {/if}
    </div>

    <div class="statusbar mono">
      <span>{t(toolById(activeTool()).hintKey)}</span>
      <div class="spacer"></div>
      {#if cursorPosition()}
        <span>
          {t('annotate_status_position', {
            x: Math.round(cursorPosition()!.x),
            y: Math.round(cursorPosition()!.y)
          })}
        </span>
      {/if}
      {#if annotation}
        <span>{t('annotate_status_size', { width: annotation.width, height: annotation.height })}</span>
        <span>{t('annotate_status_shapes', { count: shapes().length })}</span>
      {/if}
      <span>{t('annotate_status_zoom', { percent: Math.round(viewport().scale * 100) })}</span>
      {#if isDirty()}<span class="dirty">{t('annotate_unsaved')}</span>{/if}
    </div>
  </section>

  <!-- classes + shapes -->
  <aside class="sidebar right">
    <div class="panel-head"><h3>{t('annotate_classes')}</h3></div>
    <ul class="classes">
      {#each classes() as item, index (item.id)}
        <li>
          <button
            class="class"
            class:active={activeClassId() === item.id}
            onclick={() => {
              setActiveClass(item.id)
              if (selectedIds().length > 0) setClassOfSelected(item.id)
            }}
          >
            <span class="swatch" style:background={item.color}></span>
            <span class="filename">{item.name}</span>
            {#if index < 9}<kbd>{index + 1}</kbd>{/if}
          </button>
        </li>
      {/each}
    </ul>

    <div class="panel-head">
      <h3>{t('annotate_shapes')}</h3>
      <Button
        size="sm"
        variant="ghost"
        icon="close"
        title={t('annotate_clear_ai')}
        disabled={!shapes().some((s) => s.source === 'ai')}
        onclick={removePredicted}
      />
    </div>
    <ul class="scroll shapes">
      {#each shapes() as shape (shape.id)}
        <li>
          <button
            class="shape-row"
            class:active={selectedIds().includes(shape.id)}
            onclick={() => select(shape.id)}
          >
            <span class="swatch" style:background={colorFor(shape.classId)}></span>
            <span class="filename">{nameFor(shape.classId)}</span>
            <span class="muted kind">
              {shape.kind === 'box' ? t('annotate_shape_box') : t('annotate_shape_polygon')}
            </span>
            {#if shape.source === 'ai'}<span class="badge">{t('annotate_source_ai')}</span>{/if}
          </button>
          <button
            class="row-delete"
            title={t('common_delete')}
            aria-label={t('common_delete')}
            onclick={() => removeShape(shape.id)}
          >
            <Icon name="close" size={13} />
          </button>
        </li>
      {:else}
        <li class="empty muted">{t('annotate_shapes_empty')}</li>
      {/each}
    </ul>

    <div class="predict">
      {#if isPredicting()}
        <div class="progress"><div class="bar" style:width="{predictProgress()}%"></div></div>
        <Button size="sm" variant="ghost" icon="stop" onclick={cancelPredict}>
          {t('annotate_predict_cancel')}
        </Button>
      {:else}
        <Button
          size="sm"
          variant="primary"
          icon="predict"
          disabled={!canPredict() || !entry}
          title={canPredict() ? t('annotate_predict') : t('settings_python_missing')}
          onclick={predict}
        >
          {t('annotate_predict')}
        </Button>
      {/if}
    </div>
  </aside>
</div>

<style>
  .annotate {
    display: grid;
    grid-template-columns: var(--sidebar-width) 1fr var(--sidebar-width);
    height: 100%;
    min-height: 0;
  }

  .sidebar {
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid var(--border);
    background: var(--bg);
  }

  .sidebar.right {
    border-right: none;
    border-left: 1px solid var(--border);
  }

  .panel-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .filters {
    display: flex;
    gap: var(--space-1);
    padding: var(--space-2) var(--space-3) 0;
  }

  .chip {
    flex: 1;
    padding: 3px 6px;
    font-size: var(--text-xs);
    border: 1px solid var(--border);
    border-radius: 999px;
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
  }

  .chip.active {
    background: var(--brand-soft);
    border-color: var(--brand);
    color: var(--brand);
  }

  .search {
    margin: var(--space-2) var(--space-3);
    height: 28px;
    padding: 0 var(--space-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--bg-raised);
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-2);
  }

  .files,
  .shapes {
    flex: 1;
    min-height: 0;
    padding-bottom: var(--space-2);
  }

  .shapes li {
    display: flex;
    align-items: center;
  }

  .file,
  .class,
  .shape-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    padding: 5px var(--space-2);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-size: var(--text-sm);
  }

  .file:hover,
  .class:hover,
  .shape-row:hover {
    background: var(--bg-sunken);
  }

  .file.active,
  .class.active,
  .shape-row.active {
    background: var(--brand-soft);
    border-color: var(--brand);
  }

  .filename {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .count,
  .kind {
    font-size: var(--text-xs);
  }

  .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--border-strong);
    flex: none;
  }

  .dot.done {
    background: var(--brand);
  }

  .dot.background {
    background: var(--teal);
  }

  .swatch {
    width: 11px;
    height: 11px;
    border-radius: 3px;
    flex: none;
  }

  kbd {
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 4px;
    border: 1px solid var(--border);
    border-radius: 3px;
    color: var(--text-muted);
  }

  .badge {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 1px 5px;
    border-radius: 999px;
    background: var(--brand-soft);
    color: var(--brand);
  }

  .row-delete {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    padding: 4px;
    border-radius: var(--radius-sm);
  }

  .row-delete:hover {
    color: var(--danger);
  }

  .canvas-column {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-width: 0;
    min-height: 0;
  }

  .toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-2) var(--space-3);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
    flex-wrap: wrap;
  }

  .group {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .counter {
    font-size: var(--text-sm);
    color: var(--text-muted);
    min-width: 5ch;
    text-align: center;
  }

  .canvas {
    min-height: 0;
    position: relative;
  }

  .statusbar {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-1) var(--space-3);
    border-top: 1px solid var(--border);
    background: var(--bg-sunken);
    color: var(--text-muted);
    font-size: var(--text-xs);
    min-height: 26px;
  }

  .dirty {
    color: var(--amber);
    font-weight: 600;
  }

  .predict {
    padding: var(--space-3);
    border-top: 1px solid var(--border);
    display: grid;
    gap: var(--space-2);
  }

  .progress {
    height: 4px;
    border-radius: 999px;
    background: var(--bg-sunken);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--brand);
    transition: width 150ms ease;
  }

  .empty {
    padding: var(--space-4);
    text-align: center;
    font-size: var(--text-sm);
  }

  .files .empty {
    display: grid;
    gap: var(--space-2);
    justify-items: center;
  }

  @media (max-width: 1180px) {
    .annotate {
      grid-template-columns: 210px 1fr 210px;
    }
  }
</style>
