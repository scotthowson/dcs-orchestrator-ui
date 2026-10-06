// =============================================================================
// SectionTabs — the pages of the section you are in, as a strip over the page
// (Monitoring: Health · Uptime · Trends · …). Each tab is a page of its own
// with its own id, so everything that opens a page by id still lands on it.
// Not shown for a section of one page (Dashboard). The strip scrolls sideways
// on a phone and keeps the page you are on in view.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useNavSections } from '../../hooks/useNavSections'
import { useNavBadges } from '../../hooks/useNavBadges'
import { pageMeta } from '../../constants/pageTitles'

export function SectionTabs() {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const { current, currentPage } = useNavSections()
  const { badges } = useNavBadges()
  const stripRef = useRef<HTMLElement>(null)
  const activeRef = useRef<HTMLButtonElement>(null)

  // which edges have more tabs behind them: those fade out, so a cut-off strip reads as "scroll me"
  const [more, setMore] = useState({ left: false, right: false })
  const measure = useCallback(() => {
    const el = stripRef.current
    if (!el) return
    const left = el.scrollLeft > 2, right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setMore((m) => (m.left === left && m.right === right ? m : { left, right }))
  }, [])

  // sideways only: scrollIntoView would also move the page itself
  useEffect(() => {
    const strip = stripRef.current, tab = activeRef.current
    if (strip && tab) {
      const left = tab.offsetLeft - 8, right = tab.offsetLeft + tab.offsetWidth + 8
      if (left < strip.scrollLeft) strip.scrollLeft = left
      else if (right > strip.scrollLeft + strip.clientWidth) strip.scrollLeft = right - strip.clientWidth
    }
    measure()
  }, [currentPage, measure])

  useEffect(() => {
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [measure])

  if (!current || current.pages.length < 2) return null
  const { section, pages } = current

  return (
    <nav
      ref={stripRef}
      aria-label={`${section.label} pages`}
      onScroll={measure}
      className="relative mb-4 md:mb-5 -mx-1 overflow-x-auto scrollbar-none"
      style={more.left || more.right ? { maskImage: fade(more), WebkitMaskImage: fade(more) } : undefined}
    >
      <div className="inline-flex min-w-full items-center gap-1 rounded-xl border border-white/[0.06] bg-slate-900/50 backdrop-blur-xl p-1">
        {pages.map((id) => {
          const meta = pageMeta[id]
          const Icon = meta.icon
          const active = id === currentPage
          const badge = badges[id]
          return (
            <button
              key={id}
              ref={active ? activeRef : undefined}
              type="button"
              aria-current={active ? 'page' : undefined}
              onClick={() => (active ? setCurrentPage(id, { resetView: true }) : setCurrentPage(id))}
              className={`group relative flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors duration-150 no-drag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 ${
                active ? 'accent-bg-subtle accent-text' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'
              }`}
            >
              <Icon size={15} strokeWidth={active ? 2.2 : 1.8} className={active ? 'accent-text' : 'text-slate-500 group-hover:text-slate-400'} aria-hidden />
              {meta.label}
              {badge && (
                <span title={badge.title} className={`inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold tabular-nums ${badge.color}`}>
                  {badge.value}
                </span>
              )}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

function fade({ left, right }: { left: boolean; right: boolean }): string {
  return `linear-gradient(to right, ${left ? 'transparent 0, #000 28px' : '#000 0'}, ${right ? '#000 calc(100% - 28px), transparent 100%' : '#000 100%'})`
}

export default SectionTabs
