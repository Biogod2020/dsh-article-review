/** Host-side macOS manuscript chooser; the caller validates the returned path. */
import { type NativeCommandRunner } from '@deepseek-ai/dsh-native-command';
/**
 * Show the host's Finder file chooser when an operator is at its display.
 * @param workspaceRoot - initial chooser directory, not a file authorization.
 * @param signal - request lifetime; abort terminates the native command.
 * @param run - command adapter for deterministic tests.
 * @param platform - host platform for deterministic tests.
 * @returns selected absolute path, or null after cancellation.
 */
export declare function pickNativeManuscript(workspaceRoot: string, signal: AbortSignal, run?: NativeCommandRunner, platform?: NodeJS.Platform): Promise<string | null>;
/**
 * Choose one existing `.bib` file on the macOS DSH host; the caller confines its path.
 * @param workspaceRoot - initial Finder directory.
 * @param signal - request lifetime; abort terminates the native command.
 * @param run - command adapter for tests.
 * @param platform - host platform for tests.
 * @returns selected absolute path, or null after cancellation.
 */
export declare function pickNativeBibliography(workspaceRoot: string, signal: AbortSignal, run?: NativeCommandRunner, platform?: NodeJS.Platform): Promise<string | null>;
//# sourceMappingURL=native-file-picker.d.ts.map