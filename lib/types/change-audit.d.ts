/** Browser-safe, deterministic lexical evidence. This does not validate scientific truth. */
export type ChangeCategory = 'numbers' | 'citations' | 'figures' | 'claim-language';
/** Exact source span; offsets use JavaScript UTF-16 indices, as manuscript blocks do. */
export type ChangeToken = {
    text: string;
    start: number;
    end: number;
};
/** Bounded examples plus full counts; an empty result is not scientific approval. */
export type ChangeEvidence = {
    category: ChangeCategory;
    before: ChangeToken[];
    after: ChangeToken[];
    beforeCount: number;
    afterCount: number;
    truncated: boolean;
};
/**
 * Compare ordered lexical tokens; swapped values remain visible even if their multisets match.
 * @param before - exact replaced source, or empty for an insertion.
 * @param after - proposed exact source.
 * @param limit - maximum examples on each side, from 1 to 100.
 * @returns only changed categories with bounded, source-grounded evidence.
 */
export declare function auditTextChanges(before: string, after: string, limit?: number): ChangeEvidence[];
