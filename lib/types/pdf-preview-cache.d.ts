import { pdfThumbnail } from './figure-thumbnail.ts';
type Size = 'thumb' | 'full';
/** Plugin-lifetime memory and converter limits; callers independently own cancellation. */
export declare class PdfPreviewCache {
    private readonly maxBytes;
    private readonly concurrency;
    private readonly render;
    private readonly lifetime;
    private readonly cached;
    private readonly pending;
    private readonly queue;
    private bytes;
    private active;
    constructor(maxBytes: number, concurrency: number, render?: typeof pdfThumbnail);
    private slot;
    private convert;
    /** Resolve only an already workspace-validated path; file identity prevents reuse after replacement. */
    get(path: string, signal: AbortSignal, size?: Size): Promise<string | undefined>;
    /** Abort queued/running converters and release all retained preview data on plugin disposal. */
    dispose(): void;
}
export {};
//# sourceMappingURL=pdf-preview-cache.d.ts.map