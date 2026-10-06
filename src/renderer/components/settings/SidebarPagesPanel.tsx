// =============================================================================
// SidebarPagesPanel — Settings → Sidebar & pages: which sections and pages the
// sidebar, the tab strips and the phone menu show. Nothing is removed: a hidden
// page still opens from the command palette, a link or a notification. The
// Dashboard and Settings stay, so there is always a way back here. Kept on this
// device (like the sidebar's collapse), not with the account.
// =============================================================================

import { Switch } from '@mantine/core'
import { Lock, RotateCcw } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { ADMIN_ONLY_PAGES } from '../../../shared/types'
import type { PageId } from '../../../shared/types'
import { navSections, UNHIDEABLE } from '../../constants/navSections'
import { pageMeta } from '../../constants/pageTitles'
import { BTN_TOOLBAR_QUIET } from '../../lib/ui'

export default function SidebarPagesPanel() {
  const hidden = useSettingsStore((s) => s.hiddenPages) ?? []
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'

  const save = (next: Set<PageId>) => updateSetting('hiddenPages', [...next])
  const setPages = (ids: PageId[], show: boolean) => {
    const next = new Set(hidden)
    for (const id of ids) if (!UNHIDEABLE.has(id)) (show ? next.delete(id) : next.add(id))
    save(next)
  }

  const hiddenCount = hidden.filter((p) => !UNHIDEABLE.has(p)).length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-xs text-slate-400 max-w-prose leading-relaxed">
          Hide the sections and pages you don&apos;t use. Nothing is deleted: a hidden page still opens from the command palette (Ctrl+K), a link or a notification.
          {' '}{pageMeta.dashboard.label} and {pageMeta.settings.label} always stay, so you can come back here.
        </p>
        {hiddenCount > 0 && (
          <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => save(new Set())}>
            <RotateCcw size={14} /> Show all {hiddenCount === 1 ? '' : `${hiddenCount} `}again
          </button>
        )}
      </div>

      <div className="grid gap-2 md:grid-cols-2">
        {navSections.map((section) => {
          const pages = section.pages.filter((p) => isAdmin || !ADMIN_ONLY_PAGES.has(p))
          if (!pages.length) return null
          const hideable = pages.filter((p) => !UNHIDEABLE.has(p))
          const shownCount = pages.filter((p) => UNHIDEABLE.has(p) || !hidden.includes(p)).length
          const sectionOn = shownCount > 0
          // a section with a page that always stays can't be switched off as a whole
          const sectionLocked = hideable.length < pages.length
          const Icon = section.icon
          return (
            <div key={section.id} className={`rounded-xl border px-3.5 py-3 transition-colors ${sectionOn ? 'border-white/5 bg-white/[0.02]' : 'border-white/[0.03] bg-transparent'}`}>
              <div className="flex items-center gap-2.5">
                <Icon size={16} className={sectionOn ? 'accent-text' : 'text-slate-500'} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-medium ${sectionOn ? 'text-slate-200' : 'text-slate-500'}`}>{section.label}</p>
                  <p className="text-[11px] text-slate-500 truncate">{section.hint}</p>
                </div>
                {sectionLocked ? (
                  <span className="flex items-center gap-1 text-[11px] text-slate-500" title="Always in the sidebar"><Lock size={11} aria-hidden /> Always shown</span>
                ) : (
                  <Switch
                    aria-label={`Show ${section.label} in the sidebar`}
                    checked={sectionOn}
                    onChange={(e) => setPages(hideable, e.currentTarget.checked)}
                    color="emerald"
                    size="sm"
                  />
                )}
              </div>
              {pages.length > 1 && (
                <div className="mt-2.5 flex flex-wrap gap-1.5 pl-[26px]">
                  {pages.map((id) => {
                    const locked = UNHIDEABLE.has(id)
                    const on = locked || !hidden.includes(id)
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={on}
                        disabled={locked}
                        title={locked ? 'Always shown' : on ? `Hide ${pageMeta[id].label}` : `Show ${pageMeta[id].label}`}
                        onClick={() => setPages([id], !on)}
                        className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:cursor-default ${
                          on ? 'accent-bg-subtle accent-border accent-text' : 'border-white/5 text-slate-500 line-through hover:text-slate-300'
                        }`}
                      >
                        {pageMeta[id].label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
