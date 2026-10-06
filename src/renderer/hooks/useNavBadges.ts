// =============================================================================
// useNavBadges — the counts and status marks beside the pages: the sidebar
// shows them per section, the tab bar over a page per tab. One request for the
// hub's VM stacks however many places ask (sharedFetch).
// =============================================================================

import type React from 'react'
import { HeartPulse, CheckCircle, XCircle, AlertTriangle, Wifi, WifiOff } from 'lucide-react'
import { usePolling } from './usePolling'
import { useFleetRole } from './useFleetRole'
import { useFleetTotals } from './useFleetTotals'
import { useApiLink } from './useApiLink'
import { fetchStacks } from '../api/endpoints'
import { sharedFetch } from '../lib/sharedFetch'
import { useSettingsStore } from '../stores/settingsStore'
import { useSystemStore } from '../stores/systemStore'
import { useHealthStore } from '../stores/healthStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useNotificationStore } from '../stores/notificationStore'
import type { PageId } from '../../shared/types'
import type { NavSection } from '../constants/navSections'
import { pageLabel } from '../constants/pageTitles'
import { stackIsFine } from '../lib/containerState'

/** the count beside a page's name; `second` is a count of another kind next to it (the stacks that live in VMs) */
export interface NavBadge { value: string; color: string; title?: string; second?: { value: string; color: string; title?: string } }
export interface NavStatusIcon { icon: React.ElementType; color: string; title: string }

const vmStackList = sharedFetch(fetchStacks, 20000)

