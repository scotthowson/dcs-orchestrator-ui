// =============================================================================
// useBrand — the name and the line under it, as the sidebar and the sign-in
// page show them: the app name the person chose (default "DCS Orchestrator"),
// and their own subtitle or else the server's name (SERVER_NAME, else its
// hostname). A subtitle that only repeats the name is left out.
// =============================================================================

import { useSettingsStore, OLD_DEFAULT_NAMES } from '../stores/settingsStore'
import { useSystemStore } from '../stores/systemStore'
import type { ServerStatus } from '../../shared/types'

export const DEFAULT_APP_NAME = 'DCS Orchestrator'

/** SERVER_NAME values nobody chose: the wizard's and .env.example's default, and the app names an older dashboard wrote into it */
const NOT_A_SERVER_NAME = new Set(['Docker Server', DEFAULT_APP_NAME, ...OLD_DEFAULT_NAMES])

/** the server's name as people know it: its SERVER_NAME when someone set one, else its hostname */
export function serverLabel(status: Pick<ServerStatus, 'hostname' | 'server_name'> | null | undefined): string {
  const named = status?.server_name?.trim() ?? ''
  return named && !NOT_A_SERVER_NAME.has(named) ? named : (status?.hostname ?? '')
}

export function useBrand(): { name: string; subtitle: string } {
  const chosen = useSettingsStore((s) => s.projectName)
  const custom = useSettingsStore((s) => s.projectSubtitle)
  const server = useSystemStore((s) => serverLabel(s.status))
  const rawServerName = useSystemStore((s) => s.status?.server_name ?? '')
  // an older dashboard copied the server's name into the app name: that is the server's name, not a chosen app name
  const name = chosen && chosen !== server && chosen !== rawServerName ? chosen : DEFAULT_APP_NAME
  const subtitle = custom || server
  return { name, subtitle: subtitle === name ? '' : subtitle }
}
