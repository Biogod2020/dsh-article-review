/** Historical comparison renders full source without advancing the author-confirmed baseline. */
// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { Versions, resolveVersionSelection } from '../src/client/versions.tsx'
import { en, zh } from '../src/client/locales.ts'
import { DocumentSchema } from '../src/schema.ts'
import { parseRevision } from '../src/document.ts'

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('defers long-comparison block mounts while retaining every scroll and search target', () => {
  const observed = new Map<Element, IntersectionObserverCallback>()
  class Observer implements IntersectionObserver {
    root = null
    rootMargin = '600px 0px'
    thresholds = [0]
    private targets = new Set<Element>()
    constructor(private callback: IntersectionObserverCallback) {}
    observe(element: Element): void { this.targets.add(element); observed.set(element, this.callback) }
    unobserve(element: Element): void { this.targets.delete(element); observed.delete(element) }
    disconnect(): void { this.targets.forEach((element) => { observed.delete(element) }); this.targets.clear() }
    takeRecords(): IntersectionObserverEntry[] { return [] }
  }
  vi.stubGlobal('IntersectionObserver', Observer)
  const revisions = [0, 1].map((version) => {
    const parsed = parseRevision(Array.from({ length: 256 }, (_, index) =>
      `Synthetic paragraph ${index}. This is a **bounded** scientific comparison with ${version && index % 4 === 0 ? 'revised' : 'original'} wording.`).join('\n\n'))
    return { ...parsed, id: `revision-${version}`, blocks: parsed.blocks.map((block, index) => ({ ...block, id: `block-${index}` })) }
  })
  const document = DocumentSchema.parse({ schemaVersion: 1, path: 'synthetic.md', revisions, current: revisions[1],
    annotations: [], proposals: [], baselines: [], history: [], reading: {} })
  const preview = vi.fn(() => null)
  const { container } = render(<Versions document={document} t={key => en[key]} figurePreview={preview} />)
  expect(container.querySelectorAll('[data-reader-text]')).toHaveLength(0)
  expect(preview).not.toHaveBeenCalled()
  expect(observed.size).toBe(512)
  expect(container.querySelectorAll('[data-find-id]')).toHaveLength(512)
  const target = container.querySelector('[data-find-id="version:left:block-128"]')
  if (!target) throw new Error('Synthetic far-away search target missing')
  const intersect = (element: Element): void => {
    const callback = observed.get(element)
    if (!callback) throw new Error('Unobserved fixture element')
    act(() => { callback([{ target: element, isIntersecting: true, intersectionRatio: 1, time: 0,
      rootBounds: null, boundingClientRect: new DOMRect(), intersectionRect: new DOMRect() }], new Observer(callback)) })
  }
  intersect(target)
  expect(container.querySelectorAll('[data-reader-text]')).toHaveLength(1)
  expect(preview).toHaveBeenCalledTimes(1)
  const reader = target.querySelector('[data-reader-text]')
  if (!reader) throw new Error('Activated reader missing')
  intersect(reader)
  expect(reader.querySelector('strong')?.textContent).toBe('bounded')
  expect(reader.textContent).toContain('original wording')
  expect(target.innerHTML).toContain('::highlight(paper-diff-')
  expect(container.querySelectorAll('[data-find-id]')).toHaveLength(512)
  cleanup()
  expect(observed.size).toBe(0)
})

function fixture() {
  const revisions = ['Original **claim**.', 'Revised **claim**.', 'Qualified **claim**.'].map((body, index) => {
    const parsed = parseRevision(`## Finding\n\n${body}`)
    return { ...parsed, id: `revision-${index}`, blocks: parsed.blocks.map((block, blockIndex) => ({ ...block, id: `block-${blockIndex}` })) }
  })
  return DocumentSchema.parse({ schemaVersion: 1, path: 'paper.md', revisions, current: revisions[2],
    annotations: [], proposals: [], baselines: [], history: [], reading: {} })
}

