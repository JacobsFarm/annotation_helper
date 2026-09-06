import type { Tool } from './types'

/**
 * A no-op tool.
 *
 * Panning is handled by the canvas itself, because it must work from every tool via the
 * middle mouse button or a held space bar. This entry exists so "pan" can also be a
 * deliberate, sticky choice in the toolbar.
 */
export const panTool: Tool = {
  id: 'pan',
  cursor: 'grab',
  hintKey: 'annotate_hint_pan',
  onPointerDown() {},
  onPointerMove() {},
  onPointerUp() {},
  cancel() {}
}
