// =============================================================================
// Activity → Timeline: the Docker events of the server (or of the VMs), newest
// first, grouped by day, filtered by type or name, with a tile per kind above.
// The page polls the events (only while this tab shows) and hands them in; the
// filters and folded days live here, so they survive a visit to another tab.
// =============================================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react'
import { SegmentedControl } from '@mantine/core'
import {
  Play, Square, Plus, Trash2, RefreshCw, Download,
  Box, Network, HardDrive, Database,
  Clock, Filter, Search, Activity as ActivityIcon,
  Zap, WifiOff, Server, X, ChevronDown, AlertTriangle,
  Moon,
} from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { EmptyState } from '../common/PageState'
import Hint from '../common/Hint'
import { BTN_TOOLBAR_QUIET, BTN_TOOLBAR, BTN_ICON_SM, TONE_OK, TONE_GHOST, FOCUS_RING } from '../../lib/ui'
import { CARD_HOVER } from '../../lib/pageKit'
import type { EventEntry } from '../../../shared/types'
import { onDemandEventWord } from '../../lib/containerState'

import { SEARCH_FIELD } from '../../lib/fieldStyles'
import { Pill } from '../common/Pill'
import SearchInput from '../common/SearchInput'
// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

type FilterType = 'all' | 'container' | 'network' | 'volume' | 'image' | 'error'

const FILTER_TABS: { key: FilterType; label: string; icon: React.ReactNode }[] = [
  { key: 'all', label: 'All', icon: <ActivityIcon size={13} /> },
  { key: 'container', label: 'Containers', icon: <Box size={13} /> },
  { key: 'network', label: 'Networks', icon: <Network size={13} /> },
  { key: 'volume', label: 'Volumes', icon: <HardDrive size={13} /> },
  { key: 'image', label: 'Images', icon: <Database size={13} /> },
  { key: 'error', label: 'Errors', icon: <AlertTriangle size={13} /> },
]

/** Events that mean something went wrong: crashes, kills, out-of-memory, failed health checks */
function isErrorEvent(e: EventEntry): boolean {
  const a = e.action.toLowerCase()
  if (a.startsWith('exec_')) return false
  // an on-demand container that Sablier put to sleep did not crash
  if (onDemandEventWord(e) === 'fell asleep') return false
  return a === 'die' || a === 'oom' || a === 'kill' || a.startsWith('health_status: unhealthy') || a.includes('unhealthy')
}

/** A key that stays the same for the same event across polls, so cards never remount */
function eventKey(e: EventEntry): string {
  return `${e.timestamp}|${e.type}|${e.action}|${e.name}`
}

/** Icon for each event action */
function actionIcon(action: string): React.ReactNode {
  switch (action) {
    case 'start':
      return <Play size={14} />
    case 'stop':
    case 'kill':
    case 'die':
      return <Square size={14} />
    case 'create':
      return <Plus size={14} />
    case 'destroy':
    case 'remove':
      return <Trash2 size={14} />
    case 'restart':
      return <RefreshCw size={14} />
    case 'pull':
      return <Download size={14} />
    default:
      return <Zap size={14} />
  }
}

/** an on-demand container falling asleep or waking up */
const ASLEEP_COLORS = {
  dot: 'bg-indigo-400',
  icon: 'text-indigo-300',
  bg: 'bg-indigo-500/10',
  border: 'border-indigo-500/20',
  glow: '',
}

/** Color config per action */
function actionColors(action: string): {
  dot: string
  icon: string
  bg: string
  border: string
  glow: string
} {
  switch (action) {
    case 'start':
    case 'create':
      return {
        dot: 'bg-emerald-400',
        icon: 'text-emerald-400',
        bg: 'bg-emerald-500/10',
        border: 'border-emerald-500/20',
        glow: 'shadow-[0_0_8px_rgba(52,211,153,0.3)]',
      }
    case 'stop':
    case 'kill':
    case 'die':
    case 'destroy':
    case 'remove':
      return {
        dot: 'bg-rose-400',
        icon: 'text-rose-400',
        bg: 'bg-rose-500/10',
        border: 'border-rose-500/20',
        glow: 'shadow-[0_0_8px_rgba(251,113,133,0.3)]',
      }
    case 'restart':
      return {
        dot: 'bg-amber-400',
        icon: 'text-amber-400',
        bg: 'bg-amber-500/10',
        border: 'border-amber-500/20',
        glow: 'shadow-[0_0_8px_rgba(251,191,36,0.3)]',
      }
    case 'pull':
    case 'connect':
    case 'attach':
      return {
        dot: 'bg-cyan-400',
        icon: 'text-cyan-400',
        bg: 'bg-cyan-500/10',
        border: 'border-cyan-500/20',
        glow: 'shadow-[0_0_8px_rgba(34,211,238,0.3)]',
      }
    default:
      return {
        dot: 'bg-slate-400',
        icon: 'text-slate-400',
        bg: 'bg-slate-500/10',
        border: 'border-slate-500/20',
        glow: 'shadow-[0_0_8px_rgba(148,163,184,0.2)]',
      }
  }
}

