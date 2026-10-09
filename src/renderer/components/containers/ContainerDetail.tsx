// =============================================================================
// ContainerDetail — Detailed view for a single container with live stats
// =============================================================================

import React, { useEffect, useCallback, useRef, useState, useMemo } from 'react'
import { ContainerInfo, ContainerDetail as ContainerDetailType, ContainerStats, ContainerProcess } from '../../../shared/types'
import { useContainerStore, selectStatsHistory } from '../../stores/containerStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import {
  fetchContainerOn,
  fetchContainerStatsOn,
  fetchContainerLogsOn,
  containerActionOn,
  fetchContainerProcessesOn,
  execContainerCommandOn,
  renameContainerOn,
  updateContainerEnvOn,
} from '../../api/fleetScoped'
import { usePolling } from '../../hooks/usePolling'
import type { RowMember } from '../../../shared/fleetScoped'
import VmCapsule from '../fleet/VmCapsule'
import { serverHostname } from '../../lib/hosts'
import ContainerFileBrowser from './ContainerFileBrowser'
import { CopyButton } from '../common/CopyButton'
import { FloatingSaveBar } from '../common/FloatingSaveBar'
import { useSettingsStore } from '../../stores/settingsStore'
import LiveLogViewer from '../logs/LiveLogViewer'
import { NukeDialog } from './NukeDialog'
import Hint from '../common/Hint'
import { SegmentedControl } from '@mantine/core'
import { EmptyState } from '../common/PageState'
import { pageLabel } from '../../constants/pageTitles'
import {
  BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM,
  TONE_QUIET, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER,
} from '../../lib/ui'
import OnDemandDialog from './OnDemandDialog'
import HomarrChip from './HomarrChip'
import ThemeButton from './ThemeButton'
import { Bomb } from 'lucide-react'
import { StateChip } from '../common/StateChip'
import { containerState, isAsleep } from '../../lib/containerState'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'
import { ArrowLeft, ArrowRight, Cpu, MemoryStick, Network, HardDrive, Users, Box, Clock, Globe, Variable, Info, Activity, Layers, Play, Square, RotateCw, ScrollText, RefreshCw, Eye, EyeOff, ChevronDown, Lock, Download, Terminal, Loader2, AlertCircle, Pencil, Check, X, Trash2, ExternalLink, FileCode, Plus, Undo2, Moon } from 'lucide-react'
import SearchInput from '../common/SearchInput'
import Kbd from '../common/Kbd'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '--'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0 && days === 0) parts.push(`${secs}s`)

  return parts.join(' ') || '0s'
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '--'
  try {
    const d = new Date(dateStr)
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return dateStr
  }
}

/** Parse env string (newline-separated KEY=VALUE) into entries. */
function parseEnvString(envStr: string): Array<{ key: string; value: string }> {
  if (!envStr || envStr === '--') return []
  return envStr
    .split('\n')
    .filter((line) => line.includes('='))
    .map((line) => {
      const idx = line.indexOf('=')
      return {
        key: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
      }
    })
}

/** Parse networks string (newline or comma-separated). */
function parseNetworks(networkStr: string): string[] {
  if (!networkStr || networkStr === '--') return []
  return networkStr
    .split(/[\n,]/)
    .map((n) => n.trim())
    .filter(Boolean)
}

/** Parse IP addresses string (newline-separated "network=ip") into entries. */
function parseIpAddresses(ipStr: string | undefined): Array<{ network: string; ip: string }> {
  if (!ipStr || ipStr === '--') return []
  return ipStr
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf('=')
      if (idx === -1) return { network: 'default', ip: line }
      return { network: line.slice(0, idx), ip: line.slice(idx + 1) }
    })
    .filter((e) => e.ip)
}

/** Split an image string into name and tag. */
function splitImageTag(image: string): { name: string; tag: string } {
  if (!image) return { name: '--', tag: '' }
  const lastColon = image.lastIndexOf(':')
  // Check that the colon is not part of a registry hostname (e.g. registry.io:5000/image)
  if (lastColon > 0 && !image.slice(lastColon + 1).includes('/')) {
    return { name: image.slice(0, lastColon), tag: image.slice(lastColon + 1) }
  }
  return { name: image, tag: 'latest' }
}

/** Check if an env key name is sensitive (password, secret, token, key). */
function isSensitiveKey(key: string): boolean {
  const upper = key.toUpperCase()
  return ['PASSWORD', 'SECRET', 'TOKEN', 'KEY'].some((s) => upper.includes(s))
}

/** Mask a sensitive value with dots. */
function maskValue(value: string): string {
  if (value.length <= 2) return '\u2022'.repeat(8)
  return value[0] + '\u2022'.repeat(Math.min(value.length - 2, 16)) + value[value.length - 1]
}

/**
 * Parse a ports string like "0.0.0.0:8096->8096/tcp, 443->443/tcp"
 * into structured entries.
 */
interface PortMapping {
  bindAddress?: string
  hostPort: string
  containerPort: string
  protocol: string
  raw: string
}

function parsePortMappings(portsStr: string): PortMapping[] {
  if (!portsStr || portsStr === '--') return []
  return portsStr
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((raw) => {
      // Formats: "0.0.0.0:8096->8096/tcp", "8096->8096/tcp", "8096/tcp"
      let bindAddress: string | undefined
      let hostPort = ''
      let containerPort = ''
      let protocol = 'tcp'

      const arrowIdx = raw.indexOf('->')
      if (arrowIdx === -1) {
        // No mapping, just exposed port like "8096/tcp"
        const slashIdx = raw.indexOf('/')
        if (slashIdx !== -1) {
          containerPort = raw.slice(0, slashIdx)
          protocol = raw.slice(slashIdx + 1)
        } else {
          containerPort = raw
        }
        // Exposed-only — no host port bound
        hostPort = ''
      } else {
        const leftSide = raw.slice(0, arrowIdx)
        const rightSide = raw.slice(arrowIdx + 2)

        // Parse right side: "8096/tcp"
        const slashIdx = rightSide.indexOf('/')
        if (slashIdx !== -1) {
          containerPort = rightSide.slice(0, slashIdx)
          protocol = rightSide.slice(slashIdx + 1)
        } else {
          containerPort = rightSide
        }

        // Parse left side: "0.0.0.0:8096" or "8096"
        const lastColon = leftSide.lastIndexOf(':')
        if (lastColon !== -1) {
          const potentialAddr = leftSide.slice(0, lastColon)
          const potentialPort = leftSide.slice(lastColon + 1)
          // Check if the part after last colon is a port number
          if (/^\d+$/.test(potentialPort)) {
            bindAddress = potentialAddr || undefined
            hostPort = potentialPort
          } else {
            hostPort = leftSide
          }
        } else {
          hostPort = leftSide
        }
      }

      return { bindAddress, hostPort, containerPort, protocol, raw }
    })
    // Deduplicate: IPv6 [::] entries duplicate IPv4 0.0.0.0 entries — keep only one per hostPort
    .filter((port, idx, arr) => {
      if (port.bindAddress === '[::]' || port.bindAddress === '::') {
        return !arr.some((other, otherIdx) => otherIdx !== idx && other.hostPort === port.hostPort && other.bindAddress !== '[::]' && other.bindAddress !== '::')
      }
      return true
    })
}

/**
 * Parse a mount entry like "source:destination:mode" into parts.
 */
interface MountEntry {
  source: string
  destination: string
  mode?: string
  raw: string
}

function parseMountEntries(mountStr: string): MountEntry[] {
  if (!mountStr || mountStr === '--') return []
  return mountStr
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean)
    .map((raw) => {
      // Docker mounts: /host/path:/container/path or /host/path:/container/path:ro
      // Named volumes: volume_name:/container/path:rw
      const parts = raw.split(':')
      if (parts.length >= 3) {
        // Could be /host:/container:mode or on Windows C:\path... but we handle unix
        const lastPart = parts[parts.length - 1]
        if (lastPart === 'ro' || lastPart === 'rw' || lastPart === 'z' || lastPart === 'Z') {
          return {
            source: parts.slice(0, -2).join(':') || parts[0],
            destination: parts[parts.length - 2],
            mode: lastPart,
            raw,
          }
        }
        // No mode, just source:destination with colons in path
        return {
          source: parts[0],
          destination: parts.slice(1).join(':'),
          raw,
        }
      }
      if (parts.length === 2) {
        return { source: parts[0], destination: parts[1], raw }
      }
      return { source: raw, destination: raw, raw }
    })
}

/**
 * Parse cpu_percent string like "2.34%" to a number (2.34).
 */
function parseCpuPercent(cpuStr: string | number): number {
  if (cpuStr == null || cpuStr === '--') return 0
  if (typeof cpuStr === 'number') return cpuStr
  const match = String(cpuStr).match(/([\d.]+)/)
  return match ? parseFloat(match[1]) : 0
}

