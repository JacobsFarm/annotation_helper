<script lang="ts">
  /**
   * Handles, drafts and the crosshair: everything that is feedback rather than data.
   *
   * Kept apart from `ShapeLayer` so that layer can stay a pure function of the shapes,
   * and so overlay churn during a drag never re-renders the shapes themselves.
   */
  import type { Shape } from '@shared/shapes'
  import { normaliseBox } from '@shared/shapes'
  import { boxHandles } from './tools/select'
  import type { DraftBox } from '../state/tool.svelte'

  interface Props {
    selected: Shape | null
    draft: DraftBox | null
    polygonDraft: [number, number][]
    cursor: { x: number; y: number } | null
    scale: number
    image: { width: number; height: number }
    showCrosshair: boolean
  }

  const { selected, draft, polygonDraft, cursor, scale, image, showCrosshair }: Props = $props()

  const stroke = $derived(1.5 / scale)
  const handleSize = $derived(8 / scale)
</script>

<!-- Crosshair: the cheapest way to line a box edge up with something across the frame. -->
{#if showCrosshair && cursor}
  <g class="crosshair" stroke-width={stroke}>
    <line x1={cursor.x} y1={0} x2={cursor.x} y2={image.height} />
    <line x1={0} y1={cursor.y} x2={image.width} y2={cursor.y} />
  </g>
{/if}

{#if draft}
  <rect
    class="draft"
    x={Math.min(draft.x1, draft.x2)}
    y={Math.min(draft.y1, draft.y2)}
    width={Math.abs(draft.x2 - draft.x1)}
    height={Math.abs(draft.y2 - draft.y1)}
    stroke-width={stroke * 1.5}
  />
{/if}

{#if polygonDraft.length > 0}
  <polyline
    class="draft"
    points={[...polygonDraft, ...(cursor ? [[cursor.x, cursor.y]] : [])]
      .map(([x, y]) => `${x},${y}`)
      .join(' ')}
    stroke-width={stroke * 1.5}
  />
  {#each polygonDraft as [x, y], index (index)}
    <circle class="vertex" cx={x} cy={y} r={handleSize / 2} stroke-width={stroke} />
  {/each}
{/if}

{#if selected}
  {#if selected.kind === 'box'}
    {@const box = normaliseBox(selected)}
    {#each boxHandles(box) as handle (handle.handle)}
      <rect
        class="handle"
        x={handle.x - handleSize / 2}
        y={handle.y - handleSize / 2}
        width={handleSize}
        height={handleSize}
        stroke-width={stroke}
      />
    {/each}
  {:else}
    {#each selected.points as [x, y], index (index)}
      <circle class="handle-round" cx={x} cy={y} r={handleSize / 2} stroke-width={stroke} />
    {/each}
  {/if}
{/if}

<style>
  .crosshair line {
    stroke: var(--selection);
    stroke-opacity: 0.35;
    stroke-dasharray: 4 4;
  }

  .draft {
    fill: var(--selection);
    fill-opacity: 0.1;
    stroke: var(--selection);
    stroke-dasharray: 5 3;
  }

  polyline.draft {
    fill: none;
  }

  .handle,
  .handle-round,
  .vertex {
    fill: var(--bg-raised);
    stroke: var(--selection);
  }
</style>
