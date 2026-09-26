/** Bibliography filtering and navigation stay read-only and render bounded batches. */
// @vitest-environment jsdom
import { useState } from 'react'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BibliographyView, PaperBlock } from '../src/schema.ts'
import * as display from '../src/client/bib-display.ts'
import { References } from '../src/client/references.tsx'
import type { ReferencesLabels, ReferencesProps, ReferencesState } from '../src/client/references.tsx'

const labels: ReferencesLabels = {
  title: 'References', help: 'Verify metadata against publications.', sources: 'Authoritative .bib files',
  none: 'No .bib files bound.', unbind: 'Unbind', path: 'BibTeX path', pathHint: 'references/example.bib',
  bind: 'Bind path', choose: 'Choose in Finder', missing: 'Missing keys:', legacy: 'Possible bare keys:',
  entries: 'Entries', loading: 'Loading references…', retry: 'Retry', search: 'Filter references',
  searchHint: 'Title, author, year, or citation key', noEntries: 'The bound files contain no entries.',
  noResults: 'No entries match this filter. Clear it to show the library.', clear: 'Clear filter',
  previous: 'Previous page', next: 'Next page', page: 'Page', showing: 'Showing', citationCount: 'Citations:',
  locate: 'First citation in manuscript', nextCitation: 'Next citation', unused: 'Not cited in this manuscript',
  doi: 'DOI', url: 'Publication',
}
const blocks: PaperBlock[] = [
  { id: 'opening', kind: 'paragraph', section: '', text: 'Useful pairs [@key0; @key1]. More evidence [@key0].', start: 0, end: 73 },
  { id: 'results', kind: 'paragraph', section: '', text: 'Another experiment [@key0].', start: 75, end: 100 },
  { id: 'code', kind: 'code', section: '', text: '[@key0]', start: 102, end: 109 },
  { id: 'source', kind: 'html', section: '', text: '<!-- [@key0] -->', start: 111, end: 126 },
  { id: 'inline', kind: 'paragraph', section: '', text: '`[@key0]` and <!-- [@key0] -->.', start: 128, end: 166 },
]
function bibliography(count = 2): BibliographyView {
  return { files: ['references/example.bib'], entries: Array.from({ length: count }, (_, index) => ({
    key: `key${index}`, type: 'article', file: 'references/example.bib', hash: `hash-${index}`, fields: {
      author: index === 0 ? String.raw`{M{\"u}ller}, Anna and {\v{S}}imek, Boris` : `Example, Author ${index}`,
      title: index === 0 ? String.raw`{A} {\textit{multimodal}} {H\&E} experiment` : `Synthetic research ${index}`,
      year: String(2020 + index), doi: index === 0 ? '10.1234/paired.evidence' : '',
      url: index === 0 ? 'https://example.org/paper' : '',
    },
  })), missingKeys: [], possibleBareKeys: [], canonicalCitationCount: 4, citationStatus: 'resolved' }
}
const initial: ReferencesState = { query: '', page: 0, nextCitation: {} }
function Harness({ initialState = initial, ...props }: Partial<ReferencesProps> & { initialState?: ReferencesState }): ReactNode {
  const [state, setState] = useState(initialState)
  const [path, setPath] = useState('')
  return <References bibliography={bibliography()} blocks={blocks} labels={labels} busy={false}
    path={path} onPathChange={setPath} onBind={vi.fn()} onChoose={vi.fn()} onRetry={vi.fn()} onLocate={vi.fn()}
    state={state} onStateChange={setState} {...props} />
}
afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('formats protected capitals, LaTeX accents and escaped symbols without modifying metadata', () => {
  expect(display.plainBibText(String.raw`{M{\"u}ller} and {\v{S}}imek with {H\&E}, {\AA}ngstr{\"o}m`))
    .toBe('Müller and Šimek with H&E, Ångström')
  expect(display.plainBibText(String.raw`\'e {\c{c}} {\H{o}} {\textbf{ST}} a~b {\unknown{term}} \{literal\}`))
    .toBe('é ç ő ST a b \\unknownterm {literal}')
  expect(display.plainBibText()).toBe('')
  const bib = bibliography(), original = JSON.stringify(bib)
  const { container } = render(<Harness bibliography={bib} />)
  expect(container.textContent).toContain('A multimodal H&E experiment')
  expect(container.textContent).toContain('Müller, Anna and Šimek, Boris')
  expect(JSON.stringify(bib)).toBe(original)
  expect({ entries: [...container.querySelectorAll('[data-find-id]')].map(entry => entry.textContent),
    links: screen.getAllByRole('link').map(link => link.getAttribute('href')) }).toMatchSnapshot()
})

