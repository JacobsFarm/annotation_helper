<script lang="ts">
  /**
   * Draws the shapes. Knows nothing about interaction, tools or the pointer.
   *
   * Everything is in image pixels, because the parent applies one CSS transform to the
   * whole stage. Stroke widths and font sizes are divided by the scale so they stay a
   * constant size on screen at any zoom - the only place the scale is read here.
   */
  import type { Shape } from '@shared/shapes'
  import { normaliseBox } from '@shared/shapes'
  import { colorFor, nameFor } from '../state/project.svelte'

  interface Props {
    shapes: Shape[]
    selected: string[]
    scale: number
    showLabels: boolean
  }

  const { shapes, selected, scale, showLabels }: Props = $props()

  const stroke = $derived(2 / scale)
  const labelSize = $derived(12 / scale)

  function polygonPoints(points: [number, number][]): string {
    return points.map(([x, y]) => `${x},${y}`).join(' ')
  }
</script>

{#each shapes as shape (shape.id)}
  {@const colour = colorFor(shape.classId)}
  {@const isSelected = selected.includes(shape.id)}
  <g
    class="shape"
    class:selected={isSelected}
    class:predicted={shape.source === 'ai'}
    style:--shape-colour={colour}
  >
    {#if shape.kind === 'box'}
      {@const box = normaliseBox(shape)}
      <rect
        x={box.x1}
        y={box.y1}
        width={box.x2 - box.x1}
        height={box.y2 - box.y1}
        stroke-width={stroke}
      />
      {#if showLabels}
        <text x={box.x1 + stroke} y={box.y1 - stroke * 1.5} font-size={labelSize}>
          {nameFor(shape.classId)}
        </text>
      {/if}
    {:else}
      <polygon points={polygonPoints(shape.points)} stroke-width={stroke} />
      {#if showLabels && shape.points[0]}
        <text
          x={shape.points[0][0] + stroke}
          y={shape.points[0][1] - stroke * 1.5}
          font-size={labelSize}
        >
          {nameFor(shape.classId)}
        </text>
      {/if}
    {/if}
  </g>
{/each}

<style>
  .shape rect,
  .shape polygon {
    fill: var(--shape-colour);
    fill-opacity: 0.12;
    stroke: var(--shape-colour);
  }

  /* A predicted shape is dashed until it has been touched, so "what did I actually
     check?" is answerable at a glance. */
  .shape.predicted rect,
  .shape.predicted polygon {
    stroke-dasharray: 6 4;
    fill-opacity: 0.06;
  }

  .shape.selected rect,
  .shape.selected polygon {
    fill-opacity: 0.24;
    stroke: var(--selection);
  }

  .shape text {
    fill: var(--shape-colour);
    paint-order: stroke;
    stroke: var(--bg-canvas);
    stroke-width: 0.25em;
    font-family: var(--font-body);
    font-weight: 600;
    user-select: none;
  }
</style>
