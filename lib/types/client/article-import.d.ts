import type { ArticleInput } from '../article-input.ts';
import type { PaperReviewKey } from './locales.ts';
export interface ArticleImportProps {
    running: boolean;
    t: (key: PaperReviewKey) => string;
    start: (input: ArticleInput, signal: AbortSignal) => Promise<void>;
    onStarted: () => void;
}
export declare function ArticleImport({ running, t, start, onStarted }: ArticleImportProps): import("react/jsx-runtime").JSX.Element;
