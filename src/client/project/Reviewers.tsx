/**
 * Role-play reviewers: who each reviewer is, the rounds they have reviewed, and their comments with the author's
 * responses. A round is run by the agent (DSH: one subagent per reviewer; demo: one model call per reviewer); the
 * author answers each comment here and copies the answers out as a rebuttal draft.
 */
import { useMemo, useState, type ReactNode } from 'react'
import type { Comment, Reviewer } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { AgentTask, ProjectActions } from './actions.ts'
import type { Focus } from './common.tsx'
import { cx, paraLabel, STATUS_LABEL } from './common.tsx'
import css from './project.module.css'

const SEVERITY: Record<NonNullable<Comment['severity']>, string> = { fact: '事实', reader: '读者', taste: '口味' }
const DISPOSITION: Record<NonNullable<Comment['disposition']>, string> = { changed: '已在稿中修改', rebut: '据理反驳', decide: '需作者决定' }

/** Reviewer text is model markdown: render **bold**, `code`, list bullets and drop rules, nothing else. */
function Md({ text }: { text: string }): ReactNode {
  const lines = text.replace(/\n\s*-{3,}\s*$/g, '').trim().split('\n')
  const inline = (t: string, k: number): ReactNode[] => t.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((x, i) =>
    x.startsWith('**') && x.endsWith('**') && x.length > 4 ? <b key={`${k}-${i}`}>{inline(x.slice(2, -2), k * 100 + i)}</b>
      : x.startsWith('`') && x.endsWith('`') && x.length > 2 ? <code key={`${k}-${i}`} className={css.rvCode}>{x.slice(1, -1)}</code> : x.replace(/\*\*/g, ''))
  return <div className={css.rvMd}>{lines.map((l, i) => {
    const m = /^(\s*)(?:[-*]|\d+\.)\s+(.*)$/.exec(l)
    if (/^\s*-{3,}\s*$/.test(l)) return null
    if (m) return <div key={i} className={css.rvLi} style={{ paddingLeft: `${1 + m[1]!.length / 2}em` }}>{/^\s*\d/.test(l) ? `${/\d+/.exec(l)![0]}. ` : '• '}{inline(m[2]!, i)}</div>
    return l.trim() ? <p key={i}>{inline(l, i)}</p> : null
  })}</div>
}
const localTime = (iso: string): string => { const d = new Date(iso); return isNaN(+d) ? iso : d.toLocaleString('zh-CN', { hour12: false }).slice(0, -3) }

const scoreTrail = (r: Reviewer): string =>
  [r.originalScore, ...r.rounds.map(x => x.score)].map(s => s ?? '–').join(' → ')

function ReviewerForm({ initial, onSave, onCancel, onRemove }: {
  initial?: Reviewer, onSave: (r: { id?: string, name: string, brief: string, concerns: string, originalScore: number | null }) => Promise<void>,
  onCancel: () => void, onRemove?: () => Promise<void>,
}): ReactNode {
  const [name, setName] = useState(initial?.name ?? '')
  const [brief, setBrief] = useState(initial?.brief ?? '')
  const [concerns, setConcerns] = useState(initial?.concerns ?? '')
  const [score, setScore] = useState(initial?.originalScore ? String(initial.originalScore) : '')
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    if (!name.trim()) return
    setBusy(true)
    try { await onSave({ ...(initial ? { id: initial.id } : {}), name: name.trim(), brief: brief.trim(), concerns: concerns.trim(), originalScore: /^\d+$/.test(score) ? Number(score) : null }) } finally { setBusy(false) }
  }
  return <div className={css.rvForm}>
    <label>名字<input value={name} onChange={e => setName(e.target.value)} placeholder="例如 Reviewer 3mFY" /></label>
    <label>原始分数<input value={score} onChange={e => setScore(e.target.value)} placeholder="1–4，可空" inputMode="numeric" /></label>
    <label>身份与立场<textarea value={brief} onChange={e => setBrief(e.target.value)} rows={3}
      placeholder="他是谁、看重什么。例如：严格的 ML 审稿人，对 agent 论文持怀疑态度。" /></label>
    <label>他提过的问题<textarea value={concerns} onChange={e => setConcerns(e.target.value)} rows={5}
      placeholder="真实审稿意见的要点，一条一行。角色扮演时逐条检查是否已经回答。" /></label>
    <div className={css.row}>
      <button className={css.btnPrimary} disabled={busy || !name.trim()} onClick={() => void save()}>保存</button>
      <button className={css.btnGhost} onClick={onCancel}>取消</button>
      <span className={css.grow} />
      {onRemove && <button className={css.btnGhost} disabled={busy} onClick={() => { if (window.confirm('删除这位审稿人？他的意见会保留在“意见”页。')) void onRemove() }}>删除审稿人</button>}
    </div>
  </div>
}

