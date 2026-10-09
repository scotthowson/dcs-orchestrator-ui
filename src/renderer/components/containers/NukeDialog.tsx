// =============================================================================
// NukeDialog — "Nuke & reinstall": remove a Compose-managed container, empty
// the App-Data folders it owns (they go to App-Data/.trash for a week), drop
// its own named volumes when asked, and create it again from the compose file
// like a first install. Shows exactly what will go before asking for the name.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Bomb, Loader2, FolderX, Database, ShieldCheck, X, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { fetchContainerResetPreviewOn, resetContainerOn } from '../../api/fleetScoped'
import type { ContainerResetPreview, ContainerResetResponse } from '../../../shared/types'
import type { RowMember } from '../../../shared/fleetScoped'
import { useToast } from '../common/Toast'
import ModalOverlay from '../common/ModalOverlay'
import Hint from '../common/Hint'
import { BTN_ICON_SM, BTN_SHEET_DANGER, BTN_SHEET_QUIET, TONE_GHOST } from '../../lib/ui'

import CloseButton from '../common/CloseButton'
// a folder is named from its stack on (Stacks/<stack>/App-Data/…): the row cuts a long path at its end, which is
// the part that tells the folders apart; the whole path is the row's title
function shortPath(p: string): string {
  const i = p.indexOf('/Stacks/')
  return i >= 0 ? p.slice(i + 1) : p
}

interface NukeDialogProps {
  containerName: string
  /** The server the container runs on: a fleet member id rides the hub's proxy; null or undefined = this server */
  member?: RowMember
  memberName?: string
  open: boolean
  onClose: () => void
  /** Called after a successful reinstall so lists and details refresh */
  onDone?: () => void
}

