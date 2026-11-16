/**
 * Project mode workbench. The story flow is the centre; figures, prose, reading and comments hang off it.
 * Agent work runs one task at a time and reports in the activity line; the view refreshes so collaborators'
 * comments and agent edits appear without reloading.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Target } from '../../project/model.ts'
import type { ProjectView } from '../../project/store.ts'
import type { AgentTask, ProjectActions } from './actions.ts'
import { STAGE_LABEL, cx, progressByType, unitFocus } from './common.tsx'
import { StoryCanvas } from './StoryCanvas.tsx'
import type { Focus } from './common.tsx'
import { Figures } from './Figures.tsx'
import { Draft } from './Manuscript.tsx'
import { Reader } from './Reader.tsx'
import { History, Inbox, Network, Numbers, Overview } from './Panels.tsx'
import { Reviewers } from './Reviewers.tsx'
import { PERSONAS } from '../../project/prompts.ts'
import type { FlowStep } from '../../project/flow.ts'
import css from './project.module.css'

type Tab = 'overview' | 'story' | 'figures' | 'draft' | 'read' | 'inbox' | 'reviewers' | 'numbers' | 'history' | 'network'
const THEMES = { auto: '◐ 跟随系统', light: '☀ 浅色', dark: '☾ 深色' } as const
const TABS: { key: Tab, label: string, extra?: boolean }[] = [
  { key: 'overview', label: '概览' }, { key: 'story', label: '故事流' }, { key: 'figures', label: '图' },
  { key: 'draft', label: '正文' }, { key: 'read', label: '阅读' }, { key: 'inbox', label: '意见' }, { key: 'reviewers', label: '审稿人' },
  { key: 'numbers', label: '数字', extra: true }, { key: 'history', label: '历史', extra: true }, { key: 'network', label: '论点网络', extra: true },
]

const taskLabel = (t: AgentTask): string => {
  switch (t.kind) {
    case 'skeleton': return '根据材料起草故事流'
    case 'persona': return `以「${PERSONAS[t.persona].name}」视角审阅`
    case 'refine': return `处理 ${t.comments.length} 条意见`
    case 'draft': return '按骨架写一节正文'
    case 'resync': return `按新论点重写 ${t.paragraphs.length} 个段落`
    case 'chat': return '处理对话请求'
    case 'numbers': return '给未登记数字分类'
    case 'frame': return '起草或修改摘要与引言'
    case 'review': return t.scope === 'argument' ? '论点与图外审一轮' : '正文外审一轮'
    case 'draft-all': return '按骨架写其余正文'
    case 'polish': return '最后润色一次'
    case 'review-round': return `${t.reviewers.length} 位审稿人各审一轮`
  }
}

/**
 * @param refresh - changes when the host knows the project changed (an agent turn ended), forcing a reload.
 * @param agentBusy - the host's agent is working on something this panel asked for.
 */
