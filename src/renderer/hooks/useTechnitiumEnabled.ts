// =============================================================================
// useTechnitiumEnabled — Config → Integrations' Technitium switch (GET /config
// technitium_enabled): the navigation, the DNS & routes card and the page follow
// it. null until the server said. One shared request (pollKeys.config) with the
// Config page, which refreshes it when it saves.
// =============================================================================

import { usePolling } from './usePolling'
import { pollKeys } from '../api/pollKeys'
import { lastPollValue } from '../lib/poll'
import { fetchConfig } from '../api/endpoints'
import type { ServerConfig } from '../../shared/types'

export function useTechnitiumEnabled(): boolean | null {
  const { data } = usePolling(fetchConfig, 300000, { key: pollKeys.config })
  return data ? data.technitium_enabled === true : null
}

/** the same, read outside React (a keyboard shortcut): off until the server said otherwise */
export function technitiumEnabledNow(): boolean {
  return lastPollValue<ServerConfig>(pollKeys.config)?.technitium_enabled === true
}

/** Config → Integrations' VPN switch (GET /config vpn_enabled): the VPN page and its pill on container rows. null until the server said */
export function useVpnEnabled(): boolean | null {
  const { data } = usePolling(fetchConfig, 300000, { key: pollKeys.config })
  return data ? data.vpn_enabled === true : null
}
export function vpnEnabledNow(): boolean {
  return lastPollValue<ServerConfig>(pollKeys.config)?.vpn_enabled === true
}
/** the pages a switched-off integration keeps out of the menu, read outside React */
export function featureOffPages(): ('technitium' | 'vpn')[] {
  return [...(technitiumEnabledNow() ? [] : ['technitium' as const]), ...(vpnEnabledNow() ? [] : ['vpn' as const])]
}