it('only links valid web URLs and DOI identifiers, including encoding DOI fragments', () => {
  const entry = bibliography().entries[0]!
  expect(display.referenceLinks(entry)).toEqual({ doi: 'https://doi.org/10.1234/paired.evidence', url: 'https://example.org/paper' })
  expect(display.referenceLinks({ ...entry, fields: { doi: 'https://doi.org/10.1234/a#b', url: 'javascript:alert(1)' } }))
    .toEqual({ doi: 'https://doi.org/10.1234/a%23b', url: undefined })
  expect(display.referenceLinks({ ...entry, fields: { doi: 'not a DOI', url: 'data:text/html,example' } }))
    .toEqual({ doi: undefined, url: undefined })
  expect(display.referenceLinks({ ...entry, fields: { url: 'https://name:secret@example.org/' } })).toEqual({ doi: undefined, url: undefined })
  expect(display.referenceLinks({ ...entry, fields: { doi: 'doi:10.1234/a', url: 'https://doi.org/10.1234/a' } }))
    .toEqual({ doi: 'https://doi.org/10.1234/a', url: undefined })
})

it('indexes canonical citation occurrences while ignoring code, source comments, and malformed groups', () => {
  const malformed: PaperBlock = { ...blocks[0]!, id: 'bad', text: '[@key0; missing-at] [@1bad] [@empty; @].' }
  const indexed = display.referenceCitationLocations([...blocks, malformed])
  expect(indexed.get('key0')).toEqual([{ blockId: 'opening', occurrence: 0 }, { blockId: 'opening', occurrence: 1 }, { blockId: 'results', occurrence: 0 }])
  expect(indexed.get('key1')).toEqual([{ blockId: 'opening', occurrence: 0 }])
  expect(indexed.size).toBe(2)
})

it('filters title, readable author, year and citation key, including entries not cited in the manuscript', () => {
  render(<Harness bibliography={bibliography(6)} />)
  const filter = screen.getByRole('searchbox', { name: labels.search })
  for (const query of ['multimodal', 'müller', 'key0', '2020']) {
    fireEvent.change(filter, { target: { value: query } })
    expect(document.querySelectorAll('[data-find-id]').length).toBe(1)
    expect(document.querySelector('[data-find-id]')?.getAttribute('data-find-id')).toBe('bib:key0')
  }
  fireEvent.change(filter, { target: { value: 'key5' } })
  expect(screen.getByText(labels.unused)).toBeTruthy()
  fireEvent.change(filter, { target: { value: 'no-match' } })
  expect(screen.getByText(labels.noResults)).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: labels.clear }))
  expect(document.querySelectorAll('[data-find-id]').length).toBe(6)
})

it('keeps one citation scan and at most forty entry DOM nodes across a thousand-entry library', () => {
  const scan = vi.spyOn(display, 'referenceCitationLocations')
  const format = vi.spyOn(display, 'referenceEntryText')
  const bib = bibliography(1000)
  render(<Harness bibliography={bib} />)
  expect(document.querySelectorAll('[data-find-id]').length).toBe(40)
  expect(scan).toHaveBeenCalledTimes(1)
  expect(format).toHaveBeenCalledTimes(1000)
  fireEvent.click(screen.getByRole('button', { name: labels.next }))
  expect(document.querySelector('[data-find-id]')?.getAttribute('data-find-id')).toBe('bib:key40')
  expect(document.querySelectorAll('[data-find-id]').length).toBe(40)
  fireEvent.change(screen.getByRole('searchbox', { name: labels.search }), { target: { value: 'key999' } })
  expect(document.querySelectorAll('[data-find-id]').length).toBe(1)
  expect(scan).toHaveBeenCalledTimes(1)
  expect(format).toHaveBeenCalledTimes(1000)
})

