// =============================================================================
// Activity → Live stream (was the Live Events page): the server's Server-Sent
// Events as they arrive — Docker events and metrics — as raw JSON cards, with a
// type filter, auto-scroll, Clear and "Jump to latest". Kept only in this tab
// (the last 500), never on the server.
//
// The stream is the app's one EventSource (lib/sse, opened by App.tsx while
// connected). On a hub its scope — the hub's own events, every VM's, or one
// VM's — belongs to the whole app: this tab points it at the page's scope chips
// from the moment it is first opened, follows them while the page stays open
// (on any tab, so the events kept here always carry the right VM), and leaves it
// there when the page closes, as the Live Events page did. Only this tab ever
// listens to the stream, so the Timeline alone never moves it.
// =============================================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { Badge, SegmentedControl } from '@mantine/core'
import { Radio, Trash2, ArrowDown, ArrowDownToLine } from 'lucide-react'
import { sseClient, fleetTagOf, type SSEMessage, type SSEEventType, type FleetTag } from '../../lib/sse'
import type { ScopeMember } from '../../hooks/useFleetScope'
import VmCapsule from '../fleet/VmCapsule'
import { EmptyState } from '../common/PageState'
import { BTN_TOOLBAR, TONE_QUIET } from '../../lib/ui'
import { CARD, CARD_HOVER, FOCUS_RING } from '../../lib/pageKit'

const MAX_EVENTS = 500

type FilterKey = SSEEventType | 'all'

// (the stream only ever sends docker-event and metrics; log-line and health-score are in the protocol
// but nothing emits them, so a tab for them would stay empty for ever)
const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'docker-event', label: 'Docker events' },
  { key: 'metrics', label: 'Metrics' },
]

/** Docker events are the ones to watch (cyan); the rest is a steady stream, told apart by its label (slate) */
const TYPE_COLOR: Record<SSEEventType, 'cyan' | 'slate'> = {
  'docker-event': 'cyan',
  metrics: 'slate',
  'log-line': 'slate',
  'health-score': 'slate',
  keepalive: 'slate',
}

/** An event as the tab keeps it: the message plus where it happened (fleet view only) */
interface FeedEvent extends SSEMessage {
  tag: FleetTag | null
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    })
  } catch {
    return iso
  }
}

function prettyJSON(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2)
  } catch {
    return String(data)
  }
}

/**
 * Where a docker event happened: the tag the hub put on it, else what the
 * stream's scope implies — the hub itself in the fleet view, the chosen VM in
 * a VM view, nothing on a hub-only stream (no capsule then).
 */
function tagFor(event: SSEMessage, scope: string, members: ScopeMember[]): FleetTag | null {
  if (event.type !== 'docker-event') return null
  const own = fleetTagOf(event.data)
  if (own) return own
  if (scope === 'all') return { member: null }
  if (scope === 'hub') return null
  const m = members.find((x) => x.id === scope)
  return { member: scope, member_name: m?.name, vmid: m?.vmid ?? null }
}

/** Whether the live stream is open, checked every second while `watch` (the Live stream tab shows) */
export function useSseConnected(watch: boolean): boolean {
  const [connected, setConnected] = useState(() => sseClient.isConnected())
  useEffect(() => {
    if (!watch) return
    setConnected(sseClient.isConnected())
    const t = setInterval(() => setConnected(sseClient.isConnected()), 1000)
    return () => clearInterval(t)
  }, [watch])
  return connected
}

