// =============================================================================
// PageHeader — the top of every page: the page's icon in the accent tile, its
// name as the page's one <h1>, a line saying what is going on, the buttons on
// the right. The name, the icon and the default line come from the page
// registry (constants/pageTitles.ts), so the heading always says what the
// sidebar, the breadcrumb and the command palette say.
//
//   <PageHeader page="proxmox" badge={<Pill …>hub</Pill>} subtitle="3 of 5 guests running"
//     actions={<><button className={BTN_TOOLBAR_QUIET}>Refresh</button></>}>
//     <FleetScopeChips … />        // children: what sits under the line (scope chips, filters)
//   </PageHeader>
//
//   page      which page: its label, icon and subtitle. Required.
//   title     replaces the label in the <h1> (rare: the page is showing one thing of its own).
//   subtitle  replaces the registry's line: text, or a node for live numbers; null shows no line.
//   icon      replaces the page's icon.
//   badge     beside the name: a status chip, a count, the VM the page is scoped to (VmCapsule).
//   actions   the buttons on the right (a fragment of BTN_TOOLBAR* buttons); on a phone they
//             wrap under the name, on a desktop they wrap among themselves.
//   children  under the line.
//
// Sizes: the name is text-2xl from md up and text-xl on a phone (the phone's top bar
// carries the name too); the tile is 40 px, 44 from md up.
// =============================================================================

import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { pageMeta } from '../../constants/pageTitles'
import type { PageId } from '../../../shared/types'

export interface PageHeaderProps {
  page: PageId
  title?: ReactNode
  subtitle?: ReactNode
  icon?: LucideIcon
  badge?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}

export default function PageHeader({ page, title, subtitle, icon, badge, actions, children, className = '' }: PageHeaderProps) {
  const meta = pageMeta[page]
  const Icon = icon ?? meta.icon
  const line = subtitle === undefined ? meta.subtitle : subtitle
  const hasLine = line !== null && line !== false && line !== ''
  return (
    <div className={`flex flex-wrap items-start gap-x-4 gap-y-3 ${className}`}>
      <div className="flex min-w-0 flex-1 basis-[16rem] items-start gap-3">
        <span
          className="mt-0.5 flex h-10 w-10 md:h-11 md:w-11 shrink-0 items-center justify-center rounded-xl border accent-bg-subtle accent-text"
          style={{ borderColor: 'rgb(var(--color-accent) / 0.15)' }}
          aria-hidden
        >
          <Icon size={20} strokeWidth={2} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-100">{title ?? meta.label}</h1>
            {badge}
          </div>
          {hasLine && <p className="mt-1 text-sm text-slate-400 tabular-nums">{line}</p>}
          {children && <div className="mt-2">{children}</div>}
        </div>
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">{actions}</div>}
    </div>
  )
}