/**
 * Parse memory_usage string like "150MiB / 8GiB" to MB number (150).
 * Handles: "150MiB / 8GiB", "1.5GiB / 8GiB", "512KiB / 8GiB"
 */
function parseMemoryToMB(memStr: string): number {
  if (!memStr || memStr === '--') return 0
  // Take the used portion (before the slash)
  const usedPart = memStr.split('/')[0].trim()
  const match = usedPart.match(/([\d.]+)\s*(KiB|MiB|GiB|TiB|KB|MB|GB|TB|B)?/i)
  if (!match) return 0
  const value = parseFloat(match[1])
  const unit = (match[2] || 'B').toLowerCase()
  switch (unit) {
    case 'tib':
    case 'tb':
      return value * 1024 * 1024
    case 'gib':
    case 'gb':
      return value * 1024
    case 'mib':
    case 'mb':
      return value
    case 'kib':
    case 'kb':
      return value / 1024
    default:
      return value / (1024 * 1024)
  }
}

// Network color palette for badge variety
const NETWORK_COLORS = [
  { bg: 'bg-purple-500/10', text: 'text-purple-300', ring: 'ring-purple-500/20' },
  { bg: 'bg-cyan-500/10', text: 'text-cyan-300', ring: 'ring-cyan-500/20' },
  { bg: 'bg-teal-500/10', text: 'text-teal-300', ring: 'ring-teal-500/20' },
  { bg: 'bg-sky-500/10', text: 'text-sky-300', ring: 'ring-sky-500/20' },
  { bg: 'bg-pink-500/10', text: 'text-pink-300', ring: 'ring-pink-500/20' },
  { bg: 'bg-blue-500/10', text: 'text-blue-300', ring: 'ring-blue-500/20' },
  { bg: 'bg-fuchsia-500/10', text: 'text-fuchsia-300', ring: 'ring-fuchsia-500/20' },
  { bg: 'bg-indigo-500/10', text: 'text-indigo-300', ring: 'ring-indigo-500/20' },
]

// ---------------------------------------------------------------------------
// Badge subcomponents
// ---------------------------------------------------------------------------

type BadgeVariant = { bg: string; text: string; ring: string; dot: string }

const STATE_VARIANTS: Record<string, BadgeVariant> = {
  running: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  exited: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    ring: 'ring-rose-500/20',
    dot: 'bg-rose-400',
  },
  paused: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    ring: 'ring-amber-500/20',
    dot: 'bg-amber-400',
  },
  restarting: {
    bg: 'bg-cyan-500/10',
    text: 'text-cyan-400',
    ring: 'ring-cyan-500/20',
    dot: 'bg-cyan-400',
  },
}

const DEFAULT_VARIANT: BadgeVariant = {
  bg: 'bg-slate-500/10',
  text: 'text-slate-400',
  ring: 'ring-slate-500/20',
  dot: 'bg-slate-400',
}

const HEALTH_VARIANTS: Record<string, BadgeVariant> = {
  healthy: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  unhealthy: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    ring: 'ring-rose-500/20',
    dot: 'bg-rose-400',
  },
  starting: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    ring: 'ring-amber-500/20',
    dot: 'bg-amber-400',
  },
}

