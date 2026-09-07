<script lang="ts">
  /**
   * Training screen.
   *
   * The command is shown before anything runs and can be copied into a terminal, so the
   * GUI is never the only way to start a run. The run itself is a subprocess supervised
   * by the sidecar: a torch process that hangs cannot take the app down with it.
   */
  import Button from '../lib/components/Button.svelte'
  import Field from '../lib/components/Field.svelte'
  import Section from '../lib/components/Section.svelte'
  import PathPicker from '../lib/components/PathPicker.svelte'
  import { t } from '../lib/i18n/index.svelte'
  import { pythonStatus } from '../lib/state/ai.svelte'
  import { datasetSummary } from '../lib/state/dataset.svelte'
  import { patchProject, project } from '../lib/state/project.svelte'
  import { pushToast } from '../lib/state/toast.svelte'
  import {
    cancelTraining,
    currentRun,
    isTraining,
    loadCommand,
    startTraining,
    trainCommand,
    trainEpoch,
    trainEpochs,
    trainLog
  } from '../lib/state/training.svelte'

  const open = $derived(project())
  const ready = $derived(pythonStatus().capabilities?.train === true)
  /**
   * A segmentation run cannot learn from a box, and a file holding both kinds is worse
   * than useless to it. Better said here, before an hour of training, than inferred
   * afterwards from a disappointing mAP.
   */
  const segmenting = $derived(open?.task === 'segment' || open?.task === 'both')
  const gap = $derived(datasetSummary())
  const command = $derived(trainCommand().join(' '))
  const progress = $derived(
    trainEpochs() > 0 ? Math.round((trainEpoch() / trainEpochs()) * 100) : 0
  )

  // Keep the displayed command in step with the settings above it.
  $effect(() => {
    const root = open?.root
    const settings = open?.training
    if (root && settings && ready) void loadCommand(root)
  })

  async function patchTraining(patch: Record<string, unknown>): Promise<void> {
    if (!open) return
    await patchProject({ training: { ...open.training, ...patch } })
  }

  async function start(): Promise<void> {
    if (!open) return
    const started = await startTraining(open.root)
    if (!started) pushToast('error', t('error_training_failed'))
  }

  async function copyCommand(): Promise<void> {
    await navigator.clipboard.writeText(command)
    pushToast('info', t('common_copied'))
  }
</script>

<div class="page scroll">
  <header><h1>{t('train_title')}</h1></header>

  {#if !ready}
    <p class="warn">{t('settings_python_missing')}</p>
  {/if}

  {#if segmenting && gap.boxImages + gap.mixedImages > 0}
    <p class="warn">
      {t('train_segment_gap', { boxes: gap.boxImages, mixed: gap.mixedImages })}
    </p>
  {/if}

  <Section title={t('train_settings')}>
    <div class="grid">
      <Field label={t('train_model')} hint={t('train_model_hint')}>
        <PathPicker
          value={open?.training.model ?? ''}
          filters={[{ name: 'PyTorch', extensions: ['pt'] }]}
          onchange={(value) => patchTraining({ model: value })}
        />
      </Field>
      <Field label={t('train_epochs')}>
        <input
          type="number"
          min="1"
          value={open?.training.epochs ?? 100}
          onchange={(event) => patchTraining({ epochs: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('train_imgsz')}>
        <input
          type="number"
          min="32"
          step="32"
          value={open?.training.imgsz ?? 640}
          onchange={(event) => patchTraining({ imgsz: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('train_batch')}>
        <input
          type="number"
          min="-1"
          value={open?.training.batch ?? 16}
          onchange={(event) => patchTraining({ batch: Number(event.currentTarget.value) })}
        />
      </Field>
      <Field label={t('train_device')} hint={t('train_device_hint')}>
        <input
          type="text"
          value={open?.training.device ?? ''}
          onchange={(event) => patchTraining({ device: event.currentTarget.value })}
        />
      </Field>
      <Field label={t('train_run_name')}>
        <input
          type="text"
          value={open?.training.runName ?? 'train'}
          onchange={(event) => patchTraining({ runName: event.currentTarget.value })}
        />
      </Field>
    </div>
  </Section>

  <Section title={t('train_command')}>
    {#snippet actions()}
      <Button size="sm" variant="ghost" disabled={!command} onclick={copyCommand}>
        {t('common_copy')}
      </Button>
      {#if isTraining()}
        <Button
          size="sm"
          variant="danger"
          icon="stop"
          onclick={() => open && cancelTraining(open.root)}
        >
          {t('train_cancel')}
        </Button>
      {:else}
        <Button size="sm" variant="cta" icon="play" disabled={!ready} onclick={start}>
          {t('train_start')}
        </Button>
      {/if}
    {/snippet}

    <p class="hint muted">{t('train_command_hint')}</p>
    <pre class="command mono scroll-x">{command || t('train_needs_split')}</pre>
  </Section>

  <Section title={t('train_log')}>
    {#if isTraining() && trainEpochs() > 0}
      <div class="progress-row">
        <span>{t('train_epoch', { epoch: trainEpoch(), epochs: trainEpochs() })}</span>
        <div class="progress"><div class="bar" style:width="{progress}%"></div></div>
      </div>
    {:else if currentRun()?.finished}
      <p class="muted">{t('train_finished', { code: currentRun()?.exitCode ?? 0 })}</p>
    {/if}

    {#if trainLog().length === 0}
      <p class="muted">{t('train_log_empty')}</p>
    {:else}
      <pre class="log mono">{trainLog().join('\n')}</pre>
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

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 0 var(--space-4);
  }

  .warn {
    padding: var(--space-3);
    border: 1px solid var(--amber);
    border-radius: var(--radius);
    background: oklch(65% 0.16 75 / 0.1);
    margin-bottom: var(--space-4);
  }

  .hint {
    margin: 0 0 var(--space-2);
    font-size: var(--text-xs);
  }

  .command,
  .log {
    margin: 0;
    padding: var(--space-3);
    background: var(--bg-sunken);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    font-size: var(--text-xs);
    line-height: 1.5;
  }

  .command {
    white-space: pre;
  }

  .log {
    max-height: 380px;
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .progress-row {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    margin-bottom: var(--space-3);
    font-size: var(--text-sm);
  }

  .progress {
    flex: 1;
    height: 6px;
    border-radius: 999px;
    background: var(--bg-sunken);
    overflow: hidden;
  }

  .bar {
    height: 100%;
    background: var(--brand);
    transition: width 300ms ease;
  }
</style>
