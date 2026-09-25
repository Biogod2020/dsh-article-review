/** Discover local figure files without loading large media into the manuscript reader. */
import type { PaperBlock } from '../schema.ts';
/** One selectable local figure reference in a pinned manuscript block. */
export interface PaperFigure {
    readonly blockId: string;
    readonly label: string;
    readonly path: string;
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
//# sourceMappingURL=figures.d.ts.map