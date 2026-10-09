// =============================================================================
// StatusLine — one line of a checklist or a status card: a symbol in the tone of
// the answer (lib/tone), what was checked, what was found, and a button when
// there is something to do. A screen reader hears the verdict first ("Fine:",
// "Needs attention:", "Problem:", "Note:"), since the colour says it to the eye.
//
//   <ul><StatusLine as="li" tone="ok" title="Docker answers">Docker 27.3</StatusLine></ul>
//   <StatusLine tone="attention" title="The bouncer key is stale" action={<button …>Register again</button>}>…</StatusLine>
//
//   dense   the compact line of a long checklist: 12 px text, the explanation after a dot
// =============================================================================

import type { ElementType, ReactNode } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from 'lucide-react'
import { TONE_TEXT, type Tone } from '../../lib/tone'

const ICON: Record<Tone, ElementType> = { ok: CircleCheck, attention: TriangleAlert, problem: CircleAlert, info: Info, neutral: Info, fleet: Info }
const VERDICT: Record<Tone, string> = { ok: 'Fine: ', attention: 'Needs attention: ', problem: 'Problem: ', info: 'Note: ', neutral: 'Note: ', fleet: 'Note: ' }

export default function StatusLine({ tone, title, children, action, icon, dense = false, as: Tag = 'div' }: {
  tone: Tone
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  icon?: ElementType
  dense?: boolean
  as?: 'div' | 'li'
}) {
  const Icon = icon ?? ICON[tone]
  const color = tone === 'neutral' ? 'text-slate-500' : TONE_TEXT[tone]
  if (dense) {
    return (
      <Tag className="flex items-start gap-2 py-1">
        <Icon size={14} className={`${color} shrink-0 mt-px`} aria-hidden="true" />
        <p className="text-xs text-slate-300 min-w-0 leading-snug"><span className="sr-only">{VERDICT[tone]}</span>{title}{children ? <span className="text-slate-500"> · {children}</span> : null}</p>
      </Tag>
    )
  }
  return (
    <Tag className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0 min-w-0">
      <Icon size={16} className={`${color} shrink-0 mt-0.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 leading-snug break-words"><span className="sr-only">{VERDICT[tone]}</span>{title}</p>
        {children && <div className="text-xs text-slate-500 mt-0.5 leading-relaxed break-words">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </Tag>
  )
}
