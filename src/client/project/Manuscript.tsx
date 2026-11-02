/**
 * The prose, in two modes. Draft: sections built from beats, each paragraph tagged with the claims it states,
 * with sync and number warnings and the agent actions that fix them. Read: the text as a reader meets it, with
 * the figure panels of the paragraph in focus beside it; selecting text starts a comment on that paragraph.
 */
import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Claim, Draft as RewriteDraft, Paragraph } from '../../project/model.ts'
import { claimHash } from '../../project/units.ts'
import type { ProjectView } from '../../project/store.ts'
import type { ProjectActions, AgentTask } from './actions.ts'
import { ReviewDot, WordDiff, cx, Empty, paraLabel } from './common.tsx'
import { AssetImg } from './common.tsx'
import type { Focus } from './StoryFlow.tsx'
import css from './project.module.css'

/** Paragraph text with registry-missing numbers marked; each mark opens the number actions. */
function Marked({ text, values, onPick }: { text: string, values: string[], onPick: (value: string, el: HTMLElement) => void }): ReactNode {
  if (!values.length) return <>{text}</>
  const parts: ReactNode[] = []
  let rest = text, i = 0
  while (rest) {
    let best = -1, hit = ''
    // whole numbers only: "411" must not light up inside "2,411"
    for (const v of values) {
      const m = new RegExp(`(?<![\\d.,])${v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\d])`).exec(rest)
      if (m && (best < 0 || m.index < best)) { best = m.index; hit = v }
    }
    if (best < 0) { parts.push(rest); break }
    const value = hit
    parts.push(rest.slice(0, best), <mark key={i++} data-num={value} className={css.numMark} tabIndex={0} title="不在数字登记表：点击处理"
      onClick={e => onPick(value, e.currentTarget)} onKeyDown={e => { if (e.key === 'Enter') onPick(value, e.currentTarget) }}>{hit}</mark>)
    rest = rest.slice(best + hit.length)
  }
  return <>{parts}</>
}

/**
 * Actions for one unregistered number: register it, keep it unregistered with a stated reason (here or everywhere), or
 * note it for checking. Each action can move straight on to the next number.
 */
function NumberPop({ value, where, at, view, actions, onClose }: {
  value: string, where: string, at: { x: number, y: number }, view: ProjectView, actions: ProjectActions, onClose: (next: boolean) => void,
}): ReactNode {
  const hint = view.numberHints[`${where}|${value}`]
  const [label, setLabel] = useState(hint?.kind === 'result' || hint?.kind === 'parameter' ? hint.note : '')
  const [source, setSource] = useState('')
  const [reason, setReason] = useState(hint && hint.kind !== 'result' ? `${hint.kind === 'parameter' ? '方法参数' : hint.kind === 'citation' ? '引用编号' : '非结论'}：${hint.note}` : '')
  const [next, setNext] = useState(true)
  const done = async (fn: () => Promise<unknown>): Promise<void> => { await fn(); onClose(next) }
  const para = where.replace(/^paragraph:/, '')
  return <div className={css.pop} style={{ left: Math.min(at.x, window.innerWidth - 340), top: Math.min(at.y + 8, window.innerHeight - 420) }} role="dialog" aria-label={`数字 ${value}`}>
    <div className={css.cardHead}>数字 {value} 不在登记表</div>
    {hint && <div className={css.muted}>agent 判断：<b>{({ result: '结果', parameter: '方法参数', citation: '引用编号', other: '其他' })[hint.kind]}</b> · {hint.note}</div>}
    <div className={css.k}>登记它（写明出处）</div>
    <input placeholder="是什么，例如：PCA 主成分数" value={label} onChange={e => setLabel(e.target.value)} />
    <input placeholder="出处，例如：analysis/pca.py 或 Fig. S8A" value={source} onChange={e => setSource(e.target.value)} />
    <div className={css.row}><button className={css.btnPrimary} disabled={!label.trim() || !source.trim()}
      onClick={() => void done(() => actions.apply([{ op: 'upsert-number', number: { id: `n${Date.now().toString(36)}`, label: label.trim(), value, source: source.trim() } }], `登记数字 ${value}`))}>登记</button></div>
    <div className={css.k}>不登记（写理由，记入历史）</div>
    <input placeholder="理由，例如：方法参数，已核对" value={reason} onChange={e => setReason(e.target.value)} />
    <div className={css.row}>
      <button className={css.btn} disabled={reason.trim().length < 4} onClick={() => void done(() => actions.apply([{ op: 'ignore-number', value, where }], `数字 ${value} 在${paraLabel(view, para)}不登记：${reason.trim()}`))}>只在这段忽略</button>
      <button className={css.btn} disabled={reason.trim().length < 4} onClick={() => void done(() => actions.apply([{ op: 'ignore-number', value, where: '' }], `数字 ${value} 全篇不登记：${reason.trim()}`))}>全篇忽略</button>
      <button className={css.btnGhost} onClick={() => void done(() => actions.comment({ kind: 'paragraph', id: para, quote: value }, `数字 ${value} 不在登记表，需要核对出处。`))}>记为待核对</button>
    </div>
    <label className={css.muted}><input type="checkbox" checked={next} onChange={e => setNext(e.target.checked)} /> 处理后跳到下一个</label>
    <button className={css.close} style={{ position: 'absolute', right: 8, top: 6 }} onClick={() => onClose(false)} aria-label="关闭">×</button>
  </div>
}

