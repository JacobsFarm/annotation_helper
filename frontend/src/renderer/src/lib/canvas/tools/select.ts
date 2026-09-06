/**
 * Select, move, resize, and edit polygon vertices.
 *
 * Interaction summary, which is also what the hint line says:
 *   click             select the topmost shape under the cursor
 *   drag              move the selected shape
 *   drag a handle     resize a box, or move a polygon vertex
 *   drag a midpoint   insert a vertex there and place it in the same gesture
 *   alt-click edge    insert a vertex under the pointer
 *   alt/right-click   on a vertex: delete it (a polygon keeps at least three)
 *   double-click      on a vertex: delete it as well
 *
 * The midpoint dots are what make a rough outline into a tight mask: every edge offers
 * one, so adding detail is a drag rather than a modifier nobody discovers. Hit testing
 * runs vertex first, then midpoint, then edge, then the shape body, so the small target
 * always wins over the large one underneath it.
 *
 * A drag pushes one history entry when it starts, not one per pointer move, so undo
 * steps back over a whole gesture.
 */

import { distance, distanceToSegment } from '@shared/geometry'
import {
  normaliseBox,
  shapeContains,
  translateShape,
  type PolygonShape,
  type Shape
} from '@shared/shapes'
import {
  beginHistoryStep,
  select,
  selectedIds,
  shapes,
  updateShape
} from '../../state/annotations.svelte'
import { setHandleHover } from '../../state/tool.svelte'
import { tolerance, type Tool, type ToolEvent } from './types'

export type BoxHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

type Drag =
  | { mode: 'move'; id: string; from: { x: number; y: number }; original: Shape }
  | { mode: 'resize'; id: string; handle: BoxHandle; original: Shape }
  | { mode: 'vertex'; id: string; index: number }

/** Two vertices closer than this after a drag are the same vertex. In image pixels. */
const MERGE_DISTANCE = 0.75

let drag: Drag | null = null

