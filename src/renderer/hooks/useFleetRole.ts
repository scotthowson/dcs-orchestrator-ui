// =============================================================================
// useFleetRole — is this DCS a hub (Proxmox mode: the VMs are the stacks), a
// member, or on its own? Polled gently and shared by every page that changes
// its face for a hub: the sidebar, the VMs page, the Proxmox page.
// =============================================================================

import { useCallback } from 'react'
import { usePolling } from './usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { fetchFleetStatus } from '../api/endpoints'
import { sharedFetch } from '../lib/sharedFetch'
import type { FleetStatus } from '../../shared/types'

// every instance (the sidebar twice, the scope hook of each page and card) shares one request
const fleetStatusShared = sharedFetch(fetchFleetStatus, 10000)

// the last answer, kept across pages so a page mounts in the right mode at once (no standalone flicker)
let lastStatus: FleetStatus | null = null

/** the last known fleet status without subscribing (the document title, one-off checks) */
export function fleetRoleSnapshot(): FleetStatus | null { return lastStatus }

/** settled: the role is known (or the question failed, or there is no server to ask): a page that waits on it can go on */
export function useFleetRole(): { role: FleetStatus['role'] | null; isHub: boolean; isMember: boolean; status: FleetStatus | null; settled: boolean; refresh: () => void } {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const fleet = usePolling(fleetStatusShared, 30000, { enabled: isConnected })
  const pollRefresh = fleet.refresh
  const refresh = useCallback(() => { fleetStatusShared.invalidate(); pollRefresh() }, [pollRefresh])
  if (fleet.data) lastStatus = fleet.data
  const status = fleet.data ?? lastStatus
  const role = status?.role ?? null
  return { role, isHub: role === 'hub', isMember: role === 'member', status, settled: status !== null || fleet.error !== null || !isConnected, refresh }
}
