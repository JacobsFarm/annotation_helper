/**
 * The image list and where we are in it.
 *
 * The list is sorted once, in the main process, so "next image" means the same thing on
 * every machine and after every rescan.
 */

import type { DatasetEntry, DatasetSummary } from '@shared/ipc'
import { kindFromCounts } from '@shared/shapes'
import { api, safeCall } from '../api'

/**
 * `boxes` and `polygons` are not two more ways to say "done": they are the two halves
 * of the work that train different things, and an image can only be in one of them.
 */
export type DatasetFilter = 'all' | 'todo' | 'done' | 'boxes' | 'polygons'

const EMPTY: DatasetSummary = {
  total: 0,
  pending: 0,
  labelled: 0,
  backgrounds: 0,
  shapes: 0,
  boxImages: 0,
  polygonImages: 0,
  mixedImages: 0
}

let entries = $state<DatasetEntry[]>([])
let summary = $state<DatasetSummary>({ ...EMPTY })
let index = $state(0)
let filter = $state<DatasetFilter>('all')
let query = $state('')
let loading = $state(false)

export function allEntries(): DatasetEntry[] {
  return entries
}

export function datasetSummary(): DatasetSummary {
  return summary
}

export function isLoading(): boolean {
  return loading
}

export function datasetFilter(): DatasetFilter {
  return filter
}

export function setFilter(next: DatasetFilter): void {
  filter = next
}

export function searchQuery(): string {
  return query
}

export function setSearchQuery(next: string): void {
  query = next
}

/** The list the sidebar shows. Navigation always walks this, never the raw list. */
export function visibleEntries(): DatasetEntry[] {
  const needle = query.trim().toLowerCase()
  return entries.filter((entry) => {
    if (filter === 'todo' && entry.labelled) return false
    if (filter === 'done' && !entry.labelled) return false
    // Mixed shows under both: it holds boxes and polygons, and that is the point.
    if (filter === 'boxes' && entry.boxCount === 0) return false
    if (filter === 'polygons' && entry.polygonCount === 0) return false
    return needle === '' || entry.file.toLowerCase().includes(needle)
  })
}

export function currentIndex(): number {
  return index
}

export function currentEntry(): DatasetEntry | null {
  return visibleEntries()[index] ?? null
}

export function total(): number {
  return visibleEntries().length
}

export function goTo(next: number): void {
  const size = visibleEntries().length
  if (size === 0) {
    index = 0
    return
  }
  index = Math.min(Math.max(next, 0), size - 1)
}

export function goToFile(file: string): void {
  const position = visibleEntries().findIndex((e) => e.file === file)
  if (position >= 0) index = position
}

export function step(delta: number): void {
  goTo(index + delta)
}

export async function loadDataset(root: string): Promise<void> {
  loading = true
  const result = await safeCall(() => api.dataset.list(root))
  loading = false
  if (!result) return

  const previous = currentEntry()?.file
  entries = result.entries
  summary = result.summary
  if (previous) goToFile(previous)
  else goTo(index)
}

/**
 * Update one row after a save, without a full rescan.
 *
 * Rescanning a large project on every save would make annotating unusable, and the facts
 * that can change here are exactly these. `moved` carries the image's new home: saving
 * is what promotes it out of the inbox, and the `ah-img://` URL of the old location
 * stops resolving the moment it does.
 */
export function markEntry(
  file: string,
  counts: { boxes: number; polygons: number },
  moved?: Pick<DatasetEntry, 'file' | 'area' | 'url'>
): void {
  const kind = kindFromCounts(counts.boxes, counts.polygons, true)
  entries = entries.map((entry) =>
    entry.file === file
      ? {
          ...entry,
          ...moved,
          labelled: true,
          shapeCount: counts.boxes + counts.polygons,
          boxCount: counts.boxes,
          polygonCount: counts.polygons,
          kind
        }
      : entry
  )
  summary = {
    total: entries.length,
    pending: entries.filter((e) => e.area === 'input').length,
    labelled: entries.filter((e) => e.labelled).length,
    backgrounds: entries.filter((e) => e.kind === 'background').length,
    shapes: entries.reduce((sum, e) => sum + e.shapeCount, 0),
    boxImages: entries.filter((e) => e.kind === 'box').length,
    polygonImages: entries.filter((e) => e.kind === 'polygon').length,
    mixedImages: entries.filter((e) => e.kind === 'mixed').length
  }
}

export function removeEntry(file: string): void {
  entries = entries.filter((e) => e.file !== file)
  goTo(index)
}

export function resetDataset(): void {
  entries = []
  summary = { ...EMPTY }
  index = 0
}
