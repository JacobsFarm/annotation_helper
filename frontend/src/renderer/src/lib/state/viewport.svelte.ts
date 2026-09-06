/**
 * Zoom and pan. One object owns `scale` and `offset`; nothing else recomputes either.
 */

import {
  fitViewport,
  panBy,
  zoomAt,
  type ScreenPoint,
  type Size,
  type Viewport
} from '@shared/geometry'

const ZOOM_STEP = 1.2

let view = $state<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 })
let container = $state<Size>({ width: 0, height: 0 })

export function viewport(): Viewport {
  return view
}

export function setContainer(size: Size): void {
  container = size
}

export function containerSize(): Size {
  return container
}

export function fit(image: Size): void {
  view = fitViewport(image, container)
}

/** 1:1 pixels, centred. Useful for judging whether a box is actually tight. */
export function actualSize(image: Size): void {
  view = {
    scale: 1,
    offsetX: (container.width - image.width) / 2,
    offsetY: (container.height - image.height) / 2
  }
}

export function zoom(anchor: ScreenPoint, factor: number): void {
  view = zoomAt(view, anchor, factor)
}

export function zoomStep(direction: 1 | -1): void {
  const centre = { x: container.width / 2, y: container.height / 2 } as ScreenPoint
  view = zoomAt(view, centre, direction > 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
}

export function pan(dx: number, dy: number): void {
  view = panBy(view, dx, dy)
}
