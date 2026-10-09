// =============================================================================
// NotificationStatus — the last notifications the server sent and whether they arrived
// =============================================================================

import { Bell } from 'lucide-react'
import { Badge } from '@mantine/core'
import { useConnectionStore } from '../../stores/connectionStore'
import { pageLabel } from '../../constants/pageTitles'
import type { NotificationHistoryResponse } from '../../../shared/types'
import { Card, CardBody, CardOffline } from './cardShared'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
interface Props {
  data: NotificationHistoryResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function NotificationStatus({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  if (!isConnected && !data) return <Card card="notifications" dim><CardOffline /></Card>
  if (!data && error) return <Card card="notifications"><ErrorState card title="Could not load the notifications" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="notifications"><Skeleton label="Loading the notifications…" rows={2} /></Card>

  const history = data.history
  const recent = history.slice(0, 30)   // as many as the card is tall: the body scrolls beyond that
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000
  const recentCount = history.filter((h) => new Date(h.timestamp).getTime() > dayAgo).length

  return (
    <Card card="notifications" meta={`${recentCount} in 24h`} open="notifications">
      {recent.length === 0 ? (
        <EmptyState card icon={<Bell size={22} />} title="No notifications sent" hint={`Set up webhooks and rules on the ${pageLabel('notifications')} page.`} />
      ) : (
        <CardBody className="space-y-1.5">
          {recent.map((h) => {
            const ok = h.status_code >= 200 && h.status_code < 300
            return (
              <div key={`${h.timestamp}-${h.title}`} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-2.5 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge component="span" color={h.type === 'error' ? 'rose' : h.type === 'warning' ? 'amber' : 'slate'}>{h.type}</Badge>
                  <span className="text-[11px] text-slate-400 truncate">{h.title}</span>
                </div>
                <span className={`shrink-0 w-2 h-2 rounded-full ${ok ? 'bg-emerald-400' : 'bg-rose-400'}`} role="img" aria-label={ok ? 'Delivered' : 'Not delivered'} />
              </div>
            )
          })}
        </CardBody>
      )}
    </Card>
  )
}