function ResponseBox({ c, author, onSave }: { c: Comment, author: boolean, onSave: (text: string, d: Comment['disposition']) => Promise<void> }): ReactNode {
  const [editing, setEditing] = useState(!c.response)
  const [text, setText] = useState(c.response?.text ?? '')
  const [busy, setBusy] = useState(false)
  const save = async (d: Comment['disposition']): Promise<void> => {
    if (!text.trim()) return
    setBusy(true)
    try { await onSave(text.trim(), d); setEditing(false) } finally { setBusy(false) }
  }
  if (!author) return c.response ? <div className={css.rvAnswer}><b>作者回应</b>{c.disposition && <span className={css.rvDisp}>{DISPOSITION[c.disposition]}</span>}<p>{c.response.text}</p></div> : null
  if (!editing && c.response) return <div className={css.rvAnswer}>
    <div className={css.rvAnswerHead}><b>我们的回应</b>{c.disposition && <span className={cx(css.rvDisp, css[`rvDisp_${c.disposition}`])}>{DISPOSITION[c.disposition]}</span>}
      <span className={css.thRev}>r{c.response.revision}</span><span className={css.grow} /><button className={css.btnGhost} onClick={() => setEditing(true)}>修改</button></div>
    <p>{c.response.text}</p>
  </div>
  return <div className={css.rvReply}>
    <textarea value={text} onChange={e => setText(e.target.value)} rows={3} placeholder="写给这位审稿人的回应：改了哪里，或为什么不改。" />
    <div className={css.row}>
      <button className={css.btnPrimary} disabled={busy || !text.trim()} onClick={() => void save('changed')}>已在稿中修改</button>
      <button className={css.btn} disabled={busy || !text.trim()} onClick={() => void save('rebut')}>据理反驳</button>
      <button className={css.btn} disabled={busy || !text.trim()} onClick={() => void save('decide')}>需作者决定</button>
      {c.response && <button className={css.btnGhost} onClick={() => { setText(c.response?.text ?? ''); setEditing(false) }}>取消</button>}
    </div>
  </div>
}

/** Markdown of one reviewer's comments and the responses, for a rebuttal draft. */
function rebuttalMarkdown(r: Reviewer, comments: Comment[]): string {
  const lines = [`## Response to ${r.name}`, '']
  comments.forEach((c, i) => {
    lines.push(`**${i + 1}. ${c.text.split('\n')[0]!.replace(/^\*+|\*+$/g, '').slice(0, 200)}**`)
    if (c.target.quote) lines.push(`> ${c.target.quote}`)
    lines.push('', c.response ? c.response.text : '_(no response yet)_', '')
  })
  return lines.join('\n')
}

