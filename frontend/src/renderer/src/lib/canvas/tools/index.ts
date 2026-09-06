import type { ToolId } from '../../state/tool.svelte'
import { boxTool } from './box'
import { panTool } from './pan'
import { polygonTool } from './polygon'
import { selectTool } from './select'
import type { Tool } from './types'

export const TOOLS: Record<ToolId, Tool> = {
  select: selectTool,
  box: boxTool,
  polygon: polygonTool,
  pan: panTool
}

export function toolById(id: ToolId): Tool {
  return TOOLS[id]
}

export type { Tool, ToolEvent } from './types'
