/** Host-side macOS manuscript chooser; the caller validates the returned path. */
import { runNativeCommand, type NativeCommandRunner } from '@deepseek-ai/dsh-native-command'

const SCRIPT = `on run argv
  set selectedFile to choose file with prompt "Choose Markdown manuscript" of type {"md"} default location (POSIX file (item 1 of argv))
  return POSIX path of selectedFile
end run`
const BIB_SCRIPT = `on run argv
  set selectedFile to choose file with prompt "Choose authoritative BibTeX file" of type {"bib"} default location (POSIX file (item 1 of argv))
  return POSIX path of selectedFile
end run`

/**
 * Show the host's Finder file chooser when an operator is at its display.
 * @param workspaceRoot - initial chooser directory, not a file authorization.
 * @param signal - request lifetime; abort terminates the native command.
 * @param run - command adapter for deterministic tests.
 * @param platform - host platform for deterministic tests.
 * @returns selected absolute path, or null after cancellation.
 */
export async function pickNativeManuscript(
  workspaceRoot: string,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (platform !== 'darwin') throw new Error('Native manuscript selection requires macOS on the DSH host')
  try {
    const { stdout } = await run('osascript', ['-e', SCRIPT, workspaceRoot], signal)
    const path = stdout.replace(/[\r\n]+$/, '')
    if (!path) throw new Error('Finder returned no manuscript path')
    return path
  } catch (error) {
    if (!signal.aborted && typeof error === 'object' && error !== null
      && 'code' in error && error.code === 1 && 'stderr' in error
      && typeof error.stderr === 'string' && /(?:User canceled|-128)/i.test(error.stderr)) return null
    throw new Error('Finder could not open the Markdown file chooser', { cause: error })
  }
}

/**
 * Choose one existing `.bib` file on the macOS DSH host; the caller confines its path.
 * @param workspaceRoot - initial Finder directory.
 * @param signal - request lifetime; abort terminates the native command.
 * @param run - command adapter for tests.
 * @param platform - host platform for tests.
 * @returns selected absolute path, or null after cancellation.
 */
export async function pickNativeBibliography(
  workspaceRoot: string,
  signal: AbortSignal,
  run: NativeCommandRunner = runNativeCommand,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  if (platform !== 'darwin') throw new Error('Native bibliography selection requires macOS on the DSH host')
  try {
    const { stdout } = await run('osascript', ['-e', BIB_SCRIPT, workspaceRoot], signal)
    const path = stdout.replace(/[\r\n]+$/, '')
    if (!path) throw new Error('Finder returned no BibTeX path')
    return path
  } catch (error) {
    if (!signal.aborted && typeof error === 'object' && error !== null
      && 'code' in error && error.code === 1 && 'stderr' in error
      && typeof error.stderr === 'string' && /(?:User canceled|-128)/i.test(error.stderr)) return null
    throw new Error('Finder could not open the BibTeX file chooser', { cause: error })
  }
}