/** What the rewrite must agree with: the paragraph's claims (current statements) and their figure panels. */
function DraftContext({ paragraph, view, actions }: { paragraph: Paragraph, view: ProjectView, actions: ProjectActions }): ReactNode {
  const [zoom, setZoom] = useState<string | null>(null)
  const claims = view.project.claims.filter(c => paragraph.claims.includes(c.id))
  const figs = new Map(view.project.figures.map(f => [f.id, f]))
  const panels = [...new Map(claims.flatMap(c => c.evidence.flatMap(e => e.panels)).map(pn => [`${pn.figure}/${pn.label}`, pn])).values()].slice(0, 4)
  return <div className={css.draftCtx}>
    <div className={css.k}>它应当陈述</div>
    {claims.map(c => <div key={c.id} className={css.ctxClaim}><b>{c.id}</b> {c.statement}</div>)}
    {panels.length > 0 && <div className={css.thumbs}>{panels.map(pn => { const f = figs.get(pn.figure), panel = f?.panels.find(x => x.label === pn.label)
      return panel ? <AssetImg key={pn.figure + pn.label} className={css.ctxImg} actions={actions} path={panel.image} alt={`${f!.label}${pn.label}`} title={`${f!.label}${pn.label}（点击放大）`}
        onClick={() => setZoom(panel.image)} /> : null })}</div>}
    {zoom && <div className={css.lightbox} onClick={() => setZoom(null)} role="dialog"><AssetImg actions={actions} path={zoom} alt="" /></div>}
  </div>
}

/** Old claim (as the paragraph was written) against the current one, so "still consistent" is a checked decision. */
function KeepCheck({ paragraph, view, actions, onDone }: { paragraph: Paragraph, view: ProjectView, actions: ProjectActions, onDone: () => void }): ReactNode {
  const [olds, setOlds] = useState<Record<string, Claim | null> | null>(null)
  const stale = paragraph.claims.filter(cid => { const c = view.project.claims.find(x => x.id === cid); return c && paragraph.basis[cid] !== claimHash(c) })
  useEffect(() => {
    let live = true
    void Promise.all(stale.map(async cid => [cid, await actions.claimAt(cid, paragraph.basis[cid] ?? '')] as const)).then(r => { if (live) setOlds(Object.fromEntries(r)) })
    return () => { live = false }
  }, [paragraph.id])  // the stale claims are fixed while this check is open
  const text = (c: Claim | null | undefined): string => c ? `${c.title}\n${c.statement}` : ''
  return <div className={css.keep}>
    <div className={css.k}>写这段之后，论点改了什么</div>
    {!olds ? <div className={css.muted}>载入中…</div> : stale.map(cid => {
      const now = view.project.claims.find(x => x.id === cid)
      return <div key={cid}><b>{cid}</b> {olds[cid] ? <pre className={css.pre}><WordDiff before={text(olds[cid])} after={text(now)} /></pre>
        : <span className={css.muted}>找不到写这段时的论点版本；当前：{now?.statement}</span>}</div>
    })}
    <div className={css.muted}>对照上面的变化读一遍这段。只有段落里的说法仍然成立，才确认一致。</div>
    <div className={css.row}><button className={css.btnPrimary} onClick={() => void actions.markInSync(paragraph.id).then(onDone)}>读过了，仍然一致</button>
      <button className={css.btnGhost} onClick={onDone}>取消</button></div>
  </div>
}