export function useNavBadges(): { badges: Partial<Record<PageId, NavBadge>>; statusIcons: Partial<Record<PageId, NavStatusIcon>> } {
  // a hub: the badge counts the VMs (the merged stack list), not this server's own stacks
  const { isHub } = useFleetRole()
  const isConnectedForVms = useConnectionStore((st) => st.status === 'connected')
  const vmList = usePolling(vmStackList, 30000, { enabled: isConnectedForVms && isHub })
  // a hub counts its VMs in every badge: containers, images, networks and volumes are its own plus theirs
  const { totals: fleet } = useFleetTotals()
  const vmStacks = vmList.data ? { total: vmList.data.stacks.filter((x) => x.placement === 'vm').length, up: vmList.data.stacks.filter((x) => x.placement === 'vm' && stackIsFine(x)).length } : null
  const systemStatus = useSystemStore((s) => s.status)
  const healthReport = useHealthStore((s) => s.report)
  const connectionStatus = useConnectionStore((s) => s.status)
  const link = useApiLink()
  const unreadNotifications = useNotificationStore((s) => s.getServerUnreadCount())
  // the count comes from GET /system/update/check, an admin's to run: kept on this device, it would be another account's verdict
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const updatesAvailable = useSettingsStore((s) => s.updatesAvailable) ?? 0

  const badges: Partial<Record<PageId, NavBadge>> = {}

  if (systemStatus) {
    const runningContainers = systemStatus.docker.containers.running + fleet.containersRunning
    const asleepContainers = (systemStatus.docker.containers.sleeping ?? 0) + fleet.containersSleeping
    badges.containers = {
      value: `${runningContainers}`,
      color: runningContainers > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400',
      title: `${runningContainers} containers running${asleepContainers ? `, ${asleepContainers} asleep on demand` : ''}`,
    }
    // green: the stacks that run on this server itself; violet: the ones that live in a VM of the fleet (a hub shows both)
    badges.stacks = {
      value: `${systemStatus.stacks.running}`,
      color: systemStatus.stacks.running > 0 ? 'bg-emerald-500/20 text-emerald-400' : 'bg-slate-500/20 text-slate-400',
      title: isHub ? `${systemStatus.stacks.running} running on this server` : `${systemStatus.stacks.running} stacks running`,
      second: isHub && vmStacks !== null && vmStacks.total > 0
        ? { value: `${vmStacks.total}`, color: vmStacks.up > 0 ? 'bg-violet-500/20 text-violet-300' : 'bg-slate-500/20 text-slate-400', title: `${vmStacks.total} in VMs, ${vmStacks.up} up (running or asleep on demand)` }
        : undefined,
    }
    badges.images = { value: `${systemStatus.docker.images + fleet.images}`, color: 'bg-cyan-500/20 text-cyan-400' }
    badges.networks = { value: `${systemStatus.docker.networks + fleet.networks}`, color: 'bg-cyan-500/20 text-cyan-400' }
    badges.volumes = { value: `${systemStatus.docker.volumes + fleet.volumes}`, color: 'bg-cyan-500/20 text-cyan-400' }
  }

  if (healthReport && link.live && healthReport.summary.unhealthy > 0) {
    badges.health = { value: `${healthReport.summary.unhealthy}`, color: 'bg-rose-500/20 text-rose-400', title: `${healthReport.summary.unhealthy} unhealthy` }
  }

  if (unreadNotifications > 0) {
    badges.notifications = { value: `${unreadNotifications}`, color: 'bg-rose-500/20 text-rose-400', title: `${unreadNotifications} unread` }
    badges.activity = { value: `${unreadNotifications}`, color: 'bg-amber-500/20 text-amber-400', title: `${unreadNotifications} unread` }
  }

  if (isAdmin && updatesAvailable > 0) {
    badges.updates = { value: `${updatesAvailable}`, color: 'bg-cyan-500/20 text-cyan-400', title: 'A DCS update is available' }
  }

  const statusIcons: Partial<Record<PageId, NavStatusIcon>> = {}

  // the dashboard carries the link to the API
  statusIcons.dashboard = link.live
    ? { icon: Wifi, color: 'text-emerald-400', title: 'Connected' }
    : link.state === 'trouble'
      ? { icon: Wifi, color: 'text-amber-400 animate-pulse', title: 'The API is not answering' }
      : link.state === 'reconnecting'
        ? { icon: WifiOff, color: 'text-rose-400 animate-pulse', title: connectionStatus === 'connecting' ? 'Connecting...' : 'API reconnecting…' }
        : { icon: WifiOff, color: 'text-rose-400', title: 'Not connected' }

  // health carries the verdict; the last verdict is history while the API does not answer
  const healthStatusIcon: Record<string, NavStatusIcon> = {
    healthy: { icon: CheckCircle, color: 'text-emerald-400', title: 'All systems healthy' },
    degraded: { icon: AlertTriangle, color: 'text-amber-400', title: 'System degraded' },
    critical: { icon: XCircle, color: 'text-rose-400', title: 'Critical issues' },
  }
  if (!link.live) {
    statusIcons.health = { icon: HeartPulse, color: link.state === 'trouble' ? 'text-amber-400 animate-pulse' : 'text-rose-400 animate-pulse', title: link.label }
  } else if (healthReport?.status && healthStatusIcon[healthReport.status]) {
    statusIcons.health = healthStatusIcon[healthReport.status]
  }

  return { badges, statusIcons }
}

const ALERT = /rose|amber/

/**
 * A section's badge: a page of it that is in trouble speaks first (unhealthy containers,
 * unread alerts), otherwise the count of its first page that has one (stacks, containers).
 */
export function sectionBadge(section: NavSection, shown: readonly PageId[], badges: Partial<Record<PageId, NavBadge>>): NavBadge | undefined {
  const withBadge = shown.filter((p) => badges[p])
  const alert = withBadge.find((p) => ALERT.test(badges[p]!.color))
  const pick = alert ?? withBadge[0]
  if (!pick) return undefined
  const b = badges[pick]!
  // say whose count it is: on a section of several pages a bare "2" means nothing
  return section.pages.length > 1 ? { ...b, title: `${pageLabel(pick)}: ${b.title ?? b.value}` } : b
}

/** a section's status mark: the one of its pages that has one (Dashboard: the link, Monitoring: health) */
export function sectionStatusIcon(shown: readonly PageId[], icons: Partial<Record<PageId, NavStatusIcon>>): NavStatusIcon | undefined {
  for (const p of shown) if (icons[p]) return icons[p]
  return undefined
}
