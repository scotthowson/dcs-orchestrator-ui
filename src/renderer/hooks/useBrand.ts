// =============================================================================
// useBrand — the name and the line under it, as the sidebar and the sign-in
// page show them: the app name the person chose (default "DCS Orchestrator"),
// and their own subtitle or else the server's name (SERVER_NAME, else its
// hostname). A subtitle that only repeats the name is left out.
// =============================================================================

import { useSettingsStore } from '../stores/settingsStore'
import { useSystemStore } from '../stores/systemStore'

export const DEFAULT_APP_NAME = 'DCS Orchestrator'

export function useBrand(): { name: string; subtitle: string } {
  const name = useSettingsStore((s) => s.projectName) || DEFAULT_APP_NAME
  const custom = useSettingsStore((s) => s.projectSubtitle)
  const server = useSystemStore((s) => s.status?.server_name || s.status?.hostname || '')
  const subtitle = custom || server
  return { name, subtitle: subtitle === name ? '' : subtitle }
}
