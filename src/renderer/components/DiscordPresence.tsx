// =============================================================================
// DiscordPresence — keeps the desktop app's Discord Rich Presence in step with
// what DCS sees: "Managing <server>" plus containers, stacks and health.
// Only does anything inside the Electron app with the presence turned on.
// =============================================================================

import { useEffect, useRef } from 'react'
import { useSystemStore } from '../stores/systemStore'
import { useHealthStore } from '../stores/healthStore'
import { useContainerStore } from '../stores/containerStore'
import { useStackStore } from '../stores/stackStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { BUILD_VERSION } from '../constants/buildInfo'

const UPDATE_MS = 15000
const REPO_URL = 'https://github.com/scotthowson/dcs-orchestrator'

export default function DiscordPresence() {
  const startedAt = useRef(Date.now())
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const hostname = useSystemStore((s) => s.status?.hostname)
  const summary = useHealthStore((s) => s.report?.summary)
  const containerCount = useContainerStore((s) => s.containers.length)
  const running = useContainerStore((s) => s.containers.filter((c) => c.state === 'running').length)
  const stackCount = useStackStore((s) => s.stacks.length)
  const projectName = useSettingsStore((s) => s.projectName)
  const serverUrl = useSettingsStore((s) => s.serverUrl)

  useEffect(() => {
    const update = window.electronAPI?.presenceUpdate
    if (!update) return
    const tick = () => {
      const server = hostname || projectName || serverUrl.replace(/^https?:\/\//, '')
      const unhealthy = summary?.unhealthy ?? 0
      const sleeping = summary?.sleeping ?? 0
      const parts: string[] = []
      if (containerCount > 0) parts.push(`${running}/${containerCount} containers`)
      if (stackCount > 0) parts.push(`${stackCount} stack${stackCount === 1 ? '' : 's'}`)
      if (sleeping > 0) parts.push(`${sleeping} on demand`)
      parts.push(unhealthy > 0 ? `${unhealthy} unhealthy` : 'all healthy')
      void update({
        details: isConnected ? `Managing ${server}` : `Reconnecting to ${server}`,
        state: isConnected ? parts.join(' · ') : 'Waiting for the API',
        largeImageKey: 'dcs',
        largeImageText: `DCS Orchestrator ${BUILD_VERSION}`,
        smallImageKey: !isConnected ? 'warning' : unhealthy > 0 ? 'warning' : 'healthy',
        smallImageText: !isConnected ? 'Disconnected' : unhealthy > 0 ? `${unhealthy} container${unhealthy === 1 ? '' : 's'} unhealthy` : 'Everything healthy',
        startTimestamp: startedAt.current,
        buttons: [{ label: 'Get DCS', url: REPO_URL }],
      })
    }
    tick()
    const timer = setInterval(tick, UPDATE_MS)
    return () => clearInterval(timer)
  }, [isConnected, hostname, summary, containerCount, running, stackCount, projectName, serverUrl])

  return null
}
