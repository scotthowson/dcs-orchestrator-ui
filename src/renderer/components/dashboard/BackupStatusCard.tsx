// =============================================================================
// BackupStatusCard — is a backup running, and when the last one was made
// =============================================================================

import { Archive, Lock } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import { pageLabel } from '../../constants/pageTitles'
import type { BackupStatusResponse } from '../../../shared/types'
import { Card, CardOffline } from './cardShared'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
import { Pill } from '../common/Pill'
import { type Tone } from '../../lib/tone'
/** idle is fine, a backup in progress is information, a failed one is a problem */
function statusChip(status: string): { tone: Tone; label: string } {
  switch (status) {
    case 'running': return { tone: 'info', label: 'Running' }
    case 'restoring': return { tone: 'info', label: 'Restoring' }
    case 'error': return { tone: 'problem', label: 'Error' }
    case 'idle': return { tone: 'ok', label: 'Idle' }
    default: return { tone: 'ok', label: status ? status.charAt(0).toUpperCase() + status.slice(1) : 'Idle' }
  }
}

interface Props {
  data: BackupStatusResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function BackupStatusCard({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'

  // the backup status is an admin's (the server answers 403 to anyone else, and the dashboard does not ask)
  if (!isAdmin) return <Card card="backup-status"><EmptyState card icon={<Lock size={22} />} title="For admins" hint="An admin account makes and checks the backups." /></Card>
  if (!isConnected && !data) return <Card card="backup-status" dim><CardOffline /></Card>
  if (!data && error) return <Card card="backup-status"><ErrorState card title="Could not load the backup status" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="backup-status"><Skeleton label="Loading the backup status…" rows={2} /></Card>

  const { status, last_backup, progress } = data
  const chip = statusChip(status)

  return (
    <Card card="backup-status" badge={<Pill tone={chip.tone}>{chip.label}</Pill>} open="backup" tone={status === 'error' ? 'problem' : undefined}>
      {status === 'running' && progress && (
        <div className="mb-3">
          <div className="h-1.5 w-full rounded-full bg-slate-800/60 overflow-hidden">
            <div className="h-full bg-cyan-500 rounded-full transition-all duration-500 animate-pulse" style={{ width: '60%' }} />
          </div>
          <p className="text-[11px] text-cyan-400 mt-1">{progress}</p>
        </div>
      )}
      {last_backup ? (
        <div className="space-y-1 min-w-0">
          <p className="text-xs text-slate-200 font-mono truncate" title={last_backup.filename}>{last_backup.filename}</p>
          <div className="flex items-center gap-3 text-[11px] text-slate-500">
            <span>{last_backup.size}</span>
            <span>{last_backup.timestamp}</span>
          </div>
        </div>
      ) : (
        <EmptyState card icon={<Archive size={22} />} title="No backups yet" hint={`Make one on the ${pageLabel('backup')} page.`} />
      )}
    </Card>
  )
}
