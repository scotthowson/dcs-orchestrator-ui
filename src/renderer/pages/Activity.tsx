// =============================================================================
// Activity — everything that happened on the server (or the VMs), in three tabs
// under one set of scope chips:
//   Timeline     the Docker events, newest first, grouped by day, filtered by
//                type or name (polls /events while the tab shows)
//   Live stream  the server's live event stream as it arrives (was Live Events;
//                the page id event-feed opens this tab)
//   Audit log    who did what (admins only; polls /audit while the tab shows)
// A navigation payload { tab } picks the tab; the last one is remembered per device.
// =============================================================================

import { useState, useCallback, useEffect, useRef, type KeyboardEvent } from 'react'
import { Badge } from '@mantine/core'
import { RefreshCw, History, Radio, FileText, type LucideIcon } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { fetchEvents } from '../api/endpoints'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useLogStore } from '../stores/logStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Timeline from '../components/activity/Timeline'
import LiveStream, { useSseConnected } from '../components/activity/LiveStream'
import AuditLog, { useAuditLog } from '../components/activity/AuditLog'
import { BTN_TOOLBAR_QUIET } from '../lib/ui'
import { FOCUS_RING } from '../lib/pageKit'
import type { EventsResponse } from '../../shared/types'

type ActivityTab = 'timeline' | 'live' | 'audit'

const TABS: { id: ActivityTab; label: string; icon: LucideIcon; adminOnly?: boolean }[] = [
  { id: 'timeline', label: 'Timeline', icon: History },
  { id: 'live', label: 'Live stream', icon: Radio },
  { id: 'audit', label: 'Audit log', icon: FileText, adminOnly: true },
]

const TAB_KEY = 'dcs-activity-tab'
const isTab = (v: unknown): v is ActivityTab => v === 'timeline' || v === 'live' || v === 'audit'
function loadTab(): ActivityTab {
  try { const v = localStorage.getItem(TAB_KEY); return isTab(v) ? v : 'timeline' } catch { return 'timeline' }
}
function saveTab(t: ActivityTab) { try { localStorage.setItem(TAB_KEY, t) } catch { /* storage unavailable */ } }

