/** Load only the two selected immutable revisions and discard them when comparison closes. */
import { useEffect, useRef, useState } from 'react'
import type { PaperRevision } from '../schema.ts'
import type { WorkbenchDocument } from '../workbench-view.ts'
import type { VersionSelection } from './versions.tsx'

type Pair = { key: string; revisions: PaperRevision[]; error?: string }
type ReadRevision = (path: string, revision: string, signal: AbortSignal, sessionId: string) => Promise<PaperRevision>

/** Keep response races and cancellation scoped to the comparison that requested them. */
export function useRevisionPair(document: WorkbenchDocument | undefined, selection: VersionSelection | undefined,
  active: boolean, read: ReadRevision, lifetime: AbortSignal, sessionId: string): {
    revisions: PaperRevision[]; loading: boolean; error: string; retry: () => void
  } {
  const key = active && document && selection
    ? `${document.path}\0${selection.leftRevisionId}\0${selection.rightRevisionId}` : ''
  const [pair, setPair] = useState<Pair>({ key: '', revisions: [] })
  const retained = useRef(pair)
  retained.current = pair
  const [attempt, setAttempt] = useState(0)
  const current = document?.current
  useEffect(() => {
    if (!key || !document || !selection) { setPair(previous => previous.key === '' && previous.revisions.length === 0 ? previous : { key: '', revisions: [] }); return }
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, lifetime])
    const ids = [...new Set([selection.leftRevisionId, selection.rightRevisionId])]
    const previous = retained.current.key.split('\0')[0] === document.path ? retained.current.revisions : []
    void Promise.all(ids.map(async id => {
      if (id === document.current.id) return document.current
      const cached = previous.find(revision => revision.id === id)
      if (cached) return cached
      // Full fixtures and older in-process callers already own their historical bodies.
      const known = document.revisions.find((revision): revision is PaperRevision =>
        revision.id === id && 'text' in revision && 'blocks' in revision)
      const revision = known ?? await read(document.path, id, signal, sessionId)
      if (revision.id !== id) throw new Error('Requested manuscript version was not returned')
      return revision
    })).then(revisions => { if (!signal.aborted) setPair(previous => previous.key === key && !previous.error
      && previous.revisions.length === revisions.length && revisions.every((revision, index) => previous.revisions[index] === revision)
      ? previous : { key, revisions }) },
      (error: unknown) => { if (!signal.aborted) setPair({ key, revisions: [],
        error: error instanceof Error ? error.message : String(error) }) })
    return () => { controller.abort() }
  }, [key, current, attempt, read, lifetime, sessionId])
  const ready = pair.key === key
  return { revisions: ready ? pair.revisions : [], loading: Boolean(key) && (!ready || (!pair.error && pair.revisions.length === 0)),
    error: ready ? pair.error ?? '' : '', retry: () => { setAttempt(value => value + 1) } }
}
