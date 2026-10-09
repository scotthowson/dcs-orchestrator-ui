// =============================================================================
// The two small charts the CrowdSec page draws itself (no chart library):
//   TimelineChart  bars per time bucket, hover or focus reads the bucket out
//   BarRow         a label, a proportional bar and a number: rankings
// Colours are currentColor / Tailwind classes the theme engine re-maps.
// =============================================================================

import { useMemo, useState, type ReactNode } from 'react'

import { type Tone } from '../../lib/tone'
export interface TimelinePoint { t: number; alerts: number; events: number }

/** epoch seconds → the axis label that suits the bucket size */
function tick(t: number, bucketSeconds: number): string {
  const d = new Date(t * 1000)
  if (bucketSeconds < 86400 / 2) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (bucketSeconds < 86400) return d.toLocaleString([], { weekday: 'short', hour: '2-digit' })
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
function tickLong(t: number, bucketSeconds: number): string {
  const d = new Date(t * 1000)
  if (bucketSeconds < 86400) return d.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  return d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })
}

export function TimelineChart({ points, bucketSeconds, height = 132, empty }: { points: TimelinePoint[]; bucketSeconds: number; height?: number; empty?: ReactNode }) {
  const [hot, setHot] = useState<number | null>(null)
  const { max, total, peak } = useMemo(() => {
    let m = 0, tot = 0, pk = 0
    points.forEach((p, i) => { tot += p.alerts; if (p.alerts > m) { m = p.alerts; pk = i } })
    return { max: m, total: tot, peak: pk }
  }, [points])
  if (points.length === 0) return <div className="text-xs text-slate-500 py-8 text-center">{empty ?? 'Nothing to draw yet.'}</div>
  const n = points.length
  const gap = n > 40 ? 1 : 2
  const w = 1000
  const bw = (w - gap * (n - 1)) / n
  const scale = max > 0 ? (height - 8) / Math.max(max, 3) : 0
  const cur = hot !== null ? points[hot] : null
  const label = `${total} detection${total === 1 ? '' : 's'}${max > 0 ? `, busiest ${tick(points[peak].t, bucketSeconds)} with ${max}` : ''}`
  return (
    <div>
      <div className="h-5 mb-1 text-[11px] text-slate-500 tabular-nums flex items-center justify-between gap-2" aria-live="off">
        {cur
          ? <span className="text-slate-300"><span className="text-slate-500">{tickLong(cur.t, bucketSeconds)}</span> · {cur.alerts} detection{cur.alerts === 1 ? '' : 's'} · {cur.events} request{cur.events === 1 ? '' : 's'}</span>
          : <span>{max > 0 ? `Busiest: ${tickLong(points[peak].t, bucketSeconds)} · ${max}` : ''}</span>}
      </div>
      <svg role="img" aria-label={label} viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="w-full block text-emerald-400" style={{ height }}>
        {[0.25, 0.5, 0.75].map((f) => <line key={f} x1="0" x2={w} y1={height - f * (height - 8)} y2={height - f * (height - 8)} stroke="currentColor" strokeOpacity="0.07" strokeWidth="1" vectorEffect="non-scaling-stroke" />)}
        <line x1="0" x2={w} y1={height - 0.5} y2={height - 0.5} stroke="currentColor" strokeOpacity="0.18" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {points.map((p, i) => {
          const h = p.alerts > 0 ? Math.max(3, p.alerts * scale) : 0
          const x = i * (bw + gap)
          return (
            <g key={p.t} onMouseEnter={() => setHot(i)} onMouseLeave={() => setHot(null)} onFocus={() => setHot(i)} onBlur={() => setHot(null)} tabIndex={p.alerts > 0 ? 0 : -1} aria-label={`${tickLong(p.t, bucketSeconds)}: ${p.alerts} detections`}>
              <rect x={x} y={0} width={bw + gap} height={height} fill="transparent" />
              {h > 0 && <rect x={x} y={height - h} width={bw} height={h} rx="1.5" fill="currentColor" fillOpacity={hot === i ? 0.95 : 0.55} />}
            </g>
          )
        })}
      </svg>
      <div className="flex justify-between text-[10px] text-slate-500 mt-1 tabular-nums select-none">
        <span>{tick(points[0].t, bucketSeconds)}</span>
        {n > 8 && <span className="hidden sm:inline">{tick(points[Math.floor(n / 2)].t, bucketSeconds)}</span>}
        <span>{tick(points[n - 1].t, bucketSeconds)}</span>
      </div>
    </div>
  )
}

/** a ranked row: [label] ████░░░ [value]; the bar is a share of `max` */
export function BarRow({ label, sub, value, max, valueLabel, tone = 'ok', onClick, title, extra }: {
  label: ReactNode; sub?: ReactNode; value: number; max: number; valueLabel?: ReactNode; tone?: Tone; onClick?: () => void; title?: string; extra?: ReactNode
}) {
  const pct = max > 0 ? Math.max(value > 0 ? 3 : 0, Math.round((value / max) * 100)) : 0
  const fill = tone === 'problem' ? 'bg-rose-500/45' : tone === 'attention' ? 'bg-amber-500/45' : tone === 'info' ? 'bg-cyan-500/45' : tone === 'neutral' || tone === 'fleet' ? 'bg-slate-500/40' : 'bg-emerald-500/45'
  const inner = (
    <>
      <div className="flex items-center justify-between gap-3 min-w-0">
        <div className="min-w-0 flex items-center gap-2">{label}</div>
        <div className="flex items-center gap-2 shrink-0">{extra}<span className="text-xs text-slate-300 tabular-nums font-medium">{valueLabel ?? value}</span></div>
      </div>
      {sub && <div className="text-[11px] text-slate-500 truncate mt-0.5">{sub}</div>}
      <div className="h-1 rounded-full bg-white/5 mt-1.5 overflow-hidden"><div className={`h-full rounded-full ${fill}`} style={{ width: `${pct}%` }} /></div>
    </>
  )
  if (onClick) return <button type="button" title={title} onClick={onClick} className="block w-full text-left rounded-lg px-2 py-1.5 -mx-2 hover:bg-white/[0.04] transition-colors">{inner}</button>
  return <div title={title} className="py-1.5">{inner}</div>
}
