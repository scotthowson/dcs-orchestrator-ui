// =============================================================================
// The "Last 30 min" view of the Health page's container list: one bar of 30
// minutes per container and its availability over them (was the Uptime page)
// =============================================================================

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { Server } from 'lucide-react'
import { Badge, Tooltip } from '@mantine/core'
import VmCapsule from '../fleet/VmCapsule'
import { EmptyState } from '../common/PageState'
import { WINDOW_MIN, availabilityText, availabilityTone, type Minute, type SegStatus, type Timeline, type UptimeRow } from './uptimeModel'
import { StateChip } from '../common/StateChip'
import { containerState } from '../../lib/containerState'

import { TONE_TEXT } from '../../lib/tone'
export interface TimelineRow extends UptimeRow {
  key: string
  image?: string
  member_name?: string
  vmid?: number | null
  timeline: Timeline
}

const SEG_CLASS: Record<SegStatus, string> = {
  up: 'bg-emerald-500',
  unhealthy: 'bg-amber-500',
  down: 'bg-rose-500',
  sleeping: 'bg-indigo-400',
  unknown: 'bg-slate-700',
}
const SEG_WORD: Record<SegStatus, string> = {
  up: 'running',
  unhealthy: 'unhealthy',
  down: 'stopped',
  sleeping: 'asleep (on demand)',
  unknown: 'no data',
}
const SEG_TONE: Record<SegStatus, string> = {
  up: 'text-emerald-300',
  unhealthy: 'text-amber-300',
  down: 'text-rose-300',
  sleeping: 'text-indigo-300',
  unknown: 'text-slate-400',
}

/** what a minute held, in words: "stopped 40 s · running 20 s" */
function minuteText(m: Minute): string {
  if (m.absent && m.secs.up + m.secs.down + m.secs.unhealthy + m.secs.sleeping < 1) return 'not created yet'
  const parts = (['down', 'unhealthy', 'up', 'sleeping', 'unknown'] as const).filter((s) => m.secs[s] >= 1)
  const text = parts.length <= 1
    ? SEG_WORD[parts[0] ?? 'unknown']
    : parts.map((s) => `${SEG_WORD[s]} ${Math.round(m.secs[s])} s`).join(' · ')
  return m.healthUnknown ? `${text} · health check not recorded` : text
}

function availabilityClass(pct: number | null): string {
  return pct === null ? 'text-slate-500' : TONE_TEXT[availabilityTone(pct)]
}

// ---------------------------------------------------------------------------
// A container's bar: 30 one-minute segments, a tooltip under the hovered one
// ---------------------------------------------------------------------------

