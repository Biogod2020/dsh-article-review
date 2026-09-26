/** Real Loader, authenticated HTTP and agent-loop coverage; only model responses are scripted. */
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import LlmRuntime, { ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import Credentials from '@deepseek-ai/dsh-credentials-local'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import * as Connection from '@deepseek-ai/dsh-client-connection'
import { MockAdapter, textResponse, toolCallResponse } from '../../../core/agent-loop/tests/mock-adapter.ts'
import * as PaperReview from '../src/index.ts'
import { ViewSchema } from '../src/schema.ts'
import { revisionId } from '../src/document.ts'

let root = ''
let ctx: Context | undefined
afterEach(async () => { await ctx?.fiber.dispose(); ctx = undefined; if (root) await rm(root, { recursive: true, force: true }); root = '' })

it('boots from a composition, keeps ordinary tools, and lets agents and operators manage proposals', async () => {
  root = await mkdtemp(join(tmpdir(), 'dsh-paper-composition-'))
  const source = '## Results\n\nPerformance was higher in three datasets (n = 42).\n'
  await writeFile(join(root, 'article.md'), source)
  await mkdir(join(root, 'references'))
  await writeFile(join(root, 'references', 'main.bib'), '@article{smith, author={Smith, Ada}, title={A source study}, year={2024}}\n')
  const configPath = join(root, 'cordis.yml')
  const modules: Record<string, object> = {
    llm: LlmRuntime, sessions: SessionStore, projections: SessionProjectionRegistry, prompt: SystemPrompt,
    tools: ToolRuntime, agents: AgentRegistry, loop: AgentLoop, credentials: Credentials, server: WebServer,
    connection: Connection, review: PaperReview, persistence: JsonlSessionPersistence,
  }
  await writeFile(configPath, JSON.stringify([
    { name: 'llm' }, { name: 'sessions' }, { name: 'projections' }, { name: 'prompt', config: { personaPrefix: '' } },
    { name: 'persistence', config: { root: join(root, 'session-logs'), compression: 'none' } },
    { name: 'tools' }, { name: 'agents' }, { name: 'loop', config: { agents: [] } },
    { name: 'credentials', config: { path: join(root, 'credentials.yml'), watch: false } },
    { name: 'server', config: { host: '127.0.0.1', port: 0 } }, { name: 'connection' },
    { id: 'paper-review', name: 'review', config: { maxBytes: 1000000 } },
  ].map(entry => ({ ...entry, name: `cordis:${entry.name}` }))))
  ctx = new Context()
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  Object.assign(ctx.loader.builtins, modules)
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  expect([...ctx.loader.entries()].filter(entry => !entry.fiber && !entry.disabled).map(entry => entry.options.name)).toEqual([])
  expect(ctx.tools.schemas().filter(s => s.name.startsWith('paper_'))).toMatchSnapshot()

  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const context = ctx
  ctx.webServer.register({ kind: 'exact', path: '/', handler(req, res) { if (context.connection.authorizeIndex(req, res)) res.end('review') } })
  const auth = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' })
  const cookie = auth.headers.get('set-cookie')!.split(';', 1)[0]!
  const rpc = async (payload: object, authenticated = true, sessionId = 'paper-review-recording') => {
    const response = await fetch(`${origin}/api/paper-review/command`, { method: 'POST',
      headers: { 'content-type': 'application/json', origin, ...(authenticated ? { cookie } : {}) },
      body: JSON.stringify({ type: 'client-request', rpcId: 'test', method: 'paper-review/command', payload: { sessionId, command: payload } }),
    })
    return response
  }
  const control = (method: 'paper-review/list-files' | 'paper-review/current' | 'paper-review/leave', payload: object, sessionId = 'paper-review-recording') => fetch(`${origin}/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin, cookie },
    body: JSON.stringify({ type: 'client-request', rpcId: 'control-test', method, payload: { sessionId, ...payload } }),
  })
  const agent = await ctx.agentLoop.create(SessionId('paper-review-recording'), { provider: 'mock', model: 'mock' }, { cwd: root })
  const ordinary = await ctx.agentLoop.create(SessionId('ordinary-session'), { provider: 'mock', model: 'mock' }, { cwd: root })
  expect(ctx.tools.schemas(ordinary).filter(schema => schema.name.startsWith('paper_')).map(schema => schema.name).sort()).toEqual([...PaperReview.PAPER_DISCOVERY_TOOLS].sort())
  const absent = await (await rpc({ action: 'open', path: 'missing.md' })).json() as { result: { ok: boolean } }
  expect(absent.result.ok).toBe(false)
  expect(ctx.tools.schemas(agent).filter(schema => schema.name.startsWith('paper_')).map(schema => schema.name).sort()).toEqual([...PaperReview.PAPER_DISCOVERY_TOOLS].sort())
  expect((await rpc({ action: 'open', path: 'article.md' }, false)).status).toBe(401)
  const initialFiles = await (await control('paper-review/list-files', { path: '' })).json() as { result: { ok: boolean; value: { entries: { name: string }[] } } }
  expect(initialFiles.result.ok).toBe(true)
  expect(initialFiles.result.value.entries.map(entry => entry.name)).toContain('article.md')
  const envelope: unknown = await (await rpc({ action: 'open', path: 'article.md' })).json()
  const view = z.object({ result: z.object({ value: ViewSchema }) }).parse(envelope).result.value
  expect((await (await control('paper-review/current', {})).json() as { result: { value: { path: string } } }).result.value.path).toBe('article.md')
  const block = view.document.current.blocks[1]!
  const adapter = new MockAdapter([
    toolCallResponse('read-paper', 'paper_read', { path: 'article.md' }),
    toolCallResponse('propose-change', 'paper_propose', {
      path: 'article.md', baseRevision: view.document.current.id, annotationIds: [], reason: 'Compress wording.', meaning: 'style',
      edits: [{ blockId: block.id, before: block.text, after: 'Performance was stronger in three datasets (n = 42).' }],
    }),
    toolCallResponse('check-proposal', 'paper_check', { path: 'article.md', proposalId: 'P1' }),
    toolCallResponse('revise-proposal', 'paper_revise', {
      path: 'article.md', proposalId: 'P1', revision: view.document.current.id,
      reason: 'Use a shorter, qualified description.',
      edits: [{ blockId: block.id, before: block.text, after: 'Performance improved in three datasets (n = 42).' }],
    }),
    textResponse('Proposal P1 is ready for author review; the manuscript has not been changed.'),
  ])
  const adapterHandle = ctx.llm.registerAdapter(['mock'], adapter)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Please compress the Results wording; preserve the number and scope. Propose changes for review.' }], source: { kind: 'user' } }))
  await vi.waitFor(() =>{  expect(agent.session.snapshotEvents().some(event => event.type === 'turn/end')).toBe(true) }, { timeout: 10_000 })
  const transcript = agent.session.snapshotEvents()
  const results = transcript.filter(event => event.type === 'tool/result')
  expect(results).toHaveLength(4)
  expect(results.every(event => !event.data.message.isError)).toBe(true)
  expect(JSON.stringify(transcript)).toContain('manuscriptWritten')
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  const pending = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value.document.proposals
  expect(pending).toHaveLength(1)
  expect(pending[0]).toMatchObject({ id: 'P1', status: 'pending', reason: 'Use a shorter, qualified description.' })
  expect(pending[0]?.edits[0]?.after).toBe('Performance improved in three datasets (n = 42).')
  const modelSurface = adapter.requests.map(request => request.tools?.map(tool => tool.name))
  expect(modelSurface).toMatchSnapshot()

  const bibFind = await ctx.tools.execute({ agent, callId: ToolCallId('bib-find'), name: 'paper_bib_find',
    arguments: { path: 'references' }, signal: new AbortController().signal })
  expect(bibFind.isError).not.toBe(true)
  expect(JSON.stringify(bibFind)).toContain('main.bib')
  const bibBind = await ctx.tools.execute({ agent, callId: ToolCallId('bib-bind'), name: 'paper_bib_bind',
    arguments: { path: 'article.md', files: ['references/main.bib'] }, signal: new AbortController().signal })
  expect(bibBind.isError).not.toBe(true)
  const bibAdd = await ctx.tools.execute({ agent, callId: ToolCallId('bib-add'), name: 'paper_bib_add',
    arguments: { path: 'article.md', file: 'references/main.bib',
      raw: '@article{jones2025, author={Jones, Bea}, title={A second study}, year={2025}}' }, signal: new AbortController().signal })
  expect(bibAdd.isError).not.toBe(true)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  expect(await readFile(join(root, 'references', 'main.bib'), 'utf8')).toContain('jones2025')

  const disposeWriter = ctx.tools.register(defineTool({ name: 'write_workspace_note', description: 'Test ordinary executor.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { await writeFile(join(root, 'agent-note.txt'), 'written'); return 'written' },
  }))
  const allowed = await ctx.tools.execute({ agent, callId: ToolCallId('ordinary-write'), name: 'write_workspace_note', arguments: {}, signal: new AbortController().signal })
  expect(allowed.isError).not.toBe(true)
  expect(await readFile(join(root, 'agent-note.txt'), 'utf8')).toBe('written')
  expect(await readFile(join(root, 'article.md'), 'utf8')).toBe(source)
  disposeWriter()
  const disposeOrdinary = ctx.tools.register(defineTool({ name: 'ordinary_tool', description: 'Ordinary session capability.', parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute() { return 'ordinary tools remain available' },
  }))
  const normalResult = await ctx.tools.execute({ agent: ordinary, callId: ToolCallId('ordinary'), name: 'ordinary_tool', arguments: {}, signal: new AbortController().signal })
  expect(normalResult.isError).not.toBe(true)
  const ordinaryPaper = await ctx.tools.execute({ agent: ordinary, callId: ToolCallId('ordinary-paper'), name: 'paper_read', arguments: { path: 'article.md' }, signal: new AbortController().signal })
  expect(ordinaryPaper.isError).toBe(true)
  expect(await readFile(join(root, '.paper-review', 'sessions.json'), 'utf8')).toBe('["paper-review-recording"]')
  const accepted: unknown = await (await rpc({ action: 'decide', path: 'article.md', revision: view.document.current.id, proposalId: 'P1', accept: true })).json()
  expect(z.object({ result: z.object({ ok: z.boolean() }) }).parse(accepted).result.ok).toBe(true)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toContain('Performance improved')
  const postView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  const nextBlock = postView.document.current.blocks[1]!
  const proposed = await ctx.tools.execute({ agent, callId: ToolCallId('next-proposal'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: postView.document.current.id, annotationIds: [], reason: 'Another phrasing option.', meaning: 'style',
    edits: [{ blockId: nextBlock.id, before: nextBlock.text, after: 'Performance increased in three datasets (n = 42).' }],
  }, signal: new AbortController().signal })
  expect(proposed.isError).not.toBe(true)
  const rejected = await ctx.tools.execute({ agent, callId: ToolCallId('reject-proposal'), name: 'paper_decide', arguments: {
    path: 'article.md', revision: postView.document.current.id, proposalId: 'P2', decision: 'reject',
  }, signal: new AbortController().signal })
  expect(rejected.isError).not.toBe(true)
  expect(z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value.document.proposals[1]?.status).toBe('rejected')
  const heading = postView.document.current.blocks[0]!
  const proposalThree = await ctx.tools.execute({ agent, callId: ToolCallId('third-proposal'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: postView.document.current.id, annotationIds: [], reason: 'Rename the section.', meaning: 'structure',
    edits: [{ blockId: heading.id, before: heading.text, after: '## Findings' }],
  }, signal: new AbortController().signal })
  expect(proposalThree.isError).not.toBe(true)
  const acceptedByAgent = await ctx.tools.execute({ agent, callId: ToolCallId('accept-proposal'), name: 'paper_decide', arguments: {
    path: 'article.md', revision: postView.document.current.id, proposalId: 'P3', decision: 'accept',
  }, signal: new AbortController().signal })
  expect(acceptedByAgent.isError).not.toBe(true)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toContain('## Findings')
  const insertionBase = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  const insertionAnchor = insertionBase.document.current.blocks[1]!
  const inserted = await ctx.tools.execute({ agent, callId: ToolCallId('insert-proposal'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: insertionBase.document.current.id, annotationIds: [], reason: 'Add context.', meaning: 'structure',
    edits: [{ blockId: insertionAnchor.id, before: insertionAnchor.text, after: 'This result needs a separate explanation.', operation: 'insert-after' }],
  }, signal: new AbortController().signal })
  expect(inserted.isError).not.toBe(true)
  expect(await readFile(join(root, 'article.md'), 'utf8')).not.toContain('separate explanation')
  const insertionAccepted: unknown = await (await rpc({ action: 'decide', path: 'article.md',
    revision: insertionBase.document.current.id, proposalId: 'P4', accept: true })).json()
  expect(z.object({ result: z.object({ ok: z.boolean() }) }).parse(insertionAccepted).result.ok).toBe(true)
  expect(await readFile(join(root, 'article.md'), 'utf8')).toContain('\n\nThis result needs a separate explanation.')
  const naturalBase = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  const naturalAnchor = naturalBase.document.current.blocks[1]!
  const natural = await ctx.tools.execute({ agent, callId: ToolCallId('natural-insert'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: naturalBase.document.current.id, annotationIds: [],
    reason: 'Keep this explanation separate.', meaning: 'evidence',
    edits: [{ blockId: naturalAnchor.id, before: naturalAnchor.text,
      after: `${naturalAnchor.text}\n\nThe frozen reference uses a separate study set.` }],
  }, signal: new AbortController().signal })
  expect(natural.isError).not.toBe(true)
  const naturalView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  expect(naturalView.document.proposals.at(-1)?.edits[0]).toMatchObject({ operation: 'insert-after',
    after: 'The frozen reference uses a separate study set.' })
  expect(await readFile(join(root, 'article.md'), 'utf8')).not.toContain('frozen reference')
  const headingInsertion = await ctx.tools.execute({ agent, callId: ToolCallId('heading-insert'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: naturalBase.document.current.id, annotationIds: [],
    reason: 'Give the reference a subsection heading.', meaning: 'structure',
    edits: [{ blockId: naturalAnchor.id, before: naturalAnchor.text,
      after: '### Screening Reference Set', operation: 'insert-before' }],
  }, signal: new AbortController().signal })
  expect(headingInsertion.isError).not.toBe(true)
  const headingView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  expect(headingView.document.proposals.at(-1)?.edits[0]).toMatchObject({ operation: 'insert-before',
    after: '### Screening Reference Set' })
  expect(await readFile(join(root, 'article.md'), 'utf8')).not.toContain('### Screening Reference Set')
  const grouped = await ctx.tools.execute({ agent, callId: ToolCallId('heading-and-paragraph'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: naturalBase.document.current.id, annotationIds: [],
    reason: 'Present the reference under a separate heading.', meaning: 'structure',
    edits: [
      { blockId: naturalAnchor.id, before: naturalAnchor.text,
        after: '### Screening Reference Set', operation: 'insert-after' },
      { blockId: naturalAnchor.id, before: naturalAnchor.text,
        after: 'The frozen reference uses a separate study set.', operation: 'insert-after' },
    ],
  }, signal: new AbortController().signal })
  expect(grouped.isError).not.toBe(true)
  const groupedView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  expect(groupedView.document.proposals.at(-1)?.edits.map(edit => edit.after)).toEqual([
    '### Screening Reference Set', 'The frozen reference uses a separate study set.',
  ])
  const list = '- **Class A**: direct H&E.\n- **Class B**: indirect imaging.\n- **Class C**: excluded assays.'
  const proposedList = await ctx.tools.execute({ agent, callId: ToolCallId('list-proposal'), name: 'paper_propose', arguments: {
    path: 'article.md', baseRevision: naturalBase.document.current.id, annotationIds: [],
    reason: 'Show the three screening classes as a list.', meaning: 'structure',
    edits: [{ blockId: naturalAnchor.id, before: naturalAnchor.text, after: list, operation: 'insert-after' }],
  }, signal: new AbortController().signal })
  expect(proposedList.isError).not.toBe(true)
  const listView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  const listProposal = listView.document.proposals.at(-1)!
  expect(listProposal.edits[0]?.after).toBe(list)
  const revisedList = await ctx.tools.execute({ agent, callId: ToolCallId('revise-list-proposal'), name: 'paper_revise', arguments: {
    path: 'article.md', proposalId: listProposal.id, revision: listView.document.current.id,
    edits: [{ blockId: naturalAnchor.id, before: naturalAnchor.text,
      after: '- **Class A**: direct H&E.\n- **Class B**: indirect imaging or morphology.\n- **Class C**: excluded assays.',
      operation: 'insert-after' }],
  }, signal: new AbortController().signal })
  expect(revisedList.isError).not.toBe(true)
  const revisedView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json()).result.value
  expect(revisedView.document.proposals.at(-1)?.id).toBe(listProposal.id)
  expect(revisedView.document.proposals.at(-1)?.edits[0]?.after).toContain('indirect imaging or morphology')
  expect(await readFile(join(root, 'article.md'), 'utf8')).not.toContain('**Class A**')
  const figureSource = '# Results\n\n> **Figure [fig:results]** (`old.pdf`): An unchanged caption.\n'
  await writeFile(join(root, 'figure.md'), figureSource)
  await writeFile(join(root, 'old.pdf'), 'old figure bytes')
  await writeFile(join(root, 'new.pdf'), 'new figure bytes')
  await ctx.tools.execute({ agent, callId: ToolCallId('open-figure-paper'), name: 'paper_open',
    arguments: { path: 'figure.md' }, signal: new AbortController().signal })
  const figureView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'figure.md' })).json()).result.value
  const figureBlock = figureView.document.current.blocks[1]
  if (!figureBlock) throw new Error('Figure block missing')
  const figureList = await ctx.tools.execute({ agent, callId: ToolCallId('list-figures'), name: 'paper_figure_list', arguments: { path: 'figure.md' }, signal: new AbortController().signal })
  expect(figureList.isError).not.toBe(true)
  expect(JSON.stringify(figureList)).toContain('old.pdf')
  const figureProposal = await ctx.tools.execute({ agent, callId: ToolCallId('replace-figure'), name: 'paper_figure_replace', arguments: {
    path: 'figure.md', revision: figureView.document.current.id, blockId: figureBlock.id, figure: 'old.pdf', replacement: 'new.pdf', reason: 'Updated artwork.',
  }, signal: new AbortController().signal })
  expect(figureProposal.isError).not.toBe(true)
  expect(JSON.stringify(figureProposal)).toContain('originalFilesWritten')
  expect(await readFile(join(root, 'figure.md'), 'utf8')).toBe(figureSource)
  const operatorFigure = await fetch(`${origin}/api/paper-review/replace-figure`, { method: 'POST',
    headers: { 'content-type': 'application/json', origin, cookie }, body: JSON.stringify({ type: 'client-request', rpcId: 'replace-figure', method: 'paper-review/replace-figure',
      payload: { sessionId: agent.id, path: 'figure.md', revision: figureView.document.current.id, blockId: figureBlock.id,
        figure: 'old.pdf', replacement: 'new.pdf', reason: 'Updated artwork after author feedback.', proposalId: 'P1' } }) })
  const figureResponse: unknown = await operatorFigure.json()
  const figurePending = z.object({ result: z.object({ ok: z.literal(true), value: ViewSchema }) }).parse(figureResponse).result.value
  expect(figurePending.document.proposals).toHaveLength(1)
  expect(figurePending.document.proposals[0]?.figureChanges).toHaveLength(1)
  await rpc({ action: 'decide', path: 'figure.md', revision: figureView.document.current.id, proposalId: 'P1', accept: true })
  expect(await readFile(join(root, 'figure.md'), 'utf8')).toContain('figures/review-assets/')
  expect(await readFile(join(root, 'old.pdf'), 'utf8')).toBe('old figure bytes')
  const table = '| Comparison | $\\Delta$ |\n| --- | --- |\n| QC | [-3.6, 9.9] |'
  const deletionSource = `# Findings\n\nKeep this context.\n\n${table}\n\nOld table caption.\n`
  await writeFile(join(root, 'deletion.md'), deletionSource)
  const deletionView = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'deletion.md' })).json()).result.value
  const tableBlock = deletionView.document.current.blocks.find(item => item.text === table)!
  const captionBlock = deletionView.document.current.blocks.find(item => item.text === 'Old table caption.')!
  const turnsBeforeDeletion = agent.session.snapshotEvents().filter(event => event.type === 'turn/end').length
  const deletionAdapter = new MockAdapter([
    toolCallResponse('delete-read', 'paper_read', { path: 'deletion.md', blockId: tableBlock.id }),
    toolCallResponse('delete-caption', 'paper_propose', { path: 'deletion.md', baseRevision: deletionView.document.current.id,
      annotationIds: [], reason: 'Revise the caption.', meaning: 'structure', edits: [{ blockId: captionBlock.id, before: captionBlock.text, after: 'New table caption.' }] }),
    toolCallResponse('delete-table', 'paper_delete', { path: 'deletion.md', baseRevision: deletionView.document.current.id, blockId: tableBlock.id,
      beforeHash: revisionId(table), proposalId: 'P1', reason: 'Remove the redundant table.' }),
    toolCallResponse('delete-check', 'paper_check', { path: 'deletion.md', proposalId: 'P1' }),
    textResponse('Table deletion and caption revision are pending in P1; source unchanged.'),
  ])
  adapterHandle()
  ctx.llm.registerAdapter(['mock'], deletionAdapter)
  agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Propose deleting the redundant table together with its caption revision; do not accept it.' }], source: { kind: 'user' } }))
  await vi.waitFor(() => { expect(agent.session.snapshotEvents().filter(event => event.type === 'turn/end').length).toBeGreaterThan(turnsBeforeDeletion) }, { timeout: 10_000 })
  const deletionResults = agent.session.snapshotEvents().filter(event => event.type === 'tool/result').slice(-4)
  expect(deletionResults).toHaveLength(4)
  expect(deletionResults.every(event => !event.data.message.isError)).toBe(true)
  expect(JSON.stringify(deletionResults)).toContain('beforeHash')
  expect(JSON.stringify(deletionResults)).toContain('manuscriptWritten')
  const pendingDeletion = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'deletion.md' })).json()).result.value
  expect(pendingDeletion.document.proposals).toHaveLength(1)
  expect(pendingDeletion.document.proposals[0]?.edits).toEqual([
    { blockId: captionBlock.id, before: captionBlock.text, after: 'New table caption.' }, { blockId: tableBlock.id, before: table, after: '' },
  ])
  expect(await readFile(join(root, 'deletion.md'), 'utf8')).toBe(deletionSource)
  await rpc({ action: 'decide', path: 'deletion.md', revision: deletionView.document.current.id, proposalId: 'P1', accept: true })
  expect(await readFile(join(root, 'deletion.md'), 'utf8')).not.toContain(table)
  expect(await readFile(join(root, 'deletion.md'), 'utf8')).toContain('New table caption.')
  const independentSource = '# Independent changes\n\nAn unchanged anchor.\n\nAnother paragraph.\n'
  await writeFile(join(root, 'independent.md'), independentSource)
  const independentView = z.object({ result: z.object({ value: ViewSchema }) })
    .parse(await (await rpc({ action: 'open', path: 'independent.md' })).json()).result.value
  const unchanged = independentView.document.current.blocks[1]!
  const neighbor = independentView.document.current.blocks[2]!
  for (const [index, edit] of [
    { blockId: unchanged.id, before: unchanged.text, after: 'Added context.', operation: 'insert-after' },
    { blockId: neighbor.id, before: neighbor.text, after: 'Revised neighboring paragraph.' },
  ].entries()) {
    const result = await ctx.tools.execute({ agent, callId: ToolCallId(`independent-${index}`), name: 'paper_propose', arguments: {
      path: 'independent.md', baseRevision: independentView.document.current.id, annotationIds: [], reason: 'Independent changes.',
      meaning: 'structure', edits: [edit],
    }, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true)
  }
  const advanced = z.object({ result: z.object({ ok: z.literal(true), value: ViewSchema }) }).parse(await (await rpc({ action: 'decide',
    path: 'independent.md', revision: independentView.document.current.id, proposalId: 'P2', accept: true })).json()).result.value
  const checked = await ctx.tools.execute({ agent, callId: ToolCallId('independent-check'), name: 'paper_check',
    arguments: { path: 'independent.md', proposalId: 'P1' }, signal: new AbortController().signal })
  expect(checked.isError).not.toBe(true)
  const checkText = checked.content.find(item => item.type === 'text')
  if (checkText?.type !== 'text') throw new Error('Proposal check did not return text')
  const applicability = z.object({ proposals: z.array(z.object({ id: z.string(), applicable: z.boolean() })) })
    .parse(JSON.parse(checkText.text)).proposals
  expect(applicability).toEqual([{ id: 'P1', applicable: true }])
  expect(applicability).toMatchSnapshot('insertion after unrelated acceptance')
  const decided = z.object({ result: z.object({ ok: z.literal(true), value: ViewSchema }) }).parse(await (await rpc({ action: 'decide',
    path: 'independent.md', revision: advanced.document.current.id, proposalId: 'P1', accept: true })).json()).result.value
  expect(decided.document.proposals.map(item => item.status)).toEqual(['accepted', 'accepted'])
  expect(await readFile(join(root, 'independent.md'), 'utf8')).toBe(
    '# Independent changes\n\nAn unchanged anchor.\n\nAdded context.\n\nRevised neighboring paragraph.\n')
  const left = await (await control('paper-review/leave', {})).json() as { result: { ok: boolean } }
  expect(left.result.ok).toBe(true)
  expect(await readFile(join(root, '.paper-review', 'sessions.json'), 'utf8')).toBe('[]')
  expect(ctx.tools.schemas(agent).some(schema => schema.name === 'paper_read')).toBe(false)
  expect((await (await control('paper-review/current', {})).json() as { result: { value: { path: string | null } } }).result.value.path).toBeNull()
  const ordinaryAfterExit = await ctx.tools.execute({ agent, callId: ToolCallId('ordinary-after-exit'), name: 'ordinary_tool', arguments: {}, signal: new AbortController().signal })
  expect(ordinaryAfterExit.isError).not.toBe(true)
  const deniedAfterExit = await ctx.tools.execute({ agent, callId: ToolCallId('paper-after-exit'), name: 'paper_read', arguments: { path: 'article.md' }, signal: new AbortController().signal })
  expect(deniedAfterExit.isError).toBe(true)
  const reopened = await (await rpc({ action: 'open', path: 'article.md' })).json() as { result: { ok: boolean } }
  expect(reopened.result.ok).toBe(true)
  expect(ctx.tools.schemas(agent).some(schema => schema.name === 'paper_read')).toBe(true)
  expect(ctx.tools.schemas(agent).some(schema => schema.name === 'ordinary_tool')).toBe(true)
  disposeOrdinary()
  const secondRoot = join(root, 'another-workspace')
  await mkdir(secondRoot)
  await writeFile(join(secondRoot, 'article.md'), 'Different workspace, same file name.\n')
  const secondAgent = await ctx.agentLoop.create(SessionId('second-review'), { provider: 'mock', model: 'mock' }, { cwd: secondRoot })
  const listed = await ctx.tools.execute({ agent: secondAgent, callId: ToolCallId('list-manuscripts'), name: 'paper_list', arguments: {}, signal: new AbortController().signal })
  expect(listed.isError).not.toBe(true)
  const opened = await ctx.tools.execute({ agent: secondAgent, callId: ToolCallId('open-manuscript'), name: 'paper_open', arguments: { path: 'article.md' }, signal: new AbortController().signal })
  expect(opened.isError).not.toBe(true)
  expect((await (await control('paper-review/current', {}, 'second-review')).json() as { result: { value: { path: string } } }).result.value.path).toBe('article.md')
  const second = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' }, true, 'second-review')).json())
  expect(second.result.value.document.current.text).toBe('Different workspace, same file name.\n')
  const entry = [...ctx.loader.entries()].find(entry => entry.options.id === 'paper-review')!
  await entry.fiber!.dispose()
  expect(ctx.tools.schemas().some(schema => schema.name.startsWith('paper_'))).toBe(false)
  expect((await rpc({ action: 'open', path: 'article.md' })).status).toBe(404)
  await ctx.loader.create({ name: 'cordis:review', config: { maxBytes: 1000000 } })
  await ctx.loader.await()
  expect(ctx.tools.schemas(agent).map(schema => schema.name).sort())
    .toEqual([...PaperReview.PAPER_TOOLS, ...PaperReview.PAPER_DISCOVERY_TOOLS].sort())
  expect(ctx.tools.schemas(ordinary).filter(schema => schema.name.startsWith('paper_')).map(schema => schema.name).sort())
    .toEqual([...PaperReview.PAPER_DISCOVERY_TOOLS].sort())
  const restored = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' })).json())
  expect(restored.result.value.document.current.text).toContain('Performance improved')
  const coldId = SessionId('stored-but-not-loaded')
  const cold = ctx.sessions.prepare(coldId, { meta: { cwd: root } })
  const writer = await ctx.sessionPersistence.create(cold.header)
  await writer.flush()
  await writer.close()
  expect(ctx.sessions.get(coldId)).toBeUndefined()
  const coldOpen = z.object({ result: z.object({ value: ViewSchema }) }).parse(await (await rpc({ action: 'open', path: 'article.md' }, true, coldId)).json())
  expect(coldOpen.result.value.document.current.text).toContain('Performance improved')
  expect(ctx.agents.get(coldId)).toBeUndefined()
  expect(ctx.sessions.get(coldId)).toBeUndefined()
  const unknown = await (await rpc({ action: 'open', path: 'article.md' }, true, 'nonexistent-session')).json() as { result: { ok: boolean } }
  expect(unknown.result.ok).toBe(false)
}, 30_000)
