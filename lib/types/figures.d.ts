/** Discover local figure files without loading large media into the manuscript reader. */
import type { PaperBlock, PaperRevision } from './schema.ts';
/** One selectable local figure reference in a pinned manuscript block. */
export interface PaperFigure {
    readonly blockId: string;
    readonly label: string;
    readonly path: string;
    /** Resolved workspace file, supplied when opening a preview from another revision. */
    readonly file?: string;
}
/**
 * Read an explicitly authored figure root from the manuscript's opening provenance comment.
 * @param source - pinned Markdown source, not current disk content.
 * @returns one safe workspace-relative directory, or the manuscript directory when absent.
 */
export declare function authoredFigureBase(source: string): string;
/**
 * Find explicit figure captions and ordinary Markdown images in displayed blocks.
 * @param blocks - pinned reader revision.
 * @returns selectable local figure references in manuscript order.
 */
export declare function collectFigures(blocks: PaperBlock[]): PaperFigure[];
/**
 * Resolve one authored destination under the manuscript directory or its provenance-declared figure root.
 * @param manuscript - workspace-relative Markdown file.
 * @param base - optional workspace-relative root declared in Markdown provenance.
 * @param path - validated local figure path.
 * @returns workspace-relative file path for the native DSH preview.
 */
export declare function figureFilePath(manuscript: string, base: string, path: string): string | undefined;
/**
 * Use retained figure bytes when this reader revision has a recorded snapshot.
 * @param revision - pinned reader version.
 * @param figure - authored reference in that version.
 * @returns reference with its snapshot destination, otherwise unchanged.
 */
export declare function pinnedFigure(revision: PaperRevision, figure: PaperFigure): PaperFigure;
/**
 * Replace selected figure destinations without changing caption prose or other paths.
 * @param block - exact source block.
 * @param path - selected authored destination.
 * @param replacement - retained replacement destination.
 * @returns source with matching caption or Markdown image references updated.
 */
export declare function replaceFigureReference(block: PaperBlock, path: string, replacement: string): string;
//# sourceMappingURL=figures.d.ts.map