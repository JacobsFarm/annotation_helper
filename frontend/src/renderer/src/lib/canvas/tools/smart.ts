/**
 * Click-to-segment: point at a flower, get the flower.
 *
 * The mask comes from SAM in the Python sidecar, prompted by clicks rather than by a
 * trained class list - which is why this works on the first image of a new project,
 * before any model of your own exists.
 *
 *   left click     this is part of the object
 *   right click    this is not (the background the mask swallowed)
 *   Backspace      take the last click back
 *   Enter, or a double click, or the ✓ button   keep the mask as a polygon
 *   Esc            throw the whole selection away
 *
 * Every click re-asks with the *whole* set of clicks, so correcting is additive: a wrong
 * mask is fixed by pointing at what is wrong with it, never by starting over. That is
 * also why the shape is only added on accept - a half-corrected mask has no business in
 * the label file, and an image you page past leaves nothing behind.
 */

import { newShapeId, type PolygonShape } from '@shared/shapes'
import { addShape } from '../../state/annotations.svelte'
import { refineSmartSelection } from '../../state/ai.svelte'
import { activeClassId } from '../../state/project.svelte'
import { clearSmart, setSmartClicks, smartClicks, smartPreview } from '../../state/tool.svelte'
import type { Tool, ToolEvent } from './types'

export const smartTool: Tool = {
  id: 'smart',
  cursor: 'crosshair',
  hintKey: 'annotate_hint_smart',

  onPointerDown(event: ToolEvent) {
    // Alt does what the right button does, for a trackpad and for anyone whose right
    // click is spoken for.
    const positive = event.button === 0 && !event.altKey
    if (event.button !== 0 && event.button !== 2) return

    const clicks = smartClicks()
    // "Not this" needs a "this" to take it away from. Without one there is no mask yet,
    // and SAM would be asked to segment the absence of something.
    if (!positive && !clicks.some((click) => click.positive)) return

    setSmartClicks([...clicks, { x: event.point.x, y: event.point.y, positive }])
    void refineSmartSelection()
  },

  onPointerMove() {
    // Nothing to track: this tool is clicks, not a drag.
  },

  onPointerUp() {},

  onDoubleClick() {
    // The second half of the double click already added a point and asked again, which
    // is harmless: accepting uses the mask that is on screen.
    commit()
  },

  onKeyDown(event: KeyboardEvent) {
    if (smartClicks().length === 0) return false

    if (event.key === 'Enter') {
      commit()
      return true
    }
    if (event.key === 'Escape') {
      clearSmart()
      return true
    }
    if (event.key === 'Backspace') {
      const kept = smartClicks().slice(0, -1)
      setSmartClicks(kept)
      if (kept.length === 0) clearSmart()
      else void refineSmartSelection()
      return true
    }
    return false
  },

  cancel() {
    clearSmart()
  }
}

/**
 * Turn the preview into real shapes. Exported so a button can do it too.
 *
 * One shape per part of the mask: a YOLO polygon is a single ring, so a plant the grass
 * cuts into pieces becomes one polygon per piece, all in the active class. Deleting the
 * pieces you did not want is one click each in the shape list; there is no way to write
 * them as one instance, and joining them would mean drawing a line through the grass.
 */
export function commit(): void {
  const rings = smartPreview().filter((ring) => ring.length >= 3)
  for (const ring of rings) {
    const polygon: PolygonShape = {
      id: newShapeId(),
      kind: 'polygon',
      classId: activeClassId(),
      // Manual on purpose: a model drew it, but you pointed at it and accepted it. It is
      // not a suggestion any more, and "remove predictions" must not sweep it away.
      source: 'manual',
      points: ring.map(([x, y]) => [x, y] as [number, number])
    }
    addShape(polygon)
  }
  clearSmart()
}
