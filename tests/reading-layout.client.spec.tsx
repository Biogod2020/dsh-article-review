/** Reader mode changes preserve anchors and all navigation can cross section pages. */
// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { parseRevision } from '../src/document.ts'
import { PaperPanel } from '../src/client/panel.tsx'
import type { PaperPanelProps } from '../src/client/panel.tsx'
import { en } from '../src/client/locales.ts'
import type { PaperReviewKey } from '../src/client/locales.ts'
import { readWorkbenchState, writeWorkbenchState } from '../src/client/workbench-state.ts'
import { capturePaperPosition } from '../src/client/reader-scroll.ts'
import { FigureReferences } from '../src/client/figure-references.tsx'
import type { FigureReferenceActions } from '../src/client/figure-references.tsx'
import type { PaperBlock, PaperView } from '../src/schema.ts'

vi.mock('../src/client/reader-text.tsx', () => ({ ReaderText: ({ block, onSelect, figureReferences }: { block: PaperBlock; onSelect: () => void; figureReferences?: FigureReferenceActions }) =>
  <div data-reader-text onClick={onSelect}>{figureReferences ? <FigureReferences actions={figureReferences}><span>{block.text}</span></FigureReferences> : block.text}</div> }))
vi.mock('../src/client/rendered-diff.tsx', () => ({ RenderedDiffText: ({ text }: { text: string }) => <div>{text}</div>,
  renderedPlainText: (text: string) => text, renderedChangePair: () => undefined, rangesForChangedSpans: () => [] }))
afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function fixture(paging = false, ambient = false) {
  const revision = parseRevision('# Paper\n\nOpening.\n\n## First\n\nFirst paragraph.\n\n## Second\n\nSecond paragraph (Fig. 1a).\n\n> **Figure 1** (`whole.png`): The caption.\n')
  const target = revision.blocks[5]!, figure = revision.blocks[6]!
  const view: PaperView = { diskChanged: false, document: { schemaVersion: 1, path: 'article.md', current: revision, revisions: [revision],
    annotations: [], highlights: [], baselines: [], proposals: [], reading: {}, history: [], figurePanels: [{
      id: 'fig:a', figureBlockId: figure.id, figure: 'whole.png', label: 'a', sourceHash: 'a'.repeat(64), sourceFile: 'whole.png',
      file: 'figures/crop.png', hash: 'b'.repeat(64), page: 1, region: [0, 0, .5, 1], targets: [{ blockId: target.id, before: target.text }],
    }] } }
  writeWorkbenchState('layout-fixture', 'article.md', { mode: 'read', positions: {}, reader: { layout: 'text', paging: paging ? 'sections' : 'continuous', ...(ambient ? {} : { figurePresentation: 'docked' }) } })
  vi.stubGlobal('CSS', { escape: (text: string) => text })
  vi.stubGlobal('IntersectionObserver', undefined)
  vi.stubGlobal('ResizeObserver', undefined)
  vi.spyOn(HTMLElement.prototype, 'getClientRects').mockReturnValue({ length: 1 } as DOMRectList)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:fixture')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value(this: HTMLElement, options: ScrollToOptions) { this.scrollTop = options.top ?? 0 } })
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
  const preparePanels = vi.fn(async () => {}), setDraft = vi.fn()
  const command = vi.fn(async () => view), controller = new AbortController()
  const props = { sessionId: 'layout-fixture', t: (key: PaperReviewKey) => en[key],
    useTabInfo: () => ({ tab: { signal: controller.signal } }), useSession: () => false,
    useInput: () => ({ draft: 'An unsent author draft.', occurrences: [], phase: 'plain' }), inputActions: { setDraft },
    command, preparePanels, currentFile: async () => 'article.md', figureBytes: async () => new Uint8Array([1]),
    figureThumbnail: async () => 'data:image/png;base64,AAAA', figurePage: async () => undefined,
    bibliography: async () => ({ files: [], entries: [], missingKeys: [], possibleBareKeys: [], canonicalCitationCount: 0, citationStatus: 'no-citations' }),
  } as PaperPanelProps
  return { view, target, preparePanels, setDraft, command, mount: () => render(<PaperPanel {...props} />) }
}

