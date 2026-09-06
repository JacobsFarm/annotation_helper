import { ERROR_CODES, type IpcFailure } from '@shared/ipc'

/**
 * The only error type services throw.
 *
 * It carries a code rather than a sentence because the main process has no locale;
 * the renderer turns the code into text the user can read.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly detail?: string
  ) {
    super(message)
    this.name = 'ServiceError'
  }

  toFailure(): IpcFailure {
    return { code: this.code, message: this.message, detail: this.detail }
  }
}

export function toFailure(error: unknown): IpcFailure {
  if (error instanceof ServiceError) return error.toFailure()
  if (error instanceof Error) {
    return { code: ERROR_CODES.internal, message: error.message, detail: error.stack }
  }
  return { code: ERROR_CODES.internal, message: String(error) }
}