export function Draft({ view, actions, onFocus, onAsk, onRead, busy, start, from, onBack }: {
  view: ProjectView, actions: ProjectActions, onFocus: (f: Focus) => void, onAsk: (t: AgentTask) => void,
  onRead: (paragraph: string) => void, busy: boolean, start: string,
  /** the comment the author came from, with the way back to it */
  from: string, onBack: () => void,
}): ReactNode {
  const p = view.project
  const author = actions.user.role === 'author'
  const written = new Set(p.sections.map(s => s.beat))
  const [pop, setPop] = useState<{ value: string, where: string, at: { x: number, y: number } } | null>(null)
  const [keep, setKeep] = useState('')
  const [numAt, setNumAt] = useState(-1)
  const [editing, setEditing] = useState<Record<string, string>>({})
  const [closeAsk, setCloseAsk] = useState<string[]>([])
  const fromComment = view.comments.find(c => c.id === from)
  /** Accept (possibly edited) and, when that settles every rewrite of a comment, offer to close the comment. */
  const accept = async (d: RewriteDraft, text?: string): Promise<void> => {
    const v = await actions.decideDraft(d.id, true, text)
    const done = d.comments.filter(cid => !v.drafts.some(x => x.status === 'pending' && x.comments.includes(cid))
      && v.comments.find(c => c.id === cid)?.status === 'answered')
    if (done.length) setCloseAsk(done)
  }
  const stale = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of view.sync) if (s.kind === 'claim-changed' || s.kind === 'claim-missing') m.set(s.paragraph, [...(m.get(s.paragraph) ?? []), s.claim])
    return m
  }, [view.sync])
  const nums = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const n of view.numbers) if (n.where.startsWith('paragraph:')) { const k = n.where.slice(10); m.set(k, [...(m.get(k) ?? []), n.value]) }
    return m
  }, [view.numbers])
  const drafts = new Map(view.drafts.filter(d => d.status === 'pending' || d.status === 'stale').map(d => [d.paragraph, d]))
  const pendingDrafts = view.drafts.filter(d => d.status === 'pending')
  const unwritten = view.sync.filter(s => s.kind === 'unwritten')
  const paraNums = view.numbers.filter(n => n.where.startsWith('paragraph:')).length
  useEffect(() => { if (start) document.getElementById(`dp-${start}`)?.scrollIntoView({ block: 'center' }) }, [start])
  /** Step through the marked numbers in reading order. */
  const nextNumber = (stay = false): void => {
    const marks = [...document.querySelectorAll<HTMLElement>('mark[data-num]')]
    if (!marks.length) return
    // after handling a number its mark disappears, so the next one now sits at the same index
    const i = (stay ? Math.max(numAt, 0) : numAt + 1) % marks.length
    setNumAt(i)
    marks[i]!.scrollIntoView({ block: 'center' })
    marks[i]!.focus()
  }
  const jumpDraft = (): void => { const d = pendingDrafts[0]; if (d) document.getElementById(`dp-${d.paragraph}`)?.scrollIntoView({ block: 'center' }) }
  return <div className={css.draft}>
    {fromComment && <div className={css.crumb}>来自意见：{fromComment.text.slice(0, 60)}{fromComment.text.length > 60 ? '…' : ''}
      <button className={css.linkBtn} onClick={onBack}>返回意见</button></div>}
    {closeAsk.map(cid => { const c = view.comments.find(x => x.id === cid); return c && c.status === 'answered' && <div key={cid} className={css.notice}>
      意见「{c.text.slice(0, 50)}…」关联的改写都已确认。
      <button className={css.btn} onClick={() => void actions.setComment(cid, 'closed').then(() => setCloseAsk(a => a.filter(x => x !== cid)))}>满意，关闭这条意见</button>
      <button className={css.btnGhost} onClick={() => setCloseAsk(a => a.filter(x => x !== cid))}>暂不</button></div> })}
    <div className={css.draftBar}>
      {pendingDrafts.length > 0 && <button className={css.btnPrimary} onClick={jumpDraft}>{pendingDrafts.length} 段改写待你确认</button>}
      {author && [...stale.keys()].some(k => !drafts.has(k)) && <button className={css.btn} disabled={busy} onClick={() => onAsk({ kind: 'resync', paragraphs: [...stale.keys()].filter(k => !drafts.has(k)) })}>
        为 {[...stale.keys()].filter(k => !drafts.has(k)).length} 个不同步段落起草改写</button>}
      {paraNums > 0 && <button className={css.btn} onClick={() => nextNumber()}>下一个未登记数字（{numAt + 1 > 0 ? `${numAt + 1}/` : ''}{paraNums}）</button>}
      {author && p.beats.filter(b => !written.has(b.id)).length > 0 && <span>未成文的拍：{p.beats.filter(b => !written.has(b.id)).map(b =>
        <button key={b.id} className={css.btn} disabled={busy} onClick={() => onAsk({ kind: 'draft', beat: b.id })}>写「{b.title.slice(0, 16)}」</button>)}</span>}
      {unwritten.length > 0 && p.sections.length > 0 && <span className={css.muted}>还没有段落陈述：{unwritten.map(u => u.claim).join('、')}</span>}
    </div>
    {!p.sections.length && <Empty>还没有正文。骨架和图改得差不多后，点上面的按钮让 agent 按骨架逐节成文；风格要求：领域内 native 学者的专业水平，非 native 读者也读得舒服。</Empty>}
    {p.sections.map(s => <section key={s.id} className={css.draftSec}>
      <h3>{s.heading}{s.beat && <span className={css.muted}> · 第 {p.beats.findIndex(b => b.id === s.beat) + 1} 拍</span>}</h3>
      {s.paragraphs.map(x => {
        const st = stale.get(x.id)
        const d = drafts.get(x.id)
        const key = `paragraph:${x.id}`
        return <div key={x.id} id={`dp-${x.id}`} className={cx(css.dpara, st && css.dparaStale, start === x.id && css.dparaFocus)}>
          <div className={css.dparaSide}>
            <ReviewDot status={view.status[key]} />
            {x.claims.map(cid => <button key={cid} className={css.chip} onClick={() => onFocus({ kind: 'claim', id: cid })}>{cid}</button>)}
          </div>
          <div className={css.dparaMain}>
            {d && d.status === 'pending' ? <div className={css.draftBox}>
              <div className={css.k}>agent 起草的改写（{d.reason.slice(0, 60)}）</div>
              <div className={css.draftGrid}>
                <div>{editing[d.id] !== undefined
                  ? <textarea className={css.editArea} value={editing[d.id]} onChange={e => setEditing({ ...editing, [d.id]: e.target.value })} />
                  : <p><WordDiff before={d.before} after={d.after} /></p>}</div>
                <DraftContext paragraph={x} view={view} actions={actions} />
              </div>
              {author && <div className={css.row}>
                {editing[d.id] !== undefined
                  ? <><button className={css.btnPrimary} onClick={() => void accept(d, editing[d.id])}>按我的修改接受</button>
                    <button className={css.btnGhost} onClick={() => { const n = { ...editing }; delete n[d.id]; setEditing(n) }}>取消修改</button></>
                  : <><button className={css.btnPrimary} onClick={() => void accept(d)}>接受改写</button>
                    <button className={css.btn} onClick={() => setEditing({ ...editing, [d.id]: d.after })}>改几个词再接受</button>
                    <button className={css.btnGhost} onClick={() => void actions.decideDraft(d.id, false)}>放弃</button></>}</div>}
            </div> : <p><Marked text={x.text} values={nums.get(x.id) ?? []} onPick={(value, el) => {
              const r = el.getBoundingClientRect(); setPop({ value, where: key, at: { x: r.left, y: r.bottom } }) }} /></p>}
            {d && d.status === 'stale' && <div className={css.muted}>这段在起草改写后又被改过，旧草稿作废；需要的话重新起草。</div>}
            {st && !d && keep !== x.id && <div className={css.syncWarn}>论点 {st.join('、')} 在这段写好后改过。
              {author && <><button className={css.btn} disabled={busy} onClick={() => onAsk({ kind: 'resync', paragraphs: [x.id] })}>起草改写</button>
                <button className={css.btnGhost} onClick={() => setKeep(x.id)}>对照后确认仍然一致…</button></>}</div>}
            {keep === x.id && <KeepCheck paragraph={x} view={view} actions={actions} onDone={() => setKeep('')} />}
            <div className={css.row}>
              <button className={css.linkBtn} onClick={() => onRead(x.id)}>在阅读页打开</button>
              {author && view.status[key] !== 'reviewed' && <button className={css.linkBtn} onClick={() => void actions.confirm([key])}>确认已审</button>}
            </div>
          </div>
        </div>
      })}
    </section>)}
    {pop && <NumberPop value={pop.value} where={pop.where} at={pop.at} view={view} actions={actions}
      onClose={next => { setPop(null); if (next) setTimeout(() => { nextNumber(true); const m = document.querySelector<HTMLElement>('mark[data-num]:focus'); if (m) { const r = m.getBoundingClientRect(); setPop({ value: m.dataset.num ?? '', where: m.closest('[id^=dp-]')?.id.replace('dp-', 'paragraph:') ?? '', at: { x: r.left, y: r.bottom } }) } }, 300) }} />}
  </div>
}

