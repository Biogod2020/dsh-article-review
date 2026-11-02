/** Overview (stage and what to do next), the comment inbox, history and the optional claim network. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Comment, Stage } from '../../project/model.ts'
import { STAGES } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import { PERSONAS } from '../../project/prompts.ts'
import type { Persona } from '../../project/prompts.ts'
import type { ProjectActions, AgentTask } from './actions.ts'
import { CommentCard, SOURCE_LABEL, STAGE_HINT, STAGE_LABEL, STATUS_LABEL, cx, paraLabel } from './common.tsx'
import type { Focus } from './StoryFlow.tsx'
import css from './project.module.css'

export function targetLabel(view: ProjectView, c: Comment): string {
  const t = c.target, p = view.project
  if (t.kind === 'claim') return `${t.id} ${p.claims.find(x => x.id === t.id)?.title.slice(0, 14) ?? ''}`
  if (t.kind === 'evidence') { const cl = p.claims.find(x => x.evidence.some(e => e.id === t.id)); return `${cl?.id ?? ''} 论据` }
  if (t.kind === 'beat') { const i = p.beats.findIndex(b => b.id === t.id); return `第 ${i + 1} 拍` }
  if (t.kind === 'figure') return p.figures.find(f => f.id === t.id)?.label ?? t.id
  if (t.kind === 'paragraph') return paraLabel(view, t.id)
  return t.kind === 'thesis' ? '核心论点' : '整篇'
}

export function focusOf(c: Comment): Focus { return { kind: c.target.kind, id: c.target.id } }

export function Overview({ view, actions, onAsk, busy, onTab }: {
  view: ProjectView, actions: ProjectActions, onAsk: (t: AgentTask) => void, busy: boolean, onTab: (tab: string) => void,
}): ReactNode {
  const p = view.project
  const author = actions.user.role === 'author'
  const at = STAGES.indexOf(p.stage)
  const open = view.comments.filter(c => c.status === 'open')
  const openHuman = open.filter(c => HUMAN.has(c.source))
  const [reason, setReason] = useState('')
  const answered = view.comments.filter(c => c.status === 'answered')
  const changed = Object.entries(view.status).filter(([, s]) => s === 'changed').length
  const fresh = Object.entries(view.status).filter(([, s]) => s === 'new').length
  const next = STAGES[at + 1] as Stage | undefined
  const personas = Object.entries(PERSONAS) as [Persona, typeof PERSONAS[Persona]][]
  return <div className={css.overview}>
    <ol className={css.stages}>{STAGES.map((s, i) => <li key={s} className={cx(css.stage, i < at && css.stageDone, i === at && css.stageCur)}>
      <span className={css.stageNo}>{i + 1}</span><b>{STAGE_LABEL[s]}</b><span className={css.stageHint}>{STAGE_HINT[s]}</span></li>)}</ol>
    <div className={css.ovGrid}>
      <div className={css.card}>
        <div className={css.cardHead}>当前阶段：{STAGE_LABEL[p.stage]}</div>
        <ul className={css.check}>{view.checklist.map(it => <li key={it.label} className={it.ok ? css.ok : css.todo}>
          <span>{it.ok ? '✓' : '·'}</span><b>{it.label}</b><span className={css.muted}>{it.detail}</span></li>)}</ul>
        {author && next === 'submit' && view.checklist.some(i => !i.ok) && <div className={css.box}>
          <div className={css.warnText}>投稿前还有未完成的项。要进入投稿，请写明理由（记入历史）。</div>
          <textarea value={reason} onChange={e => setReason(e.target.value)} placeholder="例如：剩余 3 个数字是方法参数，已逐个核对" /></div>}
        {author && next && <div className={css.row}>
          <button className={css.btnPrimary} disabled={next === 'submit' && view.checklist.some(i => !i.ok) && reason.trim().length < 10}
            onClick={() => void actions.setStage(next, reason).then(() => setReason(''))}>进入下一阶段：{STAGE_LABEL[next]}</button>
          {at > 1 && <button className={css.btnGhost} onClick={() => void actions.setStage(STAGES[at - 1]!)}>退回{STAGE_LABEL[STAGES[at - 1]!]}</button>}
        </div>}
        {author && next && view.checklist.some(i => !i.ok) && <div className={css.muted}>清单只是提醒：未完成的项会带到下一阶段。</div>}
      </div>
      <div className={css.card}>
        <div className={css.cardHead}>待你处理</div>
        <button className={css.stat} onClick={() => onTab('inbox')}><b>{answered.length}</b>条 agent 已回应，等你确认</button>
        <button className={css.stat} onClick={() => onTab('inbox')}><b>{openHuman.length}</b>条人的意见未处理{open.length > openHuman.length && <span className={css.muted}>（另有模拟审阅 {open.length - openHuman.length} 条）</span>}</button>
        {view.drafts.some(d => d.status === 'pending') && <button className={css.stat} onClick={() => onTab('draft')}><b>{view.drafts.filter(d => d.status === 'pending').length}</b>段正文改写等你确认</button>}
        <button className={css.stat} onClick={() => onTab('story')}><b>{changed}</b>处你审过之后有修改 · <b>{fresh}</b>处未审</button>
        {view.sync.filter(s => s.kind !== 'unwritten').length > 0 && <button className={css.stat} onClick={() => onTab('draft')}><b>{view.sync.filter(s => s.kind !== 'unwritten').length}</b>处正文与论点不同步</button>}
        {view.numbers.length > 0 && <button className={css.stat} onClick={() => onTab('numbers')}>未登记数字：正文 <b>{view.numbers.filter(n => n.where.startsWith('paragraph:')).length}</b>个 · 论点与论据 <b>{view.numbers.filter(n => !n.where.startsWith('paragraph:')).length}</b>个</button>}
      </div>
      {author && <div className={css.card}>
        <div className={css.cardHead}>让 agent 做</div>
        {(p.stage === 'materials' || p.stage === 'skeleton') && <button className={css.btn} disabled={busy} onClick={() => onAsk({ kind: 'skeleton' })}>根据材料起草故事流</button>}
        {open.length > 0 && <button className={css.btn} onClick={() => onTab('inbox')}>去意见页挑选要处理的意见（{open.length} 条未处理）</button>}
        {p.stage === 'draft' && <button className={css.btn} disabled={busy} onClick={() => onTab('draft')}>按骨架成文…</button>}
        <div className={css.k}>请外部视角审阅（{p.stage === 'read' || p.stage === 'draft' ? '正文' : '论点与图'}）</div>
        {personas.map(([k, r]) => <button key={k} className={css.btn} disabled={busy} onClick={() => onAsk({ kind: 'persona', persona: k, focus: '' })}
          title={r.owns}>{r.name}</button>)}
      </div>}
    </div>
  </div>
}

export const HUMAN = new Set<Comment['source']>(['author', 'collaborator', 'chat', 'check'])
/** A reviewer's major point is about evidence: it is handled on its own, never in a batch. */
const solo = (c: Comment): boolean => c.source === 'reviewer' && c.text.startsWith('【主要】')

