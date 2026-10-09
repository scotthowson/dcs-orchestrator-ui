// =============================================================================
// BackupArchiveTable — the Backups view of "Saved copies": every archive with its
// badges (one stack's, incomplete, checked), Download (the browser saves the
// archive itself, streamed; a VM's streams through the hub), its .sha256, Verify,
// and Restore behind a typed RESTORE. On a hub a restore always acts on the server
// that keeps the file.
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import { Archive, Clock, Download, Loader2, RotateCcw, ShieldCheck } from 'lucide-react'
import Hint from '../common/Hint'
import { EmptyState } from '../common/PageState'
import { useToast } from '../common/Toast'
import VmCapsule from '../fleet/VmCapsule'
import TypedConfirmDialog from './TypedConfirmDialog'
import { BTN_CARD, TONE_DANGER, TONE_QUIET } from '../../lib/ui'
import { backupChecksumScoped, backupDownloadLink, openBackupDownload, restoreBackupScoped, verifyBackupScoped } from '../../api/fleetScopedOps'
import { useAuthStore } from '../../stores/authStore'
import { formatTimestamp, rowKey } from './format'
import type { ScopeMember } from '../../hooks/useFleetScope'
import type { FleetBackupEntry } from '../../../shared/fleetScopedOps'
import type { BackupDownloadLinkResponse } from '../../../shared/types'

import { Pill } from '../common/Pill'
/** a one-time link asked for before the click (pointer over the button, or focus on it): used within a minute */
interface PendingLink { at: number; link: BackupDownloadLinkResponse | null; promise: Promise<BackupDownloadLinkResponse> }
const LINK_FRESH_MS = 60_000

/** a column header of the archives table */
const TH = 'px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

