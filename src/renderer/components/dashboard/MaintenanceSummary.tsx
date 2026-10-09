// =============================================================================
// MaintenanceSummary — dangling images and volumes a cleanup would remove
// =============================================================================

import { Badge } from '@mantine/core'
import { useConnectionStore } from '../../stores/connectionStore'
import type { MaintenanceReport } from '../../../shared/types'
import { Card, CardOffline } from './cardShared'
import { Skeleton, ErrorState } from '../common/PageState'
interface Props {
  data: MaintenanceReport | null
  error?: Error | null
  onRetry?: () => void
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-white/[0.03] border border-white/5 p-2.5">
      <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${value > 0 ? 'text-amber-400' : 'text-slate-300'}`}>{value}</p>
    </div>
  )
}

export default function MaintenanceSummary({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  if (!isConnected && !data) return <Card card="maintenance" dim><CardOffline /></Card>
  if (!data && error) return <Card card="maintenance"><ErrorState card title="Could not load the cleanup report" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="maintenance"><Skeleton label="Loading the cleanup report…" variant="tiles" rows={2} /></Card>

  const { images, volumes } = data
  const hasDangling = images.dangling > 0 || volumes.dangling > 0

  return (
    <Card
      card="maintenance"
      open="maintenance"
      tone={hasDangling ? 'attention' : undefined}
      badge={hasDangling ? <Badge component="span" color="amber">Cleanup available</Badge> : undefined}
    >
      <div className="grid grid-cols-2 gap-2">
        <Tile label="Dangling images" value={images.dangling} />
        <Tile label="Dangling volumes" value={volumes.dangling} />
      </div>
      <p className="text-[11px] text-slate-500 mt-2">{images.total} images, {volumes.total} volumes in all</p>
    </Card>
  )
}
