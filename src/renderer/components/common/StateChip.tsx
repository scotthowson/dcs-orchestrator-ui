// =============================================================================
// StateChip / StateDot / AsleepNote — how a container's state looks, the same on
// every page (lib/containerState.ts decides the state). Asleep on demand is indigo
// with a moon; "can't wake" (Sablier not running) is amber with the same moon.
// =============================================================================

import React from 'react'
import { Moon } from 'lucide-react'
import { ContainerStateKey, STATE_META, ASLEEP_HINT, StackStateInput, stackState, STACK_META } from '../../lib/containerState'

const SIZES = {
  xs: { pill: 'h-5 px-2 text-[10px] gap-1', dot: 'h-1 w-1', moon: 9 },
  sm: { pill: 'h-6 px-2.5 text-xs gap-1.5', dot: 'h-1.5 w-1.5', moon: 11 },
} as const

interface ChipProps {
  state: ContainerStateKey
  size?: keyof typeof SIZES
  /** the word to show instead of the state's own (Docker's raw state, say) — asleep and can't wake keep theirs */
  label?: string
  /** asleep / can't wake: add "· on demand" after the word */
  onDemandTag?: boolean
  title?: string
  onClick?: (e: React.MouseEvent) => void
  className?: string
}

export function StateChip({ state, size = 'sm', label, onDemandTag = true, title, onClick, className = '' }: ChipProps) {
  const m = STATE_META[state]
  const z = SIZES[size]
  const sleepy = state === 'asleep' || state === 'stuck'
  const cls = `inline-flex items-center ${z.pill} rounded-full font-medium leading-none ring-1 whitespace-nowrap ${m.bg} ${m.text} ${m.ring} ${className}`
  const body = (
    <>
      {sleepy
        ? <Moon size={z.moon} aria-hidden className="shrink-0" />
        : <span className={`${z.dot} shrink-0 rounded-full ${m.dot} ${state === 'running' ? 'animate-pulse' : ''}`} aria-hidden />}
      {sleepy ? m.label : (label ?? m.label)}
      {sleepy && onDemandTag && <span className="font-normal opacity-80">· on demand</span>}
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={(e) => { e.stopPropagation(); onClick(e) }} title={title ?? m.hint} className={`${cls} relative after:absolute after:inset-x-0 after:-inset-y-1 after:content-[''] hover:brightness-125 transition`}>
        {body}
      </button>
    )
  }
  return <span className={cls} title={title ?? m.hint}>{body}</span>
}

/** the small dot of a state (a moon for asleep) */
export function StateDot({ state, size = 8, className = '' }: { state: ContainerStateKey; size?: number; className?: string }) {
  const m = STATE_META[state]
  if (state === 'asleep' || state === 'stuck') {
    return <Moon size={size + 2} aria-label={m.label} className={`shrink-0 ${m.text} ${className}`} />
  }
  return <span aria-label={m.label} className={`inline-block shrink-0 rounded-full ${m.dot} ${className}`} style={{ width: size, height: size }} />
}

/** "· 2 asleep" in a count line: indigo, with the hint */
export function AsleepCount({ n, stuck = 0, className = '' }: { n: number; stuck?: number; className?: string }) {
  if (n <= 0 && stuck <= 0) return null
  return (
    <>
      {n > 0 && (
        <span className={`inline-flex items-center gap-1 text-indigo-300 ${className}`} title={ASLEEP_HINT}>
          <Moon size={10} aria-hidden className="shrink-0" />{n} asleep
        </span>
      )}
      {stuck > 0 && (
        <span className={`inline-flex items-center gap-1 text-amber-400 ${className}`} title={STATE_META.stuck.hint}>
          <Moon size={10} aria-hidden className="shrink-0" />{stuck} can&apos;t wake
        </span>
      )}
    </>
  )
}

/** a stack's dot: emerald running, amber partly down, a moon asleep on demand, slate stopped */
export function StackDot({ stack, size = 6, className = '' }: { stack: StackStateInput; size?: number; className?: string }) {
  const k = stackState(stack)
  const m = STACK_META[k]
  if (k === 'asleep' || k === 'stuck') return <Moon size={size + 4} aria-label={m.label} className={`shrink-0 ${m.text} ${className}`} />
  return <span aria-label={m.label} className={`inline-block shrink-0 rounded-full ${m.dot} ${className}`} style={{ width: size, height: size }} />
}
