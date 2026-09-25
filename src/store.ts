/** Local manuscript state, serialized operator actions, and recoverable source acceptance. */
import { constants } from 'node:fs'
import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { checkChanges, migrateAnnotations, parseRevision, revisionId } from './document.ts'
import { assertNewCitations, citationsIn, parseBibtex, possibleBareCitationKeys, reviewableBlocks } from './bibliography.ts'
import type { BibEntry } from './bibliography.ts'
import { acquireOwnerLock } from './owner-lock.ts'
import { DocumentSchema, ProposalInputSchema, ProposalRevisionInputSchema } from './schema.ts'
import type { BibliographyView, PaperCommand, PaperDocument, PaperView, Proposal, ProposalInput, ProposalRevisionInput } from './schema.ts'

const JournalSchema = z.object({ before: z.string(), after: z.string(), next: DocumentSchema })
const BibBindingsSchema = z.record(z.string(), z.array(z.string()))

/** Retain the unchanged anchor when a model supplies it beside one new paragraph or heading as a replacement. */
function normalizeBlockInsertions(proposal: ProposalInput): ProposalInput {
  return { ...proposal, edits: proposal.edits.map((edit) => {
    if (edit.operation) return edit
    const blocks = parseRevision(edit.after).blocks
    const first = blocks[0]
    const second = blocks[1]
    if (blocks.length !== 2 || !first || !second || first.start !== 0
      || edit.after.slice(second.end).trim() !== ''
      || !/^(?:[ \t]*\r?\n){2,}[ \t]*$/.test(edit.after.slice(first.end, second.start))) return edit
    if (first.text === edit.before && (second.kind === 'paragraph' || second.kind === 'heading')) {
      return { ...edit, operation: 'insert-after', after: second.text }
    }
    if (second.text === edit.before && (first.kind === 'paragraph' || first.kind === 'heading')) {
      return { ...edit, operation: 'insert-before', after: first.text }
    }
    return edit
  }) }
}

