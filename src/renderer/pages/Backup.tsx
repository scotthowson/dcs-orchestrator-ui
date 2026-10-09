// =============================================================================
// Backups — save the servers and bring them back, with the two kinds of saved copy
// kept apart: a backup has the data (stacks, App-Data, volumes, the install's state;
// minutes), a config snapshot only settings and stack files (seconds). Then the
// status of the running backup, "Make a copy" (everything, one stack, a snapshot, a
// recovery bundle), and "Saved copies" with a Backups | Snapshots switch, where an
// archive downloads and an archive kept elsewhere is uploaded.
// On a hub: Everywhere lists every server's copies, a stack is backed up where it
// lives (the hub or its VM), a restore acts on the server that keeps the file.
// The old Snapshots page opens here on the Snapshots view ({ view: 'snapshots' }).
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { SegmentedControl } from '@mantine/core'
import { Archive, BookOpen, Camera, HardDrive, RotateCcw } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { LoadingState } from '../components/common/PageState'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_QUIET } from '../lib/ui'
import { fetchStacks, fetchSnapshots, fetchBackupStatus, triggerBackup } from '../api/endpoints'
import {
  fetchBackupsScoped,
  fetchBackupConfigScoped,
  cancelBackupScoped,
  fleetTargets,
  fanOut,
  summarizeOutcomes,
} from '../api/fleetScopedOps'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import BackupsGuide from '../components/backup/BackupsGuide'
import BackupStatusPanel from '../components/backup/BackupStatusPanel'
import MakeCopy from '../components/backup/MakeCopy'
import BackupArchiveTable from '../components/backup/BackupArchiveTable'
import SnapshotList from '../components/backup/SnapshotList'
import UploadBackup from '../components/backup/UploadBackup'
import { useAuthStore } from '../stores/authStore'
import type { BackupStatusResponse, BackupConfigResponse, BackupTriggerResponse, FleetListMember, SnapshotListResponse } from '../../shared/types'
import type { FleetBackupListResponse, BackupStackChoice, MemberOutcome } from '../../shared/fleetScopedOps'

/** which list "Saved copies" shows: remembered on this device */
type View = 'backups' | 'snapshots'
const VIEW_KEY = 'dcs-backups-view'
function loadView(): View { try { return localStorage.getItem(VIEW_KEY) === 'snapshots' ? 'snapshots' : 'backups' } catch { return 'backups' } }
function saveView(v: View) { try { localStorage.setItem(VIEW_KEY, v) } catch { /* storage unavailable */ } }

/** "the hub and 2 VMs · 1 not answering (media)" over a merged list */
function FleetNote({ members }: { members: FleetListMember[] }) {
  const vms = Math.max(members.length - 1, 0)
  const silent = members.filter((m) => m.id !== null && !m.reachable)
  return (
    <p className="text-[11px] text-slate-500">
      the hub and {vms} VM{vms === 1 ? '' : 's'}
      {silent.length > 0 && <span className="text-amber-300/80"> · {silent.length} not answering ({silent.map((m) => m.name).join(', ')})</span>}
    </p>
  )
}

