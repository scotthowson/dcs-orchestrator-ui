// =============================================================================
// useFleetRole — is this DCS a hub (Proxmox mode: the VMs are the stacks), a
// member, or on its own? Polled gently and shared by every page that changes
// its face for a hub: the sidebar, the VMs page, the Proxmox page.
// =============================================================================

import { useCallback } from 'react'
import { usePolling } from './usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { fetchFleetStatus } from '../api/endpoints'
import { pollKeys } from '../api/pollKeys'
import { lastPollValue, refreshPoll } from '../lib/poll'
import type { FleetStatus } from '../../shared/types'

/** settled: the role is known (or the question failed, or there is no server to ask): a page that waits on it can go on */
export function useFleetRole(): { role: FleetStatus['role'] | null; isHub: boolean; isMember: boolean; status: FleetStatus | null; settled: boolean; refresh: () => void } {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  // every instance (the sidebar twice, the scope hook of each page and card) is one request
  const fleet = usePolling(fetchFleetStatus, 30000, { key: pollKeys.fleetStatus })
  const refresh = useCallback(() => refreshPoll(pollKeys.fleetStatus), [])
  // the last answer of this server, however old: a page mounts in the right mode at once (no standalone flicker)
  const status = fleet.data ?? lastPollValue<FleetStatus>(pollKeys.fleetStatus)
  const role = status?.role ?? null
  return { role, isHub: role === 'hub', isMember: role === 'member', status, settled: status !== null || fleet.error !== null || !isConnected, refresh }
}