export function NukeDialog({ containerName, member = null, memberName = '', open, onClose, onDone }: NukeDialogProps) {
  const { addToast } = useToast()
  const [preview, setPreview] = useState<ContainerResetPreview | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [typed, setTyped] = useState('')
  const [wipeVolumes, setWipeVolumes] = useState(false)
  const [pull, setPull] = useState(true)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ContainerResetResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(''); setPreview(null); setResult(null); setTyped('')
    try {
      setPreview(await fetchContainerResetPreviewOn(containerName, member))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [containerName, member])

  useEffect(() => { if (open) void load() }, [open, load])

  const go = useCallback(async () => {
    if (typed !== containerName || busy) return
    setBusy(true)
    try {
      const r = await resetContainerOn(containerName, { confirm: containerName, wipe_app_data: true, wipe_volumes: wipeVolumes, pull }, member)
      setResult(r)
      if (r.success) {
        addToast({ type: 'success', message: `${containerName} reinstalled from scratch${member ? ` on VM ${memberName || member}` : ''}` })
        onDone?.()
      } else {
        addToast({ type: 'error', message: r.message || `Reinstall of ${containerName} hit errors`, duration: 8000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 8000 })
    } finally {
      setBusy(false)
    }
  }, [typed, containerName, member, memberName, busy, wipeVolumes, pull, addToast, onDone])

  if (!open) return null
  const canGo = !!preview && typed === containerName && !busy && !result

  // A portal: the page wrapper animates with a transform, which would otherwise pin
  // this fixed overlay to the container card instead of the whole screen
  return createPortal(
    <ModalOverlay onClose={() => { if (!busy) onClose() }} label={`Nuke and reinstall ${containerName}`} className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-slate-950/70 backdrop-blur-sm" onClick={() => !busy && onClose()} />
      <div className="relative w-full sm:max-w-lg max-h-[94vh] flex flex-col rounded-t-3xl sm:rounded-2xl border border-rose-500/20 bg-slate-900/95 shadow-2xl shadow-black/50 overflow-hidden animate-slide-up sm:animate-scale-in" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        <div className="sm:hidden pt-2 flex justify-center"><span className="h-1.5 w-12 rounded-full bg-white/15" /></div>
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400"><Bomb size={18} /></div>
            <div>
              <h3 className="text-sm font-semibold text-slate-200">Nuke &amp; reinstall {containerName}{member && <span className="ml-1.5 text-[11px] font-medium text-violet-200">· VM {memberName || member}</span>}</h3>
              <p className="text-[11px] text-slate-500 mt-0.5">A fresh install{member ? ` inside the VM ${memberName || member}` : ''}: the container and its files go, then it is created again from the compose file.</p>
            </div>
          </div>
          <Hint label="Close"><CloseButton onClick={onClose} disabled={busy} /></Hint>
        </div>

        <div className="px-5 py-4 space-y-4 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {loading && <div role="status" className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={14} className="animate-spin" /> Working out what this container owns…</div>}
          {error && !loading && (
            <div role="alert" className="flex items-start gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-xs text-rose-300"><AlertTriangle size={14} className="mt-0.5 shrink-0" />{error}</div>
          )}
          {preview && !result && (
            <>
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><div className="text-slate-500 uppercase tracking-wider text-[9px]">Stack</div><div className="text-slate-200 font-medium truncate">{preview.stack}</div></div>
                <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><div className="text-slate-500 uppercase tracking-wider text-[9px]">Service</div><div className="text-slate-200 font-medium truncate">{preview.service}</div></div>
                <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2"><div className="text-slate-500 uppercase tracking-wider text-[9px]">Image</div><div className="text-slate-200 font-medium truncate font-mono text-[10px]" title={preview.image}>{preview.image}</div></div>
              </div>

              <div>
                <div className="flex items-center gap-2 text-xs font-semibold text-rose-300 mb-1.5"><FolderX size={13} /> Folders that will be emptied ({preview.app_data.length})</div>
                {preview.app_data.length === 0 ? (
                  <p className="text-[11px] text-slate-500">No App-Data folder is bound into this container; only the container itself is replaced.</p>
                ) : (
                  <ul className="space-y-1">
                    {preview.app_data.map((f) => (
                      <li key={f.path} className="flex items-center justify-between gap-3 rounded-md bg-rose-500/5 border border-rose-500/10 px-2.5 py-1.5">
                        <span className="font-mono text-[11px] text-slate-300 truncate" title={f.path}>{shortPath(f.path)}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">{f.exists ? f.size : 'missing'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="text-[10px] text-slate-500 mt-1.5">Moved to <span className="font-mono">{preview.trash_dir}</span> and kept {preview.trash_keep_days} days, so a mistake can be undone by hand.</p>
              </div>

              {preview.kept_shared.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-emerald-300 mb-1.5"><ShieldCheck size={13} /> Kept: shared with other containers</div>
                  <ul className="space-y-1">
                    {preview.kept_shared.map((f) => (
                      <li key={f.path} className="flex items-center justify-between gap-3 rounded-md bg-emerald-500/5 border border-emerald-500/10 px-2.5 py-1.5">
                        <span className="font-mono text-[11px] text-slate-300 truncate" title={f.path}>{shortPath(f.path)}</span>
                        <span className="text-[10px] text-slate-500 shrink-0">also {f.shared_with}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {(preview.volumes.length > 0 || preview.volumes_shared.length > 0) && (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold text-violet-300 mb-1.5"><Database size={13} /> Named volumes</div>
                  {preview.volumes.length > 0 && (
                    <label className="flex items-start gap-2 rounded-md bg-violet-500/5 border border-violet-500/10 px-2.5 py-2 cursor-pointer">
                      <input type="checkbox" checked={wipeVolumes} onChange={(e) => setWipeVolumes(e.target.checked)} className="mt-0.5 accent-violet-500" />
                      <span className="text-[11px] text-slate-300">Also delete {preview.volumes.length === 1 ? 'its volume' : `its ${preview.volumes.length} volumes`}: <span className="font-mono text-slate-400">{preview.volumes.join(', ')}</span></span>
                    </label>
                  )}
                  {preview.volumes_shared.map((v) => (
                    <p key={v.path} className="text-[10px] text-slate-500 mt-1">Kept: <span className="font-mono">{v.path}</span> is also used by {v.shared_with}.</p>
                  ))}
                </div>
              )}

              <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
                <input type="checkbox" checked={pull} onChange={(e) => setPull(e.target.checked)} className="accent-emerald-500" />
                Pull the latest image first
              </label>

              {preview.previous_resets.length > 0 && (
                <p className="text-[10px] text-slate-500">Earlier reinstalls of this service are still in the trash: {preview.previous_resets.map((p) => p.split('/').pop()).join(', ')}.</p>
              )}

              <div className="pt-1">
                <label htmlFor="nuke-confirm-name" className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5 block">Type <span className="font-mono text-rose-300 normal-case">{containerName}</span> to confirm</label>
                <input
                  id="nuke-confirm-name"
                  type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={containerName} autoFocus spellCheck={false}
                  className="w-full px-3 py-2 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-rose-500/40 focus:ring-1 focus:ring-rose-500/20 transition-colors"
                />
              </div>
            </>
          )}
          {result && (
            <div className={`rounded-lg border px-3 py-3 text-xs ${result.success ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-200' : 'bg-rose-500/10 border-rose-500/20 text-rose-200'}`}>
              <div className="flex items-center gap-2 font-semibold mb-1">{result.success ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}{result.message}</div>
              {/* (a list the API left out of an answer is an empty one, not a crash) */}
              {(result.trashed ?? []).length > 0 && <p className="text-[11px] opacity-80">Old files: <span className="font-mono">{result.trash_dir}</span></p>}
              {(result.volumes_removed ?? []).length > 0 && <p className="text-[11px] opacity-80">Volumes removed: {(result.volumes_removed ?? []).join(', ')}</p>}
              {(result.failed ?? []).length > 0 && <p className="text-[11px] opacity-90 mt-1">Could not handle: {(result.failed ?? []).join(', ')}</p>}
              {!result.success && result.output && <pre className="mt-2 max-h-40 overflow-auto rounded bg-black/30 p-2 text-[10px] text-slate-300 whitespace-pre-wrap">{result.output.trim().split('\n').slice(-12).join('\n')}</pre>}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/5 bg-white/[0.02]">
          <button onClick={onClose} disabled={busy} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none`}>{result ? 'Close' : 'Cancel'}</button>
          {!result && (
            <button onClick={go} disabled={!canGo} className={`${BTN_SHEET_DANGER} flex-1 sm:flex-none disabled:cursor-not-allowed`}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Bomb size={14} />}
              {busy ? 'Reinstalling…' : 'Nuke & reinstall'}
            </button>
          )}
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

export default NukeDialog
