/**
 * Render a PDF cover or readable page without exposing manuscript bytes to a converter's environment.
 * @param path - already validated local PDF path.
 * @param signal - authenticated request lifetime.
 * @param size - short thumbnail or viewport-sized page.
 * @returns a bounded PNG data URL, or undefined if no renderer can read this PDF.
 */
export declare function pdfThumbnail(path: string, signal: AbortSignal, size?: 'thumb' | 'full'): Promise<string | undefined>;
//# sourceMappingURL=figure-thumbnail.d.ts.map