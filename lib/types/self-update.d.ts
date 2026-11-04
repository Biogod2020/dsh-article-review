import { configureUpdateService } from './update-service.ts';
import type { PluginUpdateView, UpdateConfig, UpdateProfile } from './update-types.ts';
interface Options {
    packageRoot?: string;
    configureService?: typeof configureUpdateService;
    launch?: (configFile: string, worker: string, config: UpdateConfig) => void;
}
export declare class SelfUpdate {
    private profile;
    private options;
    private configFile?;
    private worker?;
    private config?;
    private supported;
    private initialized;
    private operation;
    private readonly packageRoot;
    private runningVersion;
    constructor(profile: UpdateProfile | undefined, options?: Options);
    private initialize;
    private launch;
    view(): Promise<PluginUpdateView>;
    setEnabled(value: boolean): Promise<PluginUpdateView>;
}
export {};
