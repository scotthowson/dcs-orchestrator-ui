// =============================================================================
// The card kit — what every dashboard card is made of, once: the frame, the
// header (icon, title, a line of numbers, a status chip, its buttons), the
// loading skeleton, the empty, failed and not-connected states, and the one
// way a percentage turns amber or rose. A card wears it like this:
//
//   <Card card="stack-grid" meta="3 total" open="stacks">
//     …the card's own content…
//   </Card>
//
//   Panel   the same frame for a section of a page (Health, Uptime, Trends, System …): as tall as its
//           content, an icon, a title, the same header buttons; `flush` lets a table or a list run edge to edge
//
//   Card    card       the card's id in the registry (cardRegistry.ts): its name and icon come from
//                      there, so the header, the edit-mode chip and the picker always agree
//           icon       the header icon when it changes with the state (a lucide component; drawn at 16, slate)
//           title      the name when it is not the registry's (sentence case)
//           meta       muted numbers right of the title ("3 total")
//           badge      a status chip (a Mantine Badge): Healthy · Idle · Cleanup available
//           actions    header buttons: BTN_ICON_SM + TONE_GHOST with aria-label and Hint,
//                      or a small SegmentedControl
//           open       the page the card leads to: the header gets an "Open <page>" button, and
//                      (unless clickable={false}, for a card whose list wants the mouse) the whole
//                      card is a click target as well
//           tone       'attention' (amber) or 'problem' (rose) tints the icon and the edge;
//                      a card that is fine wears no colour
//           dim        the card is offline: muted
//
// The body is whatever the card needs; a list scrolls inside <CardBody> so the
// header stays put. While the first answer is on its way a card shows
// <Skeleton/> (common/PageState, the house shimmer), when nothing is there
// <EmptyState card/> (with the next step), when the request failed
// <ErrorState card/> (with Try again), and when the dashboard is not
// connected <CardOffline/>. Colours mean what lib/tone says.
// =============================================================================

import React from 'react'
import { ArrowUpRight, Box, ServerOff, type LucideIcon } from 'lucide-react'
import { SegmentedControl } from '@mantine/core'
import type { PageId } from '../../../shared/types'
import { pageLabel } from '../../constants/pageTitles'
import { useSettingsStore } from '../../stores/settingsStore'
import Hint from '../common/Hint'
import { EmptyState } from '../common/PageState'
import { BTN_ICON_SM, TONE_GHOST, TITLE_PANEL } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'
import { cardIcon, cardTitle } from './cardRegistry'

/** the colour of each metric wherever it is drawn as a series (dashboard, Trends): identity, never status */
export const METRIC_HEX = { cpu: '#10b981', mem: '#06b6d4', disk: '#3b82f6', swap: '#94a3b8', gpu: '#22d3ee' } as const

// ── the frame ───────────────────────────────────────────────────────────────

export type CardTone = 'attention' | 'problem'

const FRAME = 'glass-card p-4 h-full min-h-0 flex flex-col animate-fade-in hover:!transform-none'
const EDGE: Record<CardTone, string> = { attention: 'border-amber-500/30', problem: 'border-rose-500/30' }
const ICON_TINT: Record<CardTone, string> = { attention: 'text-amber-400', problem: 'text-rose-400' }

interface HeaderProps {
  icon: LucideIcon
  title: string
  meta?: React.ReactNode
  badge?: React.ReactNode
  actions?: React.ReactNode
  open?: PageId
  tone?: CardTone
  /** no space under the header (a panel whose body runs edge to edge draws its own) */
  bare?: boolean
  /** a page's panel: the buttons wrap under the title on a narrow screen instead of squeezing it */
  wrap?: boolean
  /** the heading's id (a panel a link or a tab points to) */
  titleId?: string
}

/** the header every card wears (Card draws it; a card with a frame of its own can use it directly) */
export function CardHeader({ icon: Icon, title, meta, badge, actions, open, tone, bare = false, wrap = false, titleId }: HeaderProps) {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  return (
    <div className={`flex items-center ${wrap ? 'flex-wrap gap-x-2 gap-y-2' : 'gap-2'} ${bare ? '' : 'mb-3'} min-h-8 sm:min-h-7`}>
      <Icon size={16} className={`shrink-0 ${tone ? ICON_TINT[tone] : 'text-slate-400'}`} aria-hidden />
      <h2 id={titleId} className={`min-w-0 flex-1 ${wrap ? 'min-w-[10rem]' : 'truncate'} ${TITLE_PANEL}`} title={wrap ? undefined : title}>{title}</h2>
      {(meta || badge || actions || open) && (
        <div className={`flex items-center gap-1.5 ${wrap ? 'flex-wrap justify-end' : 'shrink-0'}`}>
          {meta && <span className="text-xs text-slate-500 tabular-nums whitespace-nowrap">{meta}</span>}
          {badge}
          {actions}
          {open && (
            <Hint label={`Open ${pageLabel(open)}`}>
              <button
                type="button"
                aria-label={`Open ${pageLabel(open)}`}
                onClick={(e) => { e.stopPropagation(); setCurrentPage(open) }}
                className={`${BTN_ICON_SM} ${TONE_GHOST}`}
              >
                <ArrowUpRight size={14} />
              </button>
            </Hint>
          )}
        </div>
      )}
    </div>
  )
}

