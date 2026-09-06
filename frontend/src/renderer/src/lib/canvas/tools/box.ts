import { newShapeId, type BoxShape } from '@shared/shapes'
import { addShape } from '../../state/annotations.svelte'
import { activeClassId } from '../../state/project.svelte'
import { resetDraft, setDraft } from '../../state/tool.svelte'
import type { Tool, ToolEvent } from './types'

let anchor: { x: number; y: number } | null = null

/** Drag a rectangle. The draft is rubber-banded; the shape is only created on release. */
export const boxTool: Tool = {
  id: 'box',
  cursor: 'crosshair',
  hintKey: 'annotate_hint_box',

  onPointerDown(event: ToolEvent) {
    if (event.button !== 0) return
    anchor = { x: event.point.x, y: event.point.y }
    setDraft({ x1: anchor.x, y1: anchor.y, x2: anchor.x, y2: anchor.y })
  },

  onPointerMove(event: ToolEvent) {
    if (!anchor) return
    setDraft({ x1: anchor.x, y1: anchor.y, x2: event.point.x, y2: event.point.y })
  },

  onPointerUp(event: ToolEvent) {
    if (!anchor) return
    const box: BoxShape = {
      id: newShapeId(),
      kind: 'box',
      classId: activeClassId(),
      source: 'manual',
      x1: Math.min(anchor.x, event.point.x),
      y1: Math.min(anchor.y, event.point.y),
      x2: Math.max(anchor.x, event.point.x),
      y2: Math.max(anchor.y, event.point.y)
    }
    // A box below the minimum size is a mis-click; `addShape` drops it silently.
    addShape(box)
    this.cancel()
  },

  onKeyDown(event: KeyboardEvent) {
    if (event.key === 'Escape' && anchor) {
      boxTool.cancel()
      return true
    }
    return false
  },

  cancel() {
    anchor = null
    resetDraft()
  }
}
