/** Finder command behavior without opening a real system dialog. */
import { expect, it, vi } from 'vitest'
import { pickNativeBibliography, pickNativeManuscript } from '../src/native-file-picker.ts'

const signal = new AbortController().signal

it('passes a workspace to Finder and returns the selected path', async () => {
  const run = vi.fn(async () => ({ stdout: '/Users/example/project/draft.md\n', stderr: '' }))
  expect(await pickNativeManuscript('/Users/example/project', signal, run, 'darwin')).toBe('/Users/example/project/draft.md')
  expect(run).toHaveBeenCalledWith('osascript', ['-e', expect.stringContaining('choose file'), '/Users/example/project'], signal)
})

it('treats cancellation as no selection and propagates other failures', async () => {
  const canceled = vi.fn(async () => { throw Object.assign(new Error('canceled'), { code: 1, stderr: 'User canceled. (-128)' }) })
  expect(await pickNativeManuscript('/tmp', signal, canceled, 'darwin')).toBeNull()
  const failed = vi.fn(async () => { throw Object.assign(new Error('failure'), { code: 1, stderr: 'AppleScript failed' }) })
  await expect(pickNativeManuscript('/tmp', signal, failed, 'darwin')).rejects.toThrow('Finder could not open')
  await expect(pickNativeManuscript('/tmp', signal, failed, 'linux')).rejects.toThrow('requires macOS')
})

it('chooses a BibTeX file and preserves cancellation without opening a manuscript', async () => {
  const run = vi.fn(async () => ({ stdout: '/Users/example/project/references/main.bib\n', stderr: '' }))
  expect(await pickNativeBibliography('/Users/example/project', signal, run, 'darwin')).toBe('/Users/example/project/references/main.bib')
  expect(run).toHaveBeenCalledWith('osascript', ['-e', expect.stringContaining('"bib"'), '/Users/example/project'], signal)
  const canceled = vi.fn(async () => { throw Object.assign(new Error('canceled'), { code: 1, stderr: 'User canceled. (-128)' }) })
  expect(await pickNativeBibliography('/tmp', signal, canceled, 'darwin')).toBeNull()
})
