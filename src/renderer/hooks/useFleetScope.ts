// =============================================================================
// useFleetScope — one choice for every page of a hub: everywhere (the hub and
// every VM in one list), the hub alone, or one VM. Remembered in the browser
// so the Health, Images and Updates pages open on the same view.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePolling } from './usePolling'
import { useFleetRole } from './useFleetRole'
import { useConnectionStore } from '../stores/connectionStore'
import { fetchFleetMembers } from '../api/endpoints'
import { sharedFetch } from '../lib/sharedFetch'
import { apiClient } from '../api/client'
import type { FleetMember, FleetMembersResponse } from '../../shared/types'

// the global poller, the page and its cards all ask for the VMs: one request serves them
const fleetMembersShared = sharedFetch(fetchFleetMembers, 10000)
// the last list of VMs, per server: a page that mounts again opens on the VM it was left on at once. Without it every
// mount read "no fleet" until the list came back, worked on the hub for that moment, then switched to the VM (a page
// keyed by the server, like CrowdSec, showed the hub, its skeleton, then the VM: it "reloaded itself")
let lastList: { base: string; data: FleetMembersResponse } | null = null

/** 'all' | 'hub' | a member id */
export type FleetScope = string
/** url: where the hub reaches the member's API — its host is the address the VM's published ports answer on */
export interface ScopeMember { id: string; name: string; vmid: number | null; reachable: boolean; version: string; url: string }

const KEY = 'dcs-fleet-scope'
let cached: FleetScope | null = null
function load(): FleetScope | null { try { return localStorage.getItem(KEY) || null } catch { return null } }
function save(s: FleetScope) { try { localStorage.setItem(KEY, s) } catch { /* storage unavailable */ } }

/** The member a scope points at (null for everywhere and the hub) */
export function scopeMember(scope: FleetScope): string | null { return scope === 'all' || scope === 'hub' ? null : scope }

export function useFleetScope() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { isHub, settled: roleSettled } = useFleetRole()
  const list = usePolling(fleetMembersShared, 30000, { enabled: isConnected && isHub })
  const base = apiClient.getScopeKey()
  if (list.data) lastList = { base, data: list.data }
  const listData = list.data ?? (lastList && lastList.base === base ? lastList.data : null)
  const listRefresh = list.refresh
  const refreshMembers = useCallback(() => { fleetMembersShared.invalidate(); listRefresh() }, [listRefresh])
  const members: ScopeMember[] = useMemo(
    () => (listData?.members ?? []).map((m: FleetMember) => ({ id: m.id, name: m.name, vmid: m.vmid, reachable: m.reachable, version: m.version, url: m.url ?? '' })),
    [listData],
  )
  const [choice, setChoice] = useState<FleetScope | null>(() => cached ?? load())
  const setScope = useCallback((s: FleetScope) => { cached = s; save(s); setChoice(s) }, [])
  const hasFleet = isHub && members.length > 0
  // without a fleet there is only this server; with one, everywhere unless chosen otherwise
  const scope: FleetScope = hasFleet ? (choice ?? 'all') : 'hub'
  // a VM that vanished from the fleet: back to everywhere
  useEffect(() => {
    const m = choice ? scopeMember(choice) : null
    if (m && list.data && !members.some((x) => x.id === m)) setScope('all')
  }, [choice, list.data, members, setScope])
  const member = scopeMember(scope)
  const memberName = member ? (members.find((m) => m.id === member)?.name ?? member) : ''
  // a VM is the remembered choice, but whether this server is a hub with that VM is not known yet (the first answers of
  // a fresh load): the scope reads "hub" for now and changes once they land. A page that shows one server at a time
  // waits for this before it asks, rather than showing the hub first
  const remembered = choice ? scopeMember(choice) : null
  const pending = !!remembered && isConnected && (!roleSettled || (isHub && !listData && !list.error))
  return { scope, setScope, member, memberName, members, hasFleet, isHub, pending, refresh: refreshMembers }
}
