/**
 * Pure project logic shared by the host, the client and the demo server: review units and their status,
 * claim/prose sync, registered-number checks, stage checklists and applying changes.
 */
import type { Change, Claim, Project, ReviewState, Stage } from './model.ts'
import { STAGES } from './model.ts'

/** Stable 53-bit content hash (cyrb53); runs the same in Node and the browser. */
export function contentHash(value: unknown): string {
  const str = JSON.stringify(value)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/**
 * The claim content a paragraph is written from: what the claim says and how strong its evidence is. Rewording an
 * evidence item or a caption does not make prose stale; changed numbers are caught by the number check instead.
 */
export const claimHash = (claim: Claim): string => contentHash([claim.title, claim.statement, claim.evidence.map(e => [e.kind, e.status])])

export interface Unit { key: string, kind: 'thesis' | 'beat' | 'claim' | 'figure' | 'paragraph', id: string, label: string, hash: string }

/** Everything the author reviews, with its current content hash. Paragraph keys include their section. */
export function units(p: Project): Unit[] {
  const out: Unit[] = [{ key: 'thesis', kind: 'thesis', id: 'thesis', label: p.thesis.title || '核心论点', hash: contentHash(p.thesis) }]
  for (const b of p.beats) out.push({ key: `beat:${b.id}`, kind: 'beat', id: b.id, label: b.title, hash: contentHash(b) })
  for (const c of p.claims) out.push({ key: `claim:${c.id}`, kind: 'claim', id: c.id, label: c.title, hash: contentHash(c) })
  for (const f of p.figures) out.push({ key: `figure:${f.id}`, kind: 'figure', id: f.id, label: f.label, hash: contentHash(f) })
  for (const s of p.sections) for (const para of s.paragraphs) {
    out.push({ key: `paragraph:${para.id}`, kind: 'paragraph', id: para.id, label: `${s.heading} · ${para.text.slice(0, 40)}`, hash: contentHash(para.text) })
  }
  return out
}

export type ReviewStatus = 'reviewed' | 'changed' | 'new'
/** reviewed = matches what the author confirmed; changed = confirmed once, edited since; new = never confirmed. */
export function reviewStatus(p: Project, st: ReviewState): Record<string, ReviewStatus> {
  const out: Record<string, ReviewStatus> = {}
  for (const u of units(p)) {
    const r = st.reviewed[u.key]
    out[u.key] = !r ? 'new' : r.hash === u.hash ? 'reviewed' : 'changed'
  }
  return out
}

export interface SyncIssue { paragraph: string, section: string, claim: string, kind: 'claim-changed' | 'claim-missing' | 'unwritten' }
/**
 * Where skeleton and prose disagree: a paragraph written from an older version of its claim, a paragraph citing
 * a removed claim, or (once drafting starts) a claim no paragraph states.
 */
export function syncIssues(p: Project): SyncIssue[] {
  const claims = new Map(p.claims.map(c => [c.id, c]))
  const out: SyncIssue[] = []
  const stated = new Set<string>()
  for (const s of p.sections) for (const para of s.paragraphs) for (const cid of para.claims) {
    stated.add(cid)
    const c = claims.get(cid)
    if (!c) out.push({ paragraph: para.id, section: s.id, claim: cid, kind: 'claim-missing' })
    else if (para.basis[cid] !== claimHash(c)) out.push({ paragraph: para.id, section: s.id, claim: cid, kind: 'claim-changed' })
  }
  if (p.sections.some(s => s.paragraphs.length)) {
    for (const c of p.claims) if (!stated.has(c.id)) out.push({ paragraph: '', section: '', claim: c.id, kind: 'unwritten' })
  }
  return out
}

/** Numbers as written in prose: 4,321 / 0.0056 / 71% / 2.72; years and figure labels are ignored. */
const NUMBER = /(?<![\w.])(\d{1,3}(?:,\d{3})+|\d+\.\d+|\d+)(\s?%)?(?![\w])/g
const normalize = (s: string): string => s.replace(/,/g, '').replace(/\s/g, '')
export interface NumberIssue { where: string, value: string, quote: string }
/**
 * Numbers in claims, evidence and prose that the registry does not contain. Small integers (≤ 20, often counts
 * like "three stages"), years 1900–2100, citation brackets [38–42] and figure/panel references are skipped; the check is a pointer for
 * the author, not a proof.
 */
export function unregisteredNumbers(p: Project): NumberIssue[] {
  const known = new Set(p.numbers.flatMap(n => [normalize(n.value), normalize(n.value).replace(/%$/, '')]))
  const ignored = new Set(p.numberIgnores)
  const out: NumberIssue[] = []
  const scan = (where: string, s: string): void => {
    const cleaned = s.replace(/\[[\d,\s–-]+\]/g, ' ').replace(/\b(?:Fig(?:ure)?s?\.?|ED Fig\.?|Table|Figure S)\s?S?\d+[A-Za-z]?\b/gi, ' ').replace(/\bS\d+[A-Za-z]?\b/g, ' ')
    for (const m of cleaned.matchAll(NUMBER)) {
      const raw = (m[1] ?? '') + (m[2] ?? '')
      const v = normalize(raw), bare = v.replace(/%$/, '')
      const n = Number(bare)
      if (!m[2] && Number.isInteger(n) && (n <= 20 || (n >= 1900 && n <= 2100))) continue
      if (known.has(v) || known.has(bare) || ignored.has(raw.trim()) || ignored.has(`${where}|${raw.trim()}`)) continue
      const at = m.index ?? 0
      out.push({ where, value: raw.trim(), quote: cleaned.slice(Math.max(0, at - 30), at + raw.length + 30).trim() })
    }
  }
  for (const c of p.claims) {
    scan(`claim:${c.id}`, c.statement)
    for (const e of c.evidence) scan(`claim:${c.id}`, e.text)
  }
  for (const s of p.sections) for (const para of s.paragraphs) scan(`paragraph:${para.id}`, para.text)
  return out
}

export interface CheckItem { label: string, ok: boolean, detail: string }
/** Advice for leaving a stage. The author may advance anyway; the list says what will be carried forward. */
export function stageChecklist(p: Project, st: ReviewState, stage: Stage = p.stage): CheckItem[] {
  const open = st.comments.filter(c => c.status === 'open')
  const status = reviewStatus(p, st)
  const count = (prefix: string, s: string): number => Object.entries(status).filter(([k, v]) => k.startsWith(prefix) && v === s).length
  const core = p.claims.filter(c => c.role === 'core')
  const items: CheckItem[] = []
  if (stage === 'materials') {
    items.push({ label: '已登记材料', ok: p.materials.length > 0, detail: `${p.materials.length} 份` })
    items.push({ label: '目标读者与期刊', ok: !!p.audience && !!p.journal, detail: [p.journal, p.audience].filter(Boolean).join(' · ') || '未填写' })
  }
  if (stage === 'skeleton' || stage === 'refine') {
    items.push({ label: '核心论点', ok: !!p.thesis.statement, detail: p.thesis.title || '未写' })
    const empty = p.beats.filter(b => !b.claims.length)
    items.push({ label: '每一拍都有分论点', ok: p.beats.length > 0 && !empty.length, detail: empty.length ? `${empty.length} 拍没有分论点` : `${p.beats.length} 拍` })
  }
  if (stage === 'refine') {
    const weak = core.filter(c => !c.evidence.some(e => e.kind === 'support' && e.status === 'sufficient'))
    items.push({ label: '核心分论点都有充足的支持论据', ok: !weak.length, detail: weak.length ? weak.map(c => c.id).join('、') : `${core.length} 个核心分论点` })
    const gaps = p.claims.flatMap(c => c.evidence.filter(e => e.kind === 'gap'))
    items.push({ label: '缺口都有负责人', ok: gaps.every(g => !!g.owner), detail: `${gaps.length} 个缺口，${gaps.filter(g => !g.owner).length} 个无人负责` })
    const used = new Set(p.claims.flatMap(c => c.evidence.flatMap(e => e.panels.map(pn => `${pn.figure}/${pn.label}`))))
    const orphan = p.figures.flatMap(f => f.panels.filter(pn => !pn.spare && !used.has(`${f.id}/${pn.label}`)).map(pn => `${f.label}${pn.label}`))
    items.push({ label: '每个面板都有论据引用或标为备用', ok: !orphan.length, detail: orphan.length ? `${orphan.length} 个面板无引用` : '全部有归属' })
    const unplaced = p.figures.filter(f => f.placement === 'unplaced')
    items.push({ label: '每张图已定主图或扩展数据', ok: !unplaced.length, detail: unplaced.length ? unplaced.map(f => f.label).join('、') : `${p.figures.length} 张` })
  }
  if (stage === 'draft' || stage === 'read') {
    const sync = syncIssues(p)
    items.push({ label: '正文与骨架同步', ok: !sync.length, detail: sync.length ? `${sync.length} 处不同步` : '全部同步' })
    const nums = unregisteredNumbers(p).filter(n => n.where.startsWith('paragraph:'))
    items.push({ label: '正文数字都有出处', ok: !nums.length, detail: nums.length ? `${nums.length} 个数字不在登记表` : '全部登记' })
  }
  if (stage === 'read' || stage === 'submit') {
    items.push({ label: '段落都已审', ok: count('paragraph:', 'reviewed') > 0 && count('paragraph:', 'new') + count('paragraph:', 'changed') === 0,
      detail: `${count('paragraph:', 'reviewed')} 已审 · ${count('paragraph:', 'changed')} 审后有修改 · ${count('paragraph:', 'new')} 未审` })
  }
  const human = open.filter(c => c.source === 'author' || c.source === 'collaborator' || c.source === 'chat' || c.source === 'check').length
  items.push({ label: '意见都已处理', ok: !open.length, detail: open.length ? `人的意见 ${human} 条、模拟审阅 ${open.length - human} 条未处理` : '没有未处理意见' })
  return items
}

export const nextStage = (s: Stage): Stage => STAGES[Math.min(STAGES.indexOf(s) + 1, STAGES.length - 1)]!

/** Unit keys a change touches; used for history and "changed since review". */
export function changedUnits(change: Change): string[] {
  switch (change.op) {
    case 'set-meta': case 'set-links': case 'ignore-number': return []
    case 'set-thesis': return ['thesis']
    case 'upsert-beat': return [`beat:${change.beat.id}`]
    case 'upsert-claim': return [`claim:${change.claim.id}`]
    case 'upsert-figure': return [`figure:${change.figure.id}`]
    case 'upsert-number': return []
    case 'upsert-section': return change.section.paragraphs.map(x => `paragraph:${x.id}`)
    case 'upsert-paragraph': return [`paragraph:${change.paragraph.id}`]
    case 'remove': return change.unit === 'number' || change.unit === 'section' ? [] : [`${change.unit}:${change.id}`]
  }
}

function upsert<T extends { id: string }>(list: T[], item: T, index?: number): T[] {
  const at = list.findIndex(x => x.id === item.id)
  if (at >= 0) return list.map((x, i) => i === at ? item : x)
  const copy = [...list]
  copy.splice(index ?? copy.length, 0, item)
  return copy
}

/**
 * Apply changes to a copy of the project. Throws on references to unknown sections so a bad agent call fails
 * whole instead of half-applying. A paragraph written without an explicit basis records the current claims.
 */
export function applyChanges(p: Project, changes: Change[]): Project {
  let next: Project = structuredClone(p)
  for (const ch of changes) {
    switch (ch.op) {
      case 'set-meta': next = { ...next, ...Object.fromEntries(Object.entries(ch.fields).filter(([, v]) => v !== undefined)) }; break
      case 'set-thesis': next.thesis = ch.thesis; break
      case 'upsert-beat': next.beats = upsert(next.beats, ch.beat, ch.index); break
      case 'upsert-claim': next.claims = upsert(next.claims, ch.claim); break
      case 'upsert-figure': {
        // agents rarely know file paths: keep the existing file and panel images where the change leaves them empty
        const old = next.figures.find(f => f.id === ch.figure.id)
        const fig = old ? { ...ch.figure, file: ch.figure.file || old.file,
          panels: ch.figure.panels.map(pn => ({ ...pn, image: pn.image || old.panels.find(x => x.label === pn.label)?.image || '' })) } : ch.figure
        next.figures = upsert(next.figures, fig)
        break
      }
      case 'upsert-number': next.numbers = upsert(next.numbers, ch.number); break
      case 'upsert-section': {
        // paragraphs arriving with a section are written from the current claims unless they say otherwise
        const claimsNow = new Map(next.claims.map(c => [c.id, claimHash(c)]))
        const section = { ...ch.section, paragraphs: ch.section.paragraphs.map(x => ({ ...x,
          basis: { ...Object.fromEntries(x.claims.flatMap(cid => claimsNow.has(cid) ? [[cid, claimsNow.get(cid)!]] : [])), ...x.basis } })) }
        next.sections = upsert(next.sections, section, ch.index)
        break
      }
      case 'upsert-paragraph': {
        const s = next.sections.find(x => x.id === ch.section)
        if (!s) throw new Error(`unknown section ${ch.section}`)
        const para = { ...ch.paragraph, basis: { ...ch.paragraph.basis } }
        for (const cid of para.claims) {
          const c = next.claims.find(x => x.id === cid)
          if (c && !para.basis[cid]) para.basis[cid] = claimHash(c)
        }
        const at = s.paragraphs.findIndex(x => x.id === para.id)
        if (at >= 0) s.paragraphs[at] = para
        else {
          const after = ch.after ? s.paragraphs.findIndex(x => x.id === ch.after) : -1
          s.paragraphs.splice(after >= 0 ? after + 1 : s.paragraphs.length, 0, para)
        }
        break
      }
      case 'remove': {
        if (ch.unit === 'paragraph') for (const s of next.sections) s.paragraphs = s.paragraphs.filter(x => x.id !== ch.id)
        else if (ch.unit === 'beat') next.beats = next.beats.filter(x => x.id !== ch.id)
        else if (ch.unit === 'claim') {
          next.claims = next.claims.filter(x => x.id !== ch.id)
          next.beats = next.beats.map(b => ({ ...b, claims: b.claims.filter(x => x !== ch.id) }))
        } else if (ch.unit === 'figure') next.figures = next.figures.filter(x => x.id !== ch.id)
        else if (ch.unit === 'number') next.numbers = next.numbers.filter(x => x.id !== ch.id)
        else next.sections = next.sections.filter(x => x.id !== ch.id)
        break
      }
      case 'set-links': next.links = ch.links; break
      case 'ignore-number': {
        const key = ch.where ? `${ch.where}|${ch.value}` : ch.value
        if (!next.numberIgnores.includes(key)) next.numberIgnores = [...next.numberIgnores, key]
        break
      }
    }
  }
  return next
}

/** Mark a paragraph as rewritten from the current claims (after the author accepts it as in sync). */
export function resyncBasis(p: Project, paragraphId: string): Project {
  const next = structuredClone(p)
  for (const s of next.sections) for (const para of s.paragraphs) if (para.id === paragraphId) {
    for (const cid of para.claims) {
      const c = next.claims.find(x => x.id === cid)
      if (c) para.basis[cid] = claimHash(c)
    }
  }
  return next
}