it('keeps the same paragraph and relative intra-paragraph position through paging, layout changes and remount', async () => {
  const { target, mount } = fixture()
  let mounted = mount()
  await screen.findByText(target.text)
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')!
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const current = document.querySelector<HTMLElement>('[data-paper-scroll]')!
    if (this === current) return new DOMRect(0, 0, 600, 600)
    if (this.dataset.block) {
      const blocks = [...current.querySelectorAll<HTMLElement>('[data-block]')]
      const index = blocks.indexOf(this)
      const side = document.querySelector('[data-reader-layout]')?.getAttribute('data-reader-layout') === 'figures'
      return new DOMRect(0, index * 500 - current.scrollTop, 600, this.dataset.block === target.id && side ? 200 : 400)
    }
    return new DOMRect()
  })
  viewport.scrollTop = 2630; fireEvent.scroll(viewport)
  expect(capturePaperPosition(viewport).anchor?.blockId).toBe(target.id)
  fireEvent.change(screen.getByLabelText(en.readingPaging), { target: { value: 'sections' } })
  expect(document.querySelector(`[data-block="${target.id}"]`)).toBeTruthy()
  expect(screen.queryByText('First paragraph.')).toBeNull()
  expect(viewport.scrollTop).toBe(630)
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'figures' } })
  expect(viewport.scrollTop).toBe(565)
  expect(capturePaperPosition(viewport).anchor).toMatchObject({ blockId: target.id, fraction: .325 })
  fireEvent.click(screen.getByRole('button', { name: en.readingTools }))
  fireEvent.change(screen.getByLabelText(en.figureWidth), { target: { value: 'wide' } })
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.figureWidth).toBe('wide')
  expect(capturePaperPosition(viewport).anchor).toMatchObject({ blockId: target.id, fraction: .325 })
  fireEvent.click(within(document.querySelector('[data-figure-companion]') as HTMLElement).getByRole('button', { name: en.collapseFigures }))
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.figuresCollapsed).toBe(true)
  expect(capturePaperPosition(viewport).anchor).toMatchObject({ blockId: target.id, fraction: .325 })
  fireEvent.change(screen.getByLabelText(en.readingPaging), { target: { value: 'continuous' } })
  expect(viewport.scrollTop).toBe(2565)
  expect(screen.getByText('First paragraph.')).toBeTruthy()
  mounted.unmount(); mounted = mount()
  await screen.findByLabelText(en.readingLayout)
  expect(readWorkbenchState('layout-fixture', 'article.md').reader).toMatchObject({ layout: 'figures', paging: 'continuous', figureWidth: 'wide', figuresCollapsed: true })
  expect(capturePaperPosition(document.querySelector('[data-paper-scroll]')!).anchor?.blockId).toBe(target.id)
  mounted.unmount()
})

it('finds text on another page and selects a panel beside it without changing the manuscript', async () => {
  const { target, view, mount, command } = fixture(true)
  mount(); await screen.findByText('Opening.')
  const layout = screen.getByLabelText(en.readingLayout)
  fireEvent.change(layout, { target: { value: 'figures' } })
  fireEvent.click(document.querySelector('[data-paper-review]')!)
  document.querySelector<HTMLElement>('[data-paper-review]')!.focus()
  fireEvent.keyDown(document, { key: 'f', metaKey: true })
  fireEvent.change(await screen.findByRole('searchbox', { name: en.find }), { target: { value: 'Second paragraph' } })
  await screen.findByText(target.text)
  await waitFor(() => { expect(document.querySelector('[data-companion-file="figures/crop.png"]')).toBeTruthy() })
  fireEvent.click(screen.getByRole('button', { name: en.pinFigure }))
  expect(screen.getByRole('button', { name: en.unpinFigure }).getAttribute('aria-pressed')).toBe('true')
  expect({ section: (screen.getByLabelText(en.readingSection) as HTMLSelectElement).selectedOptions[0]?.textContent,
    selection: (screen.getByLabelText(en.readingFigure) as HTMLSelectElement).selectedOptions[0]?.textContent,
    pinned: readWorkbenchState('layout-fixture', 'article.md').reader?.pinned }).toMatchSnapshot()
  expect(view.document.current.text).toContain(target.text)
  expect(command.mock.calls.every(([request]) => request.action !== 'decide')).toBe(true)
})

