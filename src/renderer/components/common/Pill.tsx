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

import type { ReactNode } from 'react'
import { Badge } from '@mantine/core'
import { TONE_COLOR, TONE_DOT, type Tone } from '../../lib/tone'

export function Pill({ tone = 'neutral', dot = false, icon, title, className, children }: {
  tone?: Tone
  dot?: boolean
  icon?: ReactNode
  title?: string
  className?: string
  children: ReactNode
}) {
  return (
    <Badge
      component="span"
      color={TONE_COLOR[tone]}
      title={title}
      className={className}
      leftSection={dot ? <span aria-hidden className={`block w-1.5 h-1.5 rounded-full ${TONE_DOT[tone]}`} /> : icon}
    >
      {children}
    </Badge>
  )
}

export function Dot({ tone = 'neutral', pulse = false, className = '' }: { tone?: Tone; pulse?: boolean; className?: string }) {
  return <span aria-hidden="true" className={`inline-block w-2 h-2 rounded-full shrink-0 ${TONE_DOT[tone]} ${pulse ? 'animate-pulse' : ''} ${className}`} />
}
