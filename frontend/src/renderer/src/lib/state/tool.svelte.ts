/**
 * Which tool is active, and whatever it is part-way through drawing.
 *
 * The draft lives here rather than inside a tool object so the overlay can render it
 * reactively without knowing which tool produced it. Adding a keypoint or polyline tool
 * later is a new file in `canvas/tools/`, not a new tab and not a new state store.
 */

export type ToolId = 'select' | 'box' | 'polygon' | 'pan'

export interface DraftBox {
  x1: number
  y1: number
  x2: number
  y2: number
}

let active = $state<ToolId>('box')
let draftBox = $state<DraftBox | null>(null)
let draftPoints = $state<[number, number][]>([])
let cursor = $state<{ x: number; y: number } | null>(null)

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

export function resetDraft(): void {
  draftBox = null
  draftPoints = []
}

export function hasDraft(): boolean {
  return draftBox !== null || draftPoints.length > 0
}
