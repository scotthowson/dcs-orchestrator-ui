// =============================================================================
// CrowdSec — intrusion prevention for the reverse proxy, as a page.
//
// One status answer tells which of the states CrowdSec is in:
//   not deployed      an invitation with a pre-flight and a one-click deploy that
//                     follows the deployment and then opens the page by itself
//   stopped / restarting / unhealthy / API unreachable / Docker down
//                     the honest reason, the log, the one-click fix
//   healthy           the status strip, the things that need attention, and the tabs:
//                     overview (what has been happening, by country too), bans, alerts,
//                     allowlist, Discord alerts, settings (ban length, escalation,
//                     simulation), the hub, bouncers, and the log.
// On a hub the scope chips pick the server (the hub or one VM) the page works on.
// =============================================================================

import PageHeader from '../components/common/PageHeader'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Activity, Ban, Bell, ShieldCheck, MessageSquare, SlidersHorizontal, Package, Plug, ScrollText, RefreshCw, ShieldOff, UserCheck } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import { useFleetScope } from '../hooks/useFleetScope'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { ErrorState, SkeletonBlock } from '../components/common/PageState'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import { crowdsecStatus } from '../api/endpoints'
import type { CrowdSecStatusResponse } from '../../shared/types'
import { CsCtx, fmtNum } from '../components/crowdsec/kit'
import StatusStrip from '../components/crowdsec/StatusStrip'
import { IssueBanners, NotDeployed, ProblemView, TooOld } from '../components/crowdsec/StateViews'
import OverviewTab from '../components/crowdsec/OverviewTab'
import BansTab from '../components/crowdsec/BansTab'
import AlertsTab from '../components/crowdsec/AlertsTab'
import AllowlistTab from '../components/crowdsec/AllowlistTab'
import NotificationsTab from '../components/crowdsec/NotificationsTab'
import SettingsTab from '../components/crowdsec/SettingsTab'
import HubTab from '../components/crowdsec/HubTab'
import BouncersTab from '../components/crowdsec/BouncersTab'
import LogsTab from '../components/crowdsec/LogsTab'

import { BTN_TOOLBAR_QUIET } from '../lib/ui'
import { Pill } from '../components/common/Pill'
import Segmented from '../components/common/Segmented'
const POLL_MS = 15_000
const TAB_KEY = 'dcs-crowdsec-tab'
type TabId = 'overview' | 'bans' | 'alerts' | 'allowlist' | 'notifications' | 'settings' | 'hub' | 'bouncers' | 'logs'
const TAB_IDS: TabId[] = ['overview', 'bans', 'alerts', 'allowlist', 'notifications', 'settings', 'hub', 'bouncers', 'logs']

function loadTab(): TabId {
  try { const t = localStorage.getItem(TAB_KEY); return (TAB_IDS as string[]).includes(t || '') ? (t as TabId) : 'overview' } catch { return 'overview' }
}

