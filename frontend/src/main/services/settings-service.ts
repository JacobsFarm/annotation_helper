/**
 * Application settings, in `userData`. Project data never lives here.
 *
 * Writes go through a temp file and a rename. On Windows `fs.rename` over an existing
 * file maps to MOVEFILE_REPLACE_EXISTING, so the settings file is never half-written.
 */

import { app } from 'electron'
import { readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AppSettings, RecentProject } from '@shared/ipc'

const MAX_RECENT = 10

const DEFAULTS: AppSettings = {
  locale: 'nl',
  theme: 'system',
  pythonPath: '',
  autosave: true,
  autoPredict: false,
  recent: []
}

let cache: AppSettings | null = null

function settingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function loadSettings(): Promise<AppSettings> {
  if (cache) return cache
  let loaded: AppSettings
  try {
    const raw = JSON.parse(await readFile(settingsFile(), 'utf-8'))
    loaded = { ...DEFAULTS, ...raw, recent: Array.isArray(raw.recent) ? raw.recent : [] }
  } catch {
    // Missing or corrupt settings are not an error: fall back and carry on.
    loaded = { ...DEFAULTS }
  }
  cache = loaded
  return loaded
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const current = await loadSettings()
  cache = { ...current, ...patch }
  const target = settingsFile()
  const temp = `${target}.tmp`
  await writeFile(temp, JSON.stringify(cache, null, 2) + '\n', 'utf-8')
  await rename(temp, target)
  return cache
}

export async function rememberProject(root: string, name: string): Promise<RecentProject[]> {
  const settings = await loadSettings()
  const recent = [
    { root, name, openedAt: Date.now() },
    ...settings.recent.filter((r) => r.root !== root)
  ].slice(0, MAX_RECENT)
  await saveSettings({ recent })
  return recent
}
