/** Searchable, paginated bibliography index with manuscript citation navigation. */
import { useEffect, useMemo, useRef } from 'react'
import type { ReactNode } from 'react'
import type { BibliographyView, PaperBlock } from '../schema.ts'
import { plainBibText, referenceCitationLocations, referenceEntryText, referenceLinks } from './bib-display.ts'
import { PaperIcon } from './icons.tsx'
import css from './references.module.css'

/** Locale-owned copy for bibliography filtering, binding, navigation, and recovery. */
export interface ReferencesLabels {
  title: string
  help: string
  sources: string
  none: string
  unbind: string
  path: string
  pathHint: string
  bind: string
  choose: string
  missing: string
  legacy: string
  entries: string
  loading: string
  retry: string
  search: string
  searchHint: string
  noEntries: string
  noResults: string
  clear: string
  previous: string
  next: string
  page: string
  showing: string
  citationCount: string
  locate: string
  nextCitation: string
  unused: string
  doi: string
  url: string
}

/** Transient view preferences owned by the panel so tab changes do not reset the list. */
export interface ReferencesState { query: string; page: number; nextCitation: Record<string, number> }

/** Callbacks keep source binding and manuscript navigation under the parent panel's ownership. */
export interface ReferencesProps {
  bibliography?: BibliographyView | undefined
  blocks: readonly PaperBlock[]
  busy: boolean
  error?: string | undefined
  path: string
  onPathChange: (path: string) => void
  onBind: (files: string[]) => void
  onChoose: () => void
  onRetry: () => void
  onLocate: (blockId: string, key: string, occurrence: number) => void
  labels: ReferencesLabels
  state: ReferencesState
  onStateChange: (state: ReferencesState) => void
  focusedKey?: string | undefined
}

const PAGE_SIZE = 40

/** Render at most forty entries while retaining all metadata for filtering and global find.
 * @param props - authoritative bibliography projection, localized controls, and controlled list state.
 * @returns a bounded reference list; actions only dispatch parent-owned callbacks.
 */