it('starts the panel skill directly while preserving the input draft', async () => {
  const { target, mount, preparePanels, setDraft } = fixture()
  mount(); await screen.findByText(target.text)
  fireEvent.click(screen.getByRole('button', { name: en.readingTools }))
  fireEvent.click(screen.getByRole('button', { name: en.preparePanels }))
  await screen.findByText(en.panelTaskStarted)
  expect(preparePanels).toHaveBeenCalledWith('article.md', expect.any(String), en.preparePanelsIntent, expect.any(AbortSignal), 'layout-fixture')
  expect(setDraft).not.toHaveBeenCalled()
})

it('starts a fresh illustrated article with inline previews and preserves a later text-only choice', async () => {
  const { mount } = fixture()
  localStorage.clear()
  let mounted = mount()
  await screen.findByRole('button', { name: 'Fig. 1a' })
  expect((screen.getByLabelText(en.readingLayout) as HTMLSelectElement).value).toBe('figures')
  expect(document.querySelector('[data-figure-companion]')).toBeNull()
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'text' } })
  mounted.unmount(); mounted = mount()
  await screen.findByLabelText(en.readingLayout)
  expect((screen.getByLabelText(en.readingLayout) as HTMLSelectElement).value).toBe('text')
  mounted.unmount()
})

it('keeps a manually selected panel while locating its text through an unassociated heading', async () => {
  const { mount, target, view } = fixture()
  writeWorkbenchState('layout-fixture', 'article.md', { mode: 'read', positions: { read: { top: 0, anchor: { blockId: target.id, offset: 80 } } },
    reader: { layout: 'figures', paging: 'continuous', figurePresentation: 'docked', figureSelection: 'manual',
      figureKey: 'panel:fig:a', manualBlockId: target.id } })
  mount(); await screen.findByRole('button', { name: en.locatePanelText })
  fireEvent.click(screen.getByRole('button', { name: en.locatePanelText }))
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')!
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) return new DOMRect(0, 0, 600, 600)
    if (this.dataset.block === view.document.current.blocks[0]!.id) return new DOMRect(0, 100, 600, 400)
    return this.dataset.block ? new DOMRect(0, 800, 600, 400) : new DOMRect()
  })
  fireEvent.scroll(viewport)
  await waitFor(() => { expect(capturePaperPosition(viewport).anchor?.blockId).toBe(view.document.current.blocks[0]!.id) })
  expect(document.querySelector('[data-companion-file="figures/crop.png"]')).toBeTruthy()
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.figureSelection).toBe('manual')
})

it('distinguishes unassociated sections, manual browsing, linked panels and pinned images', async () => {
  const { mount } = fixture(true)
  mount(); await screen.findByText('Opening.')
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'figures' } })
  expect(screen.getByText(en.noSectionFigure)).toBeTruthy()
  expect(document.querySelector('[data-companion-file]')).toBeNull()
  fireEvent.click(screen.getByRole('button', { name: en.browseFigures }))
  expect(screen.getByText(en.manualFigure)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en.readingSection), { target: { value: '2' } })
  expect(await screen.findByText(en.linkedFigure)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: `${en.showPanel} a` }))
  expect(document.querySelector('[data-companion-file="figures/crop.png"]')).toBeTruthy()
  const separator = screen.getByRole('separator', { name: en.resizeColumns })
  fireEvent.keyDown(separator, { key: 'ArrowLeft' })
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.columnRatio).toBeCloseTo(1.3 / 2.3 - .03)
  fireEvent.click(screen.getByRole('button', { name: en.pinFigure }))
  fireEvent.change(screen.getByLabelText(en.readingSection), { target: { value: '1' } })
  expect(screen.getByText(en.figurePinned)).toBeTruthy()
  expect(document.querySelector('[data-companion-file="figures/crop.png"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.unpinFigure }))
  expect(screen.getByText(en.noSectionFigure)).toBeTruthy()
  expect(screen.queryByRole('button', { name: en.previousSection })?.getAttribute('aria-label')).toBe(en.previousSection)
  expect(screen.getAllByLabelText(en.readingSection)).toHaveLength(1)
})

