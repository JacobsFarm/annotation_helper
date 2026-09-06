/**
 * Coordinate spaces, made unmixable by the type system.
 *
 * The predecessor's most visible bug was one character: a box's `y2` was computed with
 * the horizontal offset, so every predicted box rendered skewed. The saved numbers were
 * fine, which is why it survived for so long. That is not a typo, it is a missing type.
 *
 * Two rules follow, and this module exists to enforce both:
 *
 * 1. Coordinates are **image pixels** everywhere in memory. Normalisation to YOLO's
 *    0-1 range happens in exactly one place, at write time, in `label-io.ts`.
 * 2. One `Viewport` owns `scale` and `offset`. Nothing else recomputes either.
 */

declare const spaceBrand: unique symbol

type InSpace<S extends string> = { readonly [spaceBrand]: S; x: number; y: number }

/** A point in image pixels: what is stored, saved and reasoned about. */
export type ImagePoint = InSpace<'image'>

/** A point in CSS pixels relative to the canvas element: what a pointer event gives. */
export type ScreenPoint = InSpace<'screen'>

export function imagePoint(x: number, y: number): ImagePoint {
  return { x, y } as ImagePoint
}

export function screenPoint(x: number, y: number): ScreenPoint {
  return { x, y } as ScreenPoint
}

/**
 * The single transform between the two spaces.
 *
 * `offset` is where the image's top-left corner sits on screen, in screen pixels.
 */
export interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

export const IDENTITY_VIEWPORT: Viewport = { scale: 1, offsetX: 0, offsetY: 0 }

export function toScreen(point: ImagePoint, view: Viewport): ScreenPoint {
  return screenPoint(point.x * view.scale + view.offsetX, point.y * view.scale + view.offsetY)
}

export function toImage(point: ScreenPoint, view: Viewport): ImagePoint {
  return imagePoint((point.x - view.offsetX) / view.scale, (point.y - view.offsetY) / view.scale)
}

/** Screen pixels -> image pixels, for lengths rather than positions (no offset). */
export function screenToImageLength(length: number, view: Viewport): number {
  return length / view.scale
}

export interface Size {
  width: number
  height: number
}

/**
 * Scale and centre an image inside a viewport.
 *
 * `padding` is applied once, here. The predecessor recomputed scaling in three separate
 * canvases with three slightly different `* 0.95` fudges.
 */
export function fitViewport(image: Size, container: Size, padding = 24): Viewport {
  if (image.width <= 0 || image.height <= 0 || container.width <= 0 || container.height <= 0) {
    return { ...IDENTITY_VIEWPORT }
  }
  const available = {
    width: Math.max(container.width - padding * 2, 1),
    height: Math.max(container.height - padding * 2, 1)
  }
  const scale = Math.min(available.width / image.width, available.height / image.height)
  return {
    scale,
    offsetX: (container.width - image.width * scale) / 2,
    offsetY: (container.height - image.height * scale) / 2
  }
}

/** Zoom around a fixed screen point, so the pixel under the cursor stays put. */
export function zoomAt(
  view: Viewport,
  anchor: ScreenPoint,
  factor: number,
  limits: { min: number; max: number } = { min: 0.02, max: 40 }
): Viewport {
  const scale = clamp(view.scale * factor, limits.min, limits.max)
  const ratio = scale / view.scale
  return {
    scale,
    offsetX: anchor.x - (anchor.x - view.offsetX) * ratio,
    offsetY: anchor.y - (anchor.y - view.offsetY) * ratio
  }
}

export function panBy(view: Viewport, dx: number, dy: number): Viewport {
  return { scale: view.scale, offsetX: view.offsetX + dx, offsetY: view.offsetY + dy }
}

export function clamp(value: number, low: number, high: number): number {
  return value < low ? low : value > high ? high : value
}

export function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Shortest distance from `point` to the segment `a`-`b`. Used for "insert vertex on edge". */
export function distanceToSegment(
  point: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  if (lengthSquared === 0) return distance(point, a)
  const t = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared, 0, 1)
  return distance(point, { x: a.x + t * dx, y: a.y + t * dy })
}

export function pointInPolygon(point: { x: number; y: number }, points: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const pi = points[i]!
    const pj = points[j]!
    const intersects =
      pi[1] > point.y !== pj[1] > point.y &&
      point.x < ((pj[0] - pi[0]) * (point.y - pi[1])) / (pj[1] - pi[1]) + pi[0]
    if (intersects) inside = !inside
  }
  return inside
}

export function polygonArea(points: [number, number][]): number {
  if (points.length < 3) return 0
  let total = 0
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i]!
    const [x2, y2] = points[(i + 1) % points.length]!
    total += x1 * y2 - x2 * y1
  }
  return Math.abs(total) / 2
}
