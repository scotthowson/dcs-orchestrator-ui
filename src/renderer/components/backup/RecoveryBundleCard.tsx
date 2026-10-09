// =============================================================================
// RecoveryBundleCard — one encrypted archive that rebuilds this install
// anywhere: make it, download it, keep the passphrase in the secret store,
// restore one, upload one from another box (the file itself, streamed, with its
// progress). A restore stops the stacks whose App-Data the bundle brings back,
// sets their App-Data aside, restores it and starts them again; a stack whose
// containers do not stop is left as it was, and named in red. The card says
// what it stopped and where the old data went (also after a reload: the server
// keeps the last restore's result).
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import { LifeBuoy, Download, Loader2, Upload, RotateCcw, KeyRound, CheckCircle, AlertTriangle, RefreshCw, XCircle } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import Hint from '../common/Hint'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD_QUIET, BTN_ICON_SM, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_DANGER } from '../../lib/ui'
import { apiClient } from '../../api/client'
import { fetchRecovery, createRecoveryBundle, restoreRecoveryBundle, uploadRecoveryBundle, setSecret } from '../../api/endpoints'
import { formatBytes, uploadRecoveryBundleFile, uploadRefusal } from '../../api/fleetScopedOps'
import type { RecoveryBundleEntry, RecoveryLastRestore, RestoreSkippedStack } from '../../../shared/types'

import { FIELD_SM, CHOICE_SM, CHOICE_ON, CHOICE_OFF } from '../../lib/fieldStyles'
/** the warnings of a restore without the ones that name a skipped stack (the red box says those) */
function otherWarnings(warnings: string[], skipped: RestoreSkippedStack[] | undefined): string[] {
  const p = (skipped ?? []).map((x) => `${x.stack} was not restored:`)
  return warnings.filter((w) => !p.some((x) => w.startsWith(x)))
}

/** what a bundle restore did beyond the configuration, in a few words a person reads */
function restoreFacts(r: Pick<RecoveryLastRestore, 'stopped' | 'started' | 'set_aside' | 'kept_before' | 'pruned'>): string[] {
  const out: string[] = []
  const stopped = r.stopped ?? []
  const started = r.started ?? []
  if (stopped.length) out.push(`Stopped ${stopped.join(', ')} for it; started again: ${started.length ? started.join(', ') : 'none'}`)
  const aside = r.set_aside ?? []
  if (aside.length) out.push(`The App-Data that was there is kept: ${aside.map((a) => `${a.stack}${a.part ? `/${a.part}` : ''} in ${a.kept_in}`).join('; ')}`)
  if ((r.pruned ?? []).length) out.push(`Older copies from before a restore removed: ${r.pruned.length}`)
  return out
}

function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => { const r = String(reader.result || ''); resolve(r.includes(',') ? r.slice(r.indexOf(',') + 1) : r) }
    reader.onerror = () => reject(new Error('Could not read the file'))
    reader.readAsDataURL(file)
  })
}

