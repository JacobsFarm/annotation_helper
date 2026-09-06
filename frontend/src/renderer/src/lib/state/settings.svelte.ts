/**
 * Application settings: language, theme, interpreter, autosave.
 *
 * These live in `userData`, not in the project, because they describe this machine and
 * this user rather than the data.
 */

import type { AppSettings } from '@shared/ipc'
import { api, safeCall } from '../api'
import { setLocale, type Locale } from '../i18n/index.svelte'

const FALLBACK: AppSettings = {
  locale: 'nl',
  theme: 'system',
  pythonPath: '',
  autosave: true,
  recent: []
}

let current = $state<AppSettings>({ ...FALLBACK })

export function settings(): AppSettings {
  return current
}

export async function loadSettings(): Promise<void> {
  const loaded = await safeCall(() => api.app.getSettings())
  if (loaded) apply(loaded)
}

export async function updateSettings(patch: Partial<AppSettings>): Promise<void> {
  const saved = await safeCall(() => api.app.saveSettings(patch))
  if (saved) apply(saved)
}

function apply(next: AppSettings): void {
  current = next
  setLocale(next.locale as Locale)
  applyTheme(next.theme)
}

/**
 * "system" stamps nothing and lets `prefers-color-scheme` decide; an explicit choice
 * stamps `data-theme`, which the token file gives precedence in both directions.
 */
function applyTheme(theme: AppSettings['theme']): void {
  const root = document.documentElement
  if (theme === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', theme)
}
