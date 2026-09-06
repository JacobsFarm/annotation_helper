/**
 * The image list and where we are in it.
 *
 * The list is sorted once, in the main process, so "next image" means the same thing on
 * every machine and after every rescan.
 */

import type { DatasetEntry, DatasetSummary } from '@shared/ipc'
import { api, safeCall } from '../api'

export type DatasetFilter = 'all' | 'todo' | 'done'

let entries = $state<DatasetEntry[]>([])
let summary = $state<DatasetSummary>({ total: 0, labelled: 0, backgrounds: 0, shapes: 0 })
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
 * Rescanning a large project on every save would make annotating unusable, and the two
 * facts that can change here are exactly these two.
 */
export function markEntry(file: string, shapeCount: number): void {
  entries = entries.map((entry) =>
    entry.file === file ? { ...entry, labelled: true, shapeCount } : entry
  )
  summary = {
    total: entries.length,
    labelled: entries.filter((e) => e.labelled).length,
    backgrounds: entries.filter((e) => e.labelled && e.shapeCount === 0).length,
    shapes: entries.reduce((sum, e) => sum + e.shapeCount, 0)
  }
}

export function removeEntry(file: string): void {
  entries = entries.filter((e) => e.file !== file)
  goTo(index)
}

export function resetDataset(): void {
  entries = []
  summary = { total: 0, labelled: 0, backgrounds: 0, shapes: 0 }
  index = 0
}
