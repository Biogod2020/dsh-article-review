/** Workbench state stays local and network recovery never blindly repeats a source mutation. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import type { PaperBlock, PaperCommand, PaperView } from '../src/schema.ts'
import { PaperPanel } from '../src/client/panel.tsx'
import type { PaperPanelProps } from '../src/client/panel.tsx'
import { en } from '../src/client/locales.ts'
import type { PaperReviewKey } from '../src/client/locales.ts'
import { readAnnotationDrafts, readWorkbenchState, writeAnnotationDrafts, writeWorkbenchState } from '../src/client/workbench-state.ts'

vi.mock('../src/client/reader-text.tsx', () => ({ ReaderText: ({ block, onSelect }: { block: PaperBlock; onSelect?: () => void }) =>
  <div data-reader-text onClick={() => { onSelect?.() }}>{block.text}</div> }))
vi.mock('../src/client/rendered-diff.tsx', () => ({ RenderedDiffText: ({ text }: { text: string }) => <div>{text}</div>,
  renderedPlainText: (text: string) => text, renderedChangePair: () => undefined, rangesForChangedSpans: () => [] }))

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture() {
  const old = parseRevision('# Example\n\nEarlier paragraph.\n')
  const revision = parseRevision('# Example\n\nCurrent paragraph.\n\nAnother paragraph.\n', old)
  const block = revision.blocks[1]!
  let view: PaperView = { diskChanged: false, document: { schemaVersion: 1, path: 'article.md', current: revision, revisions: [old, revision],
    proposals: [{ id: 'P1', baseRevision: revision.id, annotationIds: [], reason: 'A local proposal.', meaning: 'style', flags: [],
      status: 'pending', createdAt: revision.createdAt, edits: [{ blockId: block.id, before: block.text, after: 'Proposed wording.' }] }],
    annotations: [], highlights: [], baselines: [], reading: {}, history: [{ at: revision.createdAt, action: 'proposed', detail: 'Historical action.' }] } }
  const command = vi.fn(async (_request: PaperCommand) => view)
  const controller = new AbortController()
  const props = { sessionId: 'workbench-fixture', t: (key: PaperReviewKey) => en[key],
    useTabInfo: () => ({ tab: { signal: controller.signal } }),
    useSession: (select: (state: { running: boolean }) => boolean) => select({ running: false }),
    useInput: () => ({ draft: '', occurrences: [], phase: 'plain' }), inputActions: { setDraft: vi.fn() },
    command, currentFile: async () => 'article.md', bibliography: async () => ({ files: ['main.bib'],
      entries: [{ key: 'smith', type: 'article', hash: 'hash', file: 'main.bib', fields: { title: 'Reference title.', author: 'Smith, Ada', year: '2024' } }],
      missingKeys: [], possibleBareKeys: [], canonicalCitationCount: 0, citationStatus: 'no-citations' }),
  } as PaperPanelProps
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
  const scroll = vi.fn()
  vi.stubGlobal('IntersectionObserver', undefined)
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value(this: HTMLDialogElement) { this.open = true } })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0 } })
  const mount = () => render(<PaperPanel {...props} />)
  return { block, command, scroll, mount, getView: () => view, setView: (next: PaperView) => { view = next } }
}

it('validates browser state, separates sessions/files and retains missing-block drafts', () => {
  expect(writeWorkbenchState('one', 'article.md', { mode: 'versions', positions: { read: { top: 500, anchor: { blockId: 'p', offset: -15 } } },
    versions: { leftRevisionId: 'old', rightRevisionId: 'new', layout: 'split' } })).toBe(true)
  expect(readWorkbenchState('one', 'article.md').positions.read?.anchor?.offset).toBe(-15)
  expect(readWorkbenchState('two', 'article.md').mode).toBe('read')
  expect(readWorkbenchState('one', 'other.md').mode).toBe('read')
  writeAnnotationDrafts('one', 'article.md', { missing: { source: 'Original.', revision: 'old', quote: '', comment: 'Keep this draft.' } })
  expect(readAnnotationDrafts('one', 'article.md').missing?.comment).toBe('Keep this draft.')
  localStorage.setItem('paper-review:workbench:["one","article.md"]', '{broken')
  expect(readWorkbenchState('one', 'article.md')).toEqual({ mode: 'read', positions: {} })
})

it('retains version choices and layout across views and panel remount', async () => {
  const { block, mount, getView } = fixture()
  const mounted = mount()
  await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.versions }))
  const old = getView().document.revisions[0]!.id
  fireEvent.change(screen.getByLabelText(en.rightVersion), { target: { value: old } })
  fireEvent.click(screen.getByRole('button', { name: en.sideBySide }))
  fireEvent.click(screen.getByRole('button', { name: en.history }))
  fireEvent.click(screen.getByRole('button', { name: en.versions }))
  expect((screen.getByLabelText(en.rightVersion)).value).toBe(old)
  expect(screen.getByRole('button', { name: en.sideBySide }).getAttribute('aria-pressed')).toBe('true')
  mounted.unmount(); mount()
  await screen.findByLabelText(en.rightVersion)
  expect((screen.getByLabelText(en.rightVersion)).value).toBe(old)
  expect(screen.getByRole('button', { name: en.sideBySide }).getAttribute('aria-pressed')).toBe('true')
})

it('keeps an unsent annotation across paragraph selection, view changes and remount without sending it', async () => {
  const { block, mount, command } = fixture()
  const mounted = mount()
  fireEvent.click(await screen.findByText(block.text))
  fireEvent.click(screen.getByRole('button', { name: en.annotate, exact: true }))
  fireEvent.change(screen.getByLabelText(en.comment), { target: { value: 'Please keep this unsent comment.' } })
  fireEvent.click(screen.getByText('Another paragraph.'))
  fireEvent.click(screen.getByText(block.text))
  expect((screen.getByLabelText(en.comment)).value).toBe('Please keep this unsent comment.')
  fireEvent.click(screen.getByRole('button', { name: en.history }))
  fireEvent.click(screen.getByRole('button', { name: en.read, exact: true }))
  expect((screen.getByLabelText(en.comment)).value).toBe('Please keep this unsent comment.')
  mounted.unmount(); mount()
  await screen.findByLabelText(en.comment)
  expect((screen.getByLabelText(en.comment)).value).toBe('Please keep this unsent comment.')
  expect(command.mock.calls.some(([request]) => request.action === 'annotate')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: en.discardDraft }))
  expect(readAnnotationDrafts('workbench-fixture', 'article.md')).toEqual({})
})

it.each([[en.changes, 'Proposed wording.'], [en.history, 'Historical action.'], [en.references, 'Reference title.'], [en.versions, 'Earlier paragraph.']])(
  'finds in %s without forcing Read', async (mode, query) => {
    const { block, mount } = fixture()
    mount(); await screen.findByText(block.text)
    const button = screen.getByRole('button', { name: mode })
    fireEvent.click(button); button.focus()
    fireEvent.keyDown(document, { key: 'f', metaKey: true })
    const input = await screen.findByRole('searchbox', { name: en.find })
    fireEvent.change(input, { target: { value: query } })
    await waitFor(() => { expect(screen.getAllByRole('status').some(node => node.textContent?.includes('1/'))).toBe(true) })
    expect(button.getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: en.findInArticle })).toBeTruthy()
  })

it('keeps an outdated annotation draft separate until the author explicitly attaches it to current text', async () => {
  const { block, mount, command, getView } = fixture()
  writeWorkbenchState('workbench-fixture', 'article.md', { mode: 'read', positions: {}, selectedBlockId: block.id })
  writeAnnotationDrafts('workbench-fixture', 'article.md', { [block.id]: {
    source: 'Outdated source.', revision: 'earlier-revision', quote: 'Outdated', comment: 'Preserve my intended comment.',
  } })
  mount()
  await screen.findByLabelText(en.comment)
  expect(screen.getByText(en.draftStale)).toBeTruthy()
  expect(screen.getByRole('button', { name: en.save }).disabled).toBe(true)
  expect(command.mock.calls.some(([request]) => request.action === 'annotate')).toBe(false)
  fireEvent.click(screen.getByRole('button', { name: en.draftUseCurrent }))
  const draft = readAnnotationDrafts('workbench-fixture', 'article.md')[block.id]
  expect(draft).toMatchObject({ source: block.text, revision: getView().document.current.id, quote: '', comment: 'Preserve my intended comment.' })
  expect(screen.getByRole('button', { name: en.save }).disabled).toBe(false)
  expect(command.mock.calls.some(([request]) => request.action === 'annotate')).toBe(false)
})

it('checks a lost acceptance response and never repeats an already settled proposal', async () => {
  const { block, command, mount, getView, setView } = fixture()
  command.mockImplementation(async (request) => {
    if (request.action === 'decide') {
      const view = getView()
      setView({ ...view, document: { ...view.document, proposals: view.document.proposals.map(item => ({ ...item, status: 'accepted' })) } })
      throw new Error('Failed to fetch')
    }
    return getView()
  })
  mount(); await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  fireEvent.click(screen.getByRole('button', { name: en.accept }))
  await screen.findByText(en.operationUncertain)
  expect(screen.queryByRole('button', { name: en.retry })).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.checkOperation }))
  await screen.findByText(en.operationSettled)
  expect(command.mock.calls.filter(([request]) => request.action === 'decide')).toHaveLength(1)
})

it('keeps local-storage failures separate from a successful server mutation', async () => {
  const { block, mount, command } = fixture()
  mount(); await screen.findByText(block.text)
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage quota full') })
  fireEvent.click(screen.getByText(block.text))
  fireEvent.click(screen.getByRole('button', { name: en.mark }))
  await screen.findByText(en.storageFailed)
  expect(screen.queryByText('Storage quota full')).toBeNull()
  expect(command.mock.calls.filter(([request]) => request.action === 'review')).toHaveLength(1)
})