function UptimeBar({ minutes, name }: { minutes: Minute[]; name: string }) {
  const [tip, setTip] = useState<{ m: Minute; x: number; y: number } | null>(null)
  const count = (s: SegStatus) => minutes.filter((m) => m.status === s).length
  const label = `${name}, the last ${WINDOW_MIN} minutes: ${count('up')} running, ${count('down')} stopped, ${count('unhealthy')} unhealthy${count('sleeping') ? `, ${count('sleeping')} asleep on demand` : ''}, ${count('unknown')} without data`
  return (
    <>
      <div className="uptime-bar flex gap-[2px] h-7 items-center" role="img" aria-label={label}>
        {minutes.map((m, i) => (
          <div
            // by position: m.start moves with every poll, and a new key would remount (and re-animate) every minute's bar
            key={i}
            className={`uptime-seg flex-1 h-full rounded-[3px] transition-all duration-300 ease-out hover:scale-y-125 hover:brightness-125 cursor-default ${SEG_CLASS[m.status]} ${m.status === 'up' ? 'uptime-seg-up' : ''} ${i === minutes.length - 1 && m.status === 'up' ? 'uptime-seg-live' : ''}`}
            style={{ animationDelay: `${i * 18}ms` }}
            onMouseEnter={(e) => {
              const r = e.currentTarget.getBoundingClientRect()
              setTip({ m, x: r.left + r.width / 2, y: r.bottom })
            }}
            onMouseLeave={() => setTip(null)}
          />
        ))}
      </div>
      {tip && createPortal(
        // on document.body: the rows animate in with a transform, and a fixed tooltip inside one would sit against the row
        <div
          className="uptime-tip fixed z-[9999] px-2.5 py-1.5 rounded-lg bg-slate-800 border border-white/10 text-[11px] text-slate-200 shadow-xl shadow-black/40 pointer-events-none whitespace-nowrap"
          style={{ left: tip.x, top: tip.y + 8, transform: 'translateX(-50%)' }}
        >
          <span className="font-mono">{new Date(tip.m.start * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <span className="text-slate-600"> · </span>
          <span className={SEG_TONE[tip.m.status]}>{minuteText(tip.m)}</span>
        </div>,
        document.body,
      )}
    </>
  )
}

// ---------------------------------------------------------------------------
// Running and healthy is fine, unhealthy a problem, restarting needs a look, stopped is neutral, "on demand" is Sablier's indigo
// ---------------------------------------------------------------------------

export function UptimeStatusBadge({ state, health, onDemand, sablierUp }: { state: string; health: string; onDemand?: boolean; sablierUp?: boolean | null }) {
  const s = state.toLowerCase()
  const h = health.toLowerCase()
  // asleep on demand: the shared chip (indigo moon, amber when Sablier is not there to wake it)
  if (s !== 'running' && s !== 'restarting' && onDemand) return <StateChip state={containerState({ state, on_demand: true, sablier_up: sablierUp })} size="xs" />
  if (s === 'running' && h === 'healthy') return <Badge component="span" color="emerald">Healthy</Badge>
  if (s === 'running' && h === 'unhealthy') return <Badge component="span" color="rose">Unhealthy</Badge>
  if (s === 'running') return <Badge component="span" color="emerald">Running</Badge>
  if (s === 'restarting') return <Badge component="span" color="amber">Restarting</Badge>
  return <Badge component="span" color="slate">Stopped</Badge>
}

/** a container's availability over the window, "estimated" with the reason when part of it is not known */
export function AvailabilityFigure({ timeline, className = '' }: { timeline: Timeline; className?: string }) {
  const figure = (
    <span className={`text-sm font-bold tabular-nums ${availabilityClass(timeline.availability)}`}>
      {availabilityText(timeline.availability)}
      {timeline.estimated && timeline.availability !== null && <span className="ml-1 text-[10px] font-medium text-slate-500">est.</span>}
    </span>
  )
  return (
    <span className={className}>
      {timeline.estimated ? (
        <Tooltip label={`Estimated: ${timeline.why.join('. ')}. That time is left out of the figure.`} multiline w={280} withArrow>
          {figure}
        </Tooltip>
      ) : figure}
    </span>
  )
}

function formatUptime(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return 'Offline'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function shortImage(image: string, maxLen = 30): string {
  if (image.length <= maxLen) return image
  const last = image.split('/').pop() ?? image
  return last.length <= maxLen ? last : `${last.slice(0, maxLen - 3)}...`
}

// ---------------------------------------------------------------------------
// The list
// ---------------------------------------------------------------------------

export default function UptimeTimeline({ rows, loading, fleetWide, onScope, filtered, emptyHint }: {
  rows: TimelineRow[]
  loading: boolean
  fleetWide: boolean
  onScope: (member: string) => void
  /** a search or filter is narrowing the list */
  filtered: boolean
  emptyHint: string
}) {
  const anyEstimated = rows.some((r) => r.timeline.estimated)
  return (
    <>
      <div className="px-4 py-2 border-b border-white/[0.03] flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[11px] text-slate-500">
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {(['up', 'unhealthy', 'down', 'sleeping', 'unknown'] as const).map((s) => (
            <span key={s} className="flex items-center gap-1.5"><span className={`w-2.5 h-2.5 rounded-sm ${SEG_CLASS[s]}`} aria-hidden />{s === 'sleeping' ? 'Asleep (on demand)' : SEG_WORD[s].charAt(0).toUpperCase() + SEG_WORD[s].slice(1)}</span>
          ))}
        </span>
        <span>Each bar covers the last {WINDOW_MIN} minutes</span>
      </div>

      {loading && rows.length === 0 ? (
        <div className="divide-y divide-white/[0.03]" role="status" aria-label="Loading the uptime data">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="grid grid-cols-1 md:grid-cols-[220px_1fr_140px] items-center gap-2 md:gap-4 px-4 md:px-5 py-3" aria-hidden>
              <div className="space-y-1.5"><div className="skeleton h-4 w-32" /><div className="skeleton h-3 w-24" /></div>
              <div className="skeleton h-7" />
              <div className="skeleton h-4 w-16 md:ml-auto" />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState compact icon={<Server size={22} />} title={filtered ? 'No container matches' : 'No containers found'} hint={filtered ? 'Try another search or filter.' : emptyHint} />
      ) : (
        <div className="divide-y divide-white/[0.03]">
          {rows.map((c, idx) => (
            <div
              key={c.key}
              className="grid grid-cols-1 md:grid-cols-[220px_1fr_140px] items-center gap-2 md:gap-4 px-4 md:px-5 py-3 hover:bg-white/[0.03] transition-colors duration-150 animate-fade-in-up"
              style={{ animationDelay: `${Math.min(idx * 30, 600)}ms`, animationFillMode: 'both' }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap min-w-0">
                  <p className="font-mono text-sm text-slate-200 truncate min-w-0">{c.name}</p>
                  {fleetWide && <VmCapsule member={c.member} name={c.member_name} vmid={c.vmid} size="xs" onClick={() => onScope(c.member ?? 'hub')} />}
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500 font-mono truncate min-w-0" title={c.image}>{c.image ? shortImage(c.image) : '--'}</p>
                  <UptimeStatusBadge state={c.state} health={c.health} onDemand={c.on_demand} />
                </div>
              </div>
              <div className="min-w-0">
                <UptimeBar minutes={c.timeline.minutes} name={c.name} />
              </div>
              <div className="flex items-baseline justify-between gap-3 md:block md:text-right">
                <AvailabilityFigure timeline={c.timeline} className="md:block" />
                <p className="text-[11px] text-slate-500 md:mt-0.5">{formatUptime(c.uptime_seconds)}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {rows.length > 0 && (
        <div className="px-4 md:px-5 py-2 border-t border-white/[0.03] text-[10px] text-slate-500 space-y-1">
          <div className="flex justify-between"><span>{WINDOW_MIN} min ago</span><span>Now</span></div>
          <p className="text-[11px] leading-relaxed">
            Availability: the share of the last {WINDOW_MIN} minutes a container was running and passing its health check (asleep on demand counts as available), read from Docker&apos;s own start, stop and health events.
            {anyEstimated && ' "est." marks a figure that leaves out time those events do not cover; hover it for the reason.'}
          </p>
        </div>
      )}
    </>
  )
}
