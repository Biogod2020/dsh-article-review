/** Project mode as a DSH sidebar tab: pick a project directory in the workspace, then the shared workbench. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { ProjectView } from '../project/store.ts'
import type { Project } from '../project/model.ts'
import type { ProjectActions } from './project/actions.ts'
import { ProjectWorkbench } from './project/ProjectWorkbench.tsx'
import css from './project/project.module.css'

/** Authenticated transport, supplied by the client entry. */
export interface ProjectRpc {
  call(method: string, payload: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>
}

export type ProjectPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & { rpc: ProjectRpc, openManuscriptReview: () => void }

function stored(key: string): string {
  try { return localStorage.getItem(key) ?? '' } catch { return '' }
}

interface InitJobStatus { output: string, phase: 'prepare' | 'copy' | 'argument' | 'check' | 'done', paused: string, note: string, round: number, rounds: number, label: string }

const PHASE: Record<InitJobStatus['phase'], string> = { prepare: '准备阅读材料', copy: '抄录', argument: '整理论证', check: '检查与报告', done: '已完成' }

/** One line on the initialisation job, with pause / resume / stop. */
function JobLine({ job, onControl }: { job: InitJobStatus, onControl: (a: 'pause' | 'resume' | 'stop') => void }): ReactNode {
  const what = job.phase === 'copy' ? `抄录 ${job.label}（${job.round}/${job.rounds}）` : PHASE[job.phase]
  return <span className={css.jobLine}>
    <span>初始化{job.phase === 'done' ? '已完成' : `：${what}`}{job.paused ? ` · ${job.paused}` : ''}{job.note ? ` · ${job.note}` : ''}</span>
    {job.phase !== 'done' && (job.paused
      ? <button className={css.linkBtn} onClick={() => onControl('resume')}>继续</button>
      : <button className={css.linkBtn} onClick={() => onControl('pause')}>暂停</button>)}
    {job.phase !== 'done' && <button className={css.linkBtn} onClick={() => onControl('stop')}>停止</button>}
  </span>
}

interface InitProblem { field: InitField, level: 'error' | 'warn', message: string }
type InitField = 'source' | 'figures' | 'notes' | 'repo' | 'output'
type InitFormState = Record<InitField, string>

const GENERIC = new Set(['main', 'paper', 'manuscript', 'article', 'draft', 'latex', 'tex', 'src', 'source', 'index', 'ms', 'preprint', 'submission'])
const slug = (s: string): string => s.toLowerCase().replace(/\.[^.]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Default project folder for a manuscript: papers/<name>-project, named after the file or, for main.tex and the like, its folder. */
export function defaultOutput(source: string, n = 1): string {
  const parts = source.trim().replace(/\/+$/, '').split('/').filter(x => x && x !== '.')
  let name = slug(parts.pop() ?? '')
  while ((!name || GENERIC.has(name)) && parts.length) { const up = slug(parts.pop()!); if (up && !GENERIC.has(up)) name = up }
  return `papers/${name || 'paper'}-project${n > 1 ? `-${n}` : ''}`
}

/** One level of the workspace at a time; picks a file, or a folder (the one being shown). */
function PathBrowser({ rpc, sessionId, start, pick, onPick, onClose }: {
  rpc: ProjectRpc, sessionId: string, start: string, pick: 'file' | 'dir', onPick: (path: string) => void, onClose: () => void,
}): ReactNode {
  const [path, setPath] = useState(start)
  const [listing, setListing] = useState<{ path: string, entries: Array<{ name: string, dir: boolean }> } | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const ac = new AbortController()
    rpc.call('paper-project/browse', { sessionId, path }, ac.signal)
      .then(v => { setListing(v as { path: string, entries: Array<{ name: string, dir: boolean }> }); setError('') })
      // a start folder that does not exist yet (a new project's parent) falls back to the workspace root
      .catch(err => { if (!ac.signal.aborted) { if (path !== '.') setPath('.'); else setError(err instanceof Error ? err.message : String(err)) } })
    return () => ac.abort()
  }, [path, rpc, sessionId])
  const join = (name: string): string => listing!.path === '.' ? name : `${listing!.path}/${name}`
  const up = listing && listing.path !== '.' ? (listing.path.includes('/') ? listing.path.replace(/\/[^/]+$/, '') : '.') : null
  return <div className={css.browser}>
    <div className={css.browserBar}>
      <span className={css.muted}>工作区/{listing?.path === '.' ? '' : listing?.path}</span>
      {up !== null && <button className={css.linkBtn} onClick={() => setPath(up)}>上一级</button>}
      <span style={{ flex: 1 }} />
      {pick === 'dir' && listing && <button className={css.btnPrimary} onClick={() => onPick(listing.path)}>选这个文件夹</button>}
      <button className={css.linkBtn} onClick={onClose}>关闭</button>
    </div>
    {error && <p className={css.warnText}>{error}</p>}
    <div className={css.browserList}>
      {listing?.entries.map(e => <button key={e.name} className={css.browserItem} disabled={!e.dir && pick === 'dir'}
        onClick={() => e.dir ? setPath(join(e.name)) : onPick(join(e.name))}>{e.dir ? `${e.name}/` : e.name}</button>)}
      {listing && !listing.entries.length && <span className={css.muted}>（空文件夹）</span>}
    </div>
  </div>
}

