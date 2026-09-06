/**
 * The typed API the rest of the renderer uses, plus the one place errors surface.
 *
 * `safeCall(fn)` catches, raises a toast with a translated message, and returns null.
 * Call sites become one line and no failure can be silently swallowed - which is exactly
 * what went wrong in the predecessor, where a bare `except: pass` around file moves hid
 * real data loss.
 */

import type {
  Api,
  AppEvent,
  AppSettings,
  Bridge,
  DatasetEntry,
  DatasetSummary,
  HealthReport,
  IpcResult,
  PredictRequest,
  PredictResult,
  PythonStatus,
  RecentProject,
  SplitResult,
  TrainRun
} from '@shared/ipc'
import type { Project, ProjectFile } from '@shared/project'
import type { ImageAnnotation } from '@shared/shapes'
import { errorMessage } from '../i18n/index.svelte'
import { pushToast } from '../state/toast.svelte'

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

const bridge: Bridge = (window as unknown as { bridge: Bridge }).bridge

async function call<T>(method: string, params?: unknown): Promise<T> {
  const result = (await bridge.invoke(method, params)) as IpcResult<T>
  if (result.ok) return result.data
  throw new ApiError(result.error.code, result.error.message, result.error.detail)
}

export const api: Api = {
  app: {
    info: () => call('app.info'),
    getSettings: () => call<AppSettings>('app.getSettings'),
    saveSettings: (patch) => call<AppSettings>('app.saveSettings', patch),
    openPath: (target) => call<void>('app.openPath', target)
  },
  dialog: {
    chooseDirectory: (title) => call<string | null>('dialog.chooseDirectory', title),
    chooseFile: (filters) => call<string | null>('dialog.chooseFile', filters)
  },
  project: {
    create: (input: { root: string; name: string; task: ProjectFile['task'] }) =>
      call<Project>('project.create', input),
    open: (root) => call<Project>('project.open', root),
    save: (project) => call<Project>('project.save', project),
    recent: () => call<RecentProject[]>('project.recent')
  },
  dataset: {
    list: (root) => call<{ entries: DatasetEntry[]; summary: DatasetSummary }>('dataset.list', root),
    check: (root) => call<HealthReport>('dataset.check', root),
    split: (input) => call<SplitResult>('dataset.split', input),
    exportConfig: (root) => call<{ dataYaml: string; classesTxt: string }>('dataset.exportConfig', root)
  },
  labels: {
    read: (input) => call<ImageAnnotation>('labels.read', input),
    write: (input) => call<{ path: string }>('labels.write', input)
  },
  files: {
    trash: (input) => call<{ trashed: string }>('files.trash', input),
    undo: (root) => call<{ undone: string | null }>('files.undo', root)
  },
  ai: {
    status: () => call<PythonStatus>('ai.status'),
    predict: (input: PredictRequest) => call<PredictResult>('ai.predict', input),
    cancel: () => call<void>('ai.cancel'),
    restart: () => call<PythonStatus>('ai.restart')
  },
  train: {
    command: (input) => call<string[]>('train.command', input),
    start: (input) => call<TrainRun>('train.start', input),
    status: (input) => call<TrainRun & { tail?: string[] }>('train.status', input),
    cancel: (input) => call<{ cancelled: boolean }>('train.cancel', input)
  },
  on: (handler: (event: AppEvent) => void) => bridge.on(handler)
}

/** Run an API call, show any failure as a toast, and return null instead of throwing. */
export async function safeCall<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (error) {
    if (error instanceof ApiError) {
      pushToast('error', errorMessage(error.code), error.detail)
    } else {
      pushToast('error', errorMessage(undefined), String(error))
    }
    return null
  }
}
