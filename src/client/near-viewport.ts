/** One observer per scroll root and margin, shared by reader blocks, comparisons and previews. */
import { useEffect, useState } from 'react'
import type { RefObject } from 'react'

type Pool = { observer: IntersectionObserver; targets: Map<Element, () => void> }
const roots = new WeakMap<Element, Map<string, Pool>>()
const windowPools = new Map<string, Pool>()

/** Observe once and release idle observers; mounting a far-away search target still reveals it normally. */
export function observeNearViewport(element: Element, activate: () => void, margin: string): () => void {
  const root = element.closest('[data-paper-scroll]')
  let pools = root ? roots.get(root) : windowPools
  if (!pools) { pools = new Map(); if (root) roots.set(root, pools) }
  let pool = pools.get(margin)
  if (!pool) {
    const targets = new Map<Element, () => void>()
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue
        const callback = targets.get(entry.target)
        if (!callback) continue
        targets.delete(entry.target); observer.unobserve(entry.target); callback()
      }
      if (targets.size === 0) { observer.disconnect(); pools.delete(margin) }
    }, { root, rootMargin: margin })
    pool = { observer, targets }; pools.set(margin, pool)
  }
  const owned = pool
  owned.targets.set(element, activate); owned.observer.observe(element)
  return () => {
    owned.targets.delete(element); owned.observer.unobserve(element)
    if (owned.targets.size === 0) {
      owned.observer.disconnect()
      if (pools.get(margin) === owned) pools.delete(margin)
    }
  }
}

/** Retain activated content so scrolling never discards text selections or changes measured heights. */
export function useNearViewport(root: RefObject<HTMLElement>, enabled = true, margin = '600px 0px'): boolean {
  const [visible, setVisible] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    if (visible || !enabled || !root.current) return
    return observeNearViewport(root.current, () => { setVisible(true) }, margin)
  }, [visible, enabled, root, margin])
  return visible
}
