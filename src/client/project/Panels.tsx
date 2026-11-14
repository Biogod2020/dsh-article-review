/** Overview (stage and what to do next), the comment inbox, history and the optional claim network. */
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Comment, Stage } from '../../project/model.ts'
import { STAGES } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import { PERSONAS } from '../../project/prompts.ts'
import type { Persona } from '../../project/prompts.ts'
import type { ProjectActions, AgentTask } from './actions.ts'
import { CommentCard, SOURCE_LABEL, STAGE_HINT, STAGE_LABEL, STATUS_LABEL, claimNo, cx, paraLabel, progressByType, unitFocus, unitLabel } from './common.tsx'
import type { Focus } from './StoryFlow.tsx'
import css from './project.module.css'

export function targetLabel(view: ProjectView, c: Comment): string {
  const t = c.target, p = view.project
  if (t.kind === 'claim') return `${claimNo(view, t.id)} ${p.claims.find(x => x.id === t.id)?.title ?? ''}`
  if (t.kind === 'evidence') { const cl = p.claims.find(x => x.evidence.some(e => e.id === t.id)); return `${cl ? claimNo(view, cl.id) : ''} 论据` }
  if (t.kind === 'beat') { const i = p.beats.findIndex(b => b.id === t.id); return `第 ${i + 1} 拍` }
  if (t.kind === 'figure') return p.figures.find(f => f.id === t.id)?.label ?? t.id
  if (t.kind === 'paragraph') return paraLabel(view, t.id)
  return t.kind === 'thesis' ? '核心论点' : '整篇'
}

export function focusOf(c: Comment): Focus { return { kind: c.target.kind, id: c.target.id } }

