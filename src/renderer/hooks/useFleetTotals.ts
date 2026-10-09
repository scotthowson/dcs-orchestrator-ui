// =============================================================================
// useFleetTotals — what the VMs add to a hub's own numbers: containers (running
// and all), stacks, images, networks and volumes. The badges of the sidebar, the
// cards of the dashboard and the status bar all count the whole fleet on a hub, so
// they all ask here; on a server that is not a hub the additions are 0. One request
// is shared by every instance (and by every page that mounts).
// =============================================================================

import { usePolling } from './usePolling'
import { useFleetRole } from './useFleetRole'
import { fetchFleetOverview } from '../api/endpoints'
import { pollKeys } from '../api/pollKeys'
import type { FleetOverview } from '../../shared/types'

export interface FleetTotals {
  containersRunning: number
  containersTotal: number
  /** on demand and asleep (fine: Sablier wakes them on the first request) */
  containersSleeping: number
  stacks: number
  images: number
  networks: number
  volumes: number
}

const NONE: FleetTotals = { containersRunning: 0, containersTotal: 0, containersSleeping: 0, stacks: 0, images: 0, networks: 0, volumes: 0 }

export function useFleetTotals(): { isHub: boolean; totals: FleetTotals; overview: FleetOverview | null } {
  const { isHub } = useFleetRole()
  const { data } = usePolling(fetchFleetOverview, 30000, { key: pollKeys.fleetOverview, enabled: isHub })
  if (!isHub || !data) return { isHub, totals: NONE, overview: null }
  const t = data.totals
  return {
    isHub,
    overview: data,
    // an older hub does not send the Docker counts: they add nothing
    totals: {
      containersRunning: t.containers_running ?? 0,
      containersTotal: t.containers_total ?? 0,
      containersSleeping: t.containers_sleeping ?? 0,
      stacks: t.stacks ?? 0,
      images: t.images ?? 0,
      networks: t.networks ?? 0,
      volumes: t.volumes ?? 0,
    },
  }
}
