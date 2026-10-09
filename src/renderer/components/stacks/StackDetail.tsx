// =============================================================================
// StackDetail — Detailed view for a selected stack with containers, logs, actions
// =============================================================================

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl } from '@mantine/core'
import {
  ArrowLeft,
  Play,
  Square,
  RotateCcw,
  Download,
  Loader2,
  Box,
  Terminal,
  Server,
  Clock,
  Shield,
  Network,
  CheckCircle2,
  XCircle,
  ChevronDown,
  RefreshCw,
  FileCode2,
  Copy,
  Pencil,
  X,
  CloudUpload,
  CloudDownload,
  Moon,
} from 'lucide-react'
import type { StackDetail as StackDetailType, ContainerInfo, StackInfo, ProxmoxVmAction, StackAppDataStatus } from '../../../shared/types'
import AppDataLabel from './AppDataLabel'
import { fetchStack, fetchStackLogs, fetchStackCompose, cloneStack, renameStack, startContainer, stopContainer, restartContainer, proxmoxVmAction, pushStackFiles, pullStackFiles, fetchStackAppData, mountStackAppData, unmountStackAppData } from '../../api/endpoints'
import { usePolling } from '../../hooks/usePolling'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { EmptyState, ErrorState, LoadingState } from '../common/PageState'
import Hint from '../common/Hint'
import ModalOverlay from '../common/ModalOverlay'
import { ComposeViewer } from './ComposeViewer'
import { pageLabel } from '../../constants/pageTitles'
import { StateChip, AsleepCount } from '../common/StateChip'
import { containerState, countStates, isAsleep, stackState, STACK_META } from '../../lib/containerState'
import {
  BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY,
  TONE_QUIET, TONE_OK, TONE_DANGER, TONE_GHOST, TONE_GHOST_OK, TONE_GHOST_DANGER,
} from '../../lib/ui'

import Kbd from '../common/Kbd'
interface Props {
  stackName: string
  onBack: () => void
  onAction: (stackName: string, action: 'start' | 'stop' | 'restart' | 'update') => void
  isActionLoading: boolean
  onContainerClick?: (containerName: string) => void
  isAdmin?: boolean
  /** the list entry: on a hub a VM stack carries its VM, member and address */
  stack?: StackInfo | null
}

