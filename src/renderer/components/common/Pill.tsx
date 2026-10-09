// =============================================================================
// Pill — the one status chip of the dashboard: the Mantine Badge as lib/mantine
// themes it (10 px, normal case, a hairline border in its colour), coloured by a
// tone (lib/tone.ts), never by a colour name. A container's own state has its
// richer StateChip (common/StateChip); everything else is a Pill.
//
//   <Pill tone="ok" dot>Running</Pill>
//   <Pill tone="attention" icon={<AlertTriangle size={10} />} title="…">2 to update</Pill>
//
//   tone   ok · attention · problem · info · neutral (default) · fleet
//   dot    a small dot in front (a live state); icon: an icon instead (10 px)
//   title  a hint for a mouse (the text itself must say what it is)
//
// Dot is the same dot on its own, in front of a line of text.
// =============================================================================

import { forwardRef, type ReactNode } from 'react'
import { Badge } from '@mantine/core'
import { TONE_COLOR, TONE_DOT, type Tone } from '../../lib/tone'

export interface PillProps {
  tone?: Tone
  dot?: boolean
  icon?: ReactNode
  title?: string
  /** xs in a dense table row, md beside a page or a sheet title; sm (the default) everywhere else */
  size?: 'xs' | 'sm' | 'md'
  className?: string
  children: ReactNode
}

/** (it forwards its ref, so a Hint or a Tooltip can wrap it) */
export const Pill = forwardRef<HTMLSpanElement, PillProps>(function Pill({ tone = 'neutral', dot = false, icon, title, size, className, children, ...rest }, ref) {
  return (
    <Badge
      ref={ref}
      component="span"
      color={TONE_COLOR[tone]}
      title={title}
      size={size}
      className={className}
      leftSection={dot ? <span aria-hidden className={`block w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} /> : icon}
      {...rest}
    >
      {children}
    </Badge>
  )
})

export function Dot({ tone = 'neutral', pulse = false, className = '' }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]} ${pulse ? 'animate-pulse' : ''} ${className}`} />
}

/** the bubble's shape (18 px, 10 px bold figures): the sidebar's and the section strip's counts wear it too */
export const COUNT_SHAPE = 'inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold leading-none tabular-nums shrink-0'

const COUNT: Record<Tone, string> = {
  ok: 'bg-emerald-500/20 text-emerald-400', attention: 'bg-amber-500/20 text-amber-400', problem: 'bg-rose-500/20 text-rose-400',
  info: 'bg-cyan-500/20 text-cyan-400', neutral: 'bg-white/10 text-slate-300', fleet: 'bg-violet-500/20 text-violet-300',
}

/**
 * A number in a bubble beside a tab, a section or a heading (3 problems, 12 to update). `label` says it in
 * words for a screen reader and the hint ("3 errors"). The red dot-count on an icon (unread notifications) is
 * the same bubble with `alert`: solid rose, ringed against what it sits on.
 */
export function Count({ n, tone = 'neutral', label, alert = false, className = '' }: { n: number | string; tone?: Tone; label?: string; alert?: boolean; className?: string }) {
  const look = alert ? 'bg-rose-500 text-white ring-2 ring-slate-900' : COUNT[tone]
  return (
    <span title={label} className={`${COUNT_SHAPE} ${look} ${className}`}>
      {label ? <><span aria-hidden>{n}</span><span className="sr-only">{label}</span></> : n}
    </span>
  )
}
