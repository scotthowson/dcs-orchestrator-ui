// =============================================================================
// PersistentTrends — CPU, memory and disk over the last hour, three small charts
// =============================================================================

import { TrendingUp } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import type { MetricsTrendsResponse } from '../../../shared/types'
import { Card, CardOffline, METRIC_HEX } from './cardShared'
import { pctTone, TONE_TEXT } from '../../lib/tone'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
function MiniChart({ points, color, height = 48 }: { points: number[]; color: string; height?: number }) {
  if (points.length < 2) return null
  const max = Math.max(...points, 1)
  const w = 200
  const coords = points.map((p, i) => {
    const x = (i / (points.length - 1)) * w
    const y = height - (p / max) * (height - 4)
    return `${x},${y}`
  })
  const polyline = coords.join(' ')
  const areaPath = `M0,${height} ${coords.map((c) => `L${c}`).join(' ')} L${w},${height} Z`
  const gradId = `grad-${color.replace('#', '')}`

  return (
    <svg viewBox={`0 0 ${w} ${height}`} className="w-full" style={{ height }} preserveAspectRatio="none" aria-hidden>
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.3} />
          <stop offset="100%" stopColor={color} stopOpacity={0.02} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <polyline points={polyline} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}

interface Props {
  data: MetricsTrendsResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function PersistentTrends({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  if (!isConnected && !data) return <Card card="trends" dim><CardOffline /></Card>
  if (!data && error) return <Card card="trends"><ErrorState card title="Could not load the trends" error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="trends"><Skeleton label="Loading the trends…" variant="chart" /></Card>

  const pts = data.points
  const series = [
    { label: 'CPU', values: pts.map((p) => p.cpu_pct), color: METRIC_HEX.cpu },
    { label: 'Memory', values: pts.map((p) => p.mem_pct), color: METRIC_HEX.mem },
    { label: 'Disk', values: pts.map((p) => p.disk_pct), color: METRIC_HEX.disk },
  ]

  return (
    <Card card="trends" meta={`${data.range} · ${pts.length} point${pts.length === 1 ? '' : 's'}`} open="trends">
      {pts.length < 2 ? (
        <EmptyState card icon={<TrendingUp size={22} />} title="Not enough history yet" hint="The charts fill in as the server records snapshots." />
      ) : (
        <div className="space-y-2">
          {series.map((s) => {
            const last = s.values[s.values.length - 1]
            const tone = pctTone(last)
            return (
              <div key={s.label}>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[11px] text-slate-500">{s.label}</span>
                  <span className={`text-[11px] font-medium tabular-nums ${tone === 'ok' ? 'text-slate-300' : TONE_TEXT[tone]}`}>{last.toFixed(0)}%</span>
                </div>
                <MiniChart points={s.values} color={s.color} height={32} />
              </div>
            )
          })}
        </div>
      )}
    </Card>
  )
}
