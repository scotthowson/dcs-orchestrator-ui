// =============================================================================
// RecentEvents — the latest Docker events for the Dashboard
// =============================================================================

import React from 'react'
import { Box, Image, Network, Settings, Activity, Moon } from 'lucide-react'
import { onDemandEventWord } from '../../lib/containerState'
import { Badge } from '@mantine/core'
import { useLogStore } from '../../stores/logStore'
import { useConnectionStore } from '../../stores/connectionStore'
import VmCapsule from '../fleet/VmCapsule'
import type { EventEntry } from '../../../shared/types'
import { Card, CardBody, CardEmpty, CardOffline } from './cardShared'

/** what kind of thing it happened to: an icon, never a status colour */
function eventTypeIcon(type: string): React.ReactNode {
  switch (type) {
    case 'container': return <Box className="h-3.5 w-3.5" />
    case 'image': return <Image className="h-3.5 w-3.5" />
    case 'network': return <Network className="h-3.5 w-3.5" />
    default: return <Settings className="h-3.5 w-3.5" />
  }
}

/** what happened: started is fine, stopped or died is a problem, restarted needs a look, the rest is information */
function actionColor(action: string): string {
  switch (action) {
    case 'start':
    case 'create':
      return 'emerald'
    case 'stop':
    case 'kill':
    case 'die':
    case 'destroy':
      return 'rose'
    case 'restart':
      return 'amber'
    case 'pull':
    case 'connect':
    case 'attach':
      return 'cyan'
    default:
      return 'slate'
  }
}

function formatTimestamp(ts: number): string {
  const now = Date.now() / 1000
  const diff = now - ts

  if (diff < 60) return 'just now'
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`

  const date = new Date(ts * 1000)
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function EventRow({ event, index }: { event: EventEntry; index: number }) {
  return (
    <div
      className="flex items-center gap-2.5 py-2 px-2 rounded-lg group hover:bg-white/5 transition-colors duration-200 animate-fade-in"
      style={{ animationDelay: `${index * 30}ms` }}
    >
      <div className="flex-shrink-0 rounded-md p-1.5 bg-slate-500/10 text-slate-400" role="img" aria-label={event.type}>
        {eventTypeIcon(event.type)}
      </div>

      {onDemandEventWord(event)
        ? <Badge component="span" color="indigo" leftSection={<Moon size={9} aria-hidden />} title="On demand: Sablier puts it to sleep while idle and wakes it on the first request">{onDemandEventWord(event)}</Badge>
        : <Badge component="span" color={actionColor(event.action)}>{event.action}</Badge>}

      {/* Where it happened (only rows of a fleet view carry it) */}
      {event.member !== undefined && <VmCapsule member={event.member} name={event.member_name} vmid={event.vmid} size="xs" />}

      <span className="min-w-0 flex-1 truncate text-xs text-slate-300 group-hover:text-white transition-colors font-mono">
        {event.name}
      </span>

      <span className="flex-shrink-0 text-[11px] text-slate-500 tabular-nums">
        {formatTimestamp(event.timestamp)}
      </span>
    </div>
  )
}

export default function RecentEvents() {
  const events = useLogStore((s) => s.events)
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  // The latest events, most recent first: as many as the card is tall (the body scrolls beyond that)
  const recentEvents = [...events].slice(-60).reverse()

  if (!isConnected && events.length === 0) return <Card card="recent-events" dim><CardOffline /></Card>

  return (
    <Card card="recent-events" open="activity" clickable={false} meta={recentEvents.length > 0 ? `${recentEvents.length} events` : undefined}>
      {recentEvents.length === 0 ? (
        <CardEmpty icon={<Activity size={22} />} title="No recent events" hint="Events appear here as Docker activity happens." />
      ) : (
        <CardBody>
          <div className="space-y-0.5">
            {recentEvents.map((event, idx) => (
              <EventRow key={`${event.timestamp}-${event.name}-${idx}`} event={event} index={idx} />
            ))}
          </div>
        </CardBody>
      )}
    </Card>
  )
}