export function References(props: ReferencesProps): ReactNode {
  const { bibliography: bib, blocks, busy, error, path, onPathChange, onBind, onChoose, onRetry,
    onLocate, labels, state, onStateChange, focusedKey } = props
  const indexed = useMemo(() => bib?.entries.map(entry => ({ entry,
    search: referenceEntryText(entry).toLocaleLowerCase() })) ?? [], [bib?.entries])
  const citations = useMemo(() => referenceCitationLocations(blocks), [blocks])
  const query = state.query.trim().toLocaleLowerCase()
  const filtered = useMemo(() => query ? indexed.filter(({ search }) => search.includes(query)) : indexed, [indexed, query])
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const page = Math.max(0, Math.min(state.page, pages - 1))
  const first = page * PAGE_SIZE
  const update = useRef({ state, onStateChange })
  update.current = { state, onStateChange }
  useEffect(() => {
    if (!focusedKey) return
    const index = bib?.entries.findIndex(entry => entry.key === focusedKey) ?? -1
    if (index < 0) return
    update.current.onStateChange({ ...update.current.state, query: '', page: Math.floor(index / PAGE_SIZE) })
  }, [focusedKey, bib?.entries])
  const locate = (key: string, start: boolean): void => {
    const locations = citations.get(key) ?? []
    if (!locations.length) return
    const index = start ? 0 : (state.nextCitation[key] ?? 0) % locations.length
    const location = locations[index]
    if (!location) return
    onStateChange({ ...state, nextCitation: { ...state.nextCitation, [key]: (index + 1) % locations.length } })
    onLocate(location.blockId, key, location.occurrence)
  }
  return <section className={css.references} aria-label={labels.title}>
    <h3>{labels.title}</h3><p className={css.help}>{labels.help}</p>
    {error && <div role="alert" className={css.error}><p>{error}</p><button disabled={busy} onClick={onRetry}>
      <PaperIcon kind="refresh" />{labels.retry}</button></div>}
    {!bib && !error && <p role="status">{labels.loading}</p>}
    <details className={css.sources} open={!bib?.files.length}>
      <summary>{labels.sources}{bib && ` (${bib.files.length})`}</summary>
      {!bib?.files.length && <p>{labels.none}</p>}
      {bib?.files.map(file => <div key={file}><code title={file}>{file}</code><button disabled={busy}
        onClick={() => { onBind(bib.files.filter(item => item !== file)) }}>{labels.unbind}</button></div>)}
      <form className={css.bind} onSubmit={(event) => {
        event.preventDefault()
        if (bib && path.trim() && !bib.files.includes(path.trim())) onBind([...bib.files, path.trim()])
      }}>
        <input aria-label={labels.path} placeholder={labels.pathHint} value={path}
          onChange={(event) => { onPathChange(event.target.value) }} />
        <button disabled={busy || !bib || !path.trim() || bib.files.includes(path.trim())}>{labels.bind}</button>
        <button type="button" disabled={busy || !bib} onClick={onChoose}><PaperIcon kind="folder" />{labels.choose}</button>
      </form>
    </details>
    {bib && <>
      {(bib.missingKeys.length > 0 || bib.possibleBareKeys.length > 0) && <div className={css.warnings}>
        {bib.missingKeys.length > 0 && <p><strong>{labels.missing}</strong> {bib.missingKeys.join(', ')}</p>}
        {bib.possibleBareKeys.length > 0 && <p><strong>{labels.legacy}</strong> {bib.possibleBareKeys.join(', ')}</p>}
      </div>}
      <div className={css.filter}><label>{labels.search}<input type="search" aria-label={labels.search}
        placeholder={labels.searchHint} value={state.query}
        onChange={(event) => { onStateChange({ ...state, query: event.target.value, page: 0 }) }} /></label>
      {state.query && <button onClick={() => { onStateChange({ ...state, query: '', page: 0 }) }}>{labels.clear}</button>}</div>
      <div className={css.listHeader}><h4>{labels.entries} ({bib.entries.length})</h4>
        <span role="status">{labels.showing} {filtered.length ? first + 1 : 0}–{Math.min(first + PAGE_SIZE, filtered.length)} / {filtered.length}</span></div>
      {!filtered.length && <p className={css.help}>{bib.entries.length ? labels.noResults : labels.noEntries}</p>}
      <div className={css.entries}>{filtered.slice(first, first + PAGE_SIZE).map(({ entry }) => {
        const locations = citations.get(entry.key) ?? []
        const links = referenceLinks(entry)
        return <article key={entry.key} data-find-id={`bib:${entry.key}`} className={css.entry}>
          <div className={css.entryHeader}><code>[@{entry.key}]</code><span>{locations.length ? `${labels.citationCount} ${locations.length}` : labels.unused}</span></div>
          <h4>{plainBibText(entry.fields.title) || entry.key}</h4>
          <p>{[plainBibText(entry.fields.author), plainBibText(entry.fields.year)].filter(Boolean).join(' · ')}</p>
          {(entry.fields.journal ?? entry.fields.booktitle) && <p className={css.help}>
            {plainBibText(entry.fields.journal ?? entry.fields.booktitle)}</p>}
          <small title={entry.file}>{entry.file}</small>
          <div className={css.actions}>{locations.length > 0 && <>
            <button onClick={() => { locate(entry.key, true) }}><PaperIcon kind="read" />{labels.locate}</button>
            {locations.length > 1 && <button onClick={() => { locate(entry.key, false) }}>{labels.nextCitation}</button>}
          </>}
          {links.doi && <a href={links.doi} target="_blank" rel="noopener noreferrer">{labels.doi}: {plainBibText(entry.fields.doi)}</a>}
          {links.url && <a href={links.url} target="_blank" rel="noopener noreferrer">{labels.url}: {plainBibText(entry.fields.url)}</a>}</div>
        </article>
      })}</div>
      {pages > 1 && <nav className={css.pagination} aria-label={labels.page}>
        <button disabled={page === 0} onClick={() => { onStateChange({ ...state, page: page - 1 }) }}><PaperIcon kind="up" />{labels.previous}</button>
        <span>{labels.page} {page + 1} / {pages}</span>
        <button disabled={page + 1 >= pages} onClick={() => { onStateChange({ ...state, page: page + 1 }) }}>{labels.next}<PaperIcon kind="down" /></button>
      </nav>}
    </>}
  </section>
}
