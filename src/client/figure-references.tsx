/** Interaction overlays preserve the Markdown text nodes used by selections and annotations. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactNode } from 'react'
import { figureReferences } from './reading-figures.ts'
import type { FigureReference, ReadingFigure } from './reading-figures.ts'
import css from './reading.module.css'

export interface FigureReferenceActions {
  items: ReadingFigure[]; windowId: string; selectedKey?: string | undefined
  onPreview: (key: string, element: HTMLElement, source?: string) => void
  onLeave: () => void; onOpen: (key: string, element: HTMLElement) => void
}
interface PositionedReference { reference: FigureReference; range: Range; rects: { x: number; y: number; width: number; height: number }[] }
/** Build ranges over the original rendered text, excluding authored links, code and math. */
export function referenceRanges(root: HTMLElement, items: ReadingFigure[]): { reference: FigureReference; range: Range }[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes: { node: Node; start: number; end: number }[] = []
  let offset = 0
  for (let node = walker.nextNode(); node; node = walker.nextNode()) { const end = offset + (node.textContent?.length ?? 0); nodes.push({ node, start: offset, end }); offset = end }
  return figureReferences(root.textContent ?? '', items).flatMap(reference => {
    const covered = nodes.filter(item => item.end > reference.start && item.start < reference.end)
    if (!covered.length || covered.some(item => item.node.parentElement?.closest('a,button,code,pre,math,.katex,[aria-hidden=true]'))) return []
    const first = covered[0]!, last = covered.at(-1)!, range = document.createRange()
    range.setStart(first.node, reference.start - first.start); range.setEnd(last.node, reference.end - last.start)
    return [{ reference, range }]
  })
}
export function FigureReferences({ actions, children }: { actions: FigureReferenceActions; children: ReactNode }): ReactNode {
  const root = useRef<HTMLDivElement>(null), buttons = useRef(new Map<number, HTMLButtonElement>())
  const [references, setReferences] = useState<PositionedReference[]>([]), [over, setOver] = useState<number>()
  const current = useRef(actions); current.current = actions
  const hovered = useRef<number>()
  useLayoutEffect(() => {
    const node = root.current
    if (!node) return
    const ranges = referenceRanges(node, actions.items)
    const measure = (): void => {
      const box = node.getBoundingClientRect()
      setReferences(ranges.map(item => ({ ...item, rects: typeof item.range.getClientRects === 'function' ? [...item.range.getClientRects()].filter(rect => rect.width > 0).map(rect => ({ x: rect.left - box.left, y: rect.top - box.top, width: rect.width, height: rect.height })) : [] })))
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(node); window.addEventListener('resize', measure)
    let live = true
    void document.fonts?.ready.then(() => { if (live) measure() })
    return () => { live = false; observer?.disconnect(); window.removeEventListener('resize', measure) }
  }, [actions.items, children])
  const hit = (x: number, y: number): number | undefined => references.findIndex(item => typeof item.range.getClientRects === 'function' && [...item.range.getClientRects()].some(rect => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom))
  const hasSelection = (): boolean => Boolean(window.getSelection()?.toString().trim())
  const open = (index: number): void => { const item = references[index], trigger = buttons.current.get(index); if (item && trigger) current.current.onOpen(item.reference.item.key, trigger) }
  const click = (event: MouseEvent): void => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey || hasSelection()) return
    const index = hit(event.clientX, event.clientY)
    if (index === undefined || index < 0) return
    event.preventDefault(); event.stopPropagation(); open(index)
  }
  return <div ref={root} className={css.inlineFigureText} data-inline-figures data-over-figure={over !== undefined}
    onPointerMove={event => {
      if (event.pointerType === 'touch') return
      const index = event.buttons ? undefined : hit(event.clientX, event.clientY), next = index === -1 ? undefined : index
      if (next === hovered.current) return
      hovered.current = next; setOver(next)
      const item = next === undefined ? undefined : references[next], trigger = next === undefined ? undefined : buttons.current.get(next)
      if (item && trigger) current.current.onPreview(item.reference.item.key, trigger, event.pointerType)
      else current.current.onLeave()
    }} onPointerLeave={() => { hovered.current = undefined; setOver(undefined); current.current.onLeave() }}
    onMouseUpCapture={event => { if (!hasSelection() && (hit(event.clientX, event.clientY) ?? -1) >= 0) event.stopPropagation() }} onClick={click}>
    {children}
    {references.map((item, index) => <span key={`${item.reference.start}:${item.reference.item.key}`} className={css.referenceLayer}>
      {item.rects.slice(1).map((rect, fragment) => <span key={fragment} className={css.referenceMark} style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }} aria-hidden="true" />)}
      <button ref={node => { if (node) buttons.current.set(index, node); else buttons.current.delete(index) }} type="button"
        className={css.inlineFigureReference} aria-label={item.reference.label} aria-haspopup="dialog" aria-controls={actions.windowId}
        aria-expanded={actions.selectedKey === item.reference.item.key} data-inline-figure={item.reference.item.key}
        style={{ left: item.rects[0]?.x ?? 0, top: item.rects[0]?.y ?? 0, width: item.rects[0]?.width ?? 0, height: item.rects[0]?.height ?? 0 }}
        onFocus={event => { current.current.onPreview(item.reference.item.key, event.currentTarget, 'focus') }} onBlur={() => { current.current.onLeave() }}
        onClick={event => { event.preventDefault(); event.stopPropagation(); open(index) }} />
    </span>)}
  </div>
}
