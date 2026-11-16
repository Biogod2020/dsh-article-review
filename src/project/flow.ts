/**
 * The recommended workflow, read from the project itself. Each stage has one milestone; the next step is the first
 * thing that still stands between the paper and that milestone, starting from the stage the author has set. Earlier
 * stages the author skipped are listed, never forced: the author can start anywhere.
 *
 * Who does what is fixed: agents draft, review and propose; the author decides (reads, picks comments, accepts
 * rewrites, locks the abstract and introduction, advances the stage). A step the author owes always comes first,
 * so the agent never piles new work on top of decisions still waiting.
 */
import type { Comment, Project, ReviewState, Stage } from './model.ts'
import { STAGES } from './model.ts'
import type { ProjectTask } from './prompts.ts'
import type { FrameStatus } from './units.ts'
import { frameStatus, reviewStatus, syncIssues, unregisteredNumbers } from './units.ts'

/** Where an author step is done in the panel. */
export type FlowGo = 'overview' | 'story' | 'figures' | 'draft' | 'read' | 'inbox' | 'numbers'

export interface FlowStep {
  who: 'agent' | 'author' | 'none'
  /** the stage this step belongs to */
  stage: Stage
  title: string
  why: string
  /** agent steps: the task to hand over */
  task?: ProjectTask
  /** author steps: where to do it, and the unit to open first */
  go?: FlowGo
  focus?: string | undefined
  /** author steps the panel can perform directly */
  action?: 'lock-frame' | 'advance'
}

export interface FlowMilestone { stage: Stage, label: string, done: boolean, detail: string }

export interface FlowStatus {
  /** the stage the author set */
  recorded: Stage
  /** the first stage whose milestone is not met, from the start */
  detected: Stage
  milestones: FlowMilestone[]
  /** milestones before the recorded stage that are not met: shown, not forced */
  skipped: FlowMilestone[]
  next: FlowStep
  frame: FrameStatus
}

/** After this many agent rounds on the abstract and introduction, the advice is to lock them. */
export const FRAME_ROUND_LIMIT = 3
const PERSONA = new Set<Comment['source']>(['editor', 'reviewer', 'audience'])
const HUMAN = new Set<Comment['source']>(['author', 'collaborator', 'chat', 'check'])
const ARGUMENT_STAGES = new Set<Stage>(['materials', 'skeleton', 'refine'])
export const STAGE_NAME: Record<Stage, string> = {
  materials: '材料', skeleton: '骨架', refine: '论点与图', frame: '摘要与引言', draft: '成文', read: '阅读审核', submit: '投稿',
}

