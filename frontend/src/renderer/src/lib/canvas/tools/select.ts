/**
 * Select, move, resize, and edit polygon vertices.
 *
 * Interaction summary, which is also what the hint line says:
 *   click            select the topmost shape under the cursor
 *   drag             move the selected shape
 *   drag a handle    resize a box, or move a polygon vertex
 *   alt-click edge   insert a vertex
 *   alt-click vertex delete that vertex (a polygon keeps at least three)
 *
 * A drag pushes one history entry when it starts, not one per pointer move, so undo
 * steps back over a whole gesture.
 */

import { distanceToSegment } from '@shared/geometry'
import { normaliseBox, shapeContains, translateShape, type Shape } from '@shared/shapes'
import {
  beginHistoryStep,
  select,
  selectedIds,
  shapes,
  updateShape
} from '../../state/annotations.svelte'
import { tolerance, type Tool, type ToolEvent } from './types'

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Drag =
  | { mode: 'move'; id: string; from: { x: number; y: number }; original: Shape }
  | { mode: 'resize'; id: string; handle: BoxHandle; original: Shape }
  | { mode: 'vertex'; id: string; index: number }

let drag: Drag | null = null

export const selectTool: Tool = {
  id: 'select',
  cursor: 'default',
  hintKey: 'annotate_hint_select',

  onPointerDown(event: ToolEvent) {
    if (event.button !== 0) return
    const slack = tolerance(event.scale)
    const list = shapes()
    const selectedId = selectedIds()[0]
    const active = list.find((s) => s.id === selectedId)

    if (active) {
      if (active.kind === 'box') {
        const handle = handleAt(active, event.point, slack)
        if (handle) {
          beginHistoryStep()
          drag = { mode: 'resize', id: active.id, handle, original: active }
          return
        }
      } else {
        const vertex = vertexAt(active, event.point, slack)
        if (vertex >= 0) {
          if (event.altKey) {
            deleteVertex(active, vertex)
            return
          }
          beginHistoryStep()
          drag = { mode: 'vertex', id: active.id, index: vertex }
          return
        }
        if (event.altKey) {
          const edge = edgeAt(active, event.point, slack)
          if (edge >= 0) {
            insertVertex(active, edge, event.point)
            return
          }
        }
      }
    }

    // Topmost first: the last shape drawn is the one on top.
    const hit = [...list].reverse().find((shape) => shapeContains(shape, event.point))
    if (!hit) {
      select(null)
      return
    }
    select(hit.id, event.shiftKey)
    beginHistoryStep()
    drag = { mode: 'move', id: hit.id, from: { x: event.point.x, y: event.point.y }, original: hit }
  },

  onPointerMove(event: ToolEvent) {
    if (!drag) return

    if (drag.mode === 'move') {
      const moved = translateShape(
        drag.original,
        event.point.x - drag.from.x,
        event.point.y - drag.from.y
      )
      updateShape(drag.id, moved, false)
      return
    }

    if (drag.mode === 'resize' && drag.original.kind === 'box') {
      updateShape(drag.id, resizeBox(drag.original, drag.handle, event.point), false)
      return
    }

    if (drag.mode === 'vertex') {
      const shape = shapes().find((s) => s.id === drag!.id)
      if (shape?.kind !== 'polygon') return
      const points = shape.points.map((p, i) =>
        i === (drag as { index: number }).index
          ? ([event.point.x, event.point.y] as [number, number])
          : p
      )
      updateShape(drag.id, { points }, false)
    }
  },

  onPointerUp() {
    if (drag?.mode === 'resize') {
      // Normalise once at the end so a box dragged inside-out still stores top-left first.
      const shape = shapes().find((s) => s.id === drag!.id)
      if (shape?.kind === 'box') updateShape(shape.id, normaliseBox(shape), false)
    }
    drag = null
  },

  cancel() {
    drag = null
  }
}

// --- hit testing ------------------------------------------------------------

export function boxHandles(box: { x1: number; y1: number; x2: number; y2: number }): {
  handle: BoxHandle
  x: number
  y: number
}[] {
  const midX = (box.x1 + box.x2) / 2
  const midY = (box.y1 + box.y2) / 2
  return [
    { handle: 'nw', x: box.x1, y: box.y1 },
    { handle: 'n', x: midX, y: box.y1 },
    { handle: 'ne', x: box.x2, y: box.y1 },
    { handle: 'e', x: box.x2, y: midY },
    { handle: 'se', x: box.x2, y: box.y2 },
    { handle: 's', x: midX, y: box.y2 },
    { handle: 'sw', x: box.x1, y: box.y2 },
    { handle: 'w', x: box.x1, y: midY }
  ]
}

function handleAt(
  shape: Shape,
  point: { x: number; y: number },
  slack: number
): BoxHandle | null {
  if (shape.kind !== 'box') return null
  const box = normaliseBox(shape)
  for (const candidate of boxHandles(box)) {
    if (Math.abs(candidate.x - point.x) <= slack && Math.abs(candidate.y - point.y) <= slack) {
      return candidate.handle
    }
  }
  return null
}

function vertexAt(shape: Shape, point: { x: number; y: number }, slack: number): number {
  if (shape.kind !== 'polygon') return -1
  return shape.points.findIndex(
    ([x, y]) => Math.abs(x - point.x) <= slack && Math.abs(y - point.y) <= slack
  )
}

function edgeAt(shape: Shape, point: { x: number; y: number }, slack: number): number {
  if (shape.kind !== 'polygon') return -1
  for (let i = 0; i < shape.points.length; i++) {
    const a = shape.points[i]!
    const b = shape.points[(i + 1) % shape.points.length]!
    if (distanceToSegment(point, { x: a[0], y: a[1] }, { x: b[0], y: b[1] }) <= slack) return i
  }
  return -1
}

// --- edits ------------------------------------------------------------------

function resizeBox(
  box: Extract<Shape, { kind: 'box' }>,
  handle: BoxHandle,
  point: { x: number; y: number }
): Partial<Shape> {
  const next = { x1: box.x1, y1: box.y1, x2: box.x2, y2: box.y2 }
  if (handle.includes('n')) next.y1 = point.y
  if (handle.includes('s')) next.y2 = point.y
  if (handle.includes('w')) next.x1 = point.x
  if (handle.includes('e')) next.x2 = point.x
  return next
}

function insertVertex(
  shape: Extract<Shape, { kind: 'polygon' }>,
  edge: number,
  point: { x: number; y: number }
): void {
  beginHistoryStep()
  const points = [...shape.points]
  points.splice(edge + 1, 0, [point.x, point.y])
  updateShape(shape.id, { points }, false)
}

function deleteVertex(shape: Extract<Shape, { kind: 'polygon' }>, index: number): void {
  if (shape.points.length <= 3) return
  beginHistoryStep()
  updateShape(shape.id, { points: shape.points.filter((_, i) => i !== index) }, false)
}
