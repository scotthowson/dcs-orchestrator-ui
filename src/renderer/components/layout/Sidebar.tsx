// =============================================================================
// Sidebar — the ten sections (constants/navSections), glassmorphism, badges,
// health status. A section opens on the tab it was last on; its pages are the
// tab bar over the page (SectionTabs).
// =============================================================================

import React from 'react'
import { ChevronsLeft, ChevronsRight, Container } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useNarrowWindow } from '../../hooks/useMobile'
import { useNavSections } from '../../hooks/useNavSections'
import { useNavBadges, sectionBadge, sectionStatusIcon, type NavBadge, type NavStatusIcon } from '../../hooks/useNavBadges'
import { sectionTarget } from '../../constants/navSections'
import { ServerSwitcher } from '../common/ServerSwitcher'

export function Sidebar() {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const sidebarCollapsed = useSettingsStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useSettingsStore((s) => s.toggleSidebar)
  const projectName = useSettingsStore((s) => s.projectName) || 'DCS Manager'
  const projectSubtitle = useSettingsStore((s) => s.projectSubtitle) || 'DCS Orchestrator'
  const connectionStatus = useConnectionStore((s) => s.status)
  const { shown, current, currentPage } = useNavSections()
  const { badges, statusIcons } = useNavBadges()

  // A narrow window shows the icon rail whatever the person chose, and gives the choice back when it widens
  // (nothing is written to the settings: the old code saved the collapse and the wide window inherited it)
  const narrow = useNarrowWindow()
  const collapsed = sidebarCollapsed || narrow

  return (
    <aside
      className={`
        relative hidden md:flex flex-col h-full
        bg-slate-900/60 backdrop-blur-2xl
        border-r border-white/5
        transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
        ${collapsed ? 'w-[52px] md:w-[68px]' : 'w-[220px]'}
      `}
    >
      {/* Brand area */}
      <div className="flex items-center gap-3 px-2 md:px-4 h-11 md:h-14 border-b border-white/5 shrink-0">
        <div className="relative flex items-center justify-center w-9 h-9 rounded-xl shrink-0 border accent-text" style={{ backgroundColor: 'rgb(var(--color-accent) / 0.1)', borderColor: 'rgb(var(--color-accent) / 0.1)' }}>
          <Container size={18} strokeWidth={2.2} />
          <div className="absolute inset-0 rounded-xl blur-sm" style={{ backgroundColor: 'rgb(var(--color-accent) / 0.05)' }} />
          {/* Connection dot on the brand icon */}
          <span className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 transition-colors duration-500
            ${connectionStatus === 'connected' ? 'bg-emerald-400' : connectionStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : connectionStatus === 'error' ? 'bg-rose-400' : 'bg-slate-500'}
          `} />
        </div>
        {!collapsed && (
          <div className="overflow-hidden">
            <span className="text-sm font-bold tracking-wide text-gradient neon-emerald whitespace-nowrap">
              {projectName}
            </span>
            <p className="text-[10px] text-slate-500 -mt-0.5 whitespace-nowrap">{projectSubtitle}</p>
          </div>
        )}
      </div>

      {/* Server Switcher */}
      {!collapsed && (
        <div className="px-2 py-2 border-b border-white/5">
          <ServerSwitcher />
        </div>
      )}

      {/* Navigation: one entry per section */}
      <nav aria-label="Sections" className="flex-1 overflow-y-auto scrollbar-thin py-3 px-2">
        <div className="space-y-0.5">
          {shown.map(({ section, pages }) => {
            const active = current?.section.id === section.id
            return (
              <NavButton
                key={section.id}
                label={section.label}
                icon={section.icon}
                isActive={active}
                collapsed={collapsed}
                badge={sectionBadge(section, pages, badges)}
                statusIcon={sectionStatusIcon(pages, statusIcons)}
                onClick={() => {
                  // the section you are in: back to the top of the page you are on (as before)
                  if (active) { setCurrentPage(currentPage, { resetView: true }); return }
                  const to = sectionTarget(section, pages)
                  if (to) setCurrentPage(to)
                }}
              />
            )
          })}
        </div>
      </nav>

      {/* Collapse toggle (a narrow window has the rail whatever this says, so it is not offered there) */}
      {!narrow && <div className="shrink-0 border-t border-white/5 p-2">
        <button
          onClick={toggleSidebar}
          className="
            flex items-center justify-center w-full
            rounded-lg p-2.5
            text-slate-500 hover:text-slate-300
            hover:bg-white/5
            transition-all duration-200
            no-drag press
          "
          title={sidebarCollapsed ? 'Expand sidebar (Ctrl+B)' : 'Collapse sidebar (Ctrl+B)'}
          aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {sidebarCollapsed ? (
            <ChevronsRight size={16} strokeWidth={2} />
          ) : (
            <ChevronsLeft size={16} strokeWidth={2} />
          )}
        </button>
      </div>}
    </aside>
  )
}

// ---------------------------------------------------------------------------
// NavButton — one section with its badge and status mark
// ---------------------------------------------------------------------------

function NavButton({
  label,
  icon: Icon,
  isActive,
  collapsed,
  badge,
  statusIcon,
  onClick,
}: {
  label: string
  icon: React.ElementType
  isActive: boolean
  collapsed: boolean
  badge?: NavBadge
  statusIcon?: NavStatusIcon
  onClick: () => void
}) {
  const StatusIcon = statusIcon?.icon

  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      aria-current={isActive ? 'page' : undefined}
      className={`
        group relative flex items-center gap-3 w-full
        rounded-lg px-3 py-2
        text-[13px] font-medium
        transition-all duration-200 ease-out
        no-drag
        ${
          isActive
            ? 'accent-bg-subtle accent-text'
            : 'text-slate-500 hover:bg-white/5 hover:text-slate-300'
        }
      `}
    >
      {/* Active indicator bar — inset-y centering avoids animate-scale-in
           overriding the -translate-y-1/2 transform (which caused the bar to
           start at the wrong position and jump to center) */}
      {isActive && (
        <div className="absolute left-0 inset-y-0 my-auto w-[3px] h-4 rounded-r-full accent-indicator animate-scale-in origin-left" />
      )}

      {/* Active glow background */}
      {isActive && (
        <div className="absolute inset-0 rounded-lg pointer-events-none" style={{ backgroundColor: 'rgb(var(--color-accent) / 0.04)' }} />
      )}

      <Icon
        size={18}
        strokeWidth={isActive ? 2.2 : 1.7}
        className={`shrink-0 transition-all duration-200 ${
          isActive
            ? 'accent-text accent-glow'
            : 'text-slate-500 group-hover:text-slate-400'
        }`}
      />

      {!collapsed && (
        <>
          <span className="truncate whitespace-nowrap flex-1 text-left">{label}</span>
          {/* Status icon (health check / connection indicator) */}
          {StatusIcon && (
            <StatusIcon
              size={13}
              className={`shrink-0 ${statusIcon.color}`}
              title={statusIcon.title}
            />
          )}
          {badge && (
            <span title={badge.title} className={`
              z-10 inline-flex items-center justify-center min-w-[20px] h-5
              rounded-full px-1.5 text-[10px] font-bold tabular-nums
              ${badge.color}
              transition-all duration-300
            `}>
              {badge.value}
            </span>
          )}
          {badge?.second && (
            <span title={badge.second.title} className={`
              z-10 inline-flex items-center justify-center min-w-[20px] h-5
              rounded-full px-1.5 text-[10px] font-bold tabular-nums
              ${badge.second.color}
              transition-all duration-300
            `}>
              {badge.second.value}
            </span>
          )}
        </>
      )}

      {/* Collapsed: status icon as small overlay */}
      {collapsed && StatusIcon && (
        <span
          className={`absolute bottom-0.5 right-0.5 ${statusIcon.color}`}
          title={statusIcon.title}
        >
          <StatusIcon size={9} />
        </span>
      )}

      {/* Collapsed badge dot */}
      {collapsed && badge && (
        <span className={`
          absolute top-1 right-1 w-2 h-2 rounded-full
          ${badge.color.includes('rose') ? 'bg-rose-400' : badge.color.includes('emerald') ? 'bg-emerald-400' : 'bg-cyan-400'}
        `} />
      )}
    </button>
  )
}