/** Format seconds into human-readable uptime */
function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`
  const hours = Math.floor(seconds / 3600)
  const mins = Math.floor((seconds % 3600) / 60)
  if (hours < 24) return `${hours}h ${mins}m`
  const days = Math.floor(hours / 24)
  return `${days}d ${hours % 24}h`
}

/** Pretty-print stack category names */
function formatStackName(name: string): string {
  return name
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

/** Health status icon and color */
function healthIndicator(health: string) {
  const h = health.toLowerCase()
  if (h === 'healthy') return { icon: CheckCircle2, color: 'text-emerald-400', bg: 'bg-emerald-500/10' }
  if (h === 'unhealthy') return { icon: XCircle, color: 'text-rose-400', bg: 'bg-rose-500/10' }
  if (h === 'starting') return { icon: Loader2, color: 'text-amber-400', bg: 'bg-amber-500/10' }
  return { icon: Shield, color: 'text-slate-500', bg: 'bg-slate-500/10' }
}

/** Container state badge */
function stateBadge(state: string) {
  const s = state.toLowerCase()
  if (s === 'running')
    return 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25'
  if (s === 'exited' || s === 'dead')
    return 'bg-rose-500/15 text-rose-400 ring-1 ring-rose-500/25'
  if (s === 'restarting' || s === 'created')
    return 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25'
  if (s === 'paused')
    return 'bg-cyan-500/15 text-cyan-400 ring-1 ring-cyan-500/25'
  return 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25'
}

type Tab = 'containers' | 'services' | 'logs'

/** a container's ports as chips: an IPv6 binding that mirrors an IPv4 one (":::3001->…" beside "0.0.0.0:3001->…") is one port, not two */
function portChips(ports: string): string[] {
  const all = ports.split(',').map((p) => p.trim()).filter(Boolean)
  const v6 = (p: string) => p.startsWith(':::') || p.startsWith('[::]')
  const hostPort = (p: string) => p.split('->')[0].match(/:(\d+)$/)?.[1] ?? p
  return all.filter((p) => !v6(p) || !all.some((o) => o !== p && !v6(o) && hostPort(o) === hostPort(p)))
}

export default function StackDetail({ stackName, onBack, onAction, isActionLoading, onContainerClick, isAdmin = false, stack = null }: Props) {
  // a VM stack: the VM is the stack — its power is part of the stack's controls
  const isVm = stack?.placement === 'vm'
  const [vmBusy, setVmBusy] = useState('')
  const vmPower = async (action: ProxmoxVmAction) => {
    if (!stack?.node || !stack.vmid) return
    const vm = `the VM #${stack.vmid}${stack.member_name ? ` (${stack.member_name})` : ''}`
    if (action !== 'start') {
      const ok = await confirm(action === 'shutdown'
        ? { title: 'Shut down the VM?', message: `Shut down ${vm}? Every container in it stops until the VM is started again.`, confirmLabel: 'Shut down VM', danger: true }
        : { title: 'Reboot the VM?', message: `Reboot ${vm}? Its containers stop and start again with it.`, confirmLabel: 'Reboot VM' })
      if (!ok) return
    }
    setVmBusy(action)
    try {
      // the list row says which guest kind the hub matched (an LXC is driven by other Proxmox routes than a VM)
      await proxmoxVmAction(stack.node, stack.type === 'lxc' ? 'lxc' : 'qemu', stack.vmid, action)
      addToast({ type: 'success', message: action === 'start' ? `Starting ${vm}` : action === 'reboot' ? `Rebooting ${vm}` : `Shutting down ${vm}` })
    } catch (err) {
      addToast({ type: 'error', message: `Could not ${action === 'shutdown' ? 'shut down' : action} ${vm}: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally { setVmBusy('') }
  }
  // the stack, every 5 s (only its own answer is shown: another stack never shows this one's)
  const detailKey = `stack:${stackName}`
  const detailPoll = usePolling<StackDetailType>(() => fetchStack(stackName), 5000, { key: detailKey })
  const detail = detailPoll.dataKey === detailKey ? detailPoll.data : null
  const loadDetail = detailPoll.refresh
  // keep the previous detail on an error; the message shows when there is none yet
  const loadError = detailPoll.error ? detailPoll.error.message || String(detailPoll.error) : null
  const [retrying, setRetrying] = useState(false)
  const loading = detailPoll.loading || retrying
  const [logs, setLogs] = useState<string>('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<Tab>('containers')
  const [showCompose, setShowCompose] = useState(false)
  const [composeContent, setComposeContent] = useState('')
  const [composeLoading, setComposeLoading] = useState(false)
  // a VM stack's files: the hub's copy into the VM, or the VM's copy onto the hub
  const [filesBusy, setFilesBusy] = useState<'push' | 'pull' | ''>('')
  // a VM stack's App-Data, shown on the hub through Stacks/<name>/VM-App-Data: whether it is mounted, and why not
  // (null: a hub that does not know the call yet, or a viewer — the plain sentence is shown)
  const [appData, setAppData] = useState<StackAppDataStatus | null>(null)
  const [appDataBusy, setAppDataBusy] = useState<'mount' | 'unmount' | ''>('')
  const logEndRef = useRef<HTMLDivElement>(null)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const cloneFieldId = useId()

  // Clone state
  const [showCloneModal, setShowCloneModal] = useState(false)
  const [cloneName, setCloneName] = useState('')
  const [cloneLoading, setCloneLoading] = useState(false)

  // Rename state
  const [renameMode, setRenameMode] = useState(false)
  const [renameTo, setRenameTo] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)

  // leaving the rename field puts the keyboard back on the pencil that opened it
  const cancelRename = () => {
    setRenameMode(false)
    setRenameTo('')
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-rename-open]')?.focus())
  }

  // Fetch compose file content
  const handleViewCompose = useCallback(async () => {
    setComposeLoading(true)
    try {
      const data = await fetchStackCompose(stackName)
      setComposeContent(data.content)
      setShowCompose(true)
    } catch (err) {
      // the viewer has nothing to show without the file: say why instead of opening it
      addToast({ type: 'error', message: `Could not read the compose file of ${stackName}: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally {
      setComposeLoading(false)
    }
  }, [stackName, addToast])

  // Clone stack handler
  const handleClone = useCallback(async () => {
    if (!cloneName.trim()) return
    setCloneLoading(true)
    try {
      const result = await cloneStack(stackName, cloneName.trim())
      if (result.success) {
        addToast({ type: 'success', message: `Stack cloned as "${cloneName.trim()}"` })
        setShowCloneModal(false)
        setCloneName('')
      } else {
        addToast({ type: 'error', message: result.message || 'Clone failed', duration: 6000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Clone failed', duration: 6000 })
    } finally {
      setCloneLoading(false)
    }
  }, [stackName, cloneName, addToast])

  // Rename stack handler
  const handleRename = useCallback(async () => {
    if (!renameTo.trim() || renameTo.trim() === stackName) return
    setRenameLoading(true)
    try {
      const result = await renameStack(stackName, renameTo.trim())
      if (result.success) {
        addToast({ type: 'success', message: `Stack renamed to "${renameTo.trim()}"` })
        setRenameMode(false)
        onBack() // Go back to list since the stack name changed
      } else {
        addToast({ type: 'error', message: result.message || 'Rename failed', duration: 6000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Rename failed', duration: 6000 })
    } finally {
      setRenameLoading(false)
    }
  }, [stackName, renameTo, addToast, onBack])


  // Fetch stack logs
  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const data = await fetchStackLogs(stackName)
      setLogs(data.logs)
    } catch {
      setLogs('Failed to fetch logs.')
    } finally {
      setLogsLoading(false)
    }
  }, [stackName])

  // a VM stack: push the hub's files into the VM (a rebuilt VM, a change made on the hub by hand) or pull the
  // VM's copies onto the hub; both replace files, so ask first
  const moveFiles = useCallback(async (dir: 'push' | 'pull') => {
    const vm = stack?.member_name ? `the VM ${stack.member_name}` : 'the VM'
    const ok = await confirm(dir === 'push'
      ? { title: 'Push the files to the VM?', message: `Copy the hub's files of ${stackName} into ${vm}? The VM's copies of those files are overwritten (nothing is removed there).`, confirmLabel: 'Push files', danger: true }
      : { title: 'Pull the files from the VM?', message: `Replace the hub's files of ${stackName} with ${vm}'s, file for file? The compose file it replaces is kept in the history.`, confirmLabel: 'Pull files', danger: true })
    if (!ok) return
    setFilesBusy(dir)
    try {
      const res = dir === 'push' ? await pushStackFiles(stackName) : await pullStackFiles(stackName)
      addToast({ type: res.success ? 'success' : 'error', message: res.message, duration: res.success ? 4000 : 8000 })
      if (dir === 'pull') void loadDetail()
    } catch (err) {
      addToast({ type: 'error', message: `Could not ${dir} the files of ${stackName}: ${err instanceof Error ? err.message : String(err)}`, duration: 8000 })
    } finally {
      setFilesBusy('')
    }
  }, [stackName, stack?.member_name, confirm, addToast, loadDetail])

  // the hub's view of the VM's App-Data: read when the page opens and every half minute (a mount comes by itself a
  // moment after a deploy or a start, and goes with a VM that is switched off)
  const appDataPoll = usePolling(() => fetchStackAppData(stackName), 30000, { key: `stack-app-data:${stackName}`, enabled: isVm && isAdmin })
  const loadAppData = appDataPoll.refresh
  useEffect(() => {
    if (!isVm || !isAdmin || appDataPoll.error) setAppData(null)
    else if (appDataPoll.data) setAppData(appDataPoll.data.placement === 'vm' ? appDataPoll.data : null)
  }, [isVm, isAdmin, appDataPoll.data, appDataPoll.error])
  const moveAppData = useCallback(async (what: 'mount' | 'unmount') => {
    setAppDataBusy(what)
    try {
      const res = what === 'mount' ? await mountStackAppData(stackName) : await unmountStackAppData(stackName)
      setAppData(res.placement === 'vm' ? res : null)
      addToast({ type: 'success', message: res.message || (what === 'mount' ? `The App-Data of ${stackName} is mounted on the hub` : `The App-Data of ${stackName} is unmounted on the hub`) })
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : String(err), duration: 9000 })
      void loadAppData()
    } finally {
      setAppDataBusy('')
    }
  }, [stackName, addToast, loadAppData])


  // Load logs when tab switches to logs
  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs()
    }
  }, [activeTab, loadLogs])

  // Auto-scroll logs
  useEffect(() => {
    if (activeTab === 'logs' && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs, activeTab])

  const isRunning = detail?.status === 'running'
  // the stack as a whole: running, partly down, asleep on demand (fine), can't wake, or stopped
  const stackCounts = countStates(detail?.containers)
  const stackKey = detail ? stackState({ ...detail, total_containers: detail.containers?.length }) : 'stopped'

  // stop, restart and update ask first; starting does not
  const askThen = async (action: 'stop' | 'restart' | 'update') => {
    const ask = {
      stop: { title: `Stop ${stackName}?`, message: `Stop every container in ${stackName}? What it serves is unavailable until it is started again.`, confirmLabel: 'Stop stack', danger: true },
      restart: { title: `Restart ${stackName}?`, message: `Restart every container in ${stackName}?`, confirmLabel: 'Restart stack', danger: false },
      update: { title: `Update ${stackName}?`, message: `Pull the latest images for ${stackName} and apply rolling updates?`, confirmLabel: 'Update stack', danger: false },
    }[action]
    if (await confirm(ask)) onAction(stackName, action)
  }

  // Skeleton loading state
  if (loading && !detail) {
    return (
      <div className="space-y-6 animate-fade-in" role="status" aria-label="Reading the stack">
        {/* Back button skeleton */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-white/5 animate-pulse" />
          <div className="w-48 h-6 rounded bg-white/5 animate-pulse" />
        </div>
        {/* Card skeleton */}
        <div className="surface p-4 md:p-5 space-y-4">
          <div className="w-64 h-8 rounded bg-white/5 animate-pulse" />
          <div className="w-32 h-5 rounded bg-white/5 animate-pulse" />
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 rounded-lg bg-white/5 animate-pulse" />
            ))}
          </div>
        </div>
        {/* Table skeleton */}
        <div className="surface p-4 md:p-5 space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 rounded bg-white/5 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  // the first read failed: say so, with a way back and a way to try again
  if (!detail && loadError) {
    return (
      <div className="space-y-5 animate-fade-in">
        <h1 className="sr-only">{formatStackName(stackName)}</h1>
        <Hint label={`Back to ${pageLabel('stacks')} (Esc)`}>
          <button onClick={onBack} aria-label="Back" className={BTN_TOOLBAR_QUIET}>
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
          </button>
        </Hint>
        <ErrorState title={`Could not read ${stackName}`} error={loadError} onRetry={() => { setRetrying(true); void loadDetail().finally(() => setRetrying(false)) }} />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Back button + stack name */}
      <div className="flex items-center gap-3">
        <Hint label={`Back to ${pageLabel('stacks')} (Esc)`}>
          <button onClick={onBack} aria-label="Back" className={`${BTN_TOOLBAR_QUIET} shrink-0`}>
            <ArrowLeft size={14} />
            <span className="hidden sm:inline">Back</span>
            <Kbd className="hidden sm:inline-flex ml-1">Esc</Kbd>
          </button>
        </Hint>
        <div className="flex-1 min-w-0">
          {renameMode ? (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                aria-label="New name of the stack"
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRename()
                  if (e.key === 'Escape') { e.stopPropagation(); cancelRename() }
                }}
                placeholder={stackName}
                autoFocus
                className="px-2.5 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-100 font-mono placeholder-slate-500 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none w-56 max-w-full"
              />
              <button
                onClick={handleRename}
                disabled={renameLoading || !renameTo.trim() || renameTo.trim() === stackName}
                className={`${BTN_TOOLBAR} ${TONE_OK}`}
              >
                {renameLoading ? <Loader2 size={14} className="animate-spin" /> : 'Save'}
              </button>
              <Hint label="Cancel the rename">
                <button aria-label="Cancel the rename"
                  onClick={cancelRename}
                  className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                >
                  <X size={14} />
                </button>
              </Hint>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <h1 className="text-lg md:text-xl font-bold text-slate-100 truncate">
                  {formatStackName(stackName)}
                </h1>
                <p className="text-xs text-slate-400 font-mono truncate">{stackName}</p>
              </div>
              {/* a VM stack's name is the VM's: the API refuses the rename (409) */}
              {isAdmin && !isVm && (
                <Hint label="Rename the stack">
                  <button
                    aria-label="Rename the stack"
                    data-rename-open
                    onClick={() => { setRenameMode(true); setRenameTo(stackName) }}
                    className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                  >
                    <Pencil size={12} />
                  </button>
                </Hint>
              )}
            </div>
          )}
        </div>
      </div>

      {/* a VM stack: where it runs, and its power */}
      {isVm && !renameMode && (
        <div className="flex items-center gap-2 flex-wrap text-[11px]">
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ring-1 font-semibold ${stack?.reachable === false ? 'bg-rose-500/10 text-rose-300 ring-rose-500/25' : 'bg-violet-500/15 text-violet-200 ring-violet-500/25'}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${stack?.reachable === false ? 'bg-rose-400' : 'bg-violet-300'}`} />
            VM #{stack?.vmid}{stack?.node ? ` on ${stack.node}` : ''}{stack?.reachable === false ? ' · off or not answering' : ''}
          </span>
          {stack?.member_url && <span className="text-slate-400 font-mono">{stack.member_url.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}</span>}
          {stack?.version && <span className="text-slate-400">DCS {stack.version}</span>}
          {isAdmin && stack?.vmid && (
            <span className="inline-flex flex-wrap items-center gap-1.5 ml-1">
              {stack.reachable === false && <button type="button" onClick={() => vmPower('start')} disabled={!!vmBusy} className={`${BTN_CARD} ${TONE_OK}`}>{vmBusy === 'start' ? 'Starting…' : 'Start VM'}</button>}
              {stack.reachable !== false && <button type="button" onClick={() => vmPower('reboot')} disabled={!!vmBusy} className={BTN_CARD_QUIET}>{vmBusy === 'reboot' ? 'Rebooting…' : 'Reboot VM'}</button>}
              {stack.reachable !== false && <button type="button" onClick={() => vmPower('shutdown')} disabled={!!vmBusy} className={`${BTN_CARD} ${TONE_DANGER}`}>{vmBusy === 'shutdown' ? 'Shutting down…' : 'Shut down VM'}</button>}
              <button type="button" onClick={() => useSettingsStore.getState().setCurrentPage('proxmox')} className={BTN_CARD_QUIET}>{pageLabel('proxmox')} page</button>
            </span>
          )}
          {/* where things are: the hub's Stacks folder looks like any stack folder, and an App-Data made in it is never filled */}
          <p className="basis-full text-slate-500">
            The compose, <span className="font-mono text-slate-400">.env</span> and configuration are kept on the hub in <span className="font-mono text-slate-400">Stacks/{stackName}</span> and pushed into the VM on every save.
            The containers and their data (<span className="font-mono text-slate-400">App-Data</span>) are in the VM{stack?.member_url ? <> at <span className="font-mono text-slate-400">{stack.member_url.replace(/^https?:\/\//, '').replace(/:\d+$/, '')}</span></> : null}, under the same folder there{appData ? '.' : ': open the File Browser or the Terminal with this VM chosen to look at them.'}
          </p>
          {/* the VM's App-Data on the hub: a link in the hub's stack folder to a live mount of the VM's folder */}
          {appData && (
            <p className="basis-full text-slate-500 flex items-center flex-wrap gap-x-2 gap-y-1.5" data-appdata-state={appData.state}>
              {appData.state === 'mounted' ? (
                <span>
                  <span className="text-emerald-300">That App-Data is on the hub too, live:</span>{' '}
                  <span className="font-mono text-slate-400">{appData.link}</span> — a file edited there is edited in the VM at once{appData.access === 'root' ? ' (as root there: a file made from the hub belongs to root)' : ''}.
                </span>
              ) : appData.state === 'off' ? (
                <span>Showing that App-Data on the hub is switched off (<span className="font-mono text-slate-400">FLEET_APPDATA_MOUNT=false</span> in the hub&apos;s <span className="font-mono text-slate-400">.env</span>).</span>
              ) : (
                <span>
                  <span className="text-amber-300">That App-Data is not shown on the hub{appData.state === 'held' ? '' : ' yet'}:</span>{' '}
                  {appData.reason || 'no reason was recorded'}.{' '}
                  {appData.state !== 'held' && <>The hub tries again by itself; <span className="font-mono text-slate-400">{appData.link}/NOT-MOUNTED.txt</span> says the same.</>}
                </span>
              )}
              {appData.state === 'mounted' && (
                <button type="button" onClick={() => void moveAppData('unmount')} disabled={!!appDataBusy} className={BTN_CARD_QUIET} data-appdata-unmount>
                  {appDataBusy === 'unmount' ? 'Unmounting…' : 'Unmount'}
                </button>
              )}
              {appData.state !== 'mounted' && appData.state !== 'off' && (
                <button type="button" onClick={() => void moveAppData('mount')} disabled={!!appDataBusy} className={BTN_CARD_QUIET} data-appdata-mount>
                  {appDataBusy === 'mount' ? 'Mounting…' : 'Mount'}
                </button>
              )}
            </p>
          )}
        </div>
      )}

      {/* Status + actions card */}
      <div className="surface p-4 md:p-5">
        <div className="flex items-center justify-between flex-wrap gap-4">
          {/* Status info */}
          <div className="flex items-center flex-wrap gap-x-4 gap-y-2">
            {/* Status badge */}
            <span
              title={STACK_META[stackKey].hint}
              className={`
                inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium
                ${
                  stackKey === 'running' ? 'bg-emerald-500/15 text-emerald-400 ring-1 ring-emerald-500/25'
                    : stackKey === 'asleep' ? 'bg-indigo-500/15 text-indigo-300 ring-1 ring-indigo-500/25'
                    : stackKey === 'partial' || stackKey === 'stuck' ? 'bg-amber-500/15 text-amber-400 ring-1 ring-amber-500/25'
                    : 'bg-slate-500/15 text-slate-400 ring-1 ring-slate-500/25'
                }
              `}
            >
              {stackKey === 'asleep' || stackKey === 'stuck'
                ? <Moon size={11} aria-hidden className="shrink-0" />
                : <span className={`w-1.5 h-1.5 rounded-full ${STACK_META[stackKey].dot} ${stackKey === 'running' ? 'animate-pulse' : ''}`} />}
              {STACK_META[stackKey].label}
            </span>

            {/* Container count */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Box className="w-3.5 h-3.5 text-slate-500" />
              <span>
                <span className="font-semibold text-slate-200">
                  {detail?.running_containers ?? 0}
                </span>{' '}
                {stackCounts.asleep + stackCounts.stuck > 0 || stackCounts.stopped > 0
                  ? <>running{stackCounts.asleep + stackCounts.stuck > 0 && <><span className="text-slate-600">{' · '}</span><AsleepCount n={stackCounts.asleep} stuck={stackCounts.stuck} className="font-semibold" /></>}
                      {stackCounts.stopped > 0 && <><span className="text-slate-600">{' · '}</span><span className="font-semibold text-rose-400">{stackCounts.stopped}</span> stopped</>}</>
                  : <>container{(detail?.running_containers ?? 0) !== 1 ? 's' : ''}</>}
              </span>
            </div>

            {/* Services count */}
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Server className="w-3.5 h-3.5 text-slate-500" />
              <span>
                <span className="font-semibold text-slate-200">
                  {detail?.services?.length ?? 0}
                </span>{' '}
                service{(detail?.services?.length ?? 0) !== 1 ? 's' : ''}
              </span>
            </div>

            {/* where its App-Data is (a hub stack: a VM's App-Data is shown below, from the VM) */}
            {!isVm && <AppDataLabel stack={stackName} appData={detail?.app_data ?? stack?.app_data} className="max-w-full" />}
          </div>

          {/* Action buttons: emerald starts, rose stops, the rest is neutral */}
          <div className="flex items-center flex-wrap gap-2">
            {/* start, stop and restart are admin calls on the API: a viewer sees the state, not the controls */}
            {isAdmin && (
              <>
                <button
                  onClick={() => onAction(stackName, 'start')}
                  disabled={isRunning || isActionLoading}
                  className={`${BTN_TOOLBAR} ${TONE_OK}`}
                >
                  {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                  Start
                </button>

                <button
                  onClick={() => void askThen('stop')}
                  disabled={!isRunning || isActionLoading}
                  className={`${BTN_TOOLBAR} ${TONE_DANGER}`}
                >
                  {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
                  Stop
                </button>

                <button
                  onClick={() => void askThen('restart')}
                  disabled={!isRunning || isActionLoading}
                  className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
                >
                  {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Restart
                </button>
              </>
            )}

            {/* Update — admin only (pulls images + redeploys) */}
            {isAdmin && (
              <button
                onClick={() => void askThen('update')}
                disabled={isActionLoading}
                className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
              >
                {isActionLoading ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                Update
              </button>
            )}

            <button
              onClick={handleViewCompose}
              disabled={composeLoading}
              className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
            >
              {composeLoading ? <Loader2 size={14} className="animate-spin" /> : <FileCode2 size={14} />}
              Compose
            </button>

            {isAdmin && (
              <button
                onClick={() => { setShowCloneModal(true); setCloneName('') }}
                className={`${BTN_TOOLBAR} ${TONE_QUIET}`}
              >
                <Copy size={14} />
                Clone
              </button>
            )}

            {/* a VM stack: the hub keeps the files and the VM runs them — move them either way by hand */}
            {isVm && isAdmin && (
              <>
                <Hint label="Copy the hub's files of this stack into the VM (a rebuilt VM, a change made on the hub by hand)">
                  <button onClick={() => void moveFiles('push')} disabled={!!filesBusy} className={`${BTN_TOOLBAR} ${TONE_QUIET}`}>
                    {filesBusy === 'push' ? <Loader2 size={14} className="animate-spin" /> : <CloudUpload size={14} />}
                    Push files to the VM
                  </button>
                </Hint>
                <Hint label="Copy the VM's files of this stack onto the hub, file for file (the compose file replaced is kept in the history)">
                  <button onClick={() => void moveFiles('pull')} disabled={!!filesBusy} className={`${BTN_TOOLBAR} ${TONE_QUIET}`}>
                    {filesBusy === 'pull' ? <Loader2 size={14} className="animate-spin" /> : <CloudDownload size={14} />}
                    Pull files from the VM
                  </button>
                </Hint>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Compose file viewer overlay */}
      {showCompose && (
        <ComposeViewer
          stackName={stackName}
          content={composeContent}
          isAdmin={isAdmin}
          stack={stack}
          onClose={() => setShowCompose(false)}
        />
      )}

      {/* Clone modal */}
      {showCloneModal && createPortal(
        <ModalOverlay onClose={() => setShowCloneModal(false)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowCloneModal(false)}>
          <div className="glass rounded-2xl p-6 w-full max-w-sm mx-4 border border-white/10 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                <Copy size={14} className="text-cyan-400" />
              </div>
              <h3 className="text-base font-semibold text-slate-100">Clone stack</h3>
            </div>
            <p className="text-sm text-slate-400 mb-4">
              Create a copy of <span className="font-mono text-emerald-400">{stackName}</span> with a new name.
            </p>
            <div className="mb-4">
              <label htmlFor={cloneFieldId} className="block text-xs font-medium text-slate-400 mb-1.5">New stack name</label>
              <input
                id={cloneFieldId}
                value={cloneName}
                onChange={(e) => setCloneName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleClone()}
                placeholder="my-stack-copy"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-lg bg-white/5 text-sm text-slate-100 font-mono placeholder-slate-500 border border-white/10 focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/30 focus:outline-none transition-all"
              />
            </div>
            <div className="flex gap-3">
              <button onClick={() => setShowCloneModal(false)} className={`${BTN_SHEET_QUIET} flex-1`}>
                Cancel
              </button>
              <button onClick={handleClone} disabled={cloneLoading || !cloneName.trim()} className={`${BTN_SHEET_PRIMARY} flex-1`}>
                {cloneLoading ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />}
                Clone
              </button>
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}

      {/* Tab navigation: one choice; a phone swipes it sideways */}
      <div className="min-w-0 max-w-full self-start overflow-x-auto scrollbar-none">
        <SegmentedControl
          aria-label="Show"
          value={activeTab}
          onChange={(v) => setActiveTab(v as Tab)}
          data={[
            { value: 'containers', label: <span className="flex items-center gap-1.5"><Box size={13} aria-hidden />Containers</span> },
            { value: 'services', label: <span className="flex items-center gap-1.5"><Server size={13} aria-hidden />Services</span> },
            { value: 'logs', label: <span className="flex items-center gap-1.5"><Terminal size={13} aria-hidden />Logs</span> },
          ]}
        />
      </div>

      {/* Tab content */}
      {activeTab === 'containers' && (
        <ContainersTable containers={detail?.containers ?? []} onContainerClick={onContainerClick} member={isVm ? stack?.member ?? null : null} isAdmin={isAdmin} onChanged={() => void loadDetail()} />
      )}

      {activeTab === 'services' && (
        <ServicesList services={detail?.services ?? []} />
      )}

      {activeTab === 'logs' && (
        <LogViewer
          logs={logs}
          loading={logsLoading}
          onRefresh={loadLogs}
          logEndRef={logEndRef}
        />
      )}
    </div>
  )
}

// -----------------------------------------------------------------------------
// Sub-components
// -----------------------------------------------------------------------------

const TH = 'px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

function ContainersTable({ containers, onContainerClick, member = null, isAdmin = false, onChanged }: { containers: ContainerInfo[]; onContainerClick?: (name: string) => void; member?: string | null; isAdmin?: boolean; onChanged?: () => void }) {
  // start / stop / restart straight from the row — through the hub for a VM's containers
  const [busy, setBusy] = useState('')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const quick = async (e: { stopPropagation: () => void }, name: string, a: 'start' | 'stop' | 'restart') => {
    e.stopPropagation()
    // stopping takes something away: it asks first, like the Containers page
    if (a === 'stop' && !(await confirm({ title: `Stop ${name}?`, message: `Stop the container ${name}? What it serves is unavailable until it is started again.`, confirmLabel: 'Stop', danger: true }))) return
    setBusy(`${name}:${a}`)
    try {
      const r = await (a === 'start' ? startContainer : a === 'stop' ? stopContainer : restartContainer)(name, member)
      if (r.success === false) addToast({ type: 'error', message: `Could not ${a} ${name}: ${r.output || 'unknown error'}`, duration: 6000 })
    } catch (err) {
      // the row keeps its state: say why
      addToast({ type: 'error', message: `Could not ${a} ${name}: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally { setBusy(''); onChanged?.() }
  }
  if (containers.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          compact
          icon={<Box size={28} />}
          title="No containers in this stack"
          hint="Start the stack and its containers appear here."
        />
      </div>
    )
  }

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto scrollbar-thin">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-white/5">
              <th scope="col" className={TH}>Name</th>
              <th scope="col" className={TH}>State</th>
              <th scope="col" className={TH}>Health</th>
              <th scope="col" className={TH}>Image</th>
              <th scope="col" className={TH}>Uptime</th>
              <th scope="col" className={TH}>Ports</th>
              <th scope="col" className={TH}>Restarts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/[0.03]">
            {containers.map((c) => {
              const health = healthIndicator(c.health)
              const HealthIcon = health.icon
              const running = c.state.toLowerCase() === 'running'
              return (
                <tr
                  key={c.name}
                  onClick={() => onContainerClick?.(c.name)}
                  className={`hover:bg-white/[0.03] transition-colors ${onContainerClick ? 'cursor-pointer' : ''}`}
                >
                  <td className="px-3 py-3 whitespace-nowrap">
                    {onContainerClick ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onContainerClick(c.name) }}
                        className="rounded text-sm font-medium font-mono text-emerald-400 hover:text-emerald-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                      >
                        {c.name}
                      </button>
                    ) : (
                      <span className="text-sm font-medium font-mono text-slate-200">{c.name}</span>
                    )}
                    {isAdmin && (
                      <span className="inline-flex items-center gap-0.5 ml-2 align-middle">
                        {busy.startsWith(`${c.name}:`) ? <Loader2 className="w-3 h-3 animate-spin text-cyan-400" aria-label="Working" /> : (
                          <>
                            {!running && <Hint label={isAsleep(c) ? 'Wake it now (Sablier puts it back to sleep when idle)' : 'Start'}><button type="button" aria-label={`${isAsleep(c) ? 'Wake' : 'Start'} ${c.name}`} onClick={(e) => quick(e, c.name, 'start')} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}><Play size={12} /></button></Hint>}
                            {running && <Hint label="Restart"><button type="button" aria-label={`Restart ${c.name}`} onClick={(e) => quick(e, c.name, 'restart')} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><RotateCcw size={12} /></button></Hint>}
                            {running && <Hint label="Stop"><button type="button" aria-label={`Stop ${c.name}`} onClick={(e) => quick(e, c.name, 'stop')} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`}><Square size={12} /></button></Hint>}
                          </>
                        )}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap">
                    {isAsleep(c) ? (
                      // asleep on purpose: Sablier starts it on the first request
                      <StateChip state={containerState(c)} />
                    ) : (
                      <span className={`inline-flex items-center gap-1.5 h-6 px-2.5 rounded-full text-xs font-medium leading-none whitespace-nowrap ${stateBadge(c.state)}`}>
                        {c.state}
                        {c.on_demand && <span className="text-[10px] font-normal text-indigo-300/80" title="Sablier stops it when idle and starts it on the next request">· on demand</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className={`flex items-center justify-center w-5 h-5 rounded ${health.bg}`}>
                        <HealthIcon className={`w-3 h-3 ${health.color} ${c.health.toLowerCase() === 'starting' ? 'animate-spin' : ''}`} />
                      </div>
                      <span className={`text-xs ${health.color}`}>{c.health || 'N/A'}</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <span className="text-xs text-slate-400 font-mono truncate max-w-[200px] block" title={c.image}>
                      {c.image}
                    </span>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5 text-xs text-slate-400">
                      <Clock className="w-3 h-3 text-slate-500" />
                      {running
                        ? formatUptime(c.uptime_seconds)
                        : '--'}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {c.ports ? (
                      <div className="flex flex-wrap gap-1">
                        {portChips(c.ports).map((port) => (
                          <span
                            key={port}
                            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-cyan-500/10 text-[10px] text-cyan-400 font-mono ring-1 ring-cyan-500/20"
                          >
                            <Network className="w-2.5 h-2.5" />
                            {port}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">--</span>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <span
                      className={`text-xs font-mono ${
                        c.restart_count > 0 ? 'text-amber-400' : 'text-slate-500'
                      }`}
                    >
                      {c.restart_count}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ServicesList({ services }: { services: string[] }) {
  if (services.length === 0) {
    return (
      <div className="surface">
        <EmptyState
          compact
          icon={<Server size={28} />}
          title="No services defined"
          hint="Add a service to the stack's compose file and it appears here."
        />
      </div>
    )
  }

  return (
    <div className="surface p-4 md:p-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {services.map((service) => (
          <div
            key={service}
            className="flex items-center gap-3 px-4 py-3 rounded-lg bg-white/[0.03] border border-white/5 hover:bg-white/5 transition-all"
          >
            <div className="flex items-center justify-center w-7 h-7 rounded-md bg-emerald-500/10 ring-1 ring-emerald-500/20">
              <ChevronDown className="w-3.5 h-3.5 text-emerald-400 rotate-[-90deg]" />
            </div>
            <span className="text-sm text-slate-200 font-mono truncate">{service}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LogViewer({
  logs,
  loading,
  onRefresh,
  logEndRef,
}: {
  logs: string
  loading: boolean
  onRefresh: () => void
  logEndRef: React.RefObject<HTMLDivElement>
}) {
  return (
    <div className="surface overflow-hidden">
      {/* Log header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <div className="flex items-center gap-2">
          <Terminal className="w-4 h-4 text-slate-500" />
          <h2 className="text-xs font-medium text-slate-400">Stack logs</h2>
        </div>
        <button onClick={onRefresh} disabled={loading} className={BTN_CARD_QUIET}>
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Log content: a scrolling region the keyboard can reach */}
      <div
        tabIndex={0}
        role="region"
        aria-label="Stack logs"
        className="p-4 max-h-96 overflow-y-auto scrollbar-thin font-mono text-xs leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
      >
        {loading && !logs ? (
          <LoadingState compact label="Reading the logs…" />
        ) : logs ? (
          <>
            {logs.split('\n').map((line, i) => (
              <div
                key={i}
                className={`py-0.5 ${
                  line.includes('ERROR') || line.includes('error')
                    ? 'text-rose-400'
                    : line.includes('WARN') || line.includes('warn')
                      ? 'text-amber-400'
                      : line.includes('SUCCESS') || line.includes('success')
                        ? 'text-emerald-400'
                        : 'text-slate-400'
                }`}
              >
                <span className="text-slate-500 select-none mr-3">{String(i + 1).padStart(3, ' ')}</span>
                {line}
              </div>
            ))}
            <div ref={logEndRef} />
          </>
        ) : (
          <EmptyState compact icon={<Terminal size={28} />} title="No logs available" hint="The stack has not written anything yet." />
        )}
      </div>
    </div>
  )
}
