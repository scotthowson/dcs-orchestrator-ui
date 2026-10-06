// =============================================================================
// BackupStatusPanel — the Backups page's "Backup status" card: idle with the last
// backup and the last restore (and what did not come back), a running backup with
// its progress and Cancel, an error, a restore under way; on Everywhere, whose
// progress it follows and what the last "back up everything" did on each server.
// =============================================================================

import { Badge } from '@mantine/core'
import { AlertTriangle, CheckCircle, Loader2, RotateCcw, Shield, XCircle } from 'lucide-react'
import Hint from '../common/Hint'
import VmCapsule from '../fleet/VmCapsule'
import { BTN_CARD, TONE_DANGER, TONE_GHOST } from '../../lib/ui'
import { formatDateString, vmLabel } from './format'
import type { ScopeMember } from '../../hooks/useFleetScope'
import type { BackupStatusResponse, BackupTriggerResponse } from '../../../shared/types'
import type { MemberOutcome } from '../../../shared/fleetScopedOps'

const STAGE: Record<string, string> = { copy: 'Copying files', archive: 'Creating archive', cleanup: 'Cleaning up', retention: 'Enforcing retention' }

export default function BackupStatusPanel({
  data, loading, hasFleet, everywhere, member, members, onFollow, onCancel, cancelling, fleetRun, onDismissFleetRun,
}: {
  data: BackupStatusResponse | null
  loading: boolean
  hasFleet: boolean
  /** the page shows Everywhere: the card can follow any server */
  everywhere: boolean
  /** the server the card talks about (null = the hub) */
  member: string | null
  members: ScopeMember[]
  onFollow: (member: string | null) => void
  onCancel: () => void
  cancelling: boolean
  /** the last "back up everything": what every server answered */
  fleetRun: MemberOutcome<BackupTriggerResponse>[] | null
  onDismissFleetRun: () => void
}) {
  const status = data?.status ?? 'idle'
  const m = member ? members.find((x) => x.id === member) : undefined
  const dot = (c: string) => <span className={`w-1.5 h-1.5 rounded-full ${c}`} />

  return (
    <section aria-labelledby="backup-status-title" className="glass rounded-xl border border-white/5 overflow-hidden">
      <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center gap-2">
        <Shield size={16} className="text-slate-400" aria-hidden />
        <h2 id="backup-status-title" className="text-sm font-semibold text-slate-200">Backup status</h2>
        {hasFleet && <VmCapsule member={member} name={m?.name ?? member ?? ''} vmid={m?.vmid ?? null} size="xs" />}
        {hasFleet && everywhere && (
          <div className="ml-auto flex items-center gap-1.5">
            <label htmlFor="backup-follow" className="text-[10px] uppercase tracking-wider text-slate-500 hidden sm:inline">Follow</label>
            <Hint label="Whose progress the status card shows">
              <select
                id="backup-follow"
                aria-label="Follow the progress of"
                value={member ?? ''}
                onChange={(e) => onFollow(e.target.value || null)}
                className="rounded-lg px-2 h-8 text-[11px] bg-white/5 border border-white/10 text-slate-300 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40 cursor-pointer"
              >
                <option value="" className="bg-slate-900">Hub</option>
                {members.map((x) => (
                  <option key={x.id} value={x.id} disabled={!x.reachable} className="bg-slate-900">{vmLabel(x.name, x.vmid)}{x.reachable ? '' : ' (not answering)'}</option>
                ))}
              </select>
            </Hint>
          </div>
        )}
      </div>

      <div className="p-5">
        {/* Idle */}
        {status === 'idle' && (data || !loading) && (
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 shrink-0" aria-hidden>
              <CheckCircle size={24} className="text-emerald-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Badge component="span" color="emerald" leftSection={dot('bg-emerald-400')}>Idle</Badge>
              {data?.last_backup ? (
                <div className="mt-2 space-y-1">
                  <p className="text-sm text-slate-300">
                    Last backup:{' '}
                    <span className="font-mono text-xs text-slate-400 break-all">{data.last_backup.filename}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {data.last_backup.size} &middot; {formatDateString(data.last_backup.timestamp)}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-sm text-slate-500">No backups recorded yet</p>
              )}
              {/* the last restore: what came back, and what did not (it finishes in the background, after the toast) */}
              {data?.last_restore && (
                <div className="mt-3 space-y-1">
                  <p className="text-sm text-slate-300">
                    Last restore:{' '}
                    <span className="font-mono text-xs text-slate-400 break-all">{data.last_restore.filename}</span>
                  </p>
                  <p className="text-xs text-slate-500">
                    {[
                      data.last_restore.stacks ? `${data.last_restore.stacks.length} stack${data.last_restore.stacks.length === 1 ? '' : 's'}` : null,
                      data.last_restore.volumes?.length ? `${data.last_restore.volumes.length} volume${data.last_restore.volumes.length === 1 ? '' : 's'}` : null,
                      data.last_restore.appdata?.length ? `App-Data on a drive: ${data.last_restore.appdata.join(', ')}` : null,
                      formatDateString(data.last_restore.timestamp),
                    ].filter(Boolean).join(' · ')}
                  </p>
                  {(data.last_restore.warnings?.length ?? 0) > 0 && (
                    <div role="alert" className="mt-1 rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
                      <p className="text-xs font-medium text-amber-300 flex items-center gap-1.5"><AlertTriangle size={12} aria-hidden /> Not everything came back</p>
                      <ul className="mt-1.5 space-y-1 text-xs text-amber-200/90 max-h-40 overflow-y-auto">
                        {data.last_restore.warnings!.slice(0, 50).map((w, i) => <li key={i} className="break-words">{w}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Running */}
        {status === 'running' && (
          <div className="space-y-4" role="status">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-500/10 shrink-0" aria-hidden>
                <Loader2 size={24} className="text-cyan-400 animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <Badge component="span" color="cyan" leftSection={dot('bg-cyan-400 animate-pulse')}>Running</Badge>
                {data?.filename && <p className="mt-1.5 text-slate-300 font-mono text-xs break-all">{data.filename}</p>}
                {data?.progress && <p className="text-xs text-slate-500 mt-0.5">{data.progress}</p>}
              </div>
            </div>
            {/* Progress bar — real percentage when available, animated fallback */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-500">{STAGE[data?.stage ?? ''] ?? 'Processing'}</span>
                <span className="text-[10px] font-mono text-cyan-400 tabular-nums">{data?.percent != null ? `${data.percent}%` : ''}</span>
              </div>
              <div className="relative h-2.5 rounded-full bg-slate-800 overflow-hidden">
                {data?.percent != null ? (
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 shadow-lg shadow-cyan-500/20 transition-all duration-700 ease-out"
                    style={{ width: `${Math.max(data.percent, 2)}%` }}
                  />
                ) : (
                  <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 animate-pulse" style={{ width: '45%' }} />
                )}
              </div>
              <button type="button" onClick={onCancel} disabled={cancelling} className={`${BTN_CARD} ${TONE_DANGER} mt-1`}>
                {cancelling ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                Cancel backup
              </button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="flex items-start gap-4" role="alert">
            <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-rose-500/10 shrink-0" aria-hidden>
              <AlertTriangle size={24} className="text-rose-400" />
            </div>
            <div className="flex-1 min-w-0">
              <Badge component="span" color="rose" leftSection={dot('bg-rose-400')}>Error</Badge>
              {/* the list below names every part that is missing: the message itself stays short */}
              <p className={`mt-2 text-sm text-rose-300 break-words ${(data?.warnings?.length ?? 0) > 0 ? 'line-clamp-3' : ''}`} title={data?.error}>{data?.error || 'An error occurred during the last backup'}</p>
              {(data?.warnings?.length ?? 0) > 0 && (
                <ul className="mt-2 space-y-1 text-xs text-amber-200/90 max-h-40 overflow-y-auto">
                  {data!.warnings!.slice(0, 50).map((w, i) => <li key={i} className="font-mono break-words">{w}</li>)}
                </ul>
              )}
            </div>
          </div>
        )}

        {/* Restoring */}
        {status === 'restoring' && (
          <div className="space-y-4" role="status">
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 shrink-0" aria-hidden>
                <RotateCcw size={24} className="text-amber-400 animate-spin" />
              </div>
              <div className="flex-1 min-w-0">
                <Badge component="span" color="amber" leftSection={dot('bg-amber-400 animate-pulse')}>Restoring</Badge>
                {data?.filename && <p className="mt-1.5 text-slate-300 font-mono text-xs break-all">{data.filename}</p>}
                {data?.progress && <p className="text-xs text-slate-500 mt-0.5">{data.progress}</p>}
              </div>
            </div>
            <div className="relative h-2 rounded-full bg-slate-800 overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 animate-pulse" style={{ width: '45%' }} />
            </div>
          </div>
        )}

        {/* Loading placeholder: the shape of the idle line */}
        {loading && !data && (
          <div className="flex items-center gap-4" role="status" aria-label="Reading the backup status">
            <div className="skeleton w-12 h-12 rounded-xl shrink-0" aria-hidden />
            <div className="flex-1 space-y-2" aria-hidden>
              <div className="skeleton h-[18px] w-16 rounded-full" />
              <div className="skeleton h-3.5 w-2/3 rounded" />
              <div className="skeleton h-3 w-1/3 rounded" />
            </div>
          </div>
        )}

        {/* the last "back up everything": one line per server */}
        {fleetRun && everywhere && (
          <div className="mt-4 pt-4 border-t border-white/5">
            <div className="flex items-center justify-between gap-3 mb-2">
              <p className="text-[10px] text-slate-500 uppercase tracking-wider">Back up everything · {fleetRun.filter((o) => o.ok).length} of {fleetRun.length} started</p>
              <button type="button" onClick={onDismissFleetRun} className={`${BTN_CARD} ${TONE_GHOST}`}>Dismiss</button>
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {fleetRun.map((o) => (
                <li key={o.id ?? 'hub'} className="flex items-center gap-1.5 text-[11px]" title={o.ok ? o.value?.filename ?? 'started' : o.error ?? 'failed'}>
                  <VmCapsule member={o.id} name={o.name} vmid={o.vmid} size="xs" onClick={() => onFollow(o.id)} />
                  {o.ok ? <CheckCircle size={11} className="text-emerald-400" aria-label="started" /> : <XCircle size={11} className="text-rose-400" aria-label="failed" />}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  )
}
