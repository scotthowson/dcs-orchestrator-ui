// =============================================================================
// SnapshotList — the Snapshots view of "Saved copies": every configuration
// snapshot with its label, the host and DCS version that took it, its age and
// size; Download (the hub's own files), Restore behind a typed RESTORE, Delete.
// =============================================================================

import { useCallback, useState } from 'react'
import { Camera, Clock, Download, HardDrive, Info, Loader2, RotateCw, Server, Trash2 } from 'lucide-react'
import Hint from '../common/Hint'
import { EmptyState } from '../common/PageState'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import VmCapsule from '../fleet/VmCapsule'
import TypedConfirmDialog from './TypedConfirmDialog'
import { BTN_CARD, TONE_DANGER, TONE_QUIET } from '../../lib/ui'
import { apiClient } from '../../api/client'
import { deleteSnapshot, restoreSnapshot } from '../../api/endpoints'
import { formatSnapshotDate, relativeTime, rowKey } from './format'
import type { SnapshotEntry, SnapshotRestoreResponse } from '../../../shared/types'

import { Pill } from '../common/Pill'
/** what the server says after a snapshot restore, beyond the shared type: which stacks came back, which were refused */
type RestoreAnswer = SnapshotRestoreResponse & { before?: string; restored_stacks?: string[]; skipped_stacks?: string[]; push_failed?: string[] }

/** the DCS version a snapshot was taken on, as the manifest has it ("4.0.4" → "v4.0.4"; '' on an archive without one) */
function snapshotVersion(s: SnapshotEntry): string {
  const v = (s.dcs_version ?? '').trim()
  return v ? (v.startsWith('v') ? v : `v${v}`) : ''
}

/** the toast after a restore: what came back, what did not, and what still needs a hand */
function restoreToast(r: RestoreAnswer, filename: string): { type: 'success' | 'warning'; message: string } {
  const n = r.restored_stacks?.length
  const refused = [...(r.skipped_stacks ?? []), ...(r.push_failed ?? [])]
  const parts = [
    `Restored ${filename}${n != null ? ` (${n} stack${n === 1 ? '' : 's'})` : ''}.`,
    'Deploy a stack again to run its restored files; the root .env and the accounts were left as they are.',
    r.before ? `The state before is the snapshot ${r.before}.` : '',
    refused.length ? `Not restored: ${refused.join(' · ')}` : '',
  ]
  return { type: refused.length ? 'warning' : 'success', message: parts.filter(Boolean).join(' ') }
}