export function Overview({ view, actions, onAsk, busy, onTab, onGo }: {
  view: ProjectView, actions: ProjectActions, onAsk: (t: AgentTask) => void, busy: boolean, onTab: (tab: string) => void, onGo: (f: Focus) => void,
}): ReactNode {
  const p = view.project
  const author = actions.user.role === 'author'
  const at = STAGES.indexOf(p.stage)
  const open = view.comments.filter(c => c.status === 'open')
  const openHuman = open.filter(c => HUMAN.has(c.source))
  const [reason, setReason] = useState('')
  const answered = view.comments.filter(c => c.status === 'answered')
  const prog = progressByType(view)
  const pendingDrafts = view.drafts.filter(d => d.status === 'pending').length
  const outOfSync = view.sync.filter(s => s.kind !== 'unwritten').length
  const nothing = !answered.length && !openHuman.length && !pendingDrafts && !outOfSync && prog.every(g => g.ok === g.all)
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
        <ol className={css.todoList}>
          {answered.length > 0 && <li><button onClick={() => onTab('inbox')}><b>{answered.length}</b> 条意见 agent 已回应，等你看<span>去意见页 ›</span></button></li>}
          {openHuman.length > 0 && <li><button onClick={() => onTab('inbox')}><b>{openHuman.length}</b> 条人的意见还没处理<span>去意见页 ›</span></button></li>}
          {pendingDrafts > 0 && <li><button onClick={() => onTab('draft')}><b>{pendingDrafts}</b> 段正文改写等你确认<span>去正文 ›</span></button></li>}
          {outOfSync > 0 && <li><button onClick={() => onTab('draft')}><b>{outOfSync}</b> 处正文与论点不同步<span>去正文 ›</span></button></li>}
          {prog.filter(g => g.ok < g.all).map(g => <li key={g.key}><button onClick={() => { if (g.next) onGo(unitFocus(g.next)) }}>
            {g.label}：{g.changed > 0 && <><b>{g.changed}</b> 处审后有修改，</>}<b>{g.all - g.ok - g.changed}</b> 处未审<span>从下一处开始 ›</span></button></li>)}
        </ol>
        {nothing && <div className={css.ok}>✓ 现在没有等你处理的事。</div>}
        {(view.numbers.length > 0 || open.length > openHuman.length) && <div className={css.todoNote}>提醒，不用现在处理：
          {open.length > openHuman.length && <button className={css.linkBtn} onClick={() => onTab('inbox')}>模拟审阅 {open.length - openHuman.length} 条</button>}
          {view.numbers.length > 0 && <button className={css.linkBtn} onClick={() => onTab('numbers')}>{view.numbers.length} 个数字不在登记表</button>}</div>}
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
  // open on what waits for the author: open comments first, else the answers that wait for a decision
  const [status, setStatus] = useState<Comment['status'] | 'all'>(() =>
    view.comments.some(c => c.status === 'open' && HUMAN.has(c.source)) || !view.comments.some(c => c.status === 'answered') ? 'open' : 'answered')
  const [group, setGroup] = useState<'human' | 'model' | 'all'>('human')
  const [mine, setMine] = useState(false)
  const [toMe, setToMe] = useState(false)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [confirm, setConfirm] = useState(false)
  const author = actions.user.role === 'author'
  const inGroup = (c: Comment): boolean => group === 'all' || (group === 'human') === HUMAN.has(c.source)
  const [q, setQ] = useState('')
  const needle = q.trim().toLowerCase()
  const hit = (c: Comment): boolean => !needle || [c.text, c.response?.text ?? '', c.target.quote ?? '', targetLabel(view, c), c.author].some(t => t.toLowerCase().includes(needle))
  const list = view.comments.filter(c => (status === 'all' || c.status === status) && inGroup(c) && (!mine || c.author === actions.user.name)
    && (!toMe || c.assignee === actions.user.name) && hit(c)).slice().reverse()
  const counts = (s: Comment['status']): number => view.comments.filter(c => c.status === s && inGroup(c)).length
  const groupCount = (g: 'human' | 'model'): number => view.comments.filter(c => c.status === 'open' && (g === 'human') === HUMAN.has(c.source)).length
  const chosen = view.comments.filter(c => picked.has(c.id))
  const blocked = chosen.length > 1 && chosen.some(solo)
  const groups: { key: string, label: string, focus: Focus, items: Comment[] }[] = []
  for (const c of list) {
    const key = `${c.target.kind}:${c.target.id}`
    let g = groups.find(x => x.key === key)
    if (!g) { g = { key, label: targetLabel(view, c), focus: focusOf(c), items: [] }; groups.push(g) }
    g.items.push(c)
  }
  const STATUSES = ['open', 'answered', 'closed', 'declined', 'all'] as const
  return <div className={css.inbox}>
    <div className={css.ibBar}>
      <div className={css.ibSeg} role="tablist" aria-label="状态">{STATUSES.map(s => <button key={s} role="tab" aria-selected={status === s} className={cx(status === s && css.ibSegOn)} onClick={() => setStatus(s)}>
        {s === 'all' ? '全部' : STATUS_LABEL[s]}{s !== 'all' && <i>{counts(s)}</i>}</button>)}</div>
      <select className={css.ibSel} value={group} aria-label="来源" onChange={e => { setGroup(e.target.value as 'human' | 'model' | 'all'); setPicked(new Set()) }}>
        <option value="human">人的意见{groupCount('human') ? `（${groupCount('human')} 条未处理）` : ''}</option>
        <option value="model">模拟审阅：编辑 / 审稿人 / 读者{groupCount('model') ? `（${groupCount('model')} 条未处理）` : ''}</option>
        <option value="all">全部来源</option></select>
      <input className={css.ibSearch} value={q} onChange={e => setQ(e.target.value)} placeholder="搜索意见" title="在意见、回应和引用的原文里搜索" aria-label="搜索" />
      <span className={css.grow} />
      <button className={cx(css.ibToggle, mine && css.ibToggleOn)} aria-pressed={mine} onClick={() => setMine(!mine)}>我写的</button>
      <button className={cx(css.ibToggle, toMe && css.ibToggleOn)} aria-pressed={toMe} onClick={() => setToMe(!toMe)}>指派给我</button>
    </div>
    <div className={css.ibSum}>
      <span>{list.length} 条意见 · {groups.length} 个位置</span>
      {status === 'answered' && list.length > 0 && <span>agent 已回应。看过修改后，满意就关闭，不满意就重新打开。</span>}
      {author && status === 'open' && list.length > 0 && <>
        <button className={css.btnPrimary} disabled={busy || !picked.size || blocked} onClick={() => setConfirm(true)}>
          {picked.size ? `交给 agent 处理选中的 ${picked.size} 条…` : '勾选要交给 agent 的意见'}</button>
        {picked.size > 0 && <button className={css.btnGhost} onClick={() => setPicked(new Set())}>取消选择</button>}
        {blocked && <span className={css.warnText}>审稿人的主要意见涉及证据，请单独处理。</span>}</>}
    </div>
    {groups.map(g => <section key={g.key} className={css.ibGroup}>
      <header className={css.ibGroupHead}>
        <button onClick={() => onGo(g.focus)} title="跳到这个位置">{g.label}<span>打开 ›</span></button>
        {g.items.length > 1 && <i>{g.items.length} 条</i>}
      </header>
      {g.items.map(c => <div key={c.id} className={css.inboxItem}>
        {author && c.status === 'open' && <input type="checkbox" checked={picked.has(c.id)} aria-label="选择"
          onChange={e => { const n = new Set(picked); if (e.target.checked) n.add(c.id); else n.delete(c.id); setPicked(n) }} />}
        <CommentCard c={c} {...(author ? { onAssign: (a: string) => void actions.assign(c.id, a) } : {})} view={view} canDecide={author} onGo={onGo} onStatus={s => void actions.setComment(c.id, s)} />
      </div>)}
    </section>)}
    {!list.length && <div className={css.ibEmpty}><b>{q ? '没有匹配的意见' : status === 'open' ? '没有未处理的意见' : '这里没有意见'}</b>
      <span>{q ? '换一个词，或清空搜索。' : '在“阅读”页选中文字或右键，可以对某句话写意见。'}</span></div>}
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

const KIND_NAME: [string, string][] = [['thesis', '核心论点'], ['beat', '拍'], ['claim', '分论点'], ['figure', '图'], ['paragraph', '段落']]
function HistoryUnits({ units, view, onGo }: { units: string[], view: ProjectView, onGo: (f: Focus) => void }): ReactNode {
  const [open, setOpen] = useState(false)
  const n = (k: string): number => units.filter(u => unitFocus(u).kind === k).length
  return <div className={css.histUnits}>
    <button className={css.linkBtn} onClick={() => setOpen(!open)} aria-expanded={open}>{open ? '▾' : '▸'} 保存了 {units.length} 个单位</button>
    <span className={css.muted}>{KIND_NAME.filter(([k]) => n(k) > 0).map(([k, l]) => k === 'thesis' ? l : `${l} ${n(k)}`).join(' · ')}</span>
    {open && <div className={css.unitMore}>{units.map(u => <button key={u} className={css.chip} onClick={() => onGo(unitFocus(u))}>{unitLabel(u, view)}</button>)}</div>}
  </div>
}

export function History({ view, onGo }: { view: ProjectView, onGo: (f: Focus) => void }): ReactNode {
  return <div className={css.history}><ol className={css.tl}>{view.history.slice().reverse().map(h => <li key={h.revision} className={css.hist}>
    <span className={css.tlDot} aria-hidden />
    <div className={css.histHead}><b>r{h.revision}</b><span>{h.actor}</span><span className={css.muted}>{h.at.slice(0, 16).replace('T', ' ')}</span>
      {h.comments.length > 0 && <span className={cx(css.pill, css.pill_answered)}>回应了 {h.comments.length} 条意见</span>}</div>
    <div className={css.histReason}>{h.reason}</div>
    {h.units.length > 0 && <HistoryUnits units={h.units} view={view} onGo={onGo} />}
  </li>)}</ol></div>
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
        {n.where.startsWith('paragraph:') ? paraLabel(view, n.where.slice(10)) : n.where.startsWith('claim:') ? `分论点 ${claimNo(view, n.where.slice(6))}` : n.where}</button></td>
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
