/** One fixed skill entry for a supplied document path or exact pasted article. */
import { useId, useRef, useState } from 'react'
import type { ArticleInput } from '../article-input.ts'
import type { PaperReviewKey } from './locales.ts'
import css from './panel.module.css'

export interface ArticleImportProps {
  running: boolean
  t: (key: PaperReviewKey) => string
  start: (input: ArticleInput, signal: AbortSignal) => Promise<void>
  onStarted: () => void
}

export function ArticleImport({ running, t, start, onStarted }: ArticleImportProps) {
  const dialog = useRef<HTMLDialogElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const [kind, setKind] = useState<'file' | 'text'>('file')
  const [source, setSource] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const heading = useId()
  async function submit() {
    if (busy || running) return
    setBusy(true); setError('')
    try {
      await start(kind === 'file' ? { source: source.trim() } : { text }, new AbortController().signal)
      dialog.current?.close(); onStarted()
    } catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)) }
    finally { setBusy(false) }
  }
  return <>
    <button disabled={running || busy} onClick={() => { setError(''); dialog.current?.showModal(); input.current?.focus() }}>{t('importArticle')}</button>
    <dialog ref={dialog} className={css.articleImport} aria-labelledby={heading}>
      <form onSubmit={event => { event.preventDefault(); void submit() }}>
        <h3 id={heading}>{t('importArticle')}</h3>
        <p>{t('importArticleHelp')}</p>
        <div className={css.articleImportKinds}>
          <label><input type="radio" checked={kind === 'file'} onChange={() => { setKind('file') }} />{t('importArticleFile')}</label>
          <label><input type="radio" checked={kind === 'text'} onChange={() => { setKind('text') }} />{t('importArticleText')}</label>
        </div>
        {kind === 'file' ? <label>{t('importArticlePath')}<input ref={input} value={source} onChange={event => { setSource(event.target.value) }} placeholder="papers/draft.pdf" required /></label>
          : <label>{t('importArticleText')}<textarea value={text} onChange={event => { setText(event.target.value) }} required /></label>}
        {error && <p role="alert" className={css.error}>{error}</p>}
        <div className={css.articleImportActions}>
          <button type="button" disabled={busy} onClick={() => { dialog.current?.close() }}>{t('cancel')}</button>
          <button type="submit" disabled={busy || running || !(kind === 'file' ? source.trim() : text.trim())}>{t(busy ? 'loading' : 'startArticleReview')}</button>
        </div>
      </form>
    </dialog>
  </>
}
