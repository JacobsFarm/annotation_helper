<script lang="ts">
  /**
   * The image and its transform. Owns the pointer, owns nothing else.
   *
   * The image is a plain `<img>` served over `ah-img://`, so Chromium does the decoding,
   * caching and GPU upload; sending pixels over IPC would be slower and pointless. Zoom
   * and pan are one CSS transform on the stage, and shapes are drawn in an SVG that uses
   * image pixels directly - so no layer ever recomputes the scale for itself.
   */
  import { screenPoint, toImage, type Viewport as ViewportTransform } from '@shared/geometry'
  import type { Shape } from '@shared/shapes'
  import { toolById } from './tools'
  import ShapeLayer from './ShapeLayer.svelte'
  import Overlay from './Overlay.svelte'
  import {
    activeTool,
    cursorPosition,
    draft,
    handleHover,
    polygonDraft,
    setCursorPosition,
    setHandleHover
  } from '../state/tool.svelte'
  import { fit, pan, setContainer, viewport, zoom } from '../state/viewport.svelte'

  interface Props {
    url: string
    width: number
    height: number
    shapes: Shape[]
    selected: string[]
    showLabels?: boolean
    showCrosshair?: boolean
  }

  const {
    url,
    width,
    height,
    shapes,
    selected,
    showLabels = true,
    showCrosshair = true
  }: Props = $props()

  let host = $state<HTMLDivElement | null>(null)
  let containerWidth = $state(0)
  let containerHeight = $state(0)
  let panning = $state(false)
  let lastScreen = { x: 0, y: 0 }

  const view = $derived<ViewportTransform>(viewport())
  const tool = $derived(toolById(activeTool()))
  const selectedShape = $derived(shapes.find((s) => s.id === selected[0]) ?? null)
  const hover = $derived(handleHover())
  const cursor = $derived.by(() => {
    if (panning || activeTool() === 'pan') return 'grabbing'
    // The cursor says which of the two dots is under it: grab an existing vertex, or
    // pull a new one out of an edge midpoint.
    if (hover?.kind === 'vertex') return 'grab'
    if (hover?.kind === 'edge') return 'copy'
    if (hover?.kind === 'close') return 'pointer'
    return tool.cursor
  })

  $effect(() => {
    setContainer({ width: containerWidth, height: containerHeight })
  })

  // Re-fit whenever a different image or a different viewport size arrives, so every
  // image starts fully visible.
  //
  // The key is the whole point. `width` and `height` are props read through the parent's
  // getters, so this effect re-runs on every shape edit as well - the annotation object
  // is replaced on each pointer move. Without the guard, dragging a polygon vertex reset
  // the zoom on every frame. A plain `let` holds the key so comparing it stays outside
  // the reactive graph.
  let fittedKey: string | null = null

  $effect(() => {
    const key = `${url}|${width}x${height}|${containerWidth}x${containerHeight}`
    if (!url || width <= 0 || height <= 0 || containerWidth <= 0) return
    if (key === fittedKey) return
    fittedKey = key
    fit({ width, height })
  })

  function pointFor(event: MouseEvent): ReturnType<typeof toImage> {
    const rect = host!.getBoundingClientRect()
    return toImage(screenPoint(event.clientX - rect.left, event.clientY - rect.top), view)
  }

  function toolEvent(event: MouseEvent) {
    return {
      point: pointFor(event),
      scale: view.scale,
      image: { width, height },
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      ctrlKey: event.ctrlKey,
      button: event.button
    }
  }

  function onPointerDown(event: PointerEvent): void {
    host?.setPointerCapture(event.pointerId)

    // Panning works from every tool with the middle mouse button. Space is not a pan
    // modifier any more: it skips the image, which is the hotter path while labelling.
    if (event.button === 1 || activeTool() === 'pan') {
      panning = true
      lastScreen = { x: event.clientX, y: event.clientY }
      event.preventDefault()
      return
    }
    tool.onPointerDown(toolEvent(event))
  }

  function onPointerMove(event: PointerEvent): void {
    const point = pointFor(event)
    setCursorPosition({ x: point.x, y: point.y })

    if (panning) {
      pan(event.clientX - lastScreen.x, event.clientY - lastScreen.y)
      lastScreen = { x: event.clientX, y: event.clientY }
      return
    }
    tool.onPointerMove(toolEvent(event))
  }

  function onPointerUp(event: PointerEvent): void {
    host?.releasePointerCapture(event.pointerId)
    if (panning) {
      panning = false
      return
    }
    tool.onPointerUp(toolEvent(event))
  }

  function onDoubleClick(event: MouseEvent): void {
    tool.onDoubleClick?.(toolEvent(event))
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault()
    const rect = host!.getBoundingClientRect()
    const anchor = screenPoint(event.clientX - rect.left, event.clientY - rect.top)
    zoom(anchor, event.deltaY < 0 ? 1.15 : 1 / 1.15)
  }

</script>

<div
  bind:this={host}
  bind:clientWidth={containerWidth}
  bind:clientHeight={containerHeight}
  class="viewport"
  style:cursor
  role="application"
  aria-label="canvas"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointerleave={() => {
    setCursorPosition(null)
    setHandleHover(null)
  }}
  ondblclick={onDoubleClick}
  onwheel={onWheel}
  oncontextmenu={(event) => event.preventDefault()}
>
  <div
    class="stage"
    style:width="{width}px"
    style:height="{height}px"
    style:transform="translate({view.offsetX}px, {view.offsetY}px) scale({view.scale})"
  >
    <img src={url} alt="" {width} {height} draggable="false" />
    <svg viewBox="0 0 {width} {height}" {width} {height}>
      <ShapeLayer {shapes} {selected} scale={view.scale} {showLabels} />
      <Overlay
        selected={selectedShape}
        draft={draft()}
        polygonDraft={polygonDraft()}
        cursor={cursorPosition()}
        {hover}
        scale={view.scale}
        image={{ width, height }}
        {showCrosshair}
      />
    </svg>
  </div>
</div>

<style>
  .viewport {
    position: relative;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-canvas);
    touch-action: none;
    outline: none;
    /* A checkerboard makes transparent PNGs and the image edge unambiguous. */
    background-image:
      linear-gradient(45deg, oklch(0% 0 0 / 0.04) 25%, transparent 25%),
      linear-gradient(-45deg, oklch(0% 0 0 / 0.04) 25%, transparent 25%),
      linear-gradient(45deg, transparent 75%, oklch(0% 0 0 / 0.04) 75%),
      linear-gradient(-45deg, transparent 75%, oklch(0% 0 0 / 0.04) 75%);
    background-size: 24px 24px;
    background-position:
      0 0,
      0 12px,
      12px -12px,
      -12px 0;
  }

  .stage {
    position: absolute;
    top: 0;
    left: 0;
    transform-origin: 0 0;
    will-change: transform;
  }

  img {
    display: block;
    width: 100%;
    height: 100%;
    user-select: none;
    -webkit-user-drag: none;
    image-rendering: auto;
  }

  svg {
    position: absolute;
    inset: 0;
    overflow: visible;
  }
</style>