export default function BackupArchiveTable({
  backups, loading, hasFleet, scopeMember, memberName, members, onPickServer, lockedMember, busy, onRestored,
}: {
  backups: FleetBackupEntry[]
  loading: boolean
  hasFleet: boolean
  /** the VM the page shows (null: the hub or Everywhere) */
  scopeMember: string | null
  memberName: string
  members: ScopeMember[]
  /** a row's server capsule: show that server alone */
  onPickServer: (scope: string) => void
  /** the server whose backup or restore is running: its rows cannot be restored now */
  lockedMember: string | null
  busy: boolean
  onRestored: () => void
}) {
  const { addToast } = useToast()
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const [verifying, setVerifying] = useState('')
  const [downloading, setDownloading] = useState('')

  /** the archive's own server: a fleet row says so, a single server's list is the scope's */
  const ownerOf = useCallback((b: FleetBackupEntry) => (b.member !== undefined ? b.member : scopeMember) ?? null, [scopeMember])

  // The link is asked for as the pointer comes over the button (or it takes the focus), so the click itself starts the
  // download: a browser holds back a second download that starts after an await, as an "automatic" one
  const pending = useRef(new Map<string, PendingLink>())
  const prefetch = useCallback((backup: FleetBackupEntry) => {
    const key = rowKey(backup)
    const p = pending.current.get(key)
    if (p && Date.now() - p.at < LINK_FRESH_MS) return
    const entry: PendingLink = { at: Date.now(), link: null, promise: backupDownloadLink(ownerOf(backup), backup.filename) }
    entry.promise.then((l) => { entry.link = l }, () => { if (pending.current.get(key) === entry) pending.current.delete(key) })
    pending.current.set(key, entry)
  }, [ownerOf])

  /** the browser saves the archive itself (a one-time link: nothing of it is held in this page) */
  const download = useCallback(async (backup: FleetBackupEntry) => {
    const key = rowKey(backup)
    const ready = pending.current.get(key)
    pending.current.delete(key)
    setDownloading(key)
    try {
      let link: BackupDownloadLinkResponse
      if (ready?.link && Date.now() - ready.at < LINK_FRESH_MS) {
        link = ready.link
        openBackupDownload(link)
      } else {
        link = await (ready && Date.now() - ready.at < LINK_FRESH_MS ? ready.promise : backupDownloadLink(ownerOf(backup), backup.filename))
        openBackupDownload(link)
      }
      addToast({
        type: 'success',
        duration: 9000,
        message: `Downloading ${backup.filename} (${link.size_human})${link.member ? ` from ${backup.member_name ?? memberName} through the hub` : ''}${link.sha256 ? `. SHA-256 ${link.sha256}` : ''}`,
      })
    } catch (e) {
      addToast({ type: 'error', message: `The download could not start: ${e instanceof Error ? e.message : String(e)}`, duration: 7000 })
    } finally { setDownloading('') }
  }, [addToast, ownerOf, memberName])

  /** its .sha256 beside the download, to check the copy with sha256sum -c */
  const saveChecksum = useCallback(async (backup: FleetBackupEntry) => {
    try {
      const c = await backupChecksumScoped(ownerOf(backup), backup.filename)
      if (!c.checksum_file) { addToast({ type: 'warning', message: `${backup.filename} has no .sha256` }); return }
      const url = URL.createObjectURL(new Blob([c.checksum_file], { type: 'text/plain' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `${backup.filename}.sha256`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (e) {
      addToast({ type: 'error', message: `Could not read its checksum: ${e instanceof Error ? e.message : String(e)}` })
    }
  }, [addToast, ownerOf])
  const [restoreTarget, setRestoreTarget] = useState<FleetBackupEntry | null>(null)
  const [restoring, setRestoring] = useState(false)

  const verify = useCallback(async (backup: FleetBackupEntry) => {
    setVerifying(rowKey(backup))
    try {
      const r = await verifyBackupScoped(backup.member ?? scopeMember ?? null, backup.filename)
      addToast(r.ok
        ? { type: 'success', message: `${backup.filename} is sound: ${r.parts ? `${r.parts} parts, ` : ''}${r.checksum_checked ? 'checksum matches' : 'read to the end (it has no checksum)'}` }
        : { type: 'error', message: `${backup.filename}: ${r.error ?? 'it does not read back'}` })
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'The check failed' })
    } finally { setVerifying('') }
  }, [addToast, scopeMember])

  const restore = useCallback(async () => {
    if (!restoreTarget) return
    // the archive's own server: a fleet row says so, a single server's list is the scope's
    const member = restoreTarget.member !== undefined ? restoreTarget.member : scopeMember
    setRestoring(true)
    addToast({ type: 'info', message: `Restoring from "${restoreTarget.filename}"…`, duration: 3000 })
    try {
      const result = await restoreBackupScoped(member, restoreTarget.filename)
      addToast(result.success
        ? { type: 'success', message: result.message || `Restore from "${restoreTarget.filename}" completed` }
        : { type: 'error', message: result.message || 'The restore failed', duration: 6000 })
    } catch (err) {
      addToast({ type: 'error', message: `The restore failed: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally {
      setRestoring(false)
      setRestoreTarget(null)
      onRestored()
    }
  }, [restoreTarget, addToast, onRestored, scopeMember])

  const targetMember = restoreTarget ? (restoreTarget.member ?? scopeMember) : null

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5">
              <th scope="col" className={`${TH} text-left`}>Filename</th>
              <th scope="col" className={`${TH} text-left hidden sm:table-cell`}>Size</th>
              <th scope="col" className={`${TH} text-left hidden sm:table-cell`}>Date</th>
              <th scope="col" className={`${TH} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03] stagger-children">
            {backups.length === 0 && !loading && (
              <tr>
                <td colSpan={4}>
                  <EmptyState
                    compact
                    icon={<Archive size={28} />}
                    title={`No backup archives found${scopeMember ? ` on the VM ${memberName}` : ''}`}
                    hint="Back up everything or one stack above to make the first archive"
                  />
                </td>
              </tr>
            )}
            {loading && backups.length === 0 && [0, 1, 2].map((i) => (
              <tr key={`sk-${i}`} aria-hidden>
                <td className="px-5 py-3"><div className="skeleton h-3.5 w-56 max-w-full rounded" /></td>
                <td className="px-5 py-3 hidden sm:table-cell"><div className="skeleton h-3.5 w-14 rounded" /></td>
                <td className="px-5 py-3 hidden sm:table-cell"><div className="skeleton h-3.5 w-32 rounded" /></td>
                <td className="px-5 py-3 text-right"><div className="skeleton h-8 w-20 rounded-lg ml-auto" /></td>
              </tr>
            ))}
            {backups.map((backup) => {
              const key = rowKey(backup)
              const onVm = !!(backup.member ?? scopeMember)
              return (
                <tr key={key} className="hover:bg-white/[0.03] transition-colors duration-150">
                  <td className="px-4 sm:px-5 py-3 max-w-0 w-full">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <Archive size={14} className="text-emerald-400/80 shrink-0" aria-hidden />
                      <span className="font-mono text-xs text-slate-200 truncate min-w-0 max-w-full md:max-w-[320px]" title={backup.filename}>
                        {backup.filename}
                      </span>
                      {backup.member !== undefined && <VmCapsule member={backup.member} name={backup.member_name} vmid={backup.vmid} size="xs" onClick={() => onPickServer(backup.member ?? 'hub')} />}
                      {backup.kind === 'stack' && backup.stack && <Pill tone="neutral" title="A backup of one stack">{backup.stack}</Pill>}
                      {backup.complete === false && <Pill tone="attention" title="Something could not be read when it was made: the status above (or its manifest) says what">incomplete</Pill>}
                      {backup.verified && (isAdmin ? (
                        <Hint label="Checked when it was made: save its .sha256, to check a download with sha256sum -c">
                          <button type="button" onClick={() => saveChecksum(backup)} aria-label={`Save the .sha256 of ${backup.filename}`} className="inline-flex items-center rounded p-0.5 text-emerald-400/80 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                            <ShieldCheck size={12} aria-hidden />
                          </button>
                        </Hint>
                      ) : <span className="inline-flex items-center text-emerald-400/80" title="Read back to the end when it was made; a checksum (.sha256) is beside it"><ShieldCheck size={12} aria-label="checked" /></span>)}
                    </div>
                    {/* on a phone the size and the date ride under the name */}
                    <p className="sm:hidden mt-1 text-[11px] text-slate-500">{backup.size} · {formatTimestamp(backup.timestamp)}</p>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell whitespace-nowrap">
                    <span className="text-xs text-slate-400">{backup.size}</span>
                  </td>
                  <td className="px-5 py-3 hidden sm:table-cell">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
                      <Clock size={12} className="text-slate-500" aria-hidden />
                      {formatTimestamp(backup.timestamp)}
                    </div>
                  </td>
                  <td className="px-4 sm:px-5 py-3 text-right whitespace-nowrap">
                    <div className="inline-flex items-center gap-2">
                      {isAdmin && (
                        <Hint label={onVm ? `Download it from ${backup.member_name ?? memberName}, through the hub` : 'Download the archive (the browser saves it, streamed)'}>
                          <span className="inline-flex">
                            <button
                              type="button"
                              disabled={downloading === key}
                              onPointerEnter={() => prefetch(backup)}
                              onFocus={() => prefetch(backup)}
                              onClick={() => download(backup)}
                              aria-label={`Download ${backup.filename}`}
                              className={`${BTN_CARD} ${TONE_QUIET}`}
                            >
                              {downloading === key ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                              <span className="hidden sm:inline">Download</span>
                            </button>
                          </span>
                        </Hint>
                      )}
                      <Hint label="Read it to the end against its checksum and its list of parts, without restoring anything">
                        <span className="inline-flex">
                          <button
                            type="button"
                            disabled={verifying === key}
                            onClick={() => verify(backup)}
                            aria-label={`Check ${backup.filename}`}
                            className={`${BTN_CARD} ${TONE_QUIET}`}
                          >
                            <ShieldCheck size={12} className={verifying === key ? 'animate-pulse' : ''} />
                            <span className="hidden sm:inline">Verify</span>
                          </button>
                        </span>
                      </Hint>
                      <Hint label={onVm ? `Restores on ${backup.member_name ?? memberName}` : hasFleet ? 'Restores on the hub' : 'Restore this backup'}>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={() => setRestoreTarget(backup)}
                            disabled={busy && (backup.member ?? null) === lockedMember}
                            aria-label={`Restore ${backup.filename}`}
                            className={`${BTN_CARD} ${TONE_DANGER}`}
                          >
                            <RotateCcw size={12} />
                            <span className="hidden sm:inline">Restore</span>
                          </button>
                        </span>
                      </Hint>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {restoreTarget && (
        <TypedConfirmDialog
          title="Restore this backup?"
          word="RESTORE"
          confirmLabel="Restore backup"
          warning={<>The stacks it holds are stopped and their files, App-Data and volumes go back to this backup{hasFleet ? targetMember ? ` on the VM ${restoreTarget.member_name ?? memberName}` : ' on the hub' : ''}; they start again afterwards.{restoreTarget.kind === 'stack' ? '' : ' A full backup also brings back the install\'s own state: the root .env, accounts, secrets and settings.'}</>}
          detail="What is there now is set aside first (.data/pre-restore, the newest two are kept), so it can be put back by hand. The archive is checked before anything is touched."
          subjectLabel="Restoring from"
          subject={<>
            <div className="flex items-center gap-2 flex-wrap">
              <Archive size={14} className="text-slate-400 shrink-0" aria-hidden />
              <span className="font-mono text-xs text-slate-200 break-all">{restoreTarget.filename}</span>
              {hasFleet && <VmCapsule member={targetMember} name={restoreTarget.member_name ?? (scopeMember ? memberName : undefined)} vmid={restoreTarget.vmid ?? (scopeMember ? members.find((m) => m.id === scopeMember)?.vmid : null)} size="xs" />}
            </div>
            <p className="text-xs text-slate-500 mt-1">{restoreTarget.size} &middot; {formatTimestamp(restoreTarget.timestamp)}</p>
          </>}
          busy={restoring}
          onConfirm={restore}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </>
  )
}
