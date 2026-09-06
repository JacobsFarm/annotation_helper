/**
 * Translation, as a rune.
 *
 * `t()` reads a `$state` value, so every call site is reactive: changing the language
 * re-renders the UI in place, with no page reload and therefore no loss of the open
 * project or unsaved annotation work. That only works because state lives in
 * module-level rune stores that outlive the component tree - which is a good reason to
 * put it there anyway.
 */

import en from './messages/en'
import nl from './messages/nl'

export type Locale = 'en' | 'nl'
export type MessageKey = keyof typeof en

const catalogues: Record<Locale, Record<MessageKey, string>> = { en, nl }

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'nl', label: 'Nederlands' },
  { id: 'en', label: 'English' }
]

let current = $state<Locale>('nl')

export function locale(): Locale {
  return current
}

export function setLocale(next: Locale): void {
  current = next
  document.documentElement.lang = next
}

/** `t('annotate_status_counter', { index: 3, total: 40 })` -> `3 / 40`. */
export function t(key: MessageKey, params?: Record<string, string | number>): string {
  const template = catalogues[current][key] ?? catalogues.en[key] ?? key
  if (!params) return template
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in params ? String(params[name]) : match
  )
}

/**
 * Codes from the main process and the sidecar become sentences here, and only here.
 * An unmapped code still produces something readable rather than a blank toast.
 */
export function errorMessage(code: string | undefined): string {
  const key = `error_${code ?? ''}` as MessageKey
  return key in en ? t(key) : t('error_generic')
}

export function issueMessage(code: string): string {
  const key = `issue_${code}` as MessageKey
  return key in en ? t(key) : code
}
