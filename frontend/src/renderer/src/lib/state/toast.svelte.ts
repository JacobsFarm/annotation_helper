/**
 * Toasts.
 *
 * Every failed call raises one, which is what makes `safeCall` safe: no error can be
 * silently swallowed. The predecessor's bare `except: pass` around file moves is the
 * failure mode this exists to prevent.
 */

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  kind: ToastKind
  message: string
  detail?: string
}

const DURATION: Record<ToastKind, number> = { info: 3500, success: 3000, error: 9000 }

let items = $state<Toast[]>([])
let nextId = 1

export function toasts(): Toast[] {
  return items
}

export function pushToast(kind: ToastKind, message: string, detail?: string): number {
  const id = nextId++
  items = [...items, { id, kind, message, detail }]
  setTimeout(() => dismissToast(id), DURATION[kind])
  return id
}

export function dismissToast(id: number): void {
  items = items.filter((t) => t.id !== id)
}
