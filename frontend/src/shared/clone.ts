/**
 * Plain copies of reactive data, for the IPC boundary.
 *
 * Everything the renderer keeps in `$state` is a Proxy. Both the context bridge and
 * `ipcRenderer.invoke` serialise with the structured clone algorithm, which refuses a
 * Proxy outright - "object could not be cloned", naming nothing. Handing it the open
 * project or the current annotation therefore failed *every* write: saving a label,
 * changing a setting, running a prediction.
 *
 * It lives here, rather than inline in the API facade, so it can be tested: a module
 * under `renderer/` pulls in the whole i18n and toast graph and cannot be imported from
 * a plain node test.
 */

/** Deep-copy to plain objects and arrays. Structurally identical, Proxy-free. */
export function toPlain<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(toPlain) as unknown as T
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = toPlain(item)
  }
  return out as T
}