export function ProjectPanel({ sessionId, useSession, rpc, openManuscriptReview }: ProjectPanelProps): ReactNode {
  const key = `paper-project:path:${sessionId}`
  const [project, setProject] = useState(() => stored(key))
  const [input, setInput] = useState(project || 'paper-project')
  const [error, setError] = useState('')
  const running = useSession(s => s.running)
  const [refresh, setRefresh] = useState(0)
  const [asked, setAsked] = useState(false)
  const was = useRef(running)
  const [init, setInit] = useState<InitFormState>({ source: '', figures: '', notes: '', repo: '', output: '' })
  const [outputTouched, setOutputTouched] = useState(false)
  const [suffix, setSuffix] = useState(1)
  const [problems, setProblems] = useState<InitProblem[] | null>(null)
  const [browsing, setBrowsing] = useState<InitField | 'open' | null>(null)
  const [initNote, setInitNote] = useState('')
  const pendingOpen = useRef('')
  // the initialisation job the panel drives in rounds: polled while it runs so the author sees where it is
  const [job, setJob] = useState<InitJobStatus | null>(null)
  useEffect(() => {
    let alive = true
    const poll = async (): Promise<void> => {
      try { const v = await rpc.call('paper-project/init-status', { sessionId, project }) as InitJobStatus | null; if (alive) setJob(v) } catch { /* keep the last status */ }
    }
    void poll()
    const t = setInterval(() => { void poll() }, 4000)
    return () => { alive = false; clearInterval(t) }
  }, [rpc, sessionId, running, project])
  const control = async (action: 'pause' | 'resume' | 'stop'): Promise<void> => {
    try { await rpc.call('paper-project/init-control', { sessionId, project, action }); setJob(await rpc.call('paper-project/init-status', { sessionId, project }) as InitJobStatus | null) }
    catch (err) { setInitNote(err instanceof Error ? err.message : String(err)) }
  }
  // An agent turn that ends may have changed the project: reload once it finishes; open a project it just initialised.
  useEffect(() => {
    if (was.current && !running) {
      setRefresh(n => n + 1); setAsked(false)
      if (pendingOpen.current) { const dir = pendingOpen.current; pendingOpen.current = ''; setInput(dir); void openPath(dir) }
    }
    was.current = running
  }, [running])  // openPath reads only its argument and stable setters

  const actions = useMemo<ProjectActions | null>(() => {
    if (!project) return null
    const call = <T,>(method: string, payload: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> =>
      rpc.call(`paper-project/${method}`, { sessionId, project, ...payload }, signal) as Promise<T>
    return {
      user: { name: '你', role: 'author' },
      view: signal => call<ProjectView>('view', {}, signal),
      revision: (n, signal) => call<Project>('revision', { n }, signal),
      apply: (changes, reason) => call('apply', { changes, reason }),
      comment: (target, text) => call('comment', { target, text }),
      setComment: (id, status) => call('set-comment', { id, status }),
      confirm: keys => call('confirm', { keys }),
      setStage: (stage, reason) => call('stage', { stage, reason: reason ?? '' }),
      assign: (id, assignee) => call('assign', { id, assignee }),
      markInSync: paragraph => call('in-sync', { paragraph }),
      decideDraft: (id, accept, text) => call('draft', { id, accept, ...(text === undefined ? {} : { text }) }),
      claimAt: async (claim, hash) => (await call<{ claim: Project['claims'][number] | null }>('claim-at', { claim, hash })).claim,
      ask: async task => { const r = await call<{ summary: string }>('ask', { task, requestId: crypto.randomUUID() }); setAsked(true); return r },
      asset: () => '',
      loadAsset: async path => (await call<{ url: string }>('asset', { path })).url,
    }
  }, [project, rpc, sessionId])

  // Until the author edits it, the project folder follows the manuscript: papers/<name>-project, numbered if taken.
  const output = outputTouched ? init.output : (init.source.trim() ? defaultOutput(init.source, suffix) : '')
  const form = { ...init, output }
  // Check the paths as they are typed, so a wrong one shows here instead of in a failed agent turn.
  useEffect(() => {
    if (!init.source.trim() && !init.figures.trim() && !init.notes.trim() && !init.repo.trim()) { setProblems(null); return }
    const ac = new AbortController()
    const t = setTimeout(() => {
      rpc.call('paper-project/check-init', { sessionId, ...form }, ac.signal).then(v => {
        const found = (v as { problems: InitProblem[] }).problems
        // the default folder is taken: try the next number instead of asking the author to invent a name
        if (!outputTouched && suffix < 20 && found.some(p => p.field === 'output' && p.level === 'error' && init.source.trim())) { setSuffix(n => n + 1); return }
        setProblems(found)
      }).catch(() => { /* the server refuses again on submit; nothing to show while typing */ })
    }, 350)
    return () => { clearTimeout(t); ac.abort() }
  }, [init.source, init.figures, init.notes, init.repo, output, outputTouched, suffix, rpc, sessionId])  // form is derived from these

  const open = async (): Promise<void> => openPath(input.trim())
  const errors = (problems ?? []).filter(p => p.level === 'error')
  const startInit = async (): Promise<void> => {
    const source = init.source.trim()
    if (!source || errors.length || !output.trim()) return
    setInitNote('')
    try {
      await rpc.call('paper-project/init', { sessionId, source, figures: init.figures.trim(), notes: init.notes.trim(), repo: init.repo.trim(), output: output.trim(), requestId: crypto.randomUUID() })
      pendingOpen.current = output
      setInitNote(`已交给当前对话中的 agent：它会逐页阅读稿件，把正文按项目格式抄进来，看图裁出每张图和每个面板，再整理论证。长文可能要半小时以上。新项目建在工作区的 ${output} 文件夹里（另在工作区根目录缓存工具 .paper-tools，约 100 MB）；原始文件只读不改，完成后自动打开。`)
    } catch (err) { setInitNote(err instanceof Error ? err.message : String(err)) }
  }
  async function openPath(path: string): Promise<void> {
    if (!path) return
    setError('')
    try {
      await rpc.call('paper-project/open', { sessionId, project: path })
      try { localStorage.setItem(key, path) } catch { /* private mode: keep it for this session only */ }
      setProject(path)
    } catch (err) { setError(err instanceof Error ? err.message : String(err)) }
  }

  const field = (name: InitField, placeholder: string, label: string, pick: 'file' | 'dir'): ReactNode => {
    const value = name === 'output' ? output : init[name]
    const set = (v: string): void => {
      if (name === 'output') { setOutputTouched(v.trim() !== ''); setInit({ ...init, output: v }) } else { if (name === 'source') setSuffix(1); setInit({ ...init, [name]: v }) }
    }
    // the output folder does not exist yet: browse its parent and keep the new folder's name
    const start = name === 'output' ? (value.includes('/') ? value.replace(/\/[^/]*$/, '') : '.') : (value.trim() ? (pick === 'dir' ? value : value.replace(/\/?[^/]*$/, '') || '.') : '.')
    const own = (problems ?? []).filter(p => p.field === name)
    return <div className={css.initField}>
      <div className={css.row} style={{ margin: 0, flexWrap: 'nowrap' }}>
        <input className={css.reasonInput} style={{ flex: 1, minWidth: 0 }} value={value} onChange={e => set(e.target.value)} placeholder={placeholder} aria-label={label} />
        <button className={css.btn} onClick={() => setBrowsing(browsing === name ? null : name)}>浏览…</button>
      </div>
      {browsing === name && <PathBrowser rpc={rpc} sessionId={sessionId} start={start} pick={pick}
        onPick={p => { setBrowsing(null); set(name === 'output' ? `${p === '.' ? '' : `${p}/`}${value.split('/').pop() || defaultOutput(init.source).split('/').pop()}` : p) }}
        onClose={() => setBrowsing(null)} />}
      {own.map(p => <span key={p.message} className={p.level === 'error' ? css.warnText : css.muted} style={{ fontSize: 12 }}>{p.level === 'warn' ? '提醒：' : ''}{p.message}</span>)}
    </div>
  }

  if (!actions) return <div className={css.app}><div className={css.empty}>
    <p>打开一个论文项目：工作区里包含 <code>project.json</code> 的文件夹。</p>
    <div className={css.row} style={{ justifyContent: 'center' }}>
      <input className={css.reasonInput} value={input} onChange={e => setInput(e.target.value)} placeholder="例如 papers/my-paper" aria-label="项目文件夹"
        onKeyDown={e => { if (e.key === 'Enter') void open() }} />
      <button className={css.btn} onClick={() => setBrowsing(browsing === 'open' ? null : 'open')}>浏览…</button>
      <button className={css.btnPrimary} onClick={() => void open()}>打开</button></div>
    {browsing === 'open' && <PathBrowser rpc={rpc} sessionId={sessionId} start={input.trim() || '.'} pick="dir"
      onPick={p => { setBrowsing(null); setInput(p); void openPath(p) }} onClose={() => setBrowsing(null)} />}
    {error && <p className={css.warnText}>{error}</p>}
    <div className={css.initBox}>
      <p><b>从已有稿件初始化</b>：agent 逐页阅读稿件（PDF、Word、LaTeX、Markdown 等），把正文抄成项目格式，看图裁出图和面板，再反推故事流、对应段落，生成一个新项目文件夹；填了研究仓库时，还会对照仓库里的计划、结果和出图脚本检查问题，并给出处理建议。原始文件和仓库都只读不改。</p>
      {field('source', '稿件路径，例如 paper/main.tex 或 originals/preprint.pdf', '稿件路径', 'file')}
      {field('figures', '图所在文件夹（可选），例如 paper/figures', '图文件夹', 'dir')}
      {field('notes', '已有意见文件（可选，.json 或 .md）', '已有意见', 'file')}
      {field('repo', '研究仓库（可选，填 . 表示整个工作区）：读取计划、结果、出图脚本和提交记录', '研究仓库', 'dir')}
      {field('output', '新项目文件夹，默认 papers/<稿件名>-project', '新项目文件夹', 'dir')}
      <p className={css.muted}>新项目建在当前工作区里（agent 和面板只能读写工作区）。想放到别的目录，请在那个目录打开一个新的工作区再初始化。</p>
      <button className={css.btnPrimary} disabled={!init.source.trim() || !output.trim() || errors.length > 0 || running} onClick={() => void startInit()}>交给 agent 初始化</button>
      {running && <span className={css.muted}>agent 正在回答，结束后才能交给它。</span>}
      {initNote && <p className={css.muted}>{initNote}</p>}
      {job && <JobLine job={job} onControl={a => void control(a)} />}
    </div>
    <div className={css.initBox}>
      <p><b>只审阅一份稿件</b>：不建项目，直接打开一份 Markdown 稿件逐段阅读、批注和修改（原来的“阅读、批注与修改”）。</p>
      <button className={css.btn} onClick={openManuscriptReview}>打开逐段审阅</button>
    </div>
  </div></div>
  return <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
    <div className={css.projectBar}><span className={css.muted}>项目：{project}</span>
      {job && job.output === project && <JobLine job={job} onControl={a => void control(a)} />}
      <button className={css.linkBtn} onClick={() => { setProject(''); try { localStorage.removeItem(key) } catch { /* ignore */ } }}>换一个</button></div>
    <div style={{ flex: 1, minHeight: 0 }}><ProjectWorkbench key={project} actions={actions} refresh={refresh} agentBusy={asked && running} /></div>
  </div>
}