/** Type badge: what kind of thing it happened to — a plain slate label, the action next to it carries the colour */
function typeBadge(type: string): { label: string; icon: React.ReactNode } {
  switch (type) {
    case 'container':
      return { label: 'container', icon: <Box size={10} aria-hidden /> }
    case 'network':
      return { label: 'network', icon: <Network size={10} aria-hidden /> }
    case 'volume':
      return { label: 'volume', icon: <HardDrive size={10} aria-hidden /> }
    case 'image':
      return { label: 'image', icon: <Database size={10} aria-hidden /> }
    default:
      return { label: type, icon: <Zap size={10} aria-hidden /> }
  }
}

/** Relative time string */
function relativeTime(ts: number): string {
  const now = Date.now() / 1000
  const diff = now - ts
  if (diff < 5) return 'just now'
  if (diff < 60) return `${Math.floor(diff)}s ago`
  if (diff < 3600) {
    const mins = Math.floor(diff / 60)
    return `${mins} min${mins !== 1 ? 's' : ''} ago`
  }
  if (diff < 86400) {
    const hours = Math.floor(diff / 3600)
    return `${hours} hour${hours !== 1 ? 's' : ''} ago`
  }
  const days = Math.floor(diff / 86400)
  return `${days} day${days !== 1 ? 's' : ''} ago`
}

