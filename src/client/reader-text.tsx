/** Paint persisted selections without rewriting Markdown or React-owned text nodes. */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { Annotation, BibliographyView, PaperBlock, PaperHighlight } from '../schema.ts'
import { displayCitations } from './citation-display.ts'
import { normalizeLegacyTableDividers } from './legacy-tables.ts'
import { anchorRange, captureSelection } from './selection.ts'
import type { TextAnchor } from './selection.ts'
import { useRenderedChange } from './rendered-diff.tsx'

/**
 * Render and paint a single block; registrations are private to this mount and removed on disposal.
 * @param props - source, attached marks, localized chrome and selection handlers.
 * @returns source-preserving reader text.
 */
export function ReaderText({ block, highlights, annotations, labels, bibliography, onSelect, onMenu, comparison }: {
  block: PaperBlock
  highlights: PaperHighlight[]
  annotations: Annotation[]
  labels: { code: { copyLabel: string; copiedLabel: string }; footnotes: string }
  bibliography?: BibliographyView | undefined
  onSelect?: (anchor?: TextAnchor) => void
  onMenu?: (event: MouseEvent, anchor?: TextAnchor) => void
  comparison?: { opposite: string; side: 'before' | 'after' }
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const name = `paper-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const highlightCSS = `::highlight(${name}-yellow){background:var(--paper-highlight-yellow);color:var(--paper-highlight-text)}::highlight(${name}-green){background:var(--paper-highlight-green);color:var(--paper-highlight-text)}::highlight(${name}-blue){background:var(--paper-highlight-blue);color:var(--paper-highlight-text)}::highlight(${name}-underline){text-decoration:underline 2px var(--paper-underline)}::highlight(${name}-note){text-decoration:underline dotted var(--paper-note) 2px}`
  const [rendered, setRendered] = useState(() => typeof IntersectionObserver === 'undefined')
  const displayText = useMemo(() => block.kind === 'code' || block.kind === 'html'
    ? block.text : normalizeLegacyTableDividers(displayCitations(block.text, bibliography?.entries ?? [])),
  [block.kind, block.text, bibliography?.entries])
  const diffCSS = useRenderedChange(root, block.text, comparison?.opposite, comparison?.side ?? 'before', rendered)
  const marked = highlights.some(h => !h.removed && h.anchor === 'attached') || annotations.some(a => a.anchor === 'attached' && a.status === 'open')
  useEffect(() => {
    if (rendered || !root.current) return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) { setRendered(true); observer.disconnect() }
    }, { root: root.current.closest('[data-paper-scroll]'), rootMargin: '600px 0px' })
    observer.observe(root.current)
    return () => { observer.disconnect() }
  }, [rendered])
  useEffect(() => {
    if (!rendered || !marked || !root.current || typeof Highlight === 'undefined') return
    const registered: string[] = []
    const groups: Record<string, Range[]> = { yellow: [], green: [], blue: [], underline: [], note: [] }
    for (const mark of highlights.filter(h => !h.removed && h.anchor === 'attached')) {
      const range = anchorRange(root.current, mark)
      if (range) groups[mark.color]?.push(range)
    }
    for (const note of annotations.filter(a => a.anchor === 'attached' && a.status === 'open')) {
      const range = anchorRange(root.current, note)
      if (range) groups.note?.push(range)
    }
    for (const [color, ranges] of Object.entries(groups)) {
      if (ranges.length === 0) continue
      const key = `${name}-${color}`
      CSS.highlights.set(key, new Highlight(...ranges))
      registered.push(key)
    }
    return () => { for (const key of registered) CSS.highlights.delete(key) }
  }, [block.text, highlights, annotations, name, rendered, marked])
  return <>{rendered && marked && <style>{highlightCSS}</style>}{diffCSS && <style>{diffCSS}</style>}
    <div ref={root} data-reader-text onMouseUp={onSelect ? (event) => {
      if (event.button === 0 && root.current) onSelect(captureSelection(root.current))
    } : undefined} onContextMenu={onMenu ? (event) => { if (root.current) onMenu(event, captureSelection(root.current)) } : undefined}>
      {rendered ? <MarkdownText text={displayText} labels={labels} />
        : <div data-reader-placeholder aria-hidden="true" style={{ minHeight: Math.max(36, Math.ceil(block.text.length / 42) * 29) }} />}
    </div></>
}
