// =============================================================================
// PageState — the one way the dashboard shows "loading", "nothing here" and
// "failed": same spacing, same typography, the same "Try again".
//
//   Skeleton      while the first answer is on its way and the shape is known (a list, a table, tiles,
//                 a chart): the house shimmer in that shape. Every list and table loads this way.
//   LoadingState  while it is on its way and the shape is not known (a spinner and a line)
//   EmptyState    nothing to show: what this is and, when there is one, the next step (an action)
//   ErrorState    the request failed before anything arrived: what failed, why, Try again
//
// Sizes: a page's (the default), `compact` inside a panel or a table, `card` inside a dashboard card
// (it fills the card's body). Icons of an empty state: 28 on a page, 24 compact, 20 in a card.
// =============================================================================

import type { ReactNode } from 'react'
import { Loader2, RefreshCw, AlertTriangle } from 'lucide-react'
import { BTN_CARD_QUIET, BTN_TOOLBAR_QUIET } from '../../lib/ui'

export function LoadingState({ label = 'Loading…', hint, compact = false }: { label?: string; hint?: string; compact?: boolean }) {
  return (
    <div className={`flex flex-col items-center justify-center ${compact ? 'py-8 gap-2' : 'py-20 gap-3'} animate-fade-in`} role="status" aria-live="polite">
      <Loader2 size={compact ? 20 : 26} className="animate-spin text-emerald-500/60" aria-hidden />
      <p className="text-sm text-slate-500">{label}</p>
      {hint && <p className="text-xs text-slate-500/80 max-w-md text-center">{hint}</p>}
    </div>
  )
}

export function EmptyState({ icon, title, hint, action, compact = false, card = false }: {
  icon?: ReactNode
  title: string
  hint?: ReactNode
  action?: ReactNode
  compact?: boolean
  /** inside a dashboard card: fills the card's body */
  card?: boolean
}) {
  const box = card ? 'flex-1 min-h-0 py-3 gap-1.5' : compact ? 'py-10 gap-2' : 'py-20 gap-2'
  return (
    <div className={`flex flex-col items-center justify-center text-center animate-fade-in ${box}`}>
      {icon && <div className="text-slate-500 mb-1" aria-hidden>{icon}</div>}
      <p className="text-sm text-slate-400">{title}</p>
      {hint && <p className={`text-xs text-slate-500 ${card ? 'max-w-[34ch]' : 'max-w-md'}`}>{hint}</p>}
      {action && <div className={card ? 'mt-1.5' : 'mt-3'}>{action}</div>}
    </div>
  )
}

export function ErrorState({ title = 'Could not load this', error, onRetry, card = false }: {
  title?: string
  error?: Error | string | null
  onRetry?: () => void
  /** inside a dashboard card: no frame of its own, fills the card's body */
  card?: boolean
}) {
  const message = typeof error === 'string' ? error : error?.message
  if (card) {
    return (
      <div className="flex-1 min-h-0 flex flex-col items-center justify-center gap-2 py-3 text-center" role="alert">
        <AlertTriangle size={18} className="text-rose-400" aria-hidden />
        <p className="text-sm text-slate-400">{title}</p>
        {message && <p className="text-xs text-slate-500 max-w-[34ch] break-words">{message}</p>}
        {onRetry && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onRetry() }} className={BTN_CARD_QUIET}>
            <RefreshCw size={12} aria-hidden /> Try again
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="bg-slate-900/60 backdrop-blur-md border border-rose-500/15 rounded-xl p-6 text-center animate-fade-in" role="alert">
      <AlertTriangle size={26} className="text-rose-500/50 mx-auto mb-3" aria-hidden />
      <p className="text-sm text-slate-400 mb-1">{title}</p>
      {message && <p className="text-xs text-slate-500 mb-4 break-words">{message}</p>}
      {onRetry && (
        <div className="flex justify-center">
          <button type="button" onClick={onRetry} className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} aria-hidden /> Try again
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * The house shimmer in the shape of what is coming: `rows` lines of a list or a table (default), `tiles`
 * (a grid of small cards), `cards` (a grid of page cards) or a `chart` block. A screen reader hears the label.
 */
export function Skeleton({ label = 'Loading…', rows = 3, variant = 'rows', className = '' }: {
  label?: string
  rows?: number
  variant?: 'rows' | 'tiles' | 'cards' | 'chart'
  className?: string
}) {
  return (
    <div role="status" aria-live="polite" className={`flex-1 min-h-0 ${className}`}>
      <span className="sr-only">{label}</span>
      {variant === 'chart' ? (
        <div className="skeleton h-full min-h-16 w-full" aria-hidden />
      ) : variant === 'tiles' ? (
        <div className="grid grid-cols-2 gap-2" aria-hidden>
          {Array.from({ length: Math.max(2, rows) }).map((_, i) => <div key={i} className="skeleton h-12" />)}
        </div>
      ) : variant === 'cards' ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3" aria-hidden>
          {Array.from({ length: Math.max(1, rows) }).map((_, i) => <div key={i} className="skeleton h-32 rounded-xl" />)}
        </div>
      ) : (
        <div className="space-y-2" aria-hidden>
          {Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-7" style={{ width: `${100 - (i % 3) * 12}%` }} />)}
        </div>
      )}
    </div>
  )
}

/** one shimmering block of a hand-shaped skeleton (a table row's cell, a tile) */
export function SkeletonBlock({ className = '' }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton rounded-lg ${className}`} />
}