it('keeps a chosen panel when the same paragraph becomes active or its map is refreshed', async () => {
  const { target, view, mount, command } = fixture()
  const first = view.document.figurePanels![0]!
  view.document.figurePanels!.push({ ...first, id: 'fig:b', label: 'b', file: 'figures/crop-b.png' })
  mount(); await screen.findByText(target.text)
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'figures' } })
  fireEvent.click(screen.getByRole('button', { name: 'Fig. 1a' }))
  fireEvent.click(screen.getByRole('button', { name: `${en.showPanel} b` }))
  expect(within(document.querySelector(`[data-block="${target.id}"]`) as HTMLElement).queryByRole('button', { name: 'Figure 1', exact: true })).toBeNull()
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')!
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) return new DOMRect(0, 0, 600, 600)
    if (this.dataset.block === target.id) return new DOMRect(0, 100, 600, 400)
    return new DOMRect()
  })
  fireEvent.scroll(viewport)
  await waitFor(() => { expect(document.querySelector('[data-companion-file="figures/crop-b.png"]')).toBeTruthy() })
  command.mockResolvedValueOnce(structuredClone(view))
  fireEvent.click(screen.getByRole('button', { name: en.check }))
  await waitFor(() => { expect(command).toHaveBeenLastCalledWith(expect.objectContaining({ action: 'open' }), expect.any(AbortSignal), 'layout-fixture') })
  expect(document.querySelector('[data-companion-file="figures/crop-b.png"]')).toBeTruthy()
})

it('captures the final visible position on reload even if lazy layout changed without another scroll event', async () => {
  const { target, mount } = fixture()
  mount(); await screen.findByText(target.text)
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')!
  let height = 400
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) return new DOMRect(0, 0, 600, 600)
    if (this.dataset.block === target.id) return new DOMRect(0, 2500 - viewport.scrollTop, 600, height)
    return new DOMRect()
  })
  viewport.scrollTop = 2630; fireEvent.scroll(viewport)
  height = 200
  fireEvent(window, new Event('pagehide'))
  expect(readWorkbenchState('layout-fixture', 'article.md').positions.read?.anchor).toMatchObject({ blockId: target.id, fraction: .65 })
})

it('keeps restoring after the initial manuscript load until lazy layout has settled', async () => {
  const { target, mount } = fixture()
  writeWorkbenchState('layout-fixture', 'article.md', { mode: 'read', positions: { read: {
    top: 2630, anchor: { blockId: target.id, offset: -130, fraction: .325 },
  } } })
  let naturalTop = 2500
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')
    if (this === viewport) return new DOMRect(0, 0, 600, 600)
    if (this.dataset.block === target.id) return new DOMRect(0, naturalTop - (viewport?.scrollTop ?? 0), 600, 400)
    return new DOMRect()
  })
  mount(); await screen.findByText(target.text)
  const viewport = document.querySelector<HTMLElement>('[data-paper-scroll]')!
  expect(viewport.scrollTop).toBe(2630)
  naturalTop = 3000
  document.querySelector(`[data-block="${target.id}"]`)!.setAttribute('data-lazy-complete', 'true')
  await waitFor(() => { expect(viewport.scrollTop).toBe(3130) })
})

