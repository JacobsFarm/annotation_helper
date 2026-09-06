/**
 * `annotation.project.json` - one schema, two outputs: the runtime check and the type.
 *
 * Mirrors `backend/src/annotation_helper/project.py`. Both sides are forgiving in the
 * same way: unknown keys are ignored so a newer file still opens in an older build, and
 * every section has a default so a hand-written file may omit whatever it does not care
 * about. Note the `.default({})` on each object - a zod object whose fields all have
 * defaults is still a *required key* without it.
 */

import { z } from 'zod'

export const PROJECT_FILENAME = 'annotation.project.json'
export const STATE_DIRNAME = '.annotation-helper'
export const FORMAT_VERSION = 1

export const DEFAULT_CLASS_COLORS = [
  '#386938', '#c98a1b', '#3b7f8c', '#8c4a3b', '#5d5b8c',
  '#7a8c3b', '#8c3b6e', '#3b558c', '#8c7a3b', '#4a8c6e'
] as const

export const TASKS = ['detect', 'segment', 'both'] as const
export const PIPELINES = ['detect', 'segment', 'detect_then_segment'] as const

export const projectClassSchema = z.object({
  id: z.number().int().min(0),
  name: z.string().min(1),
  color: z.string().default(DEFAULT_CLASS_COLORS[0])
})

export const projectPathsSchema = z
  .object({
    /** The inbox: images wait here until they are annotated, then move to `images`. */
    input: z.string().default('input'),
    images: z.string().default('images'),
    labels: z.string().default('labels'),
    /** The recycle bin: originals and deletions land here, never `unlink`. */
    recycle: z.string().default('recycle'),
    output: z.string().default('dataset')
  })
  .default({})

export const aiSettingsSchema = z
  .object({
    pipeline: z.enum(PIPELINES).default('detect'),
    detectModel: z.string().default(''),
    segmentModel: z.string().default(''),
    confidence: z.number().min(0).max(1).default(0.25),
    iou: z.number().min(0).max(1).default(0.45),
    maxDetections: z.number().int().min(1).default(300),
    expandRatio: z.number().min(0).max(2).default(0.1),
    simplifyTolerance: z.number().min(0).default(1.5)
  })
  .default({})

export const splitSettingsSchema = z
  .object({
    train: z.number().min(0).default(0.8),
    val: z.number().min(0).default(0.15),
    test: z.number().min(0).default(0.05),
    seed: z.number().int().default(1337)
  })
  .default({})

export const trainingSettingsSchema = z
  .object({
    model: z.string().default('yolo11n.pt'),
    epochs: z.number().int().min(1).default(100),
    imgsz: z.number().int().min(32).default(640),
    batch: z.number().int().min(-1).default(16),
    device: z.string().default(''),
    patience: z.number().int().min(0).default(50),
    runName: z.string().default('train')
  })
  .default({})

export const projectSchema = z.object({
  formatVersion: z.number().int().default(FORMAT_VERSION),
  name: z.string().default('Untitled project'),
  task: z.enum(TASKS).default('detect'),
  classes: z.array(projectClassSchema).min(1).default([{ id: 0, name: 'object', color: DEFAULT_CLASS_COLORS[0] }]),
  paths: projectPathsSchema,
  ai: aiSettingsSchema,
  split: splitSettingsSchema,
  training: trainingSettingsSchema
})

export type ProjectClass = z.infer<typeof projectClassSchema>
export type ProjectPaths = z.infer<typeof projectPathsSchema>
export type AiSettings = z.infer<typeof aiSettingsSchema>
export type SplitSettings = z.infer<typeof splitSettingsSchema>
export type TrainingSettings = z.infer<typeof trainingSettingsSchema>
export type ProjectFile = z.infer<typeof projectSchema>

/** A loaded project: the file, plus where it came from. `root` is never in the file. */
export interface Project extends ProjectFile {
  root: string
}

export function defaultProject(name = 'Untitled project'): ProjectFile {
  return projectSchema.parse({ name })
}

/** Names ordered by id with gaps filled, because YOLO indexes classes by position. */
export function classNames(classes: ProjectClass[]): string[] {
  if (classes.length === 0) return []
  const highest = Math.max(...classes.map((c) => c.id))
  const byId = new Map(classes.map((c) => [c.id, c.name]))
  return Array.from({ length: highest + 1 }, (_, i) => byId.get(i) ?? `class_${i}`)
}

export function classById(classes: ProjectClass[], id: number): ProjectClass | undefined {
  return classes.find((c) => c.id === id)
}

export function classColor(classes: ProjectClass[], id: number): string {
  return classById(classes, id)?.color ?? DEFAULT_CLASS_COLORS[id % DEFAULT_CLASS_COLORS.length]!
}

export function nextClassId(classes: ProjectClass[]): number {
  return classes.length === 0 ? 0 : Math.max(...classes.map((c) => c.id)) + 1
}