export default function RecoveryBundleCard() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()
  const confirm = useConfirm()
  const { data, refetch } = usePolling(fetchRecovery, 30000, { enabled: isConnected && isAdmin })
  const [passphrase, setPassphrase] = useState('')
  const [storePass, setStorePass] = useState(true)
  const [appData, setAppData] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<RecoveryBundleEntry | null>(null)
  const [restorePass, setRestorePass] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [sent, setSent] = useState<{ sent: number; total: number } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const create = useCallback(async () => {
    if (busy) return
    if (!data?.passphrase_set && passphrase.length < 8) { addToast({ type: 'error', message: 'Choose a passphrase of at least 8 characters' }); return }
    setBusy('create')
    setResult(null)
    try {
      if (passphrase && storePass && !data?.passphrase_set) {
        await setSecret('RECOVERY_PASSPHRASE', passphrase)
      }
      const res = await createRecoveryBundle({ passphrase: passphrase || undefined, include_app_data: Array.from(appData), copy_remote: true })
      setResult(res.message)
      addToast((res.warnings?.length ?? 0) > 0
        ? { type: 'warning', message: `Bundle written (${res.size_human}), but not everything is in it: ${res.warnings!.join('; ')}`, duration: 12000 }
        : { type: 'success', message: `Bundle written (${res.size_human})` })
      setPassphrase('')
      refetch()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not write the bundle' })
    } finally {
      setBusy(null)
    }
  }, [busy, data, passphrase, storePass, appData, addToast, refetch])

  const download = useCallback(async (entry: RecoveryBundleEntry) => {
    setBusy(`dl:${entry.file}`)
    try {
      const token = apiClient.getAuthToken()
      const res = await fetch(`${apiClient.getBaseUrl()}/recovery/${encodeURIComponent(entry.file)}/download`, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      if (!res.ok) throw new Error(`The download failed (${res.status})`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = entry.file
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The download failed' })
    } finally {
      setBusy(null)
    }
  }, [addToast])

  const upload = useCallback(async (file: File | null) => {
    if (!file) return
    if (file.size === 0) { addToast({ type: 'error', message: `${file.name} is empty` }); return }
    // a server that streams bundles says its limit and room (4.0.35); an older one takes the bundle as JSON (128 MB)
    const refusal = uploadRefusal(file, data ? data.upload : null, 'this server', 'a bundle')
    if (refusal) { addToast({ type: 'error', duration: 12000, message: refusal }); return }
    setBusy('upload')
    setSent({ sent: 0, total: file.size })
    try {
      const res = data?.upload
        ? await uploadRecoveryBundleFile(file, (n, total) => setSent({ sent: n, total }))
        : await uploadRecoveryBundle(file.name, await readAsBase64(file))
      addToast({ type: 'success', message: `Uploaded ${res.file} (${formatBytes(res.size)})` })
      refetch()
    } catch (err) {
      addToast({ type: 'error', duration: 15000, message: `${file.name} was not uploaded: ${err instanceof Error ? err.message : 'the upload failed'}` })
    } finally {
      setBusy(null)
      setSent(null)
    }
  }, [addToast, refetch, data])

  const restore = useCallback(async () => {
    if (!restoreTarget || busy) return
    if (!(await confirm({ title: 'Restore this bundle?', message: `Restore ${restoreTarget.file}?\n\nThe configuration on this server is replaced (a pre-restore snapshot is kept under .snapshots). The stacks whose App-Data the bundle holds are stopped; their App-Data as it is now is set aside whole (in .data/pre-restore, or beside a drive's App-Data as <path>.before-restore-<time>), so nothing old and new is mixed and it can be put back; then the bundle's copy goes in its place and the stacks that ran start again. A stack whose containers do not stop keeps its App-Data as it is.`, confirmLabel: 'Restore', danger: true }))) return
    setBusy('restore')
    try {
      const res = await restoreRecoveryBundle(restoreTarget.file, restorePass, true)
      setResult(res.message)
      refetch()
      // what did not come back (a stack whose containers did not stop, a drive folder that is not there, App-Data it
      // could not write) is said, not hidden: a skipped stack in red
      const skipped = (res.skipped?.length ?? 0) > 0
      addToast({ type: skipped ? 'error' : (res.warnings?.length ?? 0) > 0 ? 'warning' : 'success', message: res.message, duration: skipped ? 20000 : (res.warnings?.length ?? 0) > 0 ? 15000 : 8000 })
      setRestoreTarget(null)
      setRestorePass('')
      if (res.restart_scheduled) setTimeout(() => window.location.reload(), 8000)
    } catch (err) {
      // a dropped connection (its proxy can be one of the stacks it stops) does not stop the restore: the card shows its result once it is in
      addToast({ type: 'error', duration: 12000, message: `${err instanceof Error ? err.message : 'The restore failed'}. If the connection dropped, the restore still runs to the end: its result shows under "Last restore" here` })
      refetch()
    } finally {
      setBusy(null)
    }
  }, [restoreTarget, restorePass, busy, addToast, confirm, refetch])

  if (!isAdmin) return null

  return (
    <section aria-labelledby="recovery-bundle-title" className="glass rounded-xl border border-white/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex items-center gap-2">
        <LifeBuoy size={16} className="text-slate-400" aria-hidden />
        <h2 id="recovery-bundle-title" className="text-sm font-semibold text-slate-200">Recovery bundle</h2>
        <span className="text-[10px] text-slate-500 ml-1 hidden sm:inline">rebuilds this install anywhere</span>
        <Hint label="Refresh the list">
          <button type="button" onClick={() => refetch()} aria-label="Refresh the list of bundles" className={`${BTN_ICON_SM} ${TONE_GHOST} ml-auto`}>
            <RefreshCw size={13} />
          </button>
        </Hint>
      </div>
      <div className="p-5 space-y-4">
        <p className="text-xs text-slate-400 leading-relaxed">
          One encrypted archive with the root <code className="font-mono bg-white/5 px-1 rounded">.env</code>, the secret store and its key, accounts, rules, layouts, schedules, every stack&apos;s files, Traefik and Authelia data, templates and plugins. Keep a copy off this box; the setup wizard of a fresh install restores it in one step.
        </p>

        {data && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="glass border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Destination</p>
              <p className="text-xs font-mono text-slate-300 truncate mt-1" title={data.dest_dir}>{data.dest_dir}</p>
            </div>
            <div className="glass border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Off-box copy</p>
              <p className="text-xs font-mono text-slate-300 truncate mt-1" title={data.remote || 'not set'}>{data.remote || <span className="text-slate-500">not set ({pageLabel('config')} → Recovery bundle)</span>}</p>
            </div>
            <div className="glass border border-white/5 rounded-lg p-3">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Passphrase</p>
              <p className="text-xs mt-1 flex items-center gap-1.5">{data.passphrase_set ? <><CheckCircle size={12} className="text-emerald-400" /><span className="text-emerald-300">stored (schedules can run)</span></> : <><AlertTriangle size={12} className="text-amber-400" /><span className="text-amber-300">not stored yet</span></>}</p>
            </div>
          </div>
        )}

        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <KeyRound size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
              <input
                type="password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                aria-label="Passphrase for the bundle"
                placeholder={data?.passphrase_set ? 'Stored passphrase is used (type one to override)' : 'Passphrase for the bundle (8+ characters)'}
                autoComplete="new-password"
                className={`w-full ${FIELD_SM} !pl-9`}
              />
            </div>
            <button
              type="button"
              onClick={create}
              disabled={busy !== null || (!data?.passphrase_set && passphrase.length < 8)}
              className={`${BTN_TOOLBAR} ${TONE_OK} justify-center`}
            >
              {busy === 'create' ? <Loader2 size={14} className="animate-spin" /> : <LifeBuoy size={14} />}
              {busy === 'create' ? 'Writing…' : 'Create bundle now'}
            </button>
          </div>
          {!data?.passphrase_set && (
            <label className="flex items-center gap-2 text-[10px] text-slate-400 cursor-pointer">
              <input type="checkbox" checked={storePass} onChange={(e) => setStorePass(e.target.checked)} className="accent-emerald-500" />
              Store it as the secret RECOVERY_PASSPHRASE so a schedule can make bundles on its own
            </label>
          )}
          {data && data.stacks.length > 0 && (
            <div>
              <p className="text-[10px] text-slate-500 mb-1.5">Include App-Data (container data) of these stacks — large, slow, but complete:</p>
              <div className="flex flex-wrap gap-1.5">
                {data.stacks.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-pressed={appData.has(s)}
                    onClick={() => setAppData((prev) => { const n = new Set(prev); if (n.has(s)) n.delete(s); else n.add(s); return n })}
                    className={`${CHOICE_SM} font-mono ${appData.has(s) ? CHOICE_ON : CHOICE_OFF}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
          {result && <p role="status" className="text-[11px] text-emerald-300">{result}</p>}
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Bundles on this box{data ? ` (${data.bundles.length}, keeps ${data.retention})` : ''}</p>
            <Hint label={sent
              ? (sent.sent >= sent.total ? 'Sent: the server is storing it' : `Sent ${formatBytes(sent.sent)} of ${formatBytes(sent.total)}`)
              : `Put a bundle made on another box here${data?.upload ? ` (up to ${formatBytes(data.upload.max_bytes)}${data.upload.free_bytes !== null ? `, ${formatBytes(data.upload.free_bytes)} free` : ''})` : ''}`}>
              <span className="inline-flex">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy !== null} aria-label={sent ? `Uploading the bundle, ${sent.total ? Math.floor((sent.sent / sent.total) * 100) : 0}%` : 'Upload a bundle'} className={`${BTN_CARD_QUIET} relative overflow-hidden`}>
                  {busy === 'upload' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                  {sent && data?.upload
                    ? <span className="tabular-nums">{sent.sent >= sent.total ? 'Storing…' : `Uploading ${sent.total ? Math.floor((sent.sent / sent.total) * 100) : 0}%`}</span>
                    : <span>Upload a bundle</span>}
                  {sent && data?.upload && <span aria-hidden className="absolute left-0 bottom-0 h-0.5 bg-emerald-400 transition-[width] duration-300" style={{ width: `${sent.total ? Math.min(100, (sent.sent / sent.total) * 100) : 0}%` }} />}
                </button>
              </span>
            </Hint>
            <input ref={fileRef} type="file" accept=".enc,application/octet-stream" className="hidden" onChange={(e) => { upload(e.target.files?.[0] ?? null); e.target.value = '' }} />
          </div>
          {data && data.bundles.length === 0 && <p className="text-xs text-slate-500">No bundle yet.</p>}
          <div className="space-y-1.5">
            {data?.bundles.map((b) => (
              <div key={b.file} className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-slate-200 truncate" title={b.file}>{b.file}</p>
                  <p className="text-[10px] text-slate-500">{b.size_human}{b.created ? ` · ${new Date(b.created).toLocaleString()}` : ''}{b.checksum ? ' · sha256' : ''}</p>
                </div>
                <Hint label="Download">
                  <button type="button" onClick={() => download(b)} disabled={busy !== null} aria-label={`Download ${b.file}`} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                    {busy === `dl:${b.file}` ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
                  </button>
                </Hint>
                <Hint label="Restore this bundle here">
                  <button type="button" onClick={() => { setRestoreTarget(b); setRestorePass('') }} disabled={busy !== null} aria-label={`Restore ${b.file} here`} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}>
                    <RotateCcw size={13} />
                  </button>
                </Hint>
              </div>
            ))}
          </div>
        </div>

        {data?.last_restore && (
          <div role="status" className={`rounded-lg border px-3 py-2.5 space-y-1 ${(data.last_restore.skipped?.length ?? 0) > 0 ? 'border-rose-500/25 bg-rose-500/[0.05]' : data.last_restore.ok && data.last_restore.warnings.length === 0 ? 'border-white/5 bg-white/[0.02]' : 'border-amber-500/20 bg-amber-500/[0.05]'}`}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider">Last restore</p>
            <p className="text-xs text-slate-300">
              <span className="font-mono">{data.last_restore.file}</span>
              {data.last_restore.finished_at ? ` · ${new Date(data.last_restore.finished_at).toLocaleString()}` : ''}
              {data.last_restore.ok ? ` · ${data.last_restore.stacks} stacks, ${data.last_restore.users} accounts${data.last_restore.app_data.length ? `, App-Data of ${data.last_restore.app_data.join(', ')}` : ''}` : ` · refused: ${data.last_restore.error ?? 'it failed'}`}
            </p>
            {(data.last_restore.skipped ?? []).map((x) => (
              <p key={x.stack} role="alert" className="text-[11px] text-rose-300 break-words flex items-start gap-1.5">
                <XCircle size={12} className="mt-0.5 shrink-0" aria-hidden />
                <span><span className="font-semibold">{x.stack} was not restored</span>: {x.reason}. Its App-Data is as it was and it was not started: stop it on the Stacks page, then restore the bundle again.</span>
              </p>
            ))}
            {data.last_restore.ok && restoreFacts(data.last_restore).map((f) => <p key={f} className="text-[11px] text-slate-400 break-words">{f}</p>)}
            {otherWarnings(data.last_restore.warnings, data.last_restore.skipped).map((w) => <p key={w} className="text-[11px] text-amber-300 break-words">Not done: {w}</p>)}
          </div>
        )}

        {restoreTarget && (
          <div className="rounded-lg border border-rose-500/20 bg-rose-500/[0.05] p-4 space-y-3 animate-fade-in">
            <p className="text-xs text-rose-200">Restore <span className="font-mono">{restoreTarget.file}</span> on this server. Settings, accounts, secrets and stack files are replaced (a pre-restore snapshot is kept). The stacks whose App-Data it holds are stopped, their App-Data is set aside whole (.data/pre-restore, or <span className="font-mono">&lt;path&gt;.before-restore-&lt;time&gt;</span> on a drive) and replaced by the bundle&apos;s, and the ones that ran start again.</p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="password"
                value={restorePass}
                onChange={(e) => setRestorePass(e.target.value)}
                aria-label="Passphrase of this bundle"
                placeholder={data?.passphrase_set ? 'Passphrase (stored one is used when empty)' : 'Passphrase of this bundle'}
                autoComplete="off"
                className={`${FIELD_SM} flex-1`}
              />
              <button type="button" onClick={restore} disabled={busy !== null || (!data?.passphrase_set && !restorePass)} className={`${BTN_TOOLBAR} ${TONE_DANGER} justify-center`}>
                {busy === 'restore' ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                Restore
              </button>
              <button type="button" onClick={() => setRestoreTarget(null)} className={`${BTN_TOOLBAR_QUIET} justify-center`}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
