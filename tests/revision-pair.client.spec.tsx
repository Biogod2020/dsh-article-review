// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { workbenchView } from '../src/workbench-view.ts'
import { useRevisionPair } from '../src/client/revision-pair.ts'

afterEach(() => cleanup())
function fixture() {
  const revisions = [0, 1, 2, 3].map(index => parseRevision(`Exact source ${index}.`))
  const document = workbenchView({ diskChanged: false, document: { schemaVersion: 1, path: 'article.md',
    current: revisions[3]!, revisions, annotations: [], highlights: [], proposals: [], baselines: [], history: [], reading: {} } }).document
  const read = vi.fn(async (_path: string, id: string, _signal: AbortSignal) => revisions.find(revision => revision.id === id)!)
  const lifetime = new AbortController().signal
  const selection = { leftRevisionId: revisions[1]!.id, rightRevisionId: revisions[3]!.id, layout: 'rendered' as const }
  return { revisions, document, read, lifetime, selection }
}

it('loads no history during reading, reuses the current revision, swaps without fetching and releases on exit', async () => {
  const f = fixture()
  const { result, rerender } = renderHook(({ active, selection }) => useRevisionPair(f.document, selection, active, f.read, f.lifetime, 's'),
    { initialProps: { active: false, selection: f.selection } })
  expect(f.read).not.toHaveBeenCalled()
  rerender({ active: true, selection: f.selection })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(f.read).toHaveBeenCalledTimes(1)
  expect(result.current.revisions).toEqual([f.revisions[1], f.revisions[3]])
  rerender({ active: true, selection: { ...f.selection, leftRevisionId: f.selection.rightRevisionId, rightRevisionId: f.selection.leftRevisionId } })
  await waitFor(() => expect(result.current.loading).toBe(false))
  expect(f.read).toHaveBeenCalledTimes(1)
  rerender({ active: false, selection: f.selection })
  expect(result.current.revisions).toEqual([])
})

it('cancels obsolete reads and never presents them as the newly selected version', async () => {
  const f = fixture()
  let finish: (() => void) | undefined
  f.read.mockImplementationOnce(async () => new Promise(resolve => { finish = () => resolve(f.revisions[1]!) }))
  const { result, rerender } = renderHook(({ selection }) => useRevisionPair(f.document, selection, true, f.read, f.lifetime, 's'),
    { initialProps: { selection: f.selection } })
  const signal = f.read.mock.calls[0]![2]
  rerender({ selection: { ...f.selection, leftRevisionId: f.revisions[2]!.id } })
  expect(signal.aborted).toBe(true)
  await waitFor(() => expect(result.current.revisions[0]?.id).toBe(f.revisions[2]!.id))
  await act(async () => finish!())
  expect(result.current.revisions[0]?.id).toBe(f.revisions[2]!.id)
})

it('shows errors without substituting another source and permits a retry', async () => {
  const f = fixture(); f.read.mockRejectedValueOnce(new Error('Version unavailable'))
  const { result } = renderHook(() => useRevisionPair(f.document, f.selection, true, f.read, f.lifetime, 's'))
  await waitFor(() => expect(result.current.error).toBe('Version unavailable'))
  expect(result.current.revisions).toEqual([])
  act(() => result.current.retry())
  await waitFor(() => expect(result.current.error).toBe(''))
  expect(result.current.revisions[0]?.id).toBe(f.revisions[1]!.id)
})