export default function CrowdSec() {
  const isAdmin = useAuthStore((s) => s.userRole === 'admin')
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet, pending: scopePending } = useFleetScope()
  // one server at a time: the hub or one VM (Everywhere reads as the hub here)
  const pageScope = scope === 'all' ? 'hub' : scope
  const member = pageScope === 'hub' ? null : scopeMember

  const [tab, setTabState] = useState<TabId>(loadTab)
  // a tab can be opened with a search already typed (a country in the overview opens the bans of that country)
  const [seed, setSeed] = useState<{ tab?: string; search?: string; n: number } | null>(null)
  const goTab = useCallback((t: string, search?: string) => {
    if (!(TAB_IDS as string[]).includes(t)) return
    setSeed((prev) => (search !== undefined ? { tab: t, search, n: (prev?.n ?? 0) + 1 } : null))
    setTabState(t as TabId)
    try { localStorage.setItem(TAB_KEY, t) } catch { /* private window */ }
  }, [])
  const setTab = goTab
  // the dashboard card and the palette can land here on a tab, with a search
  useEffect(() => {
    const p = useSettingsStore.getState().navigationPayload
    if (p && (typeof p.tab === 'string' || typeof p.search === 'string')) {
      if (typeof p.tab === 'string') goTab(p.tab, typeof p.search === 'string' ? p.search : undefined)
      else setSeed((prev) => ({ tab: undefined, search: p.search as string, n: (prev?.n ?? 0) + 1 }))
      useSettingsStore.getState().consumeNavigationPayload()
    }
  }, [navigationPayload, goTab])

  // only the answer of the server shown counts, so the numbers of the hub are never shown under a VM (and a slow answer of the
  // server just left is ignored); another server chosen is asked at once (a new key). Nothing is asked while the scope is
  // still being worked out (a VM remembered, the VMs not read yet): the page used to open on the hub, then drop to its
  // skeleton and open again on the VM, remounting the tab. The dashboard's card asks the hub's status too: one request
  const statusKey = pollKeys.crowdsecStatus(member)
  const status = usePolling<CrowdSecStatusResponse>(() => crowdsecStatus(member), POLL_MS, { key: statusKey, enabled: !scopePending })
  const statusRefresh = status.refresh
  const s = status.dataKey === statusKey ? status.data : null

  const ctx = useMemo(() => ({ member, memberName: scopeMember ? memberName : '', isAdmin, status: s, refreshStatus: statusRefresh, goTab }), [member, scopeMember, memberName, isAdmin, s, statusRefresh, goTab])

  const state = s?.state
  const counts = s?.counts
  const healthy = state === 'healthy'
  const issues = s?.issues ?? []

  const tabs: { value: TabId; label: string; icon: React.ElementType; count?: number | string }[] = [
    { value: 'overview', label: 'Overview', icon: Activity },
    { value: 'bans', label: 'Bans', icon: Ban, count: counts ? fmtNum(counts.decisions_active) : undefined },
    { value: 'alerts', label: 'Alerts', icon: Bell, count: counts ? fmtNum(counts.alerts_24h) : undefined },
    { value: 'allowlist', label: 'Allowlist', icon: UserCheck },
    { value: 'notifications', label: 'Discord', icon: MessageSquare },
    { value: 'settings', label: 'Settings', icon: SlidersHorizontal },
    { value: 'hub', label: 'Hub', icon: Package, count: counts && counts.updates > 0 ? counts.updates : undefined },
    { value: 'bouncers', label: 'Bouncers', icon: Plug, count: counts ? counts.bouncers : undefined },
    { value: 'logs', label: 'Logs', icon: ScrollText },
  ]

  const subtitle = !s ? 'Looking for CrowdSec…'
    : state === 'healthy' ? `Watching Traefik's log${s.version_number ? ` · CrowdSec ${s.version_number}` : ''}${scopeMember ? ` on ${memberName}` : ''}`
    : s.title || 'CrowdSec'

  return (
    <CsCtx.Provider value={ctx}>
      <div className="space-y-4 md:space-y-6 animate-fade-in">
        <DisconnectedBanner />
        <PageHeader
          page="crowdsec"
          icon={state === 'not_deployed' ? ShieldOff : undefined}
          title={<>CrowdSec{scopeMember && <span className="ml-2 text-sm font-medium tracking-normal text-violet-300">· VM {memberName}</span>}</>}
          badge={s && state && state !== 'healthy' && state !== 'not_deployed' ? <Pill tone={state === 'starting' ? 'info' : state === 'crash_loop' || state === 'docker_unavailable' ? 'problem' : 'attention'}>{state.replace(/_/g, ' ')}</Pill> : undefined}
          subtitle={subtitle}
          actions={<button type="button" onClick={statusRefresh} disabled={status.loading} className={BTN_TOOLBAR_QUIET} aria-label="Refresh"><RefreshCw size={14} className={status.loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span></button>}
        >
          {hasFleet && <FleetScopeChips scope={pageScope} members={scopeMembers} onChange={setScope} label="Server" busy={status.loading && !!s} everywhere={false} />}
        </PageHeader>

        {!s && !status.error && (
          <div className="space-y-3" aria-busy="true" aria-label="Loading CrowdSec">
            <div className="grid grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-2.5">{[0, 1, 2, 3, 4, 5].map((i) => <SkeletonBlock key={i} className="h-[58px] sm:h-[74px]" />)}</div>
            <SkeletonBlock className="h-11" /><SkeletonBlock className="h-64" />
          </div>
        )}
        {!s && status.error && <ErrorState title="Could not ask CrowdSec for its state" error={status.error} onRetry={statusRefresh} />}
        {s && !state && <TooOld />}
        {s && state === 'not_deployed' && <NotDeployed s={s} onRefresh={statusRefresh} />}
        {s && state && state !== 'not_deployed' && state !== 'healthy' && <ProblemView s={s} onRefresh={statusRefresh} onDeploy={() => setTab('overview')} />}

        {s && healthy && (
          <>
            <StatusStrip s={s} onOpenTab={setTab} />
            <IssueBanners issues={issues} onOpenTab={setTab} />
            <div className="-mx-1 px-1 overflow-x-auto scrollbar-none">
              <Segmented value={tab} onChange={(v) => setTab(v)} ariaLabel="CrowdSec sections" className="w-max" options={tabs.map((t) => ({ value: t.value, label: t.label, icon: t.icon, count: t.count }))} />
            </div>
            <div key={`${member ?? 'hub'}-${tab}-${seed && seed.tab === tab ? seed.n : 0}`} className="animate-fade-in">
              {tab === 'overview' && <OverviewTab />}
              {tab === 'bans' && <BansTab seedSearch={seed?.tab === 'bans' ? seed.search : undefined} />}
              {tab === 'alerts' && <AlertsTab seedSearch={seed?.tab === 'alerts' ? seed.search : undefined} />}
              {tab === 'allowlist' && <AllowlistTab />}
              {tab === 'notifications' && <NotificationsTab />}
              {tab === 'settings' && <SettingsTab />}
              {tab === 'hub' && <HubTab />}
              {tab === 'bouncers' && <BouncersTab />}
              {tab === 'logs' && <LogsTab />}
            </div>
          </>
        )}
      </div>
    </CsCtx.Provider>
  )
}
