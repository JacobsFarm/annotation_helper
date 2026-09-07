<script lang="ts">
  /**
   * Handles, drafts and the crosshair: everything that is feedback rather than data.
   *
   * Kept apart from `ShapeLayer` so that layer can stay a pure function of the shapes,
   * and so overlay churn during a drag never re-renders the shapes themselves.
   */
  import type { PolygonShape, Shape } from '@shared/shapes'
  import { normaliseBox } from '@shared/shapes'
  import { boxHandles, edgeMidpoints, MIDPOINT_MIN_EDGE } from './tools/select'
  import type { DraftBox, HandleHover } from '../state/tool.svelte'

  interface Props {
    selected: Shape | null
    draft: DraftBox | null
    polygonDraft: [number, number][]
    cursor: { x: number; y: number } | null
    hover: HandleHover | null
    scale: number
    image: { width: number; height: number }
    showCrosshair: boolean
    /** Eraser radius in image pixels, or null when the eraser is not the active tool. */
    eraser?: number | null
    /** Polygons whose points to show even though they are not selected. */
    ghosts?: PolygonShape[]
  }

  const {
    selected,
    draft,
    polygonDraft,
    cursor,
    hover,
    scale,
    image,
    showCrosshair,
    eraser = null,
    ghosts = []
  }: Props = $props()

  const stroke = $derived(1.5 / scale)
  const handleSize = $derived(8 / scale)
  // Midpoints are drawn smaller than vertices so a glance separates "a point that exists"
  // from "a point you can pull out of the edge".
  const midpointSize = $derived(5.5 / scale)
</script>

<!-- Crosshair: the cheapest way to line a box edge up with something across the frame. -->
{#if showCrosshair && cursor}
  <g class="crosshair" stroke-width={stroke}>
    <line x1={cursor.x} y1={0} x2={cursor.x} y2={image.height} />
    <line x1={0} y1={cursor.y} x2={image.width} y2={cursor.y} />
  </g>
{/if}

<!-- Points on shapes that are not selected. Only the eraser asks for these: a freshly
     predicted mask is not selected, and erasing points you cannot see is guesswork. -->
{#each ghosts as shape (shape.id)}
  {#each shape.points as [x, y], index (index)}
    <circle class="ghost" cx={x} cy={y} r={midpointSize / 2} stroke-width={stroke} />
  {/each}
{/each}

<!-- The eraser circle, drawn where the deleting actually happens rather than as a mouse
     cursor, so it stays honest at every zoom level. -->
{#if eraser !== null && cursor}
  <circle
    class="eraser"
    cx={cursor.x}
    cy={cursor.y}
    r={eraser}
    stroke-width={stroke}
    stroke-dasharray="{4 / scale} {3 / scale}"
  />
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
    {@const closing = index === 0 && hover?.kind === 'close'}
    <circle
      class="vertex"
      class:hovered={closing}
      cx={x}
      cy={y}
      r={closing ? handleSize * 0.8 : handleSize / 2}
      stroke-width={stroke}
    />
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
    <!-- Midpoints first: a vertex drawn on top of one always wins the click. -->
    {#each edgeMidpoints(selected, handleSize * MIDPOINT_MIN_EDGE) as mid (mid.index)}
      <circle
        class="midpoint"
        class:hovered={hover?.kind === 'edge' && hover.index === mid.index}
        cx={mid.x}
        cy={mid.y}
        r={midpointSize / 2}
        stroke-width={stroke}
      />
    {/each}
    {#each selected.points as [x, y], index (index)}
      {@const hovered = hover?.kind === 'vertex' && hover.index === index}
      <circle
        class="handle-round"
        class:hovered
        cx={x}
        cy={y}
        r={(hovered ? handleSize * 1.35 : handleSize) / 2}
        stroke-width={stroke}
      />
    {/each}
  {/if}
{/if}

<style>
  .crosshair line {
    stroke: var(--selection);
    stroke-opacity: 0.35;
    stroke-dasharray: 4 4;
  }

  .ghost {
    fill: var(--bg-raised);
    fill-opacity: 0.45;
    stroke: var(--selection);
    stroke-opacity: 0.5;
  }

  .eraser {
    fill: var(--danger);
    fill-opacity: 0.1;
    stroke: var(--danger);
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

  /* Hollow and half-there until you reach for it: an edge midpoint is an offer, not a
     point that exists in the label file yet. */
  .midpoint {
    fill: var(--bg-raised);
    fill-opacity: 0.5;
    stroke: var(--selection);
    stroke-opacity: 0.55;
  }

  .midpoint.hovered,
  .handle-round.hovered,
  .vertex.hovered {
    fill: var(--selection);
    fill-opacity: 1;
    stroke: var(--bg-raised);
    stroke-opacity: 1;
  }
</style>