export default function Activity() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  // GET /audit is admin-only: a user never sees the tab, and their page never asks for it
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const reportPollSuccess = useConnectionStore((s) => s.reportPollSuccess)
  const reportPollFailure = useConnectionStore((s) => s.reportPollFailure)
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const showMember = useCallback((m: string | null) => setScope(m ?? 'hub'), [setScope])

  // ---- Tab: remembered per device, chosen by a payload ({ tab }), the audit log only for an admin ----
  const [chosen, setChosen] = useState<ActivityTab>(loadTab)
  const tab: ActivityTab = chosen === 'audit' && !isAdmin ? 'timeline' : chosen
  const selectTab = useCallback((t: ActivityTab) => { setChosen(t); saveTab(t) }, [])

  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  useEffect(() => {
    const p = useSettingsStore.getState().navigationPayload
    if (!p || !isTab(p.tab)) return
    if (p.tab !== 'audit' || useAuthStore.getState().userRole === 'admin') selectTab(p.tab)
    useSettingsStore.getState().consumeNavigationPayload()
  }, [navigationPayload, selectTab])

  // a tab is mounted the first time it is shown and then kept behind the others, so its filters and
  // what the live stream caught survive a look at another tab
  const [visited, setVisited] = useState<Set<ActivityTab>>(() => new Set([tab]))
  useEffect(() => {
    setVisited((v) => (v.has(tab) ? v : new Set(v).add(tab)))
  }, [tab])

  // ---- Timeline: /events every 3 s (6 s everywhere), only while its tab shows ----
  // (the store is what the dashboard's Recent events card reads; the dashboard polls it itself too)
  const setEvents = useLogStore((s) => s.setEvents)
  const events = useLogStore((s) => s.events)
  const fetchScopedEvents = useCallback(() => fetchEvents(scope), [scope])
  const eventsPoll = usePolling<EventsResponse>(fetchScopedEvents, scope === 'all' ? 6000 : 3000, {
    enabled: isConnected && tab === 'timeline',
    onError: reportPollFailure,
  })
  useEffect(() => {
    if (eventsPoll.data) {
      setEvents(eventsPoll.data.events)
      reportPollSuccess()
    }
  }, [eventsPoll.data, setEvents, reportPollSuccess])

  // ---- Audit log: every 15 s while its tab shows ----
  const audit = useAuditLog(isConnected && isAdmin && tab === 'audit', scope)

  // ---- Live stream: is the stream open (checked while its tab shows) ----
  const sseConnected = useSseConnected(tab === 'live')

  const refresh = tab === 'timeline' ? eventsPoll.refresh : tab === 'audit' ? audit.refresh : null
  const refreshing = tab === 'timeline' ? eventsPoll.loading : tab === 'audit' ? audit.loading : false
  const live = tab === 'live' ? sseConnected : isConnected
  const scopeVmid = scopeMembers.find((m) => m.id === scopeMember)?.vmid

  // ---- Tabs: arrow keys move between them (the WAI-ARIA tabs pattern) ----
  const shownTabs = TABS.filter((t) => !t.adminOnly || isAdmin)
  const tabRefs = useRef<Partial<Record<ActivityTab, HTMLButtonElement | null>>>({})
  const onTabKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = shownTabs.findIndex((t) => t.id === tab)
    const next = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? shownTabs.length - 1 : null
    if (next === null) return
    e.preventDefault()
    const t = shownTabs[(next + shownTabs.length) % shownTabs.length].id
    selectTab(t)
    tabRefs.current[t]?.focus()
  }

  return (
    <div className="space-y-4 md:space-y-5">
      <DisconnectedBanner />
      <PageHeader
        page="activity"
        badge={<>
          {scopeMember && <VmCapsule member={scopeMember} name={memberName} vmid={scopeVmid} />}
          {live ? (
            <Badge
              color="emerald"
              leftSection={
                <span className="relative flex h-1.5 w-1.5" aria-hidden>
                  <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                  <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                </span>
              }
            >
              Live
            </Badge>
          ) : tab === 'live' && isConnected ? (
            <Badge color="rose" leftSection={<span className="w-1.5 h-1.5 rounded-full bg-rose-400" aria-hidden />}>
              Stream down
            </Badge>
          ) : null}
        </>}
        actions={isConnected && refresh ? (
          <button type="button" onClick={refresh} disabled={refreshing} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh
          </button>
        ) : undefined}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={tab === 'timeline' && eventsPoll.loading && events.length > 0} />}
      </PageHeader>

      {/* ---- Tabs (a phone swipes them sideways if they do not fit) ---- */}
      <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none border-b border-white/[0.06]">
        <div role="tablist" aria-label="Activity views" onKeyDown={onTabKey} className="flex w-max min-w-full items-end gap-1">
          {shownTabs.map(({ id, label, icon: Icon, adminOnly }) => {
            const selected = id === tab
            return (
              <button
                key={id}
                ref={(el) => { tabRefs.current[id] = el }}
                type="button"
                role="tab"
                id={`activity-tab-${id}`}
                aria-selected={selected}
                aria-controls={`activity-panel-${id}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => selectTab(id)}
                className={`-mb-px flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors rounded-t-lg ${FOCUS_RING} ${
                  selected ? 'accent-text border-current' : 'border-transparent text-slate-400 hover:text-slate-200'
                }`}
              >
                <Icon size={15} aria-hidden className={selected ? 'accent-text' : 'text-slate-500'} />
                {label}
                {adminOnly && <span aria-hidden className="hidden sm:inline text-[10px] font-normal uppercase tracking-wider text-slate-500">admin</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ---- Panels: each mounted when first shown, then kept (hidden) ---- */}
      {visited.has('timeline') && (
        <div role="tabpanel" id="activity-panel-timeline" aria-labelledby="activity-tab-timeline" hidden={tab !== 'timeline'}>
          <Timeline events={events} isConnected={isConnected} />
        </div>
      )}
      {visited.has('live') && (
        <div role="tabpanel" id="activity-panel-live" aria-labelledby="activity-tab-live" hidden={tab !== 'live'}>
          <LiveStream
            active={tab === 'live'}
            scope={scope}
            members={scopeMembers}
            memberName={memberName}
            sseConnected={sseConnected}
            onScope={showMember}
          />
        </div>
      )}
      {isAdmin && visited.has('audit') && (
        <div role="tabpanel" id="activity-panel-audit" aria-labelledby="activity-tab-audit" hidden={tab !== 'audit'}>
          <AuditLog entries={audit.entries} loading={audit.loading} isConnected={isConnected} onScope={showMember} />
        </div>
      )}
    </div>
  )
}
