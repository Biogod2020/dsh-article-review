export declare const UPDATE_PACKAGE = "dsh-article-review";
export interface WorkerOptions {
    /** Loopback registry is injected by integration tests, never read from persisted user configuration. */
    registry?: string;
    afterStep?: (step: string) => Promise<void>;
    onError?: (error: unknown) => void;
}
export declare function readJson<T>(path: string): Promise<T>;
export declare function atomicJson(path: string, value: unknown): Promise<void>;
export declare function processAlive(pid: number): boolean;
/** One check prepares immutable files, waits for every registered Host, then commits. */
export declare function runUpdate(configFile: string, options?: WorkerOptions): Promise<void>;