/** Absolute timestamp string */
function absoluteTime(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/** Day grouping key */
function dayGroup(ts: number): 'Today' | 'Yesterday' | 'Older' {
  const now = new Date()
  const eventDate = new Date(ts * 1000)

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const yesterdayStart = todayStart - 86400000
  const eventMs = eventDate.getTime()

  if (eventMs >= todayStart) return 'Today'
  if (eventMs >= yesterdayStart) return 'Yesterday'
  return 'Older'
}

// ---------------------------------------------------------------------------
// Disconnected empty state
// ---------------------------------------------------------------------------

function DisconnectedState() {
  const connectionStatus = useConnectionStore((s) => s.status)
  const connect = useConnectionStore((s) => s.connect)
  const isConnecting = connectionStatus === 'connecting'

  return (
    <EmptyState
      icon={isConnecting ? <RefreshCw size={32} className="animate-spin text-emerald-500/60" /> : <WifiOff size={32} />}
      title={isConnecting ? 'Connecting…' : 'No activity data'}
      hint={isConnecting
        ? 'Establishing the connection to the API server…'
        : 'Connect to your Docker API server to see the activity timeline.'}
      action={!isConnecting ? (
        <button type="button" onClick={() => connect()} className={`${BTN_TOOLBAR} ${TONE_OK} ${FOCUS_RING}`}>
          <Server size={14} />
          Connect
        </button>
      ) : undefined}
    />
  )
}

// ---------------------------------------------------------------------------
// Stats bar
// ---------------------------------------------------------------------------

function StatsBar({ events }: { events: EventEntry[] }) {
  const counts = useMemo(() => {
    const c = { container: 0, network: 0, volume: 0, image: 0, other: 0, error: 0 }
    for (const e of events) {
      if (e.type in c) (c as Record<string, number>)[e.type]++
      else c.other++
      if (isErrorEvent(e)) c.error++
    }
    return c
  }, [events])

  // counts are information (cyan); errors are the one that can be a problem (rose, or slate at zero)
  const stats = [
    { label: 'Total', value: events.length, color: 'text-slate-100', iconColor: 'text-cyan-400', icon: <ActivityIcon size={14} aria-hidden /> },
    { label: 'Containers', value: counts.container, color: 'text-slate-100', iconColor: 'text-cyan-400', icon: <Box size={14} aria-hidden /> },
    { label: 'Networks', value: counts.network, color: 'text-slate-100', iconColor: 'text-cyan-400', icon: <Network size={14} aria-hidden /> },
    { label: 'Volumes', value: counts.volume, color: 'text-slate-100', iconColor: 'text-cyan-400', icon: <HardDrive size={14} aria-hidden /> },
    { label: 'Images', value: counts.image, color: 'text-slate-100', iconColor: 'text-cyan-400', icon: <Database size={14} aria-hidden /> },
    { label: 'Errors', value: counts.error, color: counts.error ? 'text-rose-400' : 'text-slate-400', iconColor: counts.error ? 'text-rose-400' : 'text-slate-500', icon: <AlertTriangle size={14} aria-hidden /> },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`${CARD_HOVER} px-4 py-3 flex items-center gap-3`}
        >
          <div className={`${stat.iconColor} opacity-70`}>{stat.icon}</div>
          <div className="min-w-0">
            <div className={`text-lg font-bold tabular-nums ${stat.color}`}>{stat.value}</div>
            <div className="text-[10px] uppercase tracking-wider text-slate-500 font-medium">{stat.label}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Timeline card
// ---------------------------------------------------------------------------

const TimelineCard = React.memo(function TimelineCard({ event, index, fresh }: { event: EventEntry; index: number; fresh: boolean }) {
  // an on-demand container falling asleep (Sablier, on purpose) or waking up: calm indigo, never the crash red
  const odWord = onDemandEventWord(event)
  const colors = odWord ? ASLEEP_COLORS : actionColors(event.action)
  const badge = typeBadge(event.type)

  return (
    <div
      className={`relative pl-10 pb-8 last:pb-0 group ${fresh ? 'animate-fade-in' : ''}`}
      style={fresh ? { animationDelay: `${Math.min(index * 40, 400)}ms` } : undefined}
    >
      {/* Vertical connector line (hidden on last) */}
      <div className="absolute left-[11px] top-6 bottom-0 w-px bg-gradient-to-b from-white/[0.08] to-transparent group-last:hidden" aria-hidden />

      {/* Timeline dot */}
      <div className="absolute left-0 top-1 z-10" aria-hidden>
        <div className={`
          w-[23px] h-[23px] rounded-full border-2 border-slate-900
          flex items-center justify-center
          ${colors.bg} ${colors.glow}
          transition-transform duration-300 group-hover:scale-110
        `}>
          <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
        </div>
      </div>

      {/* Card */}
      <div className={`${CARD_HOVER} p-4 group-hover:translate-x-0.5 transition-transform duration-300`}>
        <div className="flex items-start justify-between gap-3">
          {/* Left content */}
          <div className="flex items-start gap-3 min-w-0 flex-1">
            {/* Action icon */}
            <div className={`
              flex-shrink-0 w-8 h-8 rounded-lg
              ${colors.bg} ${colors.border} border
              flex items-center justify-center
              ${colors.icon}
            `} aria-hidden>
              {odWord ? <Moon size={14} /> : actionIcon(event.action)}
            </div>

            <div className="min-w-0 flex-1">
              {/* Action + type row */}
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className={`
                  inline-flex items-center rounded-md border px-2 py-0.5
                  text-[11px] font-semibold uppercase tracking-wide
                  ${colors.bg} ${colors.border} ${colors.icon}
                `} title={odWord ? (odWord === 'fell asleep' ? 'On demand: Sablier stopped it while idle — the first request wakes it' : 'On demand: a request woke it') : undefined}>
                  {odWord ?? event.action}
                </span>
                <Pill tone="neutral" icon={badge.icon}>{badge.label}</Pill>
              </div>

              {/* Resource name */}
              <p className="text-sm font-semibold text-slate-200 truncate group-hover:text-white transition-colors">
                {event.name}
              </p>
            </div>
          </div>

          {/* Right: time */}
          <div className="flex-shrink-0 text-right">
            <div className="text-xs font-medium text-slate-400 tabular-nums">
              {relativeTime(event.timestamp)}
            </div>
            <div className="text-[11px] text-slate-500 tabular-nums mt-0.5">
              {absoluteTime(event.timestamp)}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})

// ---------------------------------------------------------------------------
// Day group header
// ---------------------------------------------------------------------------

function DayHeader({ label, count, collapsed, onToggle }: { label: string; count: number; collapsed: boolean; onToggle: () => void }) {
  return (
    <div className="relative pl-10 pb-4 pt-2">
      {/* Dot on the timeline */}
      <div className="absolute left-[7px] top-3 z-10" aria-hidden>
        <div className="w-[9px] h-[9px] rounded-full bg-gradient-to-br from-emerald-400 to-cyan-400 ring-2 ring-slate-950" />
      </div>

      <button
        type="button"
        onClick={onToggle}
        aria-expanded={!collapsed}
        className={`group/day flex items-center gap-3 w-full min-h-8 text-left rounded-lg ${FOCUS_RING}`}
        title={collapsed ? `Show ${label.toLowerCase()}` : `Hide ${label.toLowerCase()}`}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-slate-400 group-hover/day:text-slate-200 transition-colors">
          {label}
        </span>
        <span className="text-[11px] font-medium text-slate-500 tabular-nums">{count}</span>
        <div className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent" aria-hidden />
        <ChevronDown
          size={14}
          aria-hidden
          className={`text-slate-500 group-hover/day:text-slate-300 transition-transform duration-200 ${collapsed ? '-rotate-90' : ''}`}
        />
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Empty events state (connected but no events)
// ---------------------------------------------------------------------------

function EmptyEvents({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return filtered ? (
    <EmptyState
      icon={<Clock size={28} />}
      title="No events match"
      hint="Pick another type, or clear the search."
      action={<button type="button" onClick={onClear} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}><X size={14} /> Show all events</button>}
    />
  ) : (
    <EmptyState
      icon={<Clock size={28} />}
      title="No events yet"
      hint="Docker events will appear here as activity occurs."
    />
  )
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export default function Timeline({ events, isConnected }: { events: EventEntry[]; isConnected: boolean }) {
  const [activeFilter, setActiveFilter] = useState<FilterType>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [collapsedDays, setCollapsedDays] = useState<Set<string>>(() => new Set())
  const toggleDay = useCallback((label: string) => {
    setCollapsedDays((prev) => { const next = new Set(prev); if (next.has(label)) next.delete(label); else next.add(label); return next })
  }, [])
  // Cards seen before never animate again: new events slide in, the rest stay put
  const seenKeys = React.useRef<Set<string>>(new Set())
  const firstPaint = React.useRef(true)

  // After the first paint, only events that were not on screen before animate in
  useEffect(() => {
    if (events.length > 0 && firstPaint.current) {
      const t = setTimeout(() => { firstPaint.current = false }, 800)
      return () => clearTimeout(t)
    }
  }, [events.length])

  const filteredEvents = useMemo(() => {
    let result = [...events]
    if (activeFilter === 'error') result = result.filter(isErrorEvent)
    else if (activeFilter !== 'all') result = result.filter((e) => e.type === activeFilter)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.action.toLowerCase().includes(q) ||
          e.type.toLowerCase().includes(q),
      )
    }
    // newest first
    result.sort((a, b) => b.timestamp - a.timestamp)
    return result
  }, [events, activeFilter, searchQuery])

  const groupedEvents = useMemo(() => {
    const groups: { label: string; events: EventEntry[] }[] = []
    let currentGroup: string | null = null
    for (const event of filteredEvents) {
      const group = dayGroup(event.timestamp)
      if (group !== currentGroup) {
        groups.push({ label: group, events: [] })
        currentGroup = group
      }
      groups[groups.length - 1].events.push(event)
    }
    return groups
  }, [filteredEvents])

  if (!isConnected && events.length === 0) return <DisconnectedState />

  const filtering = activeFilter !== 'all' || searchQuery.trim().length > 0

  return (
    <div className="space-y-4 md:space-y-5">
      <StatsBar events={events} />

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap animate-fade-in">
        {/* Type filter: one choice (the dashboard's segmented control); a phone swipes it sideways */}
        <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none">
          <SegmentedControl
            aria-label="Type of event"
            value={activeFilter}
            onChange={(v) => setActiveFilter(v as FilterType)}
            data={FILTER_TABS.map((tab) => ({ value: tab.key, label: <span className="flex items-center gap-1.5">{tab.icon}{tab.label}</span> }))}
          />
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <SearchInput value={searchQuery} onChange={setSearchQuery} label="Filter events by name" placeholder="Filter by name…" />
        </div>

        {/* Result count */}
        <div className="flex items-center gap-1.5 text-xs text-slate-500 ml-auto" role="status">
          <Filter size={13} aria-hidden />
          <span>
            {filteredEvents.length === events.length
              ? `${events.length} events`
              : `${filteredEvents.length} of ${events.length}`
            }
          </span>
        </div>
      </div>

      {/* Timeline */}
      {filteredEvents.length === 0 ? (
        <EmptyEvents filtered={filtering && events.length > 0} onClear={() => { setActiveFilter('all'); setSearchQuery('') }} />
      ) : (
        <div className="relative animate-fade-in">
          {/* Main timeline line (gradient) */}
          <div
            className="absolute left-[11px] top-0 bottom-0 w-px"
            style={{
              background: 'linear-gradient(to bottom, rgba(52,211,153,0.3), rgba(34,211,238,0.15), transparent)',
            }}
            aria-hidden
          />

          <div className="relative">
            {groupedEvents.map((group) => {
              const collapsed = collapsedDays.has(group.label)
              const dupes = new Map<string, number>()
              return (
                <div key={group.label}>
                  <DayHeader label={group.label} count={group.events.length} collapsed={collapsed} onToggle={() => toggleDay(group.label)} />
                  {!collapsed && group.events.map((event, idx) => {
                    const base = eventKey(event)
                    const n = (dupes.get(base) ?? 0) + 1
                    dupes.set(base, n)
                    const key = n > 1 ? `${base}#${n}` : base
                    const fresh = !firstPaint.current && !seenKeys.current.has(key)
                    seenKeys.current.add(key)
                    return <TimelineCard key={key} event={event} index={idx} fresh={fresh} />
                  })}
                </div>
              )
            })}
          </div>

          {/* Bottom fade */}
          <div className="h-8 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none" aria-hidden />
        </div>
      )}
    </div>
  )
}
