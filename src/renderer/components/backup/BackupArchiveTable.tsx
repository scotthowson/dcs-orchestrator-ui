// =============================================================================
// BackupArchiveTable — the Backups view of "Saved copies": every archive with its
// badges (one stack's, incomplete, checked), Verify, and Restore behind a typed
// RESTORE. On a hub a restore always acts on the server that keeps the file.
// =============================================================================

import { useCallback, useState } from 'react'
import { Badge } from '@mantine/core'
import { Archive, Clock, Info, RotateCcw, ShieldCheck } from 'lucide-react'
import Hint from '../common/Hint'
import { EmptyState } from '../common/PageState'
import { useToast } from '../common/Toast'
import VmCapsule from '../fleet/VmCapsule'
import TypedConfirmDialog from './TypedConfirmDialog'
import { BTN_CARD, TONE_DANGER, TONE_QUIET } from '../../lib/ui'
import { restoreBackupScoped, verifyBackupScoped } from '../../api/fleetScopedOps'
import { formatTimestamp, rowKey } from './format'
import type { ScopeMember } from '../../hooks/useFleetScope'
import type { FleetBackupEntry } from '../../../shared/fleetScopedOps'

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
  const [verifying, setVerifying] = useState('')
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
                    icon={<Archive size={32} />}
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
                      {backup.kind === 'stack' && backup.stack && <Badge component="span" color="slate" title="A backup of one stack">{backup.stack}</Badge>}
                      {backup.complete === false && <Badge component="span" color="amber" title="Something could not be read when it was made: the status above (or its manifest) says what">incomplete</Badge>}
                      {backup.verified && <span className="inline-flex items-center text-emerald-400/80" title="Read back to the end when it was made; a checksum (.sha256) is beside it"><ShieldCheck size={12} aria-label="checked" /></span>}
                    </div>
                    {/* on a phone the size and the date ride under the name */}
                    <p className="sm:hidden mt-1 text-[11px] text-slate-500">{backup.size} · {formatTimestamp(backup.timestamp)}</p>
                    {onVm && (
                      <p className="mt-1 text-[10px] text-slate-500 flex items-center gap-1" title="The hub's proxy carries JSON, not files: copy the archive over ssh from that VM's BACKUP_DEST_DIR">
                        <Info size={10} aria-hidden /> stays on the VM&apos;s disk
                      </p>
                    )}
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
          title="Confirm restore"
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