export function Inbox({ view, actions, onGo, onAsk, busy }: {
  view: ProjectView, actions: ProjectActions, onGo: (f: Focus) => void, onAsk: (t: AgentTask) => void, busy: boolean,
}): ReactNode {
  const [status, setStatus] = useState<Comment['status'] | 'all'>('open')
  const [group, setGroup] = useState<'human' | 'model' | 'all'>('human')
  const [mine, setMine] = useState(false)
  const [toMe, setToMe] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const author = actions.user.role === 'author'
  const inGroup = (c: Comment): boolean => group === 'all' || (group === 'human') === HUMAN.has(c.source)
  const list = view.comments.filter(c => (status === 'all' || c.status === status) && inGroup(c) && (!mine || c.author === actions.user.name)
    && (!toMe || c.assignee === actions.user.name)).slice().reverse()
  const counts = (s: Comment['status']): number => view.comments.filter(c => c.status === s && inGroup(c)).length
  const groupCount = (g: 'human' | 'model'): number => view.comments.filter(c => c.status === 'open' && (g === 'human') === HUMAN.has(c.source)).length
  const chosen = view.comments.filter(c => picked.has(c.id))
  const blocked = chosen.length > 1 && chosen.some(solo)
  return <div className={css.inbox}>
    <div className={css.filters}>
      {(['human', 'model', 'all'] as const).map(g => <button key={g} className={cx(css.tab2, group === g && css.tab2On)} onClick={() => { setGroup(g); setPicked(new Set()) }}>
        {g === 'human' ? '人的意见' : g === 'model' ? '模拟审阅（编辑 / 审稿人 / 读者）' : '全部来源'}{g !== 'all' && <span className={css.muted}> {groupCount(g)}</span>}</button>)}
      <span className={css.grow} />
      <label className={css.muted}><input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> 只看我写的</label>
      <label className={css.muted}><input type="checkbox" checked={toMe} onChange={e => setToMe(e.target.checked)} /> 指派给我的</label>
    </div>
    <div className={css.filters}>
      {(['open', 'answered', 'closed', 'declined', 'all'] as const).map(s => <button key={s} className={cx(css.tab2, status === s && css.tab2On)} onClick={() => setStatus(s)}>
        {s === 'all' ? '全部' : STATUS_LABEL[s]} {s !== 'all' && <span className={css.muted}>{counts(s)}</span>}</button>)}
    </div>
    {author && status === 'open' && list.length > 0 && <div className={css.row}>
      <button className={css.btnPrimary} disabled={busy || !picked.size || blocked} onClick={() => setConfirm(true)}>
        {picked.size ? `交给 agent 处理选中的 ${picked.size} 条…` : '勾选要交给 agent 的意见'}</button>
      {picked.size > 0 && <button className={css.btnGhost} onClick={() => setPicked(new Set())}>取消选择</button>}
      {blocked && <span className={css.warnText}>审稿人的主要意见涉及证据，请单独处理。</span>}</div>}
    {status === 'answered' && list.length > 0 && <div className={css.muted}>agent 已回应这些意见。点“这次实际修改”里的项目查看差异；满意再关闭，不满意就重新打开。</div>}
    {list.map(c => <div key={c.id} className={css.inboxItem}>
      {author && c.status === 'open' && <input type="checkbox" checked={picked.has(c.id)} aria-label="选择"
        onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPicked(n) }} />}
      <CommentCard c={c} {...(author ? { onAssign: (a: string) => void actions.assign(c.id, a) } : {})} view={view} canDecide={author} targetLabel={targetLabel(view, c)} onGo={onGo} onStatus={s => void actions.setComment(c.id, s)} />
    </div>)}
    {!list.length && <div className={css.empty}>这里没有意见。</div>}
    {confirm && <div className={css.modalBack} onClick={() => setConfirm(false)}><div className={css.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="确认交给 agent">
      <div className={css.cardHead}>交给 agent 处理 {chosen.length} 条意见</div>
      <div className={css.muted}>agent 会直接修改相关论点和图，并逐条回应；改动标为“审后有修改”。若改动影响已写好的段落，会另外起草改写，等你逐段确认，不会直接替换正文。</div>
      <ol className={css.modalList}>{chosen.map(c => <li key={c.id}><b>{targetLabel(view, c)}</b> · {SOURCE_LABEL[c.source]}：{c.text.slice(0, 90)}{c.text.length > 90 ? '…' : ''}</li>)}</ol>
      <div className={css.muted}>可能改动的单位：{[...new Set(chosen.map(c => targetLabel(view, c)))].join('、')}</div>
      <div className={css.row}><button className={css.btnPrimary} onClick={() => { setConfirm(false); onAsk({ kind: 'refine', comments: [...picked] }); setPicked(new Set()) }}>开始处理</button>
        <button className={css.btnGhost} onClick={() => setConfirm(false)}>取消</button></div>
    </div></div>}
  </div>
}

