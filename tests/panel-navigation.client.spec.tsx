/** Proposal locations preserve exact anchors and a return path to the same review card. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import type { PaperBlock, PaperCommand, PaperView, Proposal } from '../src/schema.ts'
import { PaperPanel } from '../src/client/panel.tsx'
import type { PaperPanelProps } from '../src/client/panel.tsx'
import { en } from '../src/client/locales.ts'
import type { PaperReviewKey } from '../src/client/locales.ts'

vi.mock('../src/client/reader-text.tsx', () => ({ ReaderText: ({ block }: { block: PaperBlock }) => <div data-reader-text>{block.text}</div> }))
vi.mock('../src/client/rendered-diff.tsx', () => ({
  RenderedDiffText: ({ text }: { text: string }) => <div>{text}</div>, renderedChangePair: () => undefined,
  renderedPlainText: (text: string) => text, rangesForChangedSpans: () => [],
}))

const originalScroll = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollIntoView')
const originalScrollTo = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollTo')
afterEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalScroll) Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', originalScroll)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  if (originalScrollTo) Object.defineProperty(HTMLElement.prototype, 'scrollTo', originalScrollTo)
  else Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo')
})

function fixture(operation?: 'insert-before' | 'insert-after', stale = false, newerRevision = false) {
  const base = parseRevision('# Paper\n\n## Methods\n\n### Screening\n\nAn exact source anchor.\n\nAnother paragraph.')
  const revision = newerRevision ? parseRevision(base.text.replace('Another paragraph.', 'An unrelated accepted revision.'), base) : base
  const block = revision.blocks.find(candidate => candidate.text === 'An exact source anchor.')
  if (!block) throw new Error('Fixture anchor missing')
  const proposal: Proposal = { id: 'P7', baseRevision: base.id, annotationIds: [], reason: 'A bounded revision.',
    meaning: 'structure', flags: [], createdAt: revision.createdAt, status: 'pending',
    edits: [{ blockId: block.id, before: stale ? 'An obsolete anchor.' : block.text, after: 'New content.', ...(operation ? { operation } : {}) }] }
  const view: PaperView = { diskChanged: false, document: { schemaVersion: 1, path: 'article.md', current: revision,
    revisions: newerRevision ? [base, revision] : [revision], proposals: [proposal], annotations: [], highlights: [],
    baselines: [], history: [], reading: {} } }
  const command = vi.fn(async (_command: PaperCommand) => view)
  // The fixture supplies only the native hooks consumed here; Web binding is covered by the real profile acceptance.
  const props = { sessionId: 'navigation-fixture', t: (key: PaperReviewKey) => en[key],
    useTabInfo: () => ({ tab: { signal: new AbortController().signal } }),
    useSession: (select: (state: { running: boolean }) => boolean) => select({ running: false }),
    useInput: () => ({ draft: '', occurrences: [], phase: 'plain' }), inputActions: { setDraft: vi.fn() },
    command, currentFile: async () => 'article.md', bibliography: async () => ({ files: [], entries: [], missingKeys: [],
      possibleBareKeys: [], canonicalCitationCount: 0, citationStatus: 'no-citations' }),
  } as PaperPanelProps
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true,
    value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0 } })
  render(<PaperPanel {...props} />)
  return { block, scroll, command, view }
}

it.each(['insert-before', 'insert-after', undefined] as const)('locates %s at its exact anchor and returns to the same proposal', async (operation) => {
  const { block, scroll, command } = fixture(operation)
  await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  const card = document.querySelector<HTMLElement>('[data-proposal="P7"]')
  expect(card?.textContent).toMatchSnapshot(`proposal ${operation ?? 'replace'} location`)
  fireEvent.click(screen.getByRole('button', { name: en.viewInArticle }))
  await waitFor(() => { expect(document.querySelector(`[data-location-marker="${operation ?? 'replace'}"]`)).toBeTruthy() })
  const marker = document.querySelector('[data-location-marker]')
  const reader = document.querySelector(`[data-block="${block.id}"] [data-reader-text]`)
  if (!marker || !reader) throw new Error('Location marker missing')
  expect(Boolean(marker.compareDocumentPosition(reader) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(operation !== 'insert-after')
  fireEvent.click(screen.getByRole('button', { name: en.backToProposal }))
  await waitFor(() => { expect(document.querySelector('[data-proposal="P7"]')).toBeTruthy() })
  await waitFor(() => {
    const target = scroll.mock.instances.at(-1)
    expect(target instanceof HTMLElement ? target.getAttribute('data-proposal') : undefined).toBe('P7')
  })
  expect(command.mock.calls.every(([request]) => !['decide', 'review'].includes(request.action))).toBe(true)
})

it('disables manuscript navigation when the exact source anchor is stale', async () => {
  const { block } = fixture('insert-after', true)
  await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  expect(screen.getByText(en.locationUnavailable)).toBeTruthy()
  expect(screen.getByRole<HTMLButtonElement>('button', { name: en.viewInArticle }).disabled).toBe(true)
})

it.each(['insert-before', 'insert-after'] as const)('keeps %s acceptance enabled after an unrelated revision', async (operation) => {
  const { block, view } = fixture(operation, false, true)
  await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  expect(view.document.proposals[0]?.baseRevision).not.toBe(view.document.current.id)
  const accept = screen.getByRole<HTMLButtonElement>('button', { name: en.accept })
  expect(accept.disabled).toBe(false)
  expect({ operation, acceptEnabled: !accept.disabled,
    sourceUnchanged: view.document.current.blocks.some(b => b.id === block.id && b.text === block.text) })
    .toMatchSnapshot('non-overlapping insertion')
})

it('clears the proposal marker when a new manuscript revision is adopted', async () => {
  const { block, command, view } = fixture('insert-after')
  await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  fireEvent.click(screen.getByRole('button', { name: en.viewInArticle }))
  await screen.findByRole('button', { name: en.backToProposal })
  const revision = parseRevision(view.document.current.text.replace('Another paragraph.', 'A revised neighboring paragraph.'),
    view.document.current)
  command.mockResolvedValue({ ...view, document: { ...view.document, current: revision,
    revisions: [...view.document.revisions, revision] } })
  fireEvent.click(screen.getByRole('button', { name: en.check }))
  fireEvent.click(await screen.findByRole('button', { name: en.load }))
  await screen.findByText('A revised neighboring paragraph.')
  expect(document.querySelector('[data-location-marker]')).toBeNull()
})

it.each([en.changes, en.versions, en.history, en.references])('restores Read after visiting %s without using the last clicked paragraph', async (name) => {
  const { block, command } = fixture()
  await screen.findByText(block.text)
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')
  const anchor = document.querySelector<HTMLElement>(`[data-block="${block.id}"]`)
  if (!viewport || !anchor) throw new Error('Reader missing')
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) return new DOMRect(0, 0, 500, 600)
    return this.dataset.block === block.id ? new DOMRect(0, 1200 - viewport.scrollTop, 500, 100) : new DOMRect()
  })
  viewport.scrollTop = 1235
  fireEvent.click(screen.getByRole('button', { name }))
  expect(viewport.scrollTop).toBe(0)
  fireEvent.click(screen.getByRole('button', { name: en.read, exact: true }))
  const restored = document.querySelector<HTMLElement>(`[data-block="${block.id}"]`)
  expect(restored?.textContent).toContain(block.text)
  expect(viewport.scrollTop).toBe(1235)
  expect(restored?.getBoundingClientRect().top).toBe(-35)
  expect(command.mock.calls.every(([request]) => !['position', 'decide', 'review'].includes(request.action))).toBe(true)
  viewport.scrollTop = 735
  fireEvent.click(screen.getByRole('button', { name }))
  viewport.scrollTop = 240
  fireEvent.click(screen.getByRole('button', { name: en.read, exact: true }))
  expect(viewport.scrollTop).toBe(735)
  fireEvent.click(screen.getByRole('button', { name }))
  expect(viewport.scrollTop).toBe(240)
  fireEvent.click(screen.getByRole('button', { name: en.read, exact: true }))
  expect({ returnedTo: block.text, scrollTop: viewport.scrollTop,
    sourceWrites: command.mock.calls.filter(([request]) => ['decide', 'review'].includes(request.action)).length })
    .toMatchSnapshot('returning to Read')
})

it('gives an explicit proposal jump priority over the saved Read position', async () => {
  const { block, scroll } = fixture('insert-after')
  await screen.findByText(block.text)
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')
  if (!viewport) throw new Error('Reader missing')
  viewport.scrollTop = 2400
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  fireEvent.click(screen.getByRole('button', { name: en.viewInArticle }))
  await screen.findByRole('button', { name: en.backToProposal })
  await waitFor(() => {
    const target = scroll.mock.instances.at(-1)
    expect(target instanceof HTMLElement ? target.dataset.block : undefined).toBe(block.id)
  })
  expect(viewport.scrollTop).not.toBe(2400)
})

it('returns to the manually scrolled location instead of repeating a previous proposal jump', async () => {
  const { block } = fixture('insert-after')
  await screen.findByText(block.text)
  fireEvent.click(screen.getByRole('button', { name: en.changes }))
  fireEvent.click(screen.getByRole('button', { name: en.viewInArticle }))
  await screen.findByRole('button', { name: en.backToProposal })
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')
  if (!viewport) throw new Error('Reader missing')
  viewport.scrollTop = 3600
  fireEvent.click(screen.getByRole('button', { name: en.history }))
  fireEvent.click(screen.getByRole('button', { name: en.read, exact: true }))
  expect(viewport.scrollTop).toBe(3600)
  expect(document.querySelector('[data-location-marker]')).toBeNull()
})
