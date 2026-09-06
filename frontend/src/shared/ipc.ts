/**
 * The IPC contract. This file is the spine of the application: main, preload and
 * renderer all type-check against it, so a channel cannot exist on one side only.
 *
 * The envelope exists because Electron turns a rejected `invoke` into the opaque string
 * "Error invoking remote method". So every handler returns a result object and **never
 * rejects**; the preload unwraps it and throws a clean `ApiError` the renderer can show.
 */

import type { ImageAnnotation, Shape } from './shapes'
import type { AiSettings, Project, ProjectFile } from './project'

export type IpcFailure = { code: string; message: string; detail?: string }
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: IpcFailure }

export const CHANNELS = {
  invoke: 'ah:invoke',
  event: 'ah:event'
} as const

/** Codes, never sentences: the main process has no locale. The renderer translates. */
export const ERROR_CODES = {
  unknownMethod: 'unknown_method',
  projectNotFound: 'project_not_found',
  projectInvalid: 'project_invalid',
  imageNotFound: 'image_not_found',
  writeFailed: 'write_failed',
  pathOutsideProject: 'path_outside_project',
  pythonUnavailable: 'python_unavailable',
  pythonFailed: 'python_failed',
  cancelled: 'cancelled',
  internal: 'internal'
} as const

// --- data shapes crossing the boundary --------------------------------------

export interface DatasetEntry {
  /** Relative to the images directory, with forward slashes. Survives a folder move. */
  file: string
  width: number
  height: number
  /** A label file exists. It may be empty, which means verified background. */
  labelled: boolean
  shapeCount: number
  /** `ah-img://` URL the renderer can put straight into an `<img>`. */
  url: string
}

export interface DatasetSummary {
  total: number
  labelled: number
  backgrounds: number
  shapes: number
}

export interface DatasetIssue {
  code: string
  level: 'error' | 'warning'
  file: string
  detail: string
}

export interface HealthReport {
  images: number
  labelled: number
  unlabelled: number
  backgrounds: number
  shapes: number
  perClass: Record<string, number>
  issues: DatasetIssue[]
}

export interface SplitResult {
  train: number
  val: number
  test: number
  skipped: number
  output: string
}

export interface RecentProject {
  root: string
  name: string
  openedAt: number
}

export interface AppSettings {
  locale: 'en' | 'nl'
  theme: 'system' | 'light' | 'dark'
  /** Empty means "search PATH". Set explicitly when Python is not on PATH. */
  pythonPath: string
  autosave: boolean
  recent: RecentProject[]
}

export interface PythonStatus {
  available: boolean
  /** Why it is not available, as a code the renderer can translate. */
  reason?: string
  version?: string
  executable?: string
  capabilities?: {
    predict: boolean
    train: boolean
    cuda: boolean
    pillow: boolean
    devices: string[]
  }
}

export interface PredictRequest {
  root: string
  /** Image path relative to the project's images directory. */
  file: string
  options: AiSettings
}

export interface PredictResult {
  shapes: Shape[]
  ms: number
  pipeline: string
}

export interface TrainRun {
  id: string
  command: string[]
  cwd: string
  epoch: number
  epochs: number
  finished: boolean
  exitCode: number | null
  running: boolean
}

// --- events (main -> renderer) ----------------------------------------------

export type AppEvent =
  | { type: 'python:status'; status: PythonStatus }
  | { type: 'predict:progress'; requestId: string; stage: string; pct: number }
  | { type: 'train:output'; runId: string; line: string; epoch: number; epochs: number }
  | { type: 'train:done'; runId: string; exitCode: number }

/**
 * What the preload actually exposes, on `window.bridge`.
 *
 * Raw and untyped by design: the envelope survives the context bridge intact, whereas a
 * thrown Error arrives with its custom fields stripped. The renderer wraps this.
 */
export interface Bridge {
  invoke(method: string, params?: unknown): Promise<IpcResult<unknown>>
  on(handler: (event: AppEvent) => void): () => void
}

// --- the typed facade the renderer builds over the bridge -------------------

/** Every method here rejects with an `ApiError` carrying a translatable code. */
export interface Api {
  app: {
    info(): Promise<{ version: string; platform: string }>
    getSettings(): Promise<AppSettings>
    saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>
    openPath(target: string): Promise<void>
  }
  dialog: {
    chooseDirectory(title?: string): Promise<string | null>
    chooseFile(filters?: { name: string; extensions: string[] }[]): Promise<string | null>
  }
  project: {
    create(input: { root: string; name: string; task: ProjectFile['task'] }): Promise<Project>
    open(root: string): Promise<Project>
    save(project: Project): Promise<Project>
    recent(): Promise<RecentProject[]>
  }
  dataset: {
    list(root: string): Promise<{ entries: DatasetEntry[]; summary: DatasetSummary }>
    check(root: string): Promise<HealthReport>
    split(input: {
      root: string
      mode: 'copy' | 'move' | 'lists'
      includeUnlabelled: boolean
      output?: string
    }): Promise<SplitResult>
    exportConfig(root: string): Promise<{ dataYaml: string; classesTxt: string }>
  }
  labels: {
    read(input: { root: string; file: string }): Promise<ImageAnnotation>
    write(input: { root: string; annotation: ImageAnnotation }): Promise<{ path: string }>
  }
  files: {
    trash(input: { root: string; file: string }): Promise<{ trashed: string }>
    undo(root: string): Promise<{ undone: string | null }>
  }
  ai: {
    status(): Promise<PythonStatus>
    predict(input: PredictRequest): Promise<PredictResult>
    cancel(): Promise<void>
    restart(): Promise<PythonStatus>
  }
  train: {
    command(input: { root: string; overrides?: Record<string, unknown> }): Promise<string[]>
    start(input: { root: string; overrides?: Record<string, unknown> }): Promise<TrainRun>
    status(input: { root: string; runId?: string }): Promise<TrainRun & { tail?: string[] }>
    cancel(input: { root: string; runId: string }): Promise<{ cancelled: boolean }>
  }
  on(handler: (event: AppEvent) => void): () => void
}

/** Every callable path in `Api`, flattened, so the dispatcher can be exhaustive. */
export type ApiMethod =
  | `app.${keyof Api['app']}`
  | `dialog.${keyof Api['dialog']}`
  | `project.${keyof Api['project']}`
  | `dataset.${keyof Api['dataset']}`
  | `labels.${keyof Api['labels']}`
  | `files.${keyof Api['files']}`
  | `ai.${keyof Api['ai']}`
  | `train.${keyof Api['train']}`
