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
  packagesUnavailable: 'packages_unavailable',
  packagesBundled: 'packages_bundled',
  packagesBusy: 'packages_busy',
  packagesFailed: 'packages_failed',
  cancelled: 'cancelled',
  internal: 'internal'
} as const

// --- data shapes crossing the boundary --------------------------------------

/** Where an image currently sits. `input` is the inbox; annotating moves it to `images`. */
export type ImageArea = 'input' | 'images'

export interface DatasetEntry {
  /** Relative to its area directory, with forward slashes. Survives a folder move. */
  file: string
  area: ImageArea
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
  /** Still in the inbox, waiting to be annotated. */
  pending: number
  labelled: number
  backgrounds: number
  shapes: number
}

/** What is sitting in the project's recycle bin right now. */
export interface RecycleStatus {
  /** Absolute, so it can be opened in the file explorer. */
  path: string
  files: number
  bytes: number
}

/**
 * What a label write did. The image may have moved: annotating is what promotes it out
 * of the inbox, so the renderer has to be told where it ended up.
 */
export interface LabelWriteResult {
  /** The label file that was written. */
  path: string
  /** The image's path relative to its area, which a name collision can change. */
  imageFile: string
  area: ImageArea
  /** A fresh `ah-img://` URL: the old one points at the pre-move location. */
  url: string
  moved: boolean
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
  /** Predict as soon as an unannotated image opens, so annotating is one review pass. */
  autoPredict: boolean
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

/** Which torch build the AI packages should be, or already are. */
export type Compute = 'auto' | 'cuda' | 'cpu'

/**
 * The state of the heavy AI packages (ultralytics, torch), which are the one thing the
 * app cannot simply carry in every build: with CUDA they are larger than the rest of the
 * application by an order of magnitude.
 */
export interface PackageStatus {
  /** ultralytics imports in the engine, from wherever it lives. */
  installed: boolean
  /** This build shipped with them; nothing is downloaded and nothing can be removed. */
  bundled: boolean
  installing: boolean
  /** What a fresh install would choose here, based on whether an NVIDIA GPU answers. */
  suggested: Exclude<Compute, 'auto'>
  /** The writable directory an in-app install writes to. Shown so it can be inspected. */
  target: string
  /** A bundled interpreter is present, so an install needs nothing from the machine. */
  runtimeBundled: boolean
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

/**
 * One round of click-to-segment. Every click made so far is sent again, because the
 * mask is a function of the whole set of clicks and not of the last one.
 */
export interface SegmentPointRequest {
  root: string
  /** Image path relative to the project's images directory. */
  file: string
  /** Clicks in image pixels. */
  points: [number, number][]
  /** 1 = part of the object, 0 = background. Same length as `points`. */
  labels: number[]
  classId: number
}

export interface SegmentPointResult {
  /**
   * One polygon per disjoint part of the mask, biggest first. Several is normal: a
   * plant that grass cuts into pieces is one object and several rings, and a ring
   * around all of them would have to run straight through the grass in between.
   */
  shapes: Shape[]
  ms: number
  model: string
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
  | { type: 'packages:output'; line: string }
  | { type: 'packages:done'; ok: boolean; detail?: string }
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
    write(input: { root: string; annotation: ImageAnnotation }): Promise<LabelWriteResult>
  }
  files: {
    trash(input: { root: string; file: string; area?: ImageArea }): Promise<{ trashed: string }>
    undo(root: string): Promise<{ undone: string | null }>
    recycle(root: string): Promise<RecycleStatus>
    /** Permanent. The only call in this API that destroys a file. */
    emptyRecycle(root: string): Promise<{ removed: number; bytes: number }>
  }
  ai: {
    status(): Promise<PythonStatus>
    predict(input: PredictRequest): Promise<PredictResult>
    segmentPoint(input: SegmentPointRequest): Promise<SegmentPointResult>
    cancel(): Promise<void>
    restart(): Promise<PythonStatus>
    packages(): Promise<PackageStatus>
    install(input: { compute: Compute }): Promise<PackageStatus>
    cancelInstall(): Promise<void>
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
