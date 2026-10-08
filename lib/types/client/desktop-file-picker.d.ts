/** Return undefined on Web so the caller can use the host picker; null means user cancellation. */
export declare function pickDesktopFile(accept: string, signal: AbortSignal): Promise<string | null> | undefined;
