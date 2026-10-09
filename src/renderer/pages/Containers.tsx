// =============================================================================
// Containers — Container management page. On a hub the list follows the fleet
// scope every page shares: everywhere (the hub and every VM, each row saying
// where it lives), the hub alone, or one VM — and every button acts on the
// server the row belongs to.
// =============================================================================

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { useContainerStore } from '../stores/containerStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { Loader2 } from 'lucide-react'
import ContainerList from '../components/containers/ContainerList'
import ContainerDetail from '../components/containers/ContainerDetail'
import { ErrorBoundary } from '../components/common/ErrorBoundary'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { OnDemandMissingBanner } from '../components/common/OnDemandMissingBanner'
import { useToast } from '../components/common/Toast'
import { usePolling } from '../hooks/usePolling'
import { useFleetScope } from '../hooks/useFleetScope'
import { fetchContainersScoped, scopeContainerRows, rowKey } from '../api/fleetScoped'
import type { ContainerInfo } from '../../shared/types'
import type { FleetContainerListResponse, RowMember, ScopeMemberTag } from '../../shared/fleetScoped'

import { BTN_TOOLBAR_QUIET } from '../lib/ui'
/** The container that is open: its name and the server it runs on (any server when another page named it alone) */
interface Selection { name: string; member: RowMember; any?: boolean }

function selectionMatches(sel: Selection, c: ContainerInfo): boolean {
  if (c.name !== sel.name && c.name.toLowerCase() !== sel.name.toLowerCase()) return false
  return !!sel.any || (c.member ?? null) === (sel.member ?? null)
}

