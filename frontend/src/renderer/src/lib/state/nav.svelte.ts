/**
 * Which screen is showing.
 *
 * A four-item enum rather than a router: there are no URLs in a desktop app, and every
 * screen is reachable from the rail.
 */

export type ViewId = 'annotate' | 'dataset' | 'train' | 'settings'

let current = $state<ViewId>('annotate')

export function activeView(): ViewId {
  return current
}

export function goToView(next: ViewId): void {
  current = next
}
