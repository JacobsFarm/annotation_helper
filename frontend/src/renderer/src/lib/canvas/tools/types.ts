/**
 * One interface for every tool.
 *
 * The predecessor's four tabs each re-implemented image loading, scaling, class lookup
 * and file moves, with slightly different bugs in each copy. Here a tool receives an
 * already-converted image-space point and touches nothing else.
 */

import type { ImagePoint } from '@shared/geometry'
import type { ToolId } from '../../state/tool.svelte'

export interface ToolEvent {
  /** Already in image pixels. No tool ever sees a screen coordinate. */
  point: ImagePoint
  /** Current zoom, for turning a screen-pixel tolerance into an image-pixel one. */
  scale: number
  image: { width: number; height: number }
  shiftKey: boolean
  altKey: boolean
  ctrlKey: boolean
  button: number
}

export interface Tool {
  id: ToolId
  cursor: string
  hintKey: 'annotate_hint_select' | 'annotate_hint_box' | 'annotate_hint_polygon' | 'annotate_hint_pan'
  onPointerDown(event: ToolEvent): void
  onPointerMove(event: ToolEvent): void
  onPointerUp(event: ToolEvent): void
  onDoubleClick?(event: ToolEvent): void
  /** Return true if the key was handled, so the view does not also act on it. */
  onKeyDown?(event: KeyboardEvent): boolean
  cancel(): void
}

/** Screen pixels of slack for grabbing a handle or a vertex. */
export const HIT_TOLERANCE_PX = 8

export function tolerance(scale: number): number {
  return HIT_TOLERANCE_PX / Math.max(scale, 0.0001)
}
