// =============================================================================
// StatTile — one number with its name, the same on every page that leads with
// a row of numbers (Health, Uptime, Trends, Volumes, Networks, Disk analysis,
// Containers, Images, CrowdSec): the icon in a tile of its tone, the name in small
// capitals, the value, a line under it. The tile is the page's quiet surface
// (lib/pageKit CARD). The tone colours the icon's tile; the value itself takes a
// colour only for a verdict that needs a look (attention, problem) — a number
// that is fine stays plain (lib/tone).
//
//   <StatTile icon={Database} label="Total volumes" value={12} sub="3 unused" />
//   <StatTile icon={Ban} label="Active bans" short="Bans" value={n} tone="problem" onClick={() => goTab('bans')} />
//
//   short    the name on a phone, where three tiles share a row (the icon and the line under it wait for a wider screen)
//   onClick  the tile is a button that leads to the detail (a hint in `title`); its edge firms up under the pointer
//   iconClass  the icon tile's colours when no tone says it (the indigo of "asleep on demand")
//   loading  the first answer is on its way: a shimmer the size of the value, so nothing jumps when it lands
// =============================================================================

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TONE_TEXT, TONE_TILE, type Tone } from '../../lib/tone'
import { FOCUS_RING } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'

export default function StatTile({ icon: Icon, label, short, value, sub, tone = 'neutral', onClick, title, iconClass, loading = false, className = '' }: {
  icon?: LucideIcon
  label: string
  short?: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  onClick?: () => void
  title?: string
  iconClass?: string
  loading?: boolean
  className?: string
}) {
  const verdict = tone === 'attention' || tone === 'problem'
  const inner = (
    <>
      {Icon && (
        <span aria-hidden className={`h-9 w-9 shrink-0 items-center justify-center rounded-lg ${short ? 'hidden sm:flex' : 'flex'} ${iconClass ?? TONE_TILE[tone]}`}>
          <Icon size={18} />
        </span>
      )}
      <div className="min-w-0">
        <p className="text-[10px] sm:text-[11px] font-medium leading-4 text-slate-500 uppercase tracking-wider truncate">
          {short ? <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></> : label}
        </p>
        {loading
          ? <div aria-hidden className="skeleton mt-0.5 h-7 md:h-8 w-12 rounded-md" />
          : <p className={`mt-0.5 text-xl md:text-2xl leading-7 md:leading-8 font-semibold tracking-tight tabular-nums truncate ${verdict ? TONE_TEXT[tone] : 'text-slate-100'}`}>{value}</p>}
        {sub !== undefined && sub !== null && sub !== false && <p className={`text-xs leading-4 text-slate-500 truncate ${short ? 'hidden sm:block' : ''}`}>{sub}</p>}
      </div>
    </>
  )
  const cls = `${CARD} p-3 md:p-4 flex items-center gap-3 min-w-0 text-left ${className}`
  if (onClick) {
    return <button type="button" title={title} onClick={onClick} className={`${cls} hover:border-white/10 transition-colors duration-150 ${FOCUS_RING}`}>{inner}</button>
  }
  return <div title={title} className={cls}>{inner}</div>
}
