/**
 * The handler registry.
 *
 * In its own module so the domain files and `ipc/index.ts` can both import it without
 * a circular dependency - the exact cycle that bit during the first build.
 */

export type IpcHandler = (params: any) => Promise<unknown> | unknown

const registry = new Map<string, IpcHandler>()

/** Register one method. Handlers stay thin: unwrap, call a service, return. */
export function handle(method: string, fn: IpcHandler): void {
  registry.set(method, fn)
}

export function lookup(method: string): IpcHandler | undefined {
  return registry.get(method)
}

export function methods(): string[] {
  return [...registry.keys()].sort()
}
