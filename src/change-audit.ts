/** Browser-safe, deterministic lexical evidence. This does not validate scientific truth. */
export type ChangeCategory = 'numbers' | 'citations' | 'figures' | 'claim-language'
/** Exact source span; offsets use JavaScript UTF-16 indices, as manuscript blocks do. */
export type ChangeToken = { text: string; start: number; end: number }
/** Bounded examples plus full counts; an empty result is not scientific approval. */
export type ChangeEvidence = {
  category: ChangeCategory
  before: ChangeToken[]
  after: ChangeToken[]
  beforeCount: number
  afterCount: number
  truncated: boolean
}

const unit = String.raw`(?:[fpnumcdkMGTµμ]?mol|[fpnumcdkMGTµμ]?g|[fpnumcdkMGTµμ]?[lL]|[fpnumcdkMGTµμ]?M|[fpnumcdkMGTµμ]?m|[fpnumcdkMGTµμ]?s|[kMGT]?Hz|mmHg|[cm]?Gy|Bq|IU|U|K|°[CF]|min|h|days?|weeks?|months?|years?|fold)`
const comparator = String.raw`(?:<=|>=|!=|[<>≤≥=≠≈~]|\\(?:leq?|geq?|neq|approx|sim))`
const number = String.raw`(?:[+\-−±]\s*)?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?|\.\d+)(?:[eE][+\-−]?\d+)?`
const exponent = String.raw`(?:\^?[−\-]?\d+|[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+)?`
const units = String.raw`(?:[%‰]|${unit}${exponent}(?:\s*\/\s*${unit}${exponent})*(?![\p{L}]))`
const quantity = new RegExp(String.raw`(?:${comparator}\s*|(?<![\p{L}\p{N}_.]))${number}(?:\s*${units})?`, 'gu')

const patterns: readonly [ChangeCategory, RegExp][] = [
  ['numbers', quantity],
  ['citations', /\[@[^\]]+\]|\[cite:\s*[^\]]+\]|\\cite\w*\{[^}]+\}|\[\d+(?:[-,–]\s*\d+)*\]|\b[a-z][a-z0-9:_-]*(?:19|20)\d{2}[a-z]?\b/g],
  ['figures', /\b(?:fig(?:ure)?\.?|table|supplement(?:ary)?|extended data)\s*[\da-z.()-]+/gi],
  ['claim-language', /\b(?:all|always|never|consistently|significant(?:ly)?|robust(?:ly)?|generali[sz]\w*|caus\w*|prove\w*|superior|outperform\w*|novel|first|only|may|might|not|no|cannot)\b|所有|显著|因果|证明|泛化|优于|首次|可能|未|不/g],
]

function normalized(token: ChangeToken, category: ChangeCategory): string {
  // Do not lowercase SI units: mM and mm do not mean the same thing.
  return category === 'numbers' ? token.text.replace(/\s+/g, '').replaceAll('μ', 'µ').replaceAll('−', '-') : token.text
}

/**
 * Compare ordered lexical tokens; swapped values remain visible even if their multisets match.
 * @param before - exact replaced source, or empty for an insertion.
 * @param after - proposed exact source.
 * @param limit - maximum examples on each side, from 1 to 100.
 * @returns only changed categories with bounded, source-grounded evidence.
 */
export function auditTextChanges(before: string, after: string, limit = 12): ChangeEvidence[] {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError('Evidence limit must be an integer between 1 and 100')
  const changes: ChangeEvidence[] = []
  for (const [category, pattern] of patterns) {
    const tokens = (source: string): ChangeToken[] => [...source.matchAll(new RegExp(pattern))]
      .map(match => ({ text: match[0], start: match.index, end: match.index + match[0].length }))
    const left = tokens(before), right = tokens(after)
    let start = 0, leftEnd = left.length, rightEnd = right.length
    while (start < leftEnd && start < rightEnd && normalized(left[start]!, category) === normalized(right[start]!, category)) start++
    while (leftEnd > start && rightEnd > start && normalized(left[leftEnd - 1]!, category) === normalized(right[rightEnd - 1]!, category)) { leftEnd--; rightEnd-- }
    if (start === leftEnd && start === rightEnd) continue
    const beforeCount = leftEnd - start, afterCount = rightEnd - start
    changes.push({ category, before: left.slice(start, Math.min(leftEnd, start + limit)),
      after: right.slice(start, Math.min(rightEnd, start + limit)), beforeCount, afterCount,
      truncated: beforeCount > limit || afterCount > limit })
  }
  return changes
}
