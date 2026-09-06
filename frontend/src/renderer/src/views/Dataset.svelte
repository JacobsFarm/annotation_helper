<script lang="ts">
  /**
   * Dataset screen: what is in the project, what is wrong with it, and how to split it.
   *
   * The health check and the split are the Python implementation, reached over the
   * sidecar - the same code path the CLI uses, so the GUI and a terminal can never
   * disagree about what a split contains.
   */
  import type { HealthReport, SplitResult } from '@shared/ipc'
  import { api, safeCall } from '../lib/api'
  import Button from '../lib/components/Button.svelte'
  import Field from '../lib/components/Field.svelte'
  import Section from '../lib/components/Section.svelte'
  import { issueMessage, t } from '../lib/i18n/index.svelte'
  import { pythonStatus } from '../lib/state/ai.svelte'
  import { datasetSummary, loadDataset } from '../lib/state/dataset.svelte'
  import { nameFor, patchProject, project } from '../lib/state/project.svelte'
  import { pushToast } from '../lib/state/toast.svelte'

  let report = $state<HealthReport | null>(null)
  let splitResult = $state<SplitResult | null>(null)
  let busy = $state(false)
  let mode = $state<'copy' | 'move' | 'lists'>('copy')
  let includeUnlabelled = $state(false)

  const open = $derived(project())
  const summary = $derived(datasetSummary())
  const pythonReady = $derived(pythonStatus().available)

  async function runCheck(): Promise<void> {
    if (!open) return
    busy = true
    report = await safeCall(() => api.dataset.check(open.root))
    busy = false
  }

  async function runSplit(): Promise<void> {
    if (!open) return
    busy = true
    splitResult = await safeCall(() =>
      api.dataset.split({ root: open.root, mode, includeUnlabelled })
    )
    busy = false
    if (splitResult) await loadDataset(open.root)
  }

  async function exportConfig(): Promise<void> {
    if (!open) return
    const result = await safeCall(() => api.dataset.exportConfig(open.root))
    if (result) pushToast('success', t('dataset_export_done'), result.dataYaml)
  }

  async function setRatio(key: 'train' | 'val' | 'test' | 'seed', value: number): Promise<void> {
    if (!open) return
    await patchProject({ split: { ...open.split, [key]: value } })
  }

  const errors = $derived(report?.issues.filter((i) => i.level === 'error').length ?? 0)
  const warnings = $derived(report?.issues.filter((i) => i.level === 'warning').length ?? 0)
</script>

