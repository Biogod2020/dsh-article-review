/** Revision-pinned pagination without truncating exact Markdown blocks needed for safe edits. */
import { z } from 'zod';
import type { PaperRevision } from './schema.ts';
/** Pagination limits; character budget is soft only for the first indivisible block. */
export declare const ReadPageSchema: z.ZodObject<{
    startBlock: z.ZodDefault<z.ZodNumber>;
    maxBlocks: z.ZodDefault<z.ZodNumber>;
    maxCharacters: z.ZodDefault<z.ZodNumber>;
    revision: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
/** Read whole blocks in source order. Never continue across a revision change. */
export declare function readManuscriptPage(revision: PaperRevision, input: z.input<typeof ReadPageSchema>): {
    blocks: {
        id: string;
        kind: string;
        section: string;
        text: string;
        start: number;
        end: number;
    }[];
    page: {
        startBlock: number;
        endBlockExclusive: number;
        totalBlocks: number;
        nextStartBlock: number | null;
        characters: number;
        exceededCharacterBudget: boolean;
    };
};
//# sourceMappingURL=manuscript-read.d.ts.map