export function History({ view, onGo }: { view: ProjectView, onGo: (f: Focus) => void }): ReactNode {
  return <div className={css.history}>{view.history.slice().reverse().map(h => <div key={h.revision} className={css.hist}>
    <div className={css.histHead}><b>r{h.revision}</b><span>{h.actor}</span><span className={css.muted}>{h.at.slice(0, 16).replace('T', ' ')}</span></div>
    <div>{h.reason}</div>
    {h.units.length > 0 && <div className={css.row}>{h.units.slice(0, 20).map(u => { const [kind, id] = u.split(':')
      return <button key={u} className={css.chip} onClick={() => onGo({ kind: kind as Focus['kind'], id: id ?? '' })}>{id ?? u}</button> })}
      {h.units.length > 20 && <span className={css.muted}>等 {h.units.length} 处</span>}</div>}
    {h.comments.length > 0 && <div className={css.muted}>回应了 {h.comments.length} 条意见</div>}
  </div>)}</div>
}

const HINT_LABEL = { result: '结果', parameter: '方法参数', citation: '引用编号', other: '其他' } as const

/**
 * Number triage: every unregistered number with the agent's first sort (a hint), so parameters can be cleared in a
 * batch with one stated reason while results are registered or checked one by one.
 */
export function Numbers({ view, actions, onGo, onAsk, busy }: {
  view: ProjectView, actions: ProjectActions, onGo: (f: Focus) => void, onAsk: (t: AgentTask) => void, busy: boolean,
}): ReactNode {
  const [kind, setKind] = useState<'all' | keyof typeof HINT_LABEL | 'none'>('all')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [reason, setReason] = useState('')
  const author = actions.user.role === 'author'
  const rows = view.numbers.map((n, i) => ({ n, i, hint: view.numberHints[`${n.where}|${n.value}`] }))
    .filter(r => kind === 'all' || (kind === 'none' ? !r.hint : r.hint?.kind === kind))
  const count = (k: keyof typeof HINT_LABEL): number => view.numbers.filter(n => view.numberHints[`${n.where}|${n.value}`]?.kind === k).length
  const unsorted = view.numbers.filter(n => !view.numberHints[`${n.where}|${n.value}`]).length
  const ignore = async (): Promise<void> => {
    const chosen = view.numbers.filter((_, i) => picked.has(i))
    await actions.apply(chosen.map(n => ({ op: 'ignore-number' as const, value: n.value, where: n.where })), `忽略 ${chosen.length} 个未登记数字：${reason.trim()}`)
    setPicked(new Set()); setReason('')
  }
  return <div className={css.numbers}>
    <div className={css.k}>未登记的数字（{view.numbers.length}）</div>
    <div className={css.muted}>论点、论据和正文里出现、但不在登记表中的数字。成文时 agent 只能用登记过的数字。agent 的分类只是提示，忽略需要写理由。</div>
    <div className={css.filters}>
      {(['all', 'result', 'parameter', 'citation', 'other', 'none'] as const).map(k => <button key={k} className={cx(css.tab2, kind === k && css.tab2On)} onClick={() => { setKind(k); setPicked(new Set()) }}>
        {k === 'all' ? '全部' : k === 'none' ? `未分类 ${unsorted}` : `${HINT_LABEL[k]} ${count(k)}`}</button>)}
      <span className={css.grow} />
      {author && unsorted > 0 && <button className={css.btn} disabled={busy} onClick={() => onAsk({ kind: 'numbers' })}>让 agent 先分类（{unsorted} 个）</button>}
    </div>
    {author && <div className={css.row}>
      <button className={css.btnGhost} onClick={() => setPicked(new Set(rows.map(r => r.i)))}>全选当前 {rows.length} 个</button>
      {picked.size > 0 && <><input className={css.reasonInput} value={reason} onChange={e => setReason(e.target.value)} placeholder="忽略理由，例如：方法参数，已核对" />
        <button className={css.btn} disabled={reason.trim().length < 4} onClick={() => void ignore()}>忽略选中的 {picked.size} 个</button>
        <button className={css.btnGhost} onClick={() => setPicked(new Set())}>取消</button></>}
    </div>}
    <table className={css.table}><tbody>{rows.map(({ n, i, hint }) => <tr key={i}>
      {author && <td><input type="checkbox" checked={picked.has(i)} aria-label="选择" onChange={e => { const s2 = new Set(picked); if (e.target.checked) s2.add(i); else s2.delete(i); setPicked(s2) }} /></td>}
      <td><b>{n.value}</b></td>
      <td>{hint ? <span className={cx(css.pill, hint.kind === 'result' && css.ev_partial)}>{HINT_LABEL[hint.kind]}</span> : <span className={css.muted}>—</span>}
        {hint?.note && <div className={css.muted}>{hint.note}</div>}</td>
      <td><button className={css.linkBtn} onClick={() => { const [k, id] = n.where.split(':'); onGo({ kind: k as Focus['kind'], id: id ?? '' }) }}>
        {n.where.startsWith('paragraph:') ? paraLabel(view, n.where.slice(10)) : n.where.replace('claim:', '分论点 ')}</button></td>
      <td className={css.muted}>…{n.quote}…</td></tr>)}</tbody></table>
    <div className={css.k}>登记表（{view.project.numbers.length}）</div>
    <table className={css.table}><tbody>{view.project.numbers.map(n => <tr key={n.id}><td><b>{n.value}</b></td><td>{n.label}</td><td className={css.muted}>{n.source}</td></tr>)}</tbody></table>
  </div>
}

/** Optional view: claim dependencies as a simple ordered list (the abstract network was rarely used). */
export function Network({ view, onGo }: { view: ProjectView, onGo: (f: Focus) => void }): ReactNode {
  const p = view.project
  if (!p.links.length) return <div className={css.empty}>没有记录分论点之间的依赖。</div>
  return <div className={css.network}>{p.claims.map(c => {
    const out = p.links.filter(l => l.from === c.id), inc = p.links.filter(l => l.to === c.id)
    if (!out.length && !inc.length) return null
    return <div key={c.id} className={css.netRow}><button className={css.chip} onClick={() => onGo({ kind: 'claim', id: c.id })}>{c.id}</button><b>{c.title}</b>
      {inc.map(l => <div key={l.from} className={css.muted}>← 用到 {l.from}：{l.label}</div>)}
      {out.map(l => <div key={l.to} className={css.muted}>→ 为 {l.to} 提供：{l.label}</div>)}</div>
  })}</div>
}
