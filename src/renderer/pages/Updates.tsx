// =============================================================================
// Updates — everything that can be updated, in two blocks: DCS and Docker (the
// framework on this server, this dashboard, the Docker engine, the VMs of a hub)
// and Docker images (which are stale, which have a newer digest, pull them).
//
// Colour: emerald = up to date, cyan = an update is available (information; its
// button is the emerald "go"), amber = needs attention (diverged, edits in the
// way, a container on an old copy), rose = failed, violet = the fleet (a VM).
// =============================================================================

import StatTile from '../components/common/StatTile'
import { useState, useMemo, useCallback, useEffect, useRef } from 'react'
import {
  Download,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertTriangle,
  Clock,
  Package,
  ArrowUpCircle,
  GitBranch,
  GitCommit,
  Shield,
  RotateCcw,
  Server,
  Monitor,
  Power,
  Info,
  Boxes,
  Container,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import { useFleetRole } from '../hooks/useFleetRole'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import DockerEngineCard from '../components/updates/DockerEngineCard'
import AutoImageUpdates from '../components/updates/AutoImageUpdates'
import { useConnectionStore } from '../stores/connectionStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { LoadingState, EmptyState } from '../components/common/PageState'
import { Fact, CardIcon, formatRelativeTime, FreshnessLine } from '../components/updates/updateBits'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_SHEET_PRIMARY, TONE_OK, TONE_ATTN } from '../lib/ui'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import { relinkFleetMember, fetchImageUpdates, checkImageRegistry, updateImage, checkSystemUpdate, applySystemUpdate, rollbackSystemUpdate, fetchVersion, applyUiUpdate, restartApiServer, fetchSystemUpdateHistory, fetchFleetVersions, updateFleet, fetchFleetImages, checkFleetImageRegistry } from '../api/endpoints'
import type { ImageCheckResponse, ImageUpdateInfo, SystemUpdateCheckResponse, SystemUpdateApplyResponse, SystemUpdateHistoryResponse, APIVersion, FleetVersions, FleetUpdateRound } from '../../shared/types'
import { BUILD_VERSION, BUILD_DATE } from '../constants/buildInfo'

import { Pill } from '../components/common/Pill'
import { type Tone } from '../lib/tone'
// ---------------------------------------------------------------------------
// Staleness: how old an image is
// ---------------------------------------------------------------------------

/** how old an image is: fresh, getting old, old — and unknown */
const STALENESS_TONE: Record<string, Tone> = { current: 'ok', aging: 'attention', stale: 'problem', unknown: 'neutral' }
const STALENESS_LABEL: Record<string, string> = { current: 'Current', aging: 'Aging', stale: 'Stale', unknown: 'Unknown' }

/** "5 min ago", "2 h ago", "3 d ago" for an ISO date */
function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (!Number.isFinite(diff) || diff < 0) return 'just now'
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

/** Registry path, repository and tag rendered as one readable reference that
 *  wraps at path boundaries instead of mid-word */
function ImageRef({ image }: { image: string }) {
  const at = image.indexOf('@')
  const base = at >= 0 ? image.slice(0, at) : image
  const lastSlash = base.lastIndexOf('/')
  const path = lastSlash >= 0 ? base.slice(0, lastSlash + 1) : ''
  const nameTag = base.slice(lastSlash + 1)
  const colon = nameTag.lastIndexOf(':')
  const name = colon > 0 ? nameTag.slice(0, colon) : nameTag
  const tag = colon > 0 ? nameTag.slice(colon + 1) : ''
  const segments = path.split('/').filter(Boolean)
  return (
    <span className="font-mono text-xs leading-5" title={image}>
      {segments.map((seg) => (
        <span key={seg} className="text-slate-500">{seg}/<wbr /></span>
      ))}
      <span className="text-slate-100 font-semibold">{name}</span>
      {tag && (
        <span className="ml-1.5 inline-flex items-center rounded-md bg-white/[0.06] border border-white/[0.06] px-1.5 py-px text-[10px] text-slate-300 align-middle whitespace-nowrap">
          {tag}
        </span>
      )}
    </span>
  )
}

function StalenessBadge({ staleness }: { staleness: string }) {
  return <Pill tone={STALENESS_TONE[staleness] ?? 'neutral'} dot>{STALENESS_LABEL[staleness] ?? staleness}</Pill>
}

// ---------------------------------------------------------------------------
// Skeleton rows for loading state
// ---------------------------------------------------------------------------

