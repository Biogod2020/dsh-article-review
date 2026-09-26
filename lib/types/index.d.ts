/** Opt-in local review host: authenticated actions and manuscript model tools. */
import type { Context } from '@deepseek-ai/cordis';
import ConfigSchema from '@deepseek-ai/schemastery';
/** Cordis plugin identity. */
export declare const name = "paper-review";
/** The plugin requires authenticated transport and the model tool executor. */
export declare const inject: string[];
/** Local deployment choices; ordinary sessions keep their existing tools. */
export interface Config {
    /** Local project whose Markdown sources are reviewed. */
    workspaceRoot?: string;
    /** Maximum UTF-8 bytes in one manuscript. */
    maxBytes: number;
}
/** Loader validation; workspace selection is explicit. */
export declare const Config: ConfigSchema<Config>;
/** Manuscript tools visible after a document opens; ordinary tools remain available. */
export declare const PAPER_TOOLS: readonly ["paper_read", "paper_annotations", "paper_propose", "paper_revise", "paper_check", "paper_decide", "paper_bib_find", "paper_bib_bind", "paper_bib_list", "paper_bib_get", "paper_bib_add", "paper_bib_replace"];
/** Manuscript discovery tools are available before a document opens. */
export declare const PAPER_DISCOVERY_TOOLS: readonly ["paper_list", "paper_open"];
/**
 * Register the workspace store, tools and authenticated operator RPC.
 * @param ctx - Host plugin context.
 * @param config - validated local project settings.
 */
export declare function apply(ctx: Context, config: Config): Promise<void>;
//# sourceMappingURL=index.d.ts.map