it('reveals a panel-wide search target outside the current filter or page', async () => {
  const bib = bibliography(100)
  const { rerender } = render(<Harness bibliography={bib} initialState={{ ...initial, query: 'not-matched' }} />)
  expect(screen.getByText(labels.noResults)).toBeTruthy()
  rerender(<Harness bibliography={bib} focusedKey="key85" />)
  await waitFor(() => { expect(document.querySelector('[data-find-id="bib:key85"]')).toBeTruthy() })
  expect(screen.getByRole('searchbox', { name: labels.search }).getAttribute('value')).toBe('')
  expect(document.querySelectorAll('[data-find-id]').length).toBe(20)
  expect(screen.getByText('Page 3 / 3')).toBeTruthy()
})

it('navigates to first and successive canonical citations, wrapping after the last occurrence', () => {
  const locate = vi.fn()
  render(<Harness onLocate={locate} />)
  fireEvent.click(screen.getAllByRole('button', { name: labels.locate })[0]!)
  fireEvent.click(screen.getByRole('button', { name: labels.nextCitation }))
  fireEvent.click(screen.getByRole('button', { name: labels.nextCitation }))
  fireEvent.click(screen.getByRole('button', { name: labels.nextCitation }))
  expect(locate.mock.calls).toEqual([['opening', 'key0', 0], ['opening', 'key0', 1], ['results', 'key0', 0], ['opening', 'key0', 0]])
})

it('offers read-only binding callbacks and recoverable errors while keeping the existing library', () => {
  const bind = vi.fn(), choose = vi.fn(), retry = vi.fn()
  render(<Harness onBind={bind} onChoose={choose} onRetry={retry} error="Connection unavailable" />)
  expect(screen.getByRole('alert').textContent).toContain('Connection unavailable')
  expect(document.querySelectorAll('[data-find-id]').length).toBe(2)
  fireEvent.click(screen.getByRole('button', { name: labels.retry }))
  fireEvent.click(screen.getByRole('button', { name: labels.choose }))
  fireEvent.change(screen.getByRole('textbox', { name: labels.path }), { target: { value: ' references/new.bib ' } })
  fireEvent.click(screen.getByRole('button', { name: labels.bind }))
  fireEvent.click(screen.getByRole('button', { name: labels.unbind }))
  expect(retry).toHaveBeenCalledTimes(1)
  expect(choose).toHaveBeenCalledTimes(1)
  expect(bind.mock.calls).toEqual([[['references/example.bib', 'references/new.bib']], [[]]])
})

it('explains an empty library and clamps saved pages after entries shrink', () => {
  const { rerender } = render(<Harness bibliography={bibliography(100)} initialState={{ ...initial, page: 2 }} />)
  expect(screen.getByText('Page 3 / 3')).toBeTruthy()
  rerender(<Harness bibliography={bibliography(1)} />)
  expect(document.querySelector('[data-find-id="bib:key0"]')).toBeTruthy()
  rerender(<Harness bibliography={bibliography(0)} />)
  expect(screen.getByText(labels.noEntries)).toBeTruthy()
  expect(screen.queryByRole('navigation', { name: labels.page })).toBeNull()
})

it('shows loading or an initial retry without permitting a binding that would drop unread files', () => {
  const retry = vi.fn()
  const { rerender } = render(<Harness bibliography={undefined} onRetry={retry} />)
  expect(screen.getByRole('status').textContent).toBe(labels.loading)
  expect(screen.getByRole('button', { name: labels.choose }).hasAttribute('disabled')).toBe(true)
  rerender(<Harness bibliography={undefined} error="Connection unavailable" onRetry={retry} />)
  fireEvent.click(screen.getByRole('button', { name: labels.retry }))
  expect(retry).toHaveBeenCalledTimes(1)
})