function SkeletonRow({ cols = 6 }: { cols?: number }) {
  return (
    <tr className="border-b border-white/[0.03]">
      {[...Array(cols)].map((_, i) => (
        <td key={i} className="px-3 py-3">
          <div className="h-3 w-20 rounded skeleton" />
        </td>
      ))}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shown when the API is not back after a restart: what to look at on the server (systemd's reason is in its journal; on Fedora/RHEL
 *  the usual one is the SELinux label of a script an update replaced) */
const RESTART_FAILED = 'The API did not answer after the restart. On the server, "journalctl -u dcs-api -n 30" says why. On Fedora/RHEL (SELinux) the usual cause is the label of the updated script: "sudo restorecon -v <install dir>/.scripts/api-server.sh" and "sudo systemctl restart dcs-api" bring it back.'
/** A row's identity in the fleet view: the image on its DCS (the hub's rows have no member) */
const rowKey = (img: ImageUpdateInfo) => `${img.member ?? ''}|${img.image}`
/** the Compose containers of a row that still run an older copy of its image (pulled earlier, never recreated): what Update recreates */
const outdatedOf = (img: ImageUpdateInfo) => (img.containers_outdated ?? '').split(',').map((c) => c.trim()).filter(Boolean)
/** …and those started by hand, which DCS cannot recreate */
const manualOf = (img: ImageUpdateInfo) => (img.containers_outdated_manual ?? '').split(',').map((c) => c.trim()).filter(Boolean)

/** a column header of the images table (the same static look as the Containers table's) */
const TH = 'px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

/** the heading of a block of this page: its icon, its name, one line under it, its buttons on the right */
function SectionHead({ icon, title, sub, actions }: { icon: React.ReactNode; title: string; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-slate-400" aria-hidden>{icon}</span>
          <h2 className="text-sm font-semibold text-slate-200">{title}</h2>
        </div>
        {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap sm:justify-end">{actions}</div>}
    </div>
  )
}

function UpdateStatusBadge({ res }: { res: SystemUpdateCheckResponse }) {
  if (res.state === 'member') return <Pill tone="fleet" icon={<Boxes size={10} />} title={res.note}>Updated by its hub</Pill>
  if (res.state === 'manual') return <Pill tone="neutral" icon={<Info size={10} />} title={res.note}>Installed without git</Pill>
  if (res.checked === false) return <Pill tone="problem" icon={<AlertTriangle size={10} />}>Check failed</Pill>
  if (res.available) return <Pill tone="info" dot>{res.latest_name ? `${res.latest_name} available` : 'Update available'}</Pill>
  if (res.state === 'ahead') return <Pill tone="info" icon={<GitBranch size={10} />} title="This checkout has commits newer than the release">Ahead of the release</Pill>
  if (res.state === 'diverged') return <Pill tone="attention" icon={<AlertTriangle size={10} />}>Diverged</Pill>
  return <Pill tone="ok" icon={<CheckCircle size={10} />}>Up to date</Pill>
}

// ---------------------------------------------------------------------------
// Updates Page Component
// ---------------------------------------------------------------------------

export default function Updates() {
  const connStatus = useConnectionStore((s) => s.status)
  const isConnected = connStatus === 'connected'
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'
  const { addToast } = useToast()
  const confirm = useConfirm()

  const autoCheckUpdates = useSettingsStore((s) => s.autoCheckUpdates)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const [lastChecked, setLastChecked] = useState<number | null>(null)

  // ---- System update state ----
  const [sysUpdate, setSysUpdate] = useState<SystemUpdateCheckResponse | null>(null)
  const [sysChecking, setSysChecking] = useState(false)
  const [sysCheckError, setSysCheckError] = useState<string | null>(null)
  const [sysApplying, setSysApplying] = useState(false)
  const [sysRollingBack, setSysRollingBack] = useState(false)
  const [replaceLocal, setReplaceLocal] = useState(false)
  const [restartAfter, setRestartAfter] = useState(true)
  const [restartingApi, setRestartingApi] = useState<string | null>(null)
  const [restartHint, setRestartHint] = useState<string | null>(null)
  const [applyReport, setApplyReport] = useState<SystemUpdateApplyResponse | null>(null)
  const [updHistory, setUpdHistory] = useState<SystemUpdateHistoryResponse | null>(null)
  const [lastBackupTag, setLastBackupTag] = useState<string | null>(() => {
    // Persist across navigation — load from sessionStorage
    try { return sessionStorage.getItem('dcs-last-backup-tag') } catch { return null }
  })

  // ---- UI image update state ----
  const [uiUpdateAvailable, setUiUpdateAvailable] = useState(false)
  const [uiUpdating, setUiUpdating] = useState(false)

  // App version from Electron
  const [appVersion, setAppVersion] = useState<string>(BUILD_VERSION)
  useEffect(() => {
    if (window.electronAPI?.getVersion) {
      window.electronAPI.getVersion().then(v => setAppVersion(v)).catch(() => {})
    }
  }, [])

  // API version info
  const [apiVersionInfo, setApiVersionInfo] = useState<APIVersion | null>(null)

  // ---- The fleet: a hub keeps its VMs on its own DCS version ----
  const { isHub } = useFleetRole()
  // every minute, and every 5 s while a round runs (one request for both: the card shows what the round follows)
  const [followingSince, setFollowingSince] = useState<number | null>(null)
  const fvPoll = usePolling<FleetVersions>(fetchFleetVersions, 60000, { key: 'fleet-versions', enabled: isHub && isAdmin })
  const { data: fvData, refresh: refreshFleetVersions } = fvPoll
  // the VMs' versions are an admin's to read (the server refuses them to anyone else)
  const fv = isHub && isAdmin ? fvData : null
  const fleetMembers = useMemo(() => fv?.members ?? [], [fv])
  const [fleetUpdating, setFleetUpdating] = useState(false)
  // with the hub's own update: bring the VMs along (the server queues the round for after its restart)
  const [fleetAfter, setFleetAfter] = useState(true)
  const [fleetReport, setFleetReport] = useState<FleetUpdateRound | null>(null)
  // a round that finished: the toast and the card's report
  // a VM the hub cannot log in to any more (its password secret was deleted, or the VM locked the hub out): it joins again
  const [relinking, setRelinking] = useState('')
  const relink = async (id: string) => {
    setRelinking(id)
    try { const r = await relinkFleetMember(id); addToast({ type: 'success', message: r.message, duration: 6000 }); refreshFleetVersions() }
    catch (err) { addToast({ type: 'error', message: err instanceof Error ? err.message : 'The relink failed', duration: 12000 }) } finally { setRelinking('') }
  }
  const finishRound = useCallback((r: FleetUpdateRound) => {
    setFleetReport(r)
    if (r.status === 'aborted') {
      addToast({ type: 'error', message: 'The update round was cut short — the hub went down in the middle of it; check the VMs on the fleet card', duration: 8000 })
    } else {
      addToast({
        type: r.failed ? (r.updated ? 'warning' : 'error') : 'success',
        message: r.failed
          ? `${r.updated} VM${r.updated === 1 ? '' : 's'} updated, ${r.failed} failed — see the fleet card`
          : `${r.updated} VM${r.updated === 1 ? '' : 's'} now on DCS ${r.hub_version}`,
        duration: 8000,
      })
    }
    // the members re-execute on the new code: ask again once they are back
    setTimeout(refreshFleetVersions, 6000)
    setTimeout(refreshFleetVersions, 15000)
  }, [addToast, refreshFleetVersions])
  // A round runs on its own on the hub (a member's self-update takes minutes): POST /fleet/update answers 202 {running: true}
  // when it did not finish within the API's wait, and GET /fleet/versions last_round carries {status: "running"} meanwhile —
  // the page then asks every 5 s until the status changes (the hub gives a round up after 30 min; so does this)
  const followRound = useCallback(() => {
    setFleetUpdating(true)
    setFollowingSince(Date.now())
  }, [])
  // a failed read is the hub busy or restarting under the round: the next one asks again
  const roundPoll = usePolling<FleetVersions>(fetchFleetVersions, 5000, { key: 'fleet-versions', enabled: followingSince !== null })
  useEffect(() => {
    if (followingSince === null) return
    const v = roundPoll.data
    // only an answer asked after the round started says it ended
    if (v && roundPoll.updatedAt > followingSince && (!v.last_round || v.last_round.status !== 'running')) {
      setFollowingSince(null); setFleetUpdating(false)
      if (v.last_round) finishRound(v.last_round)
      return
    }
    if (Date.now() - followingSince > 30 * 60_000) { setFollowingSince(null); setFleetUpdating(false) }
  }, [followingSince, roundPoll.data, roundPoll.updatedAt, roundPoll.error, finishRound])
  // a round already running when the page opens (started before, or from the hub's own update): follow it
  const lastRoundStatus = fv?.last_round?.status
  useEffect(() => { if (lastRoundStatus === 'running' && followingSince === null) followRound() }, [lastRoundStatus, followingSince, followRound])
  const handleUpdateFleet = useCallback(async (members: string[] | 'all' = 'all') => {
    if (fleetUpdating) return
    setFleetUpdating(true)
    setFleetReport(null)
    try {
      const r = await updateFleet(members)
      if (r.running || r.status === 'running') {
        // 202: the round goes on without the request — the card follows it
        const n = members === 'all' ? fleetMembers.length : members.length
        addToast({ type: 'info', message: `Update round started for ${n} VM${n === 1 ? '' : 's'} — the fleet card follows it`, duration: 8000 })
        setFleetReport(r)
        followRound()
        return
      }
      finishRound(r)
      setFleetUpdating(false)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The fleet update failed' })
      setFleetUpdating(false)
    }
  }, [fleetUpdating, fleetMembers.length, addToast, finishRound, followRound])

  const ingestCheck = useCallback((res: SystemUpdateCheckResponse) => {
    setSysUpdate(res)
    setSysCheckError(null)
    setUiUpdateAvailable(!!res.ui_update?.available)
    useSettingsStore.getState().updateSetting('updatesAvailable', res.available ? Math.max(1, res.commits_behind) : 0)
    if (res.last_backup_tag) {
      setLastBackupTag(res.last_backup_tag)
      try { sessionStorage.setItem('dcs-last-backup-tag', res.last_backup_tag) } catch {}
    } else if (res.last_backup_tag === '') {
      setLastBackupTag(null)
      try { sessionStorage.removeItem('dcs-last-backup-tag') } catch {}
    }
    setLastChecked(Date.now())
  }, [])

  /** After a restart: wait for the API to answer again (up to ~1 min), then re-check */
  const waitForApi = useCallback(async (etaSeconds: number) => {
    const deadline = Date.now() + (Math.max(5, etaSeconds) + 50) * 1000
    await new Promise((r) => setTimeout(r, Math.min(Math.max(2, etaSeconds), 8) * 1000))
    while (Date.now() < deadline) {
      try {
        const res = await checkSystemUpdate()
        ingestCheck(res)
        fetchVersion().then(setApiVersionInfo).catch(() => {})
        return true
      } catch {
        await new Promise((r) => setTimeout(r, 2000))
      }
    }
    return false
  }, [ingestCheck])

  const handleCheckSystemUpdate = useCallback(async () => {
    if (sysChecking || !isAdmin) return
    setSysChecking(true)
    try {
      const result = await checkSystemUpdate()
      ingestCheck(result)
      if (result.state === 'member' || result.state === 'manual') {
        addToast({ type: 'info', message: result.note || 'Updates are not fetched here' })
      } else if (result.checked === false) {
        addToast({ type: 'error', message: `Could not check for updates: ${result.error || 'GitHub is unreachable'}` })
      } else if (result.available) {
        addToast({ type: 'info', message: `DCS ${result.latest_version || result.latest_name || ''} is available (${result.commits_behind} commit${result.commits_behind !== 1 ? 's' : ''})` })
      } else if (result.ui_update?.available) {
        addToast({ type: 'info', message: 'A dashboard update is available' })
      } else {
        addToast({ type: 'success', message: 'Everything is up to date' })
      }
    } catch (err) {
      setSysCheckError(err instanceof Error ? err.message : 'Could not check for updates')
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not check for updates' })
    } finally {
      setSysChecking(false)
    }
  }, [sysChecking, isAdmin, addToast, ingestCheck])

  const handleApplySystemUpdate = useCallback(async () => {
    if (sysApplying || !sysUpdate?.available) return
    const blocking = sysUpdate.local_changes?.conflicts ?? []
    if (blocking.length > 0 && !replaceLocal) {
      addToast({ type: 'error', message: 'Tick "Replace them with the release versions" first, or revert those files.' })
      return
    }
    setSysApplying(true)
    setApplyReport(null)
    setRestartHint(null)
    try {
      const result = await applySystemUpdate({ replaceLocal, restart: restartAfter, fleet: isHub && fleetMembers.length > 0 && fleetAfter })
      if (result.updated) {
        if (result.fleet_update_queued) {
          addToast({ type: 'info', message: `The ${fleetMembers.length} VM${fleetMembers.length === 1 ? '' : 's'} follow once the hub is back on the new version`, duration: 8000 })
          setTimeout(refreshFleetVersions, 30000)
          setTimeout(refreshFleetVersions, 70000)
        }
        setApplyReport(result)
        const tag = result.backup_tag
        setLastBackupTag(tag)
        try { if (tag) sessionStorage.setItem('dcs-last-backup-tag', tag) } catch {}
        useSettingsStore.getState().updateSetting('updatesAvailable', 0)
        addToast({ type: 'success', message: `Updated to ${result.new_version || 'the latest release'}`, duration: 6000 })
        if (result.restart_scheduled && result.restart) {
          setRestartingApi(result.restart.method === 'systemd' ? 'Restarting the API through systemd (about 10 s)…' : 'Restarting the API…')
          const back = await waitForApi(result.restart.eta_seconds)
          setRestartingApi(null)
          addToast(back
            ? { type: 'success', message: 'The API is back on the new version' }
            : { type: 'error', message: RESTART_FAILED, duration: 30000 })
        } else {
          if (result.restart?.hint) setRestartHint(result.restart.hint)
          const fresh = await checkSystemUpdate()
          ingestCheck(fresh)
          fetchVersion().then(setApiVersionInfo).catch(() => {})
        }
      } else {
        addToast({ type: result.state === 'current' ? 'info' : 'error', message: result.message || 'Nothing to apply' })
        const fresh = await checkSystemUpdate()
        ingestCheck(fresh)
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The update failed' })
    } finally {
      setSysApplying(false)
    }
  }, [sysApplying, sysUpdate, replaceLocal, restartAfter, addToast, ingestCheck, waitForApi, isHub, fleetMembers.length, fleetAfter, refreshFleetVersions])

  const handleRollback = useCallback(async () => {
    if (sysRollingBack || !lastBackupTag) return
    const sure = await confirm({
      title: `Roll back to ${lastBackupTag}?`,
      message: 'Your stack, template and plugin files are kept as they are.',
      confirmLabel: 'Roll back',
      danger: true,
    })
    if (!sure) return
    setSysRollingBack(true)
    setRestartHint(null)
    try {
      const result = await rollbackSystemUpdate(lastBackupTag, restartAfter)
      if (result.rolled_back) {
        addToast({ type: 'success', message: `Rolled back to ${result.restored_version || 'the previous version'}` })
        setLastBackupTag(null)
        try { sessionStorage.removeItem('dcs-last-backup-tag') } catch {}
        setApplyReport(null)
        if (result.restart_scheduled && result.restart) {
          setRestartingApi('Restarting the API…')
          await waitForApi(result.restart.eta_seconds)
          setRestartingApi(null)
        } else {
          if (result.restart?.hint) setRestartHint(result.restart.hint)
          const fresh = await checkSystemUpdate()
          ingestCheck(fresh)
        }
      } else {
        addToast({ type: 'error', message: result.message || 'The rollback failed' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The rollback failed' })
    } finally {
      setSysRollingBack(false)
    }
  }, [sysRollingBack, lastBackupTag, restartAfter, addToast, ingestCheck, waitForApi, confirm])

  const handleRestartApi = useCallback(async () => {
    if (restartingApi) return
    const sure = await confirm({
      title: 'Restart the API now?',
      message: 'Open pages reconnect by themselves. A deploy, backup or image pull running at this moment would be interrupted.',
      confirmLabel: 'Restart API',
      danger: true,
    })
    if (!sure) return
    setRestartHint(null)
    try {
      const res = await restartApiServer()
      if (!res.restarting) {
        setRestartHint(res.hint)
        addToast({ type: 'info', message: 'DCS cannot restart this listener by itself — see the hint' })
        return
      }
      setRestartingApi(res.method === 'systemd' ? 'Restarting the API through systemd (about 10 s)…' : 'Restarting the API…')
      const back = await waitForApi(res.eta_seconds)
      setRestartingApi(null)
      addToast(back ? { type: 'success', message: 'API restarted' } : { type: 'error', message: RESTART_FAILED, duration: 30000 })
    } catch (err) {
      setRestartingApi(null)
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The restart failed' })
    }
  }, [restartingApi, addToast, waitForApi, confirm])

  const conflicts = sysUpdate?.local_changes?.conflicts ?? []
  const userEdits = sysUpdate?.local_changes?.user.length ?? 0

  // Auto-check for system + UI updates on mount (the release check is an admin's; anyone reads the versions)
  useEffect(() => {
    if (isConnected && !sysUpdate && !sysChecking) {
      if (isAdmin) checkSystemUpdate().then(ingestCheck).catch((e) => setSysCheckError(e instanceof Error ? e.message : 'The check failed'))
      fetchVersion().then(setApiVersionInfo).catch(() => {})
    }
  }, [isConnected]) // eslint-disable-line react-hooks/exhaustive-deps

  // Unattended-update outcomes (admins), refreshed with every check
  useEffect(() => {
    if (!isConnected || !isAdmin) return
    fetchSystemUpdateHistory().then(setUpdHistory).catch(() => {})
  }, [isConnected, isAdmin, sysUpdate])

  // Periodic auto-check: the global poller's (one check for both); the page takes the answers that come while it is open
  const [openedAt] = useState(() => Date.now())
  const autoCheck = usePolling(checkSystemUpdate, autoCheckUpdates > 0 ? autoCheckUpdates : 3_600_000, {
    key: pollKeys.updateCheck,
    enabled: isAdmin && autoCheckUpdates > 0,
    onError: (e) => setSysCheckError(e.message || 'The check failed'),
  })
  useEffect(() => {
    if (autoCheck.data && autoCheck.updatedAt > openedAt) ingestCheck(autoCheck.data)
  }, [autoCheck.data, autoCheck.updatedAt, openedAt, ingestCheck])

  // ---- Image update state ----
  const [registryChecking, setRegistryChecking] = useState(false)
  const [updatingImages, setUpdatingImages] = useState<Set<string>>(new Set())
  const [bulkUpdating, setBulkUpdating] = useState(false)
  // A manual update pulls the newer image AND recreates the Compose services that run the old copy. (The unattended runs have their own choice, in Automatic image updates.)
  // Outcome of the last bulk run per image, shown in the row until the next registry check
  const [bulkResults, setBulkResults] = useState<Record<string, 'done' | 'failed'>>({})

  // ---- Whose images: everywhere (the hub and every VM), the hub alone, or one VM — the choice the Health and Images pages share ----
  const { scope: imgScope, setScope: setImgScope, member: scopeMember, memberName: scopeName, members: scopeMembers, hasFleet } = useFleetScope()
  const fetchScopedImages = useCallback(() => (imgScope === 'all' ? fetchFleetImages() : fetchImageUpdates(scopeMember)), [imgScope, scopeMember])

  // ---- Polling: local staleness data ----
  const {
    data,
    loading,
    refresh,
  } = usePolling<ImageCheckResponse>(fetchScopedImages, 30000)
  // a scope switch fetches at once; the rows of the other DCS fade until the answer lands
  const [switching, setSwitching] = useState(false)
  const scopeRef = useRef<string | null>(null)
  useEffect(() => {
    if (scopeRef.current === imgScope) return
    const first = scopeRef.current === null
    scopeRef.current = imgScope
    if (first) return
    // (also while the first answer is still on its way: it belongs to the scope the page opened with)
    if (data) { setSwitching(true); setBulkResults({}) }
    refresh()
  }, [imgScope, data, refresh])
  useEffect(() => { setSwitching(false) }, [data])

  const images = data?.images ?? []

  // ---- Computed summary ----
  const counts = useMemo(() => {
    return {
      total: data?.total ?? 0,
      current: data?.current ?? 0,
      aging: data?.aging ?? 0,
      stale: data?.stale ?? 0,
      updates: data?.updates_available ?? images.filter((img) => img.update_available === true).length,
    }
  }, [data, images])

  const updatableImages = useMemo(
    () => images.filter((img) => img.update_available === true),
    [images],
  )

  const staleImages = useMemo(
    () => images.filter((img) => img.staleness === 'stale'),
    [images],
  )

  // Rows whose containers still run an older copy of the image (pulled earlier, never recreated)
  const outdatedImages = useMemo(() => images.filter((img) => outdatedOf(img).length > 0), [images])

  // Everything "Update All" touches: confirmed registry updates first, then
  // images that are stale by age, then those with containers left on an old copy
  // (deduplicated per server: the same image on the hub and on a VM is two rows)
  const bulkTargets = useMemo(() => {
    const seen = new Set<string>()
    const out: ImageUpdateInfo[] = []
    for (const img of [...updatableImages, ...staleImages, ...outdatedImages]) {
      const k = rowKey(img)
      if (!seen.has(k)) { seen.add(k); out.push(img) }
    }
    return out
  }, [updatableImages, staleImages, outdatedImages])
  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number; current: string } | null>(null)

  // ---- Check registry for updates (slow POST): everywhere at once, or one DCS ----
  const handleCheckRegistry = useCallback(async () => {
    if (registryChecking) return
    setRegistryChecking(true)
    setBulkResults({})
    try {
      if (imgScope === 'all') {
        const r = await checkFleetImageRegistry()
        addToast({
          type: r.unreachable ? 'warning' : 'info',
          message: `Registry check complete: ${r.updates_available} update${r.updates_available !== 1 ? 's' : ''} across ${r.members.length} DCS (${r.total} image${r.total !== 1 ? 's' : ''})${r.unreachable ? ` — ${r.unreachable} not answering` : ''}`,
          duration: 6000,
        })
      } else {
        const result = await checkImageRegistry(scopeMember)
        addToast({
          type: 'info',
          message: `Registry check complete: ${result.updates_available} update${result.updates_available !== 1 ? 's' : ''} available out of ${result.total} image${result.total !== 1 ? 's' : ''}${scopeName ? ` on ${scopeName}` : ''}`,
          duration: 5000,
        })
      }
      // Refresh local data to pick up any new staleness info
      refresh()
    } catch (err) {
      addToast({
        type: 'error',
        message: err instanceof Error ? err.message : 'The registry check failed',
      })
    } finally {
      setRegistryChecking(false)
    }
  }, [registryChecking, addToast, refresh, imgScope, scopeMember, scopeName])

  // ---- Update a single image, on the DCS its row belongs to ----
  const handleUpdateImage = useCallback(
    async (img: ImageUpdateInfo) => {
      const key = rowKey(img)
      const member = img.member ?? scopeMember
      const where = img.member && imgScope === 'all' ? ` on ${img.member_name || img.member}` : ''
      if (updatingImages.has(key)) return
      setUpdatingImages((prev) => new Set(prev).add(key))
      try {
        const result = await updateImage(img.image, { recreate: true }, member)
        if (result.success) {
          const parts: string[] = []
          if (result.containers_restarted.length > 0) parts.push(`recreated ${result.containers_restarted.join(', ')}`)
          if (result.containers_failed?.length) parts.push(`${result.containers_failed.join(', ')} did not come back up`)
          if (result.containers_skipped?.length) parts.push(`${result.containers_skipped.join(', ')} skipped (not Compose-managed)`)
          const tail = parts.length
            ? ` — ${parts.join('; ')}`
            : ' — no running container was on an older copy'
          addToast({
            type: result.containers_failed?.length ? 'warning' : 'success',
            message: `Pulled ${img.image}${where}${tail}`,
            duration: 6000,
          })
          setBulkResults((prev) => ({ ...prev, [key]: 'done' }))
          refresh()
        } else {
          addToast({ type: 'error', message: `Could not update ${img.image}${where}` })
        }
      } catch (err) {
        addToast({
          type: 'error',
          message: err instanceof Error ? err.message : `Could not update ${img.image}${where}`,
        })
      } finally {
        setUpdatingImages((prev) => {
          const next = new Set(prev)
          next.delete(key)
          return next
        })
      }
    },
    [updatingImages, addToast, refresh, imgScope, scopeMember],
  )

  // ---- Update every image with a confirmed update or a stale age, each on its own DCS ----
  const handleUpdateAllStale = useCallback(async () => {
    if (bulkUpdating || bulkTargets.length === 0) return
    setBulkUpdating(true)
    setBulkResults({})
    let successCount = 0
    let failCount = 0
    const restarted: string[] = []
    const skipped: string[] = []
    const failedContainers: string[] = []

    for (let i = 0; i < bulkTargets.length; i++) {
      const img = bulkTargets[i]
      const key = rowKey(img)
      setBulkProgress({ done: i, total: bulkTargets.length, current: key })
      try {
        const result = await updateImage(img.image, { recreate: true }, img.member ?? scopeMember)
        if (result.success) {
          successCount++
          restarted.push(...result.containers_restarted)
          skipped.push(...(result.containers_skipped ?? []))
          failedContainers.push(...(result.containers_failed ?? []))
          setBulkResults((prev) => ({ ...prev, [key]: 'done' }))
        } else {
          failCount++
          setBulkResults((prev) => ({ ...prev, [key]: 'failed' }))
        }
      } catch {
        failCount++
        setBulkResults((prev) => ({ ...prev, [key]: 'failed' }))
      }
    }
    setBulkProgress(null)

    if (successCount > 0) {
      const parts: string[] = []
      if (restarted.length) parts.push(`recreated ${restarted.join(', ')}`)
      if (failedContainers.length) parts.push(`${failedContainers.join(', ')} did not come back up`)
      if (skipped.length) parts.push(`${skipped.length} not Compose-managed, left running`)
      if (restarted.length === 0 && failedContainers.length === 0) parts.push('no running container was on an older copy')
      addToast({
        type: failedContainers.length ? 'warning' : 'success',
        message: `Pulled ${successCount} image${successCount !== 1 ? 's' : ''}${imgScope === 'all' ? ' across the fleet' : scopeName ? ` on ${scopeName}` : ''}${failCount > 0 ? ` (${failCount} failed)` : ''}${parts.length ? ` — ${parts.join('; ')}` : ''}`,
        duration: 8000,
      })
    }
    if (failCount > 0 && successCount === 0) {
      addToast({
        type: 'error',
        message: `All ${failCount} image update${failCount !== 1 ? 's' : ''} failed`,
      })
    }

    refresh()
    setBulkUpdating(false)
  }, [bulkUpdating, bulkTargets, addToast, refresh, imgScope, scopeMember, scopeName])

  // ---- Disconnected ----
  if (!isConnected) {
    return connStatus === 'connecting' ? (
      <LoadingState label="Connecting to the DCS API…" hint="System, Docker Engine and image updates are shown for the server you are connected to." />
    ) : (
      <EmptyState
        icon={<ArrowUpCircle size={28} />}
        title={connStatus === 'error' ? 'The DCS API is not answering' : 'Connect to a server to see its updates'}
        hint={connStatus === 'error'
          ? 'This page (system updates, Docker Engine, VMs and image updates) returns on its own as soon as the API answers again. If it stays away, check the dcs-api service on the server.'
          : 'System, Docker Engine and image updates are shown for the server you are connected to.'}
      />
    )
  }

  // ---- Initial loading skeleton ----
  const isInitialLoad = loading && !data

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader page="updates" />

      {/* ══════════════════════════════════════════════════════════════════════
          DCS and Docker: the framework, this dashboard, the engine, the VMs
          ══════════════════════════════════════════════════════════════════════ */}
      <section aria-label="DCS and Docker" className="surface p-4 md:p-5">
        <SectionHead
          icon={<Server size={16} />}
          title="DCS and Docker"
          sub="The framework on this server, this dashboard, the Docker engine and the VMs"
          actions={<>
            {lastChecked && (
              <span className="text-[10px] text-slate-500">
                Last checked {formatRelativeTime(lastChecked)}
              </span>
            )}
            {isAdmin && (
              <button type="button" onClick={handleCheckSystemUpdate} disabled={sysChecking} className={BTN_TOOLBAR_QUIET}>
                {sysChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Check for updates
              </button>
            )}
          </>}
        />

        {/* Auto-check settings (the release check is an admin's: the server answers it to no one else) */}
        {isAdmin && (
        <div className="flex flex-wrap items-center gap-3 mt-4 p-3 rounded-xl bg-white/[0.03] border border-white/[0.03]">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="auto-check-updates" className="block text-xs font-medium text-slate-300">Auto-check for updates</label>
            <p className="text-[10px] text-slate-500 mt-0.5">Periodically check for DCS framework and image updates</p>
          </div>
          <select
            id="auto-check-updates"
            value={autoCheckUpdates}
            onChange={(e) => updateSetting('autoCheckUpdates', Number(e.target.value))}
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-slate-200 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40"
          >
            <option value={0}>Off</option>
            <option value={3600000}>Every hour</option>
            <option value={86400000}>Every 24 hours</option>
            <option value={604800000}>Every week</option>
          </select>
        </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 mt-5">
          {/* DCS framework */}
          <div className={`rounded-xl border p-5 transition-all duration-300 ${
            sysUpdate?.available
              ? 'bg-cyan-500/[0.05] border-cyan-500/15 glow-cyan'
              : 'bg-white/[0.03] border-white/5'
          }`}>
            <div className="flex items-center gap-3 mb-4">
              <CardIcon><GitBranch size={16} /></CardIcon>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">DCS Framework</h3>
                <p className="text-[10px] text-slate-500">DCS Orchestrator server</p>
              </div>
            </div>

            {sysUpdate ? (
              <div className="space-y-3">
                <Fact label="Installed">
                  <span className="text-xs font-mono text-slate-300">
                    {sysUpdate.current_version}
                    {sysUpdate.current_commit && <span className="text-slate-500"> · {sysUpdate.current_commit}</span>}
                  </span>
                </Fact>
                {sysUpdate.available && (
                  <Fact label="Available">
                    <span className="text-xs font-mono text-cyan-300">
                      {sysUpdate.latest_version || sysUpdate.latest_name}
                      {sysUpdate.latest_commit && <span className="text-cyan-400/60"> · {sysUpdate.latest_commit}</span>}
                    </span>
                  </Fact>
                )}
                {sysUpdate.state === 'member' || sysUpdate.state === 'manual' ? (
                  <Fact label="Updated by">
                    <span className="text-xs text-slate-300 text-right" title={sysUpdate.hub?.url || sysUpdate.note}>
                      {sysUpdate.state === 'member' ? `its hub${sysUpdate.hub?.name ? ` · ${sysUpdate.hub.name}` : ''}${sysUpdate.hub?.version ? ` (DCS ${sysUpdate.hub.version})` : ''}` : 'by hand — no git here'}
                    </span>
                  </Fact>
                ) : (
                  <Fact label="Channel">
                    <span className="text-xs font-mono text-slate-400" title={`Change it under ${pageLabel('config')} → Environment → Update channel`}>
                      {sysUpdate.channel || 'stable'}
                      <span className="text-slate-600"> · {(sysUpdate.branch || '').replace(/^heads\//, '')}</span>
                    </span>
                  </Fact>
                )}
                <Fact label="Status">
                  <UpdateStatusBadge res={sysUpdate} />
                </Fact>
                <FreshnessLine
                  ok={!sysUpdate.available && sysUpdate.checked !== false}
                  okText={sysUpdate.state === 'member' ? 'Follows the hub' : sysUpdate.state === 'manual' ? 'Nothing fetched here' : 'Up to date'}
                  warnText={sysUpdate.checked === false ? 'Check failed' : `${sysUpdate.latest_version || sysUpdate.latest_name || 'A release'} available`}
                  checkedAt={lastChecked}
                  updatedAt={sysUpdate.last_updated_at}
                  tone={sysUpdate.checked === false ? 'problem' : 'info'}
                />

                {apiVersionInfo && (
                  <>
                    <Fact label="API version"><span className="text-xs font-mono text-slate-300">{apiVersionInfo.api_version}</span></Fact>
                    <Fact label="Docker"><span className="text-xs font-mono text-slate-300">{apiVersionInfo.docker_version}</span></Fact>
                    <Fact label="Compose"><span className="text-xs font-mono text-slate-300">{apiVersionInfo.compose_version}</span></Fact>
                  </>
                )}

                {sysUpdate.checked === false && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-500/[0.06] border border-rose-500/15">
                    <AlertTriangle size={12} className="text-rose-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-rose-300">{sysUpdate.error || 'GitHub could not be reached, so nothing is known about newer releases.'}</p>
                  </div>
                )}
                {sysUpdate.state === 'diverged' && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
                    <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-300">This checkout carries commits the release does not have, so it cannot be fast-forwarded. Align it once by hand (git fetch origin, then git reset --hard {sysUpdate.latest_commit}); your stack and template files are not part of that.</p>
                  </div>
                )}

                {userEdits > 0 && (
                  <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
                    <Shield size={11} className="shrink-0 mt-px" />
                    <span>{userEdits} stack, template or plugin file{userEdits === 1 ? '' : 's'} carry your edits — updates keep them exactly as they are.</span>
                  </p>
                )}
                {conflicts.length > 0 && (
                  <div className="px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                      <p className="text-[10px] text-amber-300">These framework files were edited on this server and the release changes them too:</p>
                    </div>
                    <ul className="pl-5 space-y-0.5 text-[10px] font-mono text-amber-200/80">
                      {conflicts.map((f) => <li key={f}>{f}</li>)}
                    </ul>
                    <label className="flex items-start gap-2 text-[10px] text-amber-200 cursor-pointer">
                      <input type="checkbox" checked={replaceLocal} onChange={(e) => setReplaceLocal(e.target.checked)} className="accent-amber-500 mt-0.5" />
                      <span>Replace them with the release versions (the current copies are kept under .data/update-backups)</span>
                    </label>
                  </div>
                )}

                {sysUpdate.available && sysUpdate.release_notes && sysUpdate.release_notes.trim() && (
                  <div className="mt-3 pt-3 border-t border-white/[0.03]">
                    <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">What&apos;s new</p>
                    <pre className="text-[11px] text-slate-300 whitespace-pre-wrap font-sans leading-relaxed max-h-56 overflow-y-auto scrollbar-thin rounded-lg bg-slate-950/50 border border-white/[0.03] p-3">{sysUpdate.release_notes.trim()}</pre>
                  </div>
                )}
                {sysUpdate.available && sysUpdate.changelog.length > 0 && (
                  <details className="mt-2">
                    <summary className="text-[10px] text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                      {sysUpdate.changelog.length} commit{sysUpdate.changelog.length !== 1 ? 's' : ''}
                    </summary>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-thin mt-2">
                      {sysUpdate.changelog.map((c) => (
                        <div key={c.hash} className="flex items-start gap-2">
                          <GitCommit size={12} className="text-slate-500 shrink-0 mt-0.5" />
                          <div className="min-w-0">
                            <p className="text-[11px] text-slate-300 truncate">{c.message}</p>
                            <p className="text-[9px] text-slate-500">{c.hash} by {c.author}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </details>
                )}

                {isAdmin && sysUpdate.available && (
                  <div className="mt-3 pt-3 border-t border-white/[0.03] space-y-2.5">
                    <label className="flex items-start gap-2 text-[10px] text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={restartAfter} onChange={(e) => setRestartAfter(e.target.checked)} className="accent-emerald-500 mt-0.5" />
                      <span>
                        Restart the API afterwards so every part runs the new version
                        {sysUpdate.restart_method === 'manual' && <span className="text-amber-400/80"> — not possible from here on this install; a hint follows</span>}
                      </span>
                    </label>
                    {isHub && fleetMembers.length > 0 && (
                      <label className="flex items-start gap-2 text-[10px] text-slate-400 cursor-pointer" title="Once the hub runs the new version, every VM fetches its code and restarts its API in place (data and stacks stay)">
                        <input type="checkbox" checked={fleetAfter} onChange={(e) => setFleetAfter(e.target.checked)} className="accent-emerald-500 mt-0.5" />
                        <span>Then update the {fleetMembers.length} VM{fleetMembers.length === 1 ? '' : 's'} to the same version{!restartAfter && <span className="text-amber-400/80"> — after the API is restarted</span>}</span>
                      </label>
                    )}
                    <button
                      type="button"
                      onClick={handleApplySystemUpdate}
                      disabled={sysApplying || !!restartingApi || (conflicts.length > 0 && !replaceLocal)}
                      className={`${BTN_SHEET_PRIMARY} w-full`}
                    >
                      {sysApplying ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                      {sysApplying ? 'Updating…' : `Update to ${sysUpdate.latest_version || sysUpdate.latest_name || 'latest'}`}
                    </button>
                  </div>
                )}

                {restartingApi && (
                  <div role="status" className="flex items-center gap-2 px-3 py-2 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/15 text-[11px] text-emerald-300">
                    <Loader2 size={12} className="animate-spin shrink-0" />
                    {restartingApi}
                  </div>
                )}
                {restartHint && !restartingApi && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/[0.06] border border-amber-500/15">
                    <Info size={12} className="text-amber-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-300 break-words">{restartHint}</p>
                  </div>
                )}

                {applyReport && (
                  <div className="mt-3 pt-3 border-t border-white/[0.03] space-y-1 text-[10px] text-slate-400">
                    <p className="text-slate-300 font-medium">
                      Updated {applyReport.previous_version} → {applyReport.new_version}
                      {typeof applyReport.commits_applied === 'number' && ` (${applyReport.commits_applied} commit${applyReport.commits_applied !== 1 ? 's' : ''})`}
                    </p>
                    {(applyReport.kept_local?.length ?? 0) > 0 && (
                      <p>Kept your edits: <span className="font-mono">{applyReport.kept_local?.join(', ')}</span></p>
                    )}
                    {(applyReport.replaced_local?.length ?? 0) > 0 && (
                      <p>Replaced (copies in <span className="font-mono">{applyReport.backup_dir}</span>): <span className="font-mono">{applyReport.replaced_local?.join(', ')}</span></p>
                    )}
                    {(applyReport.new_settings?.length ?? 0) > 0 && (
                      <p>New settings on the {pageLabel('config')} page: <span className="font-mono">{applyReport.new_settings?.join(', ')}</span> (defaults apply until you set them)</p>
                    )}
                    {applyReport.service_definition_changed && (
                      <p className="text-amber-300">The systemd unit template changed — run <span className="font-mono">sudo .scripts/install-service.sh</span> once to refresh it.</p>
                    )}
                  </div>
                )}

                {isAdmin && updHistory && (updHistory.running || updHistory.entries.length > 0) && (
                  <details className="mt-3 pt-3 border-t border-white/[0.03]">
                    <summary className="text-[10px] text-slate-500 uppercase tracking-wider cursor-pointer select-none hover:text-slate-400 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                      Unattended updates{updHistory.running ? ' · running now' : ''} ({updHistory.entries.length})
                    </summary>
                    <div className="space-y-1.5 mt-2 max-h-40 overflow-y-auto scrollbar-thin">
                      {updHistory.entries.map((e, i) => (
                        <div key={`${e.timestamp}-${i}`} className="flex items-start gap-2 text-[10px]">
                          <span className={`shrink-0 mt-0.5 w-1.5 h-1.5 rounded-full ${e.result === 'updated' || e.result === 'images' ? 'bg-emerald-400' : e.result === 'rolled-back' || e.result === 'failed' || e.result === 'check-failed' ? 'bg-rose-400' : 'bg-amber-400'}`} />
                          <div className="min-w-0">
                            <p className="text-slate-300 break-words">{e.message}</p>
                            <p className="text-[9px] text-slate-500">{new Date(e.timestamp).toLocaleString()} · {e.result}{e.channel ? ` · ${e.channel}` : ''}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="text-[9px] text-slate-500 mt-2">Auto-rollback {updHistory.auto_rollback ? `on: ${updHistory.rollback_drop} points within ${updHistory.health_grace} s` : 'off'} · schedule a “DCS self-update” on the {pageLabel('automations')} page</p>
                  </details>
                )}

                {isAdmin && (
                  <div className="flex flex-wrap items-center justify-between gap-3 mt-3 pt-3 border-t border-white/[0.03]">
                    <div className="min-w-0">
                      {lastBackupTag ? (
                        <>
                          <p className="text-[10px] text-slate-500 uppercase tracking-wider">Rollback available</p>
                          <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5" title={lastBackupTag}>{lastBackupTag}</p>
                        </>
                      ) : (
                        <p className="text-[10px] text-slate-500">
                          API listener: {sysUpdate.restart_method === 'reexec' ? 'restarts in place' : sysUpdate.restart_method === 'systemd' ? 'restarts through systemd' : sysUpdate.restart_method === 'relaunch' ? 'older listener, relaunched on request' : 'restart by hand only'}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {lastBackupTag && (
                        <button
                          type="button"
                          onClick={handleRollback}
                          disabled={sysRollingBack || !!restartingApi}
                          className={`${BTN_CARD} ${TONE_ATTN}`}
                        >
                          {sysRollingBack ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                          {sysRollingBack ? 'Rolling back…' : 'Roll back'}
                        </button>
                      )}
                      <Hint label="Restart the API listener now">
                        <button
                          type="button"
                          onClick={handleRestartApi}
                          disabled={!!restartingApi || sysApplying}
                          className={BTN_CARD_QUIET}
                        >
                          <Power size={12} />
                          Restart API
                        </button>
                      </Hint>
                    </div>
                  </div>
                )}
              </div>
            ) : !isAdmin ? (
              <div className="space-y-3">
                <Fact label="Installed"><span className="text-xs font-mono text-slate-300">{apiVersionInfo?.framework_version || '—'}</span></Fact>
                {apiVersionInfo && (
                  <>
                    <Fact label="API version"><span className="text-xs font-mono text-slate-300">{apiVersionInfo.api_version}</span></Fact>
                    <Fact label="Docker"><span className="text-xs font-mono text-slate-300">{apiVersionInfo.docker_version}</span></Fact>
                    <Fact label="Compose"><span className="text-xs font-mono text-slate-300">{apiVersionInfo.compose_version}</span></Fact>
                  </>
                )}
                <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
                  <Shield size={11} className="shrink-0 mt-px" />
                  <span>Admins check for and apply DCS updates.</span>
                </p>
              </div>
            ) : sysCheckError ? (
              <div className="space-y-3">
                <Fact label="Installed"><span className="text-xs font-mono text-slate-300">{apiVersionInfo?.framework_version || '—'}</span></Fact>
                <Fact label="Status"><Pill tone="problem" icon={<AlertTriangle size={10} />}>Check failed</Pill></Fact>
                <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-rose-500/[0.06] border border-rose-500/15">
                  <Info size={12} className="text-rose-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-rose-200 break-words">{sysCheckError}</p>
                </div>
                <FreshnessLine ok={false} okText="" warnText="Not checked" checkedAt={lastChecked} updatedAt={null} tone="problem" />
                <button type="button" onClick={handleCheckSystemUpdate} disabled={sysChecking} className={BTN_CARD_QUIET}>
                  {sysChecking ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Try again
                </button>
              </div>
            ) : (
              <div className="space-y-2.5" role="status" aria-label="Reading the framework version">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="flex items-center justify-between" aria-hidden>
                    <div className="h-3 w-16 rounded skeleton" />
                    <div className="h-3 w-20 rounded skeleton" />
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* This dashboard */}
          <div className="surface p-4 md:p-5">
            <div className="flex items-center gap-3 mb-4">
              <CardIcon><Monitor size={16} /></CardIcon>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Dashboard</h3>
                <p className="text-[10px] text-slate-500">This dashboard</p>
              </div>
            </div>

            <div className="space-y-3">
              <Fact label="Version"><span className="text-xs font-mono text-slate-300">{appVersion}</span></Fact>
              <Fact label="Build date"><span className="text-xs text-slate-400">{BUILD_DATE}</span></Fact>
              <Fact label="Platform"><span className="text-xs text-slate-400">{window.electronAPI ? 'Electron desktop' : 'Web interface (Docker)'}</span></Fact>
              {isAdmin ? (
                <>
                  <Fact label="Status">
                    {uiUpdateAvailable
                      ? <Pill tone="info" icon={<ArrowUpCircle size={10} />}>Update available</Pill>
                      : <Pill tone="ok" icon={<CheckCircle size={10} />}>Current</Pill>}
                  </Fact>
                  <FreshnessLine ok={!uiUpdateAvailable} okText="Up to date" warnText="Update available" checkedAt={lastChecked} updatedAt={BUILD_DATE} updatedLabel="Built" />
                </>
              ) : (
                // the dashboard's release is learnt from the same check as the framework's: an admin's to run
                <p className="text-[10px] text-slate-500 flex items-start gap-1.5">
                  <Shield size={11} className="shrink-0 mt-px" />
                  <span>Admins check for and apply dashboard updates.</span>
                </p>
              )}
            </div>
            {uiUpdateAvailable && (
              <div className="mt-3 pt-3 border-t border-white/[0.03]">
                <button
                  type="button"
                  onClick={async () => {
                    setUiUpdating(true)
                    addToast({ type: 'info', message: 'Updating the dashboard…', duration: 3000 })
                    try {
                      await applyUiUpdate()
                      addToast({ type: 'success', message: 'Dashboard updated — reconnecting…', duration: 5000 })
                      setTimeout(() => window.location.reload(), 8000)
                    } catch (err) {
                      addToast({ type: 'error', message: err instanceof Error ? err.message : 'The dashboard update failed' })
                    }
                    setUiUpdating(false)
                  }}
                  disabled={uiUpdating}
                  className={`${BTN_SHEET_PRIMARY} w-full`}
                >
                  {uiUpdating ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                  {uiUpdating ? 'Updating…' : 'Update the dashboard'}
                </button>
              </div>
            )}

            <div className="mt-4 pt-3 border-t border-white/[0.03] space-y-2">
              <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-slate-800/40">
                <Shield size={12} className="text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  {window.electronAPI
                    ? 'App updates are delivered via new releases. Check the GitHub repository for the latest version.'
                    : 'Running in browser mode: the Update button pulls the latest published image and recreates the dashboard container.'}
                </p>
              </div>
              <a
                href="https://github.com/scotthowson/dcs-orchestrator-ui/releases/latest"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-800/40 hover:bg-slate-800/70 transition-colors group/apk focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                title="Every release ships an Android APK and desktop installers"
              >
                <Download size={12} className="text-slate-400 shrink-0" />
                <span className="text-[10px] text-slate-400 group-hover/apk:text-slate-200 leading-relaxed">
                  Android app and desktop installers: download from the latest GitHub release
                </span>
              </a>
            </div>
          </div>

          {/* Docker Engine — the runtime under every container, here and (from a hub) in every VM */}
          <DockerEngineCard enabled={isConnected} isHub={isHub} />
        </div>

        {/* The VMs: a hub keeps them on its own DCS version */}
        {isHub && fv && fleetMembers.length > 0 && (
          <div className={`rounded-xl border p-5 mt-4 transition-all duration-300 ${fv.behind > 0 ? 'bg-cyan-500/[0.05] border-cyan-500/15' : 'bg-white/[0.03] border-white/5'}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
              <div className="flex items-center gap-3">
                <CardIcon tone="fleet"><Boxes size={16} /></CardIcon>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">The VMs</h3>
                  <p className="text-[10px] text-slate-500">
                    {fv.behind > 0
                      ? `${fv.behind} of ${fleetMembers.length} behind the hub (DCS ${fv.hub.version})`
                      : fv.unreachable > 0
                        ? `${fleetMembers.length - fv.unreachable} on DCS ${fv.hub.version} · ${fv.unreachable} not answering`
                        : `All ${fleetMembers.length} on DCS ${fv.hub.version}, like the hub`}
                  </p>
                </div>
              </div>
              {isAdmin && (
                <Hint label="Every answering VM fetches the hub's code, keeps its data and stacks, and restarts its API in place">
                  <button
                    type="button"
                    onClick={() => handleUpdateFleet('all')}
                    disabled={fleetUpdating || fv.pending || fleetMembers.every((m) => !m.reachable)}
                    className={`${BTN_TOOLBAR} ${TONE_OK} shrink-0`}
                  >
                    {fleetUpdating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                    {fleetUpdating ? 'Updating the VMs…' : fv.pending ? 'Queued after the restart' : fv.behind > 0 ? `Update ${fv.behind} VM${fv.behind === 1 ? '' : 's'}` : 'Update all VMs'}
                  </button>
                </Hint>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {fleetMembers.map((m) => {
                // a running round has no results yet
                const r = (fleetReport?.results ?? []).find((x) => x.id === m.id)
                return (
                  <Pill
                    key={m.id}
                    dot
                    tone={!m.reachable ? 'neutral' : m.behind ? 'info' : 'ok'}
                    title={!m.reachable ? 'not answering' : m.behind ? `DCS ${m.version} — the hub runs ${fv.hub.version}` : `DCS ${m.version}${m.vmid ? ` · VM #${m.vmid}` : ''}`}
                  >
                    {m.name}
                    <span className="font-mono text-[10px] opacity-80 ml-1.5">{m.version || '?'}</span>
                    {r && (r.success ? <CheckCircle size={11} className="text-emerald-400 ml-1" aria-label="updated" /> : <AlertTriangle size={11} className="text-rose-400 ml-1" aria-label="failed" />)}
                  </Pill>
                )
              })}
            </div>
            <div className="mt-3">
              <FreshnessLine
                ok={fv.behind === 0 && fv.unreachable === 0}
                okText={`All ${fleetMembers.length} VM${fleetMembers.length === 1 ? '' : 's'} up to date`}
                warnText={fv.behind > 0 ? `${fv.behind} VM${fv.behind === 1 ? '' : 's'} behind` : `${fv.unreachable} not answering`}
                tone={fv.behind > 0 ? 'info' : 'attention'}
                checkedAt={fv.checked_at}
                updatedAt={(() => { const lr = fleetReport ?? fv.last_round; return lr && lr.status !== 'running' ? lr.at : null })()}
              />
            </div>
            {(fleetReport ?? fv.last_round) && (
              <div className="mt-3 pt-3 border-t border-white/[0.03] text-[10px] text-slate-400 space-y-1">
                {(() => {
                  const lr = (fleetReport ?? fv.last_round) as FleetUpdateRound
                  const results = lr.results ?? []
                  if (lr.status === 'running') {
                    // in progress: no counts and no results yet — what it addresses and since when
                    const n = lr.members?.length ?? fleetMembers.length
                    return (
                      <p className="text-cyan-300 font-medium flex items-center gap-1.5">
                        <Loader2 size={11} className="animate-spin shrink-0" aria-hidden />
                        Update round running for {n} VM{n === 1 ? '' : 's'} · to DCS {lr.hub_version} · since {new Date((lr.started_at ?? lr.at) * 1000).toLocaleTimeString()}
                      </p>
                    )
                  }
                  return (
                    <>
                      <p className="text-slate-300 font-medium">
                        {fleetReport ? 'This round' : 'Last round'}{lr.status === 'aborted' ? ' (cut short — the hub went down during it)' : ''}: {lr.updated} updated{lr.failed ? `, ${lr.failed} failed` : ''} · DCS {lr.hub_version} · {new Date(lr.at * 1000).toLocaleString()}
                      </p>
                      {results.filter((x) => !x.success).map((x) => (
                        <p key={x.id} className="text-rose-300">
                          {x.id}: {x.message}
                          {/\password|rate-limit|refused the account|log ?in/i.test(x.message ?? '') && (
                            <button type="button" disabled={relinking === x.id} onClick={() => void relink(x.id)} className="ml-2 underline underline-offset-2 text-cyan-300 hover:text-cyan-200 disabled:opacity-50">
                              {relinking === x.id ? 'Relinking…' : 'Relink to the hub'}
                            </button>
                          )}
                        </p>
                      ))}
                    </>
                  )
                })()}
              </div>
            )}
            <p className="text-[10px] text-slate-500 mt-3">
              Each VM fetches the hub's code, keeps its own data, accounts, stacks and settings, and restarts its API in place. A hub update with "then update the VMs" ticked does this on its own once the hub is back.
            </p>
          </div>
        )}
      </section>

      {/* ══════════════════════════════════════════════════════════════════════
          Docker images: which are old, which have a newer digest, pull them
          ══════════════════════════════════════════════════════════════════════ */}
      <section aria-label="Docker images" className="space-y-5">
        <SectionHead
          icon={<Container size={16} />}
          title="Docker images"
          sub={imgScope === 'all' ? `Every image on the hub and its ${scopeMembers.length} VM${scopeMembers.length === 1 ? '' : 's'} — checked and pulled where each one runs` : scopeMember ? `The images inside the VM ${scopeName} — checked and pulled there` : 'Check Docker images for available updates and apply them'}
          actions={<>
            {/* Update all — prioritizes images with confirmed registry updates */}
            {isAdmin && bulkTargets.length > 0 && (
              <Hint label="Pulls each image and recreates the Compose services that use it">
                <button type="button" onClick={handleUpdateAllStale} disabled={bulkUpdating} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                  {bulkUpdating ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                  {bulkProgress
                    ? `Updating ${bulkProgress.done + 1}/${bulkProgress.total}…`
                    : updatableImages.length > 0
                      ? `Update all (${bulkTargets.length})`
                      : staleImages.length > 0
                        ? `Update all stale (${bulkTargets.length})`
                        : `Recreate outdated (${bulkTargets.length})`}
                </button>
              </Hint>
            )}

            {/* Check the registry (a POST: an admin's; anyone reads what the last check found) */}
            {isAdmin && (
              <button type="button" onClick={handleCheckRegistry} disabled={registryChecking} className={BTN_TOOLBAR_QUIET}>
                {registryChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                Check registry for updates
              </button>
            )}
            {data?.registry_checked_at && (
              <span className="text-[10px] text-slate-500 whitespace-nowrap" title={new Date(data.registry_checked_at).toLocaleString()}>
                Registry checked {formatRelative(data.registry_checked_at)}
              </span>
            )}
          </>}
        />

        {/* ---- Whose images: everywhere, the hub, or one VM — and the one-line status ---- */}
        <div className="flex flex-col gap-2">
          {hasFleet && <FleetScopeChips scope={imgScope} members={scopeMembers} onChange={setImgScope} label="Images on" busy={switching} />}
          {data && (
            <FreshnessLine
              ok={counts.updates === 0}
              okText={data.registry_checked_at ? `All ${counts.total} image${counts.total === 1 ? '' : 's'} up to date` : `No updates known for ${counts.total} image${counts.total === 1 ? '' : 's'} — ${isAdmin ? 'check the registry' : 'admins check the registry'}`}
              warnText={`${counts.updates} image update${counts.updates === 1 ? '' : 's'} available`}
              okTone={data.registry_checked_at || isAdmin ? 'ok' : 'neutral'}
              checkedAt={data.registry_checked_at}
              updatedAt={data.last_update_at}
              updatedLabel="Last pulled"
            />
          )}
          {outdatedImages.length > 0 && (
            <div className="flex flex-wrap items-start gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2.5 text-[11px] text-amber-100/90">
              <AlertTriangle size={14} className="text-amber-300 shrink-0 mt-0.5" />
              <span className="flex-1 min-w-[12rem] leading-relaxed">
                {outdatedImages.reduce((n, i) => n + outdatedOf(i).length, 0)} container{outdatedImages.reduce((n, i) => n + outdatedOf(i).length, 0) === 1 ? '' : 's'} still run{outdatedImages.reduce((n, i) => n + outdatedOf(i).length, 0) === 1 ? 's' : ''} an older copy of {outdatedImages.length === 1 ? 'an image' : `${outdatedImages.length} images`} that was pulled since (an update that only pulled, or one from an earlier version that did not recreate them). Update recreates them on the current copy.
              </span>
              {isAdmin && (
                <Hint label="Recreate the Compose services on the current copy of their image">
                  <span className="inline-flex shrink-0">
                    <button type="button" onClick={handleUpdateAllStale} disabled={bulkUpdating} className={`${BTN_CARD} ${TONE_ATTN} disabled:cursor-not-allowed`}>
                      Recreate now
                    </button>
                  </span>
                </Hint>
              )}
            </div>
          )}
          {isAdmin && <AutoImageUpdates scope={imgScope} members={scopeMembers} />}
        </div>

        {/* ---- Summary stat cards ---- */}
        <div className={`grid grid-cols-2 ${counts.updates > 0 ? 'sm:grid-cols-5' : 'sm:grid-cols-4'} gap-3 stagger-children`}>
          <StatTile icon={Package} label="Total images" value={counts.total} tone="info" loading={isInitialLoad} />
          <StatTile icon={CheckCircle} label="Current" value={counts.current} tone="ok" loading={isInitialLoad} />
          <StatTile icon={Clock} label="Aging" value={counts.aging} tone={(counts.aging ?? 0) > 0 ? 'attention' : 'neutral'} loading={isInitialLoad} />
          <StatTile icon={AlertTriangle} label="Stale" value={counts.stale} tone={(counts.stale ?? 0) > 0 ? 'problem' : 'neutral'} loading={isInitialLoad} />
          {counts.updates > 0 && (
            <StatTile icon={ArrowUpCircle} label="To update" value={counts.updates} tone="info" loading={isInitialLoad} />
          )}
        </div>

        {/* ---- Image table ---- */}
        <div className="surface p-4 md:p-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
            <h3 className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-200">
              Tracked images
              {imgScope === 'all' && <Pill tone="info">Hub + {scopeMembers.length} VM{scopeMembers.length === 1 ? '' : 's'}</Pill>}
              {scopeMember && <VmCapsule member={scopeMember} name={scopeName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} />}
            </h3>
            <p className="text-[10px] text-slate-500 leading-relaxed max-w-md">
              {isAdmin
                ? 'Age shows when the image was built. Press “Check registry for updates” to compare digests against upstream — this shows definitive “Update” or “Latest” badges without pulling images.'
                : 'Age shows when the image was built. Admins check the registry for newer digests and update the images; what their last check found shows as “Update” or “Latest”.'}
            </p>
          </div>

          {/* Initial loading skeleton */}
          {isInitialLoad ? (
            <div className="overflow-x-auto" role="status" aria-label="Reading the images">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5">
                    <th scope="col" className={`${TH} text-left`}>Image</th>
                    <th scope="col" className={`${TH} text-left`}>Container(s)</th>
                    <th scope="col" className={`${TH} text-left hidden sm:table-cell`}>Stack</th>
                    <th scope="col" className={`${TH} text-right`}>Age (days)</th>
                    <th scope="col" className={`${TH} text-left`}>Staleness</th>
                    {isAdmin && <th scope="col" className={`${TH} text-right`}>Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {[...Array(6)].map((_, i) => (
                    <SkeletonRow key={i} cols={isAdmin ? 6 : 5} />
                  ))}
                </tbody>
              </table>
            </div>
          ) : images.length === 0 ? (
            /* Empty state */
            <EmptyState
              icon={<Package size={28} />}
              title="No images found"
              hint={!isConnected
                ? 'Connect to the API server to view image update information.'
                : isAdmin
                  ? 'Run a registry check to discover images and their update status.'
                  : 'Images appear here once a stack has pulled them.'}
              action={isConnected && isAdmin ? (
                <button type="button" onClick={handleCheckRegistry} disabled={registryChecking} className={BTN_TOOLBAR_QUIET}>
                  {registryChecking ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                  Check registry
                </button>
              ) : undefined}
            />
          ) : (
            /* Image table */
            <div className="overflow-x-auto -mx-4 md:-mx-6">
              <table className="w-full text-sm min-w-[480px]">
                <thead>
                  <tr className="border-b border-white/5">
                    <th scope="col" className={`${TH} text-left`}>Image</th>
                    <th scope="col" className={`${TH} text-left`}>Container(s)</th>
                    <th scope="col" className={`${TH} text-left hidden sm:table-cell`}>Stack</th>
                    {imgScope === 'all' && <th scope="col" className={`${TH} text-left`}>Where</th>}
                    <th scope="col" className={`${TH} text-right`}>Age (days)</th>
                    <th scope="col" className={`${TH} text-left`}>Staleness</th>
                    {isAdmin && <th scope="col" className={`${TH} text-right`}>Actions</th>}
                  </tr>
                </thead>
                <tbody className={`divide-y divide-white/[0.03] transition-opacity ${switching ? 'opacity-40' : ''}`}>
                  {images.map((img: ImageUpdateInfo) => {
                    // Only the image being pulled right now is "updating"; the rest
                    // of a bulk run is queued, finished or failed
                    const key = rowKey(img)
                    const isUpdating = updatingImages.has(key) || bulkProgress?.current === key
                    const bulkState = bulkResults[key]
                    const queued = bulkUpdating && !isUpdating && !bulkState && bulkTargets.some((t) => rowKey(t) === key)
                    const oldCopy = outdatedOf(img)
                    const byHand = manualOf(img)
                    // the image is current but some containers were never moved onto it
                    const needsRecreate = oldCopy.length > 0 && img.update_available !== true && img.staleness === 'current'
                    const rowTone = img.update_available === true
                      ? TONE_OK
                      : needsRecreate
                        ? TONE_ATTN
                        : img.staleness === 'current'
                          ? 'bg-white/[0.03] border border-white/5 text-slate-500 cursor-default'
                          : TONE_OK
                    const rowHint = needsRecreate
                      ? `${oldCopy.join(', ')} still run${oldCopy.length === 1 ? 's' : ''} an older copy of this image — recreate ${oldCopy.length === 1 ? 'it' : 'them'} on the current one`
                      : img.update_available === true
                        ? 'A newer digest is published — pull it and recreate the containers'
                        : img.staleness === 'stale'
                          ? 'Pull the tag again and recreate the containers'
                          : 'Nothing newer is known for this tag'
                    return (
                      <tr
                        key={key}
                        className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors duration-150"
                      >
                        {/* Image name */}
                        <td className="px-3 py-3 min-w-[240px]">
                          <ImageRef image={img.image} />
                          {img.size && (
                            <span className="block text-[10px] text-slate-500 mt-0.5">
                              {img.size}
                            </span>
                          )}
                        </td>

                        {/* Container(s) — one chip per container */}
                        <td className="px-3 py-3">
                          {(img.containers && img.containers !== '-') || oldCopy.length > 0 || byHand.length > 0 ? (
                            <div className="flex flex-wrap gap-1 max-w-[380px]">
                              {(img.containers && img.containers !== '-' ? img.containers : '').split(',').map((c) => c.trim()).filter(Boolean).map((c) => (
                                <span key={c} className="inline-flex rounded-md bg-white/[0.05] border border-white/[0.06] px-1.5 py-0.5 text-[10px] font-mono text-slate-300 whitespace-nowrap">
                                  {c}
                                </span>
                              ))}
                              {oldCopy.map((c) => (
                                <span key={`old-${c}`} title={`${c} was started from an older copy of this image and was not recreated since`} className="inline-flex rounded-md bg-amber-500/10 border border-amber-500/25 px-1.5 py-0.5 text-[10px] font-mono text-amber-200 whitespace-nowrap">
                                  {c} · old copy
                                </span>
                              ))}
                              {byHand.map((c) => (
                                <span key={`hand-${c}`} title={`${c} runs an older copy of this image but was not started by Compose, so DCS cannot recreate it — recreate it yourself`} className="inline-flex rounded-md bg-white/[0.04] border border-amber-500/15 px-1.5 py-0.5 text-[10px] font-mono text-amber-200/70 whitespace-nowrap">
                                  {c} · old copy, by hand
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-500">-</span>
                          )}
                        </td>

                        {/* Stack (hidden on mobile) */}
                        <td className="px-3 py-3 hidden sm:table-cell whitespace-nowrap">
                          {img.stack ? <Pill tone="neutral">{img.stack}</Pill> : <span className="text-xs text-slate-500">-</span>}
                        </td>

                        {/* Where it runs (the fleet view) */}
                        {imgScope === 'all' && (
                          <td className="px-3 py-3 whitespace-nowrap">
                            <VmCapsule
                              member={img.member}
                              name={img.member_name}
                              vmid={img.vmid}
                              size="xs"
                              onClick={() => setImgScope(img.member ?? 'hub')}
                            />
                          </td>
                        )}

                        {/* Age (days) */}
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <span className="text-xs font-mono text-slate-300 tabular-nums">
                            {img.age_days >= 0 ? img.age_days : '-'}
                          </span>
                        </td>

                        {/* Staleness badge + update indicator */}
                        <td className="px-3 py-3 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <StalenessBadge staleness={img.staleness} />
                            {img.update_available === true && <Pill tone="info" icon={<ArrowUpCircle size={10} />}>Update</Pill>}
                            {img.update_available === false && <Pill tone="neutral" icon={<CheckCircle size={10} />}>Latest</Pill>}
                            {bulkState === 'done' && !isUpdating && (
                              <Pill tone="ok" icon={<CheckCircle size={10} />} title="Pulled and recreated in this run">Updated</Pill>
                            )}
                            {bulkState === 'failed' && !isUpdating && <Pill tone="problem">Failed</Pill>}
                            {queued && <Pill tone="neutral">Queued</Pill>}
                          </div>
                        </td>

                        {/* Update button (an admin's: for anyone else the staleness column says what is known) */}
                        {isAdmin && (
                        <td className="px-3 py-3 text-right whitespace-nowrap">
                          <Hint label={rowHint}>
                            <span className="inline-flex">
                              <button
                                type="button"
                                onClick={() => handleUpdateImage(img)}
                                disabled={isUpdating || queued || (img.staleness === 'current' && img.update_available !== true && !needsRecreate)}
                                className={`${BTN_CARD} ${rowTone}`}
                              >
                                {isUpdating ? (
                                  <Loader2 size={12} className="animate-spin" />
                                ) : img.staleness === 'current' && !needsRecreate ? (
                                  <CheckCircle size={12} />
                                ) : needsRecreate ? (
                                  <RotateCcw size={12} />
                                ) : (
                                  <Download size={12} />
                                )}
                                {isUpdating
                                  ? 'Updating…'
                                  : queued
                                    ? 'Queued'
                                    : needsRecreate
                                      ? 'Recreate'
                                      : img.staleness === 'current'
                                        ? 'Up to date'
                                        : 'Update'}
                              </button>
                            </span>
                          </Hint>
                        </td>
                        )}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