export const selectTool: Tool = {
  id: 'select',
  cursor: 'default',
  hintKey: 'annotate_hint_select',

  onPointerDown(event: ToolEvent) {
    const slack = tolerance(event.scale)
    const list = shapes()
    const active = list.find((s) => s.id === selectedIds()[0])

    // Right-click on a vertex removes it, so deleting never needs a modifier key.
    if (event.button === 2) {
      if (active?.kind === 'polygon') {
        const vertex = vertexAt(active, event.point, slack)
        if (vertex >= 0) deleteVertex(active, vertex)
      }
      return
    }
    if (event.button !== 0) return

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

        // A midpoint dot, or an alt-click anywhere along an edge, becomes a new vertex
        // that the same gesture then drags into place.
        const midpoint = midpointAt(active, event.point, slack)
        if (midpoint >= 0) {
          const edge = active.points[midpoint]!
          const next = active.points[(midpoint + 1) % active.points.length]!
          const at = { x: (edge[0] + next[0]) / 2, y: (edge[1] + next[1]) / 2 }
          drag = { mode: 'vertex', id: active.id, index: insertVertex(active, midpoint, at) }
          setHandleHover({ kind: 'vertex', index: midpoint + 1 })
          return
        }
        if (event.altKey) {
          const edge = edgeAt(active, event.point, slack)
          if (edge >= 0) {
            drag = { mode: 'vertex', id: active.id, index: insertVertex(active, edge, event.point) }
            setHandleHover({ kind: 'vertex', index: edge + 1 })
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
    // Copied into a local so the narrowing survives the closures below.
    const gesture = drag
    if (!gesture) {
      updateHover(event)
      return
    }

    if (gesture.mode === 'move') {
      const moved = translateShape(
        gesture.original,
        event.point.x - gesture.from.x,
        event.point.y - gesture.from.y
      )
      updateShape(gesture.id, moved, false)
      return
    }

    if (gesture.mode === 'resize' && gesture.original.kind === 'box') {
      updateShape(gesture.id, resizeBox(gesture.original, gesture.handle, event.point), false)
      return
    }

    if (gesture.mode === 'vertex') {
      const shape = shapes().find((s) => s.id === gesture.id)
      if (shape?.kind !== 'polygon') return
      const index = gesture.index
      // Shift snaps the vertex to a horizontal, vertical or 45° line from its previous
      // neighbour, which is what a straight edge along a wall or a table needs.
      const anchor = shape.points[(index - 1 + shape.points.length) % shape.points.length]!
      const target = event.shiftKey
        ? snapToAxis({ x: anchor[0], y: anchor[1] }, event.point)
        : event.point
      const points = shape.points.map((p, i) =>
        i === index ? ([target.x, target.y] as [number, number]) : p
      )
      updateShape(gesture.id, { points }, false)
    }
  },

  onPointerUp() {
    const gesture = drag
    drag = null
    if (!gesture) return
    const shape = shapes().find((s) => s.id === gesture.id)

    // Normalise once at the end so a box dragged inside-out still stores top-left first.
    if (gesture.mode === 'resize' && shape?.kind === 'box') {
      updateShape(shape.id, normaliseBox(shape), false)
    }
    if (gesture.mode === 'vertex' && shape?.kind === 'polygon') {
      mergeCoincident(shape, gesture.index)
    }
  },

  onDoubleClick(event: ToolEvent) {
    const active = shapes().find((s) => s.id === selectedIds()[0])
    if (active?.kind !== 'polygon') return
    const vertex = vertexAt(active, event.point, tolerance(event.scale))
    if (vertex >= 0) deleteVertex(active, vertex)
  },

  cancel() {
    drag = null
    setHandleHover(null)
  }
}

/**
 * Light up whatever the pointer would grab. Only the selected polygon has handles, so
 * everything else clears the hover rather than leaving a stale dot highlighted.
 */
function updateHover(event: ToolEvent): void {
  const active = shapes().find((s) => s.id === selectedIds()[0])
  if (active?.kind !== 'polygon') {
    setHandleHover(null)
    return
  }
  const slack = tolerance(event.scale)
  const vertex = vertexAt(active, event.point, slack)
  if (vertex >= 0) {
    setHandleHover({ kind: 'vertex', index: vertex })
    return
  }
  const midpoint = midpointAt(active, event.point, slack)
  setHandleHover(midpoint >= 0 ? { kind: 'edge', index: midpoint } : null)
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

/**
 * Edge midpoints, in edge order. `minLength` drops the ones on edges too short to aim at:
 * a dense outline would otherwise carry a cloud of dots you cannot hit apart, and the
 * overlay and the hit test pass the same threshold so what you see is what you can grab.
 */
export function edgeMidpoints(
  shape: PolygonShape,
  minLength = 0
): { index: number; x: number; y: number }[] {
  const out: { index: number; x: number; y: number }[] = []
  shape.points.forEach((point, index) => {
    const next = shape.points[(index + 1) % shape.points.length]!
    if (distance({ x: point[0], y: point[1] }, { x: next[0], y: next[1] }) < minLength) return
    out.push({ index, x: (point[0] + next[0]) / 2, y: (point[1] + next[1]) / 2 })
  })
  return out
}

/** How long an edge must be, in multiples of the grab tolerance, to offer a midpoint. */
export const MIDPOINT_MIN_EDGE = 2.5

/**
 * Nearest vertex within `slack`, not the first one within it. On a dense outline several
 * dots overlap at the pointer, and grabbing the wrong one is how a mask gets mangled.
 */
function vertexAt(shape: Shape, point: { x: number; y: number }, slack: number): number {
  if (shape.kind !== 'polygon') return -1
  let best = -1
  let bestDistance = slack
  shape.points.forEach(([x, y], index) => {
    const away = distance({ x, y }, point)
    if (away <= bestDistance) {
      best = index
      bestDistance = away
    }
  })
  return best
}

/**
 * Nearest edge midpoint within `slack`. Midpoints sit half an edge away from the vertices
 * they belong to, so on a short edge they lose to the vertex test that runs first.
 */
function midpointAt(shape: Shape, point: { x: number; y: number }, slack: number): number {
  if (shape.kind !== 'polygon') return -1
  let best = -1
  let bestDistance = slack
  for (const mid of edgeMidpoints(shape, slack * MIDPOINT_MIN_EDGE)) {
    const away = distance({ x: mid.x, y: mid.y }, point)
    if (away <= bestDistance) {
      best = mid.index
      bestDistance = away
    }
  }
  return best
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

/** Adds a vertex after `edge` and returns its index, so the caller can drag it. */
function insertVertex(
  shape: PolygonShape,
  edge: number,
  point: { x: number; y: number }
): number {
  beginHistoryStep()
  const points = [...shape.points]
  points.splice(edge + 1, 0, [point.x, point.y])
  updateShape(shape.id, { points }, false)
  return edge + 1
}

/** A polygon needs three points to be a polygon, so the third-to-last delete is refused. */
function deleteVertex(shape: PolygonShape, index: number): void {
  if (shape.points.length <= 3) return
  beginHistoryStep()
  updateShape(shape.id, { points: shape.points.filter((_, i) => i !== index) }, false)
  setHandleHover(null)
}

/**
 * Drop a vertex that was dragged onto one of its neighbours. Zero-length edges are
 * invisible on screen and survive into the label file, where they are a nuisance to
 * everything downstream, so a merge is the friendlier reading of that gesture.
 */
function mergeCoincident(shape: PolygonShape, index: number): void {
  if (shape.points.length <= 3) return
  const point = shape.points[index]
  if (!point) return
  const previous = shape.points[(index - 1 + shape.points.length) % shape.points.length]!
  const next = shape.points[(index + 1) % shape.points.length]!
  const touches = (other: [number, number]): boolean =>
    distance({ x: point[0], y: point[1] }, { x: other[0], y: other[1] }) < MERGE_DISTANCE
  if (!touches(previous) && !touches(next)) return
  updateShape(shape.id, { points: shape.points.filter((_, i) => i !== index) }, false)
  setHandleHover(null)
}

/** Snap `point` onto the nearest of the eight 45° rays leaving `anchor`. */
function snapToAxis(
  anchor: { x: number; y: number },
  point: { x: number; y: number }
): { x: number; y: number } {
  const dx = point.x - anchor.x
  const dy = point.y - anchor.y
  const angle = (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4
  const length = Math.hypot(dx, dy)
  return { x: anchor.x + Math.cos(angle) * length, y: anchor.y + Math.sin(angle) * length }
}