export default function SnapshotList({
  snapshots, loading, hasFleet, scopeMember, memberName, onChanged,
}: {
  snapshots: SnapshotEntry[]
  loading: boolean
  hasFleet: boolean
  /** the VM the page shows (null: the hub or Everywhere) */
  scopeMember: string | null
  memberName: string
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [restoreTarget, setRestoreTarget] = useState<SnapshotEntry | null>(null)
  const [restoring, setRestoring] = useState(false)

  /** the hub's own file, through the browser (the hub's proxy carries JSON, not a VM's files) */
  const download = useCallback(async (snapshot: SnapshotEntry) => {
    setDownloading(rowKey(snapshot))
    try {
      await apiClient.download(`/snapshots/${encodeURIComponent(snapshot.filename)}/download`, snapshot.filename)
      addToast({ type: 'success', message: `Downloaded ${snapshot.filename}` })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The download failed' })
    } finally {
      setDownloading(null)
    }
  }, [addToast])

  const restore = useCallback(async () => {
    if (!restoreTarget) return
    setRestoring(true)
    addToast({ type: 'info', message: `Restoring from "${restoreTarget.filename}"…`, duration: 3000 })
    try {
      const result = await restoreSnapshot(restoreTarget.filename, restoreTarget.member ?? scopeMember) as RestoreAnswer
      if (result.success) {
        const t = restoreToast(result, restoreTarget.filename)
        addToast({ ...t, duration: 12000 })
      } else {
        addToast({ type: 'error', message: result.message || 'The restore failed', duration: 6000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: `The restore failed: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally {
      setRestoring(false)
      setRestoreTarget(null)
      onChanged()
    }
  }, [restoreTarget, addToast, onChanged, scopeMember])

  /** ask first (the shared confirmation, focus on Cancel), then remove the file on the server that keeps it */
  const remove = useCallback(async (snapshot: SnapshotEntry) => {
    const onVm = snapshot.member ?? scopeMember
    const ok = await confirm({
      title: 'Delete this snapshot?',
      message: `${snapshot.filename} is removed from ${onVm ? `the VM ${snapshot.member_name ?? memberName}` : 'the server'}. This cannot be undone.`,
      confirmLabel: 'Delete snapshot',
      danger: true,
    })
    if (!ok) return
    setDeleting(rowKey(snapshot))
    try {
      const result = await deleteSnapshot(snapshot.filename, onVm)
      addToast(result.success
        ? { type: 'success', message: `Snapshot "${snapshot.filename}" deleted` }
        : { type: 'error', message: 'Could not delete the snapshot', duration: 6000 })
    } catch (err) {
      addToast({ type: 'error', message: `The delete failed: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally {
      setDeleting(null)
      onChanged()
    }
  }, [confirm, addToast, onChanged, scopeMember, memberName])

  const locked = restoreTarget !== null || deleting !== null
  const label = (text: string) => <span className="hidden sm:inline">{text}</span>

  if (loading && snapshots.length === 0) {
    return (
      <div className="divide-y divide-white/[0.03]" role="status" aria-label="Reading the snapshots">
        {[0, 1].map((i) => (
          <div key={i} className="px-5 py-4 space-y-3" aria-hidden>
            <div className="skeleton h-3.5 w-64 max-w-full rounded" />
            <div className="skeleton h-3 w-40 rounded" />
          </div>
        ))}
      </div>
    )
  }

  if (snapshots.length === 0) {
    return (
      <EmptyState
        compact
        icon={<Camera size={28} />}
        title={`No snapshots yet${scopeMember ? ` on the VM ${memberName}` : ''}`}
        hint="Take a config snapshot above before you change something: it takes seconds."
      />
    )
  }

  return (
    <>
      <ul className="divide-y divide-white/[0.03] stagger-children">
        {snapshots.map((snapshot) => {
          const key = rowKey(snapshot)
          const version = snapshotVersion(snapshot)
          const onVm = !!(snapshot.member ?? scopeMember)
          return (
            <li key={key} className="px-4 sm:px-5 py-3.5 hover:bg-white/[0.03] transition-colors duration-150 flex flex-col sm:flex-row sm:items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <Camera size={14} className="text-cyan-400/80 shrink-0" aria-hidden />
                  <span className="font-mono text-xs text-slate-200 truncate min-w-0 max-w-full" title={snapshot.filename}>{snapshot.filename}</span>
                  {snapshot.member !== undefined && <VmCapsule member={snapshot.member} name={snapshot.member_name} vmid={snapshot.vmid} size="xs" />}
                  {snapshot.hostname && <Pill tone="neutral" icon={<Server size={10} aria-hidden />} title="The machine it was taken on">{snapshot.hostname}</Pill>}
                  {version && <Pill tone="neutral" title="The DCS version it was taken on">{version}</Pill>}
                </div>
                {snapshot.label
                  ? <p className="text-sm text-slate-300 mt-1 break-words">{snapshot.label}</p>
                  : <p className="text-xs text-slate-500 mt-1 italic">no label</p>}
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1.5 text-xs text-slate-500">
                  <span className="flex items-center gap-1.5" title={formatSnapshotDate(snapshot.timestamp, snapshot.epoch)}>
                    <Clock size={12} aria-hidden />
                    {relativeTime(snapshot.timestamp, snapshot.epoch)}
                  </span>
                  <span className="flex items-center gap-1.5"><HardDrive size={12} aria-hidden />{snapshot.size}</span>
                  <span className="hidden md:inline">{formatSnapshotDate(snapshot.timestamp, snapshot.epoch)}</span>
                  {onVm && (
                    <span className="flex items-center gap-1 text-[10px]" title="The hub's proxy carries JSON, not files: download it from that VM's own dashboard, or over ssh from ~/.Docker-Compose-Skeleton-AIO/.snapshots">
                      <Info size={10} aria-hidden /> stays on the VM&apos;s disk
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {!onVm && (
                  <Hint label="Download the archive">
                    <span className="inline-flex">
                      <button
                        type="button"
                        onClick={() => download(snapshot)}
                        disabled={downloading === key}
                        aria-label={`Download ${snapshot.filename}`}
                        className={`${BTN_CARD} ${TONE_QUIET}`}
                      >
                        {downloading === key ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                        {label(downloading === key ? 'Downloading' : 'Download')}
                      </button>
                    </span>
                  </Hint>
                )}
                <Hint label={onVm ? `Restores on ${snapshot.member_name ?? memberName}` : hasFleet ? 'Restores on the hub' : 'Restore this snapshot'}>
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => setRestoreTarget(snapshot)}
                      disabled={locked}
                      aria-label={`Restore ${snapshot.filename}`}
                      className={`${BTN_CARD} ${TONE_DANGER}`}
                    >
                      <RotateCw size={12} />
                      {label('Restore')}
                    </button>
                  </span>
                </Hint>
                <Hint label="Delete the snapshot">
                  <span className="inline-flex">
                    <button
                      type="button"
                      onClick={() => remove(snapshot)}
                      disabled={locked}
                      aria-label={`Delete ${snapshot.filename}`}
                      className={`${BTN_CARD} ${TONE_DANGER}`}
                    >
                      {deleting === key ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                      {label('Delete')}
                    </button>
                  </span>
                </Hint>
              </div>
            </li>
          )
        })}
      </ul>

      {restoreTarget && (
        <TypedConfirmDialog
          title="Restore this snapshot?"
          word="RESTORE"
          confirmLabel="Restore snapshot"
          warning={<>The configuration{hasFleet ? (restoreTarget.member ?? scopeMember) ? ` on the VM ${restoreTarget.member_name ?? memberName}` : ' on the hub' : ''} goes back to this snapshot: every stack&apos;s files (a stack in a VM gets them there too), settings, alert and automation rules, schedules, Traefik routes and templates. No data is touched and no stack is stopped or started.</>}
          detail="The state as it is now is kept as a snapshot of its own first, so this can be undone. The root .env is not replaced (the snapshot's copy is put beside it as .env.restored) and accounts, secrets and sign-in state stay as they are. A stack whose compose file fails the security check is skipped."
          subjectLabel="Restoring from"
          subject={<>
            <div className="flex items-center gap-2 flex-wrap">
              <Camera size={14} className="text-slate-400 shrink-0" aria-hidden />
              <span className="font-mono text-xs text-slate-200 break-all">{restoreTarget.filename}</span>
              {restoreTarget.member !== undefined && <VmCapsule member={restoreTarget.member} name={restoreTarget.member_name} vmid={restoreTarget.vmid} size="xs" />}
            </div>
            {restoreTarget.label && <p className="text-xs text-slate-300 mt-1">{restoreTarget.label}</p>}
            <p className="text-xs text-slate-500 mt-1">{restoreTarget.size} &middot; {formatSnapshotDate(restoreTarget.timestamp, restoreTarget.epoch)}</p>
          </>}
          busy={restoring}
          onConfirm={restore}
          onClose={() => setRestoreTarget(null)}
        />
      )}
    </>
  )
}