function StatusBadge({ label, variants }: { label: string; variants: Record<string, BadgeVariant> }) {
  const key = label.toLowerCase()
  const v = variants[key] ?? DEFAULT_VARIANT
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold ring-1 ${v.bg} ${v.text} ${v.ring}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${v.dot}`} />
      {label || 'none'}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ContainerDetailProps {
  containerName: string
  /** The basic container info from the list (available immediately). */
  containerInfo: ContainerInfo
  /** The server the container runs on: a fleet member id rides the hub's proxy; null or undefined = this server */
  member?: RowMember
  memberName?: string
  /** A hub with VMs: say where the container lives next to its name */
  showCapsule?: boolean
  onBack: () => void
  /** Trigger immediate refresh of the containers list after actions. */
  onRefreshList?: () => void
  /** Whether the current user has admin privileges. */
  isAdmin?: boolean
}

/** the stats sample each container's history got last (statsKey → when it arrived) */
const historySampleAt = new Map<string, number>()

const ContainerDetail: React.FC<ContainerDetailProps> = ({
  containerName,
  containerInfo,
  member = null,
  memberName = '',
  showCapsule = false,
  onBack,
  onRefreshList,
  isAdmin = false,
}) => {
  const setStats = useContainerStore((s) => s.setStats)
  const pushStatsHistory = useContainerStore((s) => s.pushStatsHistory)
  const storedStats = useContainerStore((s) => s.stats[containerName])
  const statsHistorySelector = useMemo(() => selectStatsHistory(containerName), [containerName])
  const statsHistory = useContainerStore(statsHistorySelector)
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [detail, setDetail] = useState<ContainerDetailType | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [stats, setLocalStats] = useState<ContainerStats | null>(storedStats ?? null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [containerLogs, setContainerLogs] = useState<string>('')
  const [showLogs, setShowLogs] = useState(false)
  const [logsLoading, setLogsLoading] = useState(false)
  const [liveLogsMode, setLiveLogsMode] = useState(false)

  // Process viewer state
  const [showProcesses, setShowProcesses] = useState(false)
  const [processes, setProcesses] = useState<ContainerProcess[]>([])
  const [processesLoading, setProcessesLoading] = useState(false)

  // Command runner state
  const [showExec, setShowExec] = useState(false)
  const [execCommand, setExecCommand] = useState('')
  const [execLoading, setExecLoading] = useState(false)
  const [execOutput, setExecOutput] = useState<{ command: string; output: string; exitCode: number; success: boolean } | null>(null)
  const [execHistory, setExecHistory] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem('container-exec-history')
      return raw ? JSON.parse(raw) : []
    } catch { return [] }
  })

  // Rename state
  const [renaming, setRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState(containerName)
  const [renameLoading, setRenameLoading] = useState(false)

  // Enhanced section states
  const [envSearch, setEnvSearch] = useState('')
  const [envCollapsed, setEnvCollapsed] = useState(false)
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set())
  // Environment editing: draft values, removals and new rows, saved together
  const [envDrafts, setEnvDrafts] = useState<Record<string, string>>({})
  const [envRemovals, setEnvRemovals] = useState<Set<string>>(new Set())
  const [envAdditions, setEnvAdditions] = useState<{ key: string; value: string }[]>([])
  const [envEditingKey, setEnvEditingKey] = useState<string | null>(null)
  const [envSaving, setEnvSaving] = useState(false)
  const [envRecreate, setEnvRecreate] = useState(true)
  const [nukeOpen, setNukeOpen] = useState(false)
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)

  const mountedRef = useRef(true)
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // leaving the rename field without renaming puts the keyboard back on the pencil that opened it
  const cancelRename = useCallback(() => {
    setRenaming(false)
    setRenameValue(containerName)
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-rename-open]')?.focus())
  }, [containerName])

  // leaving the detail for the list puts the keyboard back on this container's row (the list's desktop table or its phone cards, whichever is on screen)
  useEffect(() => () => {
    requestAnimationFrame(() => {
      const rows = document.querySelectorAll<HTMLElement>(`[data-container-open="${CSS.escape(containerName)}"]`)
      Array.from(rows).find((el) => el.offsetParent !== null)?.focus()
    })
  }, [containerName])

  // Fetch full container detail (environment, mounts, networks)
  const fetchDetail = useCallback(async () => {
    setDetailLoading(true)
    setDetailError(null)
    try {
      const d = await fetchContainerOn(containerName, member)
      if (mountedRef.current) {
        setDetail(d)
        setDetailError(null)
      }
    } catch (err) {
      if (mountedRef.current) {
        const msg = err instanceof Error ? err.message : String(err)
        setDetailError(msg || 'Failed to fetch container details')
      }
    } finally {
      if (mountedRef.current) {
        setDetailLoading(false)
      }
    }
  }, [containerName, member])

  useEffect(() => {
    fetchDetail()
  }, [fetchDetail])

  const retryDetail = useCallback(() => {
    fetchDetail()
  }, [fetchDetail])

  // Stats now and every 10 s (another container asks at once)
  const statsKey = `container-stats:${member ?? 'hub'}:${containerName}`
  const statsPoll = usePolling(() => fetchContainerStatsOn(containerName, member), 10000, { key: statsKey })
  const statsLoading = statsPoll.loading
  const refreshStats = statsPoll.refresh
  useEffect(() => {
    const s = statsPoll.data
    if (!s || statsPoll.dataKey !== statsKey) return
    setLocalStats(s)
    setStats(containerName, s)
    // each sample goes into the chart's history once (a detail opened again within the interval shows the last one)
    if (historySampleAt.get(statsKey) === statsPoll.updatedAt) return
    historySampleAt.set(statsKey, statsPoll.updatedAt)
    pushStatsHistory(containerName, parseCpuPercent(s.cpu_percent), parseMemoryToMB(s.memory_usage))
  }, [statsPoll.data, statsPoll.dataKey, statsPoll.updatedAt, statsKey, containerName, setStats, pushStatsHistory])
  // a second sample soon after the first: the history chart has its two points in seconds, not after the first 10 s tick
  useEffect(() => {
    const quick = setTimeout(() => { void refreshStats() }, 2000)
    return () => clearTimeout(quick)
  }, [statsKey, refreshStats])

  // Container action handler
  // Sablier: on-demand start through the Traefik middleware, written by the API — the dialog
  // carries the same choices as the deploy sheet and, once on, changes them or switches it off
  const [onDemandOpen, setOnDemandOpen] = useState(false)

  const handleAction = useCallback(async (action: 'start' | 'stop' | 'restart' | 'recreate' | 'remove') => {
    const pastTense: Record<typeof action, string> = { start: 'started', stop: 'stopped', restart: 'restarted', recreate: 'recreated', remove: 'removed' }
    const gerund: Record<typeof action, string> = { start: 'Starting', stop: 'Stopping', restart: 'Restarting', recreate: 'Recreating', remove: 'Removing' }

    if (action === 'remove') {
      if (!(await confirm({ title: 'Remove this container?', message: `Remove container "${containerName}"? This will force-remove it and cannot be undone.`, confirmLabel: 'Remove', danger: true }))) return
    }

    setActionLoading(action)
    addToast({ type: 'info', message: `${gerund[action]} "${containerName}"${member ? ` on VM ${memberName || member}` : ''}...`, duration: 2000 })

    try {
      const result = await containerActionOn(containerName, action, member)

      if (result.success) {
        addToast({ type: 'success', message: `"${containerName}" ${pastTense[action]} successfully!` })
        if (action === 'remove') {
          onRefreshList?.()
          onBack()
          return
        }
      } else {
        addToast({ type: 'error', message: `Failed to ${action} "${containerName}": ${result.output || 'Unknown error'}`, duration: 6000 })
      }

      // Refresh stats and container list after action
      onRefreshList?.()
      setTimeout(() => {
        refreshStats()
        onRefreshList?.()
      }, 500)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addToast({ type: 'error', message: `Failed to ${action} "${containerName}": ${msg}`, duration: 6000 })
    } finally {
      setActionLoading(null)
    }
  }, [containerName, member, memberName, refreshStats, addToast, onRefreshList, onBack, confirm])

  // ---- Environment editing (Compose-managed containers only) ----
  const composeService = detail?.compose_service || ''
  const composeProject = detail?.compose_project || ''
  const canEditEnv = isAdmin && !!composeService && !!detail?.compose_dir
  const currentEnv = useMemo(() => (detail ? parseEnvString(detail.environment) : []), [detail])
  const envDirty = useMemo(() => {
    if (envRemovals.size > 0) return true
    if (envAdditions.some((a) => a.key.trim())) return true
    return Object.entries(envDrafts).some(([k, v]) => v !== (currentEnv.find((e) => e.key === k)?.value ?? ''))
  }, [envDrafts, envRemovals, envAdditions, currentEnv])
  const discardEnv = useCallback(() => {
    setEnvDrafts({})
    setEnvRemovals(new Set())
    setEnvAdditions([])
    setEnvEditingKey(null)
  }, [])
  const handleSaveEnv = useCallback(async () => {
    if (!detail || envSaving) return
    const set: Record<string, string> = {}
    for (const [k, v] of Object.entries(envDrafts)) {
      if (envRemovals.has(k)) continue
      if (v !== (currentEnv.find((e) => e.key === k)?.value ?? '')) set[k] = v
    }
    for (const a of envAdditions) {
      const k = a.key.trim()
      if (!k) continue
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) {
        addToast({ type: 'error', message: `${k} is not a valid variable name (letters, digits and underscores)` })
        return
      }
      set[k] = a.value
    }
    const unset = Array.from(envRemovals)
    if (Object.keys(set).length === 0 && unset.length === 0) return
    setEnvSaving(true)
    try {
      const res = await updateContainerEnvOn(containerName, { set, unset, recreate: envRecreate }, member)
      const parts: string[] = []
      if (res.compose_changed.length) parts.push(`${res.compose_changed.join(', ')} in docker-compose.yml`)
      if (res.env_changed.length) parts.push(`${res.env_changed.map((e) => e.split('=')[1] || e).join(', ')} in the stack .env`)
      if (res.removed.length) parts.push(`${res.removed.join(', ')} removed`)
      const tail = res.recreated
        ? ' — container recreated'
        : envRecreate
          ? ` — recreate did not finish: ${(res.output || '').trim().split('\n').slice(-1)[0] || 'see the stack activity'}`
          : ' — takes effect when the container is recreated'
      addToast({ type: res.success ? 'success' : 'warning', message: `${res.stack} / ${res.service}: ${parts.join('; ')}${tail}`, duration: 9000 })
      discardEnv()
      onRefreshList?.()
      setTimeout(() => { fetchDetail(); refreshStats() }, res.recreated ? 1500 : 300)
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not save the environment', duration: 9000 })
    } finally {
      setEnvSaving(false)
    }
  }, [detail, envSaving, envDrafts, envRemovals, envAdditions, currentEnv, containerName, member, envRecreate, addToast, discardEnv, onRefreshList, fetchDetail, refreshStats])
  const openComposeEditor = useCallback(() => {
    if (!composeProject) return
    setCurrentPage('stacks', { highlight: composeProject, editCompose: true, focusService: composeService })
  }, [composeProject, composeService, setCurrentPage])

  // Fetch container logs
  const handleFetchLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const result = await fetchContainerLogsOn(containerName, member)
      setContainerLogs(result.logs)
      setShowLogs(true)
    } catch {
      setContainerLogs('Failed to fetch logs')
    } finally {
      setLogsLoading(false)
    }
  }, [containerName, member])

  // Download logs as text file
  const handleDownloadLogs = useCallback(() => {
    if (!containerLogs) return
    const now = new Date()
    const yyyy = now.getFullYear()
    const mm = String(now.getMonth() + 1).padStart(2, '0')
    const dd = String(now.getDate()).padStart(2, '0')
    const filename = `${containerName}-logs-${yyyy}-${mm}-${dd}.txt`
    const blob = new Blob([containerLogs], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [containerLogs, containerName])

  // Handle container rename
  const handleRename = useCallback(async () => {
    const newName = renameValue.trim()
    if (!newName || newName === containerName) {
      setRenaming(false)
      setRenameValue(containerName)
      return
    }
    setRenameLoading(true)
    try {
      const result = await renameContainerOn(containerName, newName, member)
      if (result.success) {
        addToast({ type: 'success', message: `Renamed to "${newName}"` })
        onRefreshList?.()
        onBack()
      } else {
        addToast({ type: 'error', message: result.message || 'Rename failed', duration: 5000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Rename failed', duration: 5000 })
    } finally {
      setRenameLoading(false)
      setRenaming(false)
    }
  }, [containerName, member, renameValue, addToast, onRefreshList, onBack])

  // Fetch container processes
  const handleFetchProcesses = useCallback(async () => {
    setProcessesLoading(true)
    try {
      const result = await fetchContainerProcessesOn(containerName, member)
      if (mountedRef.current) {
        setProcesses(result.processes)
      }
    } catch {
      if (mountedRef.current) {
        setProcesses([])
      }
    } finally {
      if (mountedRef.current) {
        setProcessesLoading(false)
      }
    }
  }, [containerName, member])

  // Toggle process viewer — read at once, then every 10 s while it shows
  const handleToggleProcesses = useCallback(() => {
    setShowProcesses((prev) => {
      if (!prev) void handleFetchProcesses()
      return !prev
    })
  }, [handleFetchProcesses])
  usePolling(handleFetchProcesses, 10000, { enabled: showProcesses })

  // Command runner
  const handleExecCommand = useCallback(async () => {
    const cmd = execCommand.trim()
    if (!cmd || execLoading) return
    setExecLoading(true)
    setExecOutput(null)
    try {
      const result = await execContainerCommandOn(containerName, cmd, member)
      setExecOutput({
        command: cmd,
        output: result.output,
        exitCode: result.exit_code,
        success: result.success,
      })
      // Add to history (dedup, max 10)
      setExecHistory((prev) => {
        const filtered = prev.filter((h) => h !== cmd)
        const next = [cmd, ...filtered].slice(0, 10)
        try { localStorage.setItem('container-exec-history', JSON.stringify(next)) } catch {}
        return next
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Command execution failed'
      setExecOutput({ command: cmd, output: message, exitCode: -1, success: false })
    } finally {
      setExecLoading(false)
    }
  }, [execCommand, execLoading, containerName, member])

  // Derived data
  const envEntries = detail ? parseEnvString(detail.environment) : []
  const networks = detail ? parseNetworks(detail.networks) : []
  const portMappings = parsePortMappings(containerInfo.ports)
  const mountEntries = detail ? parseMountEntries(detail.mounts) : []

  // Filtered env entries based on search
  const filteredEnvEntries = envSearch
    ? envEntries.filter(
        (e) =>
          e.key.toLowerCase().includes(envSearch.toLowerCase()) ||
          e.value.toLowerCase().includes(envSearch.toLowerCase())
      )
    : envEntries

  // Toggle secret reveal
  const toggleSecret = (key: string) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Prepare chart data from stats history
  const chartData = statsHistory.map((entry, idx) => ({
    idx,
    time: new Date(entry.time).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    cpu: Math.round(entry.cpu * 100) / 100,
    mem: Math.round(entry.mem * 100) / 100,
  }))

  const isRunning = containerInfo.state === 'running'

  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      {/* ---- Back button + title ---- */}
      <div className="flex flex-col gap-3">
        {/* Top row: back + name + badges (badges drop to their own line on phones) */}
        <div className="flex flex-wrap items-center gap-3 min-w-0">
          <Hint label={`Back to ${pageLabel('containers')} (Esc)`}>
            <button onClick={onBack} aria-label="Back" className={`${BTN_TOOLBAR_QUIET} flex-shrink-0`}>
              <ArrowLeft size={14} />
              <span className="hidden sm:inline">Back</span>
              <Kbd className="hidden sm:inline-flex ml-1">Esc</Kbd>
            </button>
          </Hint>

          <Box className="h-5 w-5 text-emerald-400 flex-shrink-0" />
          {renaming ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <input aria-label="New name"
                autoFocus
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') { e.stopPropagation(); cancelRename() }
                }}
                className="px-2 py-1 text-base md:text-lg font-bold text-slate-100 bg-white/10 border border-emerald-500/40 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500/50 min-w-0 flex-1"
              />
              <Hint label="Save the new name">
                <button aria-label="Save" onClick={handleRename} disabled={renameLoading} className={`${BTN_ICON_SM} ${TONE_GHOST_OK} flex-shrink-0`}>
                  {renameLoading ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                </button>
              </Hint>
              <Hint label="Cancel">
                <button aria-label="Cancel" onClick={cancelRename} className={`${BTN_ICON_SM} ${TONE_GHOST} flex-shrink-0`}>
                  <X size={16} />
                </button>
              </Hint>
            </div>
          ) : (
            <>
              <h1 className="text-lg md:text-xl font-bold text-slate-100 truncate min-w-0 flex-1">{containerName}</h1>
              {/* renaming is an admin call on the API */}
              {isAdmin && (
                <Hint label="Rename the container">
                  <button
                    onClick={() => setRenaming(true)}
                    data-rename-open
                    aria-label="Rename the container"
                    className={`${BTN_ICON_SM} ${TONE_GHOST} flex-shrink-0`}
                  >
                    <Pencil size={14} />
                  </button>
                </Hint>
              )}
            </>
          )}
          <div className="flex flex-wrap items-center gap-2 flex-shrink-0 ml-auto w-full sm:w-auto">
            {showCapsule && <VmCapsule member={member} name={memberName || containerInfo.member_name} vmid={containerInfo.vmid} />}
            {/* asleep on demand: its own calm state, and its last health check is history */}
            {isAsleep(containerInfo)
              ? <StateChip state={containerState(containerInfo)} />
              : <>
                  <StatusBadge label={containerInfo.state} variants={STATE_VARIANTS} />
                  <StatusBadge label={containerInfo.health} variants={HEALTH_VARIANTS} />
                </>}
          </div>
        </div>

        {/* Action buttons row — wraps on mobile: emerald starts, rose removes, the rest is neutral */}
        <div className="flex flex-wrap items-center gap-2">
          {/* in a VM it works the same: the VM runs its own Sablier, which only the hub's proxy can reach */}
          {isAdmin && (
            <Hint label={containerInfo.on_demand ? 'Sablier stops this container when idle and starts it on the first request — change the idle time and the waiting page, or serve it normally again' : member ? 'Let the hub\'s proxy start this container on the first request and stop it when idle (the VM runs its own Sablier for it, reachable by the hub only)' : 'Let Traefik start this container on the first request and stop it when idle (needs the Sablier template and an HTTPS route)'}>
              <button
                onClick={() => setOnDemandOpen(true)}
                disabled={!!actionLoading}
                className={`${BTN_TOOLBAR} ${containerInfo.on_demand ? TONE_OK : TONE_QUIET}`}
              >
                <Moon size={14} />
                {containerInfo.on_demand ? 'On demand: on' : 'Start on demand'}
              </button>
            </Hint>
          )}
          {isAdmin && <ThemeButton containerName={containerName} member={member} disabled={!!actionLoading} />}
          {onDemandOpen && (
            <OnDemandDialog
              containerName={containerName}
              member={member}
              onDemand={!!containerInfo.on_demand}
              onClose={() => setOnDemandOpen(false)}
              onChanged={(res) => {
                addToast({ type: 'success', message: res.message || (res.enabled ? 'On-demand start enabled' : 'On-demand start disabled') })
                if (res.traefik_restarted) addToast({ type: 'info', message: 'Traefik restarted to load the Sablier plugin' })
                onRefreshList?.()
                void fetchDetail()
              }}
              onError={(message) => addToast({ type: 'error', message })}
            />
          )}
          {containerInfo.state !== 'running' && (
            <button
              onClick={() => handleAction('start')}
              disabled={!!actionLoading}
              className={`${BTN_TOOLBAR} ${TONE_OK}`}
              title={isAsleep(containerInfo) ? 'Wake it now: Sablier puts it back to sleep once it is idle again' : undefined}
            >
              {actionLoading === 'start' ? <RefreshCw size={14} className="animate-spin" /> : <Play size={14} />}
              {isAsleep(containerInfo) ? 'Wake now' : 'Start'}
            </button>
          )}
          {containerInfo.state === 'running' && (
            <>
              <button
                onClick={() => handleAction('restart')}
                disabled={!!actionLoading}
                className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
              >
                {actionLoading === 'restart' ? <RefreshCw size={14} className="animate-spin" /> : <RotateCw size={14} />}
                Restart
              </button>
              <Hint label="Remove the container and create it again from its image">
                <button
                  onClick={() => handleAction('recreate')}
                  disabled={!!actionLoading}
                  className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
                >
                  {actionLoading === 'recreate' ? <RefreshCw size={14} className="animate-spin" /> : <Download size={14} />}
                  Recreate
                </button>
              </Hint>
              <button
                onClick={() => handleAction('stop')}
                disabled={!!actionLoading}
                className={`${BTN_TOOLBAR} ${TONE_DANGER}`}
              >
                {actionLoading === 'stop' ? <RefreshCw size={14} className="animate-spin" /> : <Square size={14} />}
                Stop
              </button>
            </>
          )}
          <button
            onClick={handleFetchLogs}
            disabled={logsLoading}
            className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
          >
            {logsLoading ? <RefreshCw size={14} className="animate-spin" /> : <ScrollText size={14} />}
            Logs
          </button>
          {isAdmin && composeProject && (
            <Hint label={`Open ${composeProject}/docker-compose.yml in the stack editor at the ${composeService} service`}>
              <button
                onClick={openComposeEditor}
                className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
              >
                <FileCode size={14} />
                Edit compose
              </button>
            </Hint>
          )}
          {isAdmin && (
            <button
              onClick={() => handleAction('remove')}
              disabled={!!actionLoading}
              className={`${BTN_TOOLBAR} ${TONE_DANGER}`}
            >
              {actionLoading === 'remove' ? <RefreshCw size={14} className="animate-spin" /> : <Trash2 size={14} />}
              Remove
            </button>
          )}
          {isAdmin && composeProject && (
            <>
              <Hint label="Fresh install: remove the container and the App-Data folders it owns (kept in the trash a week), then create it again from the compose file">
                <button
                  onClick={() => setNukeOpen(true)}
                  disabled={!!actionLoading}
                  className={`${BTN_TOOLBAR} ${TONE_DANGER}`}
                >
                  <Bomb size={14} />
                  Nuke &amp; reinstall
                </button>
              </Hint>
              <NukeDialog
                containerName={containerName}
                member={member}
                memberName={memberName}
                open={nukeOpen}
                onClose={() => setNukeOpen(false)}
                onDone={() => { onRefreshList?.(); void fetchDetail(); setTimeout(() => refreshStats(), 1500) }}
              />
            </>
          )}
          {isRunning && (
            <button
              onClick={handleToggleProcesses}
              aria-pressed={showProcesses}
              className={`${BTN_TOOLBAR} ${showProcesses ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <Terminal size={14} />
              Processes
            </button>
          )}
          {/* Homarr: under the health badge, at the right end of the row */}
          <div className="ml-auto">
            <HomarrChip containerName={containerName} member={member} isAdmin={isAdmin} />
          </div>
        </div>
      </div>

      {/* ---- Detail loading skeleton ---- */}
      {detailLoading && detail === null && (
        <div role="status" aria-label="Reading the container details" className="space-y-3 animate-pulse">
          <div className="h-4 w-3/4 bg-white/[0.06] rounded" />
          <div className="h-4 w-1/2 bg-white/[0.06] rounded" />
          <div className="h-4 w-2/3 bg-white/[0.06] rounded" />
        </div>
      )}

      {/* ---- Detail error banner ---- */}
      {detailError && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3">
          <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-rose-300">Could not load the container details</p>
            <p className="text-xs text-rose-400/70 mt-0.5 break-words">{detailError}</p>
          </div>
          <button onClick={retryDetail} className={`${BTN_CARD} ${TONE_DANGER}`}>
            <RefreshCw size={12} />
            Try again
          </button>
        </div>
      )}

      {/* ---- Stats section ---- */}
      <section>
        <SectionHeader icon={<Activity className="h-4 w-4 text-cyan-400" />} title="Resource stats" />
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mt-3">
          <StatCard
            icon={<Cpu className="h-4 w-4 text-cyan-400" />}
            label="CPU"
            value={stats?.cpu_percent ?? '--'}
            loading={statsLoading}
          />
          <StatCard
            icon={<MemoryStick className="h-4 w-4 text-emerald-400" />}
            label="Memory"
            value={stats?.memory_usage ?? '--'}
            subValue={stats?.memory_percent ? `${stats.memory_percent}` : undefined}
            loading={statsLoading}
          />
          <StatCard
            icon={<Network className="h-4 w-4 text-purple-400" />}
            label="Network I/O"
            value={stats?.network_io ?? '--'}
            loading={statsLoading}
          />
          <StatCard
            icon={<HardDrive className="h-4 w-4 text-slate-400" />}
            label="Block I/O"
            value={stats?.block_io ?? '--'}
            loading={statsLoading}
          />
          <StatCard
            icon={<Users className="h-4 w-4 text-slate-400" />}
            label="PIDs"
            value={stats?.pids ?? '--'}
            loading={statsLoading}
          />
          <StatCard
            icon={<Clock className="h-4 w-4 text-slate-400" />}
            label="Uptime"
            value={formatUptime(containerInfo.uptime_seconds)}
            loading={false}
          />
        </div>
      </section>

      {/* ---- 4A: Metrics History Graphs ---- the card is there from the start; the charts fill in as samples arrive */}
      {(
        <section>
          <SectionHeader icon={<Activity className="h-4 w-4 text-cyan-400" />} title="Metrics history" />
          <div className="surface p-4 md:p-5 mt-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* CPU % over time */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <Cpu className="h-3.5 w-3.5 text-cyan-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">CPU usage (%)</span>
                </div>
                <div className="h-48">
                  {chartData.length < 2 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.06] text-[11px] text-slate-500">
                      {isRunning ? <><Loader2 size={14} className="animate-spin text-slate-500" />Collecting samples…</> : 'Samples are taken while the container runs'}
                    </div>
                  ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="cpuGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        domain={[0, 'auto']}
                        tickFormatter={(v: number) => `${v}%`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#94a3b8' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        formatter={(value: number) => [`${value}%`, 'CPU']}
                      />
                      <Area
                        type="monotone"
                        dataKey="cpu"
                        stroke="#06b6d4"
                        strokeWidth={2}
                        fill="url(#cpuGradient)"
                        dot={false}
                        activeDot={{ r: 3, fill: '#06b6d4', stroke: '#1e293b', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  )}
                </div>
              </div>

              {/* Memory MB over time */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <MemoryStick className="h-3.5 w-3.5 text-emerald-400" />
                  <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Memory usage (MB)</span>
                </div>
                <div className="h-48">
                  {chartData.length < 2 ? (
                    <div className="h-full flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-white/[0.06] text-[11px] text-slate-500">
                      {isRunning ? <><Loader2 size={14} className="animate-spin text-slate-500" />Collecting samples…</> : 'Samples are taken while the container runs'}
                    </div>
                  ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
                      <defs>
                        <linearGradient id="memGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.15)" />
                      <XAxis
                        dataKey="time"
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        interval="preserveStartEnd"
                      />
                      <YAxis
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
                        tickLine={false}
                        domain={[0, 'auto']}
                        tickFormatter={(v: number) => `${v}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(15, 23, 42, 0.95)',
                          border: '1px solid rgba(255,255,255,0.1)',
                          borderRadius: '8px',
                          fontSize: '12px',
                          color: '#e2e8f0',
                        }}
                        labelStyle={{ color: '#94a3b8' }}
                        itemStyle={{ color: '#e2e8f0' }}
                        formatter={(value: number) => [`${value} MB`, 'Memory']}
                      />
                      <Area
                        type="monotone"
                        dataKey="mem"
                        stroke="#10b981"
                        strokeWidth={2}
                        fill="url(#memGradient)"
                        dot={false}
                        activeDot={{ r: 3, fill: '#10b981', stroke: '#1e293b', strokeWidth: 2 }}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ---- Container Logs (right below Metrics History) ---- */}
      {showLogs && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <SectionHeader icon={<ScrollText className="h-4 w-4 text-cyan-400" />} title="Container logs" />
            <div className="flex flex-wrap items-center gap-2">
              {/* Live / Snapshot: one choice (the live stream is an admin call on the API) */}
              {isAdmin && (
                <SegmentedControl
                  aria-label="Log mode"
                  value={liveLogsMode ? 'live' : 'snapshot'}
                  onChange={(v) => setLiveLogsMode(v === 'live')}
                  data={[{ value: 'snapshot', label: 'Snapshot' }, { value: 'live', label: 'Live' }]}
                />
              )}
              {!liveLogsMode && (
                <>
                  <button
                    onClick={handleDownloadLogs}
                    disabled={!containerLogs}
                    className={BTN_CARD_QUIET}
                  >
                    <Download size={12} />
                    Download
                  </button>
                  <button
                    onClick={handleFetchLogs}
                    disabled={logsLoading}
                    className={BTN_CARD_QUIET}
                  >
                    <RefreshCw size={12} className={logsLoading ? 'animate-spin' : ''} />
                    Refresh
                  </button>
                </>
              )}
              <button onClick={() => setShowLogs(false)} className={BTN_CARD_QUIET}>
                <X size={12} />
                Close
              </button>
            </div>
          </div>
          {liveLogsMode ? (
            <div className="mt-3 h-80">
              <LiveLogViewer containerName={containerName} member={member} initialLines={100} pollInterval={member ? 3000 : 2000} />
            </div>
          ) : (
            <pre
              tabIndex={0}
              aria-label="Container logs"
              className="
                surface mt-3 p-4 max-h-80 overflow-auto
                text-xs leading-relaxed font-mono text-slate-300
                whitespace-pre-wrap break-words scrollbar-thin
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40
              "
            >
              {containerLogs || 'No logs available.'}
            </pre>
          )}
        </section>
      )}

      {/* ---- Info section ---- */}
      <section>
        <SectionHeader icon={<Info className="h-4 w-4 text-cyan-400" />} title="Container info" />
        <div className="surface mt-3 overflow-hidden">
          {/* Image header */}
          <div className="px-5 py-4 border-b border-white/[0.03]">
            {(() => {
              const img = splitImageTag(containerInfo.image)
              return (
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center flex-shrink-0">
                    <Layers className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="text-sm font-semibold text-slate-200 font-mono truncate">{img.name}</span>
                      <CopyButton text={containerInfo.image} label="Copy the image" />
                    </span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/15">{img.tag}</span>
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[10px] text-slate-500 font-mono truncate" title={containerInfo.image_id}>{containerInfo.image_id ? containerInfo.image_id.slice(0, 16) : '--'}</span>
                        {containerInfo.image_id && <CopyButton text={containerInfo.image_id} label="Copy the image ID" />}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-px bg-white/[0.03]">
            {/* Created */}
            <div className="bg-slate-900/80 px-4 py-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Created</span>
              <span className="text-xs text-slate-300">{formatDate(containerInfo.created)}</span>
            </div>
            {/* Uptime */}
            <div className="bg-slate-900/80 px-4 py-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Uptime</span>
              <span className={`text-xs ${isRunning ? 'text-emerald-400' : 'text-slate-500'}`}>{formatUptime(containerInfo.uptime_seconds)}</span>
            </div>
            {/* Restart Policy */}
            <div className="bg-slate-900/80 px-4 py-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Restart policy</span>
              <span className="text-xs text-slate-300 font-mono">{detail?.restart_policy || '--'}</span>
            </div>
            {/* Restart Count */}
            <div className="bg-slate-900/80 px-4 py-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Restart count</span>
              <span className={`text-xs font-mono ${containerInfo.restart_count > 0 ? 'text-amber-400' : 'text-slate-300'}`}>{containerInfo.restart_count}</span>
            </div>
            {/* Hostname */}
            <div className="bg-slate-900/80 px-4 py-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Hostname</span>
              <span className="text-xs text-slate-300 font-mono">{detail?.hostname || '--'}</span>
            </div>
            {/* Platform */}
            <div className="bg-slate-900/80 px-4 py-3">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Platform</span>
              <span className="text-xs text-slate-300">{detail?.platform || '--'}</span>
            </div>
            {/* Working Dir */}
            {detail?.working_dir && (
              <div className="bg-slate-900/80 px-4 py-3 col-span-2 lg:col-span-3">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-1">Working directory</span>
                <span className="text-xs text-slate-300 font-mono">{detail.working_dir}</span>
              </div>
            )}
          </div>

          {/* IP Addresses */}
          {(() => {
            const ips = parseIpAddresses(detail?.ip_addresses)
            if (ips.length === 0) return null
            return (
              <div className="px-5 py-3 border-t border-white/[0.03]">
                <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold block mb-2">IP addresses</span>
                <div className="flex flex-wrap gap-2">
                  {ips.map((entry) => (
                    <div key={`${entry.network}-${entry.ip}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-white/[0.03] border border-white/5">
                      <Network className="h-3 w-3 text-purple-400 flex-shrink-0" />
                      <span className="text-[10px] text-slate-500">{entry.network}</span>
                      <span className="text-xs font-mono text-cyan-400">{entry.ip}</span>
                      <CopyButton text={entry.ip} label="Copy the address" />
                    </div>
                  ))}
                </div>
              </div>
            )
          })()}
        </div>
      </section>

      {/* ---- 4C: Process Viewer ---- */}
      {showProcesses && isRunning && (
        <section className="animate-fade-in">
          <div className="surface p-4 md:p-5">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div className="flex items-center gap-2">
                <Terminal className="h-4 w-4 text-cyan-400" />
                <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Running processes
                </h2>
                {processes.length > 0 && (
                  <span className="text-xs text-slate-500 ml-1">({processes.length})</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button onClick={handleFetchProcesses} disabled={processesLoading} className={BTN_CARD_QUIET}>
                  <RefreshCw size={12} className={processesLoading ? 'animate-spin' : ''} />
                  Refresh
                </button>
                <button onClick={handleToggleProcesses} className={BTN_CARD_QUIET}>
                  <X size={12} />
                  Close
                </button>
              </div>
            </div>

            {processesLoading && processes.length === 0 ? (
              <div role="status" aria-label="Reading the processes" className="space-y-2">
                {[...Array(3)].map((_, i) => (
                  <div key={i} className="h-8 bg-white/[0.03] rounded animate-pulse" />
                ))}
              </div>
            ) : processes.length === 0 ? (
              <EmptyState compact icon={<Terminal size={28} />} title="No process information available." />
            ) : (
              <div className="overflow-x-auto scrollbar-thin rounded-lg border border-white/[0.03]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5">PID</th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5">User</th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5">CPU%</th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5">Time</th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5">Command</th>
                    </tr>
                  </thead>
                  <tbody>
                    {processes.map((proc, idx) => (
                      <tr
                        key={`${proc.pid}-${idx}`}
                        className={`border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors ${
                          idx % 2 === 0 ? 'bg-white/[0.01]' : 'bg-transparent'
                        }`}
                      >
                        <td className="px-4 py-2 font-mono text-cyan-400">{proc.pid}</td>
                        <td className="px-4 py-2 text-slate-300">{proc.uid}</td>
                        <td className="px-4 py-2 text-slate-300 font-mono">{proc.cpu}</td>
                        <td className="px-4 py-2 text-slate-400 font-mono">{proc.time}</td>
                        <td className="px-4 py-2 text-slate-300 font-mono truncate max-w-xs" title={proc.cmd}>
                          {proc.cmd}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- Command Runner (Phase 7C) — running a command is an admin call on the API ---- */}
      {isAdmin && isRunning && (
        <section className="animate-fade-in">
          <div className="surface overflow-hidden">
            <button
              onClick={() => setShowExec(!showExec)}
              aria-expanded={showExec}
              className="flex items-center gap-2 w-full p-5 hover:bg-white/[0.03] transition-colors"
            >
              <Terminal className="h-4 w-4 text-emerald-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Run command
              </h2>
              <ChevronDown
                className={`h-4 w-4 text-slate-500 ml-auto transition-transform duration-200 ${showExec ? 'rotate-0' : '-rotate-90'}`}
              />
            </button>

            {showExec && (
              <div className="px-5 pb-5 space-y-4">
                {/* Safety warning */}
                <div className="flex items-start gap-2 rounded-lg bg-amber-500/5 border border-amber-500/15 px-3 py-2.5">
                  <Lock className="h-3.5 w-3.5 text-amber-400 mt-0.5 shrink-0" />
                  <p className="text-[11px] text-amber-400/80 leading-relaxed">
                    Commands run as the container's default user. Use caution — some commands may affect container state.
                  </p>
                </div>

                {/* Command input */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-400 text-xs font-mono select-none" aria-hidden="true">$</span>
                    <input
                      type="text"
                      aria-label="Command to run"
                      value={execCommand}
                      onChange={(e) => setExecCommand(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleExecCommand()}
                      placeholder="ls -la /app"
                      className="
                        w-full pl-7 pr-4 py-2.5
                        bg-slate-950 border border-white/10 rounded-lg
                        text-xs text-slate-200 placeholder-slate-600 font-mono
                        focus:outline-none focus:border-emerald-500/30 focus:ring-1 focus:ring-emerald-500/15
                        transition-all duration-200
                      "
                    />
                  </div>
                  <button
                    onClick={handleExecCommand}
                    disabled={!execCommand.trim() || execLoading}
                    className={`${BTN_TOOLBAR} ${TONE_OK} self-stretch`}
                  >
                    {execLoading ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <Play size={14} />
                    )}
                    Execute
                  </button>
                </div>

                {/* Command history chips */}
                {execHistory.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    <span className="text-[10px] text-slate-500 self-center mr-1">History:</span>
                    {execHistory.map((cmd) => (
                      <button
                        key={cmd}
                        onClick={() => setExecCommand(cmd)}
                        className="
                          px-2 py-1 rounded text-[10px] font-mono
                          bg-white/[0.03] border border-white/5 text-slate-400
                          hover:bg-white/5 hover:text-slate-200
                          transition-all duration-150 truncate max-w-[200px]
                        "
                        title={cmd}
                      >
                        {cmd}
                      </button>
                    ))}
                  </div>
                )}

                {/* Output */}
                {execOutput && (
                  <div className="space-y-2 animate-fade-in">
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-slate-500 font-mono">$ {execOutput.command}</span>
                      <span className={`
                        text-[10px] font-mono px-1.5 py-0.5 rounded
                        ${execOutput.exitCode === 0
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                        }
                      `}>
                        exit {execOutput.exitCode}
                      </span>
                    </div>
                    <pre
                      tabIndex={0}
                      aria-label="Command output"
                      className="
                      bg-slate-950 border border-white/5 rounded-lg p-4
                      text-[11px] text-slate-300 font-mono
                      max-h-[300px] overflow-auto scrollbar-thin
                      whitespace-pre-wrap break-all leading-relaxed
                      focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40
                    ">
                      {execOutput.output || '(no output)'}
                    </pre>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ---- Environment Variables (Enhanced) ---- */}
      {(envEntries.length > 0 || canEditEnv) && (
        <section className="animate-fade-in" style={{ animationDelay: '0.1s' }}>
          <div className="surface p-4 md:p-5">
            {/* Header with collapse toggle */}
            <button
              onClick={() => setEnvCollapsed(!envCollapsed)}
              aria-expanded={!envCollapsed}
              className="flex items-center gap-2 w-full py-1.5 -my-1.5 group"
            >
              <Variable className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Environment variables
              </h2>
              <span className="text-xs text-slate-500 ml-1">({envEntries.length})</span>
              {canEditEnv ? (
                <span className="ml-2 text-[10px] text-slate-500 hidden sm:inline">click a value to change it · saved to {composeProject}/docker-compose.yml</span>
              ) : isAdmin && detail && !composeService ? (
                <span className="ml-2 text-[10px] text-slate-500 hidden sm:inline">read-only: not managed by a stack</span>
              ) : null}
              <ChevronDown
                className={`h-4 w-4 text-slate-500 ml-auto transition-transform duration-200 ${
                  envCollapsed ? '-rotate-90' : 'rotate-0'
                }`}
              />
            </button>

            {!envCollapsed && (
              <div className="mt-4 space-y-3">
                {/* Search/filter input */}
                <div className="relative">
                  <SearchInput size="sm" value={envSearch} onChange={setEnvSearch} label="Filter the variables" placeholder="Filter variables…" />
                </div>

                {/* New variables (saved with the other changes) */}
                {canEditEnv && envAdditions.length > 0 && (
                  <div className="space-y-1.5">
                    {envAdditions.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.04] px-3 py-2">
                        <Plus className="h-3 w-3 text-emerald-400 shrink-0" />
                        <input
                          type="text"
                          aria-label={`Name of new variable ${i + 1}`}
                          value={a.key}
                          onChange={(e) => setEnvAdditions((prev) => prev.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/[^A-Za-z0-9_]/g, '').toUpperCase() } : x)))}
                          placeholder="VARIABLE"
                          spellCheck={false}
                          autoFocus={!a.key}
                          className="w-32 md:w-56 px-2 py-1 rounded bg-white/5 border border-white/10 text-xs font-mono text-cyan-300 placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
                        />
                        <span className="text-xs text-slate-500" aria-hidden="true">=</span>
                        <input
                          type="text"
                          aria-label={`Value of new variable ${i + 1}`}
                          value={a.value}
                          onChange={(e) => setEnvAdditions((prev) => prev.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
                          placeholder="value"
                          spellCheck={false}
                          className="flex-1 min-w-0 px-2 py-1 rounded bg-white/5 border border-white/10 text-xs font-mono text-slate-200 placeholder-slate-600 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20"
                        />
                        <Hint label="Remove this row">
                          <button onClick={() => setEnvAdditions((prev) => prev.filter((_, j) => j !== i))} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`Remove new variable ${i + 1}`}>
                            <X size={14} />
                          </button>
                        </Hint>
                      </div>
                    ))}
                  </div>
                )}

                {/* Variable table */}
                <div className="max-h-72 overflow-y-auto scrollbar-thin rounded-lg border border-white/[0.03]">
                  {filteredEnvEntries.length === 0 ? (
                    <EmptyState compact title="No matching variables found." hint={envSearch ? 'Try another name or value.' : undefined} />
                  ) : (
                    filteredEnvEntries.map((entry, idx) => {
                      const sensitive = isSensitiveKey(entry.key)
                      const revealed = revealedSecrets.has(entry.key)
                      return (
                        <div
                          key={entry.key}
                          className={`flex items-center gap-3 px-4 py-2 animate-fade-in ${
                            idx % 2 === 0 ? 'bg-white/[0.03]' : 'bg-transparent'
                          }`}
                          style={{ animationDelay: `${idx * 0.02}s` }}
                        >
                          {sensitive && (
                            <Lock className="h-3 w-3 text-amber-500/60 flex-shrink-0" aria-label="Sensitive value" />
                          )}
                          <span
                            className="text-xs font-mono text-cyan-400 w-32 md:w-56 flex-shrink-0 truncate"
                            title={entry.key}
                          >
                            {entry.key}
                          </span>
                          <span className="text-xs text-slate-500 flex-shrink-0" aria-hidden="true">=</span>
                          {canEditEnv && envEditingKey === entry.key ? (
                            <input aria-label={`Value of ${entry.key}`}
                              type="text"
                              autoFocus
                              value={envDrafts[entry.key] ?? entry.value}
                              onChange={(e) => setEnvDrafts((prev) => ({ ...prev, [entry.key]: e.target.value }))}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === 'Escape') {
                                  e.preventDefault()
                                  setEnvEditingKey(null)
                                  // the field goes away: the focus goes back to the pencil that opened it
                                  requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-env-change="${CSS.escape(entry.key)}"]`)?.focus())
                                }
                                if (e.key === 'Escape') setEnvDrafts((prev) => { const next = { ...prev }; delete next[entry.key]; return next })
                              }}
                              onBlur={() => setEnvEditingKey(null)}
                              spellCheck={false}
                              className="flex-1 min-w-0 px-2 py-1 rounded bg-white/5 border border-emerald-500/40 text-xs font-mono text-slate-100 focus:outline-none focus:border-emerald-500/60 focus:ring-1 focus:ring-emerald-500/30"
                            />
                          ) : (
                            <span
                              onClick={canEditEnv && !envRemovals.has(entry.key) ? () => setEnvEditingKey(entry.key) : undefined}
                              className={`text-xs font-mono truncate flex-1 min-w-0 ${envRemovals.has(entry.key) ? 'line-through text-slate-500' : envDrafts[entry.key] !== undefined && envDrafts[entry.key] !== entry.value ? 'text-amber-300' : 'text-slate-300'} ${canEditEnv && !envRemovals.has(entry.key) ? 'cursor-text hover:text-white' : ''}`}
                              title={envRemovals.has(entry.key) ? 'Removed when you save' : sensitive && !revealed ? '(hidden)' : (envDrafts[entry.key] ?? entry.value)}
                            >
                              {sensitive && !revealed ? maskValue(envDrafts[entry.key] ?? entry.value) : (envDrafts[entry.key] ?? entry.value)}
                            </span>
                          )}
                          {canEditEnv && envDrafts[entry.key] !== undefined && envDrafts[entry.key] !== entry.value && !envRemovals.has(entry.key) && (
                            <span className="flex-shrink-0 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-amber-300" title={`Was: ${entry.value}`}>changed</span>
                          )}
                          {canEditEnv && envEditingKey !== entry.key && (
                            envRemovals.has(entry.key) ? (
                              <Hint label="Keep this variable">
                                <button onClick={() => setEnvRemovals((prev) => { const next = new Set(prev); next.delete(entry.key); return next })} className={`flex-shrink-0 ${BTN_ICON_SM} ${TONE_GHOST_OK}`} aria-label={`Keep ${entry.key}`}>
                                  <Undo2 size={14} />
                                </button>
                              </Hint>
                            ) : (
                              <>
                                <Hint label="Change the value">
                                  <button onClick={() => setEnvEditingKey(entry.key)} data-env-change={entry.key} className={`flex-shrink-0 ${BTN_ICON_SM} ${TONE_GHOST}`} aria-label={`Change the value of ${entry.key}`}>
                                    <Pencil size={12} />
                                  </button>
                                </Hint>
                                <Hint label="Remove from the compose file">
                                  <button onClick={() => { setEnvRemovals((prev) => new Set(prev).add(entry.key)); setEnvDrafts((prev) => { const next = { ...prev }; delete next[entry.key]; return next }) }} className={`flex-shrink-0 ${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`Remove ${entry.key}`}>
                                    <X size={14} />
                                  </button>
                                </Hint>
                              </>
                            )
                          )}
                          {sensitive && (
                            <Hint label={revealed ? 'Hide the value' : 'Reveal the value'}>
                              <button
                                onClick={() => toggleSecret(entry.key)}
                                className={`flex-shrink-0 ${BTN_ICON_SM} ${TONE_GHOST}`}
                                aria-label={`${revealed ? 'Hide' : 'Reveal'} the value of ${entry.key}`}
                                aria-pressed={revealed}
                              >
                                {revealed ? (
                                  <EyeOff size={14} />
                                ) : (
                                  <Eye size={14} />
                                )}
                              </button>
                            </Hint>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
                {canEditEnv && (
                  <button
                    onClick={() => setEnvAdditions((prev) => [...prev, { key: '', value: '' }])}
                    className={BTN_CARD_QUIET}
                  >
                    <Plus size={12} />
                    Add variable
                  </button>
                )}
              </div>
            )}
          </div>
          <FloatingSaveBar
            hasChanges={canEditEnv && envDirty}
            saving={envSaving}
            onSave={handleSaveEnv}
            onDiscard={discardEnv}
            message={`Environment changes for ${containerName}`}
            saveLabel={envRecreate ? 'Save & recreate' : 'Save'}
            savingLabel={envRecreate ? 'Saving & recreating…' : 'Saving…'}
            extra={(
              <label className="flex items-center gap-1.5 text-xs text-slate-400 cursor-pointer select-none" title="Recreate the container right away so the new values apply">
                <input type="checkbox" checked={envRecreate} onChange={(e) => setEnvRecreate(e.target.checked)} className="h-3.5 w-3.5 rounded border-white/20 bg-white/5 accent-emerald-500" />
                Recreate to apply
              </label>
            )}
          />
        </section>
      )}

      {/* ---- Volume Mounts (Enhanced) ---- */}
      {mountEntries.length > 0 && (
        <section className="animate-fade-in" style={{ animationDelay: '0.2s' }}>
          <div className="surface p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <HardDrive className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Volume mounts
              </h2>
              <span className="text-xs text-slate-500 ml-1">({mountEntries.length})</span>
            </div>

            <div className="grid gap-2.5">
              {mountEntries.map((mount, idx) => (
                <div
                  key={`${mount.source}:${mount.destination}`}
                  className="
                    flex items-center gap-3 px-4 py-3 rounded-lg
                    bg-white/[0.03] border border-white/[0.03]
                    hover:bg-white/5 transition-colors duration-200
                    animate-fade-in
                  "
                  style={{ animationDelay: `${idx * 0.05}s` }}
                >
                  {/* Source path */}
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-xs font-mono text-cyan-400 truncate block"
                      title={mount.source}
                    >
                      {mount.source}
                    </span>
                  </div>

                  {/* Arrow */}
                  <ArrowRight className="h-4 w-4 text-slate-600 flex-shrink-0" />

                  {/* Destination path */}
                  <div className="flex-1 min-w-0">
                    <span
                      className="text-xs font-mono text-emerald-400 truncate block"
                      title={mount.destination}
                    >
                      {mount.destination}
                    </span>
                  </div>

                  {/* Mode badge */}
                  {mount.mode && (
                    <span
                      className={`
                        flex-shrink-0 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide
                        ${mount.mode === 'ro'
                          ? 'bg-rose-500/10 text-rose-400 ring-1 ring-rose-500/20'
                          : 'bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/20'
                        }
                      `}
                    >
                      {mount.mode}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* ---- Port Mappings (Enhanced) ---- */}
      {portMappings.length > 0 && (
        <section className="animate-fade-in" style={{ animationDelay: '0.3s' }}>
          <div className="surface p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Globe className="h-4 w-4 text-cyan-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Port mappings
              </h2>
              <span className="text-xs text-slate-500 ml-1">({portMappings.length})</span>
              {member && (
                <span className="ml-auto text-[11px] text-violet-200 bg-violet-500/10 border border-violet-500/20 rounded-full px-2 py-0.5 truncate" title="A container in a VM publishes its ports on the VM's address">
                  on {memberName || containerInfo.member_name || 'its VM'}{containerInfo.member_host ? ` · ${containerInfo.member_host}` : ''}
                </span>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {portMappings.map((port, idx) => {
                // Build a clickable URL from the host port. A container in a VM publishes its ports on the VM's
                // address (not on this server's): the link follows it, and a port bound to the VM's own loopback
                // cannot be reached from here at all
                const bind = port.bindAddress || ''
                const wildcard = bind === '0.0.0.0' || bind === '[::]' || bind === '::' || !bind
                const vmHost = member ? (containerInfo.member_host || '') : ''
                const portHost = member
                  ? (wildcard ? vmHost : bind === '127.0.0.1' ? '' : bind)
                  : (bind === '127.0.0.1' ? 'localhost' : wildcard ? serverHostname() : bind)
                const portUrl = port.hostPort && portHost ? (() => {
                  const proto = ['443', '8443', '9443'].includes(String(port.hostPort)) ? 'https' : 'http'
                  return `${proto}://${portHost}:${port.hostPort}`
                })() : null
                const shownBind = member && wildcard && vmHost ? vmHost : bind
                // A real link: the browser opens a tab, Electron hands it to the
                // system browser, the Android WebView launches the browser app
                const Tile: React.ElementType = portUrl ? 'a' : 'div'
                return (
                <Tile
                  key={`${port.hostPort || 'exposed'}-${port.containerPort}-${port.protocol}`}
                  className={`
                    flex items-center gap-3 px-4 py-3 rounded-lg
                    bg-white/[0.03] border border-white/[0.03]
                    hover:bg-white/5 transition-colors duration-200
                    animate-fade-in no-underline
                    ${portUrl ? 'cursor-pointer group' : ''}
                  `}
                  style={{ animationDelay: `${idx * 0.05}s` }}
                  {...(portUrl ? { href: portUrl, target: '_blank', rel: 'noopener noreferrer' } : {})}
                  title={portUrl ? `Open ${portUrl}` : (member && port.hostPort ? (bind === '127.0.0.1' ? "Bound to the VM's own loopback address: it cannot be opened from here" : "The VM's address is not known yet") : undefined)}
                >
                  {/* Host port (or "exposed" label if no host binding) */}
                  {port.hostPort ? (
                    <div className="flex flex-col items-center min-w-0">
                      {shownBind && (
                        <span className="text-[10px] text-slate-500 font-mono truncate max-w-[110px]" title={shownBind}>
                          {shownBind}
                        </span>
                      )}
                      <span className="text-lg font-bold text-white leading-tight">
                        {port.hostPort}
                      </span>
                      <span className="text-[10px] text-slate-500 uppercase">host</span>
                    </div>
                  ) : (
                    <div className="flex flex-col items-center min-w-0">
                      <span className="text-xs font-medium text-slate-500 italic">exposed</span>
                    </div>
                  )}

                  {/* Arrow */}
                  <ArrowRight className="h-4 w-4 text-cyan-500/50 flex-shrink-0" />

                  {/* Container port */}
                  <div className="flex flex-col items-center min-w-0">
                    <span className="text-lg font-bold text-cyan-400 leading-tight">
                      {port.containerPort}
                    </span>
                    <span className="text-[10px] text-slate-500 uppercase">container</span>
                  </div>

                  {/* Protocol badge + open link */}
                  <div className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    <span
                      className={`
                        px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide
                        ${port.protocol === 'udp'
                          ? 'bg-purple-500/10 text-purple-400 ring-1 ring-purple-500/20'
                          : 'bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20'
                        }
                      `}
                    >
                      {port.protocol}
                    </span>
                    {portUrl && (
                      <ExternalLink className="h-3.5 w-3.5 text-slate-600 group-hover:text-cyan-400 transition-colors" />
                    )}
                  </div>
                </Tile>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ---- Network Connections (Enhanced) ---- */}
      {networks.length > 0 && (
        <section className="animate-fade-in" style={{ animationDelay: '0.4s' }}>
          <div className="surface p-4 md:p-5">
            <div className="flex items-center gap-2 mb-4">
              <Network className="h-4 w-4 text-purple-400" />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                Networks
              </h2>
              <span className="text-xs text-slate-500 ml-1">({networks.length})</span>
            </div>

            <div className="flex flex-wrap gap-2.5">
              {networks.map((net, idx) => {
                const color = NETWORK_COLORS[idx % NETWORK_COLORS.length]
                return (
                  <span
                    key={net}
                    className={`
                      inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold
                      ring-1 transition-all duration-200 hover:scale-105 cursor-default
                      animate-fade-in
                      ${color.bg} ${color.text} ${color.ring}
                    `}
                    style={{ animationDelay: `${idx * 0.05}s` }}
                  >
                    <Network className="h-3.5 w-3.5" />
                    {net}
                  </span>
                )
              })}
            </div>
          </div>
        </section>
      )}

      {/* ---- File Browser (the container's files are read by an admin call on the API) ---- */}
      {isAdmin && detail?.state === 'running' && (
        <ContainerFileBrowser containerName={containerName} member={member} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Subcomponents
// ---------------------------------------------------------------------------

const SectionHeader: React.FC<{ icon: React.ReactNode; title: string }> = ({ icon, title }) => (
  <div className="flex items-center gap-2">
    {icon}
    <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
  </div>
)

interface StatCardProps {
  icon: React.ReactNode
  label: string
  value: string
  subValue?: string
  loading: boolean
}

const StatCard: React.FC<StatCardProps> = ({ icon, label, value, subValue, loading }) => (
  <div className="surface p-4 flex flex-col gap-2">
    <div className="flex items-center gap-2">
      {icon}
      <span className="text-xs text-slate-500 uppercase tracking-wide">{label}</span>
    </div>
    {loading ? (
      <div className="h-5 w-20 bg-white/[0.06] rounded animate-pulse" />
    ) : (
      <div>
        <p className="text-sm font-bold text-white truncate" title={value}>
          {value}
        </p>
        {subValue && (
          <p className="text-xs text-slate-500 mt-0.5">{subValue}</p>
        )}
      </div>
    )}
  </div>
)

export default ContainerDetail
