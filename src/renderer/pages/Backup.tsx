// =============================================================================
// Backup — Backup and restore management page with status, trigger, and archive
// On a hub: Everywhere lists every server's archives, a stack is backed up where
// it lives (the hub or its VM), a restore acts on the server that keeps the file.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Badge } from '@mantine/core'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { EmptyState } from '../components/common/PageState'
import { pageLabel } from '../constants/pageTitles'
import {
  BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY,
  TONE_QUIET, TONE_DANGER, TONE_GHOST,
} from '../lib/ui'
import { fetchStacks } from '../api/endpoints'
import {
  fetchBackupsScoped,
  fetchBackupStatusScoped,
  fetchBackupConfigScoped,
  triggerBackupScoped,
  restoreBackupScoped,
  verifyBackupScoped,
  cancelBackupScoped,
  fleetTargets,
  fanOut,
  summarizeOutcomes,
} from '../api/fleetScopedOps'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import {
  Archive,
  Play,
  RotateCcw,
  Clock,
  HardDrive,
  Shield,
  AlertTriangle,
  Loader2,
  CheckCircle,
  X,
  Download,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Layers,
  XCircle,
  Boxes,
  Info,
  ShieldCheck,
} from 'lucide-react'
import type {
  BackupStatusResponse,
  BackupConfigResponse,
  BackupTriggerResponse,
} from '../../shared/types'
import type { FleetBackupEntry, FleetBackupListResponse, BackupStackChoice, MemberOutcome } from '../../shared/fleetScopedOps'
import { LoadingState } from '../components/common/PageState'
import RecoveryBundleCard from '../components/backup/RecoveryBundleCard'
import TypedConfirmDialog from '../components/backup/TypedConfirmDialog'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000)
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatDateString(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** a row key: the archive on its DCS (the hub's rows have no member) */
const backupKey = (b: { member?: string | null; filename: string }) => `${b.member ?? ''}|${b.filename}`

/** the drop-down value of a stack: where it lives, then its name */
const stackKey = (member: string | null, name: string) => `${member ?? ''}|${name}`
const parseStackKey = (key: string): { member: string | null; name: string } => {
  const i = key.indexOf('|')
  return { member: i > 0 ? key.slice(0, i) : null, name: key.slice(i + 1) }
}

/** a column header of the archives table */
const TH = 'px-5 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

const vmLabel = (name: string, vmid: number | null | undefined) => `VM${vmid ? ` #${vmid}` : ''} · ${name}`

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const BACKUP_GUIDE_SECTIONS = [
  {
    title: 'What gets backed up',
    icon: Archive,
    content: `Full backups capture your entire DCS directory:

• docker-compose.yml    All stack compose files
• .env files            Stack and root environment configs
• .config/              DCS framework configuration
• .api-auth/            User accounts and settings
• .templates/           Custom service templates
• .plugins/             Installed plugins

Backups do NOT include Docker volumes or
container data — only configuration files.
Use Docker volume snapshots for data backup.`,
  },
  {
    title: 'Configuration',
    icon: Shield,
    content: `Configure backup in your server's .env file:

BACKUP_DEST_DIR="/path/to/backup/storage"
BACKUP_SOURCE_DIR=""     # defaults to DCS root
BACKUP_RETENTION_COUNT=5 # keep last 5 backups

The destination must be a writable directory.
Common choices:
  /srv/backups        Local backup storage
  /mnt/nas/backups    Network-attached storage
  /mnt/usb/backups    External USB drive`,
  },
  {
    title: 'Targeted stack backups',
    icon: Layers,
    content: `Targeted backups capture a single stack:

1. Select the stack from the dropdown
2. Click "Back up stack"

This creates a smaller archive containing only
that stack's compose file, .env, and related
configuration. Useful for quick saves before
making changes to a specific stack.`,
  },
  {
    title: 'Backups in a Proxmox fleet',
    icon: Boxes,
    content: `On a hub every VM runs its own DCS, and a
backup runs where the stack lives:

• The stack drop-down lists the hub's stacks
  first, then each VM's ("VM #103 · media")
• "Back up stack" for a VM stack runs on that
  VM and the status card follows it
• Everywhere lists every server's archives;
  Hub or a VM chip shows one server's
• "Back up everything" starts a full backup
  on the hub and on every VM at once
• A restore always acts on the server that
  keeps the archive
• Each VM has its own BACKUP_DEST_DIR and
  retention: pick the VM chip to see them

The hub cannot carry an archive to your
browser: a VM's file stays on that VM's disk
(copy it over ssh from its BACKUP_DEST_DIR).`,
  },
  {
    title: 'Restoring from a backup',
    icon: RotateCcw,
    content: `To restore from a backup archive:

1. Find the backup in the archives table
2. Click "Restore" on the desired backup
3. Type RESTORE to confirm
4. Wait for the restore to complete

IMPORTANT: Restoring overwrites current
configuration files. It does NOT automatically
restart stacks — do this manually after restore.

Tip: Create a fresh backup before restoring
an older one, so you can roll back if needed.`,
  },
]

export default function Backup() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()

  // ---- State ----
  const [triggerLoading, setTriggerLoading] = useState(false)
  const [selectedStack, setSelectedStack] = useState<string>('')
  const [stackChoices, setStackChoices] = useState<BackupStackChoice[]>([])
  const [restoreTarget, setRestoreTarget] = useState<FleetBackupEntry | null>(null)
  const [restoreLoading, setRestoreLoading] = useState(false)
  const [verifying, setVerifying] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [expandedGuide, setExpandedGuide] = useState<number | null>(null)
  // Everywhere: the server whose progress the status card follows (the last one a backup was started on)
  const [watchMember, setWatchMember] = useState<string | null>(null)
  // the last "back up everything": what every server answered
  const [fleetRun, setFleetRun] = useState<MemberOutcome<BackupTriggerResponse>[] | null>(null)

  // ---- Which server the status and the config cards talk about ----
  const watchStillThere = watchMember === null || scopeMembers.some((m) => m.id === watchMember)
  const statusMember: string | null = scope === 'all' ? (watchStillThere ? watchMember : null) : scopeMember
  const statusName = statusMember ? (scopeMembers.find((m) => m.id === statusMember)?.name ?? statusMember) : ''
  const statusVmid = statusMember ? (scopeMembers.find((m) => m.id === statusMember)?.vmid ?? null) : null
  // the config panel shows one server's settings: on Everywhere the hub's, with a note
  const configMember: string | null = scope === 'all' ? null : scopeMember

  // ---- Polling ----
  const fetchScopedStatus = useCallback(() => fetchBackupStatusScoped(statusMember), [statusMember])
  const {
    data: statusData,
    loading: statusLoading,
    refresh: refreshStatus,
  } = usePolling<BackupStatusResponse>(fetchScopedStatus, 5000, {
    enabled: isConnected,
  })
  const statusRef = useRef(statusMember)
  useEffect(() => { if (statusRef.current !== statusMember) { statusRef.current = statusMember; refreshStatus() } }, [statusMember, refreshStatus])

  const fetchScopedBackups = useCallback(() => fetchBackupsScoped(scope), [scope])
  const {
    data: backupsData,
    loading: backupsLoading,
    refresh: refreshBackups,
  } = usePolling<FleetBackupListResponse>(fetchScopedBackups, 15000, {
    enabled: isConnected,
  })
  const scopeRef = useRef(scope)
  useEffect(() => { if (scopeRef.current !== scope) { scopeRef.current = scope; refreshBackups(); setSelectedStack('') } }, [scope, refreshBackups])

  const fetchScopedConfig = useCallback(() => fetchBackupConfigScoped(configMember), [configMember])
  const {
    data: configData,
    refresh: refreshConfig,
  } = usePolling<BackupConfigResponse>(fetchScopedConfig, 30000, {
    enabled: isConnected,
  })
  const configRef = useRef(configMember)
  useEffect(() => { if (configRef.current !== configMember) { configRef.current = configMember; refreshConfig() } }, [configMember, refreshConfig])

  // ---- The stacks the drop-down offers: the hub's first, then each VM's (a hub's /stacks lists them all) ----
  useEffect(() => {
    if (!isConnected) return
    fetchStacks()
      .then((res) => {
        const hub: BackupStackChoice[] = []
        const vm: BackupStackChoice[] = []
        for (const s of res.stacks) {
          if (s.placement === 'vm' && s.member) {
            vm.push({ name: s.name, member: s.member, member_name: s.member_name ?? s.member, vmid: s.vmid ?? null, reachable: s.reachable !== false })
          } else {
            hub.push({ name: s.name, member: null, member_name: 'Hub', vmid: null, reachable: true })
          }
        }
        vm.sort((a, b) => (a.vmid ?? 0) - (b.vmid ?? 0) || a.member_name.localeCompare(b.member_name) || a.name.localeCompare(b.name))
        setStackChoices([...hub, ...vm])
      })
      .catch(() => {})
  }, [isConnected, scope])

  // what the current view can back up: everything, the hub's stacks, or one VM's
  const visibleStacks = useMemo(
    () => stackChoices.filter((s) => (scope === 'all' ? true : scope === 'hub' ? s.member === null : s.member === scopeMember)),
    [stackChoices, scope, scopeMember],
  )
  const stackGroups = useMemo(() => {
    const groups: { key: string; label: string; stacks: BackupStackChoice[] }[] = []
    for (const s of visibleStacks) {
      const key = s.member ?? ''
      let g = groups.find((x) => x.key === key)
      if (!g) { g = { key, label: s.member ? vmLabel(s.member_name, s.vmid) : 'Hub', stacks: [] }; groups.push(g) }
      g.stacks.push(s)
    }
    return groups
  }, [visibleStacks])

  // ---- Handlers ----
  const handleTriggerBackup = useCallback(
    async (member: string | null, stack?: string) => {
      setTriggerLoading(true)
      const where = member ? ` on ${scopeMembers.find((m) => m.id === member)?.name ?? member}` : hasFleet ? ' on the hub' : ''
      addToast({
        type: 'info',
        message: stack ? `Starting the backup of "${stack}"${where}…` : `Starting a full backup${where}…`,
        duration: 2500,
      })
      try {
        const result = await triggerBackupScoped(member, stack || undefined)
        if (result.success) {
          addToast({
            type: 'success',
            message: result.message || `Backup "${result.filename}" started${where}`,
          })
          // the status card follows the server the backup runs on
          if (scope === 'all') setWatchMember(member)
          refreshBackups()
          refreshStatus()
        } else {
          addToast({
            type: 'error',
            message: result.message || 'Could not start the backup',
            duration: 6000,
          })
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addToast({ type: 'error', message: `The backup failed: ${message}`, duration: 6000 })
      } finally {
        setTriggerLoading(false)
      }
    },
    [addToast, refreshBackups, refreshStatus, scope, scopeMembers, hasFleet],
  )

  /** Everywhere: a full backup on the hub and on every VM that answers, at the same time */
  const handleBackupEverything = useCallback(async () => {
    const targets = fleetTargets(scopeMembers)
    const vms = targets.length - 1
    const ok = await confirm({
      title: 'Back up everything',
      message: `Start a full backup on the hub and on ${vms} VM${vms === 1 ? '' : 's'}? Each server writes its own archive to its own BACKUP_DEST_DIR; a VM that is not configured for backups reports that and the others carry on.`,
      confirmLabel: 'Start everywhere',
    })
    if (!ok) return
    setTriggerLoading(true)
    setFleetRun(null)
    try {
      const outcomes = await fanOut(targets, (m) => triggerBackupScoped(m))
      // a server that answered but refused (not configured) counts as a failure too
      const graded = outcomes.map((o) => (o.ok && o.value && o.value.success === false ? { ...o, ok: false, error: o.value.message || 'refused' } : o))
      setFleetRun(graded)
      const summary = summarizeOutcomes(graded, 'Backup started')
      addToast({ type: summary.ok ? 'success' : 'error', message: summary.message, duration: summary.ok ? 5000 : 9000 })
      setWatchMember(null)
      refreshBackups()
      refreshStatus()
    } finally {
      setTriggerLoading(false)
    }
  }, [scopeMembers, confirm, addToast, refreshBackups, refreshStatus])

  const handleCancelBackup = useCallback(async () => {
    setCancelling(true)
    try {
      const result = await cancelBackupScoped(statusMember)
      addToast({ type: result.success ? 'info' : 'error', message: result.message })
      refreshStatus()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Could not cancel the backup' })
    } finally {
      setCancelling(false)
    }
  }, [addToast, refreshStatus, statusMember])

  const handleRestore = useCallback(async () => {
    if (!restoreTarget) return
    // the archive's own server: a fleet row says so, a single server's list is the scope's
    const member = restoreTarget.member !== undefined ? restoreTarget.member : scopeMember
    setRestoreLoading(true)
    addToast({
      type: 'info',
      message: `Restoring from "${restoreTarget.filename}"…`,
      duration: 3000,
    })
    try {
      const result = await restoreBackupScoped(member, restoreTarget.filename)
      if (result.success) {
        addToast({
          type: 'success',
          message: result.message || `Restore from "${restoreTarget.filename}" completed`,
        })
      } else {
        addToast({
          type: 'error',
          message: result.message || 'The restore failed',
          duration: 6000,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      addToast({ type: 'error', message: `The restore failed: ${message}`, duration: 6000 })
    } finally {
      setRestoreLoading(false)
      setRestoreTarget(null)
      refreshBackups()
    }
  }, [restoreTarget, addToast, refreshBackups, scopeMember])

  const backups: FleetBackupEntry[] = backupsData?.backups ?? []
  const fleetMembers = backupsData?.members ?? []
  const silentMembers = fleetMembers.filter((m) => m.id !== null && !m.reachable)
  const status = statusData?.status ?? 'idle'
  const isConfigured = configData?.configured ?? true
  const busy = status === 'running' || status === 'restoring'
  const selected = selectedStack ? parseStackKey(selectedStack) : null
  const selectedChoice = selected ? visibleStacks.find((s) => s.name === selected.name && s.member === selected.member) ?? null : null
  const configName = configMember ? (scopeMembers.find((m) => m.id === configMember)?.name ?? configMember) : ''
  const configVmid = configMember ? (scopeMembers.find((m) => m.id === configMember)?.vmid ?? null) : null

  // ---- Not connected ----
  if (!isConnected) {
    return (
      <LoadingState label="Waiting for the server connection…" hint="Make sure the DCS Orchestrator API is running" />
    )
  }

  const dot = (c: string) => <span className={`w-1.5 h-1.5 rounded-full ${c}`} />
  const closeRestore = () => { setRestoreTarget(null) }

  return (
    <div className="space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="backup"
        badge={scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        subtitle={hasFleet
          ? scope === 'all' ? 'Every server\'s archives; a backup runs where the stack lives' : scopeMember ? `Archives, backups and restores on the VM ${memberName}` : 'The hub\'s own archives, backups and restores'
          : undefined}
        actions={<>
          <Hint label={showGuide ? 'Hide the guide' : 'Show the guide'}>
            <button
              type="button"
              aria-label="Guide"
              aria-expanded={showGuide}
              onClick={() => setShowGuide(!showGuide)}
              className={`${BTN_TOOLBAR} ${showGuide ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <BookOpen size={14} />
              <span className="hidden sm:inline">Guide</span>
            </button>
          </Hint>
          <button
            type="button"
            aria-label="Refresh"
            onClick={() => { refreshBackups(); refreshStatus(); refreshConfig() }}
            disabled={backupsLoading}
            className={BTN_TOOLBAR_QUIET}
          >
            <RotateCcw size={14} className={backupsLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={backupsLoading && !!backupsData} />}
      </PageHeader>

      {/* Backup guide */}
      {showGuide && (
        <section aria-label={`${pageLabel('backup')} guide`} className="glass rounded-xl border border-white/5 overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-200">{pageLabel('backup')} guide</h2>
            </div>
            <Hint label="Close the guide">
              <button type="button" aria-label="Close the guide" onClick={() => setShowGuide(false)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                <X size={14} />
              </button>
            </Hint>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-400 mb-4">
              Backups create compressed archives of your DCS configuration. Use them to protect against accidental changes or migrate to a new server.
            </p>
            {BACKUP_GUIDE_SECTIONS.map((section, i) => {
              const isExpanded = expandedGuide === i
              const Icon = section.icon
              return (
                <div key={section.title} className="border border-white/[0.03] rounded-lg overflow-hidden">
                  <button
                    type="button"
                    aria-expanded={isExpanded}
                    onClick={() => setExpandedGuide(isExpanded ? null : i)}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
                  >
                    <Icon size={14} className="text-slate-400 shrink-0" aria-hidden />
                    <span className="text-sm font-medium text-slate-200 flex-1">{section.title}</span>
                    {isExpanded
                      ? <ChevronDown size={14} className="text-slate-500" aria-hidden />
                      : <ChevronRight size={14} className="text-slate-500" aria-hidden />
                    }
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 animate-fade-in">
                      <pre className="bg-slate-950/60 border border-white/[0.03] rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto scrollbar-thin whitespace-pre leading-relaxed">
                        {section.content}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </section>
      )}

      {/* ================================================================= */}
      {/* Backup status                                                     */}
      {/* ================================================================= */}
      <section aria-labelledby="backup-status-title" className="glass rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center gap-2">
          <Shield size={16} className="text-slate-400" aria-hidden />
          <h2 id="backup-status-title" className="text-sm font-semibold text-slate-200">Backup status</h2>
          {hasFleet && <VmCapsule member={statusMember} name={statusName} vmid={statusVmid} size="xs" />}
          {hasFleet && scope === 'all' && (
            <div className="ml-auto flex items-center gap-1.5">
              <label htmlFor="backup-follow" className="text-[10px] uppercase tracking-wider text-slate-500 hidden sm:inline">Follow</label>
              <Hint label="Whose progress the status card shows">
                <select
                  id="backup-follow"
                  aria-label="Follow the progress of"
                  value={statusMember ?? ''}
                  onChange={(e) => setWatchMember(e.target.value || null)}
                  className="rounded-lg px-2 h-8 text-[11px] bg-white/5 border border-white/10 text-slate-300 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40 cursor-pointer"
                >
                  <option value="" className="bg-slate-900">Hub</option>
                  {scopeMembers.map((m) => (
                    <option key={m.id} value={m.id} disabled={!m.reachable} className="bg-slate-900">{vmLabel(m.name, m.vmid)}{m.reachable ? '' : ' (not answering)'}</option>
                  ))}
                </select>
              </Hint>
            </div>
          )}
        </div>

        <div className="p-5">
          {/* Idle */}
          {status === 'idle' && (
            <div className="flex items-center gap-4">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-emerald-500/10 shrink-0" aria-hidden>
                <CheckCircle size={24} className="text-emerald-400" />
              </div>
              <div className="flex-1 min-w-0">
                <Badge component="span" color="emerald" leftSection={dot('bg-emerald-400')}>Idle</Badge>
                {statusData?.last_backup ? (
                  <div className="mt-2 space-y-1">
                    <p className="text-sm text-slate-300">
                      Last backup:{' '}
                      <span className="font-mono text-xs text-slate-400 break-all">
                        {statusData.last_backup.filename}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      {statusData.last_backup.size} &middot;{' '}
                      {formatDateString(statusData.last_backup.timestamp)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-slate-500">No backups recorded yet</p>
                )}
              </div>
            </div>
          )}

          {/* Running */}
          {status === 'running' && (
            <div className="space-y-4" role="status">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-cyan-500/10 shrink-0" aria-hidden>
                  <Loader2 size={24} className="text-cyan-400 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <Badge component="span" color="cyan" leftSection={dot('bg-cyan-400 animate-pulse')}>Running</Badge>
                  {statusData?.filename && (
                    <p className="mt-1.5 text-slate-300 font-mono text-xs break-all">
                      {statusData.filename}
                    </p>
                  )}
                  {statusData?.progress && (
                    <p className="text-xs text-slate-500 mt-0.5">{statusData.progress}</p>
                  )}
                </div>
              </div>
              {/* Progress bar — real percentage when available, animated fallback */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-slate-500">{statusData?.stage === 'copy' ? 'Copying files' : statusData?.stage === 'archive' ? 'Creating archive' : statusData?.stage === 'cleanup' ? 'Cleaning up' : statusData?.stage === 'retention' ? 'Enforcing retention' : 'Processing'}</span>
                  <span className="text-[10px] font-mono text-cyan-400 tabular-nums">{statusData?.percent != null ? `${statusData.percent}%` : ''}</span>
                </div>
                <div className="relative h-2.5 rounded-full bg-slate-800 overflow-hidden">
                  {statusData?.percent != null ? (
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 shadow-lg shadow-cyan-500/20 transition-all duration-700 ease-out"
                      style={{ width: `${Math.max(statusData.percent, 2)}%` }}
                    />
                  ) : (
                    <div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-cyan-400 animate-pulse" style={{ width: '45%' }} />
                  )}
                </div>
                <button type="button" onClick={handleCancelBackup} disabled={cancelling} className={`${BTN_CARD} ${TONE_DANGER} mt-1`}>
                  {cancelling ? <Loader2 size={12} className="animate-spin" /> : <XCircle size={12} />}
                  Cancel backup
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {status === 'error' && (
            <div className="flex items-center gap-4" role="alert">
              <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-rose-500/10 shrink-0" aria-hidden>
                <AlertTriangle size={24} className="text-rose-400" />
              </div>
              <div className="flex-1 min-w-0">
                <Badge component="span" color="rose" leftSection={dot('bg-rose-400')}>Error</Badge>
                <p className="mt-2 text-sm text-rose-300">
                  {statusData?.error || 'An error occurred during the last backup'}
                </p>
                {(statusData?.warnings?.length ?? 0) > 0 && (
                  <ul className="mt-2 space-y-1 text-xs text-amber-200/90 max-h-40 overflow-y-auto">
                    {statusData!.warnings!.slice(0, 50).map((w, i) => <li key={i} className="font-mono break-all">{w}</li>)}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Restoring */}
          {status === 'restoring' && (
            <div className="space-y-4" role="status">
              <div className="flex items-center gap-4">
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-amber-500/10 shrink-0" aria-hidden>
                  <RotateCcw size={24} className="text-amber-400 animate-spin" />
                </div>
                <div className="flex-1 min-w-0">
                  <Badge component="span" color="amber" leftSection={dot('bg-amber-400 animate-pulse')}>Restoring</Badge>
                  {statusData?.filename && (
                    <p className="mt-1.5 text-slate-300 font-mono text-xs break-all">
                      {statusData.filename}
                    </p>
                  )}
                  {statusData?.progress && (
                    <p className="text-xs text-slate-500 mt-0.5">{statusData.progress}</p>
                  )}
                </div>
              </div>
              <div className="relative h-2 rounded-full bg-slate-800 overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-amber-500 to-amber-400 animate-pulse" style={{ width: '45%' }} />
              </div>
            </div>
          )}

          {/* Loading placeholder: the shape of the idle line */}
          {statusLoading && !statusData && (
            <div className="flex items-center gap-4" role="status" aria-label="Reading the backup status">
              <div className="skeleton w-12 h-12 rounded-xl shrink-0" aria-hidden />
              <div className="flex-1 space-y-2" aria-hidden>
                <div className="skeleton h-[18px] w-16 rounded-full" />
                <div className="skeleton h-3.5 w-2/3 rounded" />
                <div className="skeleton h-3 w-1/3 rounded" />
              </div>
            </div>
          )}

          {/* the last "back up everything": one line per server */}
          {fleetRun && scope === 'all' && (
            <div className="mt-4 pt-4 border-t border-white/5">
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-[10px] text-slate-500 uppercase tracking-wider">Back up everything · {fleetRun.filter((o) => o.ok).length} of {fleetRun.length} started</p>
                <button type="button" onClick={() => setFleetRun(null)} className={`${BTN_CARD} ${TONE_GHOST}`}>Dismiss</button>
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {fleetRun.map((o) => (
                  <li key={o.id ?? 'hub'} className="flex items-center gap-1.5 text-[11px]" title={o.ok ? o.value?.filename ?? 'started' : o.error ?? 'failed'}>
                    <VmCapsule member={o.id} name={o.name} vmid={o.vmid} size="xs" onClick={() => setWatchMember(o.id)} />
                    {o.ok ? <CheckCircle size={11} className="text-emerald-400" aria-label="started" /> : <XCircle size={11} className="text-rose-400" aria-label="failed" />}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>

      {/* ================================================================= */}
      {/* Recovery bundle: the hub's own (a VM's is on its own dashboard)    */}
      {/* ================================================================= */}
      {!scopeMember && <RecoveryBundleCard />}

      {/* ================================================================= */}
      {/* Start a backup                                                    */}
      {/* ================================================================= */}
      <section aria-labelledby="backup-start-title" className="glass rounded-xl border border-white/5 overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center gap-2">
          <Play size={16} className="text-slate-400" aria-hidden />
          <h2 id="backup-start-title" className="text-sm font-semibold text-slate-200">Start a backup</h2>
          {hasFleet && <VmCapsule member={configMember} name={configName} vmid={configVmid} size="xs" />}
        </div>

        <div className="p-5">
          {!isConfigured && (
            <div className="flex items-start gap-3 rounded-lg bg-amber-500/10 border border-amber-500/20 p-4 mb-5">
              <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-300">Backup not configured{hasFleet ? (configMember ? ` on the VM ${configName}` : ' on the hub') : ''}</p>
                <p className="text-xs text-amber-400/70 mt-1">
                  Set <code className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded">BACKUP_DEST_DIR</code> in {configMember ? 'that VM\'s' : 'the server\'s'} <code className="font-mono bg-amber-500/10 px-1.5 py-0.5 rounded">.env</code> file (the {pageLabel('environment')} page) to enable backups there.
                </p>
              </div>
            </div>
          )}

          {/* Config summary */}
          {configData && isConfigured && (
            <div className="mb-5">
              <div className={`grid grid-cols-1 gap-3 ${(configData.appdata_dirs?.length ?? 0) > 0 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'sm:grid-cols-3'}`}>
                <div className="glass border border-white/5 rounded-lg p-3">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Destination</p>
                  <p className="mt-1 text-xs font-mono text-slate-300 truncate" title={configData.destination}>
                    {configData.destination || 'N/A'}
                  </p>
                </div>
                <div className="glass border border-white/5 rounded-lg p-3">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Source</p>
                  <p className="mt-1 text-xs font-mono text-slate-300 truncate" title={configData.source}>
                    {configData.source || 'N/A'}
                  </p>
                </div>
                <div className="glass border border-white/5 rounded-lg p-3">
                  <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Retention</p>
                  <p className="mt-1 text-xs font-mono text-slate-300">
                    {configData.retention_count} backup{configData.retention_count !== 1 ? 's' : ''}
                  </p>
                </div>
                {/* App-Data on drives of their own: parts of their own in every backup */}
                {(configData.appdata_dirs?.length ?? 0) > 0 && (
                  <div className="glass border border-white/5 rounded-lg p-3 min-w-0">
                    <p className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">App-Data on drives</p>
                    <ul className="mt-1 space-y-0.5">
                      {configData.appdata_dirs!.map((d) => (
                        <li key={d.stack} className="text-xs font-mono truncate" title={d.ok ? `${d.stack}: ${d.path}` : `${d.path} is not there (drive not mounted?): a backup leaves it out until it is back`}>
                          <span className="text-slate-400">{d.stack}</span>{' '}
                          <span className={d.ok ? 'text-slate-300' : 'text-amber-300'}>{d.path}</span>
                          {!d.ok && <span className="text-amber-300"> · not mounted</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
              {hasFleet && scope === 'all' && (
                <p className="mt-2 text-[11px] text-slate-500 flex items-start gap-1.5">
                  <Info size={12} className="mt-0.5 shrink-0 text-slate-500" />
                  <span>These are the hub&apos;s settings. Every VM keeps its own destination and retention: pick a VM chip above to see and use them.</span>
                </p>
              )}
            </div>
          )}

          {/* Action row */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            {/* Full backup: this server, or on Everywhere the hub and every VM */}
            {scope === 'all' ? (
              <Hint label="A full backup on the hub and on every VM that answers, started at the same time">
                <span className="inline-flex sm:shrink-0">
                  <button type="button" onClick={handleBackupEverything} disabled={triggerLoading || busy} className={`${BTN_SHEET_PRIMARY} w-full sm:w-auto`}>
                    {triggerLoading ? <Loader2 size={16} className="animate-spin" /> : <Boxes size={16} />}
                    Back up everything
                  </button>
                </span>
              </Hint>
            ) : (
              <button
                type="button"
                onClick={() => handleTriggerBackup(scopeMember)}
                disabled={triggerLoading || busy || !isConfigured}
                className={`${BTN_SHEET_PRIMARY} sm:shrink-0`}
              >
                {triggerLoading ? <Loader2 size={16} className="animate-spin" /> : <Archive size={16} />}
                Full backup{scopeMember ? ` of ${memberName}` : ''}
              </button>
            )}

            {/* Stack selector: where each stack lives is part of the choice */}
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 flex-1 min-w-0">
              <select
                aria-label="Stack to back up"
                value={selectedStack}
                onChange={(e) => setSelectedStack(e.target.value)}
                disabled={!isConfigured && scope !== 'all'}
                className="flex-1 min-w-0 h-11 rounded-xl px-3 text-sm bg-white/5 border border-white/10 text-slate-200 transition-colors focus:outline-none focus-visible:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <option value="" className="bg-slate-900 text-slate-400">
                  {visibleStacks.length === 0 ? 'No stacks here' : 'Select a stack for a targeted backup…'}
                </option>
                {hasFleet ? stackGroups.map((g) => (
                  <optgroup key={g.key || 'hub'} label={g.label} className="bg-slate-900 text-slate-400">
                    {g.stacks.map((s) => (
                      <option key={stackKey(s.member, s.name)} value={stackKey(s.member, s.name)} disabled={!s.reachable} className="bg-slate-900 text-slate-200">
                        {s.name}{s.member ? ` — ${vmLabel(s.member_name, s.vmid)}` : scope === 'all' ? ' — Hub' : ''}{s.reachable ? '' : ' (not answering)'}
                      </option>
                    ))}
                  </optgroup>
                )) : visibleStacks.map((s) => (
                  <option key={s.name} value={stackKey(null, s.name)} className="bg-slate-900 text-slate-200">
                    {s.name}
                  </option>
                ))}
              </select>
              <Hint label={selectedChoice?.member ? `Runs on ${vmLabel(selectedChoice.member_name, selectedChoice.vmid)}` : selectedChoice && hasFleet ? 'Runs on the hub' : undefined}>
                <span className="inline-flex sm:shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      if (selectedChoice) handleTriggerBackup(selectedChoice.member, selectedChoice.name)
                    }}
                    disabled={!selectedChoice || !selectedChoice.reachable || triggerLoading || busy}
                    className={`${BTN_SHEET_QUIET} w-full sm:w-auto`}
                  >
                    <Download size={15} />
                    Back up stack
                  </button>
                </span>
              </Hint>
            </div>
          </div>
          {selectedChoice && hasFleet && (
            <p className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
              <span>Runs where the stack lives:</span>
              <VmCapsule member={selectedChoice.member} name={selectedChoice.member_name} vmid={selectedChoice.vmid} size="xs" />
            </p>
          )}
        </div>
      </section>

      {/* ================================================================= */}
      {/* Backup archives                                                   */}
      {/* ================================================================= */}
      <section aria-labelledby="backup-archives-title" className="glass border border-white/5 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <HardDrive size={16} className="text-slate-400" aria-hidden />
            <h2 id="backup-archives-title" className="text-sm font-semibold text-slate-200">Backup archives</h2>
            <span className="text-xs font-normal text-slate-500 tabular-nums">({backups.length})</span>
          </div>
          {backupsData?.fleet && (
            <p className="text-[11px] text-slate-500">
              the hub and {Math.max(fleetMembers.length - 1, 0)} VM{fleetMembers.length - 1 === 1 ? '' : 's'}
              {silentMembers.length > 0 && <span className="text-amber-300/80"> · {silentMembers.length} not answering ({silentMembers.map((m) => m.name).join(', ')})</span>}
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                <th scope="col" className={`${TH} text-left`}>Filename</th>
                <th scope="col" className={`${TH} text-left`}>Size</th>
                <th scope="col" className={`${TH} text-left`}>Date</th>
                <th scope="col" className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.03] stagger-children">
              {backups.length === 0 && !backupsLoading && (
                <tr>
                  <td colSpan={4}>
                    <EmptyState
                      compact
                      icon={<Archive size={32} />}
                      title={`No backup archives found${scopeMember ? ` on the VM ${memberName}` : ''}`}
                      hint="Start a backup above to create your first archive"
                    />
                  </td>
                </tr>
              )}
              {backupsLoading && backups.length === 0 && [0, 1, 2].map((i) => (
                <tr key={`sk-${i}`} aria-hidden>
                  <td className="px-5 py-3"><div className="skeleton h-3.5 w-56 max-w-full rounded" /></td>
                  <td className="px-5 py-3"><div className="skeleton h-3.5 w-14 rounded" /></td>
                  <td className="px-5 py-3"><div className="skeleton h-3.5 w-32 rounded" /></td>
                  <td className="px-5 py-3 text-right"><div className="skeleton h-8 w-20 rounded-lg ml-auto" /></td>
                </tr>
              ))}
              {backups.map((backup) => {
                const onVm = !!(backup.member ?? scopeMember)
                return (
                  <tr
                    key={backupKey(backup)}
                    className="hover:bg-white/[0.03] transition-colors duration-150"
                  >
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Archive
                          size={14}
                          className="text-slate-500 shrink-0"
                          aria-hidden
                        />
                        <span className="font-mono text-xs text-slate-200 truncate max-w-[200px] md:max-w-[320px]" title={backup.filename}>
                          {backup.filename}
                        </span>
                        {backup.member !== undefined && <VmCapsule member={backup.member} name={backup.member_name} vmid={backup.vmid} size="xs" onClick={() => setScope(backup.member ?? 'hub')} />}
                        {backup.kind === 'stack' && backup.stack && <Badge component="span" color="slate" title="A backup of one stack">{backup.stack}</Badge>}
                        {backup.complete === false && <Badge component="span" color="amber" title="Something could not be read when it was made: the status above (or its manifest) says what">incomplete</Badge>}
                        {backup.verified && <span className="inline-flex items-center text-emerald-400/80" title="Read back to the end when it was made; a checksum (.sha256) is beside it"><ShieldCheck size={12} aria-label="checked" /></span>}
                      </div>
                      {onVm && (
                        <p className="mt-1 text-[10px] text-slate-500 flex items-center gap-1" title="The hub's proxy carries JSON, not files: copy the archive over ssh from that VM's BACKUP_DEST_DIR">
                          <Info size={10} /> stays on the VM&apos;s disk
                        </p>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <span className="text-xs text-slate-400">{backup.size}</span>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5 text-xs text-slate-400 whitespace-nowrap">
                        <Clock size={12} className="text-slate-500" aria-hidden />
                        {formatTimestamp(backup.timestamp)}
                      </div>
                    </td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <Hint label="Read it to the end against its checksum and its list of parts, without restoring anything">
                        <span className="inline-flex mr-2">
                          <button
                            type="button"
                            disabled={verifying === backupKey(backup)}
                            onClick={async () => {
                              setVerifying(backupKey(backup))
                              try {
                                const r = await verifyBackupScoped(backup.member ?? scopeMember ?? null, backup.filename)
                                addToast(r.ok
                                  ? { type: 'success', message: `${backup.filename} is sound: ${r.parts ? `${r.parts} parts, ` : ''}${r.checksum_checked ? 'checksum matches' : 'read to the end (it has no checksum)'}` }
                                  : { type: 'error', message: `${backup.filename}: ${r.error ?? 'it does not read back'}` })
                              } catch (e) {
                                addToast({ type: 'error', message: e instanceof Error ? e.message : 'The check failed' })
                              } finally { setVerifying('') }
                            }}
                            aria-label={`Check ${backup.filename}`}
                            className={`${BTN_CARD} ${TONE_QUIET}`}
                          >
                            <ShieldCheck size={12} className={verifying === backupKey(backup) ? 'animate-pulse' : ''} />
                            Verify
                          </button>
                        </span>
                      </Hint>
                      <Hint label={onVm ? `Restores on ${backup.member_name ?? memberName}` : hasFleet ? 'Restores on the hub' : 'Restore this backup'}>
                        <span className="inline-flex">
                          <button
                            type="button"
                            onClick={() => {
                              setRestoreTarget(backup)
                            }}
                            disabled={busy && (backup.member ?? null) === statusMember}
                            aria-label={`Restore ${backup.filename}`}
                            className={`${BTN_CARD} ${TONE_DANGER}`}
                          >
                            <RotateCcw size={12} />
                            Restore
                          </button>
                        </span>
                      </Hint>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ================================================================= */}
      {/* Restore confirmation                                              */}
      {/* ================================================================= */}
      {restoreTarget && (
        <TypedConfirmDialog
          title="Confirm restore"
          word="RESTORE"
          confirmLabel="Restore backup"
          warning={<>The stacks it holds are stopped and their files and volumes go back to this backup{hasFleet ? (restoreTarget.member ?? scopeMember) ? ` on the VM ${restoreTarget.member_name ?? memberName}` : ' on the hub' : ''}; they start again afterwards.</>}
          detail="What is there now is set aside first (.data/pre-restore, the newest two are kept), so it can be put back by hand. The archive is checked before anything is touched."
          subjectLabel="Restoring from"
          subject={<>
            <div className="flex items-center gap-2 flex-wrap">
              <Archive size={14} className="text-slate-400 shrink-0" aria-hidden />
              <span className="font-mono text-xs text-slate-200 break-all">{restoreTarget.filename}</span>
              {hasFleet && <VmCapsule member={restoreTarget.member ?? scopeMember} name={restoreTarget.member_name ?? (scopeMember ? memberName : undefined)} vmid={restoreTarget.vmid ?? (scopeMember ? scopeMembers.find((m) => m.id === scopeMember)?.vmid : null)} size="xs" />}
            </div>
            <p className="text-xs text-slate-500 mt-1">{restoreTarget.size} &middot; {formatTimestamp(restoreTarget.timestamp)}</p>
          </>}
          busy={restoreLoading}
          onConfirm={handleRestore}
          onClose={closeRestore}
        />
      )}
    </div>
  )
}
