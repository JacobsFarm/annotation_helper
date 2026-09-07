import type { ToolId } from '../../state/tool.svelte'
import { boxTool } from './box'
import { eraseTool } from './erase'
import { panTool } from './pan'
import { polygonTool } from './polygon'
import { selectTool } from './select'
import { smartTool } from './smart'
import type { Tool } from './types'

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  box: boxTool,
  polygon: polygonTool,
  pan: panTool,
  erase: eraseTool,
  smart: smartTool
}

export function toolById(id: ToolId): Tool {
  return TOOLS[id]
}

export type { Tool, ToolEvent } from './types'
