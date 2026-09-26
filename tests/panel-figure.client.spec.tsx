/** Operator figure selection stages reviewable changes without accepting them. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import type { PaperBlock, PaperView } from '../src/schema.ts'
import { PaperPanel } from '../src/client/panel.tsx'
import type { PaperPanelProps } from '../src/client/panel.tsx'
import { en } from '../src/client/locales.ts'
import type { PaperReviewKey } from '../src/client/locales.ts'

vi.mock('../src/client/reader-text.tsx', () => ({ ReaderText: ({ block }: { block: PaperBlock }) => <div>{block.text}</div> }))
vi.mock('../src/client/rendered-diff.tsx', () => ({
  RenderedDiffText: ({ text }: { text: string }) => <div>{text}</div>, renderedChangePair: () => undefined,
  renderedPlainText: (text: string) => text, rangesForChangedSpans: () => [],
}))
const originalModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal')
afterEach(() => {
  cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals()
  if (originalModal) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalModal)
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal')
})

function fixture(selected: string | null = 'new.pdf') {
  const revision = parseRevision('# Paper\n\n> **Figure 2** (`old.pdf`): A caption.\n')
  const block = revision.blocks[1]
  if (!block) throw new Error('Figure block missing')
  const view: PaperView = { diskChanged: false, document: { schemaVersion: 1, path: 'article.md', current: revision,
    revisions: [revision], proposals: [], annotations: [], highlights: [], baselines: [], history: [], reading: {} } }
  const before = { path: 'old.pdf', snapshot: 'figures/review-assets/old.pdf', hash: 'a'.repeat(64) }
  const after = { path: 'figures/review-assets/new.pdf', snapshot: 'figures/review-assets/new.pdf', hash: 'b'.repeat(64) }
  const next: PaperView = { ...view, document: { ...view.document, proposals: [{ id: 'P1', status: 'pending',
    createdAt: revision.createdAt, baseRevision: revision.id, reason: 'New image.', meaning: 'structure', flags: ['figures'],
    annotationIds: [], edits: [{ blockId: block.id, before: block.text, after: block.text.replace('old.pdf', after.path) }],
    figureChanges: [{ blockId: block.id, before, after }] }] } }
  const signal = new AbortController().signal
  const pickFigure = vi.fn(async (_signal: AbortSignal, _sessionId: string) => selected), replaceFigure = vi.fn(async () => next)
  const command = vi.fn(async (_request: { action: string }) => view)
  vi.stubGlobal('CSS', { escape: (value: string) => value })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true,
    value(this: HTMLDialogElement) { this.open = true } })
  const props = { sessionId: 'figure-fixture', t: (key: PaperReviewKey) => en[key],
    useTabInfo: () => ({ tab: { signal } }), useSession: () => false,
    useInput: () => ({ draft: '', occurrences: [], phase: 'plain' }), inputActions: { setDraft: vi.fn() },
    command, pickFigure, replaceFigure, currentFile: async () => 'article.md',
    figureThumbnail: async () => 'data:image/png;base64,AAAA', figurePage: vi.fn(), figureBytes: vi.fn(), figurePath: vi.fn(),
    bibliography: async () => ({ files: [], entries: [], missingKeys: [], possibleBareKeys: [],
      canonicalCitationCount: 0, citationStatus: 'no-citations' }),
  } as unknown as PaperPanelProps
  render(<PaperPanel {...props} />)
  return { pickFigure, replaceFigure, command, revision, block }
}

it('chooses a file, stages a proposal and shows exact old/new snapshot previews', async () => {
  const { replaceFigure, command, revision, block } = fixture()
  fireEvent.click(await screen.findByRole('button', { name: en.replaceFigure }))
  fireEvent.click(await screen.findByRole('button', { name: en.figureReplacement }))
  await waitFor(() => { expect(screen.getByLabelText<HTMLInputElement>(en.figureReplacementPath).value).toBe('new.pdf') })
  fireEvent.click(screen.getByRole('button', { name: en.figureReplacementSubmit }))
  await screen.findByText(en.figureOld)
  expect(replaceFigure).toHaveBeenCalledWith('article.md', expect.objectContaining({ revision: revision.id,
    blockId: block.id, figure: 'old.pdf', replacement: 'new.pdf' }), expect.any(AbortSignal), 'figure-fixture')
  expect(document.querySelector('[data-figure-preview="figures/review-assets/old.pdf"]')).toBeTruthy()
  expect(document.querySelector('[data-figure-preview="figures/review-assets/new.pdf"]')).toBeTruthy()
  expect(command.mock.calls.some(([request]) => request.action === 'decide')).toBe(false)
})

it('leaves source and proposals untouched when Finder selection is canceled', async () => {
  const { pickFigure, replaceFigure } = fixture(null)
  fireEvent.click(await screen.findByRole('button', { name: en.replaceFigure }))
  fireEvent.click(await screen.findByRole('button', { name: en.figureReplacement }))
  await waitFor(() => { expect(pickFigure).toHaveBeenCalledTimes(1) })
  await waitFor(() => { expect(screen.getByRole<HTMLButtonElement>('button', { name: en.figureReplacement }).disabled).toBe(false) })
  expect(screen.getByLabelText<HTMLInputElement>(en.figureReplacementPath).value).toBe('')
  expect(replaceFigure).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('can cancel an outstanding native chooser from the review pane', async () => {
  const { pickFigure, replaceFigure } = fixture(null)
  pickFigure.mockImplementation(signal => new Promise((resolve) => { signal.addEventListener('abort', () => { resolve(null) }) }))
  fireEvent.click(await screen.findByRole('button', { name: en.replaceFigure }))
  fireEvent.click(await screen.findByRole('button', { name: en.figureReplacement }))
  await waitFor(() => { expect(pickFigure).toHaveBeenCalledTimes(1) })
  const signal = pickFigure.mock.calls[0]?.[0]
  fireEvent.click(screen.getByRole('button', { name: en.cancel }))
  await waitFor(() => { expect(signal?.aborted).toBe(true) })
  expect(replaceFigure).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})
