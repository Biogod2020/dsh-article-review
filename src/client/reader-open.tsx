/** Reveal only the addressed conversation after an explicit paper_open tool call. */
import { useEffect, useRef, useSyncExternalStore } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'

declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
  interface SidebarRightTabParamsMap {
    'paper-review': { paperPath: string; requestId: string }
  }
}

export interface ReaderOpenRequest { requestId: string; path: string }
export type ReaderOpenProps = PropsRuntime<'conversation.composer.dock'> & {
  mounted: { subscribe: (listener: () => void) => () => void; getSnapshot: () => string | undefined }
  request: (sessionId: string, signal: AbortSignal) => Promise<ReaderOpenRequest | null>
  reveal: (sessionId: string, request: ReaderOpenRequest) => void
}

export function ReaderOpen({ sessionId, useSession, mounted, request, reveal }: ReaderOpenProps) {
  const running = useSession(state => state.running)
  const visible = useSyncExternalStore(mounted.subscribe, mounted.getSnapshot)
  const seen = useRef('')
  useEffect(() => {
    if (visible !== sessionId) return
    const controller = new AbortController()
    const key = `paper-review:revealed:${sessionId}`
    let pending = false
    async function check() {
      if (pending || controller.signal.aborted) return
      pending = true
      try {
        const next = await request(sessionId, controller.signal)
        if (!next || controller.signal.aborted || mounted.getSnapshot() !== sessionId) return
        let previous = seen.current
        try { previous ||= sessionStorage.getItem(key) ?? '' } catch { /* Session-local ref remains usable. */ }
        if (previous === next.requestId) return
        reveal(sessionId, next)
        seen.current = next.requestId
        try { sessionStorage.setItem(key, next.requestId) } catch { /* No source or reading state depends on browser storage. */ }
      } catch { /* A disconnected host must not steal focus or break the composer. */ }
      finally { pending = false }
    }
    void check()
    const timer = running ? setInterval(() => { void check() }, 1000) : undefined
    return () => { controller.abort(); clearInterval(timer) }
  }, [sessionId, running, visible, request, reveal, mounted])
  return null
}
