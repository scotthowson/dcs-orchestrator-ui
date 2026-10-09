// =============================================================================
// Maintenance — Docker system maintenance, orphan detection, disk analysis
// On a hub: Everywhere adds the hub's and every VM's numbers up (each asked at
// the same time) and runs each action on all of them; Hub or a VM: that one.
// =============================================================================

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'
import { Badge } from '@mantine/core'
import {
  Wrench, RefreshCw, Loader2, Trash2, RotateCcw, AlertTriangle,
  CheckCircle2, Box, Image, HardDrive, Network, FileText, Scissors,
  BookOpen, ChevronRight, ChevronDown, X, Search, Boxes,
  Moon,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import {
  fetchFleetMaintenanceReport,
  fetchFleetOrphans,
  fetchFleetDisk,
  triggerDeepPruneScoped,
  triggerLogRotateScoped,
  runDockerPruneScoped,
  runImagePruneScoped,
  fleetTargets,
  fanOut,
  summarizeOutcomes,
  parseSizeBytes,
} from '../api/fleetScopedOps'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { useConnectionStore } from '../stores/connectionStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_ICON_SM, BTN_SHEET, BTN_SHEET_QUIET, BTN_SHEET_DANGER, TONE_OK, TONE_QUIET, TONE_DANGER, TONE_GHOST } from '../lib/ui'
import type { FleetTarget, MemberOutcome, FleetMaintenanceReport, FleetOrphanReport, FleetDiskAnalysis } from '../../shared/fleetScopedOps'
import { EmptyState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'

import { Pill } from '../components/common/Pill'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** a row key: the resource on its DCS (one server's rows share one member) */
const rowKey = (member: string | null, id: string) => `${member ?? ''}|${id}`

/** a column header of the tables (static) */
const TH = 'px-4 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400'

/** who answered and who did not, for the Everywhere strip */
function answered(members: MemberOutcome<unknown>[]): { ok: number; failed: MemberOutcome<unknown>[] } {
  return { ok: members.filter((m) => m.ok).length, failed: members.filter((m) => !m.ok) }
}

// ---------------------------------------------------------------------------
// Guide
// ---------------------------------------------------------------------------

const MAINTENANCE_GUIDE_SECTIONS = [
  {
    title: 'Safe prune',
    icon: Trash2,
    content: `Removes stopped containers and unused networks.
This is the safest cleanup option and won't
remove any images or volumes.

Command: docker system prune -f

Safe to run regularly — it only cleans up
resources that are already stopped or detached.`,
  },
  {
    title: 'Image prune',
    icon: Image,
    content: `Removes dangling images (untagged layers left
over from builds and updates).

Standard:   docker image prune -f
Aggressive: docker image prune -af

Aggressive mode removes ALL unused images, not
just dangling ones. Configure with the
AGGRESSIVE_IMAGE_PRUNE flag in your .env file.`,
  },
  {
    title: 'Deep prune',
    icon: AlertTriangle,
    content: `WARNING: Aggressive cleanup that removes:

• ALL stopped containers
• ALL unused networks
• ALL dangling AND unreferenced images
• ALL unused volumes
• Build cache

Command: docker system prune -af --volumes

This can free significant disk space but may
remove data you want to keep. Always backup
important volumes before running deep prune.`,
  },
  {
    title: 'Log rotation',
    icon: FileText,
    content: `Archives the current DCS log file and starts fresh.

Process:
1. Compresses current log to logs/archive/
2. Truncates the active log file
3. Enforces retention (LOG_BACKUP_COUNT archives)

Default retention: 12 archived logs
Configure: LOG_BACKUP_COUNT in .env

Does not affect Docker container logs — only
the DCS framework operational log.`,
  },
  {
    title: 'A Proxmox fleet',
    icon: Boxes,
    content: `On a hub every VM runs its own Docker:

Everywhere  the hub's and every VM's numbers
            added up, each row marked with
            where it is; an action runs on the
            hub and on every VM that answers,
            one summary at the end
Hub         only the hub itself
VM chip     only that VM (through the hub)

A VM that does not answer is left out and
named in the strip under the header.`,
  },
  {
    title: 'Orphan detection',
    icon: Search,
    content: `Scans for unused Docker resources:

Orphaned containers
  Exited containers no longer managed by any
  stack's docker-compose.yml

Dangling images
  Untagged image layers from builds/updates
  that are no longer referenced

Dangling volumes
  Named volumes not attached to any container

Review orphans before pruning to ensure nothing
important is accidentally removed.`,
  },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Maintenance() {
  const isConnected = useConnectionStore((s) => s.status) === 'connected'
  const { addToast } = useToast()
  const confirm = useConfirm()

  // ---- Scope: everywhere (the hub and every VM that answers), the hub, or one VM ----
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const everywhere = scope === 'all'
  const targets = useMemo<FleetTarget[]>(() => {
    if (everywhere) return fleetTargets(scopeMembers)
    if (scopeMember) return [{ id: scopeMember, name: memberName, vmid: scopeMembers.find((m) => m.id === scopeMember)?.vmid ?? null }]
    return [{ id: null, name: 'Hub', vmid: null }]
  }, [everywhere, scopeMember, memberName, scopeMembers])
  // the poll functions read the latest targets without restarting the poll every time the member list refreshes
  const targetsRef = useRef(targets)
  useEffect(() => { targetsRef.current = targets }, [targets])
  const whereLabel = hasFleet ? (everywhere ? 'everywhere' : scopeMember ? `VM ${memberName}` : 'the hub') : ''
  const vmCount = Math.max(targets.length - 1, 0)

  // ---- Polling (one fan-out per card; a single server is a fan-out of one) ----
  // Everywhere asks every server three questions per round: a slower round keeps a 16-VM hub under its request budget
  const fetchReport = useCallback(() => fetchFleetMaintenanceReport(targetsRef.current), [])
  const {
    data: reportData,
    loading: reportLoading,
    refresh: refreshReport,
  } = usePolling<FleetMaintenanceReport>(fetchReport, everywhere ? 45000 : 10000, { enabled: isConnected })

  const fetchOrphans = useCallback(() => fetchFleetOrphans(targetsRef.current), [])
  const {
    data: orphans,
    loading: orphansLoading,
    refresh: refreshOrphans,
  } = usePolling<FleetOrphanReport>(fetchOrphans, everywhere ? 60000 : 15000, { enabled: isConnected })

  const fetchDisk = useCallback(() => fetchFleetDisk(targetsRef.current), [])
  const {
    data: disk,
    loading: diskLoading,
    refresh: refreshDisk,
  } = usePolling<FleetDiskAnalysis>(fetchDisk, everywhere ? 60000 : 15000, { enabled: isConnected })

  // another view: ask again right away
  const scopeRef = useRef(scope)
  useEffect(() => {
    if (scopeRef.current === scope) return
    scopeRef.current = scope
    refreshReport(); refreshOrphans(); refreshDisk()
  }, [scope, refreshReport, refreshOrphans, refreshDisk])

  const report = reportData?.totals ?? null

  // ---- Action state ----
  const [pruning, setPruning] = useState(false)
  const [imagePruning, setImagePruning] = useState(false)
  const [deepPruning, setDeepPruning] = useState(false)
  const [rotating, setRotating] = useState(false)
  const [showDeepPruneModal, setShowDeepPruneModal] = useState(false)
  const [showGuide, setShowGuide] = useState(false)
  const [expandedGuide, setExpandedGuide] = useState<number | null>(null)

  // ---- Action handlers: one server, or on Everywhere the hub and every VM at once ----
  type ActionResult = { success: boolean; output?: string; message?: string }
  const runAction = useCallback(async (opts: {
    verb: string
    done: string
    call: (member: string | null) => Promise<ActionResult>
    setBusy: (b: boolean) => void
    /** the deep-prune modal already asked */
    confirmed?: boolean
    danger?: boolean
  }) => {
    const { verb, done, call, setBusy } = opts
    if (everywhere && !opts.confirmed) {
      const ok = await confirm({
        title: `${verb} everywhere`,
        message: `Run ${verb.toLowerCase()} on the hub and on ${vmCount} VM${vmCount === 1 ? '' : 's'}? Each server cleans its own Docker; one that fails does not stop the others.`,
        confirmLabel: 'Run everywhere',
        danger: opts.danger,
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      if (everywhere) {
        const outcomes = await fanOut(targets, call)
        // a server that answered but reported a failure counts as one
        const graded = outcomes.map((o) => (o.ok && o.value && o.value.success === false ? { ...o, ok: false, error: o.value.message || o.value.output || 'failed' } : o))
        const summary = summarizeOutcomes(graded, done)
        addToast({ type: summary.ok ? 'success' : 'error', message: summary.message, duration: summary.ok ? 5000 : 9000 })
      } else {
        const res = await call(scopeMember)
        const where = whereLabel ? ` on ${whereLabel}` : ''
        addToast({
          type: res.success ? 'success' : 'error',
          message: res.success ? `${done}${where}` : (res.message || res.output || `The ${verb.toLowerCase()} failed`),
        })
      }
      refreshReport()
      refreshOrphans()
      refreshDisk()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : `The ${verb.toLowerCase()} failed` })
    } finally {
      setBusy(false)
    }
  }, [everywhere, vmCount, targets, scopeMember, whereLabel, confirm, addToast, refreshReport, refreshOrphans, refreshDisk])

  const handleSafePrune = () => runAction({ verb: 'Safe prune', done: 'Docker system prune completed', call: runDockerPruneScoped, setBusy: setPruning })
  const handleImagePrune = () => runAction({ verb: 'Image prune', done: 'Image prune completed', call: runImagePruneScoped, setBusy: setImagePruning })
  const handleDeepPrune = () => {
    setShowDeepPruneModal(false)
    void runAction({ verb: 'Deep prune', done: 'Deep prune completed — all unused resources removed', call: triggerDeepPruneScoped, setBusy: setDeepPruning, confirmed: true, danger: true })
  }
  const handleLogRotate = () => runAction({ verb: 'Log rotation', done: 'Logs rotated', call: triggerLogRotateScoped, setBusy: setRotating })

  // ---- Refresh all ----
  const handleRefreshAll = () => {
    refreshReport()
    refreshOrphans()
    refreshDisk()
  }

  const isAnyLoading = reportLoading || orphansLoading || diskLoading

  // ---- Orphan state ----
  const orphanContainers = orphans?.containers ?? []
  const danglingImages = orphans?.images ?? []
  const danglingVolumes = orphans?.volumes ?? []
  const allClean = orphanContainers.length === 0 && danglingImages.length === 0 && danglingVolumes.length === 0

  // ---- Disk bar sizing ----
  const stackSizes = disk?.stack_sizes ?? []
  const maxStackBytes = stackSizes.reduce((max, s) => Math.max(max, parseSizeBytes(s.size) ?? 0), 0) || 1

  // ---- Who answered (Everywhere) ----
  const reportAnswered = reportData ? answered(reportData.members) : null

  const dot = (c: string) => <span className={`h-1.5 w-1.5 rounded-full ${c}`} />
  const anyActionBusy = pruning || imagePruning || deepPruning || rotating
  const notAnswering = scopeMembers.filter((m) => !m.reachable)

  return (
    <div className="space-y-5 animate-fade-in">
      <DisconnectedBanner />

      {/* Deep prune confirmation */}
      {showDeepPruneModal && createPortal(
        <ModalOverlay onClose={() => setShowDeepPruneModal(false)}
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setShowDeepPruneModal(false)}
        >
          <div
            className="relative w-full max-w-md mx-4 max-h-[92vh] overflow-y-auto glass rounded-2xl border border-white/10 p-6 animate-scale-in"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/10" aria-hidden>
                <AlertTriangle size={18} className="text-rose-400" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-100">Deep prune</h2>
                <p className="text-[11px] text-slate-500">Destructive action</p>
              </div>
            </div>

            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 mb-4">
              <p className="text-xs text-rose-300 leading-relaxed">
                <span className="font-semibold text-rose-400">Warning:</span> This will aggressively
                remove <span className="font-semibold">all</span> stopped containers, unused networks,
                dangling and unreferenced images, unused volumes, and build cache. Data stored in
                removed volumes will be <span className="font-semibold text-rose-400">permanently lost</span>.
              </p>
            </div>

            <p className="text-xs text-slate-400 mb-5">
              This action cannot be undone. Only proceed if you are certain no important data
              resides in dangling volumes or unused images.
            </p>

            <p className="text-[11px] text-slate-500 mb-4">
              Containers that Traefik starts on demand (Sablier) are stopped on purpose: they, their images, volumes and networks are left alone.
            </p>

            {hasFleet && (
              <p className="text-[11px] text-slate-400 mb-4 flex items-center gap-1.5">
                <Boxes size={12} className="shrink-0 text-violet-300" aria-hidden />
                {everywhere ? `Runs on the hub and on ${vmCount} VM${vmCount === 1 ? '' : 's'}, each cleaning its own Docker.` : `Runs on ${whereLabel} only.`}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => setShowDeepPruneModal(false)} className={BTN_SHEET_QUIET}>
                Cancel
              </button>
              <button type="button" onClick={handleDeepPrune} className={`${BTN_SHEET_DANGER} whitespace-nowrap`}>
                <Trash2 size={14} />
                {everywhere ? 'Delete everywhere' : 'Delete everything'}
              </button>
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}

      <PageHeader
        page="maintenance"
        badge={scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        subtitle={hasFleet ? (everywhere ? 'Docker cleanup on the hub and every VM: numbers added up, actions run on all of them' : `Docker cleanup on ${whereLabel}`) : undefined}
        actions={<>
          <Hint label={showGuide ? 'Hide the guide' : 'Show the guide'}>
            <button
              type="button"
              aria-label="Guide"
              aria-expanded={showGuide}
              onClick={() => setShowGuide((v) => !v)}
              className={`${BTN_TOOLBAR} ${showGuide ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <BookOpen size={14} />
              <span className="hidden sm:inline">Guide</span>
            </button>
          </Hint>
          <button type="button" aria-label="Refresh" onClick={handleRefreshAll} disabled={isAnyLoading} className={`${BTN_TOOLBAR} ${TONE_QUIET}`}>
            <RefreshCw size={14} className={isAnyLoading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </>}
      >
        <div className="space-y-2">
          {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={reportLoading && !!reportData} />}
          {everywhere && reportAnswered && (
            <p className="text-[11px] text-slate-500">
              {reportAnswered.ok} of {targets.length} server{targets.length === 1 ? '' : 's'} answered
              {notAnswering.length > 0 && <span> · {notAnswering.length} VM{notAnswering.length === 1 ? '' : 's'} not answering ({notAnswering.map((m) => m.name).join(', ')})</span>}
              {reportAnswered.failed.length > 0 && <span className="text-amber-300/80"> · no report from {reportAnswered.failed.map((m) => m.name).join(', ')}</span>}
            </p>
          )}
        </div>
      </PageHeader>

      {/* Guide Panel */}
      {showGuide && (
        <section aria-label={`${pageLabel('maintenance')} guide`} className="glass rounded-xl border border-white/5 overflow-hidden animate-fade-in">
          <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <BookOpen size={16} className="text-slate-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-200">{pageLabel('maintenance')} guide</h2>
            </div>
            <Hint label="Close the guide">
              <button type="button" aria-label="Close the guide" onClick={() => setShowGuide(false)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}>
                <X size={14} />
              </button>
            </Hint>
          </div>
          <div className="p-5 space-y-3">
            <p className="text-sm text-slate-400 mb-4">
              Maintenance tools help keep your Docker environment clean and efficient. Run cleanup operations regularly to reclaim disk space and remove orphaned resources.
            </p>
            {MAINTENANCE_GUIDE_SECTIONS.map((section, i) => {
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

      {/* ================================================================== */}
      {/* 1. Actions */}
      {/* ================================================================== */}
      <section aria-labelledby="maint-actions-title" className="glass rounded-xl p-5 border border-white/5">
        <h2 id="maint-actions-title" className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">Actions{hasFleet && <span className="text-[11px] font-normal text-slate-500">{everywhere ? `on the hub and ${vmCount} VM${vmCount === 1 ? '' : 's'}` : `on ${whereLabel}`}</span>}</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {/* Safe prune: nothing to lose (emerald) */}
          <button type="button" onClick={handleSafePrune} disabled={anyActionBusy} className={`${BTN_SHEET} ${TONE_OK}`}>
            {pruning ? <Loader2 size={14} className="animate-spin" /> : <Scissors size={14} />}
            Safe prune
          </button>

          {/* Image prune */}
          <button type="button" onClick={handleImagePrune} disabled={anyActionBusy} className={`${BTN_SHEET} ${TONE_QUIET}`}>
            {imagePruning ? <Loader2 size={14} className="animate-spin" /> : <Image size={14} />}
            Image prune
          </button>

          {/* Deep prune: destructive (rose) */}
          <button type="button" onClick={() => setShowDeepPruneModal(true)} disabled={anyActionBusy} className={`${BTN_SHEET} ${TONE_DANGER}`}>
            {deepPruning ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
            Deep prune
          </button>

          {/* Rotate logs */}
          <button type="button" onClick={handleLogRotate} disabled={anyActionBusy} className={`${BTN_SHEET} ${TONE_QUIET}`}>
            {rotating ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
            Rotate logs
          </button>
        </div>
      </section>

      {/* ================================================================== */}
      {/* 2. System report */}
      {/* ================================================================== */}
      <section aria-labelledby="maint-report-title" className="glass rounded-xl p-5 border border-white/5">
        <h2 id="maint-report-title" className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">System report{everywhere && <span className="text-[11px] font-normal text-slate-500">added up across {targets.length} server{targets.length === 1 ? '' : 's'}</span>}</h2>

        {reportLoading && !report ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3" role="status" aria-label="Reading the report">
            {[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-[88px] rounded-lg" aria-hidden />)}
          </div>
        ) : report ? (
          <div className="space-y-4">
            {/* 2x4 stat grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {/* Containers */}
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Box size={12} className="text-slate-400" aria-hidden />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Containers</span>
                </div>
                <p className="text-xl md:text-2xl font-bold text-slate-100 tabular-nums">{report.containers.total}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Pill tone="ok" icon={dot('bg-emerald-400')} title="Running">{report.containers.running}</Pill>
                  {/* asleep on demand is not stopped: Sablier stopped them on purpose, and a prune leaves them alone */}
                  {(report.containers.sleeping ?? 0) > 0 && <Badge component="span" color="indigo" leftSection={<Moon size={9} aria-hidden />} title="Asleep on demand (Sablier wakes them on the first request; a prune leaves them alone)">{report.containers.sleeping}</Badge>}
                  <Pill tone={report.containers.stopped - (report.containers.sleeping ?? 0) > 0 ? 'problem' : 'neutral'} icon={dot(report.containers.stopped - (report.containers.sleeping ?? 0) > 0 ? 'bg-rose-400' : 'bg-slate-500')} title="Stopped">{Math.max(0, report.containers.stopped - (report.containers.sleeping ?? 0))}</Pill>
                </div>
              </div>

              {/* Images */}
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Image size={12} className="text-slate-400" aria-hidden />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Images</span>
                </div>
                <p className="text-xl md:text-2xl font-bold text-slate-100 tabular-nums">{report.images.total}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {report.images.dangling > 0 ? (
                    <Pill tone="attention" icon={dot('bg-amber-400')}>{report.images.dangling} dangling</Pill>
                  ) : (
                    <Pill tone="ok" icon={dot('bg-emerald-400')}>clean</Pill>
                  )}
                </div>
              </div>

              {/* Volumes */}
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <HardDrive size={12} className="text-slate-400" aria-hidden />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Volumes</span>
                </div>
                <p className="text-xl md:text-2xl font-bold text-slate-100 tabular-nums">{report.volumes.total}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  {report.volumes.dangling > 0 ? (
                    <Pill tone="attention" icon={dot('bg-amber-400')}>{report.volumes.dangling} dangling</Pill>
                  ) : (
                    <Pill tone="ok" icon={dot('bg-emerald-400')}>clean</Pill>
                  )}
                </div>
              </div>

              {/* Networks */}
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3">
                <div className="flex items-center gap-1.5 mb-2">
                  <Network size={12} className="text-slate-400" aria-hidden />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Networks</span>
                </div>
                <p className="text-xl md:text-2xl font-bold text-slate-100 tabular-nums">{report.networks.total}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Pill tone="info">{report.networks.custom} custom</Pill>
                </div>
              </div>

              {/* App data size */}
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 sm:col-span-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <HardDrive size={12} className="text-slate-400" aria-hidden />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">App data</span>
                </div>
                <p className="text-lg font-bold text-slate-100 font-mono">{report.app_data_size}</p>
              </div>

              {/* Log size */}
              <div className="rounded-lg bg-white/[0.03] border border-white/5 p-3 sm:col-span-2">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText size={12} className="text-slate-400" aria-hidden />
                  <span className="text-[10px] text-slate-500 uppercase tracking-wider">Log size</span>
                </div>
                <p className="text-lg font-bold text-slate-100 font-mono">{report.log_size}</p>
              </div>
            </div>
          </div>
        ) : null}
      </section>

      {/* ================================================================== */}
      {/* 3. Orphan detection */}
      {/* ================================================================== */}
      <section aria-labelledby="maint-orphans-title" className="glass rounded-xl p-5 border border-white/5">
        <div className="flex items-center justify-between mb-3">
          <h2 id="maint-orphans-title" className="text-sm font-semibold text-slate-200">Orphan detection</h2>
          {!orphansLoading && orphans && allClean && (
            <Pill tone="ok" icon={<CheckCircle2 size={10} />}>All clean</Pill>
          )}
        </div>

        {orphansLoading && !orphans ? (
          <div className="space-y-2" role="status" aria-label="Looking for orphans">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-8 rounded-lg" aria-hidden />)}
          </div>
        ) : orphans ? (
          <div className="space-y-4">
            {/* Orphaned containers */}
            {orphanContainers.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                  <Box size={12} className="text-slate-400" aria-hidden />
                  Orphaned containers ({orphanContainers.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th scope="col" className={`${TH} text-left`}>Name</th>
                        <th scope="col" className={`${TH} text-left`}>Image</th>
                        <th scope="col" className={`${TH} text-left`}>Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {orphanContainers.map((c) => (
                        <tr key={rowKey(c.member, c.name)} className="hover:bg-white/[0.03] transition-colors duration-150">
                          <td className={`px-4 py-2 font-mono text-slate-200 text-xs whitespace-nowrap ${everywhere ? 'min-w-[17rem]' : ''}`}><span className="inline-flex items-center gap-2">{c.name}{everywhere && <VmCapsule member={c.member} name={c.member_name} vmid={c.vmid} size="xs" onClick={() => setScope(c.member ?? 'hub')} />}</span></td>
                          <td className="px-4 py-2 font-mono text-slate-400 text-xs">{c.image}</td>
                          <td className="px-4 py-2">
                            <Pill tone="problem">{c.status}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Dangling images */}
            {danglingImages.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                  <Image size={12} className="text-slate-400" aria-hidden />
                  Dangling images ({danglingImages.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th scope="col" className={`${TH} text-left`}>ID</th>
                        <th scope="col" className={`${TH} text-left`}>Size</th>
                        <th scope="col" className={`${TH} text-left`}>Created</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {danglingImages.map((img) => (
                        <tr key={rowKey(img.member, img.id)} className="hover:bg-white/[0.03] transition-colors duration-150">
                          <td className={`px-4 py-2 font-mono text-slate-200 text-xs whitespace-nowrap ${everywhere ? 'min-w-[17rem]' : ''}`}><span className="inline-flex items-center gap-2">{img.id.slice(0, 12)}{everywhere && <VmCapsule member={img.member} name={img.member_name} vmid={img.vmid} size="xs" onClick={() => setScope(img.member ?? 'hub')} />}</span></td>
                          <td className="px-4 py-2 font-mono text-slate-300 text-xs">{img.size}</td>
                          <td className="px-4 py-2 text-slate-400 text-xs">{img.created}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Dangling volumes */}
            {danglingVolumes.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-400 mb-2 flex items-center gap-1.5">
                  <HardDrive size={12} className="text-slate-400" aria-hidden />
                  Dangling volumes ({danglingVolumes.length})
                </h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th scope="col" className={`${TH} text-left`}>Name</th>
                        <th scope="col" className={`${TH} text-left`}>Driver</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {danglingVolumes.map((vol) => (
                        <tr key={rowKey(vol.member, vol.name)} className="hover:bg-white/[0.03] transition-colors duration-150">
                          <td className={`px-4 py-2 font-mono text-slate-200 text-xs whitespace-nowrap ${everywhere ? 'min-w-[17rem]' : ''}`}><span className="inline-flex items-center gap-2">{vol.name}{everywhere && <VmCapsule member={vol.member} name={vol.member_name} vmid={vol.vmid} size="xs" onClick={() => setScope(vol.member ?? 'hub')} />}</span></td>
                          <td className="px-4 py-2">
                            <Pill tone="neutral">{vol.driver}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* All clean message */}
            {allClean && (
              <EmptyState
                compact
                icon={<CheckCircle2 size={28} className="text-emerald-400" />}
                title={`No orphaned resources detected${whereLabel ? ` ${everywhere ? 'anywhere' : `on ${whereLabel}`}` : ''}`}
                hint={everywhere ? 'Every server that answered is tidy' : 'Your Docker environment is tidy'}
              />
            )}
          </div>
        ) : null}
      </section>

      {/* ================================================================== */}
      {/* 4. Disk usage */}
      {/* ================================================================== */}
      <section aria-labelledby="maint-disk-title" className="glass rounded-xl p-5 border border-white/5">
        <h2 id="maint-disk-title" className="text-sm font-semibold text-slate-200 mb-3 flex items-center gap-2">Disk usage{everywhere && <span className="text-[11px] font-normal text-slate-500">every server&apos;s stacks; Docker&apos;s table added up per type</span>}</h2>

        {diskLoading && !disk ? (
          <div className="space-y-3" role="status" aria-label="Measuring the disk">
            {[0, 1, 2].map((i) => <div key={i} className="skeleton h-5 rounded" aria-hidden />)}
          </div>
        ) : disk ? (
          <div className="space-y-5">
            {/* Total app data */}
            <div className="flex items-center gap-2">
              <HardDrive size={14} className="text-slate-400" aria-hidden />
              <span className="text-xs text-slate-400">Total app data:</span>
              <span className="text-sm font-bold text-slate-100 font-mono">{disk.total_app_data}</span>
            </div>

            {/* Per-stack sizes as horizontal bars */}
            {stackSizes.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-400 mb-3">App-Data per stack</h3>
                <div className="space-y-2">
                  {stackSizes.map((entry) => {
                    const pct = Math.max(((parseSizeBytes(entry.size) ?? 0) / maxStackBytes) * 100, 2)
                    return (
                      <div key={rowKey(entry.member, entry.name)}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs text-slate-300 font-mono truncate mr-3 inline-flex items-center gap-2 min-w-0"><span className="truncate">{entry.name}</span>{everywhere && <VmCapsule member={entry.member} name={entry.member_name} vmid={entry.vmid} size="xs" onClick={() => setScope(entry.member ?? 'hub')} />}</span>
                          <span className="text-xs text-slate-400 font-mono shrink-0">{entry.size}</span>
                        </div>
                        <div className="h-2 rounded-full bg-slate-800 overflow-hidden" aria-hidden>
                          <div
                            className="h-full rounded-full bg-cyan-500/80 transition-all duration-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Docker system df table */}
            {disk.docker_df.length > 0 && (
              <div>
                <h3 className="text-xs font-medium text-slate-400 mb-3">Docker disk usage</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] text-sm">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th scope="col" className={`${TH} text-left`}>Type</th>
                        <th scope="col" className={`${TH} text-right`}>Total</th>
                        <th scope="col" className={`${TH} text-right`}>Active</th>
                        <th scope="col" className={`${TH} text-right`}>Size</th>
                        <th scope="col" className={`${TH} text-right`}>Reclaimable</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.03]">
                      {disk.docker_df.map((row) => (
                        <tr key={row.type} className="hover:bg-white/[0.03] transition-colors duration-150">
                          <td className="px-4 py-2 text-slate-200 font-medium text-xs">{row.type}</td>
                          <td className="px-4 py-2 text-right font-mono text-slate-300 text-xs tabular-nums">{row.total}</td>
                          <td className="px-4 py-2 text-right font-mono text-slate-300 text-xs tabular-nums">{row.active}</td>
                          <td className="px-4 py-2 text-right font-mono text-slate-300 text-xs">{row.size}</td>
                          <td className="px-4 py-2 text-right">
                            <Pill tone="info">{row.reclaimable}</Pill>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}
      </section>
    </div>
  )
}