export function Card({ card, icon, title, meta, badge, actions, open, clickable = true, tone, dim = false, className = '', children }: Omit<HeaderProps, 'icon' | 'title'> & {
  card?: string
  icon?: LucideIcon
  title?: string
  /** with `open`: the whole card opens the page on a click (default), not only the header button */
  clickable?: boolean
  dim?: boolean
  className?: string
  children: React.ReactNode
}) {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  return (
    <div
      className={`${FRAME} ${tone ? EDGE[tone] : ''} ${open && clickable ? 'cursor-pointer hover:border-white/10' : ''} ${dim ? 'opacity-60' : ''} ${className}`}
      onClick={open && clickable ? () => setCurrentPage(open) : undefined}
    >
      <CardHeader icon={icon ?? (card ? cardIcon(card) : Box)} title={title ?? (card ? cardTitle(card) : '')} meta={meta} badge={badge} actions={actions} open={open} tone={tone} />
      {children}
    </div>
  )
}

/**
 * A section of a page: the page card (lib/pageKit CARD) with the header every card wears, as tall as its
 * content; `sub` is a sentence under the title, `flush` lets the body run edge to edge (a table, a list of
 * rows) under a header of its own, `id` makes it a place a link can point to.
 */
export function Panel({ id, icon, title, sub, meta, badge, actions, open, tone, flush = false, className = '', children }: Omit<HeaderProps, 'bare' | 'wrap' | 'titleId'> & {
  id?: string
  sub?: React.ReactNode
  flush?: boolean
  className?: string
  children: React.ReactNode
}) {
  const titleId = id ? `${id}-title` : undefined
  const header = <CardHeader icon={icon} title={title} meta={meta} badge={badge} actions={actions} open={open} tone={tone} titleId={titleId} wrap bare={flush || !!sub} />
  return (
    <section id={id} aria-labelledby={titleId} className={`${CARD} min-w-0 animate-fade-in ${flush ? 'overflow-hidden' : 'p-4 md:p-5'} ${tone ? EDGE[tone] : ''} ${className}`}>
      {flush ? (
        <div className="px-4 py-3 border-b border-white/5">
          {header}
          {sub && <div className="text-xs text-slate-500 mt-1 leading-relaxed">{sub}</div>}
        </div>
      ) : (
        <>
          {header}
          {sub && <div className="text-xs text-slate-500 mt-1 mb-4 leading-relaxed">{sub}</div>}
        </>
      )}
      {children}
    </section>
  )
}

/** the switch a card keeps in its header (Gauges · Trending, CPU · MEM): a small SegmentedControl that does not open the page the card leads to */
export function CardSwitch<T extends string>({ label, value, onChange, data }: {
  label: string
  value: T
  onChange: (v: T) => void
  data: { value: T; label: string }[]
}) {
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <SegmentedControl
        aria-label={label}
        value={value}
        onChange={(v) => onChange(v as T)}
        data={data}
        style={{ '--sc-padding': '3px 7px', '--sc-font-size': '11px' } as React.CSSProperties}
      />
    </div>
  )
}

/** a body that scrolls on its own while the header stays: room for a hover ring at the edges */
export function CardBody({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  // (no bar, no sideways scrolling: what does not fit scrolls under the wheel or a finger, and nothing can push the card wider)
  return <div className={`flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-none -mx-1 px-1 ${className}`}>{children}</div>
}

// ── states ──────────────────────────────────────────────────────────────────

/** the dashboard is not connected and the card has nothing cached */
export function CardOffline() {
  return <EmptyState card icon={<ServerOff size={22} />} title="Not connected" hint="It fills in when the dashboard reaches the server." />
}

// ── the accents a person can pick for a shortcut, a bookmark … ───────────────

/** Accent colours a user can pick; class names are spelled out so Tailwind keeps them */
export const ACCENTS: Record<string, { text: string; bg: string; ring: string; dot: string }> = {
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10 group-hover:bg-emerald-500/15', ring: 'border-emerald-500/20', dot: 'bg-emerald-400' },
  cyan:    { text: 'text-cyan-400',    bg: 'bg-cyan-500/10 group-hover:bg-cyan-500/15',       ring: 'border-cyan-500/20',    dot: 'bg-cyan-400' },
  violet:  { text: 'text-violet-400',  bg: 'bg-violet-500/10 group-hover:bg-violet-500/15',   ring: 'border-violet-500/20',  dot: 'bg-violet-400' },
  amber:   { text: 'text-amber-400',   bg: 'bg-amber-500/10 group-hover:bg-amber-500/15',     ring: 'border-amber-500/20',   dot: 'bg-amber-400' },
  rose:    { text: 'text-rose-400',    bg: 'bg-rose-500/10 group-hover:bg-rose-500/15',       ring: 'border-rose-500/20',    dot: 'bg-rose-400' },
  blue:    { text: 'text-blue-400',    bg: 'bg-blue-500/10 group-hover:bg-blue-500/15',       ring: 'border-blue-500/20',    dot: 'bg-blue-400' },
  teal:    { text: 'text-teal-400',    bg: 'bg-teal-500/10 group-hover:bg-teal-500/15',       ring: 'border-teal-500/20',    dot: 'bg-teal-400' },
  orange:  { text: 'text-orange-400',  bg: 'bg-orange-500/10 group-hover:bg-orange-500/15',   ring: 'border-orange-500/20',  dot: 'bg-orange-400' },
  pink:    { text: 'text-pink-400',    bg: 'bg-pink-500/10 group-hover:bg-pink-500/15',       ring: 'border-pink-500/20',    dot: 'bg-pink-400' },
  slate:   { text: 'text-slate-300',   bg: 'bg-slate-500/10 group-hover:bg-slate-500/15',     ring: 'border-slate-500/20',   dot: 'bg-slate-400' },
}
export const ACCENT_NAMES = Object.keys(ACCENTS)

/** Props every card receives from the grid (all optional so existing cards stay untouched) */
export interface CardCommonProps {
  cardConfig?: unknown
  onSaveConfig?: (cfg: unknown) => Promise<boolean> | void
  dashboardEditMode?: boolean
}
