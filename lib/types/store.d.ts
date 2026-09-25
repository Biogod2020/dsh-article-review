import type { BibEntry } from './bibliography.ts';
import type { BibliographyView, PaperCommand, PaperView, ProposalInput, ProposalRevisionInput } from './schema.ts';
/**
 * Read the explicitly enabled review sessions without acquiring workspace ownership.
 * @param root - session workspace.
 * @returns persisted session ids; an untouched workspace has none.
 */
export declare function reviewSessions(root: string): Promise<string[]>;
/** One local workspace owner, with state stored beside the manuscript under `.paper-review`. */
export declare class PaperStore {
    private readonly workspaceRoot;
    private readonly maxBytes;
    private root;
    private stateRoot;
    private releaseLock;
    private tail;
    private closed;
    /** @param workspaceRoot - explicit local project directory. @param maxBytes - source byte cap. */
    constructor(workspaceRoot: string, maxBytes: number);
    /** Acquire exclusive plugin ownership before serving any request. */
    start(): Promise<void>;
    /** Refuse new work, drain accepted operations, and release workspace ownership. */
    close(): Promise<void>;
    private serial;
    /**
     * Persist an explicit session opt-in before the next model turn.
     * @param sessionId - native DSH session identity.
     */
    enableSession(sessionId: string): Promise<void>;
    /**
     * Hide active manuscript tools for one idle session without discarding manuscript state.
     * @param sessionId - native DSH session identity.
     */
    disableSession(sessionId: string): Promise<void>;
    private sessionPaths;
    /**
     * Read the manuscript selected for this conversation.
     * @param sessionId - conversation identity.
     * @returns last selected workspace-relative path, or null if none.
     */
    selectedPath(sessionId: string): Promise<string | null>;
    /**
     * Persist the selected manuscript for later browser windows and resumed turns.
     * @param sessionId - conversation identity.
     * @param path - already validated relative manuscript path.
     * @returns when the selection has been saved.
     */
    selectPath(sessionId: string, path: string): Promise<void>;
    /**
     * List one workspace directory for manuscript or BibTeX selection.
     * @param path - workspace-relative directory, or an empty string for the root.
     * @param extension - file suffix to list alongside directories.
     * @returns bounded visible folders and matching files, with truncation state.
     */
    listFiles(path: string, extension?: 'md' | 'bib'): Promise<{
        path: string;
        entries: {
            name: string;
            type: 'directory' | 'file';
        }[];
        truncated: boolean;
    }>;
    /**
     * Resolve a local figure for DSH's native PDF/image preview, without reading media bytes.
     * @param path - workspace-relative file path from a manuscript reference.
     * @returns canonical file path, confined to this review workspace.
     */
    figurePath(path: string): Promise<string>;
    private locate;
    private sourceText;
    private bibSource;
    private bibText;
    private bibBindings;
    private bibEntries;
    /**
     * Bind explicit workspace `.bib` files without changing the manuscript or their content.
     * @param path - workspace-relative Markdown manuscript.
     * @param files - complete replacement list of workspace-relative BibTeX paths.
     * @returns the new bibliography index and citation diagnostics.
     */
    configureBibliography(path: string, files: string[]): Promise<BibliographyView>;
    private bibliographyViewNow;
    /**
     * Read bound BibTeX metadata and unresolved manuscript citations without modifying either source.
     * @param path - workspace-relative Markdown manuscript.
     * @returns bibliography index and citation diagnostics.
     */
    bibliography(path: string): Promise<BibliographyView>;
    /**
     * Read one exact BibTeX entry for optimistic, field-preserving replacement.
     * @param path - workspace-relative Markdown manuscript.
     * @param key - bound BibTeX citation key.
     * @returns exact entry and hash; metadata truth is not verified.
     */
    bibliographyEntry(path: string, key: string): Promise<BibEntry>;
    /**
     * Add one BibTeX entry directly to its bound source file; no manuscript proposal is created.
     * @param path - workspace-relative Markdown manuscript.
     * @param file - bound workspace-relative BibTeX file.
     * @param raw - one complete BibTeX entry; publication facts require external verification.
     * @returns updated index and citation diagnostics after an atomic file replacement.
     */
    addBibliographyEntry(path: string, file: string, raw: string): Promise<BibliographyView>;
    /**
     * Replace one exact entry in its bound `.bib` file; other entries retain their original bytes.
     * @param path - workspace-relative Markdown manuscript.
     * @param key - existing BibTeX key, which the replacement must retain.
     * @param expectedHash - hash returned by bibliographyEntry for conflict detection.
     * @param raw - replacement BibTeX entry; publication facts require external verification.
     * @returns updated index and citation diagnostics after an atomic file replacement.
     */
    replaceBibliographyEntry(path: string, key: string, expectedHash: string, raw: string): Promise<BibliographyView>;
    private load;
    private record;
    private assertRevision;
    /**
     * Read a pinned revision and signal external changes without replacing the reading view.
     * @param path - workspace-relative Markdown source.
     * @returns state and external-change flag.
     */
    read(path: string): Promise<PaperView>;
    /** Validate every candidate edit against its base, current source, annotations and locks; return review hints. */
    private proposalFlags;
    /**
     * Submit validated replacements or paragraph/heading insertions without writing the manuscript.
     * @param path - manuscript.
     * @param input - exact base and edits.
     * @returns stored proposal id and checks.
     */
    propose(path: string, input: ProposalInput): Promise<PaperView>;
    /**
     * Revise one pending proposal in place, without writing the manuscript or changing its id.
     * Omitted fields retain their prior values; a supplied edits array replaces the whole edit group.
     * An explicit baseRevision lets a stale proposal be rebased onto exact blocks in a newer reader version.
     * @param path - manuscript.
     * @param input - current reader revision, proposal id, and changed proposal fields.
     * @returns updated review state after the same checks used for a new proposal.
     */
    revise(path: string, input: ProposalRevisionInput): Promise<PaperView>;
    /**
     * Apply an authenticated operator gesture. Acceptance checks current source and preserves a recovery journal.
     * @param command - validated browser action.
     * @returns updated state.
     */
    command(command: PaperCommand): Promise<PaperView>;
}
//# sourceMappingURL=store.d.ts.map