it('defaults to adjacent revisions and keeps choices attached to IDs when history changes', () => {
  const original = fixture()
  const { rerender } = render(<Versions document={original} t={key => en[key]} />)
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.leftVersion }).value).toBe('revision-1')
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.rightVersion }).value).toBe('revision-2')
  fireEvent.change(screen.getByRole('combobox', { name: en.leftVersion }), { target: { value: 'revision-0' } })
  fireEvent.change(screen.getByRole('combobox', { name: en.rightVersion }), { target: { value: 'revision-1' } })
  fireEvent.click(screen.getByRole('button', { name: en.sideBySide }))
  const reordered = { ...original, revisions: [...original.revisions].reverse() }
  rerender(<Versions document={reordered} t={key => en[key]} />)
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.leftVersion }).value).toBe('revision-0')
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.rightVersion }).value).toBe('revision-1')
  expect(document.querySelector('[data-version-before]')?.textContent).toBe(original.revisions[0]?.text)
  expect(document.querySelector('[data-version-after]')?.textContent).toBe(original.revisions[1]?.text)
  fireEvent.click(screen.getByRole('button', { name: en.swap }))
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.leftVersion }).value).toBe('revision-1')
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.rightVersion }).value).toBe('revision-0')
})

it('reports controlled choices and restores them on a new comparison mount', () => {
  const original = fixture()
  const selection = { leftRevisionId: 'revision-0', rightRevisionId: 'revision-1', layout: 'split' as const }
  const changed = vi.fn()
  const { unmount } = render(<Versions document={original} t={key => en[key]} selection={selection} onSelectionChange={changed} />)
  fireEvent.change(screen.getByRole('combobox', { name: en.rightVersion }), { target: { value: 'revision-2' } })
  expect(changed).toHaveBeenLastCalledWith({ ...selection, rightRevisionId: 'revision-2' })
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: en.rightVersion }).value).toBe('revision-1')
  fireEvent.click(screen.getByRole('button', { name: en.inlineDiff }))
  expect(changed).toHaveBeenLastCalledWith({ ...selection, layout: 'inline' })
  unmount()
  render(<Versions document={original} t={key => en[key]} selection={selection} onSelectionChange={changed} />)
  expect(document.querySelector('[data-find-id="version:left:source"]')?.textContent).toBe(original.revisions[0]?.text)
  expect(document.querySelector('[data-find-id="version:right:source"]')?.textContent).toBe(original.revisions[1]?.text)
  expect(screen.getByRole('button', { name: en.sideBySide }).getAttribute('aria-pressed')).toBe('true')
})

it('exposes inline-source search text and resolves removed revision selections', () => {
  const original = fixture()
  const selection = { leftRevisionId: 'missing-left', rightRevisionId: 'missing-right', layout: 'inline' as const }
  expect(resolveVersionSelection(original, selection)).toEqual({ leftRevisionId: 'revision-1', rightRevisionId: 'revision-2', layout: 'inline' })
  render(<Versions document={original} t={key => en[key]} selection={selection} />)
  const source = document.querySelector('[data-find-id="version:inline:source"]')
  expect(source?.querySelector('del')?.textContent).toBe('Revised')
  expect(source?.querySelector('ins')?.textContent).toBe('Qualified')
  expect(source?.textContent).toContain('RevisedQualified **claim**.')
  expect(resolveVersionSelection({ ...original, revisions: [] })).toEqual({ leftRevisionId: 'revision-2', rightRevisionId: 'revision-2', layout: 'rendered' })
})

it.each([en, zh])('renders readable Markdown by default and retains source comparison controls', (copy) => {
  const date = vi.spyOn(Date.prototype, 'toLocaleString').mockReturnValue('2026-09-22 12:00')
  try {
    const revisions = ['Original **claim**.', 'Revised **claim**.', 'Qualified **claim**.'].map((body, index) => {
      const parsed = parseRevision(`## Finding\n\n${body}`)
      return { ...parsed, id: `revision-${index}`, blocks: parsed.blocks.map((block, blockIndex) => ({ ...block, id: `block-${blockIndex}` })), createdAt: '2026-09-22T04:00:00Z' }
    })
    const document = DocumentSchema.parse({ schemaVersion: 1, path: 'paper.md', revisions, current: revisions[2],
      annotations: [], proposals: [], baselines: [], history: [], reading: {} })
    const before = JSON.stringify(document)
    const html = renderToStaticMarkup(<Versions document={document} t={key => copy[key]} />)
    expect(html).toContain('<h2>Finding</h2>')
    expect(html).toContain('<strong>claim</strong>')
    expect(html).toContain(copy.renderedPages)
    expect(html).toContain(copy.sideBySide)
    expect(html).toContain('value="revision-2" selected=""')
    expect(JSON.stringify(document)).toBe(before)
    expect(html.replace(/ class="[^"]*"/g, '')).toMatchSnapshot()
  } finally { date.mockRestore() }
})
