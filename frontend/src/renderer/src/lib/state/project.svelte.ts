/**
 * The open project: its settings, its classes, and which class new shapes get.
 *
 * Saving writes `annotation.project.json`, `classes.txt` and `data.yaml` together, so
 * the folder never drifts out of step with what other YOLO tools would read.
 */

import type { Project, ProjectClass, ProjectFile } from '@shared/project'
import { DEFAULT_CLASS_COLORS, classColor, nextClassId } from '@shared/project'
import { api, safeCall } from '../api'

let current = $state<Project | null>(null)
let activeClass = $state(0)

export function project(): Project | null {
  return current
}

export function requireProject(): Project {
  if (!current) throw new Error('no project open')
  return current
}

export function isOpen(): boolean {
  return current !== null
}

export function classes(): ProjectClass[] {
  return current?.classes ?? []
}

export function activeClassId(): number {
  return activeClass
}

export function setActiveClass(id: number): void {
  activeClass = id
}

export function colorFor(classId: number): string {
  return classColor(classes(), classId)
}

export function nameFor(classId: number): string {
  return classes().find((c) => c.id === classId)?.name ?? `class_${classId}`
}

export async function openProject(root: string): Promise<Project | null> {
  const opened = await safeCall(() => api.project.open(root))
  if (opened) adopt(opened)
  return opened
}

export async function createProject(input: {
  root: string
  name: string
  task: ProjectFile['task']
}): Promise<Project | null> {
  const created = await safeCall(() => api.project.create(input))
  if (created) adopt(created)
  return created
}

export function closeProject(): void {
  current = null
}

function adopt(next: Project): void {
  current = next
  activeClass = next.classes[0]?.id ?? 0
}

/** Patch the project in memory and persist it. Returns false if the write failed. */
export async function patchProject(patch: Partial<ProjectFile>): Promise<boolean> {
  if (!current) return false
  const next = { ...current, ...patch }
  const saved = await safeCall(() => api.project.save(next))
  if (!saved) return false
  current = saved
  if (!saved.classes.some((c) => c.id === activeClass)) {
    activeClass = saved.classes[0]?.id ?? 0
  }
  return true
}

export async function addClass(name: string): Promise<boolean> {
  if (!current) return false
  const id = nextClassId(current.classes)
  const color = DEFAULT_CLASS_COLORS[id % DEFAULT_CLASS_COLORS.length]!
  return patchProject({ classes: [...current.classes, { id, name, color }] })
}

export async function updateClass(id: number, patch: Partial<ProjectClass>): Promise<boolean> {
  if (!current) return false
  return patchProject({
    classes: current.classes.map((c) => (c.id === id ? { ...c, ...patch } : c))
  })
}

/**
 * Removing a class does not renumber the others.
 *
 * Class ids are written into every label file; shifting them would silently re-label
 * the whole dataset. A gap in the numbering is harmless - `classNames()` fills it.
 */
export async function removeClass(id: number): Promise<boolean> {
  if (!current || current.classes.length <= 1) return false
  return patchProject({ classes: current.classes.filter((c) => c.id !== id) })
}
