// =============================================================================
// The incident log of the Health page (was the Uptime page's): every container
// that has restarted, fails its health check or is restarting now, with its last
// Docker event and its availability over the last 30 minutes — or "All clear"
// =============================================================================

import { AlertTriangle, Clock, RefreshCw, Shield, XCircle } from 'lucide-react'
import VmCapsule from '../fleet/VmCapsule'
import { Panel } from '../dashboard/cardShared'
import type { EventEntry } from '../../../shared/types'
import { AvailabilityFigure, UptimeStatusBadge, type TimelineRow } from './UptimeTimeline'
import { relativeTime } from './uptimeModel'

export interface IncidentRow extends TimelineRow {
  restart_count?: number
  lastEvent?: EventEntry
}

/** a container worth listing: it restarted, fails its health check or is restarting */
export function isIncident(c: { state: string; health: string; restart_count?: number }): boolean {
  return (c.restart_count ?? 0) > 0 || c.health.toLowerCase() === 'unhealthy' || c.state.toLowerCase() === 'restarting'
}

export default function IncidentLog({ incidents, show, fleetWide }: {
  incidents: IncidentRow[]
  /** there are containers and they have loaded: "All clear" may be said */
  show: boolean
  fleetWide: boolean
}) {
  if (incidents.length === 0) {
    if (!show) return null
    return (
      <div className="glass-card border-emerald-500/20 p-6 text-center animate-fade-in-up" style={{ animationDelay: '200ms', animationFillMode: 'both' }}>
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-emerald-500/10 mx-auto mb-3" aria-hidden>
          <Shield size={24} className="text-emerald-400" />
        </div>
        <p className="text-sm font-semibold text-emerald-400">All clear</p>
        <p className="text-xs text-slate-500 mt-1">No incidents: no container has restarted or is failing its health check.</p>
      </div>
    )
  }

  return (
    <Panel flush icon={AlertTriangle} title="Incident log" tone="attention" meta={`${incidents.length} container${incidents.length !== 1 ? 's' : ''}`}>
      <div className="divide-y divide-white/[0.03]">
        {incidents.map((c, idx) => {
          const unhealthy = c.health.toLowerCase() === 'unhealthy'
          const restarts = c.restart_count ?? 0
          return (
            <div
              key={c.key}
              className="flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3.5 hover:bg-white/[0.03] transition-colors duration-150 animate-fade-in-up"
              style={{ animationDelay: `${idx * 60}ms`, animationFillMode: 'both' }}
            >
              <div className={`flex items-center justify-center w-9 h-9 rounded-lg shrink-0 ${unhealthy ? 'bg-rose-500/10' : 'bg-amber-500/10'}`} aria-hidden>
                {unhealthy ? (
                  <XCircle size={18} className="text-rose-400" />
                ) : c.state.toLowerCase() === 'restarting' ? (
                  <RefreshCw size={18} className="text-amber-400 animate-spin" />
                ) : (
                  <AlertTriangle size={18} className="text-amber-400" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-sm text-slate-200 truncate min-w-0">{c.name}</p>
                  <UptimeStatusBadge state={c.state} health={c.health} onDemand={c.on_demand} />
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1 text-[11px] text-slate-500">
                  {fleetWide && <VmCapsule member={c.member} name={c.member_name} vmid={c.vmid} size="xs" />}
                  {restarts > 0 && (
                    <span className="flex items-center gap-1">
                      <RefreshCw size={10} aria-hidden />
                      {restarts} restart{restarts !== 1 ? 's' : ''}
                    </span>
                  )}
                  {c.lastEvent && (
                    <span className="flex items-center gap-1">
                      <Clock size={10} aria-hidden />
                      Last event: {c.lastEvent.action} {relativeTime(c.lastEvent.timestamp)}
                    </span>
                  )}
                </div>
              </div>
              <AvailabilityFigure timeline={c.timeline} className="shrink-0 text-right" />
            </div>
          )
        })}
      </div>
    </Panel>
  )
}
