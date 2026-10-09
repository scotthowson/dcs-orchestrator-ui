// =============================================================================
// Small pieces the Updates page and its cards share: a label/value row, the
// icon tile of a card and the freshness line every card ends with. The pill is
// common/Pill; tones (lib/tone): ok = up to date, info = an update is available
// (the button that takes it is the emerald "go"), attention = needs a look,
// problem = failed, fleet = a VM, neutral = nothing known.
// =============================================================================

import type { ReactNode } from 'react'
import { Pill } from '../common/Pill'
import type { Tone } from '../../lib/tone'

/** one fact of a card: what it is (small capitals) on the left, its value on the right */
export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      {children}
    </div>
  )
}

/** the tile at the head of a card: neutral, or violet where the card is about the fleet */
export function CardIcon({ tone = 'neutral', children }: { tone?: Extract<Tone, 'neutral' | 'fleet'>; children: ReactNode }) {
  return (
    <div
      aria-hidden
      className={`w-9 h-9 shrink-0 rounded-lg border flex items-center justify-center ${tone === 'fleet' ? 'bg-violet-500/10 border-violet-500/20 text-violet-300' : 'bg-white/5 border-white/10 text-slate-300'}`}
    >
      {children}
    </div>
  )
}

/** "just now", "5m ago", "2h ago", "3d ago" for a time in milliseconds */
export function formatRelativeTime(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 10) return 'just now'
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}

/** One line every card shares: up to date or not, when it was checked, when it last changed (okTone neutral: nothing is
 *  known to be wrong, but nobody checked either — no green for a claim nobody made) */
export function FreshnessLine({ ok, okText, warnText, checkedAt, updatedAt, updatedLabel = 'Last updated', tone = 'info', okTone = 'ok' }: {
  ok: boolean; okText: string; warnText: string
  checkedAt?: number | string | null; updatedAt?: number | string | null; updatedLabel?: string; tone?: Extract<Tone, 'info' | 'attention' | 'problem'>; okTone?: Extract<Tone, 'ok' | 'neutral'>
}) {
  const toMs = (v?: number | string | null) => (!v ? 0 : typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || 0)
  const c = toMs(checkedAt); const u = toMs(updatedAt)
  return (
    <div className="flex items-center gap-x-3 gap-y-1 flex-wrap text-[10px] text-slate-500">
      <Pill tone={ok ? okTone : tone} dot>{ok ? okText : warnText}</Pill>
      <span title={c ? new Date(c).toLocaleString() : undefined}>Checked {c ? formatRelativeTime(c) : 'never'}</span>
      <span title={u ? new Date(u).toLocaleString() : undefined}>{updatedLabel} {u ? new Date(u).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : 'never'}</span>
    </div>
  )
}
