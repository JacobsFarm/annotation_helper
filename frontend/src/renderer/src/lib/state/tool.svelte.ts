/**
 * Which tool is active, and whatever it is part-way through drawing.
 *
 * The draft lives here rather than inside a tool object so the overlay can render it
 * reactively without knowing which tool produced it. Adding a keypoint or polyline tool
 * later is a new file in `canvas/tools/`, not a new tab and not a new state store.
 */

import { clamp } from '@shared/geometry'

export type ToolId = 'select' | 'box' | 'polygon' | 'pan' | 'erase' | 'smart'

export interface DraftBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * What the pointer is over on the selected shape, so the overlay can light it up before
 * the click lands. `vertex` is an existing point; `edge` is the midpoint dot that turns
 * into a new point when pressed; `close` is the first vertex of a polygon draft, which
 * finishes the shape.
 */
export interface HandleHover {
  kind: 'vertex' | 'edge' | 'close'
  index: number
}

let active = $state<ToolId>('box')
let draftBox = $state<DraftBox | null>(null)
let draftPoints = $state<[number, number][]>([])
let cursor = $state<{ x: number; y: number } | null>(null)
let hover = $state<HandleHover | null>(null)

export function activeTool(): ToolId {
  return active
}

export function setActiveTool(id: ToolId): void {
  if (id !== active) resetDraft()
  active = id
}

export function draft(): DraftBox | null {
  return draftBox
}

export function setDraft(next: DraftBox | null): void {
  draftBox = next
}

export function polygonDraft(): [number, number][] {
  return draftPoints
}

export function setPolygonDraft(points: [number, number][]): void {
  draftPoints = points
}

export function cursorPosition(): { x: number; y: number } | null {
  return cursor
}

export function setCursorPosition(point: { x: number; y: number } | null): void {
  cursor = point
}

export function handleHover(): HandleHover | null {
  return hover
}

export function setHandleHover(next: HandleHover | null): void {
  // Compared field by field: the pointer moves far more often than the handle under it
  // changes, and an equal object would re-render the overlay on every mouse move.
  if (next?.kind === hover?.kind && next?.index === hover?.index) return
  hover = next
}

// --- click-to-segment ---------------------------------------------------------
//
// The clicks and the mask they produced. Both live here rather than inside the tool for
// the same reason the polygon draft does: the overlay renders them without knowing which
// tool put them there.

export interface SmartPoint {
  x: number
  y: number
  /** false is a "not this" click: the background the mask wrongly swallowed. */
  positive: boolean
}

let smartPoints = $state<SmartPoint[]>([])
/**
 * The mask, as one ring per disjoint part. A weed in grass is one plant and five
 * visible pieces of leaf, and a single ring around all of them would have to cut
 * straight across the grass in between.
 */
let smartMask = $state<[number, number][][]>([])
let smartBusy = $state(false)

export function smartClicks(): SmartPoint[] {
  return smartPoints
}

export function setSmartClicks(next: SmartPoint[]): void {
  smartPoints = next
}

export function smartPreview(): [number, number][][] {
  return smartMask
}

export function setSmartPreview(rings: [number, number][][]): void {
  smartMask = rings
}

export function isSmartBusy(): boolean {
  return smartBusy
}

export function setSmartBusy(busy: boolean): void {
  smartBusy = busy
}

export function clearSmart(): void {
  smartPoints = []
  smartMask = []
}

// --- the eraser ---------------------------------------------------------------
//
// Its size is the diameter, in *screen* pixels, the way a brush size reads in an image
// editor. Screen rather than image pixels because it is a pointing aid: the circle keeps
// the same size under the hand at every zoom level, exactly like the grab tolerance in
// `canvas/tools/types.ts`. The size lives here, next to the active tool, so the toolbar
// panel, the overlay circle and the tool itself all read one number.

export const ERASER_MIN = 4
export const ERASER_MAX = 400

let eraser = $state(40)

export function eraserSize(): number {
  return eraser
}

export function setEraserSize(px: number): void {
  eraser = Math.round(clamp(px, ERASER_MIN, ERASER_MAX))
}

/**
 * One press of `[` or `]`. The step grows with the size, so shrinking a big eraser does
 * not take twenty presses and a small one still lands on the pixel you want.
 */
export function stepEraserSize(direction: number): void {
  const step = eraser < 20 ? 2 : eraser < 60 ? 5 : eraser < 150 ? 10 : 25
  setEraserSize(eraser + step * Math.sign(direction))
}

export function resetDraft(): void {
  draftBox = null
  draftPoints = []
  hover = null
  clearSmart()
}

export function hasDraft(): boolean {
  return draftBox !== null || draftPoints.length > 0 || smartPoints.length > 0
}
