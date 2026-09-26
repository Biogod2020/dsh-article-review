/** Opt-in local review host: authenticated actions and manuscript model tools. */
import type { Context } from '@deepseek-ai/cordis'
import ConfigSchema from '@deepseek-ai/schemastery'
import { z } from 'zod'
import { pdfThumbnail } from './figure-thumbnail.ts'
import { realpath } from 'node:fs/promises'
import { relative, sep, isAbsolute } from 'node:path'
import type {} from '@deepseek-ai/dsh-client-connection'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { CommandSchema, FigureReplacementSchema, ProposalInputSchema, ProposalRevisionInputSchema } from './schema.ts'
import type { Proposal } from './schema.ts'
import { PaperStore, reviewSessions } from './store.ts'
import { revisionId } from './document.ts'
import { pickNativeBibliography, pickNativeFigure, pickNativeManuscript } from './native-file-picker.ts'

/** Cordis plugin identity. */
export const name = 'paper-review'
/** The plugin requires authenticated transport and the model tool executor. */
export const inject = ['connection', 'tools', 'agents', 'sessions']
/** Local deployment choices; ordinary sessions keep their existing tools. */
export interface Config {
  /** Local project whose Markdown sources are reviewed. */
  workspaceRoot?: string
  /** Maximum UTF-8 bytes in one manuscript. */
  maxBytes: number
  /** Maximum bytes retained for one replacement figure. */
  maxFigureBytes?: number
}
/** Loader validation; workspace selection is explicit. */
export const Config: ConfigSchema<Config> = ConfigSchema.object({
  workspaceRoot: ConfigSchema.string(), maxBytes: ConfigSchema.natural().min(1).max(2_000_000).default(1_000_000),
  maxFigureBytes: ConfigSchema.natural().min(1).default(67_108_864),
})

/** Manuscript tools visible after a document opens; ordinary tools remain available. */
export const PAPER_TOOLS = ['paper_read', 'paper_annotations', 'paper_propose', 'paper_revise', 'paper_delete', 'paper_check', 'paper_decide',
  'paper_bib_find', 'paper_bib_bind', 'paper_bib_list', 'paper_bib_get', 'paper_bib_add', 'paper_bib_replace',
  'paper_figure_list', 'paper_figure_replace'] as const
/** Manuscript discovery tools are available before a document opens. */
export const PAPER_DISCOVERY_TOOLS = ['paper_list', 'paper_open'] as const

/** Omit absent operation fields from model-visible JSON while retaining legacy replacement records. */
function modelProposal(proposal: Proposal) {
  const { figureChanges, ...rest } = proposal
  return { ...rest, ...(figureChanges ? { figureChanges } : {}),
    edits: proposal.edits.map(({ operation, ...edit }) => operation ? { ...edit, operation } : edit) }
}

