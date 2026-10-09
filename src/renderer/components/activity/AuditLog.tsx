// =============================================================================
// Activity → Audit log (admins only: GET /audit answers 403 to a user): who did
// what on the server — sign-ins, deploys, stack changes, configuration updates —
// filtered by action or text. useAuditLog polls it only while the tab shows.
// =============================================================================

import React, { useState, useMemo, useEffect, useCallback } from 'react'
import {
  Play, Trash2, RefreshCw, Search, X, ChevronDown, FileText, Shield,
  Rocket, Power, HeartPulse, Archive, ListFilter, WifiOff,
} from 'lucide-react'
import { fetchAuditLog } from '../../api/endpoints'
import { useToast } from '../common/Toast'
import { LoadingState, EmptyState } from '../common/PageState'
import Hint from '../common/Hint'
import VmCapsule from '../fleet/VmCapsule'
import { BTN_ICON_SM, TONE_GHOST, FOCUS_RING } from '../../lib/ui'
import { CARD, CARD_HOVER } from '../../lib/pageKit'
import type { AuditEntry } from '../../../shared/types'

import SearchInput from '../common/SearchInput'
const AUDIT_LIMIT = 200
const AUDIT_POLL_MS = 15000

/** The last 200 entries of the scope's audit log, read now and every 15 s while `enabled` (the tab shows, an admin, connected) */
export function useAuditLog(enabled: boolean, scope: string) {
  const { addToast } = useToast()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((t) => t + 1), [])

  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const res = await fetchAuditLog({ limit: AUDIT_LIMIT }, scope)
        if (!cancelled) setEntries(res.entries)
      } catch {
        if (!cancelled) addToast({ type: 'error', message: 'Failed to load audit log' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    const interval = setInterval(load, AUDIT_POLL_MS)
    return () => { cancelled = true; clearInterval(interval); setLoading(false) }
  }, [enabled, scope, addToast, tick])

  return { entries, loading, refresh }
}