it('defaults to quiet figure cues, opens a nonmodal window, docks and returns without changing the reader position', async () => {
  const { target, mount } = fixture(true, true)
  mount(); await screen.findByText('Opening.')
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'figures' } })
  expect(screen.queryByText(en.noSectionFigure)).toBeNull()
  expect(document.querySelector('[data-figure-companion]')).toBeNull()
  fireEvent.change(screen.getByLabelText(en.readingSection), { target: { value: '2' } })
  const cue = within(document.querySelector(`[data-block="${target.id}"]`) as HTMLElement).getByRole('button', { name: 'Fig. 1a' })
  fireEvent.click(cue)
  const floating = await screen.findByRole('dialog', { name: `${en.figureFloating} · Figure 1 · a` })
  expect(floating.getAttribute('aria-modal')).toBe('false')
  expect(document.querySelector('[data-reader-layout]')?.getAttribute('data-figure-placement')).toBe('ambient')
  expect(await screen.findByLabelText(en.moveFigureWindow)).toBeTruthy()
  fireEvent.change(screen.getByLabelText(en.readingSection), { target: { value: '1' } })
  expect(document.querySelector('[data-companion-file="figures/crop.png"]')).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: en.dockFigure }))
  expect(document.querySelector('[data-figure-window]')).toBeNull()
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.figurePresentation).toBe('docked')
  fireEvent.click(screen.getByRole('button', { name: en.floatFigure }))
  expect(await screen.findByRole('dialog', { name: `${en.figureFloating} · Figure 1 · a` })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.querySelector('[data-figure-window]')).toBeNull()
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.figurePresentation).toBe('peek')
  expect((screen.getByLabelText(en.readingSection) as HTMLSelectElement).value).toBe('1')
})

it('delays hovering, bridges the pointer into the preview and dismisses it without opening a window', async () => {
  const { target, mount } = fixture(true, true)
  mount(); await screen.findByText('Opening.')
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'figures' } })
  fireEvent.change(screen.getByLabelText(en.readingSection), { target: { value: '2' } })
  const cue = within(document.querySelector(`[data-block="${target.id}"]`) as HTMLElement).getByRole('button', { name: 'Fig. 1a' })
  fireEvent.focus(cue); fireEvent.blur(cue)
  await new Promise(resolve => setTimeout(resolve, 260))
  expect(document.querySelector('[data-figure-window]')).toBeNull()
  fireEvent.focus(cue)
  const peek = await screen.findByRole('dialog', { name: `${en.figurePreview} · Figure 1 · a` })
  fireEvent.blur(cue); fireEvent.pointerEnter(peek)
  await new Promise(resolve => setTimeout(resolve, 580))
  expect(document.querySelector('[data-figure-window=preview]')).toBeTruthy()
  expect(readWorkbenchState('layout-fixture', 'article.md').reader?.figurePresentation).toBeUndefined()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.querySelector('[data-figure-window]')).toBeNull()
})


it('keeps a focused preview open and restores focus without reopening after Escape', async () => {
  const { target, mount } = fixture(true, true)
  mount(); await screen.findByText('Opening.')
  fireEvent.change(screen.getByLabelText(en.readingLayout), { target: { value: 'figures' } })
  fireEvent.change(screen.getByLabelText(en.readingSection), { target: { value: '2' } })
  const cue = within(document.querySelector(`[data-block="${target.id}"]`) as HTMLElement).getByRole('button', { name: 'Fig. 1a' })
  cue.focus()
  await screen.findByRole('dialog', { name: `${en.figurePreview} · Figure 1 · a` })
  fireEvent.pointerLeave(cue)
  await new Promise(resolve => setTimeout(resolve, 580))
  expect(document.querySelector('[data-figure-window=preview]')).toBeTruthy()
  fireEvent.click(cue)
  expect(await screen.findByRole('dialog', { name: `${en.figureFloating} · Figure 1 · a` })).toBeTruthy()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(document.activeElement).toBe(cue)
  await new Promise(resolve => setTimeout(resolve, 420))
  expect(document.querySelector('[data-figure-window]')).toBeNull()
})