export function Reviewers({ view, actions, onGo, onAsk, busy }: {
  view: ProjectView, actions: ProjectActions, onGo: (f: Focus) => void, onAsk: (t: AgentTask) => void, busy: boolean,
}): ReactNode {
  const author = actions.user.role === 'author'
  const reviewers = view.reviewers ?? []
  const [sel, setSel] = useState<string>(() => reviewers[0]?.id ?? '')
  const [form, setForm] = useState<'new' | 'edit' | null>(null)
  const [roundSel, setRoundSel] = useState<number | null>(null)
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [runSet, setRunSet] = useState<Set<string>>(() => new Set(reviewers.map(r => r.id)))
  const [copied, setCopied] = useState(false)
  const current = reviewers.find(r => r.id === sel) ?? reviewers[0]
  const latest = current?.rounds.at(-1)?.round ?? 0
  const round = roundSel && current?.rounds.some(x => x.round === roundSel) ? roundSel : latest
  const info = current?.rounds.find(x => x.round === round)
  const mine = useMemo(() => view.comments.filter(c => c.source === 'reviewer' && c.reviewer === current?.id), [view.comments, current?.id])
  const inRound = mine.filter(c => (c.round ?? 0) === round && (!onlyOpen || !c.response))
  const pending = (r: Reviewer): number => {
    const last = r.rounds.at(-1)?.round
    return view.comments.filter(c => c.reviewer === r.id && c.round === last && !c.response).length
  }

  if (!reviewers.length && form !== 'new') return <div className={css.rvEmpty}>
    <b>还没有角色扮演审稿人</b>
    <span>添加审稿人：写下他是谁、提过哪些问题。之后每一轮由 agent 为每位审稿人各开一个子代理独立审稿，你在这里逐条回应。</span>
    {author && <button className={css.btnPrimary} onClick={() => setForm('new')}>添加审稿人</button>}
  </div>

  return <div className={css.rvWrap}>
    <aside className={css.rvList}>
      {reviewers.map(r => <button key={r.id} className={cx(css.rvItem, r.id === current?.id && css.rvItemOn)}
        onClick={() => { setSel(r.id); setRoundSel(null); setForm(null) }}>
        <span className={css.rvName}>{r.name}</span>
        <span className={css.rvTrail} title="原始分数 → 各轮分数">{scoreTrail(r)}</span>
        <span className={css.rvMeta}>{r.rounds.length ? `${r.rounds.length} 轮` : '尚未审稿'}{pending(r) ? ` · ${pending(r)} 条待回应` : ''}</span>
      </button>)}
      {author && <button className={css.rvAdd} onClick={() => setForm('new')}>＋ 添加审稿人</button>}
      {author && reviewers.length > 0 && <div className={css.rvRun}>
        <div className={css.rvRunHead}>开始新一轮审稿</div>
        {reviewers.map(r => <label key={r.id} className={css.rvCheck}><input type="checkbox" checked={runSet.has(r.id)}
          onChange={e => { const n = new Set(runSet); if (e.target.checked) n.add(r.id); else n.delete(r.id); setRunSet(n) }} />{r.name}</label>)}
        <button className={css.btnPrimary} disabled={busy || !runSet.size} onClick={() => onAsk({ kind: 'review-round', reviewers: [...runSet] })}>
          {busy ? '审稿中…' : `让 ${runSet.size} 位审稿人各自审一轮`}</button>
        <span className={css.muted}>每位审稿人由一个独立的子代理扮演，看不到彼此；会读到上一轮的意见和你的回应。</span>
      </div>}
    </aside>

    <section className={css.rvMain}>
      {form === 'new' && <ReviewerForm onCancel={() => setForm(null)} onSave={async r => { const v = await actions.saveReviewer(r); setSel(v.reviewers.at(-1)?.id ?? ''); setForm(null) }} />}
      {form !== 'new' && current && <>
        <header className={css.rvHead}>
          <div className={css.rvTitle}><h2>{current.name}</h2><span className={css.rvTrailBig}>{scoreTrail(current)}</span>
            <span className={css.grow} />
            {author && <button className={css.btnGhost} onClick={() => setForm(form === 'edit' ? null : 'edit')}>{form === 'edit' ? '收起' : '编辑审稿人'}</button>}
            <button className={css.btnGhost} disabled={!mine.length} onClick={() => {
              void navigator.clipboard.writeText(rebuttalMarkdown(current, mine.filter(c => (c.round ?? 0) === round))).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })
            }}>{copied ? '已复制' : '复制本轮回应（Markdown）'}</button>
          </div>
          {form === 'edit' && <ReviewerForm initial={current} onCancel={() => setForm(null)}
            onSave={async r => { await actions.saveReviewer(r); setForm(null) }}
            onRemove={async () => { await actions.removeReviewer(current.id); setSel(''); setForm(null) }} />}
          {form !== 'edit' && (current.brief || current.concerns) && <details className={css.rvBrief}>
            <summary>身份与原始意见</summary>
            {current.brief && <p>{current.brief}</p>}
            {current.concerns && <p className={css.rvPre}>{current.concerns}</p>}
          </details>}
        </header>

        {current.rounds.length > 0 && <nav className={css.rvRounds} aria-label="轮次">
          {current.rounds.map(x => <button key={x.round} className={cx(x.round === round && css.rvRoundOn)} onClick={() => setRoundSel(x.round)}>
            第 {x.round} 轮<b>{x.score ?? '–'}</b></button>)}
          <span className={css.grow} />
          <label className={css.rvCheck}><input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} />只看未回应</label>
        </nav>}

        {info && <div className={css.rvRoundCard}>
          <div className={css.rvRoundMeta}>{info.model && <span>{info.model}</span>}<span>读的是修订 r{info.revision}</span><span>{localTime(info.at)}</span></div>
          {info.summary && <div className={css.rvBlock}><b>总评</b><Md text={info.summary} /></div>}
          {info.raise && <div className={css.rvBlock}><b>要升分还需要</b><Md text={info.raise} /></div>}
        </div>}

        {!current.rounds.length && <div className={css.rvEmptyRound}>这位审稿人还没有审过。在左边勾选他，开始新一轮。</div>}

        {inRound.map((c, i) => <article key={c.id} className={cx(css.rvComment, c.response && css.rvDone)}>
          <div className={css.rvCHead}>
            <span className={css.rvNo}>{i + 1}</span>
            {c.severity && <span className={cx(css.rvSev, css[`rvSev_${c.severity}`])}>{SEVERITY[c.severity]}</span>}
            {c.target.kind === 'paragraph' && c.target.id && <button className={css.thWhere} onClick={() => onGo({ kind: 'paragraph', id: c.target.id })} title="跳到正文这一段">{paraLabel(view, c.target.id)}</button>}
            {c.target.kind === 'figure' && c.target.id && <button className={css.thWhere} onClick={() => onGo({ kind: 'figure', id: c.target.id })}>图 {c.target.id}</button>}
            <span className={css.grow} />
            <span className={cx(css.pill, css[`pill_${c.status}`])}>{STATUS_LABEL[c.status]}</span>
          </div>
          {c.target.quote && <blockquote className={css.quote}>{c.target.quote}</blockquote>}
          <div className={css.cmText}><Md text={c.text} /></div>
          <ResponseBox c={c} author={author} onSave={async (text, d) => { await actions.respond(c.id, text, d) }} />
        </article>)}
        {info && !inRound.length && <div className={css.rvEmptyRound}>{onlyOpen ? '这一轮的意见都已回应。' : '这一轮没有意见。'}</div>}
      </>}
    </section>
  </div>
}
