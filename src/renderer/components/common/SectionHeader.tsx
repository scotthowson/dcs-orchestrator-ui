// =============================================================================
// SectionHeader — the small capitals above a group of rows, fields or cards
// (lib/ui SECTION_LABEL), with an optional icon (12), a count and controls on the
// right. A panel's own title is TITLE_PANEL; a page's is PageHeader's.
//
//   <SectionHeader icon={Shield} title="Bouncers" count={3} right={<button …>Add</button>} />
// =============================================================================

import type { ElementType, ReactNode } from 'react'
import { SECTION_LABEL } from '../../lib/ui'

export default function SectionHeader({ icon: Icon, title, count, right, as: Tag = 'h2', id, className = '' }: {
  icon?: ElementType
  title: ReactNode
  count?: ReactNode
  right?: ReactNode
  as?: 'h2' | 'h3' | 'h4'
  id?: string
  className?: string
}) {
  return (
    <div className={`flex items-center justify-between gap-2 flex-wrap ${className}`}>
      <Tag id={id} className={`${SECTION_LABEL} flex items-center gap-2 min-w-0`}>
        {Icon && <Icon size={12} className="shrink-0" aria-hidden />}
        <span className="truncate">{title}</span>
        {count !== undefined && count !== null && <span className="text-slate-500 tabular-nums normal-case tracking-normal font-normal">{count}</span>}
      </Tag>
      {right}
    </div>
  )
}