export default function AuditLog({ entries, loading, isConnected, onScope }: {
  entries: AuditEntry[]
  loading: boolean
  isConnected: boolean
  /** a VM capsule was clicked: show that member (null = the hub) */
  onScope: (member: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [action, setAction] = useState<string>('all')

  const actions = useMemo(() => ['all', ...Array.from(new Set(entries.map((e) => e.action))).sort()], [entries])

  const filtered = useMemo(() => {
    let result = entries
    if (action !== 'all') result = result.filter((e) => e.action === action)
    if (query.trim()) {
      const q = query.toLowerCase()
      result = result.filter(
        (e) =>
          e.action.toLowerCase().includes(q) ||
          e.detail.toLowerCase().includes(q) ||
          e.timestamp.toLowerCase().includes(q),
      )
    }
    return result
  }, [entries, action, query])

  return (
    <div className="space-y-3">
      {/* Filter row */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Action type filter */}
        <div className="relative flex items-center gap-1.5">
          <ListFilter size={13} className="text-slate-500" aria-hidden />
          <div className="relative">
            <select
              aria-label="Filter by action"
              value={action}
              onChange={(e) => setAction(e.target.value)}
              className={`rounded-lg h-9 pl-3 pr-8 text-xs bg-white/5 border border-white/10 text-slate-300 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/30 transition-colors appearance-none cursor-pointer max-w-[12rem]`}
            >
              {actions.map((a) => (
                <option key={a} value={a} className="bg-slate-900 text-slate-200">
                  {a === 'all' ? 'All actions' : a}
                </option>
              ))}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-1 min-w-[12rem] max-w-xs">
          <SearchInput size="sm" value={query} onChange={setQuery} label="Search the audit log" placeholder="Search the audit log…" />
        </div>

        {/* Result count */}
        <span className="text-xs text-slate-500 ml-auto" role="status">
          {filtered.length === entries.length
            ? `${entries.length} ${entries.length === 1 ? 'entry' : 'entries'}`
            : `${filtered.length} of ${entries.length}`}
        </span>
      </div>

      {loading && entries.length === 0 && <LoadingState compact label="Loading the audit log…" />}

      {!loading && entries.length === 0 && (
        <div className={CARD}>
          {isConnected
            ? <EmptyState compact icon={<FileText size={28} />} title="No audit entries found" hint="Sign-ins, deploys, stack changes and configuration updates are written here." />
            : <EmptyState compact icon={<WifiOff size={28} />} title="Not connected" hint="The audit log loads once the dashboard is connected to the server." />}
        </div>
      )}

      {entries.length > 0 && filtered.length === 0 && (
        <div className={CARD}>
          <EmptyState compact icon={<FileText size={28} />} title="No entries match" hint="Pick another action, or clear the search." />
        </div>
      )}

      {filtered.length > 0 && (
        <div className="relative">
          {/* Timeline line */}
          <div
            className="absolute left-[11px] top-0 bottom-0 w-px"
            style={{ background: 'linear-gradient(to bottom, rgba(139,92,246,0.3), rgba(34,211,238,0.15), transparent)' }}
            aria-hidden
          />

          <div className="relative space-y-0">
            {filtered.map((entry, idx) => {
              const colors = auditActionStyle(entry.action)
              return (
                <div
                  key={`${entry.timestamp}-${idx}`}
                  className="relative pl-10 pb-4 group animate-fade-in"
                  style={{ animationDelay: `${Math.min(idx * 30, 400)}ms` }}
                >
                  {/* Connector line */}
                  <div className="absolute left-[11px] top-5 bottom-0 w-px bg-gradient-to-b from-white/[0.06] to-transparent group-last:hidden" aria-hidden />

                  {/* Dot */}
                  <div className="absolute left-0 top-1 z-10" aria-hidden>
                    <div className={`w-[23px] h-[23px] rounded-full border-2 border-slate-900 flex items-center justify-center ${colors.bg} transition-transform duration-300 group-hover:scale-110`}>
                      <div className={`w-2.5 h-2.5 rounded-full ${colors.dot}`} />
                    </div>
                  </div>

                  {/* Card */}
                  <div className={`${CARD_HOVER} p-3.5 group-hover:translate-x-0.5 transition-transform duration-300`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2.5 min-w-0 flex-1">
                        <div className={`flex-shrink-0 w-7 h-7 rounded-lg ${colors.bg} border ${colors.border} flex items-center justify-center ${colors.text}`} aria-hidden>
                          {auditActionIcon(entry.action)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${colors.bg} ${colors.border} ${colors.text}`}>
                              {entry.action}
                            </span>
                            {entry.member !== undefined && <VmCapsule member={entry.member} name={entry.member_name} vmid={entry.vmid} size="xs" onClick={() => onScope(entry.member ?? null)} />}
                          </div>
                          <p className="text-xs text-slate-400 leading-relaxed break-words">
                            {entry.detail}
                          </p>
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-[11px] text-slate-500 tabular-nums whitespace-nowrap">
                          {formatAuditTimestamp(entry.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>

          {/* Bottom fade */}
          <div className="h-6 bg-gradient-to-t from-slate-950 to-transparent pointer-events-none" aria-hidden />
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function auditActionIcon(action: string): React.ReactNode {
  switch (action) {
    case 'deploy': return <Rocket size={12} />
    case 'undeploy': return <Trash2 size={12} />
    case 'stack_start': return <Play size={12} />
    case 'stack_stop': return <Power size={12} />
    case 'health_change': return <HeartPulse size={12} />
    case 'backup_complete': return <Archive size={12} />
    case 'config_update': return <RefreshCw size={12} />
    default: return <Shield size={12} />
  }
}

function auditActionStyle(action: string): { dot: string; bg: string; border: string; text: string } {
  switch (action) {
    case 'deploy':
    case 'stack_start':
      return { dot: 'bg-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400' }
    case 'undeploy':
    case 'stack_stop':
      return { dot: 'bg-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20', text: 'text-rose-400' }
    case 'health_change':
      return { dot: 'bg-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400' }
    case 'backup_complete':
      return { dot: 'bg-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20', text: 'text-cyan-400' }
    case 'config_update':
      return { dot: 'bg-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', text: 'text-violet-400' }
    default:
      return { dot: 'bg-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20', text: 'text-slate-400' }
  }
}

function formatAuditTimestamp(ts: string): string {
  try {
    const d = new Date(ts)
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch {
    return ts
  }
}