export default function Backup() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'

  const [showGuide, setShowGuide] = useState(false)
  const [triggerLoading, setTriggerLoading] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [stackChoices, setStackChoices] = useState<BackupStackChoice[]>([])
  // Everywhere: the server whose progress the status card follows (the last one a backup was started on)
  const [watchMember, setWatchMember] = useState<string | null>(null)
  // the last "back up everything": what every server answered
  const [fleetRun, setFleetRun] = useState<MemberOutcome<BackupTriggerResponse>[] | null>(null)

  // ---- Saved copies: Backups | Snapshots ----
  const [view, setView] = useState<View>(loadView)
  const changeView = useCallback((v: View) => { setView(v); saveView(v) }, [])
  const listRef = useRef<HTMLElement>(null)
  // a link to a view also brings its list into sight, once what is above it has loaded
  const scrollToList = useRef(false)
  // the old Snapshots page (and any link with { view }) lands on its list
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  useEffect(() => {
    const p = useSettingsStore.getState().navigationPayload
    if (p && (p.view === 'snapshots' || p.view === 'backups')) {
      changeView(p.view)
      useSettingsStore.getState().consumeNavigationPayload()
      scrollToList.current = true
    }
  }, [navigationPayload, changeView])

  // ---- Which server the status and the settings talk about ----
  const watchStillThere = watchMember === null || scopeMembers.some((m) => m.id === watchMember)
  const statusMember: string | null = scope === 'all' ? (watchStillThere ? watchMember : null) : scopeMember
  // the settings show one server's: on Everywhere the hub's, with a note
  const configMember: string | null = scope === 'all' ? null : scopeMember

  // ---- Polling ----
  const fetchScopedStatus = useCallback(() => fetchBackupStatus(statusMember), [statusMember])
  const { data: statusData, loading: statusLoading, refresh: refreshStatus } =
    usePolling<BackupStatusResponse>(fetchScopedStatus, 5000)
  const statusRef = useRef(statusMember)
  useEffect(() => { if (statusRef.current !== statusMember) { statusRef.current = statusMember; refreshStatus() } }, [statusMember, refreshStatus])
  // a restore runs in the background: when it ends with a stack it could not stop (left as it was), that is said at once,
  // not only on the status card
  const lastStatus = useRef<{ member: string | null; status: string } | null>(null)
  useEffect(() => {
    if (!statusData) return
    const prev = lastStatus.current
    lastStatus.current = { member: statusMember, status: statusData.status }
    if (!prev || prev.member !== statusMember || prev.status !== 'restoring' || statusData.status === 'restoring') return
    const skipped = statusData.last_restore?.skipped ?? []
    if (skipped.length > 0) {
      addToast({ type: 'error', duration: 20000, message: statusData.last_restore?.message || `${skipped.map((x) => x.stack).join(', ')} not restored: the containers did not stop` })
    }
  }, [statusData, statusMember, addToast])

  const fetchScopedBackups = useCallback(() => fetchBackupsScoped(scope), [scope])
  const { data: backupsData, loading: backupsLoading, refresh: refreshBackups } =
    usePolling<FleetBackupListResponse>(fetchScopedBackups, 15000)

  const fetchScopedConfig = useCallback(() => fetchBackupConfigScoped(configMember), [configMember])
  const { data: configData, refresh: refreshConfig } =
    usePolling<BackupConfigResponse>(fetchScopedConfig, 30000)
  const configRef = useRef(configMember)
  useEffect(() => { if (configRef.current !== configMember) { configRef.current = configMember; refreshConfig() } }, [configMember, refreshConfig])

  // the snapshot list is polled only while it shows; otherwise it is read once (for its count) and after a change
  const fetchScopedSnapshots = useCallback(() => fetchSnapshots(scope), [scope])
  const { data: snapshotsData, loading: snapshotsLoading, refresh: refreshSnapshots } =
    usePolling<SnapshotListResponse>(fetchScopedSnapshots, 15000, { enabled: view === 'snapshots' })
  const snapCounted = useRef(view === 'snapshots')
  useEffect(() => {
    if (isConnected && view === 'backups' && !snapCounted.current) { snapCounted.current = true; refreshSnapshots() }
  }, [isConnected, view, refreshSnapshots])

  // a new scope: both lists again (the snapshots once, when they are not the view that polls)
  const scopeRef = useRef(scope)
  useEffect(() => {
    if (scopeRef.current === scope) return
    scopeRef.current = scope
    refreshBackups()
    refreshSnapshots()
  }, [scope, refreshBackups, refreshSnapshots])

  const listReady = !!statusData && !!(view === 'backups' ? backupsData : snapshotsData)
  useEffect(() => {
    if (!scrollToList.current || !listReady) return
    scrollToList.current = false
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'start' }))
  }, [listReady])

  // ---- The stacks one can back up: the hub's first, then each VM's (a hub's /stacks lists them all) ----
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

  // ---- Handlers ----
  const handleTriggerBackup = useCallback(async (member: string | null, stack?: string) => {
    setTriggerLoading(true)
    const where = member ? ` on ${scopeMembers.find((m) => m.id === member)?.name ?? member}` : hasFleet ? ' on the hub' : ''
    addToast({ type: 'info', message: stack ? `Starting the backup of "${stack}"${where}…` : `Starting a full backup${where}…`, duration: 2500 })
    try {
      const result = await triggerBackup(stack || undefined, member)
      if (result.success) {
        addToast({ type: 'success', message: result.message || `Backup "${result.filename}" started${where}` })
        // the status card follows the server the backup runs on
        if (scope === 'all') setWatchMember(member)
        changeView('backups')
        refreshBackups()
        refreshStatus()
      } else {
        addToast({ type: 'error', message: result.message || 'Could not start the backup', duration: 6000 })
      }
    } catch (err) {
      addToast({ type: 'error', message: `The backup failed: ${err instanceof Error ? err.message : String(err)}`, duration: 6000 })
    } finally {
      setTriggerLoading(false)
    }
  }, [addToast, refreshBackups, refreshStatus, scope, scopeMembers, hasFleet, changeView])

  /** Everywhere: a full backup on the hub and on every VM that answers, at the same time */
  const handleBackupEverything = useCallback(async () => {
    const targets = fleetTargets(scopeMembers)
    const vms = targets.length - 1
    const ok = await confirm({
      title: 'Back up everything?',
      message: `Start a full backup on the hub and on ${vms} VM${vms === 1 ? '' : 's'}? Each server writes its own archive to its own BACKUP_DEST_DIR; a VM that is not configured for backups reports that and the others carry on.`,
      confirmLabel: 'Start everywhere',
    })
    if (!ok) return
    setTriggerLoading(true)
    setFleetRun(null)
    try {
      const outcomes = await fanOut(targets, (m) => triggerBackup(undefined, m))
      // a server that answered but refused (not configured) counts as a failure too
      const graded = outcomes.map((o) => (o.ok && o.value && o.value.success === false ? { ...o, ok: false, error: o.value.message || 'refused' } : o))
      setFleetRun(graded)
      const summary = summarizeOutcomes(graded, 'Backup started')
      addToast({ type: summary.ok ? 'success' : 'error', message: summary.message, duration: summary.ok ? 5000 : 9000 })
      setWatchMember(null)
      changeView('backups')
      refreshBackups()
      refreshStatus()
    } finally {
      setTriggerLoading(false)
    }
  }, [scopeMembers, confirm, addToast, refreshBackups, refreshStatus, changeView])

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

  const onSnapshotTaken = useCallback(() => { changeView('snapshots'); refreshSnapshots() }, [changeView, refreshSnapshots])
  const onBackupRestored = useCallback(() => { refreshBackups(); refreshStatus() }, [refreshBackups, refreshStatus])

  // ---- Not connected ----
  if (!isConnected) {
    return <LoadingState label="Waiting for the server connection…" hint="Make sure the DCS Orchestrator API is running" />
  }

  const backups = backupsData?.backups ?? []
  const snapshots = snapshotsData?.snapshots ?? []
  const status = statusData?.status ?? 'idle'
  const busy = status === 'running' || status === 'restoring'
  const listLoading = view === 'backups' ? backupsLoading : snapshotsLoading
  const listMembers = (view === 'backups' ? (backupsData?.fleet ? backupsData.members : undefined) : (snapshotsData?.fleet ? snapshotsData.members : undefined)) ?? null
  const count = (n: number | undefined) => <span className="tabular-nums text-slate-500 ml-1">{n ?? '…'}</span>

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="backup"
        badge={scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        subtitle={hasFleet
          ? scope === 'all' ? 'Every server\'s backups and snapshots; a backup runs where the stack lives' : scopeMember ? `Backups, snapshots and restores on the VM ${memberName}` : 'The hub\'s own backups, snapshots and restores'
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
            onClick={() => { refreshBackups(); refreshStatus(); refreshConfig(); refreshSnapshots() }}
            disabled={listLoading}
            className={BTN_TOOLBAR_QUIET}
          >
            <RotateCcw size={14} className={listLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={listLoading && !!(view === 'backups' ? backupsData : snapshotsData)} />}
      </PageHeader>

      {showGuide && <BackupsGuide onClose={() => setShowGuide(false)} />}

      <BackupStatusPanel
        data={statusData}
        loading={statusLoading}
        hasFleet={hasFleet}
        everywhere={scope === 'all'}
        member={statusMember}
        members={scopeMembers}
        onFollow={setWatchMember}
        onCancel={handleCancelBackup}
        cancelling={cancelling}
        fleetRun={fleetRun}
        onDismissFleetRun={() => setFleetRun(null)}
      />

      <MakeCopy
        scope={scope}
        scopeMember={scopeMember}
        memberName={memberName}
        members={scopeMembers}
        hasFleet={hasFleet}
        config={configData}
        configMember={configMember}
        stackChoices={stackChoices}
        triggerLoading={triggerLoading}
        busy={busy}
        onBackupEverything={handleBackupEverything}
        onBackup={handleTriggerBackup}
        onSnapshotTaken={onSnapshotTaken}
      />

      {/* ================================================================= */}
      {/* Saved copies: the backups (data) and the snapshots (settings)     */}
      {/* ================================================================= */}
      <section ref={listRef} aria-labelledby="saved-copies-title" className="surface overflow-hidden scroll-mt-4">
        <div className="px-5 py-4 border-b border-white/5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <div className="flex items-center gap-2 min-w-0">
            <HardDrive size={16} className="text-slate-400" aria-hidden />
            <h2 id="saved-copies-title" className="text-sm font-semibold text-slate-200">Saved copies</h2>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 min-w-0">
            {listMembers && <FleetNote members={listMembers} />}
            {view === 'backups' && isAdmin && (
              // an upload goes to the server the page shows: on Everywhere the hub
              <UploadBackup
                member={scopeMember}
                serverLabel={scopeMember ? `the VM ${memberName}` : hasFleet ? 'the hub' : 'this server'}
                limits={configData ? configData.upload : null}
                onUploaded={() => { refreshBackups(); refreshConfig() }}
              />
            )}
            <SegmentedControl
              aria-label="Kind of saved copy"
              size="xs"
              value={view}
              onChange={(v) => changeView(v as View)}
              data={[
                { value: 'backups', label: <span className="flex items-center gap-1.5"><Archive size={13} aria-hidden />Backups{count(backupsData ? backups.length : undefined)}</span> },
                { value: 'snapshots', label: <span className="flex items-center gap-1.5"><Camera size={13} aria-hidden />Snapshots{count(snapshotsData ? snapshots.length : undefined)}</span> },
              ]}
            />
          </div>
        </div>
        <p className="px-5 pt-3 text-[11px] text-slate-500">
          {view === 'backups'
            ? 'Backups hold the data: stacks with their App-Data and volumes (and, for a full one, the install\'s settings). A restore stops the stacks it brings back.'
            : 'Snapshots hold settings and stack files only, no data. A restore keeps the root .env and the accounts, and stops nothing.'}
        </p>

        {view === 'backups' ? (
          <BackupArchiveTable
            backups={backups}
            loading={backupsLoading}
            hasFleet={hasFleet}
            scopeMember={scopeMember}
            memberName={memberName}
            members={scopeMembers}
            onPickServer={setScope}
            lockedMember={statusMember}
            busy={busy}
            onRestored={onBackupRestored}
          />
        ) : (
          <SnapshotList
            snapshots={snapshots}
            loading={snapshotsLoading}
            hasFleet={hasFleet}
            scopeMember={scopeMember}
            memberName={memberName}
            onChanged={refreshSnapshots}
          />
        )}
      </section>
    </div>
  )
}
