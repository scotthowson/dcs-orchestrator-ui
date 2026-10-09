// =============================================================================
// Volumes — Docker volumes: search, sort (the column headers), delete one, or
// several at once in batch mode. On a hub: the hub's volumes, a VM's, or both.
// =============================================================================

import { useState, useMemo, useCallback, useEffect, useRef, useId } from 'react'
import { createPortal } from 'react-dom'
import { HardDrive, Trash2, Loader2, AlertTriangle, Database, RefreshCw, X, FolderOpen, Check, CheckCircle2, XCircle, ListChecks, Weight } from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { fetchVolumes, deleteVolume } from '../api/endpoints'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import type { VolumeInfo, VolumeListResponse } from '../../shared/types'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { LoadingState, ErrorState, EmptyState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import SortableTh from '../components/common/SortableTh'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_DANGER, TONE_DANGER, TONE_GHOST_DANGER, TONE_QUIET, FOCUS_RING } from '../lib/ui'
import { CARD, REVEAL } from '../lib/pageKit'
import { INPUT } from '../lib/fieldStyles'
import StatTile from '../components/common/StatTile'
import { Pill } from '../components/common/Pill'
import SearchInput from '../components/common/SearchInput'
import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VOLUME_POLL_INTERVAL = 30_000

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const value = bytes / Math.pow(1024, i)
  return `${value.toFixed(i > 0 ? 1 : 0)} ${units[i]}`
}

type SortField = 'name' | 'size'

// ---------------------------------------------------------------------------
// Batch result type
// ---------------------------------------------------------------------------

interface BatchResult {
  name: string
  success: boolean
  message: string
}

// ---------------------------------------------------------------------------
// Skeleton Rows
// ---------------------------------------------------------------------------

function SkeletonRow({ batch, admin }: { batch: boolean; admin: boolean }) {
  return (
    <tr className="border-b border-white/[0.03]" aria-hidden>
      {batch && <td className="px-3 py-3.5"><div className="skeleton h-5 w-5 rounded mx-auto" /></td>}
      <td className="px-3 py-3.5"><div className="skeleton h-4 w-44 max-w-full rounded" /></td>
      <td className="px-3 py-3.5 hidden sm:table-cell"><div className="skeleton h-[18px] w-14 rounded-full" /></td>
      <td className="px-3 py-3.5 hidden md:table-cell"><div className="skeleton h-4 w-64 rounded" /></td>
      <td className="px-3 py-3.5 text-right"><div className="skeleton h-4 w-14 rounded ml-auto" /></td>
      {admin && <td className="px-3 py-3.5"><div className="skeleton h-7 w-7 rounded-lg ml-auto" /></td>}
    </tr>
  )
}

// ---------------------------------------------------------------------------
// Batch Delete Confirmation Modal — several volumes at once: type their number to go on
// ---------------------------------------------------------------------------

