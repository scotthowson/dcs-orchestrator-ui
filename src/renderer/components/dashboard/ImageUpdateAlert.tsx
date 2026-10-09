// =============================================================================
// ImageUpdateAlert — how fresh the images are: current, aging, stale
// =============================================================================

import { ArrowUpCircle } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import type { ImageCheckResponse } from '../../../shared/types'
import { Card, CardOffline } from './cardShared'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
interface Props {
  data: ImageCheckResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function ImageUpdateAlert({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  // the registry check is an admin's: anyone else sees the ages, and says so, rather than a verdict nobody asked for
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'

  if (!isConnected && !data) return <Card card="image-updates" dim><CardOffline /></Card>
  if (!data && error) return <Card card="image-updates"><ErrorState card title="Could not check the images" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="image-updates"><Skeleton label="Checking the images…" rows={2} /></Card>

  const { current, aging, stale, total } = data

  return (
    <Card card="image-updates" meta={`${total} image${total === 1 ? '' : 's'}`} open="updates" tone={stale > 0 ? 'attention' : undefined}>
      {total === 0 ? (
        <EmptyState card icon={<ArrowUpCircle size={22} />} title="No images yet" hint="Images appear here once a stack has pulled them." />
      ) : (
        <div>
          <div className="flex h-3 w-full overflow-hidden rounded-full bg-slate-800/60 mb-3">
            {current > 0 && <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${(current / total) * 100}%` }} title={`${current} current`} />}
            {aging > 0 && <div className="bg-amber-500 transition-all duration-700" style={{ width: `${(aging / total) * 100}%` }} title={`${aging} aging`} />}
            {stale > 0 && <div className="bg-rose-500 transition-all duration-700" style={{ width: `${(stale / total) * 100}%` }} title={`${stale} stale`} />}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px]">
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
              <span className="text-slate-400">Current ({current})</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-amber-500" aria-hidden />
              <span className="text-slate-400">Aging ({aging})</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full bg-rose-500" aria-hidden />
              <span className="text-slate-400">Stale ({stale})</span>
            </span>
          </div>
          {!isAdmin && <p className="mt-2 text-[10px] text-slate-500 truncate">By build age · admins check the registry for updates</p>}
        </div>
      )}
    </Card>
  )
}
