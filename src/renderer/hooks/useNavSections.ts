// =============================================================================
// useNavSections — the sections this person sees and the pages shown in each:
// admin-only pages for an admin only, hidden pages (Settings → Sidebar & pages)
// left out, the page they are on always in. A section with nothing left is gone.
// Technitium and the VPN show only while Config → Integrations has them on.
// =============================================================================

import { useMemo } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { ADMIN_ONLY_PAGES } from '../../shared/types'
import type { PageId } from '../../shared/types'
import { navSections, visiblePages, sectionOf, type NavSection, type NavPageId } from '../constants/navSections'
import { useTechnitiumEnabled, useVpnEnabled } from './useTechnitiumEnabled'

export interface ShownSection { section: NavSection; pages: NavPageId[] }

const NONE: PageId[] = []

export function useNavSections(): { shown: ShownSection[]; current: ShownSection | undefined; currentPage: PageId } {
  const currentPage = useSettingsStore((s) => s.currentPage)
  const hidden = useSettingsStore((s) => s.hiddenPages) ?? NONE
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const technitium = useTechnitiumEnabled()
  const vpn = useVpnEnabled()
  return useMemo(() => {
    const off: PageId[] = [...hidden, ...(technitium ? [] : ['technitium' as const]), ...(vpn ? [] : ['vpn' as const])]
    const shown = navSections
      .map((section) => ({ section, pages: visiblePages(section, { isAdmin, hidden: off, adminOnly: ADMIN_ONLY_PAGES, current: currentPage }) }))
      .filter((s) => s.pages.length > 0)
    const home = sectionOf(currentPage)
    return { shown, current: shown.find((s) => s.section.id === home?.id), currentPage }
  }, [currentPage, hidden, isAdmin, technitium, vpn])
}
