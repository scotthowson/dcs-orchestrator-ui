// =============================================================================
// StatTile — one number with its name, the same on every page that leads with
// a row of numbers (Health, Uptime, Trends, Volumes, Networks, Disk analysis,
// CrowdSec): an icon (18), the name in small capitals, the value, a line under it.
// The value takes its tone's colour only when it means something (lib/tone).
//
//   <StatTile icon={Database} label="Total volumes" value={12} sub="3 unused" />
//   <StatTile icon={Ban} label="Active bans" short="Bans" value={n} tone="problem" onClick={() => goTab('bans')} />
//
//   short    the name on a phone, where three tiles share a row (the icon and the line under it wait for a wider screen)
//   onClick  the tile is a button that leads to the detail (a hint in `title`)
// =============================================================================

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { TONE_TEXT, type Tone } from '../../lib/tone'
import { FOCUS_RING } from '../../lib/ui'

export default function StatTile({ icon: Icon, label, short, value, sub, tone = 'neutral', onClick, title, className = '' }: {
  icon?: LucideIcon
  label: string
  short?: string
  value: ReactNode
  sub?: ReactNode
  tone?: Tone
  onClick?: () => void
  title?: string
  className?: string
}) {
  const inner = (
    <>
      {Icon && <Icon size={18} className={`shrink-0 ${short ? 'hidden sm:block' : ''} ${tone === 'neutral' ? 'text-slate-400' : TONE_TEXT[tone]}`} aria-hidden />}
      <div className="min-w-0">
        <p className="text-[10px] md:text-xs text-slate-500 uppercase tracking-wide truncate">
          {short ? <><span className="sm:hidden">{short}</span><span className="hidden sm:inline">{label}</span></> : label}
        </p>
        <p className={`text-lg md:text-xl font-bold tabular-nums truncate ${tone === 'neutral' ? 'text-slate-100' : TONE_TEXT[tone]}`}>{value}</p>
        {sub !== undefined && sub !== null && sub !== false && <p className={`text-[11px] text-slate-500 truncate ${short ? 'hidden sm:block' : ''}`}>{sub}</p>}
      </div>
    </>
  )
  const cls = `glass-subtle p-3 md:p-4 flex items-center gap-3 min-w-0 text-left ${className}`
  if (onClick) {
    return <button type="button" title={title} onClick={onClick} className={`${cls} hover:bg-white/[0.06] transition-colors ${FOCUS_RING}`}>{inner}</button>
  }
  return <div title={title} className={cls}>{inner}</div>
}