const Containers: React.FC = () => {
  const storeContainers = useContainerStore((s) => s.containers)
  const storeLoading = useContainerStore((s) => s.loading)
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()

  // a hub: everywhere (the hub and every VM), the hub alone, or one VM — the choice every fleet-aware page shares
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const vmTag = useMemo<ScopeMemberTag | null>(
    () => (scopeMember ? { id: scopeMember, name: memberName, vmid: scopeMembers.find((m) => m.id === scopeMember)?.vmid ?? null } : null),
    [scopeMember, memberName, scopeMembers],
  )

  // The list of the chosen scope, tagged with the scope it was asked for so a
  // switch never shows the old rows under the new label
  const fetchScoped = useCallback(async () => ({ scope, res: await fetchContainersScoped(scope) }), [scope])
  const { data, loading: scopedLoading, error, refresh: refreshScoped } = usePolling<{ scope: string; res: FleetContainerListResponse }>(fetchScoped, 10000, { enabled: isConnected })
  const scopeRef = useRef(scope)
  useEffect(() => { if (scopeRef.current !== scope) { scopeRef.current = scope; refreshScoped() } }, [scope, refreshScoped])
  const current = data && data.scope === scope ? data.res : null
  // the hub's own list is what the global poller keeps in the store: the page opens with it before its own fetch lands
  const containers = useMemo<ContainerInfo[]>(
    () => (current ? scopeContainerRows(scope, current.containers, vmTag) : scope === 'hub' ? storeContainers.filter((c) => !c.member) : []),
    [current, scope, vmTag, storeContainers],
  )
  const loading = current ? false : scope === 'hub' ? storeLoading && scopedLoading : true

  // The global poller feeds the dashboard's container card: after an action both lists are asked for a fresh copy
  const refreshContainers = useContainerStore((s) => s.refresh)
  useEffect(() => {
    if (isConnected) void refreshContainers()
  }, [isConnected, refreshContainers])
  const refresh = useCallback(() => { refreshScoped(); void refreshContainers() }, [refreshScoped, refreshContainers])

  const [selected, setSelected] = useState<Selection | null>(null)
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  const pendingFocusRef = useRef<string | null>(null)

  // React to navigation payloads: resetView (sidebar re-click) or focusContainer (from Stacks, by name)
  useEffect(() => {
    if (!navigationPayload) return
    const payload = useSettingsStore.getState().navigationPayload
    if (!payload) return

    if (payload.focusContainer || payload.resetView) {
      useSettingsStore.getState().consumeNavigationPayload()
      if (payload.resetView) {
        setSelected(null)
        pendingFocusRef.current = null
      } else if (payload.focusContainer && typeof payload.focusContainer === 'string') {
        const member = typeof payload.focusMember === 'string' ? payload.focusMember : null
        setSelected(member ? { name: payload.focusContainer, member } : { name: payload.focusContainer, member: null, any: true })
        pendingFocusRef.current = payload.focusContainer
        refresh()
      }
    }
  }, [navigationPayload, refresh])

  // Find the currently selected container info
  const selectedContainer = useMemo(
    () => (selected ? containers.find((c) => selectionMatches(selected, c)) ?? null : null),
    [containers, selected],
  )

  // Retry counter for pending focus
  const retryCountRef = useRef(0)

  // When a container is open but vanishes from the list, close it.
  // If we're waiting for a just-deployed container, keep retrying.
  useEffect(() => {
    // Container found — clear pending state
    if (selectedContainer && pendingFocusRef.current) {
      pendingFocusRef.current = null
      retryCountRef.current = 0
      return
    }

    if (selected && !selectedContainer && containers.length > 0) {
      if (pendingFocusRef.current) {
        // Still waiting — retry every 2 seconds, give up after 60 tries (2 min)
        if (retryCountRef.current >= 60) {
          pendingFocusRef.current = null
          retryCountRef.current = 0
          addToast({ type: 'warning', message: `${selected.name} has not been created yet — check the stack's activity, then open it from the list` })
          setSelected(null)
          return
        }
        const timer = setTimeout(() => {
          retryCountRef.current++
          refresh()
        }, 2000)
        return () => clearTimeout(timer)
      } else {
        setSelected(null)
      }
    }
  }, [selected, selectedContainer, containers, refresh, addToast])

  const handleSelect = useCallback((c: ContainerInfo) => {
    setSelected({ name: c.name, member: c.member ?? null })
  }, [])

  const handleBack = useCallback(() => {
    setSelected(null)
  }, [])

  // Escape key returns to container list from detail view
  useEffect(() => {
    if (!selected) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return
      // Check if a VISIBLE modal overlay is open (ignore hidden drawers with pointer-events-none)
      const hasVisibleOverlay = Array.from(document.querySelectorAll('.fixed.inset-0')).some(
        (el) => {
          const style = window.getComputedStyle(el)
          return style.pointerEvents !== 'none' && style.opacity !== '0' && style.display !== 'none'
        },
      )
      if (hasVisibleOverlay) return
      e.preventDefault()
      setSelected(null)
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selected])

  // the server the open container lives on: the row's own, else the VM chosen above (null = the hub)
  const detailMember: RowMember = selectedContainer ? (selectedContainer.member ?? scopeMember) : null
  const detailMemberName = detailMember ? (scopeMembers.find((m) => m.id === detailMember)?.name ?? selectedContainer?.member_name ?? detailMember) : ''

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6 animate-fade-in">
      <DisconnectedBanner />
      <OnDemandMissingBanner />
      {selected && selectedContainer ? (
        <ErrorBoundary key={rowKey(selectedContainer)} fallbackMessage="Failed to render container details">
          <ContainerDetail
            containerName={selectedContainer.name}
            containerInfo={selectedContainer}
            member={detailMember}
            memberName={detailMemberName}
            showCapsule={hasFleet}
            onBack={handleBack}
            onRefreshList={refresh}
            isAdmin={isAdmin}
          />
        </ErrorBoundary>
      ) : selected && !selectedContainer && pendingFocusRef.current ? (
        /* Waiting for just-deployed container to appear */
        <div className="flex flex-col items-center justify-center py-24 gap-4 animate-fade-in">
          <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
            <Loader2 size={28} className="text-cyan-400 animate-spin" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-slate-200">Waiting for {selected.name}</p>
            <p className="text-xs text-slate-400 mt-1">The container has not been created yet — images may still be pulling. This view updates by itself.</p>
          </div>
          <button type="button" onClick={handleBack} className={BTN_TOOLBAR_QUIET}>Back to the list</button>
        </div>
      ) : (
        <ContainerList
          containers={containers}
          loading={loading}
          error={error}
          selectedKey={selectedContainer ? rowKey(selectedContainer) : null}
          onSelect={handleSelect}
          isAdmin={isAdmin}
          onRefresh={refresh}
          scope={scope}
          setScope={setScope}
          scopeMember={scopeMember}
          memberName={memberName}
          members={scopeMembers}
          hasFleet={hasFleet}
          busy={scopedLoading && containers.length > 0}
        />
      )}
    </div>
  )
}

export default Containers
