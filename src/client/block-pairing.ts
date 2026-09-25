/** Read-only alignment of historical Markdown blocks for visual comparison. */
import { diffWordsWithSpace } from 'diff'
import type { PaperBlock } from '../schema.ts'

type Candidate = { old: number; next: number; score: number }
type Anchor = { old: number; next: number }

/** Compare source overlap without treating a shared Markdown type as evidence of identity. */
function similarity(old: PaperBlock, next: PaperBlock): number {
  if (old.kind !== next.kind || old.text.length + next.text.length > 40000) return 0
  const common = diffWordsWithSpace(old.text, next.text).reduce((count, part) =>
    count + (part.added || part.removed ? 0 : part.value.length), 0)
  return 2 * common / (old.text.length + next.text.length)
}

/**
 * Pair blocks for display without changing their stored ids or annotation anchors.
 * Exact ids delimit gaps; within a bounded gap, only mutually distinctive similar blocks pair.
 * @param before - blocks from the left revision.
 * @param after - blocks from the right revision.
 * @returns left id to right id; uncertain insertions and rewrites remain unpaired.
 */
export function pairRevisionBlocks(before: PaperBlock[], after: PaperBlock[]): Map<string, string> {
  const rightIndex = new Map(after.map((block, index) => [block.id, index]))
  const pairs = new Map<string, string>()
  const pairedRight = new Set<string>()
  const anchors: Anchor[] = [{ old: -1, next: -1 }]
  let lastRight = -1
  for (const [index, block] of before.entries()) {
    const match = rightIndex.get(block.id)
    if (match === undefined) continue
    pairs.set(block.id, block.id)
    pairedRight.add(block.id)
    if (match > lastRight) { anchors.push({ old: index, next: match }); lastRight = match }
  }
  anchors.push({ old: before.length, next: after.length })

  for (let gap = 1; gap < anchors.length; gap++) {
    const left = anchors[gap - 1]
    const right = anchors[gap]
    if (!left || !right) continue
    const old = before.slice(left.old + 1, right.old).filter(block => !pairs.has(block.id))
    const next = after.slice(left.next + 1, right.next).filter(block => !pairedRight.has(block.id))
    if (old.length === 0 || next.length === 0 || old.length * next.length > 256) continue
    const minimum = left.old >= 0 && right.old < before.length ? 0.32 : 0.45
    const candidates: Candidate[] = []
    for (const [oldIndex, oldBlock] of old.entries()) {
      for (const [nextIndex, nextBlock] of next.entries()) {
        const score = similarity(oldBlock, nextBlock)
        if (score >= minimum) candidates.push({ old: oldIndex, next: nextIndex, score })
      }
    }
    const best = (matches: Candidate[]): Candidate | undefined => matches.sort((a, b) => b.score - a.score)[0]
    const distinctive = (candidate: Candidate, matches: Candidate[]): boolean => {
      const runnerUp = matches.sort((a, b) => b.score - a.score)[1]
      return !runnerUp || candidate.score - runnerUp.score >= 0.08
    }
    const selected = candidates.filter((candidate) => {
      const oldMatches = candidates.filter(other => other.old === candidate.old)
      const nextMatches = candidates.filter(other => other.next === candidate.next)
      return best(oldMatches) === candidate && best(nextMatches) === candidate
        && distinctive(candidate, oldMatches) && distinctive(candidate, nextMatches)
    }).sort((a, b) => a.old - b.old)
    if (selected.some((candidate, index) => {
      const previous = selected[index - 1]
      return previous && candidate.next <= previous.next
    })) continue
    for (const candidate of selected) {
      const beforeBlock = old[candidate.old]
      const afterBlock = next[candidate.next]
      if (beforeBlock && afterBlock) pairs.set(beforeBlock.id, afterBlock.id)
    }
  }
  return pairs
}
