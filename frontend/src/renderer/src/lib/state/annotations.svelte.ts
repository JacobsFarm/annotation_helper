/**
 * The annotation being edited: shapes, selection, dirty state and undo.
 *
 * Two separate undo stacks exist in this app, deliberately:
 *   - this one, for shape edits on the open image (in memory, cheap, Ctrl+Z),
 *   - the journal in the main process, for file moves and deletes (on disk, survives a
 *     restart, reachable from the Dataset screen).
 * The predecessor had only the first kind and called it undo, which is why deleting an
 * image was unrecoverable.
 */

import type { ImageAnnotation, Shape } from '@shared/shapes'
import { clampShape, countShapeKinds, isDegenerate } from '@shared/shapes'
import { api, safeCall } from '../api'
import { t } from '../i18n/index.svelte'
import { markEntry } from './dataset.svelte'
import { pushToast } from './toast.svelte'

const HISTORY_LIMIT = 60

let annotation = $state<ImageAnnotation | null>(null)
let selected = $state<string[]>([])
let dirty = $state(false)
let saving = $state(false)

/**
 * Whether the *user* changed anything since this image was loaded.
 *
 * Apart from `dirty`, because a prediction dirties the annotation without anyone having
 * decided anything: it is a suggestion until it is saved. Moving to the next image
 * throws unsaved work away by design, so this is what decides whether there was any
 * work to warn about.
 */
let touched = $state(false)

let past: Shape[][] = []
let future: Shape[][] = []

/**
 * Bumped on every load, so a slow prediction can tell whether the image it was asked
 * for is still the one on screen. Saving deliberately does not bump it: a save can
 * promote the file out of the inbox and rename it, and that is still the same image.
 */
let generation = 0

export function current(): ImageAnnotation | null {
  return annotation
}

export function shapes(): Shape[] {
  return annotation?.shapes ?? []
}

export function selectedIds(): string[] {
  return selected
}

export function selectedShapes(): Shape[] {
  return shapes().filter((s) => selected.includes(s.id))
}

export function isDirty(): boolean {
  return dirty
}

export function hasManualEdits(): boolean {
  return touched
}

export function isSaving(): boolean {
  return saving
}

export function canUndo(): boolean {
  return past.length > 0
}

export function canRedo(): boolean {
  return future.length > 0
}

export function annotationGeneration(): number {
  return generation
}

// --- loading ----------------------------------------------------------------

export async function loadAnnotation(root: string, file: string): Promise<void> {
  const loaded = await safeCall(() => api.labels.read({ root, file }))
  annotation = loaded
  selected = []
  dirty = false
  touched = false
  past = []
  future = []
  generation += 1
}

export function clearAnnotation(): void {
  annotation = null
  selected = []
  dirty = false
  touched = false
  past = []
  future = []
  generation += 1
}

// --- editing ----------------------------------------------------------------

/**
 * Every mutation goes through here, so history and the dirty flag can never be
 * bypassed by accident. `record: false` is for continuous drags, which push one history
 * entry at the start rather than one per pointer move.
 */
function mutate(next: Shape[], record = true, by: 'user' | 'model' = 'user'): void {
  if (!annotation) return
  if (record) {
    past = [...past.slice(-HISTORY_LIMIT + 1), annotation.shapes]
    future = []
  }
  annotation = { ...annotation, shapes: next }
  dirty = true
  if (by === 'user') touched = true
}

export function beginHistoryStep(): void {
  if (!annotation) return
  past = [...past.slice(-HISTORY_LIMIT + 1), annotation.shapes]
  future = []
}

export function addShape(shape: Shape): void {
  if (!annotation || isDegenerate(shape)) return
  const clamped = clampShape(shape, annotation.width, annotation.height)
  mutate([...annotation.shapes, clamped])
  selected = [clamped.id]
}

export function updateShape(id: string, patch: Partial<Shape>, record = true): void {
  if (!annotation) return
  const next = annotation.shapes.map((shape) =>
    shape.id === id
      ? clampShape({ ...shape, ...patch } as Shape, annotation!.width, annotation!.height)
      : shape
  )
  mutate(next, record)
}

export function replaceShapes(next: Shape[]): void {
  mutate(next)
}

export function removeSelected(): void {
  if (!annotation || selected.length === 0) return
  mutate(annotation.shapes.filter((s) => !selected.includes(s.id)))
  selected = []
}

export function removeShape(id: string): void {
  if (!annotation) return
  mutate(annotation.shapes.filter((s) => s.id !== id))
  selected = selected.filter((s) => s !== id)
}

export function removePredicted(): void {
  if (!annotation) return
  mutate(annotation.shapes.filter((s) => s.source !== 'ai'))
  selected = []
}

/** Predicted shapes are appended, never substituted: manual work always survives. */
export function addPredicted(predicted: Shape[]): void {
  if (!annotation) return
  const kept = predicted
    .filter((s) => !isDegenerate(s))
    .map((s) => clampShape(s, annotation!.width, annotation!.height))
  mutate([...annotation.shapes, ...kept], true, 'model')
  selected = []
}

export function setClassOfSelected(classId: number): void {
  if (!annotation || selected.length === 0) return
  mutate(
    annotation.shapes.map((s) => (selected.includes(s.id) ? { ...s, classId } : s))
  )
}

// --- selection --------------------------------------------------------------

export function select(id: string | null, additive = false): void {
  if (id === null) selected = []
  else if (additive) selected = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]
  else selected = [id]
}

export function selectAll(): void {
  selected = shapes().map((s) => s.id)
}

// --- history ----------------------------------------------------------------

export function undo(): void {
  if (!annotation || past.length === 0) return
  const previous = past[past.length - 1]!
  past = past.slice(0, -1)
  future = [annotation.shapes, ...future]
  annotation = { ...annotation, shapes: previous }
  selected = []
  dirty = true
  touched = true
}

export function redo(): void {
  if (!annotation || future.length === 0) return
  const next = future[0]!
  future = future.slice(1)
  past = [...past, annotation.shapes]
  annotation = { ...annotation, shapes: next }
  selected = []
  dirty = true
  touched = true
}

// --- saving -----------------------------------------------------------------

/**
 * Write the label file. This is also what moves the image out of the inbox, so the
 * result says where it ended up and the in-memory annotation follows it - a rename
 * during the move would otherwise leave this pointing at a file that no longer exists.
 */
export async function saveAnnotation(root: string, quiet = false): Promise<boolean> {
  if (!annotation) return false
  const was = annotation.imageFile
  saving = true
  const result = await safeCall(() =>
    api.labels.write({ root, annotation: { ...annotation!, reviewed: true } })
  )
  saving = false
  if (!result) return false

  dirty = false
  touched = false
  annotation = { ...annotation, imageFile: result.imageFile, reviewed: true }
  markEntry(was, countShapeKinds(annotation.shapes), {
    file: result.imageFile,
    area: result.area,
    url: result.url
  })
  if (!quiet) pushToast('success', t('common_saved'))
  return true
}

/**
 * Save an empty label file on purpose: "verified background", not "not done yet".
 * That distinction is training-relevant, and the predecessor had no way to express it.
 */
export async function saveAsBackground(root: string): Promise<boolean> {
  if (!annotation) return false
  mutate([])
  return saveAnnotation(root)
}
