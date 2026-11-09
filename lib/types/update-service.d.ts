import type { UpdateConfig } from './update-types.ts';
/** A per-user scheduler keeps the helper available if DSH later refuses the old plugin. */
export declare function updateServicePlan(configFile: string, worker: string, config: UpdateConfig, platform?: NodeJS.Platform, home?: string, uid?: number | undefined): {
    files: Record<string, string>;
    enable: string[][];
    disable: string[][];
};
export declare function configureUpdateService(configFile: string, worker: string, config: UpdateConfig, enabled: boolean): Promise<void>;