<div class="page scroll">
  <header><h1>{t('dataset_title')}</h1></header>

  <Section title={t('dataset_summary')}>
    <div class="stats">
      <div class="stat"><strong>{summary.total}</strong><span>{t('dataset_images')}</span></div>
      <div class="stat"><strong>{summary.labelled}</strong><span>{t('dataset_labelled')}</span></div>
      <div class="stat">
        <strong>{summary.total - summary.labelled}</strong><span>{t('dataset_unlabelled')}</span>
      </div>
      <div class="stat">
        <strong>{summary.backgrounds}</strong><span>{t('dataset_backgrounds')}</span>
      </div>
      <div class="stat"><strong>{summary.shapes}</strong><span>{t('dataset_shapes')}</span></div>
    </div>
  </Section>

  <Section title={t('dataset_health')}>
    {#snippet actions()}
      <Button size="sm" icon="check" disabled={!pythonReady || busy} onclick={runCheck}>
        {t('dataset_health_run')}
      </Button>
    {/snippet}

    {#if !pythonReady}
      <p class="muted">{t('settings_python_missing')}</p>
    {:else if !report}
      <p class="muted">{t('train_log_empty')}</p>
    {:else}
      <p class:clean={report.issues.length === 0}>
        {report.issues.length === 0
          ? t('dataset_health_clean')
          : t('dataset_health_summary', { errors, warnings })}
      </p>

      {#if Object.keys(report.perClass).length > 0}
        <h4>{t('dataset_per_class')}</h4>
        <ul class="per-class">
          {#each Object.entries(report.perClass) as [id, count] (id)}
            <li><span>{nameFor(Number(id))}</span><strong>{count}</strong></li>
          {/each}
        </ul>
      {/if}

      {#if report.issues.length > 0}
        <div class="scroll-x table-wrap">
          <table>
            <thead>
              <tr>
                <th>{t('dataset_issue_file')}</th>
                <th>{t('dataset_issue_problem')}</th>
              </tr>
            </thead>
            <tbody>
              {#each report.issues.slice(0, 200) as issue, index (index)}
                <tr class={issue.level}>
                  <td class="mono">{issue.file}</td>
                  <td>{issueMessage(issue.code)}{issue.detail ? ` — ${issue.detail}` : ''}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    {/if}
  </Section>

  <Section title={t('dataset_split')}>
    {#snippet actions()}
      <Button size="sm" onclick={exportConfig}>{t('dataset_export')}</Button>
      <Button size="sm" variant="cta" icon="play" disabled={!pythonReady || busy} onclick={runSplit}>
        {t('dataset_split_run')}
      </Button>
    {/snippet}

    <div class="grid">
      <Field label={t('dataset_split_mode')} hint={t('dataset_split_mode_hint')}>
        <select bind:value={mode}>
          <option value="copy">{t('dataset_split_mode_copy')}</option>
          <option value="move">{t('dataset_split_mode_move')}</option>
          <option value="lists">{t('dataset_split_mode_lists')}</option>
        </select>
      </Field>
      <Field label={t('dataset_split_seed')} hint={t('dataset_split_seed_hint')}>
        <input
          type="number"
          value={open?.split.seed ?? 1337}
          onchange={(event) => setRatio('seed', Number(event.currentTarget.value))}
        />
      </Field>
      <Field label={t('dataset_split_train')}>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={open?.split.train ?? 0.8}
          onchange={(event) => setRatio('train', Number(event.currentTarget.value))}
        />
      </Field>
      <Field label={t('dataset_split_val')}>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={open?.split.val ?? 0.15}
          onchange={(event) => setRatio('val', Number(event.currentTarget.value))}
        />
      </Field>
      <Field label={t('dataset_split_test')}>
        <input
          type="number"
          step="0.05"
          min="0"
          max="1"
          value={open?.split.test ?? 0.05}
          onchange={(event) => setRatio('test', Number(event.currentTarget.value))}
        />
      </Field>
      <Field label={t('dataset_split_include')} inline>
        <input type="checkbox" bind:checked={includeUnlabelled} />
      </Field>
    </div>

    {#if splitResult}
      <p class="result mono">
        {t('dataset_split_done', {
          train: splitResult.train,
          val: splitResult.val,
          test: splitResult.test,
          skipped: splitResult.skipped
        })}
      </p>
      <p class="mono muted">{splitResult.output}</p>
    {/if}
  </Section>
</div>

<style>
  .page {
    height: 100%;
    padding: var(--space-5);
    max-width: 1000px;
    margin: 0 auto;
  }

  header {
    margin-bottom: var(--space-4);
  }

  .stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--space-3);
  }

  .stat {
    display: grid;
    gap: 2px;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    background: var(--bg-sunken);
  }

  .stat strong {
    font-family: var(--font-display);
    font-size: var(--text-2xl);
    color: var(--brand);
    line-height: 1;
  }

  .stat span {
    font-size: var(--text-xs);
    color: var(--text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0 var(--space-4);
  }

  h4 {
    margin: var(--space-3) 0 var(--space-2);
    font-size: var(--text-sm);
  }

  .per-class {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: var(--space-1) var(--space-3);
  }

  .per-class li {
    display: flex;
    justify-content: space-between;
    font-size: var(--text-sm);
    border-bottom: 1px dotted var(--border);
    padding: 2px 0;
  }

  .table-wrap {
    margin-top: var(--space-3);
    max-height: 320px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--text-sm);
  }

  th,
  td {
    text-align: left;
    padding: 5px var(--space-3);
    border-bottom: 1px solid var(--border);
    white-space: nowrap;
  }

  th {
    position: sticky;
    top: 0;
    background: var(--bg-sunken);
    font-size: var(--text-xs);
  }

  tr.error td:first-child {
    box-shadow: inset 3px 0 var(--danger);
  }

  tr.warning td:first-child {
    box-shadow: inset 3px 0 var(--amber);
  }

  .clean {
    color: var(--brand);
  }

  .result {
    margin-top: var(--space-3);
    font-weight: 600;
  }
</style>
