import { clamp, distance } from '@shared/geometry'
import { newShapeId, type PolygonShape } from '@shared/shapes'
import { addShape } from '../../state/annotations.svelte'
import { activeClassId } from '../../state/project.svelte'
import {
  polygonDraft,
  resetDraft,
  setHandleHover,
  setPolygonDraft
} from '../../state/tool.svelte'
import { tolerance, type Tool, type ToolEvent } from './types'

/**
 * Click to place vertices; Enter, double-click, or a click back on the first point
 * closes the polygon. Backspace removes the last vertex, Esc abandons the whole draft.
 *
 * Two guards keep a traced outline clean: points are clamped to the image, and a click
 * that lands on the previous point is ignored rather than stored twice - otherwise the
 * first half of a double-click adds a vertex the second half then closes over.
 */
export const polygonTool: Tool = {
  id: 'polygon',
  cursor: 'crosshair',
  hintKey: 'annotate_hint_polygon',

  onPointerDown(event: ToolEvent) {
    if (event.button === 2) {
      // Right-click takes back the last point, so correcting never leaves the canvas.
      const points = polygonDraft()
      if (points.length > 0) setPolygonDraft(points.slice(0, -1))
      return
    }
    if (event.button !== 0) return

    const points = polygonDraft()
    const slack = tolerance(event.scale)
    const first = points[0]
    const last = points[points.length - 1]

    if (first && points.length >= 3 && distance({ x: first[0], y: first[1] }, event.point) < slack) {
      commit()
      return
    }
    if (last && distance({ x: last[0], y: last[1] }, event.point) < slack) return

    const x = clamp(event.point.x, 0, event.image.width)
    const y = clamp(event.point.y, 0, event.image.height)
    setPolygonDraft([...points, [x, y]])
  },

  onPointerMove(event: ToolEvent) {
    // The rubber-band segment to the cursor is drawn by the overlay from the shared
    // cursor position. The only thing tracked here is whether releasing now would close
    // the ring, so the overlay can grow the first dot instead of leaving you guessing.
    const points = polygonDraft()
    const first = points[0]
    const closes =
      !!first &&
      points.length >= 3 &&
      distance({ x: first[0], y: first[1] }, event.point) < tolerance(event.scale)
    setHandleHover(closes ? { kind: 'close', index: 0 } : null)
  },

  onPointerUp() {
    // A polygon is built from clicks, not drags.
  },

  onDoubleClick() {
    commit()
  },

  onKeyDown(event: KeyboardEvent) {
    const points = polygonDraft()
    if (points.length === 0) return false

    if (event.key === 'Enter') {
      commit()
      return true
    }
    if (event.key === 'Escape') {
      polygonTool.cancel()
      return true
    }
    if (event.key === 'Backspace') {
      setPolygonDraft(points.slice(0, -1))
      return true
    }
    return false
  },

  cancel() {
    resetDraft()
  }
}

/** Two draft points closer than this are one point. In image pixels. */
const MIN_SEGMENT = 0.75

function commit(): void {
  const points = withoutDuplicates(polygonDraft())
  if (points.length >= 3) {
    const polygon: PolygonShape = {
      id: newShapeId(),
      kind: 'polygon',
      classId: activeClassId(),
      source: 'manual',
      points
    }
    addShape(polygon)
  }
  resetDraft()
}

/** Drop zero-length edges, including the closing one between the last and first point. */
function withoutDuplicates(points: [number, number][]): [number, number][] {
  const kept: [number, number][] = []
  for (const [x, y] of points) {
    const previous = kept[kept.length - 1]
    if (previous && distance({ x: previous[0], y: previous[1] }, { x, y }) < MIN_SEGMENT) continue
    kept.push([x, y])
  }
  const first = kept[0]
  const last = kept[kept.length - 1]
  if (kept.length > 3 && first && last && distance({ x: first[0], y: first[1] }, { x: last[0], y: last[1] }) < MIN_SEGMENT) {
    kept.pop()
  }
  return kept
}
