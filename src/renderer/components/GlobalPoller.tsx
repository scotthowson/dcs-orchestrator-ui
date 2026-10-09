// =============================================================================
// GlobalPoller — keeps the data every page shows fresh regardless of the page:
// the server status, the health report and the container list (into their
// stores), and an admin's DCS update check. Its polls are keyed: a page that
// polls the same request (the Health page's containers, the dashboard's stacks
// card…) shares the request instead of adding its own.
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { useConnectionStore } from '../stores/connectionStore'
import { useSystemStore } from '../stores/systemStore'
import { useHealthStore } from '../stores/healthStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useContainerStore } from '../stores/containerStore'
import { fetchServerStatus, fetchHealthReport, fetchContainers, checkSystemUpdate, fetchVersion } from '../api/endpoints'
import { pollKeys } from '../api/pollKeys'
import { refreshPoll } from '../lib/poll'
import { usePolling } from '../hooks/usePolling'
import { useFleetScope } from '../hooks/useFleetScope'

// Every poll is a bash process on the server (about 0.15 s of CPU on a small VM, cached or not): the cadence below keeps one open
// dashboard under one request a second. Hidden tabs pause them; an action refreshes its list at once.
const STATUS_INTERVAL = 10000
const HEALTH_INTERVAL = 15000
const CONTAINERS_INTERVAL = 15000
const UPDATE_CHECK_DELAY = 15000 // delay initial check to avoid competing with startup

const errorText = (err: Error, fallback: string) => err.message || fallback

export function GlobalPoller() {
  // the health badge and the dashboard read the whole fleet on a hub with VMs (the Health page's own choice does not narrow them)
  const { hasFleet } = useFleetScope()
  const healthScope = hasFleet ? 'all' : 'hub'
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates)
  // GET /system/update/check is admin-only: a user's session never asks (it was a 403 every interval)
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'

  const status = usePolling(fetchServerStatus, STATUS_INTERVAL, {
    key: pollKeys.status,
    onError: (err) => useSystemStore.getState().setError(errorText(err, 'Could not load the server status')),
  })
  useEffect(() => { if (status.data) useSystemStore.getState().setStatus(status.data) }, [status.data])

  // the status bar reads the API version on every page, not only after the dashboard was opened: once per server
  const serverUrl = useConnectionStore((s) => s.serverUrl)
  const versionFor = useRef<string | null>(null)
  useEffect(() => {
    if (!status.data || versionFor.current === serverUrl) return
    versionFor.current = serverUrl
    fetchVersion().then((v) => useSystemStore.getState().setVersion(v)).catch(() => { versionFor.current = null })
  }, [status.data, serverUrl])

  const health = usePolling(() => fetchHealthReport(healthScope), HEALTH_INTERVAL, {
    key: pollKeys.health(healthScope),
    onError: (err) => useHealthStore.getState().setError(errorText(err, 'Could not load the health report')),
  })
  useEffect(() => { if (health.data) useHealthStore.getState().setReport(health.data) }, [health.data])

  // The container list lives here so the Containers page (and the dashboard's container card) open with current data
  // instead of fetching after they mount; useContainerStore().refresh asks it again at once (after an action)
  const containers = usePolling(fetchContainers, CONTAINERS_INTERVAL, {
    key: pollKeys.containers(),
    onError: () => useContainerStore.getState().setLoading(false),
  })
  useEffect(() => {
    const data = containers.data
    if (!data) return
    const store = useContainerStore.getState()
    store.setContainers(data.containers)
    for (const c of data.containers) {
      if (c.cpu_percent != null || c.mem_percent != null) {
        store.setStats(c.name, {
          container: c.name,
          cpu_percent: c.cpu_percent != null ? `${c.cpu_percent}%` : '--',
          memory_percent: c.mem_percent != null ? `${c.mem_percent}%` : '--',
          memory_usage: '',
          network_io: '',
          block_io: '',
          pids: '',
        })
      }
    }
  }, [containers.data])

  // An admin's DCS update check (Settings → automatic checks): first a while after connecting, then on its interval.
  // A long interval that also runs in a hidden tab; the Updates page shares it.
  const [updateArmed, setUpdateArmed] = useState(false)
  useEffect(() => {
    setUpdateArmed(false)
    if (!isConnected) return
    const t = setTimeout(() => setUpdateArmed(true), UPDATE_CHECK_DELAY)
    return () => clearTimeout(t)
  }, [isConnected])
  const update = usePolling(checkSystemUpdate, autoCheckUpdates || UPDATE_CHECK_DELAY, {
    key: pollKeys.updateCheck,
    enabled: updateArmed && isAdmin && autoCheckUpdates > 0,
    whenHidden: 'run',
  })
  useEffect(() => {
    if (update.data) useSettingsStore.getState().updateSetting('updatesAvailable', update.data.available ? update.data.commits_behind : 0)
  }, [update.data])

  // Ctrl+R (app-refresh): the three lists again, now
  useEffect(() => {
    const handler = () => { refreshPoll(pollKeys.status); refreshPoll(pollKeys.health(healthScope)); refreshPoll(pollKeys.containers()) }
    window.addEventListener('app-refresh', handler)
    return () => window.removeEventListener('app-refresh', handler)
  }, [healthScope])

  return null
}
