/**
 * The eraser: sweep over polygon points to delete them.
 *
 * Right-click deletes one point at a time, which is fine for a hand-drawn outline and
 * hopeless for a predicted mask carrying two hundred of them. This is the same delete,
 * held down: every point under the circle goes, and the whole sweep is one undo step.
 *
 * Two rules keep it from doing damage:
 *   - it stays on the selected polygon for as long as that one has points under the
 *     circle, so a sweep across a crowded mask cannot quietly thin out its neighbour;
 *   - it never erases below three points, because fewer than three is not a polygon. A
 *     sweep that would cross that line removes the points nearest the cursor and stops.
 *
 * Deletion runs along the segment the pointer travelled, not just where it landed. At a
 * normal drag speed the samples are further apart than the circle is wide, and erasing
 * only at the sample points would leave a dotted trail of survivors behind.
 */

import { distanceToSegment, type ImagePoint } from '@shared/geometry'
import type { PolygonShape } from '@shared/shapes'
import {
  beginHistoryStep,
  select,
  selectedIds,
  shapes,
  updateShape
} from '../../state/annotations.svelte'
import { eraserSize } from '../../state/tool.svelte'
import type { Tool, ToolEvent } from './types'

/** A polygon needs three points to be a polygon. */
const MIN_POINTS = 3

let erasing = false
let recorded = false
let previous: ImagePoint | null = null

export const eraseTool: Tool = {
  id: 'erase',
  cursor: 'crosshair',
  hintKey: 'annotate_hint_erase',

  onPointerDown(event: ToolEvent) {
    if (event.button !== 0) return
    erasing = true
    recorded = false
    previous = null
    eraseAt(event)
  },

  onPointerMove(event: ToolEvent) {
    if (!erasing) return
    eraseAt(event)
  },

  onPointerUp() {
    eraseTool.cancel()
  },

  cancel() {
    erasing = false
    recorded = false
    previous = null
  }
}

/** The circle drawn on screen, in image pixels. The overlay divides by the same scale. */
export function eraserRadius(scale: number): number {
  return eraserSize() / 2 / Math.max(scale, 0.0001)
}

function eraseAt(event: ToolEvent): void {
  const radius = eraserRadius(event.scale)
  const from = previous ?? event.point
  previous = event.point

  // Distance to the path the circle swept since the last sample. On the first sample of
  // a stroke that path is a point, which `distanceToSegment` handles as one.
  const away = ([x, y]: [number, number]): number =>
    distanceToSegment({ x, y }, from, event.point)

  const target = targetPolygon(away, radius)
  if (!target) return

  // How near a point is decides both whether it goes and, when the three-point floor
  // bites, which ones go first.
  const covered = target.points
    .map((point, index) => ({ index, away: away(point) }))
    .filter((point) => point.away <= radius)
    .sort((a, b) => a.away - b.away)

  const budget = target.points.length - MIN_POINTS
  if (covered.length === 0 || budget <= 0) return

  const doomed = new Set(covered.slice(0, budget).map((point) => point.index))
  // One history entry per stroke, pushed on the first point that actually goes: a sweep
  // over empty canvas should not cost an undo step.
  if (!recorded) {
    beginHistoryStep()
    recorded = true
  }
  updateShape(
    target.id,
    { points: target.points.filter((_, index) => !doomed.has(index)) },
    false
  )
}

/**
 * The polygon this stroke edits: the selected one whenever it has a point under the
 * circle, so a sweep across a crowded mask never wanders onto its neighbour. Only when
 * the selection has nothing there does the topmost polygon under the circle take over,
 * and it is selected as it does - otherwise the eraser would look broken on every shape
 * except the one that happened to be selected.
 */
function targetPolygon(
  away: (point: [number, number]) => number,
  radius: number
): PolygonShape | null {
  const list = shapes()
  const under = (shape: PolygonShape): boolean => shape.points.some((p) => away(p) <= radius)

  const active = list.find((shape) => shape.id === selectedIds()[0])
  if (active?.kind === 'polygon' && under(active)) return active

  const hit = [...list]
    .reverse()
    .find((shape): shape is PolygonShape => shape.kind === 'polygon' && under(shape))
  if (hit && hit.id !== active?.id) select(hit.id)
  return hit ?? null
}
