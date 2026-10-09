// =============================================================================
// Segmented — one choice among a few (a filter, a view, a time window): Mantine's
// SegmentedControl as lib/mantine themes it, in the row every page puts it in. A
// row too long for a phone scrolls sideways inside itself (never the page) and
// keeps the chosen option in view. Options may carry an icon (12) and a count.
//
//   <Segmented ariaLabel="Show" value={filter} onChange={setFilter}
//     options={[{ value: 'all', label: 'All', count: 12 }, { value: 'running', label: 'Running', icon: Play }]} />
// =============================================================================

import { useEffect, useRef, type ElementType, type ReactNode } from 'react'
import { SegmentedControl } from '@mantine/core'

export interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
  count?: number | string
  title?: string
  disabled?: boolean
  icon?: ElementType
}

export default function Segmented<T extends string>({ value, options, onChange, ariaLabel, className = '', fullWidth = false }: {
  value: T
  options: SegmentedOption<T>[]
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
  fullWidth?: boolean
}) {
  const box = useRef<HTMLDivElement>(null)
  const first = useRef(true)
  useEffect(() => {
    const c = box.current
    const on = c?.querySelector<HTMLElement>('[data-active]')
    if (c && on && c.scrollWidth > c.clientWidth) {
      const left = on.getBoundingClientRect().left - c.getBoundingClientRect().left + c.scrollLeft
      c.scrollTo({ left: left - (c.clientWidth - on.offsetWidth) / 2, behavior: first.current ? 'auto' : 'smooth' })
    }
    first.current = false
  }, [value])
  return (
    <div ref={box} className={`min-w-0 max-w-full overflow-x-auto scrollbar-none ${className}`}>
      <SegmentedControl
        aria-label={ariaLabel}
        value={value}
        onChange={(v) => onChange(v as T)}
        fullWidth={fullWidth}
        data={options.map((o) => {
          const Icon = o.icon
          return {
            value: o.value,
            disabled: o.disabled,
            label: (
              <span className="inline-flex items-center gap-1.5 whitespace-nowrap" title={o.title}>
                {Icon && <Icon size={12} aria-hidden />}
                {o.label}
                {o.count !== undefined && <span className="tabular-nums text-[10px] opacity-75">{o.count}</span>}
              </span>
            ),
          }
        })}
      />
    </div>
  )
}
