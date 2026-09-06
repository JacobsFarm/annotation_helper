import { distance } from '@shared/geometry'
import { newShapeId, type PolygonShape } from '@shared/shapes'
import { addShape } from '../../state/annotations.svelte'
import { activeClassId } from '../../state/project.svelte'
import { polygonDraft, resetDraft, setPolygonDraft } from '../../state/tool.svelte'
import { tolerance, type Tool, type ToolEvent } from './types'

/**
 * Click to place vertices; Enter, double-click, or a click back on the first point
 * closes the polygon. Backspace removes the last vertex, Esc abandons the whole draft.
 */
export const polygonTool: Tool = {
  id: 'polygon',
  cursor: 'crosshair',
  hintKey: 'annotate_hint_polygon',

  onPointerDown(event: ToolEvent) {
    if (event.button !== 0) return
    const points = polygonDraft()
    const first = points[0]

    if (first && points.length >= 3 && distance({ x: first[0], y: first[1] }, event.point) < tolerance(event.scale)) {
      commit()
      return
    }
    setPolygonDraft([...points, [event.point.x, event.point.y]])
  },

  onPointerMove() {
    // The rubber-band segment to the cursor is drawn by the overlay from the shared
    // cursor position, so there is nothing to track here.
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

function commit(): void {
  const points = polygonDraft()
  if (points.length >= 3) {
    const polygon: PolygonShape = {
      id: newShapeId(),
      kind: 'polygon',
      classId: activeClassId(),
      source: 'manual',
      points: points.map(([x, y]) => [x, y] as [number, number])
    }
    addShape(polygon)
  }
  resetDraft()
}
