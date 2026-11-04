import { useEffect, useState } from 'react'
import type { ProjectRpc } from './project-panel.tsx'
import type { PluginUpdateView } from '../update-types.ts'

export function PluginUpdates({ rpc }: { rpc: ProjectRpc }) {
  const [view, setView] = useState<PluginUpdateView>()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open) return
    const abort = new AbortController()
    const read = async () => {
      try { const value = await rpc.call('paper-review/update', {}, abort.signal); if (!abort.signal.aborted) { setView(value as PluginUpdateView); setError('') } }
      catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    }
    void read()
    const timer = setInterval(() => { void read() }, 5000)
    return () => { abort.abort(); clearInterval(timer) }
  }, [rpc, open])
  const change = async (enabled: boolean) => {
    setBusy(true); setError('')
    try { setView(await rpc.call('paper-review/update', { enabled }) as PluginUpdateView) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }
  const status = { disabled: '已关闭', ready: '等待检查', checking: '正在检查新版', waiting: '新版已准备好，退出 DSH 后安装',
    installed: '已安装新版，下次启动生效', failed: '更新未完成，已保留原版；下次检查会重试', unsupported: '此安装方式暂不支持自动更新' }
  return <details style={{ padding: '6px 12px', fontSize: 12 }} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>插件更新</summary>
    {view && <div>
      <label><input type="checkbox" checked={view.enabled} disabled={!view.supported || busy}
        onChange={event => { void change(event.currentTarget.checked) }} /> 自动更新文章审阅插件</label>
      <p>开启一次后，插件在启动时及每 6 小时检查新版；退出 DSH 后安装，下次启动生效。支持 Windows、macOS 和 Linux。</p>
      <p role="status">当前版本 {view.runningVersion} · {status[view.phase]}{view.availableVersion ? ` · ${view.availableVersion}` : ''}</p>
    </div>}
    {error && <p role="alert">{error}</p>}
  </details>
}