/**
 * Register the workspace store, tools and authenticated operator RPC.
 * @param ctx - Host plugin context.
 * @param config - validated local project settings.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  const stores = new Map<string, Promise<PaperStore>>()
  const enabled = new Set<SessionId>()
  const scopes = new Map<Agent, () => void>()
  const rootFor = async (sessionId: SessionId): Promise<string> => {
    const header = ctx.sessions.get(sessionId)?.header ?? (await ctx.get('sessionPersistence')?.stat(sessionId))?.header
    if (!header) throw new Error('This conversation no longer exists. Open a local conversation before opening a manuscript')
    const root = config.workspaceRoot ?? header.cwd
    if (!root) throw new Error('Select a local workspace for this conversation first')
    return root
  }
  const storeFor = async (sessionId: SessionId): Promise<PaperStore> => {
    const root = await realpath(await rootFor(sessionId))
    let pending = stores.get(root)
    if (!pending) {
      pending = (async () => {
        const store = new PaperStore(root, config.maxBytes, config.maxFigureBytes)
        await store.start(); return store
      })()
      stores.set(root, pending)
      void pending.catch(() => { if (stores.get(root) === pending) stores.delete(root) })
    }
    return pending
  }
  const modelStore = (agent: Agent | undefined): Promise<PaperStore> => {
    if (!agent || !enabled.has(agent.id)) throw new Error('Open a manuscript with paper_open or in the Paper review panel first')
    return storeFor(agent.id)
  }
  ctx.effect(() => async () => {
    for (const dispose of scopes.values()) dispose()
    scopes.clear()
    await Promise.all([...stores.values()].map(async (pending) => { const store = await pending; await store.close() }))
  })
  ctx.effect(() => ctx.tools.guard(exec => PAPER_TOOLS.some(tool => tool === exec.name) && (!exec.agent || !enabled.has(exec.agent.id))
    ? 'Open a manuscript with paper_open or in the Paper review panel first.' : undefined))

  const pathParameter = { type: 'string', required: true, description: 'Workspace-relative Markdown manuscript path, for example article.md.' } as const
  const output = { schema: { type: 'json' }, render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] } as const
  const enable = async (sessionId: SessionId, store: PaperStore, allowRunning: boolean): Promise<void> => {
    if (enabled.has(sessionId)) return
    const agent = ctx.agents.get(sessionId)
    if (!allowRunning && agent?.status === 'running') throw new Error('Wait for the current response to finish before enabling Paper review')
    enabled.add(sessionId)
    try {
      if (agent) scopeAgent(agent)
      await store.enableSession(sessionId)
    } catch (error) {
      enabled.delete(sessionId)
      if (agent) scopeAgent(agent)
      throw error
    }
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_list', description: 'List Markdown manuscripts and folders in the conversation workspace. Use this to find a manuscript before paper_open; it does not open a Finder dialog.',
    parameters: { path: { type: 'string', description: 'Workspace-relative directory; omit for the workspace root.' } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (!exec.agent) throw new Error('A conversation is required')
      return (await storeFor(exec.agent.id)).listFiles(args.path ?? '')
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'List manuscripts' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_open', description: 'Open a workspace-relative Markdown manuscript in this conversation. Use paper_list to find it. This enables Paper review tools without removing ordinary agent tools.',
    parameters: { path: pathParameter }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      if (!exec.agent) throw new Error('A conversation is required')
      const store = await storeFor(exec.agent.id)
      const { document, diskChanged } = await store.read(args.path)
      await enable(exec.agent.id, store, true)
      await store.selectPath(exec.agent.id, document.path)
      return { path: document.path, revision: document.current.id, blocks: document.current.blocks.length, diskChanged }
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'Open manuscript' }),
  })))
  for (const toolName of ['paper_read', 'paper_annotations', 'paper_check'] as const) {
    ctx.effect(() => ctx.tools.register(defineTool({
      name: toolName,
      description: toolName === 'paper_read'
        ? 'Read manuscript blocks and their exact ids and revision. Optionally read one block plus its neighbors; a selected block also returns beforeHash for paper_delete, so LaTeX or table Markdown need not be retyped. Preserve scientific claims; never strengthen causality, generalizability, novelty, significance or superiority without explicit author instruction.'
        : toolName === 'paper_annotations' ? 'Read author annotations and their exact quotations. Detached annotations require the author to locate them again.'
          : 'Check pending proposals against current text, author locks and external source changes. Pass proposalId to read one pending proposal in full before revising it. Mechanical flags are review hints, not scientific verification.',
      parameters: toolName === 'paper_check'
        ? { path: pathParameter, proposalId: { type: 'string', description: 'Optional pending proposal id whose full content should be returned.' } }
        : { path: pathParameter, blockId: { type: 'string', description: 'Optional exact block id returned by paper_read.' } },
      output,
      async execute(args, exec) {
        exec.signal.throwIfAborted()
        const store = await modelStore(exec.agent)
        const { document, diskChanged } = await store.read(args.path)
        if (toolName === 'paper_annotations') return { revision: document.current.id,
          annotations: document.annotations.map(({ id, blockId, revision, quote, prefix, suffix, comment, status, anchor }) =>
            ({ id, blockId, revision, quote, prefix, suffix, comment, status, anchor })), diskChanged }
        if (toolName === 'paper_check') {
          const selected = args.proposalId === undefined ? undefined : document.proposals.find(p => p.id === args.proposalId && p.status === 'pending')
          if (args.proposalId !== undefined && !selected) throw new Error('Pending proposal not found')
          return { revision: document.current.id, diskChanged,
            ...(selected ? { proposal: modelProposal(selected) } : {}),
            proposals: document.proposals.filter(p => p.status === 'pending').map(p => ({
              id: p.id, flags: p.flags, authorDeclaredMeaning: p.meaning,
              applicable: !diskChanged && p.edits.every(e =>
                document.current.blocks.some(b => b.id === e.blockId && b.text === e.before)
                && !document.baselines.some(b => !b.archivedAt && b.blockId === e.blockId && b.locked)),
            })),
          }
        }
        const index = args.blockId === undefined ? -1 : document.current.blocks.findIndex(b => b.id === args.blockId)
        if (args.blockId !== undefined && index === -1) throw new Error('Block no longer exists; reread the manuscript')
        const selectedBlock = document.current.blocks[index]
        return { path: document.path, revision: document.current.id, diskChanged,
          blocks: index === -1 ? document.current.blocks : document.current.blocks.slice(Math.max(0, index - 1), index + 2),
          ...(selectedBlock ? { beforeHash: revisionId(selectedBlock.text) } : {}),
          lockedBlockIds: document.baselines.filter(b => !b.archivedAt && b.locked).map(b => b.blockId),
        }
      },
      presentCall: () => ({ card: 'generic', kind: 'read', title: toolName }),
    })))
  }
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_figure_list', description: 'List the exact local figures referenced by the current manuscript, with block ids, authored paths, workspace files and retained hashes. Read-only; missing files are not replaced by guessed versions.',
    parameters: { path: pathParameter }, output,
    async execute(args, exec) { exec.signal.throwIfAborted(); return (await modelStore(exec.agent)).listFigures(args.path) },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'List manuscript figures' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_figure_replace', description: 'Propose replacing one referenced figure with an existing workspace PDF or image. Use paper_figure_list and paper_read for the current revision, blockId and authored figure path. Retains content-hashed copies of both files and changes only the figure destination, not caption prose. The manuscript and original files stay unchanged until paper_decide accepts. Supply proposalId to revise a pending proposal in place. Inspect old/new previews and caption/panel consistency before accepting; never overwrite the old image in place.',
    parameters: { path: pathParameter,
      revision: { type: 'string', required: true, description: 'Current manuscript revision.' },
      blockId: { type: 'string', required: true, description: 'Exact figure block id.' },
      figure: { type: 'string', required: true, description: 'Authored figure destination returned by paper_figure_list.' },
      replacement: { type: 'string', required: true, description: 'Existing workspace-relative replacement file; it may be outside the manuscript figure directory.' },
      reason: { type: 'string', required: true, description: 'Why the figure should be replaced; mention panel/caption changes requiring separate review.' },
      proposalId: { type: 'string', description: 'Pending proposal to revise instead of creating another.' },
    }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const view = await (await modelStore(exec.agent)).replaceFigure(args.path, FigureReplacementSchema.parse(args))
      const proposal = view.document.proposals.find(candidate => candidate.id === args.proposalId) ?? view.document.proposals.at(-1)
      if (!proposal) throw new Error('Figure replacement produced no proposal')
      return { proposal: modelProposal(proposal), manuscriptWritten: false, originalFilesWritten: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Propose figure replacement' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_propose',
    description: 'Submit a manuscript change for author review without writing the source. Copy blockId and exact before text from paper_read. With operation: insert-before/insert-after, after may contain any complete Markdown fragment, including lists, tables, headings, quotes, code and multiple blocks. Without operation, after replaces the selected block; an empty string proposes deletion. For compatibility, an unchanged before block followed or preceded by blank-separated new blocks is treated as insertion. Group dependent edits. Unchanged anchors remain valid after unrelated revisions; reread changed or missing anchors. Version, locks and bound citation keys are checked; lexical flags are review hints, not scientific approval.',
    parameters: {
      path: pathParameter, baseRevision: { type: 'string', required: true },
      annotationIds: { type: 'array', items: { type: 'string' }, required: true },
      reason: { type: 'string', required: true },
      meaning: { type: 'string', enum: ['style', 'structure', 'claim', 'evidence'], required: true },
      edits: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
        blockId: { type: 'string', required: true }, before: { type: 'string', required: true }, after: { type: 'string', required: true },
        operation: { type: 'string', enum: ['insert-before', 'insert-after'], description: 'Insert complete Markdown blocks beside the exact before anchor. Omit to replace the block; set after to empty to propose deletion.' },
      } } },
    },
    output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const store = await modelStore(exec.agent)
      const view = await store.propose(args.path, ProposalInputSchema.parse(args))
      const proposal = view.document.proposals.at(-1)
      if (!proposal) throw new Error('Submitted proposal was not retained')
      return { id: proposal.id, status: proposal.status, flags: proposal.flags, manuscriptWritten: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Propose manuscript changes' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_revise',
    description: 'Revise an existing pending manuscript proposal in place; keep its id and do not write the manuscript. Inspect it with paper_check and read current source with paper_read. Supplied edits replace the complete edit group. Use operation to insert any complete Markdown fragment beside an exact anchor; omit operation to replace a block with any complete Markdown fragment or delete it with empty after. An unchanged anchor beside blank-separated new blocks is also treated as insertion. Rebase stale proposals with the current baseRevision, block ids and exact before text. Version, annotation, lock and citation checks run again. Settled proposals cannot be revised.',
    parameters: {
      path: pathParameter,
      proposalId: { type: 'string', required: true, description: 'Id of the pending proposal to revise.' },
      revision: { type: 'string', required: true, description: 'Current manuscript revision returned by paper_read or paper_check.' },
      baseRevision: { type: 'string', description: 'Optional new source revision for rebasing a stale proposal; pair with complete current-source edits.' },
      annotationIds: { type: 'array', items: { type: 'string' }, description: 'Optional full replacement list of attached annotation ids.' },
      reason: { type: 'string', description: 'Optional revised reason for the whole proposal.' },
      meaning: { type: 'string', enum: ['style', 'structure', 'claim', 'evidence'], description: 'Optional revised author-facing change category.' },
      edits: { type: 'array', description: 'Optional full replacement edit group; omit to keep all existing edits.', items: { type: 'object', additionalProperties: false, properties: {
        blockId: { type: 'string', required: true }, before: { type: 'string', required: true }, after: { type: 'string', required: true },
        operation: { type: 'string', enum: ['insert-before', 'insert-after'], description: 'Insert complete Markdown blocks beside the exact before anchor. Omit to replace the block; set after to empty to propose deletion.' },
      } } },
    },
    output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const store = await modelStore(exec.agent)
      const view = await store.revise(args.path, ProposalRevisionInputSchema.parse(args))
      const proposal = view.document.proposals.find(p => p.id === args.proposalId)
      if (!proposal) throw new Error('Revised proposal was not retained')
      return { proposal: modelProposal(proposal), manuscriptWritten: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Revise manuscript proposal' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_delete',
    description: 'Propose deleting one complete Markdown block without retyping its source (useful for tables or LaTeX). First call paper_read with blockId and copy its revision and beforeHash. Supply proposalId to append deletion to an existing pending group while preserving all its other edits. A block already edited by that group must instead be changed with paper_revise. This only creates or revises a pending proposal; only author-requested paper_decide acceptance writes the manuscript. To delete part of a paragraph, use paper_propose/paper_revise with the complete exact before and the remaining after text.',
    parameters: { path: pathParameter, baseRevision: { type: 'string', required: true },
      blockId: { type: 'string', required: true }, beforeHash: { type: 'string', required: true, description: 'Exact beforeHash returned by paper_read with this blockId.' },
      reason: { type: 'string', required: true }, proposalId: { type: 'string', description: 'Optional pending group to append to, without replacing its existing edits.' } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const view = await (await modelStore(exec.agent)).proposeDeletion(args.path, args)
      const proposal = args.proposalId ? view.document.proposals.find(item => item.id === args.proposalId) : view.document.proposals.at(-1)
      if (!proposal) throw new Error('Deletion proposal was not retained')
      return { proposal: modelProposal(proposal), manuscriptWritten: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Propose block deletion' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_decide',
    description: 'Accept or reject one pending proposal. Accept writes the manuscript after revision, source and lock checks; reject changes only review metadata. Accept only when the user requests it. Use paper_check first and never claim this is scientific verification.',
    parameters: { path: pathParameter, revision: { type: 'string', required: true }, proposalId: { type: 'string', required: true }, decision: { type: 'string', enum: ['accept', 'reject'], required: true } },
    output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const store = await modelStore(exec.agent)
      const view = await store.command({ action: 'decide', path: args.path, revision: args.revision, proposalId: args.proposalId, accept: args.decision === 'accept' })
      return { proposalId: args.proposalId, status: args.decision === 'accept' ? 'accepted' : 'rejected', revision: view.document.current.id, manuscriptWritten: args.decision === 'accept' }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Decide manuscript proposal' }),
  })))

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_bib_find', description: 'List workspace folders and .bib files one directory at a time. Read-only; use this to locate authoritative BibTeX files before binding them to the open manuscript.',
    parameters: { path: { type: 'string', description: 'Workspace-relative directory; omit for the workspace root.' } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return (await modelStore(exec.agent)).listFiles(args.path ?? '', 'bib')
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'Find BibTeX files' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_bib_bind', description: 'Bind the manuscript to explicit workspace-relative .bib files. These files are the sole citation-key authority. Replaces the previous binding list, writes only private binding metadata, and never edits the manuscript or bibliography.',
    parameters: { path: pathParameter, files: { type: 'array', required: true, items: { type: 'string' }, description: 'Complete list of existing workspace-relative .bib paths.' } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const view = await (await modelStore(exec.agent)).configureBibliography(args.path, args.files)
      return { ...view, manuscriptWritten: false, bibliographyWritten: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Bind bibliography files' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_bib_list', description: 'Read bound authoritative BibTeX sources and citation diagnostics. Report citationStatus and canonicalCitationCount: missingKeys=[] alone does not mean citations are valid when possibleBareKeys lists legacy text or no canonical citations exist. Bibliographic metadata is not independently verified.',
    parameters: { path: pathParameter }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return (await modelStore(exec.agent)).bibliography(args.path)
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'Read bibliography index' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_bib_get', description: 'Read one exact BibTeX entry including its raw source and hash before replacing it. No scholarly source verification is implied.',
    parameters: { path: pathParameter, key: { type: 'string', required: true } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      return { ...await (await modelStore(exec.agent)).bibliographyEntry(args.path, args.key) }
    },
    presentCall: () => ({ card: 'generic', kind: 'read', title: 'Read BibTeX entry' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_bib_add', description: 'Add one complete BibTeX entry to a bound .bib file without a manuscript proposal. Author/title/year syntax is checked, but DOI, metadata and relevance must be verified against the publication. This writes the .bib file, never the manuscript.',
    parameters: { path: pathParameter, file: { type: 'string', required: true, description: 'Bound workspace-relative .bib file.' }, raw: { type: 'string', required: true, description: 'One complete BibTeX entry with author, title and year.' } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const view = await (await modelStore(exec.agent)).addBibliographyEntry(args.path, args.file, args.raw)
      return { ...view, manuscriptWritten: false, bibliographyWritten: true, metadataVerified: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Add BibTeX entry' }),
  })))
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'paper_bib_replace', description: 'Replace one exact entry in its bound .bib file using the hash returned by paper_bib_get; preserve the key. This writes the .bib file, not a manuscript proposal. Verify bibliographic facts against the publication.',
    parameters: { path: pathParameter, key: { type: 'string', required: true }, expectedHash: { type: 'string', required: true }, raw: { type: 'string', required: true } }, output,
    async execute(args, exec) {
      exec.signal.throwIfAborted()
      const view = await (await modelStore(exec.agent)).replaceBibliographyEntry(args.path, args.key, args.expectedHash, args.raw)
      return { ...view, manuscriptWritten: false, bibliographyWritten: true, metadataVerified: false }
    },
    presentCall: () => ({ card: 'generic', kind: 'other', title: 'Replace BibTeX entry' }),
  })))

  const scopeAgent = (agent: Agent): void => {
    scopes.get(agent)?.()
    const disposers: (() => void)[] = []
    try {
      if (!enabled.has(agent.id)) disposers.push(agent.ctx.tools.restrict({ deny: [...PAPER_TOOLS] }))
      if (enabled.has(agent.id)) disposers.push(agent.ctx.tools.presentAs('native'))
    } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error }
    scopes.set(agent, () => { for (const dispose of disposers.reverse()) dispose() })
  }
  const restoreAgent = async (agent: Agent): Promise<void> => {
    const root = config.workspaceRoot ?? agent.session.header.cwd
    if (root && (await reviewSessions(root)).includes(agent.id)) enabled.add(agent.id)
    scopeAgent(agent)
  }
  ctx.on('agent/created', async ({ agent }) => { await restoreAgent(agent) })
  for (const agent of ctx.agents.list()) await restoreAgent(agent)

  // Exact Fetch contributions share Connection's authenticated, size-limited /api carrier.
  // They coexist with the native session RPC interceptor without replacing it.
  const methods = ['paper-review/command', 'paper-review/list-files', 'paper-review/pick-file', 'paper-review/current', 'paper-review/figure-path', 'paper-review/figure-thumbnail', 'paper-review/leave',
    'paper-review/bibliography', 'paper-review/bind-bibliography', 'paper-review/pick-bibliography',
    'paper-review/list-figures', 'paper-review/pick-figure', 'paper-review/replace-figure'] as const
  const envelope = z.object({ type: z.literal('client-request'), rpcId: z.string(), method: z.enum(methods), payload: z.unknown() })
  for (const method of methods) ctx.effect(() => ctx.connection.fetch.register({
    path: `/api/${method}`, methods: ['POST'], requestBody: 'buffered',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') return new Response('Expected application/json', { status: 415 })
      const parsed = envelope.safeParse(await request.json().catch(() => undefined))
      if (!parsed.success || parsed.data.method !== method) return new Response('Invalid review request', { status: 400 })
      let result
      try {
        request.signal.throwIfAborted()
        const payload = z.object({ sessionId: z.string().min(1) }).parse(parsed.data.payload)
        const sessionId = SessionId(payload.sessionId)
        const store = await storeFor(sessionId)
        if (parsed.data.method === 'paper-review/list-files') {
          const listing = z.object({ path: z.string(), extension: z.enum(['md', 'bib', 'figure']).default('md') }).parse(parsed.data.payload)
          result = { ok: true, value: await store.listFiles(listing.path, listing.extension) }
        } else if (parsed.data.method === 'paper-review/list-figures') {
          const input = z.object({ path: z.string() }).parse(parsed.data.payload)
          result = { ok: true, value: await store.listFigures(input.path) }
        } else if (parsed.data.method === 'paper-review/replace-figure') {
          const input = FigureReplacementSchema.extend({ path: z.string() }).parse(parsed.data.payload)
          if (!enabled.has(sessionId)) throw new Error('Open a manuscript before replacing a figure')
          result = { ok: true, value: await store.replaceFigure(input.path, input) }
        } else if (parsed.data.method === 'paper-review/pick-figure') {
          const root = await realpath(await rootFor(sessionId))
          const selected = await pickNativeFigure(root, request.signal)
          if (selected === null) result = { ok: true, value: { path: null } }
          else {
            const path = relative(root, selected).split(sep).join('/')
            await store.figurePath(path)
            result = { ok: true, value: { path } }
          }
        } else if (parsed.data.method === 'paper-review/current') {
          result = { ok: true, value: { path: await store.selectedPath(sessionId) } }
        } else if (parsed.data.method === 'paper-review/bibliography') {
          const input = z.object({ path: z.string() }).parse(parsed.data.payload)
          result = { ok: true, value: await store.bibliography(input.path) }
        } else if (parsed.data.method === 'paper-review/bind-bibliography') {
          const input = z.object({ path: z.string(), files: z.array(z.string()) }).parse(parsed.data.payload)
          if (!enabled.has(sessionId)) throw new Error('Open a manuscript before binding its bibliography')
          result = { ok: true, value: await store.configureBibliography(input.path, input.files) }
        } else if (parsed.data.method === 'paper-review/pick-bibliography') {
          const root = await realpath(await rootFor(sessionId))
          const selected = await pickNativeBibliography(root, request.signal)
          if (selected === null) result = { ok: true, value: { path: null } }
          else {
            const path = relative(root, selected)
            if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path) || !/\.bib$/i.test(path)) throw new Error('Chosen .bib file must be inside the conversation workspace')
            result = { ok: true, value: { path } }
          }
        } else if (parsed.data.method === 'paper-review/pick-file') {
          const selected = await pickNativeManuscript(await realpath(await rootFor(sessionId)), request.signal)
          if (selected === null) result = { ok: true, value: { path: null } }
          else {
            const root = await realpath(await rootFor(sessionId))
            const path = relative(root, selected)
            if (!path || path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)) throw new Error('Chosen manuscript must be inside the conversation workspace')
            const { document } = await store.read(path)
            result = { ok: true, value: { path: document.path } }
          }
        } else if (parsed.data.method === 'paper-review/figure-path') {
          const figure = z.object({ path: z.string() }).parse(parsed.data.payload)
          result = { ok: true, value: { path: await store.figurePath(figure.path) } }
        } else if (parsed.data.method === 'paper-review/figure-thumbnail') {
          const figure = z.object({ path: z.string() }).parse(parsed.data.payload)
          const source = await store.figurePath(figure.path)
          if (!source.toLowerCase().endsWith('.pdf')) throw new Error('PDF thumbnail requires a PDF figure')
          const size = z.object({ size: z.enum(['thumb', 'full']).default('thumb') }).parse(parsed.data.payload).size
          result = { ok: true, value: { url: await pdfThumbnail(source, request.signal, size) } }
        } else if (parsed.data.method === 'paper-review/leave') {
          const agent = ctx.agents.get(sessionId)
          if (agent?.status === 'running') throw new Error('Wait for the current response to finish before leaving Paper mode')
          if (enabled.has(sessionId)) {
            enabled.delete(sessionId)
            try {
              if (agent) scopeAgent(agent)
              await store.disableSession(sessionId)
            } catch (error) {
              enabled.add(sessionId)
              if (agent) scopeAgent(agent)
              throw error
            }
          }
          result = { ok: true, value: null }
        } else {
          const request = z.object({ command: CommandSchema }).parse(parsed.data.payload).command
          if (!enabled.has(sessionId)) {
            if (request.action !== 'open') throw new Error('Open a manuscript before performing review actions')
            await store.read(request.path)
            await enable(sessionId, store, false)
          }
          const view = await store.command(request)
          if (request.action === 'open') await store.selectPath(sessionId, view.document.path)
          result = { ok: true, value: view }
        }
      } catch (error) {
        result = { ok: false, error: { code: 'paper-review/refused', message: error instanceof Error ? error.message : String(error), details: {} } }
      }
      return Response.json({ type: 'server-response', rpcId: parsed.data.rpcId, result })
    },
  }))
}