export function ProjectWorkbench({ actions, refresh: refreshKey = 0, agentBusy = false }: { actions: ProjectActions, refresh?: number, agentBusy?: boolean }): ReactNode {
  const [view, setView] = useState<ProjectView | null>(null)
  const [error, setError] = useState('')
  // the open tab survives a reload: it is kept in the address (#read) and, as a fallback, in local storage
  const [tab, setTabState] = useState<Tab>(() => {
    const ok = (x: string | null): x is Tab => !!x && TABS.some(t => t.key === x)
    const h = location.hash.replace(/^#/, '')
    let saved: string | null = null
    try { saved = localStorage.getItem('paper-open-tab') } catch { /* private mode */ }
    return ok(h) ? h : ok(saved) ? saved : 'story'
  })
  const setTab = useCallback((t: Tab) => {
    setTabState(t)
    try { localStorage.setItem('paper-open-tab', t) } catch { /* private mode */ }
    if (location.hash !== `#${t}`) history.replaceState(null, '', `#${t}`)
  }, [])
  useEffect(() => {
    const f = (): void => { const h = location.hash.replace(/^#/, ''); if (TABS.some(t => t.key === h)) setTabState(h as Tab) }
    window.addEventListener('hashchange', f)
    return () => window.removeEventListener('hashchange', f)
  }, [])
  const [focus, setFocus] = useState<Focus | null>(null)
  const [readAt, setReadAt] = useState('')
  const [draftAt, setDraftAt] = useState('')
  const [origin, setOrigin] = useState('')
  const [busy, setBusy] = useState<string>('')
  const [log, setLog] = useState<{ at: string, text: string, ok: boolean }[]>([])
  const [showMore, setShowMore] = useState(false)
  const [help, setHelp] = useState(false)
  const nextRef = useRef<() => void>(() => undefined)
  useEffect(() => {
    const f = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable=true]') || e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === '?') setHelp(v => !v)
      else if (e.key === 'Escape') setHelp(false)
      else if (e.key === 'n' || e.key === 'N') nextRef.current()
    }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [])
  const lastJump = useRef('')
  // appearance shared with the paper-argument frontend: follow the system, light or dark
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => (localStorage.getItem('paper-arch-theme') as 'auto' | 'light' | 'dark' | null) ?? 'auto')
  const [sysDark, setSysDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => { const m = matchMedia('(prefers-color-scheme: dark)'); const f = (): void => setSysDark(m.matches); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  const dark = theme === 'dark' || (theme === 'auto' && sysDark)
  const cycleTheme = (): void => { const n = theme === 'auto' ? 'light' : theme === 'light' ? 'dark' : 'auto'; localStorage.setItem('paper-arch-theme', n); setTheme(n) }
  const alive = useRef(true)

  const refresh = useCallback(async () => {
    try { const v = await actions.view(); if (alive.current) { setView(v); setError('') } } catch (err) { if (alive.current) setError(String(err)) }
  }, [actions])
  useEffect(() => {
    alive.current = true
    void refresh()
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh() }, 8000)
    return () => { alive.current = false; clearInterval(t) }
  }, [refresh])
  useEffect(() => { if (refreshKey) void refresh() }, [refreshKey, refresh])

  /** Wrap a store action so its returned view replaces ours and errors are shown, not thrown. */
  const wrapped: ProjectActions = {
    ...actions,
    apply: async (c, r) => { const v = await actions.apply(c, r); setView(v); return v },
    comment: async (t, s) => { const v = await actions.comment(t, s); setView(v); return v },
    setComment: async (id, s) => { const v = await actions.setComment(id, s); setView(v); return v },
    confirm: async k => { const v = await actions.confirm(k); setView(v); return v },
    setStage: async (s, r) => { const v = await actions.setStage(s, r); setView(v); return v },
    saveReviewer: async r => { const v = await actions.saveReviewer(r); setView(v); return v },
    removeReviewer: async id => { const v = await actions.removeReviewer(id); setView(v); return v },
    respond: async (id, t, d) => { const v = await actions.respond(id, t, d); setView(v); return v },
    assign: async (id, a) => { const v = await actions.assign(id, a); setView(v); return v },
    markInSync: async id => { const v = await actions.markInSync(id); setView(v); return v },
    decideDraft: async (id, accept, text) => { const v = await actions.decideDraft(id, accept, text); setView(v); return v },
    lockFrame: async (lock, reason) => { const v = await actions.lockFrame(lock, reason); setView(v); return v },
  }

  const ask = useCallback(async (task: AgentTask) => {
    if (busy) return
    const label = taskLabel(task)
    setBusy(label)
    try {
      const r = await actions.ask(task)
      if (r.view) setView(r.view); else await refresh()
      setLog(l => [{ at: new Date().toTimeString().slice(0, 5), text: `${label}：${r.summary}`, ok: true }, ...l].slice(0, 20))
    } catch (err) {
      setLog(l => [{ at: new Date().toTimeString().slice(0, 5), text: `${label}失败：${String(err)}`, ok: false }, ...l].slice(0, 20))
    } finally { setBusy('') }
  }, [actions, busy, refresh])

  /** "Hand to the agent": record the comment, then ask the agent to answer exactly that comment. */
  const askComment = useCallback(async (target: Target, text: string) => {
    const v = await actions.comment(target, text)
    setView(v)
    const mine = v.comments.filter(c => c.text === text && c.author === actions.user.name).at(-1)
    if (mine) await ask({ kind: 'refine', comments: [mine.id] })
  }, [actions, ask])

  const go = useCallback((f: Focus | null) => {
    setFocus(f)
    if (!f) return
    setOrigin(f.from ?? '')
    if (f.kind === 'paragraph') {
      // a paragraph with a rewrite waiting opens where the rewrite can be decided
      if (view?.drafts.some(d => d.paragraph === f.id && d.status === 'pending')) { setDraftAt(f.id); setTab('draft') } else { setReadAt(f.id); setTab('read') }
    }
    else if (f.kind === 'figure') setTab('figures')
    else setTab('story')
  }, [view, setTab])

  /** Do the workflow's next step: hand an agent step over, perform a panel action, or open where the author does it. */
  const runFlow = (s: FlowStep): void => {
    const fail = (err: unknown): void => setLog(l => [{ at: new Date().toTimeString().slice(0, 5), text: `${s.title}失败：${String(err)}`, ok: false }, ...l].slice(0, 20))
    if (s.who === 'agent' && s.task) { void ask(s.task); return }
    if (s.action === 'lock-frame') { void wrapped.lockFrame(true).catch(fail); return }
    if (s.action === 'advance') { void wrapped.setStage(s.stage).catch(fail); return }
    if (s.focus) go(unitFocus(s.focus))
    else if (s.go) setTab(s.go)
  }

  if (!view) return <div className={css.app}><div className={css.empty}>{error ? `无法载入项目：${error}` : '载入中…'}</div></div>
  // role-play reviewer comments live only in the 审稿人 tab; every other tab and count sees the rest
  const pv: ProjectView = { ...view, comments: view.comments.filter(c => !c.reviewer) }
  // the tab badge counts people's comments and replies waiting for the author; model reviews are shown apart
  const human = (c: { source: string }): boolean => c.source === 'author' || c.source === 'collaborator' || c.source === 'chat' || c.source === 'check'
  const openCount = pv.comments.filter(c => c.status === 'open' && human(c)).length
  const answered = pv.comments.filter(c => c.status === 'answered').length
  const modelOpen = pv.comments.filter(c => c.status === 'open' && !human(c)).length
  const pendingDrafts = view.drafts.filter(d => d.status === 'pending').length
  const prog = progressByType(pv)
  /** Next unit changed since review, then never reviewed, in story order. */
  const nextPending = (): void => {
    const order = view.units.map(u => u.key)
    const pick = (s: string): string | undefined => order.find((k, i) => i > order.indexOf(lastJump.current) && view.status[k] === s) ?? order.find(k => view.status[k] === s)
    const k = pick('changed') ?? pick('new')
    if (!k) return
    lastJump.current = k
    const [kind, id] = k.includes(':') ? k.split(':') as [string, string] : [k, k]
    go({ kind: kind as Focus['kind'], id })
  }
  nextRef.current = nextPending
  return <div className={css.app} data-theme={dark ? 'dark' : 'light'}>
    <header className={css.top}>
      <h1 className={css.title} title={view.project.title}>{view.project.title}</h1>
      <span className={css.stageChip} onClick={() => setTab('overview')} title="阶段与清单">阶段 · {STAGE_LABEL[view.project.stage]}</span>
      <nav className={css.segTabs}>{TABS.filter(t => !t.extra || showMore || tab === t.key).map(t => <button key={t.key} className={cx(tab === t.key && css.segOn)} onClick={() => setTab(t.key)}>
        {t.label}{t.key === 'inbox' && (openCount + answered) > 0 && <span className={css.tabBadge} title="人的未处理意见 + 等你确认的回应">{openCount + answered}</span>}
        {t.key === 'inbox' && modelOpen > 0 && <span className={css.tabBadgeSoft} title="模拟审阅的未处理意见">AI {modelOpen}</span>}
        {t.key === 'draft' && pendingDrafts > 0 && <span className={css.tabBadge} title="待确认的段落改写">{pendingDrafts}</span>}</button>)}
        <button className={css.segMore} onClick={() => setShowMore(!showMore)}>{showMore ? '收起' : '更多 ▾'}</button></nav>
      <span className={css.grow} />
      {actions.user.role === 'author' && <>
        <span className={css.progSet} title="已审 = 你确认过、之后未变；橙色 = 确认过之后被改；灰色 = 从未确认。点一类跳到这一类里下一处待审">
          {prog.map(g => <button key={g.key} className={cx(css.progChip, g.ok === g.all && css.progDone)} onClick={() => { if (g.next) go(unitFocus(g.next)); else setTab(g.key === 'story' ? 'story' : g.key === 'figure' ? 'figures' : 'read') }}>
            {g.label} {g.ok}/{g.all}<span className={css.meterS}><i style={{ width: `${g.all ? 100 * g.ok / g.all : 0}%`, background: 'var(--ok)' }} /><i style={{ width: `${g.all ? 100 * g.changed / g.all : 0}%`, background: 'var(--chg)' }} /></span></button>)}</span>
        <button className={css.btn} onClick={nextPending} title="跳到下一处审后有修改或未审的地方（快捷键 N）">下一处待审 ▸</button>
        {view.flow.next.who !== 'none' && <button className={css.btnPrimary} disabled={!!busy && view.flow.next.who === 'agent'} onClick={() => runFlow(view.flow.next)}
          title={`推荐流程的下一步：${view.flow.next.title}（${view.flow.next.who === 'agent' ? '交给 agent' : '由你来做'}）`}>继续推进 ▸</button>}</>}
      <button className={css.btn} onClick={() => setHelp(true)} title="快捷键说明（?）">?</button>
      <button className={cx(css.btn, css.themeBtn)} onClick={cycleTheme} title="外观：跟随系统 → 浅色 → 深色">{THEMES[theme]}</button>
      {actions.user.role === 'collaborator' && <span className={css.hintbar}>协作者 · {actions.user.name}</span>}
    </header>
    {(busy || agentBusy || log[0]) && <div className={cx(css.activity, (busy || agentBusy) && css.activityBusy)} role="status" aria-live="polite">
      {busy ? <><span className={css.spinner} />Agent 正在{busy}…</> : agentBusy ? <><span className={css.spinner} />对话中的 agent 正在处理，完成后自动刷新…</>
        : log[0] && <span className={log[0].ok ? '' : css.warnText}>{log[0].at} {log[0].text}<button className={css.linkBtn} onClick={() => setLog([])}>知道了</button></span>}
    </div>}
    {actions.user.role === 'collaborator' && <div className={css.collabBanner}>你以协作者身份查看：可以阅读全部内容并写意见；agent 修改、确认已审和推进阶段由作者进行。</div>}
    <main className={css.main}>
      {tab === 'overview' && <Overview view={pv} actions={wrapped} onAsk={t => void ask(t)} busy={!!busy} onTab={t => setTab(t as Tab)} onGo={go} onFlow={runFlow} />}
      {tab === 'story' && <StoryCanvas view={pv} actions={wrapped} focus={focus} onGo={go} onAskComment={askComment}
        onRead={id => { setReadAt(id); setTab('read') }} />}
      {tab === 'figures' && <Figures view={pv} actions={wrapped} onFocus={go} focus={focus} />}
      {tab === 'draft' && <Draft view={pv} actions={wrapped} onFocus={go} onAsk={t => void ask(t)} busy={!!busy} start={draftAt} from={origin} onBack={() => { setOrigin(''); setTab('inbox') }} onRead={id => { setReadAt(id); setTab('read') }} />}
      {tab === 'read' && <Reader view={pv} actions={wrapped} start={readAt} onFocus={go} onAskComment={askComment} />}
      {tab === 'inbox' && <Inbox view={pv} actions={wrapped} onGo={go} onAsk={t => void ask(t)} busy={!!busy} />}
      {tab === 'reviewers' && <Reviewers view={view} actions={wrapped} onGo={go} onAsk={t => void ask(t)} busy={!!busy} />}
      {tab === 'numbers' && <Numbers view={pv} actions={wrapped} onGo={go} onAsk={t => void ask(t)} busy={!!busy} />}
      {tab === 'history' && <History view={pv} onGo={go} />}
      {tab === 'network' && <Network view={pv} onGo={go} />}
    </main>
    {help && <div className={css.modalBack} onClick={() => setHelp(false)}><div className={css.modal} onClick={e => e.stopPropagation()} role="dialog" aria-label="快捷键说明">
      <div className={css.cardHead}>快捷键</div>
      <table className={css.keys}><tbody>
        <tr><th colSpan={2}>任何页面</th></tr>
        <tr><td><kbd>N</kbd></td><td>跳到下一处待审（先是审后有修改，再是未审）</td></tr>
        <tr><td><kbd>?</kbd></td><td>打开或关闭本说明</td></tr>
        <tr><th colSpan={2}>阅读</th></tr>
        <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>上一页 / 下一页（PageUp / PageDown 也可以）</td></tr>
        <tr><td><kbd>C</kbd></td><td>本页已审并翻到下一页；本页的增删标记随之消失</td></tr>
        <tr><td><kbd>T</kbd></td><td>打开或关闭目录</td></tr>
        <tr><td>选中文字 / 右键</td><td>高亮（四种颜色）、针对这句话写意见；右键已有的高亮可以换颜色、写意见、删除</td></tr>
        <tr><th colSpan={2}>图</th></tr>
        <tr><td><kbd>←</kbd> <kbd>→</kbd></td><td>上一张 / 下一张</td></tr>
        <tr><td><kbd>C</kbd></td><td>这张图已审并看下一张</td></tr>
        <tr><th colSpan={2}>故事流</th></tr>
        <tr><td>滚轮 / 拖动</td><td>移动画布；Ctrl 或 ⌘ 加滚轮缩放</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>关闭详情、目录或放大的图</td></tr>
        <tr><th colSpan={2}>写意见</th></tr>
        <tr><td><kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd></td><td>保存意见</td></tr>
      </tbody></table>
      <div className={css.muted}>C 会写入你的确认记录，目前不能撤销。</div>
      <div className={css.row}><button className={css.btn} onClick={() => setHelp(false)}>关闭</button></div>
    </div></div>}
  </div>
}
