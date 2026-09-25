/** Keyboard-accessible selection menu, portaled outside the scrolling reader. */
import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './panel.module.css'

/**
 * Dismiss on outside interaction, scrolling or Escape without changing the saved selection.
 * @param props - viewport position and explicit actions.
 * @returns contextual operator controls.
 */
export function SelectionMenu({ x, y, title, items, close }: {
  x: number
  y: number
  title: string
  items: { label: string; color?: string; disabled?: boolean; run: () => void }[]
  close: () => void
}): ReactNode {
  const root = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState({ left: x, top: y })
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const bounds = element.getBoundingClientRect()
    setPosition({ left: Math.max(8, Math.min(x, window.innerWidth - bounds.width - 8)),
      top: Math.max(8, Math.min(y, window.innerHeight - bounds.height - 8)) })
    element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
    const outside = (event: Event): void => { if (event.target instanceof Node && !element.contains(event.target)) close() }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('scroll', outside, true)
    window.addEventListener('resize', close)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('scroll', outside, true)
      window.removeEventListener('resize', close)
    }
  }, [x, y, close])
  return createPortal(<div ref={root} role="menu" aria-label={title} className={css.selectionMenu} style={position}
    onKeyDown={(event) => {
      if (event.key === 'Escape' || event.key === 'Tab') { close(); return }
      const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      const index = buttons.findIndex(button => button === document.activeElement)
      const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length
        : event.key === 'ArrowUp' ? (index + buttons.length - 1) % buttons.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : undefined
      if (next !== undefined) { event.preventDefault(); buttons[next]?.focus() }
    }}>
    <div className={css.menuTitle}>{title}</div>
    {items.map(item => <button key={item.label} role="menuitem" disabled={item.disabled} onClick={() => { close(); item.run() }}>
      {item.color && <span aria-hidden="true" className={css.swatch} data-color={item.color} />}{item.label}
    </button>)}
  </div>, document.body)
}
