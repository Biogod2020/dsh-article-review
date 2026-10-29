import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' {
    interface SidebarRightTabParamsMap {
        'paper-review': {
            paperPath: string;
            requestId: string;
        };
    }
}
export interface ReaderOpenRequest {
    requestId: string;
    path: string;
}
export type ReaderOpenProps = PropsRuntime<'conversation.composer.dock'> & {
    mounted: {
        subscribe: (listener: () => void) => () => void;
        getSnapshot: () => string | undefined;
    };
    request: (sessionId: string, signal: AbortSignal) => Promise<ReaderOpenRequest | null>;
    reveal: (sessionId: string, request: ReaderOpenRequest) => void;
};
export declare function ReaderOpen({ sessionId, useSession, mounted, request, reveal }: ReaderOpenProps): null;