export default function LiveStream({ active, scope, members, memberName, sseConnected, onScope }: {
  /** the tab shows (the component stays mounted behind the other tabs, so what it caught is kept) */
  active: boolean
  scope: string
  members: ScopeMember[]
  memberName: string
  sseConnected: boolean
  /** a VM capsule was clicked: show that member (null = the hub) */
  onScope: (member: string | null) => void
}) {
  const [events, setEvents] = useState<FeedEvent[]>([])
  const [filter, setFilter] = useState<FilterKey>('all')
  const [autoScroll, setAutoScroll] = useState(true)

  const feedRef = useRef<HTMLDivElement>(null)
  // read when an event arrives (the listener below is subscribed once)
  const scopeRef = useRef(scope)
  const membersRef = useRef(members)
  membersRef.current = members

  // ---- Scope → stream (see the note at the top) ----
  useEffect(() => {
    scopeRef.current = scope
    sseClient.setScope(scope)
  }, [scope])

  // ---- Subscription ----
  useEffect(() => {
    return sseClient.on('*', (event: SSEMessage) => {
      const entry: FeedEvent = { ...event, tag: tagFor(event, scopeRef.current, membersRef.current) }
      setEvents((prev) => {
        const next = [...prev, entry]
        return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next
      })
    })
  }, [])

  // The feed scrolls, not the page: scrollIntoView on a marker at its end would scroll every scrollable
  // ancestor too, and pull the page's own header out of view each time an event arrives.
  const scrollFeedToEnd = useCallback((smooth = true) => {
    const feed = feedRef.current
    if (feed) feed.scrollTo({ top: feed.scrollHeight, behavior: smooth ? 'smooth' : 'auto' })
  }, [])

  // ---- Auto-scroll (and back at the end when the tab is shown again) ----
  const wasActive = useRef(active)
  useEffect(() => {
    const shown = active && !wasActive.current
    wasActive.current = active
    if (active && autoScroll) scrollFeedToEnd(!shown)
  }, [events, autoScroll, active, scrollFeedToEnd])

  const filtered = filter === 'all' ? events : events.filter((e) => e.type === filter)

  const waiting = scope === 'all'
    ? 'Waiting for events from the hub and its VMs…'
    : scope !== 'hub'
      ? `Waiting for events from the VM ${memberName}…`
      : 'Waiting for server events…'

  return (
    <div className="space-y-3">
      {/* ---- Toolbar: type, auto-scroll, clear ---- */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none">
          <SegmentedControl
            aria-label="Type of live event"
            value={filter}
            onChange={(v) => setFilter(v as FilterKey)}
            data={FILTER_TABS.map((tab) => ({ value: tab.key, label: tab.label }))}
          />
        </div>
        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            type="button"
            onClick={() => setAutoScroll((v) => !v)}
            aria-pressed={autoScroll}
            className={`${BTN_TOOLBAR} ${FOCUS_RING} ${autoScroll ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25' : TONE_QUIET}`}
          >
            <ArrowDownToLine size={14} />
            Auto-scroll
          </button>
          <button type="button" onClick={() => setEvents([])} className={`${BTN_TOOLBAR} ${TONE_QUIET} ${FOCUS_RING}`}>
            <Trash2 size={14} />
            Clear
          </button>
        </div>
      </div>

      {/* ---- Count ---- */}
      <div className="flex items-center justify-between min-h-8 text-xs text-slate-500 px-1" role="status">
        <span>
          {filtered.length} event{filtered.length !== 1 ? 's' : ''}
          {filter !== 'all' && ` (${events.length} total)`}
        </span>
        {!autoScroll && filtered.length > 0 && (
          <button
            type="button"
            onClick={() => scrollFeedToEnd()}
            className={`flex h-8 items-center gap-1 rounded-lg px-2 text-cyan-400 hover:text-cyan-300 hover:bg-white/5 transition-colors ${FOCUS_RING}`}
          >
            <ArrowDown size={12} aria-hidden />
            Jump to latest
          </button>
        )}
      </div>

      {/* ---- Feed ---- */}
      <div
        ref={feedRef}
        role="log"
        aria-label="Live events"
        aria-live="off"
        className={`${CARD} p-3 sm:p-4 max-h-[calc(100vh-420px)] min-h-[16rem] overflow-y-auto scrollbar-thin space-y-2`}
      >
        {filtered.length === 0 ? (
          <EmptyState
            icon={<Radio size={30} />}
            title="No events yet"
            hint={sseConnected ? waiting : 'The live connection is down — events will appear once it is back.'}
          />
        ) : (
          filtered.map((event, idx) => {
            const tag = event.tag
            return (
              <div key={`${event.timestamp}-${idx}`} className={`${CARD_HOVER} p-3 sm:p-4`}>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <span className="text-xs text-slate-500 font-mono tabular-nums">
                    {formatTimestamp(event.timestamp)}
                  </span>
                  <Badge color={TYPE_COLOR[event.type] ?? 'cyan'}>
                    {event.type}
                  </Badge>
                  {tag && (
                    <VmCapsule member={tag.member} name={tag.member_name} vmid={tag.vmid} size="xs" onClick={() => onScope(tag.member)} />
                  )}
                </div>
                <pre className="text-xs text-slate-300 font-mono whitespace-pre-wrap break-all leading-relaxed bg-black/20 rounded-lg p-3 max-h-48 overflow-y-auto scrollbar-thin">
                  {prettyJSON(event.data)}
                </pre>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
