import { z } from 'zod';
export declare const ArticleInputSchema: z.ZodObject<{
    source: z.ZodOptional<z.ZodString>;
    text: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export type ArticleInput = z.infer<typeof ArticleInputSchema>;
/** Return a real input path; generated Markdown will still be confined to the workspace. */
export declare function prepareArticleInput(workspace: string, input: ArticleInput): Promise<string>;
