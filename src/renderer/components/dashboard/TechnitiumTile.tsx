// =============================================================================
// TechnitiumTile — the home's resolvers on the dashboard: today's queries and
// blocked as a mini bar (one column an hour), each server's state dot, whether
// the two are in step, and a tap to the Technitium page. Shown only while
// Technitium is on in Config (the grid leaves it out otherwise). Its requests
// are the page's own (shared keys), so an open page asks nothing twice.
// =============================================================================

import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { fetchTechnitiumStats, fetchTechnitiumStatus } from '../../api/endpoints'
import { useTechnitiumEnabled } from '../../hooks/useTechnitiumEnabled'
import { useConnectionStore } from '../../stores/connectionStore'
import type { TechnitiumInstance, TechnitiumStatus } from '../../../shared/types'
import { Card, CardOffline } from './cardShared'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
import { Pill } from '../common/Pill'
import { TONE_DOT, TONE_FILL, type Tone } from '../../lib/tone'

function serverState(inst: TechnitiumInstance): { tone: Tone; label: string } {
  if (!inst.reachable) return { tone: 'problem', label: 'not answering' }
  if (inst.blocking === false) return { tone: 'attention', label: 'blocking paused' }
  if (inst.update_available) return { tone: 'info', label: `answering · ${inst.update_version} available` }
  return { tone: 'ok', label: 'answering' }
}

function syncPill(st: TechnitiumStatus) {
  if (st.in_sync === null) return <Pill tone="neutral" dot>One server</Pill>
  return st.in_sync ? <Pill tone="ok" dot>In sync</Pill> : <Pill tone="attention" dot>Out of sync</Pill>
}

export default function TechnitiumTile() {
  const on = useTechnitiumEnabled()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const status = usePolling(fetchTechnitiumStatus, 60000, { key: pollKeys.technitiumStatus, enabled: on === true })
  const stats = usePolling(() => fetchTechnitiumStats('lastDay'), 60000, { key: 'technitium-stats:lastDay', enabled: on === true && !!status.data?.configured })
  if (on !== true) return null

  const st = status.data
  if (!isConnected && !st) return <Card card="technitium" dim><CardOffline /></Card>
  if (!st && status.error) return <Card card="technitium" tone="attention"><ErrorState card title="Could not read Technitium" error={status.error} onRetry={status.refresh} /></Card>
  if (!st) return <Card card="technitium"><Skeleton label="Asking Technitium…" rows={3} /></Card>
  if (!st.configured) {
    return <Card card="technitium" open="technitium"><EmptyState card title="No Technitium is connected" hint="Connect the primary on the Technitium page." /></Card>
  }

  const servers = [st.primary, st.secondary].filter((s): s is TechnitiumInstance => !!s?.configured)
  const down = servers.some((s) => !s.reachable)
  const d = stats.data
  const peak = Math.max(1, ...(d?.series.queries ?? [0]))
  const pct = d && d.totals.queries ? Math.round((d.totals.blocked / d.totals.queries) * 100) : 0

  return (
    <Card card="technitium" open="technitium" badge={syncPill(st)} tone={down ? 'problem' : undefined}>
      <div className="flex min-h-0 flex-1 flex-col gap-3">
        <div>
          <p className="text-sm text-slate-200 tabular-nums">
            {d ? <>{d.totals.queries.toLocaleString()} queries · {d.totals.blocked.toLocaleString()} blocked <span className="text-slate-500">({pct} %)</span></> : 'Today’s queries…'}
          </p>
          <p className="text-xs text-slate-500">the last 24 hours, both servers</p>
        </div>
        {d && d.series.queries.length > 1 && (
          <div className="flex min-h-0 flex-1 items-end gap-px" role="img" aria-label={`Queries by hour today: ${d.totals.queries.toLocaleString()}, of which ${d.totals.blocked.toLocaleString()} blocked`}>
            {d.series.queries.map((q, i) => (
              <div key={i} className="relative flex-1 min-w-[2px] rounded-sm overflow-hidden" style={{ height: `${Math.max(4, (q / peak) * 100)}%` }}>
                <div className={`absolute inset-0 ${TONE_FILL.info}`} style={{ opacity: 0.35 }} />
                <div className={`absolute inset-x-0 bottom-0 ${TONE_FILL.attention}`} style={{ height: `${q ? Math.min(100, ((d.series.blocked[i] ?? 0) / q) * 100) : 0}%` }} />
              </div>
            ))}
          </div>
        )}
        <ul className="mt-auto space-y-1">
          {servers.map((s) => {
            const state = serverState(s)
            return (
              <li key={s.role} className="flex items-center gap-2 min-w-0 text-xs">
                <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[state.tone]}`} />
                <span className="text-slate-300 capitalize">{s.role}</span>
                <span className="truncate text-slate-500">{s.domain ?? s.url} · {state.label}</span>
              </li>
            )
          })}
        </ul>
      </div>
    </Card>
  )
}
