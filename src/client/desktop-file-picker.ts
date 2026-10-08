/** Desktop uses the window-owned file dialog and the same preload bridge as DSH's composer. */
interface HostPathBridge { pathFor(file: File): string }

/** Return undefined on Web so the caller can use the host picker; null means user cancellation. */
export function pickDesktopFile(accept: string, signal: AbortSignal): Promise<string | null> | undefined {
  const bridge = (globalThis as { __DSH_HOST_PATHS__?: HostPathBridge }).__DSH_HOST_PATHS__
  if (typeof bridge?.pathFor !== 'function') return undefined
  if (signal.aborted) return Promise.resolve(null)
  return new Promise((resolve, reject) => {
    const input = document.createElement('input')
    input.type = 'file'; input.accept = accept; input.hidden = true
    let settled = false
    const cleanup = (): void => {
      input.removeEventListener('change', change)
      input.removeEventListener('cancel', cancel)
      signal.removeEventListener('abort', cancel)
      input.remove()
    }
    const finish = (path: string | null): void => {
      if (settled) return
      settled = true; cleanup(); resolve(path)
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true; cleanup(); reject(error)
    }
    const cancel = (): void => { finish(null) }
    const change = (): void => {
      const file = input.files?.[0]
      if (!file) { finish(null); return }
      try {
        const path = bridge.pathFor(file)
        if (!path) throw new Error('DSH Desktop could not resolve the selected file path. Choose a file from the conversation workspace.')
        finish(path)
      } catch (error) { fail(error) }
    }
    input.addEventListener('change', change)
    input.addEventListener('cancel', cancel)
    signal.addEventListener('abort', cancel, { once: true })
    document.body.append(input)
    // Keep this synchronous in the user's click handler so Electron owns and presents the dialog.
    try { input.click() } catch (error) { fail(error) }
  })
}