/** Atomic file replacement preserving source permissions. @param path - destination. @param text - bytes to publish. */
async function atomicWrite(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`
  const mode = await stat(path).then(info => info.mode & 0o777, (error: unknown) => { if (missing(error)) return 0o600; throw error })
  const handle = await open(temporary, 'wx', mode)
  try { await handle.writeFile(text); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, path) } catch (error) { await unlink(temporary); throw error }
}

function missing(error: unknown): boolean { return error instanceof Error && 'code' in error && error.code === 'ENOENT' }

/**
 * Read the explicitly enabled review sessions without acquiring workspace ownership.
 * @param root - session workspace.
 * @returns persisted session ids; an untouched workspace has none.
 */
export async function reviewSessions(root: string): Promise<string[]> {
  const stored = await readFile(resolve(root, '.paper-review', 'sessions.json'), 'utf8').catch((error: unknown) => {
    if (missing(error)) return undefined
    throw error
  })
  return stored === undefined ? [] : z.array(z.string()).parse(JSON.parse(stored))
}

/** One local workspace owner, with state stored beside the manuscript under `.paper-review`. */
export class PaperStore {
  private root = ''
  private stateRoot = ''
  private releaseLock: (() => Promise<void>) | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private closed = false

  /** @param workspaceRoot - explicit local project directory. @param maxBytes - source byte cap. */
  constructor(private readonly workspaceRoot: string, private readonly maxBytes: number) {}

  /** Acquire exclusive plugin ownership before serving any request. */
  async start(): Promise<void> {
    this.root = await realpath(this.workspaceRoot)
    this.stateRoot = resolve(this.root, '.paper-review')
    await mkdir(this.stateRoot, { recursive: true, mode: 0o700 })
    if (await realpath(this.stateRoot) !== this.stateRoot) throw new Error('.paper-review must not be a symlink')
    this.releaseLock = await acquireOwnerLock(this.stateRoot)
  }

  /** Refuse new work, drain accepted operations, and release workspace ownership. */
  async close(): Promise<void> {
    this.closed = true
    await this.tail
    await this.releaseLock?.()
    this.releaseLock = undefined
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(new Error('Paper review is closing'))
    const result = this.tail.then(operation)
    this.tail = result.catch(() => undefined)
    return result
  }

  /**
   * Persist an explicit session opt-in before the next model turn.
   * @param sessionId - native DSH session identity.
   */
  enableSession(sessionId: string): Promise<void> {
    return this.serial(async () => {
      const sessions = await reviewSessions(this.root)
      if (!sessions.includes(sessionId)) await atomicWrite(resolve(this.stateRoot, 'sessions.json'), JSON.stringify([...sessions, sessionId]))
    })
  }

  /**
   * Hide active manuscript tools for one idle session without discarding manuscript state.
   * @param sessionId - native DSH session identity.
   */
  disableSession(sessionId: string): Promise<void> {
    return this.serial(async () => {
      const sessions = await reviewSessions(this.root)
      if (sessions.includes(sessionId)) await atomicWrite(resolve(this.stateRoot, 'sessions.json'), JSON.stringify(sessions.filter(id => id !== sessionId)))
      const paths = await this.sessionPaths()
      if (sessionId in paths) {
        const remaining = Object.fromEntries(Object.entries(paths).filter(([id]) => id !== sessionId))
        await atomicWrite(resolve(this.stateRoot, 'session-paths.json'), JSON.stringify(remaining))
      }
    })
  }

  private async sessionPaths(): Promise<Record<string, string>> {
    const stored = await readFile(resolve(this.stateRoot, 'session-paths.json'), 'utf8').catch((error: unknown) => {
      if (missing(error)) return undefined
      throw error
    })
    return stored === undefined ? {} : z.record(z.string(), z.string()).parse(JSON.parse(stored))
  }

  /**
   * Read the manuscript selected for this conversation.
   * @param sessionId - conversation identity.
   * @returns last selected workspace-relative path, or null if none.
   */
  selectedPath(sessionId: string): Promise<string | null> {
    return this.serial(async () => (await this.sessionPaths())[sessionId] ?? null)
  }

  /**
   * Persist the selected manuscript for later browser windows and resumed turns.
   * @param sessionId - conversation identity.
   * @param path - already validated relative manuscript path.
   * @returns when the selection has been saved.
   */
  selectPath(sessionId: string, path: string): Promise<void> {
    return this.serial(async () => {
      const paths = await this.sessionPaths()
      paths[sessionId] = path
      await atomicWrite(resolve(this.stateRoot, 'session-paths.json'), JSON.stringify(paths))
    })
  }

  /**
   * List one workspace directory for manuscript or BibTeX selection.
   * @param path - workspace-relative directory, or an empty string for the root.
   * @param extension - file suffix to list alongside directories.
   * @returns bounded visible folders and matching files, with truncation state.
   */
  listFiles(path: string, extension: 'md' | 'bib' = 'md'): Promise<{ path: string; entries: { name: string; type: 'directory' | 'file' }[]; truncated: boolean }> {
    return this.serial(async () => {
      if (isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.paper-review')) throw new Error('Choose a directory inside the manuscript workspace')
      const directory = await realpath(resolve(this.root, path))
      const relativePath = relative(this.root, directory)
      if (relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) throw new Error('Directory must be inside the manuscript workspace')
      if (!(await stat(directory)).isDirectory()) throw new Error('Choose a directory')
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter(entry => !entry.name.startsWith('.') && (entry.isDirectory() || (entry.isFile() && entry.name.toLowerCase().endsWith(`.${extension}`))))
        .map(entry => ({ name: entry.name, type: entry.isDirectory() ? 'directory' as const : 'file' as const }))
        .sort((a, b) => Number(a.type === 'file') - Number(b.type === 'file') || a.name.localeCompare(b.name, undefined, { numeric: true }))
      return { path: relativePath === '' ? '' : relativePath.split(sep).join('/'), entries: entries.slice(0, 500), truncated: entries.length > 500 }
    })
  }

  /**
   * Resolve a local figure for DSH's native PDF/image preview, without reading media bytes.
   * @param path - workspace-relative file path from a manuscript reference.
   * @returns canonical file path, confined to this review workspace.
   */
  figurePath(path: string): Promise<string> {
    return this.serial(async () => {
      if (!path || isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.paper-review')
        || !/\.(?:pdf|png|jpe?g|webp|gif|svg)$/i.test(path)) throw new Error('Choose a local PDF or image inside the manuscript workspace')
      const source = await realpath(resolve(this.root, path))
      const normalized = relative(this.root, source)
      if (normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)
        || normalized.split(sep).includes('.paper-review')) throw new Error('Figure must remain inside the manuscript workspace')
      if (!(await stat(source)).isFile()) throw new Error('Figure must be a regular file')
      return source
    })
  }

  private async locate(path: string): Promise<{ source: string; key: string; path: string }> {
    if (!path || isAbsolute(path) || !/\.md$/i.test(path)) throw new Error('Choose a workspace-relative .md file')
    const source = await realpath(resolve(this.root, path))
    const normalized = relative(this.root, source)
    if (normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized) || normalized.split(sep).includes('.paper-review')) throw new Error('Manuscript must be inside the configured workspace')
    const info = await stat(source)
    if (!info.isFile() || info.size > this.maxBytes) throw new Error(`Manuscript must be a regular file no larger than ${this.maxBytes} bytes`)
    return { source, key: resolve(this.stateRoot, `${revisionId(normalized)}.json`), path: normalized }
  }

  private async sourceText(source: string): Promise<string> {
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if ((await file.stat()).size > this.maxBytes) throw new Error('Manuscript exceeds configured size limit')
      const bytes = await file.readFile()
      if (bytes.length > this.maxBytes) throw new Error('Manuscript exceeds configured size limit')
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } finally { await file.close() }
  }

  private async bibSource(path: string): Promise<string> {
    if (!path || isAbsolute(path) || !/\.bib$/i.test(path) || path.split(/[\\/]/).some(part => part === '..' || part === '.paper-review')) {
      throw new Error('Choose a workspace-relative .bib file outside .paper-review')
    }
    const source = await realpath(resolve(this.root, path))
    const normalized = relative(this.root, source)
    if (normalized === '..' || normalized.startsWith(`..${sep}`) || isAbsolute(normalized)
      || normalized.split(sep).includes('.paper-review') || !(await stat(source)).isFile()) throw new Error('BibTeX file must remain inside the workspace')
    return source
  }

  private async bibText(source: string): Promise<string> {
    const file = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW)
    try {
      if ((await file.stat()).size > this.maxBytes) throw new Error('BibTeX file exceeds configured size limit')
      const bytes = await file.readFile()
      if (bytes.length > this.maxBytes) throw new Error('BibTeX file exceeds configured size limit')
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    } finally { await file.close() }
  }

  private async bibBindings(): Promise<Record<string, string[]>> {
    const stored = await readFile(resolve(this.stateRoot, 'bibliographies.json'), 'utf8').catch((error: unknown) => {
      if (missing(error)) return undefined
      throw error
    })
    return stored === undefined ? {} : BibBindingsSchema.parse(JSON.parse(stored))
  }

  private async bibEntries(path: string): Promise<{ files: string[]; entries: BibEntry[] }> {
    const files = (await this.bibBindings())[path] ?? []
    const entries: BibEntry[] = []
    const keys = new Set<string>()
    for (const file of files) {
      const source = await this.bibSource(file)
      for (const entry of parseBibtex(await this.bibText(source), file)) {
        if (keys.has(entry.key)) throw new Error(`Duplicate BibTeX key ${entry.key} in bound files`)
        keys.add(entry.key)
        entries.push(entry)
      }
    }
    return { files, entries }
  }

  /**
   * Bind explicit workspace `.bib` files without changing the manuscript or their content.
   * @param path - workspace-relative Markdown manuscript.
   * @param files - complete replacement list of workspace-relative BibTeX paths.
   * @returns the new bibliography index and citation diagnostics.
   */
  configureBibliography(path: string, files: string[]): Promise<BibliographyView> {
    return this.serial(async () => {
      const location = await this.locate(path)
      if (new Set(files).size !== files.length) throw new Error('A BibTeX file cannot be bound twice')
      const keys = new Set<string>()
      for (const file of files) {
        const source = await this.bibSource(file)
        for (const entry of parseBibtex(await this.bibText(source), file)) {
          if (keys.has(entry.key)) throw new Error(`Duplicate BibTeX key ${entry.key} in bound files`)
          keys.add(entry.key)
        }
      }
      const bindings = await this.bibBindings()
      bindings[location.path] = files
      await atomicWrite(resolve(this.stateRoot, 'bibliographies.json'), JSON.stringify(bindings))
      return this.bibliographyViewNow(location.path)
    })
  }

  private async bibliographyViewNow(path: string): Promise<BibliographyView> {
    const { document } = await this.load(path)
    const { files, entries } = await this.bibEntries(document.path)
    const keys = new Set(entries.map(entry => entry.key))
    const blocks = reviewableBlocks(document.current.blocks)
    const citations = blocks.flatMap(block => block.kind === 'code' ? [] : citationsIn(block.text).flatMap(citation => citation.keys))
    const missingKeys = [...new Set(citations.filter(key => !keys.has(key)))]
    const possibleBareKeys = possibleBareCitationKeys(
      blocks.filter(block => block.kind !== 'code').map(block => block.text).join('\n'),
      entries.map(entry => entry.key),
    )
    const citationStatus = files.length === 0 ? 'unbound'
      : missingKeys.length > 0 ? 'missing-keys'
        : possibleBareKeys.length > 0 ? 'possible-legacy-keys'
          : citations.length > 0 ? 'resolved' : 'no-citations'
    return { files, entries: entries.map(({ key, type, file, hash, fields }) => ({ key, type, file, hash, fields })),
      missingKeys, possibleBareKeys, canonicalCitationCount: citations.length, citationStatus }
  }

  /**
   * Read bound BibTeX metadata and unresolved manuscript citations without modifying either source.
   * @param path - workspace-relative Markdown manuscript.
   * @returns bibliography index and citation diagnostics.
   */
  bibliography(path: string): Promise<BibliographyView> {
    return this.serial(() => this.bibliographyViewNow(path))
  }

  /**
   * Read one exact BibTeX entry for optimistic, field-preserving replacement.
   * @param path - workspace-relative Markdown manuscript.
   * @param key - bound BibTeX citation key.
   * @returns exact entry and hash; metadata truth is not verified.
   */
  bibliographyEntry(path: string, key: string): Promise<BibEntry> {
    return this.serial(async () => {
      const { path: normalized } = await this.locate(path)
      const entry = (await this.bibEntries(normalized)).entries.find(item => item.key === key)
      if (!entry) throw new Error(`BibTeX key ${key} is not in the bound files`)
      return entry
    })
  }

  /**
   * Add one BibTeX entry directly to its bound source file; no manuscript proposal is created.
   * @param path - workspace-relative Markdown manuscript.
   * @param file - bound workspace-relative BibTeX file.
   * @param raw - one complete BibTeX entry; publication facts require external verification.
   * @returns updated index and citation diagnostics after an atomic file replacement.
   */
  addBibliographyEntry(path: string, file: string, raw: string): Promise<BibliographyView> {
    return this.serial(async () => {
      const { path: normalized } = await this.locate(path)
      const existing = await this.bibEntries(normalized)
      if (!existing.files.includes(file)) throw new Error('Bind this .bib file to the manuscript before adding an entry')
      const parsed = parseBibtex(raw, file)
      if (parsed.length !== 1 || raw.trim() !== parsed[0]?.raw) throw new Error('Provide exactly one complete BibTeX entry')
      const entry = parsed[0]
      if (existing.entries.some(item => item.key === entry.key)) throw new Error(`BibTeX key ${entry.key} already exists`)
      if (!entry.fields.author || !entry.fields.title || !entry.fields.year) throw new Error('BibTeX entry needs author, title and year')
      const source = await this.bibSource(file)
      const before = await this.bibText(source)
      const after = `${before.trimEnd()}\n\n${entry.raw}\n`
      if (Buffer.byteLength(after) > this.maxBytes) throw new Error('BibTeX file would exceed configured size limit')
      if (await this.bibText(source) !== before) throw new Error('BibTeX file changed during update; reread it')
      await atomicWrite(source, after)
      return this.bibliographyViewNow(normalized)
    })
  }

  /**
   * Replace one exact entry in its bound `.bib` file; other entries retain their original bytes.
   * @param path - workspace-relative Markdown manuscript.
   * @param key - existing BibTeX key, which the replacement must retain.
   * @param expectedHash - hash returned by bibliographyEntry for conflict detection.
   * @param raw - replacement BibTeX entry; publication facts require external verification.
   * @returns updated index and citation diagnostics after an atomic file replacement.
   */
  replaceBibliographyEntry(path: string, key: string, expectedHash: string, raw: string): Promise<BibliographyView> {
    return this.serial(async () => {
      const { path: normalized } = await this.locate(path)
      const entry = (await this.bibEntries(normalized)).entries.find(item => item.key === key)
      if (!entry || entry.hash !== expectedHash) throw new Error('BibTeX entry changed; reread it before replacing')
      const parsed = parseBibtex(raw, entry.file)
      if (parsed.length !== 1 || parsed[0]?.key !== key || raw.trim() !== parsed[0].raw) throw new Error('Replacement must be one complete entry with the same key')
      if (!parsed[0].fields.author || !parsed[0].fields.title || !parsed[0].fields.year) throw new Error('BibTeX entry needs author, title and year')
      const source = await this.bibSource(entry.file)
      const before = await this.bibText(source)
      if (before.split(entry.raw).length !== 2) throw new Error('BibTeX entry no longer occurs exactly once in its source')
      const after = before.replace(entry.raw, parsed[0].raw)
      if (Buffer.byteLength(after) > this.maxBytes) throw new Error('BibTeX file would exceed configured size limit')
      if (await this.bibText(source) !== before) throw new Error('BibTeX file changed during update; reread it')
      await atomicWrite(source, after)
      return this.bibliographyViewNow(normalized)
    })
  }

  private async load(path: string): Promise<{ document: PaperDocument; source: string; key: string; disk: string }> {
    const location = await this.locate(path)
    const disk = await this.sourceText(location.source)
    const journal = await readFile(`${location.key}.pending`, 'utf8').catch((error: unknown) => { if (missing(error)) return undefined; throw error })
    if (journal !== undefined) {
      const pending = JournalSchema.parse(JSON.parse(journal))
      if (pending.next.path !== location.path) throw new Error('Recovery journal targets a different manuscript')
      if (revisionId(disk) === pending.after) await atomicWrite(location.key, JSON.stringify(pending.next))
      else if (revisionId(disk) !== pending.before) throw new Error('An interrupted acceptance conflicts with external edits. Preserve the .pending file and reconcile the manuscript before continuing.')
      await unlink(`${location.key}.pending`)
    }
    const stored = await readFile(location.key, 'utf8').catch((error: unknown) => { if (missing(error)) return undefined; throw error })
    let document: PaperDocument
    if (stored !== undefined) {
      document = DocumentSchema.parse(JSON.parse(stored))
      if (document.path !== location.path || revisionId(document.current.text) !== document.current.id) throw new Error('Manuscript state failed integrity validation')
    } else {
      const current = parseRevision(disk)
      document = { schemaVersion: 1, path: location.path, current, revisions: [current],
        annotations: [], highlights: [], proposals: [], baselines: [], history: [], reading: {} }
      await atomicWrite(location.key, JSON.stringify(document))
    }
    return { document, ...location, disk }
  }

  private record(document: PaperDocument, action: string, detail: string): void {
    document.history.push({ at: new Date().toISOString(), action, detail })
  }

  private assertRevision(document: PaperDocument, revision: string): void {
    if (document.current.id !== revision) throw new Error('The reader version is stale. Load the current version before applying this action.')
  }

  /**
   * Read a pinned revision and signal external changes without replacing the reading view.
   * @param path - workspace-relative Markdown source.
   * @returns state and external-change flag.
   */
  read(path: string): Promise<PaperView> {
    return this.serial(async () => {
      const { document, disk } = await this.load(path)
      return { document, diskChanged: revisionId(disk) !== document.current.id }
    })
  }

  /** Validate every candidate edit against its base, current source, annotations and locks; return review hints. */
  private async proposalFlags(document: PaperDocument, proposal: ProposalInput): Promise<Proposal['flags']> {
    const base = document.revisions.find(r => r.id === proposal.baseRevision)
    if (base === undefined) throw new Error('Unknown base revision; use paper_read first')
    const editKeys = proposal.edits.map(edit => edit.operation
      ? `${edit.blockId}:${edit.operation}:${edit.after}` : `${edit.blockId}:replace`)
    if (new Set(editKeys).size !== editKeys.length) throw new Error('A proposal cannot repeat an identical edit or replace one block twice')
    if (proposal.edits.some(edit => edit.operation) && proposal.baseRevision !== document.current.id) throw new Error('Insertions require the current reader revision; rebase the proposal before inserting')
    for (const annotationId of proposal.annotationIds) {
      const annotation = document.annotations.find(a => a.id === annotationId)
      if (annotation === undefined || annotation.anchor !== 'attached') throw new Error('Referenced annotation is missing or needs manual location')
    }
    const bibliography = await this.bibEntries(document.path)
    const keys = bibliography.files.length ? new Set(bibliography.entries.map(entry => entry.key)) : null
    for (const edit of proposal.edits) {
      const block = base.blocks.find(b => b.id === edit.blockId)
      if (block === undefined || block.text !== edit.before) throw new Error('Edit must match one unchanged base block')
      if (document.current.blocks.find(b => b.id === edit.blockId)?.text !== edit.before) throw new Error('The proposed block has changed; reread it')
      if (document.baselines.some(b => b.blockId === edit.blockId && b.locked)) throw new Error('The author locked this block; ask them to unlock it')
      const after = parseRevision(edit.after)
      if (edit.operation) {
        if (after.blocks.length !== 1 || !['paragraph', 'heading'].includes(after.blocks[0]?.kind ?? '')
          || after.blocks[0]?.text !== edit.after) throw new Error('Insert exactly one complete Markdown paragraph or heading; use separate edits for other blocks')
        assertNewCitations('', edit.after, keys)
      } else {
        if (edit.before === edit.after) throw new Error('Replacement must contain an actual change')
        if (after.blocks.length !== 1 || after.blocks[0]?.kind !== block.kind || after.blocks[0].text !== edit.after) {
          throw new Error('Replacement must be one complete Markdown block without changing its block type. To add a paragraph or heading, keep the original block unchanged beside one new blank-separated block, or use operation: insert-before/insert-after with only the new block in after. Group edits if the original also changes.')
        }
        if (block.kind !== 'code' && block.kind !== 'html') assertNewCitations(edit.before, edit.after, keys)
      }
    }
    return checkChanges(proposal, base.blocks)
  }

  /**
   * Submit validated replacements or paragraph/heading insertions without writing the manuscript.
   * @param path - manuscript.
   * @param input - exact base and edits.
   * @returns stored proposal id and checks.
   */
  propose(path: string, input: ProposalInput): Promise<PaperView> {
    return this.serial(async () => {
      const proposal = normalizeBlockInsertions(ProposalInputSchema.parse(input))
      const { document, key, disk } = await this.load(path)
      if (revisionId(disk) !== document.current.id) throw new Error('External changes await reader refresh; no proposal can be submitted against stale source')
      const flags = await this.proposalFlags(document, proposal)
      const id = `P${document.proposals.length + 1}`
      document.proposals.push({ ...proposal, id, status: 'pending', flags, createdAt: new Date().toISOString() })
      this.record(document, 'proposed', id)
      await atomicWrite(key, JSON.stringify(document))
      return { document, diskChanged: false }
    })
  }

  /**
   * Revise one pending proposal in place, without writing the manuscript or changing its id.
   * Omitted fields retain their prior values; a supplied edits array replaces the whole edit group.
   * An explicit baseRevision lets a stale proposal be rebased onto exact blocks in a newer reader version.
   * @param path - manuscript.
   * @param input - current reader revision, proposal id, and changed proposal fields.
   * @returns updated review state after the same checks used for a new proposal.
   */
  revise(path: string, input: ProposalRevisionInput): Promise<PaperView> {
    return this.serial(async () => {
      const revision = ProposalRevisionInputSchema.parse(input)
      const { document, key, disk } = await this.load(path)
      this.assertRevision(document, revision.revision)
      if (revisionId(disk) !== document.current.id) throw new Error('External changes await reader refresh; no proposal can be revised against stale source')
      const previous = document.proposals.find(p => p.id === revision.proposalId)
      if (!previous || previous.status !== 'pending') throw new Error('Proposal is no longer pending')
      const candidate = normalizeBlockInsertions(ProposalInputSchema.parse({
        baseRevision: revision.baseRevision ?? previous.baseRevision,
        annotationIds: revision.annotationIds ?? previous.annotationIds,
        reason: revision.reason ?? previous.reason,
        meaning: revision.meaning ?? previous.meaning,
        edits: revision.edits ?? previous.edits,
      }))
      if (candidate.baseRevision === previous.baseRevision && candidate.reason === previous.reason && candidate.meaning === previous.meaning
        && JSON.stringify(candidate.annotationIds) === JSON.stringify(previous.annotationIds)
        && JSON.stringify(candidate.edits) === JSON.stringify(previous.edits)) throw new Error('Proposal revision makes no changes')
      const flags = await this.proposalFlags(document, candidate)
      Object.assign(previous, candidate, { flags })
      this.record(document, 'revised', previous.id)
      await atomicWrite(key, JSON.stringify(document))
      return { document, diskChanged: false }
    })
  }

  /**
   * Apply an authenticated operator gesture. Acceptance checks current source and preserves a recovery journal.
   * @param command - validated browser action.
   * @returns updated state.
   */
  command(command: PaperCommand): Promise<PaperView> {
    return this.serial(async () => {
      const { document, key, source, disk } = await this.load(command.path)
      if (command.action === 'open') return { document, diskChanged: revisionId(disk) !== document.current.id }
      if ('revision' in command) this.assertRevision(document, command.revision)
      let output: string | undefined
      switch (command.action) {
        case 'refresh': {
          if (revisionId(disk) !== document.current.id) {
            document.current = parseRevision(disk, document.current)
            document.revisions.push(document.current)
            document.annotations = migrateAnnotations(document.annotations, document.current)
            document.highlights = migrateAnnotations(document.highlights, document.current)
            this.record(document, 'imported', document.current.id)
          }
          break
        }
        case 'annotate': {
          const block = document.current.blocks.find(b => b.id === command.blockId)
          if (!block || (!command.rendered && command.quote !== '' && !block.text.includes(command.quote))) throw new Error('Selection does not match Markdown source; annotate the entire paragraph or select its source text')
          const id = `C${document.annotations.length + 1}`
          document.annotations.push({ id, blockId: block.id, revision: document.current.id, quote: command.quote, prefix: command.prefix, suffix: command.suffix, comment: command.comment, status: 'open', anchor: 'attached', ...(command.rendered ? { renderedSource: block.text, offset: command.offset } : {}) })
          this.record(document, 'annotated', id)
          break
        }
        case 'highlight': {
          const block = document.current.blocks.find(b => b.id === command.blockId)
          if (!block) throw new Error('The selected paragraph no longer exists')
          const existing = document.highlights.find(h => !h.removed && h.anchor === 'attached' && h.blockId === block.id
            && h.quote === command.quote && h.offset === command.offset && h.prefix === command.prefix && h.suffix === command.suffix)
          if (existing) existing.color = command.color
          else document.highlights.push({ id: `H${document.highlights.length + 1}`, blockId: block.id,
            revision: document.current.id, quote: command.quote, prefix: command.prefix, suffix: command.suffix,
            renderedSource: block.text, offset: command.offset, color: command.color, anchor: 'attached', removed: false })
          this.record(document, 'highlighted', existing?.id ?? `H${document.highlights.length}`)
          break
        }
        case 'set-highlight': {
          const highlight = document.highlights.find(h => h.id === command.highlightId)
          if (!highlight) throw new Error('Highlight not found')
          highlight.removed = command.removed
          this.record(document, command.removed ? 'highlight-removed' : 'highlight-restored', highlight.id)
          break
        }
        case 'resolve': {
          const annotation = document.annotations.find(a => a.id === command.annotationId)
          if (!annotation) throw new Error('Annotation not found')
          annotation.status = command.resolved ? 'resolved' : 'open'
          this.record(document, command.resolved ? 'resolved' : 'reopened', annotation.id)
          break
        }
        case 'review': {
          if (revisionId(disk) !== document.current.id) throw new Error('External changes must be loaded before marking the current text reviewed')
          for (const blockId of command.blockIds) {
            const block = document.current.blocks.find(b => b.id === blockId)
            if (!block) throw new Error('Block no longer exists')
            const locked = command.locked || document.baselines.some(b => b.blockId === blockId && b.locked)
            document.baselines = document.baselines.filter(b => b.blockId !== blockId)
            document.baselines.push({ blockId, revision: document.current.id, text: block.text,
              locked, reviewedAt: new Date().toISOString() })
          }
          this.record(document, command.locked ? 'reviewed-and-locked' : 'reviewed', command.blockIds.join(', '))
          break
        }
        case 'decide': {
          const proposal = document.proposals.find(p => p.id === command.proposalId)
          if (!proposal || proposal.status !== 'pending') throw new Error('Proposal is no longer pending')
          if (command.accept) {
            if (revisionId(disk) !== document.current.id) throw new Error('Source changed outside paper review; acceptance was refused')
            if (proposal.edits.some(edit => edit.operation) && proposal.baseRevision !== document.current.id) throw new Error('Insertion anchor is stale; rebase this proposal before accepting it')
            const changes = proposal.edits.map((edit) => {
              const block = document.current.blocks.find(b => b.id === edit.blockId)
              if (!block || block.text !== edit.before) throw new Error('This proposal overlaps an accepted or external edit. Ask for a new proposal.')
              if (document.baselines.some(b => b.blockId === edit.blockId && b.locked)) throw new Error('Unlock the reviewed block before accepting a change')
              return { block, edit }
            })
            const bibliography = await this.bibEntries(document.path)
            const keys = bibliography.files.length ? new Set(bibliography.entries.map(entry => entry.key)) : null
            for (const { block, edit } of changes) {
              if (edit.operation || (block.kind !== 'code' && block.kind !== 'html')) assertNewCitations(edit.operation ? '' : edit.before, edit.after, keys)
            }
            const sourceText = document.current.text
            output = sourceText
            const blocks = document.current.blocks
            const newline = sourceText.includes('\r\n') ? '\r\n' : '\n'
            const separator = newline + newline
            const operations = changes.map(({ block, edit }, index) => {
              if (!edit.operation) return { start: block.start, end: block.end, content: edit.after, index }
              const anchorIndex = blocks.findIndex(candidate => candidate.id === block.id)
              const adjacent = edit.operation === 'insert-before' ? blocks[anchorIndex - 1] : blocks[anchorIndex + 1]
              const gap = edit.operation === 'insert-before'
                ? sourceText.slice(adjacent?.end ?? block.start, block.start)
                : sourceText.slice(block.end, adjacent?.start ?? block.end)
              const missingBreaks = adjacent ? newline.repeat(Math.max(0, 2 - (gap.match(/\r?\n/g)?.length ?? 0))) : ''
              return edit.operation === 'insert-before'
                ? { start: block.start, end: block.start, content: missingBreaks + edit.after + separator, index }
                : { start: block.end, end: block.end, content: separator + edit.after + missingBreaks, index }
            })
            for (const operation of operations.sort((a, b) => b.start - a.start || b.end - a.end || b.index - a.index)) {
              output = output.slice(0, operation.start) + operation.content + output.slice(operation.end)
            }
            if (Buffer.byteLength(output) > this.maxBytes) throw new Error('Accepted manuscript would exceed configured size limit')
            const replacements = new Map(proposal.edits.filter(edit => !edit.operation).map(edit => [edit.blockId, edit.after]))
            document.current = parseRevision(output, document.current, replacements)
            document.revisions.push(document.current)
            document.annotations = migrateAnnotations(document.annotations, document.current)
            document.highlights = migrateAnnotations(document.highlights, document.current)
          }
          proposal.status = command.accept ? 'accepted' : 'rejected'
          this.record(document, proposal.status, proposal.id)
          break
        }
        case 'position': document.reading[command.reader] = command.blockId; break
        case 'unlock': {
          const baseline = document.baselines.find(b => b.blockId === command.blockId)
          if (!baseline) throw new Error('No review baseline exists for this block')
          baseline.locked = false
          this.record(document, 'unlocked', command.blockId)
          break
        }
      }
      if (output !== undefined) {
        await atomicWrite(`${key}.pending`, JSON.stringify({ before: revisionId(disk), after: revisionId(output), next: document }))
        if (await this.sourceText(source) !== disk) { await unlink(`${key}.pending`); throw new Error('Source changed during acceptance; retry after importing the new version') }
        await atomicWrite(source, output)
        await atomicWrite(key, JSON.stringify(document))
        await unlink(`${key}.pending`)
      } else await atomicWrite(key, JSON.stringify(document))
      return { document, diskChanged: revisionId(output ?? disk) !== document.current.id }
    })
  }
}