export function flowStatus(p: Project, full: ReviewState): FlowStatus {
  // role-play reviewers (the Reviewers tab) answer a real review; their comments are not this workflow's outside review
  const st: ReviewState = { ...full, comments: full.comments.filter(c => !c.reviewer) }
  const status = reviewStatus(p, st)
  const frame = frameStatus(p, st)
  const inFrame = new Set(frame.paragraphs)
  const sync = syncIssues(p)
  const paragraphs = p.sections.flatMap(s => s.paragraphs)
  const open = st.comments.filter(c => c.status === 'open')
  const personaOpen = (argument: boolean): Comment[] => open.filter(c => PERSONA.has(c.source) && ARGUMENT_STAGES.has(c.stage) === argument)
  const reviewed = (argument: boolean): boolean => st.comments.some(c => PERSONA.has(c.source) && ARGUMENT_STAGES.has(c.stage) === argument)
  const unreviewed = (prefixes: string[]): string[] => Object.entries(status).filter(([k, v]) => v !== 'reviewed' && prefixes.some(x => k === x || k.startsWith(`${x}:`))).map(([k]) => k)
  const core = p.claims.filter(c => c.role === 'core')
  const weak = core.filter(c => !c.evidence.some(e => e.kind === 'support' && e.status === 'sufficient'))
  const unplaced = p.figures.filter(f => f.placement === 'unplaced')
  const argUnreviewed = unreviewed(['thesis', 'beat', 'claim', 'figure'])
  // the body must state every claim on its own: the abstract and introduction name claims but do not write them up
  const body = p.sections.filter(s => !frame.sections.includes(s.id)).flatMap(s => s.paragraphs)
  const stated = new Set(body.flatMap(x => x.claims))
  const unwritten = p.claims.filter(c => !stated.has(c.id))
  const proseNumbers = unregisteredNumbers(p).filter(n => n.where.startsWith('paragraph:'))
  const paraUnreviewed = unreviewed(['paragraph'])
  const pendingDrafts = st.drafts.filter(d => d.status === 'pending' && paragraphs.find(x => x.id === d.paragraph)?.text === d.before)
  const hasSkeleton = !!p.thesis.statement && p.beats.length > 0 && p.beats.every(b => b.claims.length > 0)

  const milestones: FlowMilestone[] = [
    { stage: 'materials', label: '材料已登记', done: p.materials.length > 0 || hasSkeleton, detail: `${p.materials.length} 份材料` },
    { stage: 'skeleton', label: '有核心论点和故事流', done: hasSkeleton, detail: hasSkeleton ? `${p.beats.length} 拍、${p.claims.length} 个分论点` : '还没有完整的故事流' },
    { stage: 'refine', label: '论点与图已定',
      done: hasSkeleton && reviewed(true) && !personaOpen(true).length && !weak.length && !unplaced.length && !argUnreviewed.length,
      detail: [!reviewed(true) && '还没做论点外审', personaOpen(true).length && `${personaOpen(true).length} 条外审意见待挑选`, weak.length && `${weak.length} 个核心分论点证据不足`,
        unplaced.length && `${unplaced.length} 张图未定位置`, argUnreviewed.length && `${argUnreviewed.length} 处未审`].filter(Boolean).join('；') || '已定' },
    { stage: 'frame', label: '摘要与引言已锁定', done: frame.locked,
      detail: frame.locked ? '已锁定' : frame.changedSinceLock ? '锁定后有改动' : frame.paragraphs.length ? `未锁定（第 ${frame.rounds} 轮）` : '还没写' },
    { stage: 'draft', label: '正文写完、与骨架同步、数字有出处', done: body.length > 0 && !unwritten.length && !sync.length && !proseNumbers.length,
      detail: [!body.length && '还没有正文', unwritten.length && `${unwritten.length} 个分论点还没写`, sync.filter(s => s.kind !== 'unwritten').length > 0 && `${sync.filter(s => s.kind !== 'unwritten').length} 处不同步`,
        proseNumbers.length && `${proseNumbers.length} 个数字不在登记表`].filter(Boolean).join('；') || '已完成' },
    { stage: 'read', label: '正文外审一轮、意见已处理、段落都已审',
      done: paragraphs.length > 0 && reviewed(false) && !personaOpen(false).length && !paraUnreviewed.length && !open.some(c => HUMAN.has(c.source)),
      detail: [!reviewed(false) && '还没做正文外审', personaOpen(false).length && `${personaOpen(false).length} 条外审意见待挑选`, paraUnreviewed.length && `${paraUnreviewed.length} 段未审`].filter(Boolean).join('；') || '已完成' },
    { stage: 'submit', label: '最后润色一次，进入投稿', done: st.flow.polished !== null && !pendingDrafts.length && p.stage === 'submit',
      detail: st.flow.polished === null ? '还没润色' : p.stage === 'submit' ? '已进入投稿' : '已润色' },
  ]
  const at = STAGES.indexOf(p.stage)
  const detected = milestones.find(m => !m.done)?.stage ?? 'submit'
  const skipped = milestones.filter(m => STAGES.indexOf(m.stage) < at && !m.done)
  const step = (s: Omit<FlowStep, 'stage'>, stage: Stage = p.stage): FlowStep => ({ stage, ...s })

  const next = ((): FlowStep => {
    // 1. Decisions the author owes come first.
    if (pendingDrafts.length) return step({ who: 'author', title: `确认 ${pendingDrafts.length} 段改写`, why: 'agent 提出的改写都在等你逐段接受或放弃；处理完再让 agent 做下一步。', go: 'draft', focus: pendingDrafts[0]!.paragraph })
    const answered = st.comments.filter(c => c.status === 'answered')
    if (answered.length) return step({ who: 'author', title: `看 ${answered.length} 条 agent 的回应`, why: 'agent 已回应这些意见；看过再关闭或重新打开。', go: 'inbox' })
    // 2. Prose that states old claims, and comments people wrote, are handled before anything new.
    const stale = [...new Set(sync.filter(s => s.kind !== 'unwritten').map(s => s.paragraph))]
    if (stale.length) return step({ who: 'agent', title: `按新论点改写 ${stale.length} 段`, why: '这些段落写好后它们陈述的分论点改了。', task: { kind: 'resync', paragraphs: stale.slice(0, 40) } })
    const people = open.filter(c => HUMAN.has(c.source) && !(c.target.kind === 'paragraph' && inFrame.has(c.target.id) && !frame.locked))
    if (people.length) return step({ who: 'agent', title: `处理 ${people.length} 条人的意见`, why: '人写的意见就是修改指令，先处理。', task: { kind: 'refine', comments: people.slice(0, 20).map(c => c.id) } })

    for (const m of milestones.slice(at)) {
      if (m.done) continue
      // the stage label follows the work: move it on once the current stage's milestone is met (polish comes before submit)
      if (STAGES.indexOf(m.stage) > at && !(m.stage === 'submit' && st.flow.polished === null))
        return step({ who: 'author', action: 'advance', title: `进入阶段：${STAGE_NAME[m.stage]}`, why: `「${STAGE_NAME[p.stage]}」的目标已达到。` }, m.stage)
      switch (m.stage) {
        case 'materials':
          return step({ who: 'author', title: '登记材料', why: '把数据、结果、已有的图和目标期刊交给项目；或者在对话里用已有稿件建项目。', go: 'overview' })
        case 'skeleton':
          return step({ who: 'agent', title: '起草故事流', why: '先定核心论点、各拍和分论点，再谈正文。', task: { kind: 'skeleton' } })
        case 'refine':
          if (!reviewed(true)) return step({ who: 'agent', title: '论点与图外审一轮', why: '编辑、审稿人、读者一次看完论点和图；你从完整意见清单里挑要处理的。', task: { kind: 'review', scope: 'argument' } })
          if (personaOpen(true).length) return step({ who: 'author', title: `挑选 ${personaOpen(true).length} 条外审意见`, why: '只处理威胁分论点的、真审稿人会问的；其余标“不采纳”。', go: 'inbox' })
          if (weak.length) return step({ who: 'author', title: `${weak.length} 个核心分论点证据不足`, why: '补证据、降低说法，或改成非核心；agent 不能替你造数据。', go: 'story', focus: `claim:${weak[0]!.id}` })
          if (unplaced.length) return step({ who: 'author', title: `${unplaced.length} 张图未定主图或扩展数据`, why: '图的位置决定故事的主次。', go: 'figures' })
          return step({ who: 'author', title: `审完论点与图（${argUnreviewed.length} 处未审）`, why: '你逐个确认之后，论点与图就是后文的依据。', go: 'story', focus: argUnreviewed[0] })
        case 'frame': {
          if (!frame.paragraphs.length) return step({ who: 'agent', title: '起草摘要与引言', why: '先把论点写成摘要和引言，锁定后再写其余部分。', task: { kind: 'frame' } })
          if (frame.changedSinceLock) return step({ who: 'author', action: 'lock-frame', title: '重新锁定摘要与引言', why: '锁定后正文有改动；确认后重新锁定。' })
          const onFrame = open.filter(c => c.target.kind === 'paragraph' && inFrame.has(c.target.id))
          if (onFrame.length && frame.rounds < FRAME_ROUND_LIMIT)
            return step({ who: 'agent', title: `按 ${onFrame.length} 条意见修改摘要与引言`, why: `第 ${frame.rounds + 1} 轮；超过 ${FRAME_ROUND_LIMIT} 轮建议直接定稿。`, task: { kind: 'frame' } })
          if (onFrame.length) return step({ who: 'author', action: 'lock-frame', title: '定稿并锁定摘要与引言', why: `已经讨论 ${frame.rounds} 轮。剩下的意见留到正文外审，或改完直接锁定。` })
          const fresh = frame.paragraphs.filter(id => status[`paragraph:${id}`] !== 'reviewed')
          if (fresh.length) return step({ who: 'author', title: `读摘要与引言（${fresh.length} 段未审）`, why: '逐段读：要改就写意见，满意就确认已审。', go: 'read', focus: `paragraph:${fresh[0]}` })
          return step({ who: 'author', action: 'lock-frame', title: '锁定摘要与引言', why: '锁定后其余部分都按它写；agent 之后只能提议改写。' })
        }
        case 'draft':
          if (unwritten.length || !body.length) return step({ who: 'agent', title: `按骨架写其余正文（${unwritten.length} 个分论点未写）`, why: '按锁定的摘要与引言，一次写完结果、方法和讨论。', task: { kind: 'draft-all' } })
          if (proseNumbers.some(n => !st.numberHints[`${n.where}|${n.value}`])) return step({ who: 'agent', title: `给 ${proseNumbers.length} 个未登记数字分类`, why: '先分出结果和参数，你只需核对结果。', task: { kind: 'numbers' } })
          return step({ who: 'author', title: `处理 ${proseNumbers.length} 个未登记数字`, why: '登记出处，或标为参数忽略。', go: 'numbers' })
        case 'read':
          if (!reviewed(false)) return step({ who: 'agent', title: '正文外审一轮', why: '编辑、审稿人、读者一次读完正文；你从完整清单里挑。', task: { kind: 'review', scope: 'prose' } })
          if (personaOpen(false).length) return step({ who: 'author', title: `挑选 ${personaOpen(false).length} 条外审意见`, why: '只处理威胁分论点的、真审稿人会问的；其余标“不采纳”。', go: 'inbox' })
          return step({ who: 'author', title: `通读正文（${paraUnreviewed.length} 段未审）`, why: '对照面板逐段读；要改就写意见。', go: 'read', focus: paraUnreviewed[0] })
        case 'submit':
          if (st.flow.polished === null) return step({ who: 'agent', title: '最后润色一次', why: '只改措辞，数字和论点不动；每段改写由你接受。', task: { kind: 'polish' } })
          return step({ who: 'author', action: 'advance', title: '进入投稿', why: '所有阶段的目标都已达到。' }, 'submit')
      }
    }
    return step({ who: 'none', title: '全部完成', why: '没有等你或 agent 做的事。' })
  })()
  return { recorded: p.stage, detected, milestones, skipped, next, frame }
}
