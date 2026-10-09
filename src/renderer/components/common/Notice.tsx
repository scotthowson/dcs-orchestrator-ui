// =============================================================================
// Notice — the one boxed message of the dashboard: what happened or what to know,
// in a sentence or two, tinted by its tone (lib/tone), with an optional button
// and an optional ✕. A page-wide problem is a Notice at the top of the page; a
// field's problem is a line under the field, not a Notice.
//
//   <Notice tone="attention" title="The bouncer key is stale">Register it again …</Notice>
//   <Notice tone="problem" role="alert" title="Could not save" action={<button …>Try again</button>} />
//
//   tone     attention (default) · problem · info · ok · neutral
//   icon     replaces the tone's icon (a lucide component)
//   title    the headline (14 px); without one the text below is the message
//   role     'alert' for a failure that just happened, 'status' for a state
// =============================================================================

import type { ReactNode } from 'react'
import { AlertTriangle, CircleAlert, CircleCheck, Info, type LucideIcon } from 'lucide-react'
import { TONE_TEXT, type Tone } from '../../lib/tone'
import CloseButton from './CloseButton'

const BOX: Record<Tone, string> = {
  ok: 'bg-emerald-500/10 border-emerald-500/20',
  attention: 'bg-amber-500/10 border-amber-500/20',
  problem: 'bg-rose-500/10 border-rose-500/20',
  info: 'bg-cyan-500/10 border-cyan-500/20',
  neutral: 'bg-white/[0.03] border-white/10',
  fleet: 'bg-violet-500/10 border-violet-500/20',
}
const ICON: Record<Tone, LucideIcon> = { ok: CircleCheck, attention: AlertTriangle, problem: CircleAlert, info: Info, neutral: Info, fleet: Info }

export default function Notice({ tone = 'attention', icon, title, children, action, role, onDismiss, className = '' }: {
  tone?: Tone
  icon?: LucideIcon
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  role?: 'alert' | 'status'
  onDismiss?: () => void
  className?: string
}) {
  const Icon = icon ?? ICON[tone]
  return (
    <div role={role} className={`rounded-lg border px-3 py-2.5 flex items-start gap-2.5 ${BOX[tone]} ${className}`}>
      <Icon size={16} className={`${tone === 'neutral' ? 'text-slate-500' : TONE_TEXT[tone]} shrink-0 mt-0.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        {title && <p className="text-sm text-slate-100 leading-snug break-words">{title}</p>}
        {children && <div className={`text-xs text-slate-300 leading-relaxed break-words ${title ? 'mt-1' : 'mt-px'}`}>{children}</div>}
        {action && <div className="mt-2 flex items-center gap-2 flex-wrap">{action}</div>}
      </div>
      {onDismiss && (
        <CloseButton size="sm" label="Dismiss" onClick={onDismiss} className="-my-1 -mr-1" />
      )}
    </div>
  )
}