function BatchDeleteConfirmModal({
  count,
  onClose,
  onConfirm,
}: {
  count: number
  onClose: () => void
  onConfirm: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const expected = String(count)
  const uid = useId()

  return createPortal(
    <ModalOverlay onClose={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md glass rounded-2xl border-rose-500/20 p-5 sm:p-6 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/20 shrink-0">
            <AlertTriangle size={20} className="text-rose-400" />
          </div>
          <h3 className="text-base font-semibold text-slate-100">Delete {count} volume{count !== 1 ? 's' : ''}</h3>
        </div>

        {/* Warning message */}
        <div className="rounded-lg bg-rose-500/5 border border-rose-500/15 p-4 mb-4">
          <p className="text-sm text-slate-300 leading-relaxed">
            You are about to permanently delete{' '}
            <span className="font-semibold text-rose-400">{count}</span>{' '}
            volume{count !== 1 ? 's' : ''}. All data stored in {count !== 1 ? 'these volumes' : 'this volume'} will be lost. This cannot be undone.
          </p>
          <label htmlFor={`${uid}-confirm`} className="block text-xs text-slate-400 mt-3">
            Type <span className="font-mono text-slate-200 bg-white/[0.06] px-1.5 py-0.5 rounded">{expected}</span> to confirm
          </label>
          <input
            id={`${uid}-confirm`}
            type="text"
            inputMode="numeric"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={expected}
            autoComplete="off"
            className={`${INPUT} mt-2 !py-2 focus:!border-rose-500/50 focus:!ring-rose-500/25`}
            autoFocus
          />
        </div>

        {/* Actions */}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
          <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} sm:flex-1 ${FOCUS_RING}`}>
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={confirmText !== expected}
            className={`${BTN_SHEET_DANGER} sm:flex-1 disabled:cursor-not-allowed ${FOCUS_RING}`}
          >
            <Trash2 size={16} />
            Delete {count} volume{count !== 1 ? 's' : ''}
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Volumes() {
  const isConnected = useConnectionStore((s) => s.status) === 'connected'
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [searchQuery, setSearchQuery] = useState('')
  const [sortField, setSortField] = useState<SortField>('name')
  const [sortAsc, setSortAsc] = useState(true)

  // Batch state
  const [batchMode, setBatchMode] = useState(false)
  const [selectedVolumes, setSelectedVolumes] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false)
  const [batchResults, setBatchResults] = useState<BatchResult[] | null>(null)

  // Poll volumes data
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const fetchScopedVolumes = useCallback(() => fetchVolumes(scope), [scope])
  const {
    data: volumesData,
    loading,
    error,
    refresh,
  } = usePolling<VolumeListResponse>(fetchScopedVolumes, VOLUME_POLL_INTERVAL)
  const scopeRef = useRef(scope)
  useEffect(() => { if (scopeRef.current !== scope) { scopeRef.current = scope; refresh() } }, [scope, refresh])

  const volumes: VolumeInfo[] = volumesData?.volumes ?? []
  const hasLoaded = volumesData !== null

  // Filter by search query
  const filteredVolumes = useMemo(() => {
    let list = [...volumes]

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(
        (v) =>
          v.name.toLowerCase().includes(q) ||
          v.driver.toLowerCase().includes(q) ||
          v.mountpoint.toLowerCase().includes(q),
      )
    }

    // Sort
    list.sort((a, b) => {
      let cmp = 0
      if (sortField === 'name') {
        cmp = a.name.localeCompare(b.name)
      } else {
        cmp = a.size_bytes - b.size_bytes
      }
      return sortAsc ? cmp : -cmp
    })

    return list
  }, [volumes, searchQuery, sortField, sortAsc])

  // Summary stats
  const totalSize = useMemo(
    () => volumes.reduce((sum, v) => sum + v.size_bytes, 0),
    [volumes],
  )

  const driverCounts = useMemo(() => {
    const map: Record<string, number> = {}
    for (const v of volumes) {
      map[v.driver] = (map[v.driver] || 0) + 1
    }
    return map
  }, [volumes])

  const largestVolume = useMemo(
    () =>
      volumes.length > 0
        ? volumes.reduce((max, v) => (v.size_bytes > max.size_bytes ? v : max))
        : null,
    [volumes],
  )

  // Sort toggle handler
  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortAsc(!sortAsc)
      } else {
        setSortField(field)
        setSortAsc(true)
      }
    },
    [sortField, sortAsc],
  )

  // Delete one volume: ask first, then do it — the same question every page asks with
  const requestDelete = useCallback(async (volumeName: string) => {
    if (scope === 'all') {
      addToast({ type: 'warning', message: 'Everywhere is a view: pick the hub or one VM above, then delete the volume there' })
      return
    }
    const where = scopeMember ? ` on the VM ${memberName}` : ''
    const ok = await confirm({
      title: 'Delete this volume?',
      message: `Permanently delete the volume ${volumeName}${where}? All data stored in it will be lost. This cannot be undone.`,
      confirmLabel: 'Delete volume',
      danger: true,
    })
    if (!ok) return
    try {
      await deleteVolume(volumeName, scopeMember)
      addToast({ type: 'success', message: `Volume "${volumeName}" deleted successfully` })
      refresh()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete volume'
      addToast({ type: 'error', message: `Failed to delete "${volumeName}": ${message}`, duration: 6000 })
    }
  }, [scope, scopeMember, memberName, confirm, addToast, refresh])

  // -------------------------------------------------------------------------
  // Batch operations
  // -------------------------------------------------------------------------

  const toggleBatchMode = useCallback(() => {
    setBatchMode((prev) => {
      if (prev) {
        // Exiting batch mode — clear selection & results
        setSelectedVolumes(new Set())
        setBatchResults(null)
      }
      return !prev
    })
  }, [])

  const toggleVolumeSelection = useCallback((name: string) => {
    setSelectedVolumes((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }, [])

  const selectAll = useCallback(() => {
    setSelectedVolumes(new Set(filteredVolumes.map((v) => v.name)))
  }, [filteredVolumes])

  const clearSelection = useCallback(() => {
    setSelectedVolumes(new Set())
  }, [])

  const handleBatchDelete = useCallback(async () => {
    setBatchConfirmOpen(false)
    if (selectedVolumes.size === 0) return
    if (scope === 'all') { setBatchResults([{ name: '—', success: false, message: 'Everywhere is a view: pick the hub or one VM above, then delete there' }]); return }
    setBatchLoading(true)
    setBatchResults(null)

    const results: BatchResult[] = []
    for (const name of selectedVolumes) {
      try {
        await deleteVolume(name, scopeMember)
        results.push({ name, success: true, message: 'Deleted successfully' })
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Failed to delete'
        results.push({ name, success: false, message })
      }
    }

    setBatchResults(results)
    setBatchLoading(false)
    setSelectedVolumes(new Set())

    const successCount = results.filter((r) => r.success).length
    const failCount = results.length - successCount
    if (failCount === 0) {
      addToast({ type: 'success', message: `Successfully deleted ${successCount} volume${successCount !== 1 ? 's' : ''}` })
    } else {
      addToast({
        type: 'warning',
        message: `Deleted ${successCount} volume${successCount !== 1 ? 's' : ''}, ${failCount} failed`,
        duration: 6000,
      })
    }

    refresh()
  }, [selectedVolumes, addToast, refresh])

  // Not connected state
  if (!isConnected) {
    return (
      <LoadingState label="Waiting for the server connection…" hint="Make sure the DCS Orchestrator API is running" />
    )
  }

  const allSelected = filteredVolumes.length > 0 && selectedVolumes.size === filteredVolumes.length
  // the table's columns: [select] name · driver · mountpoint · size · [delete]
  const colCount = (batchMode ? 1 : 0) + 4 + (isAdmin ? 1 : 0)

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />

      {/* Batch delete confirmation modal */}
      {batchConfirmOpen && (
        <BatchDeleteConfirmModal
          count={selectedVolumes.size}
          onClose={() => setBatchConfirmOpen(false)}
          onConfirm={handleBatchDelete}
        />
      )}

      <PageHeader
        page="volumes"
        badge={scopeMember ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeMembers.find((m) => m.id === scopeMember)?.vmid} /> : undefined}
        actions={<>
          {isAdmin && (
            <button
              type="button"
              onClick={toggleBatchMode}
              aria-pressed={batchMode}
              className={`${BTN_TOOLBAR} ${FOCUS_RING} ${batchMode ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
            >
              <ListChecks size={14} />
              {batchMode ? 'Exit batch' : 'Batch select'}
            </button>
          )}
          <button type="button" onClick={refresh} disabled={loading} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Show" busy={loading && !!volumesData} />}
      </PageHeader>

      {/* ----------------------------------------------------------------- */}
      {/* Batch Action Bar                                                  */}
      {/* ----------------------------------------------------------------- */}
      {batchMode && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/15 animate-fade-in">
          <div className="flex items-center gap-1 flex-1 min-w-0">
            <span className="text-xs font-semibold text-cyan-400 mr-2" role="status">
              {selectedVolumes.size} selected
            </span>
            <button
              type="button"
              onClick={selectAll}
              className={`h-8 px-2 rounded-lg text-xs text-slate-400 hover:text-cyan-400 hover:bg-white/5 transition-colors ${FOCUS_RING}`}
            >
              Select all ({filteredVolumes.length})
            </button>
            <span className="text-white/10" aria-hidden>|</span>
            <button
              type="button"
              onClick={clearSelection}
              className={`h-8 px-2 rounded-lg text-xs text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors ${FOCUS_RING}`}
            >
              Clear
            </button>
          </div>
          <button
            type="button"
            onClick={() => setBatchConfirmOpen(true)}
            disabled={selectedVolumes.size === 0 || batchLoading}
            className={`${BTN_TOOLBAR} ${TONE_DANGER} ${FOCUS_RING}`}
          >
            {batchLoading ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Trash2 size={14} />
            )}
            {batchLoading ? 'Deleting…' : 'Delete selected'}
          </button>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Batch Results Panel                                               */}
      {/* ----------------------------------------------------------------- */}
      {batchResults && batchResults.length > 0 && (
        <div className={`${CARD} p-4 md:p-5 animate-fade-in`}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
              <ListChecks size={16} className="text-cyan-400" />
              Delete results
            </h3>
            <CloseButton label="Close the results" size="sm" onClick={() => setBatchResults(null)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {batchResults.map((result) => (
              <div
                key={result.name}
                className={`
                  flex items-center gap-3 rounded-lg p-3 border
                  ${result.success
                    ? 'bg-emerald-500/5 border-emerald-500/15'
                    : 'bg-rose-500/5 border-rose-500/15'
                  }
                `}
              >
                {result.success ? (
                  <CheckCircle2 size={14} className="text-emerald-400 shrink-0" aria-hidden />
                ) : (
                  <XCircle size={14} className="text-rose-400 shrink-0" aria-hidden />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-mono text-slate-200 truncate" title={result.name}>
                    {result.name}
                  </p>
                  <p className={`text-[11px] ${result.success ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>
                    {result.message}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Summary Stat Cards                                                */}
      {/* ----------------------------------------------------------------- */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-3 stagger-children">
        <StatTile icon={Database} label="Total volumes" value={hasLoaded ? volumes.length : '--'} />
        <StatTile icon={HardDrive} label="Total storage" value={hasLoaded ? formatBytes(totalSize) : '--'} />
        <StatTile
          icon={FolderOpen}
          label="Drivers"
          value={hasLoaded ? Object.keys(driverCounts).length : '--'}
          sub={hasLoaded && Object.keys(driverCounts).length > 0 ? Object.entries(driverCounts).map(([driver, count]) => `${driver} (${count})`).join(' · ') : undefined}
        />
        <StatTile
          icon={Weight}
          label="Largest"
          value={hasLoaded ? (largestVolume ? formatBytes(largestVolume.size_bytes) : 'N/A') : '--'}
          sub={largestVolume ? <span className="font-mono" title={largestVolume.name}>{largestVolume.name}</span> : undefined}
        />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Search                                                            */}
      {/* ----------------------------------------------------------------- */}
      <div className="relative">
        <SearchInput value={searchQuery} onChange={setSearchQuery} label="Search volumes" placeholder="Search by name, driver or mountpoint…" />
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Search results count                                              */}
      {/* ----------------------------------------------------------------- */}
      {searchQuery && hasLoaded && (
        <div className="flex items-center gap-2" role="status">
          <span className="text-xs text-slate-500">
            {filteredVolumes.length} result{filteredVolumes.length !== 1 ? 's' : ''} for{' '}
            <span className="text-slate-400">"{searchQuery}"</span>
          </span>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Volumes Table                                                     */}
      {/* ----------------------------------------------------------------- */}
      <div className={`${CARD} overflow-hidden`}>
        {/* Table header bar */}
        <div className="px-4 sm:px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2">
            <HardDrive size={16} className="text-cyan-400" aria-hidden />
            Docker volumes
          </h2>
          <div className="flex items-center gap-1.5">
            <Database size={11} className="text-slate-500" aria-hidden />
            <span className="text-[11px] text-slate-500">
              {hasLoaded
                ? `${filteredVolumes.length} volume${filteredVolumes.length !== 1 ? 's' : ''} · ${formatBytes(totalSize)} total`
                : 'Loading…'}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5">
                {/* Batch checkbox column */}
                {batchMode && (
                  <th scope="col" className="text-center px-3 w-12">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={allSelected}
                      onClick={allSelected ? clearSelection : selectAll}
                      aria-label={allSelected ? 'Clear the selection' : 'Select all'}
                      className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg ${FOCUS_RING}`}
                    >
                      <span className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${allSelected ? 'bg-emerald-500 border-emerald-500' : 'bg-white/5 border-white/20 hover:border-white/40'}`}>
                        {allSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                      </span>
                    </button>
                  </th>
                )}
                <SortableTh
                  label="Name"
                  active={sortField === 'name'}
                  direction={sortAsc ? 'asc' : 'desc'}
                  onSort={() => handleSort('name')}
                />
                <th scope="col" className="hidden sm:table-cell text-left px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Driver
                </th>
                <th scope="col" className="hidden md:table-cell text-left px-3 py-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                  Mountpoint
                </th>
                <SortableTh
                  label="Size"
                  align="right"
                  active={sortField === 'size'}
                  direction={sortAsc ? 'asc' : 'desc'}
                  onSort={() => handleSort('size')}
                />
                {isAdmin && (
                  <th scope="col" className="w-12 px-3 py-3">
                    <span className="sr-only">Actions</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="stagger-children">
              {/* Loading skeleton */}
              {!hasLoaded && loading && (
                <>
                  {[0, 1, 2, 3, 4].map((i) => <SkeletonRow key={i} batch={batchMode} admin={isAdmin} />)}
                </>
              )}

              {/* The poll failed before anything loaded */}
              {!hasLoaded && !loading && error && (
                <tr>
                  <td colSpan={colCount} className="px-5 py-6">
                    <ErrorState title="Failed to load volumes" error={error} onRetry={refresh} />
                  </td>
                </tr>
              )}

              {/* Empty state */}
              {hasLoaded && filteredVolumes.length === 0 && (
                <tr>
                  <td colSpan={colCount} className="px-5">
                    <EmptyState
                      icon={<Database size={28} strokeWidth={1.5} />}
                      title={searchQuery ? 'No volumes match your search' : 'No named volumes here'}
                      hint={searchQuery
                        ? 'Try another name, driver or mountpoint.'
                        : 'DCS stacks keep their data in App-Data folders next to each compose file. Docker volumes appear here when a stack creates one.'}
                      action={searchQuery ? (
                        <button type="button" onClick={() => setSearchQuery('')} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
                          <X size={14} />
                          Clear the search
                        </button>
                      ) : undefined}
                    />
                  </td>
                </tr>
              )}

              {/* Volume rows */}
              {hasLoaded &&
                filteredVolumes.map((vol) => {
                  const isSelected = selectedVolumes.has(vol.name)
                  return (
                    <tr
                      key={`${vol.member ?? ''}|${vol.name}`}
                      onClick={batchMode ? () => toggleVolumeSelection(vol.name) : undefined}
                      className={`
                        border-b border-white/[0.03] group transition-colors duration-150
                        ${batchMode ? 'cursor-pointer' : ''}
                        ${isSelected
                          ? 'bg-emerald-500/[0.06] hover:bg-emerald-500/[0.08]'
                          : 'hover:bg-white/[0.03]'
                        }
                      `}
                    >
                      {/* Batch checkbox */}
                      {batchMode && (
                        <td className="text-center px-3 py-2">
                          <button
                            type="button"
                            role="checkbox"
                            aria-checked={isSelected}
                            aria-label={`Select ${vol.name}`}
                            onClick={(ev) => { ev.stopPropagation(); toggleVolumeSelection(vol.name) }}
                            className={`mx-auto flex h-8 w-8 items-center justify-center rounded-lg ${FOCUS_RING}`}
                          >
                            <span className={`flex h-5 w-5 items-center justify-center rounded border transition-colors ${isSelected ? 'bg-emerald-500 border-emerald-500' : 'bg-white/5 border-white/20 hover:border-white/40'}`}>
                              {isSelected && <Check size={12} className="text-white" strokeWidth={3} />}
                            </span>
                          </button>
                        </td>
                      )}

                      {/* Name (on a phone the mountpoint sits under it) */}
                      <td className="px-3 py-3 w-full max-w-0 sm:w-auto sm:max-w-none">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-cyan-500/10 shrink-0">
                            <Database size={13} className="text-cyan-400" aria-hidden />
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="font-mono text-xs text-slate-200 truncate sm:max-w-[240px]" title={vol.name}>
                                {vol.name}
                              </span>
                              {vol.member !== undefined && <span className="hidden sm:inline-flex"><VmCapsule member={vol.member} name={vol.member_name} vmid={vol.vmid} size="xs" /></span>}
                            </div>
                            {/* a phone has no room beside the name: the VM, the driver and the mountpoint go under it */}
                            {vol.member !== undefined && <div className="sm:hidden mt-1"><VmCapsule member={vol.member} name={vol.member_name} vmid={vol.vmid} size="xs" /></div>}
                            <p className="md:hidden text-[11px] text-slate-500 font-mono truncate mt-0.5" title={vol.mountpoint}>
                              <span className="sm:hidden">{vol.driver} · </span>{vol.mountpoint}
                            </p>
                          </div>
                        </div>
                      </td>

                      {/* Driver */}
                      <td className="hidden sm:table-cell px-3 py-3">
                        <Pill tone="info">{vol.driver}</Pill>
                      </td>

                      {/* Mountpoint */}
                      <td
                        className="hidden md:table-cell px-3 py-3 text-slate-400 text-xs font-mono truncate max-w-[300px]"
                        title={vol.mountpoint}
                      >
                        {vol.mountpoint}
                      </td>

                      {/* Size */}
                      <td className="px-3 py-3 text-right">
                        <span
                          className={`text-xs font-mono font-medium tabular-nums ${
                            vol.size_bytes > 1073741824
                              ? 'text-slate-100'
                              : vol.size_bytes > 104857600
                                ? 'text-slate-200'
                                : 'text-slate-400'
                          }`}
                        >
                          {formatBytes(vol.size_bytes)}
                        </span>
                      </td>

                      {/* Actions */}
                      {isAdmin && (
                        <td className="px-3 py-2 text-right">
                          {!batchMode && (
                            <Hint label="Delete volume">
                              <button
                                type="button"
                                onClick={() => requestDelete(vol.name)}
                                className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER} ${REVEAL} ${FOCUS_RING} ml-auto`}
                                aria-label={`Delete the volume ${vol.name}`}
                              >
                                <Trash2 size={12} />
                              </button>
                            </Hint>
                          )}
                        </td>
                      )}
                    </tr>
                  )
                })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
