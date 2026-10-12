// =============================================================================
// useVpnBehind — the containers of this server that go through the VPN (GET /vpn/status, one shared
// request with the VPN page and the dashboard), for the VPN pill on container rows. Empty while the VPN is off.
// =============================================================================

import { useMemo } from 'react'
import { usePolling } from './usePolling'
import { useVpnEnabled } from './useTechnitiumEnabled'
import { pollKeys } from '../api/pollKeys'
import { fetchVpnStatus } from '../api/endpoints'

const NONE = new Set<string>()

export function useVpnBehind(): Set<string> {
  const on = useVpnEnabled() === true
  const { data } = usePolling(fetchVpnStatus, 60000, { key: pollKeys.vpnStatus, enabled: on })
  return useMemo(() => (on && data ? new Set(data.attached.map((a) => a.container)) : NONE), [on, data])
}
