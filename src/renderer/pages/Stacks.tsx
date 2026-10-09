// =============================================================================
// Stacks Page — Stack management with polling, actions, batch ops, and toasts
// =============================================================================

import { useCallback, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useApi } from '../hooks/useApi'
import { useStackStore } from '../stores/stackStore'
import { useConnectionStore } from '../stores/connectionStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useToast } from '../components/common/Toast'
import {
  fetchStacks,
  startStack,
  stopStack,
  restartStack,
  updateStack,
  batchStackAction,
  batchStackUpdate,
} from '../api/endpoints'
import type { BatchStackResponse, BatchStackResult, StackInfo } from '../../shared/types'
import StackList from '../components/stacks/StackList'
import StackDetail from '../components/stacks/StackDetail'
import CreateStackOverlay from '../components/stacks/CreateStackOverlay'
import EditStackOverlay from '../components/stacks/EditStackOverlay'
import {
  Loader2, Play, Square, RotateCcw, Download,
  CheckCircle2, XCircle, X, ListChecks,
} from 'lucide-react'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { activityOutcome, startedInBackground, waitForStackActivity } from '../lib/stackActivity'
import { useFleetRole } from '../hooks/useFleetRole'
import { usePolling } from '../hooks/usePolling'
import { fetchFleetJobs, fetchFleetProvisionDefaults, fetchProxmoxCapabilities } from '../api/endpoints'
import NewVmSheet from '../components/fleet/NewVmSheet'
import ModalOverlay from '../components/common/ModalOverlay'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_CARD_QUIET, BTN_SHEET_PRIMARY, TONE_QUIET, TONE_OK, TONE_DANGER } from '../lib/ui'
import CloseButton from '../components/common/CloseButton'
// -----------------------------------------------------------------------------
// Stacks Page
// -----------------------------------------------------------------------------

export default function Stacks() {
  const { stacks, setStacks, actionLoading, setActionLoading } = useStackStore()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'
  const [selectedStackName, setSelectedStackName] = useState<string | null>(null)
  // a hub: the VMs are the stacks — the page reads "VMs", builds new ones and follows the builds
  const { isHub: hubMode } = useFleetRole()
  const [showNewVm, setShowNewVm] = useState(false)
  const [moveStack, setMoveStack] = useState<string | null>(null)   // a hub stack on its way into a VM
  // building VMs is an admin's: the server refuses these reads to anyone else (and the controls that use them are an admin's)
  const jobs = usePolling(fetchFleetJobs, 5000, { enabled: isConnected && hubMode && isAdmin })
  const provDefaults = usePolling(fetchFleetProvisionDefaults, 60000, { enabled: isConnected && hubMode && isAdmin })
  const caps = usePolling(fetchProxmoxCapabilities, 60000, { enabled: isConnected && hubMode && isAdmin })
  const navigationPayload = useSettingsStore((s) => s.navigationPayload)
  const { addToast } = useToast()

  // React to navigation payloads (e.g. "View Stack" after deploy)
  // Only consume if the payload has keys relevant to THIS page (highlight, resetView)
  useEffect(() => {
    if (!navigationPayload) return
    const payload = useSettingsStore.getState().navigationPayload
    if (!payload) return

    // Only consume payload if it's for us — don't steal focusContainer from Containers page
    if (payload.highlight || payload.resetView) {
      useSettingsStore.getState().consumeNavigationPayload()
      if (payload.highlight && typeof payload.highlight === 'string') {
        setSelectedStackName(payload.highlight)
        // "Edit compose" from a container page: open the editor at that service
        if (payload.editCompose) {
          setEditingStackName(payload.highlight)
          setFocusService(typeof payload.focusService === 'string' ? payload.focusService : null)
        }
      } else if (payload.resetView) {
        setSelectedStackName(null)
      }
    }
  }, [navigationPayload])

  // Back to the list: the keyboard lands on the stack that was open, not on the page
  const closeDetail = useCallback(() => {
    const name = selectedStackName
    setSelectedStackName(null)
    if (name) requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-stack-open="${CSS.escape(name)}"]`)?.focus())
  }, [selectedStackName])

  // Escape key returns from stack detail to list
  useEffect(() => {
    if (!selectedStackName) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if ((e.target as HTMLElement)?.isContentEditable) return
      // Check if a VISIBLE modal overlay is open
      const hasVisibleOverlay = Array.from(document.querySelectorAll('.fixed.inset-0')).some(
        (el) => {
          const style = window.getComputedStyle(el)
          return style.pointerEvents !== 'none' && style.opacity !== '0' && style.display !== 'none'
        },
      )
      if (hasVisibleOverlay) return
      e.preventDefault()
      closeDetail()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [selectedStackName, closeDetail])

  // Overlay states
  const [showCreateOverlay, setShowCreateOverlay] = useState(false)
  const [editingStackName, setEditingStackName] = useState<string | null>(null)
  const [focusService, setFocusService] = useState<string | null>(null)

  // Batch mode state
  const [batchMode, setBatchMode] = useState(false)
  const [selectedStacks, setSelectedStacks] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState<string | null>(null)
  const [batchResults, setBatchResults] = useState<BatchStackResult[] | null>(null)
  const [showBatchProgress, setShowBatchProgress] = useState(false)
  const [batchTotal, setBatchTotal] = useState(0)

  // Poll stacks list every 5 seconds
  const { data: stacksData, loading: stacksLoading, error: stacksError, refresh } = useApi(fetchStacks, 5000, {
    enabled: isConnected,
  })

  // Sync fetched data into the store
  useEffect(() => {
    if (stacksData?.stacks) {
      setStacks(stacksData.stacks)
    }
  }, [stacksData, setStacks])

  // Find the StackInfo object for the editing stack
  const editingStack: StackInfo | null = editingStackName
    ? stacks.find((s) => s.name === editingStackName) ?? null
    : null

  // Stack action handler
  const handleAction = useCallback(
    async (stackName: string, action: 'start' | 'stop' | 'restart' | 'update') => {
      setActionLoading(stackName)

      const gerund: Record<typeof action, string> = {
        start: 'Starting',
        stop: 'Stopping',
        restart: 'Restarting',
        update: 'Updating',
      }

      addToast({ type: 'info', message: `${gerund[action]} stack "${stackName}"...`, duration: 2000 })

      try {
        const actionFn = {
          start: startStack,
          stop: stopStack,
          restart: restartStack,
          update: updateStack,
        }[action]

        const result = await actionFn(stackName)

        if (result.success && startedInBackground(result.output)) {
          // "Starting X (background)": the API answered before anything ran — follow the
          // stack's activity and only then say how it ended
          useStackStore.getState().recordAction(stackName)
          addToast({ type: 'info', message: `${gerund[action]} "${stackName}"…`, duration: 4000 })
          refresh()
          addToast(activityOutcome(await waitForStackActivity(stackName), stackName, action))
        } else if (result.success) {
          useStackStore.getState().recordAction(stackName)
          const pastTense: Record<typeof action, string> = {
            start: 'started',
            stop: 'stopped',
            restart: 'restarted',
            update: 'updated',
          }
          addToast({
            type: 'success',
            message: `Stack "${stackName}" ${pastTense[action]} successfully!`,
          })
        } else {
          addToast({
            type: 'error',
            message: `Failed to ${action} "${stackName}": ${result.output || 'Unknown error'}`,
            duration: 6000,
          })
        }

        // Refresh the stacks list after action completes
        refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addToast({
          type: 'error',
          message: `Failed to ${action} "${stackName}": ${message}`,
          duration: 6000,
        })
      } finally {
        setActionLoading(null)
      }
    },
    [setActionLoading, addToast, refresh],
  )

  // Toggle batch mode on/off
  const handleToggleBatchMode = useCallback(() => {
    setBatchMode((prev) => {
      if (prev) {
        // Turning off: clear selection
        setSelectedStacks(new Set())
      }
      return !prev
    })
  }, [])

  // Toggle a single stack's selection
  const handleToggleSelect = useCallback((name: string) => {
    setSelectedStacks((prev) => {
      const next = new Set(prev)
      if (next.has(name)) {
        next.delete(name)
      } else {
        next.add(name)
      }
      return next
    })
  }, [])

  // Select all visible stacks
  const handleSelectAll = useCallback(() => {
    const allNames = new Set(stacks.map((s) => s.name))
    setSelectedStacks(allNames)
  }, [stacks])

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedStacks(new Set())
  }, [])

  // Batch action handler
  const handleBatchAction = useCallback(
    async (action: 'start' | 'stop' | 'restart' | 'update') => {
      const names = Array.from(selectedStacks)
      if (names.length === 0) return

      setBatchLoading(action)
      setBatchResults(null)
      setBatchTotal(names.length)
      setShowBatchProgress(true)

      const gerund: Record<typeof action, string> = {
        start: 'Starting',
        stop: 'Stopping',
        restart: 'Restarting',
        update: 'Updating',
      }

      addToast({
        type: 'info',
        message: `${gerund[action]} ${names.length} stack${names.length !== 1 ? 's' : ''}...`,
        duration: 3000,
      })

      try {
        let response: BatchStackResponse

        if (action === 'update') {
          response = await batchStackUpdate(names)
        } else {
          response = await batchStackAction(action, names)
        }

        setBatchResults(response.results)

        // "start queued": the API answered before anything ran — follow each stack's
        // activity and settle its row with the real outcome
        let results = response.results
        const queued = results.filter((r) => r.success && startedInBackground(r.message))
        if (queued.length > 0) {
          addToast({ type: 'info', message: `${gerund[action]} ${queued.length} stack${queued.length !== 1 ? 's' : ''}…`, duration: 4000 })
          const ended = new Map(await Promise.all(queued.map(async (r) => [r.stack, activityOutcome(await waitForStackActivity(r.stack), r.stack, action)] as const)))
          results = results.map((r) => {
            const o = ended.get(r.stack)
            return o ? { ...r, success: o.type !== 'error', message: o.message } : r
          })
          setBatchResults(results)
        }

        const successCount = results.filter((r) => r.success).length
        const failCount = results.length - successCount

        if (failCount === 0) {
          addToast({
            type: 'success',
            message: `All ${successCount} stack${successCount !== 1 ? 's' : ''} ${action === 'update' ? 'updated' : action + 'ed'} successfully!`,
          })
        } else {
          addToast({
            type: 'warning',
            message: `${successCount} succeeded, ${failCount} failed`,
            duration: 6000,
          })
        }

        refresh()
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        addToast({
          type: 'error',
          message: `Batch ${action} failed: ${message}`,
          duration: 6000,
        })
      } finally {
        setBatchLoading(null)
      }
    },
    [selectedStacks, addToast, refresh],
  )

  // Handle edit callback from StackCard
  const handleEdit = useCallback((stackName: string) => {
    setEditingStackName(stackName)
  }, [])

  // Batch action buttons config: emerald starts, rose stops, the rest is neutral
  const batchButtons: {
    action: 'start' | 'stop' | 'restart' | 'update'
    icon: typeof Play
    label: string
    tone: string
    adminOnly?: boolean
  }[] = [
    { action: 'start', icon: Play, label: 'Start selected', tone: TONE_OK },
    { action: 'stop', icon: Square, label: 'Stop selected', tone: TONE_DANGER },
    { action: 'restart', icon: RotateCcw, label: 'Restart selected', tone: TONE_QUIET },
    { action: 'update', icon: Download, label: 'Update selected', tone: TONE_QUIET, adminOnly: true },
  ]

  const isComplete = batchResults !== null && !batchLoading

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <DisconnectedBanner />
      {selectedStackName && !batchMode ? (
        <StackDetail
          stackName={selectedStackName}
          onBack={closeDetail}
          onAction={handleAction}
          isActionLoading={actionLoading === selectedStackName}
          onContainerClick={(containerName) => {
            useSettingsStore.getState().setCurrentPage('containers', { focusContainer: containerName })
          }}
          isAdmin={isAdmin}
          stack={stacks.find((st) => st.name === selectedStackName) ?? null}
        />
      ) : (
        <>
        <StackList
          onAction={handleAction}
          onSelect={(name) => setSelectedStackName(name)}
          onRefresh={refresh}
          loading={stacksLoading && !stacksData}
          error={stacksError}
          onEdit={handleEdit}
          onCreateStack={() => (hubMode ? setShowNewVm(true) : setShowCreateOverlay(true))}
          onCreateHubStack={() => setShowCreateOverlay(true)}
          building={hubMode ? (jobs.data?.running ?? 0) : 0}
          onOpenBuilds={() => useSettingsStore.getState().setCurrentPage('proxmox')}
          batchMode={batchMode}
          selectedStacks={selectedStacks}
          onToggleSelect={handleToggleSelect}
          onToggleBatchMode={handleToggleBatchMode}
          isAdmin={isAdmin}
          hubMode={hubMode}
          onMoveToVm={hubMode ? (name) => setMoveStack(name) : undefined}
        />
        </>
      )}

      {/* a hub: one of its own stacks moves into a VM, with what it holds */}
      {moveStack !== null && (
        <NewVmSheet defaults={provDefaults.data ?? null} caps={caps.data ?? null} moveStack={moveStack} onClose={() => setMoveStack(null)}
          onQueued={() => { setMoveStack(null); addToast({ type: 'success', message: `${moveStack} is moving into its VM — follow it on the card` }); jobs.refresh() }} />
      )}

      {/* a hub: a new stack is a new VM */}
      {showNewVm && (
        <NewVmSheet defaults={provDefaults.data ?? null} caps={caps.data ?? null} initialStack="" onClose={() => setShowNewVm(false)}
          onQueued={() => { setShowNewVm(false); addToast({ type: 'success', message: 'The VM is being built — follow it on the card' }); jobs.refresh() }} />
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Create Stack Overlay                                              */}
      {/* ----------------------------------------------------------------- */}
      {showCreateOverlay && (
        <CreateStackOverlay
          onClose={() => setShowCreateOverlay(false)}
          onCreated={() => { refresh(); setTimeout(refresh, 500) }}
        />
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Edit Stack Overlay                                                */}
      {/* ----------------------------------------------------------------- */}
      {editingStack && (
        <EditStackOverlay
          stack={editingStack}
          initialService={focusService ?? undefined}
          onClose={() => { setEditingStackName(null); setFocusService(null) }}
          onSaved={refresh}
        />
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Floating Batch Action Bar                                         */}
      {/* ----------------------------------------------------------------- */}
      {batchMode && selectedStacks.size > 0 && (
        // the row centres the bar (a transform on the bar itself would be overwritten by its slide-up); on a phone it sits above the tab bar
        <div className="fixed inset-x-0 bottom-20 md:bottom-6 z-40 flex justify-center px-4 pointer-events-none">
          <div
            role="toolbar"
            aria-label="Batch actions"
            className="
              pointer-events-auto animate-slide-up max-w-full
              flex items-center flex-wrap justify-center gap-2 sm:gap-3 px-3 sm:px-5 py-3 rounded-2xl
              bg-slate-900/80 backdrop-blur-xl border border-white/10
              shadow-2xl shadow-black/40
            "
          >
            {/* Selection count */}
            <div className="flex items-center gap-2 pr-3 border-r border-white/10">
              <ListChecks size={16} className="text-cyan-400" />
              <span className="text-sm font-semibold text-slate-200 whitespace-nowrap">
                {selectedStacks.size} stack{selectedStacks.size !== 1 ? 's' : ''} selected
              </span>
            </div>

            {/* Action buttons */}
            {batchButtons.filter((b) => !b.adminOnly || isAdmin).map(({ action, icon: Icon, label, tone }) => (
              <Hint key={action} label={label}>
                <button
                  onClick={() => handleBatchAction(action)}
                  disabled={!!batchLoading}
                  aria-label={label}
                  className={`${BTN_TOOLBAR} ${tone}`}
                >
                  {batchLoading === action ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : (
                    <Icon size={14} />
                  )}
                  <span className="hidden sm:inline">{label.replace(' selected', '')}</span>
                </button>
              </Hint>
            ))}

            {/* Select all / Clear */}
            <div className="flex items-center gap-1.5 pl-3 border-l border-white/10">
              <button onClick={handleSelectAll} className={BTN_CARD_QUIET}>
                Select all
              </button>
              <button onClick={handleClearSelection} className={BTN_CARD_QUIET}>
                <X size={12} />
                Clear
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Batch Progress Modal                                              */}
      {/* ----------------------------------------------------------------- */}
      {showBatchProgress && createPortal(
        <ModalOverlay onClose={() => { if (isComplete) { setShowBatchProgress(false); setBatchResults(null) } }} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass p-6 max-w-lg w-full mx-4 space-y-5 animate-scale-in">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/10">
                  <ListChecks className="w-5 h-5 text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Batch operation</h3>
                  <p className="text-xs text-slate-500">
                    {isComplete
                      ? `Completed ${batchResults.length} of ${batchTotal}`
                      : `Processing ${batchTotal} stack${batchTotal !== 1 ? 's' : ''}...`}
                  </p>
                </div>
              </div>
              {isComplete && (
                <Hint label="Close">
                  <CloseButton size="sm" onClick={() => {
                      setShowBatchProgress(false)
                      setBatchResults(null)
                    }} />
                </Hint>
              )}
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  isComplete ? 'bg-emerald-500' : 'bg-cyan-500 animate-pulse'
                }`}
                style={{
                  width: isComplete
                    ? '100%'
                    : '60%',
                }}
              />
            </div>

            {/* Per-stack results */}
            <div className="max-h-64 overflow-y-auto scrollbar-thin space-y-1.5">
              {batchResults ? (
                batchResults.map((result) => (
                  <div
                    key={result.stack}
                    className={`
                      flex items-center gap-3 px-3 py-2.5 rounded-lg border
                      ${result.success
                        ? 'bg-emerald-500/5 border-emerald-500/15'
                        : 'bg-rose-500/5 border-rose-500/15'}
                    `}
                  >
                    {result.success ? (
                      <CheckCircle2 size={16} className="text-emerald-400 shrink-0" />
                    ) : (
                      <XCircle size={16} className="text-rose-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-200 truncate">{result.stack}</p>
                      <p className={`text-[10px] truncate ${result.success ? 'text-emerald-400/70' : 'text-rose-400/70'}`}>
                        {result.message}
                      </p>
                    </div>
                  </div>
                ))
              ) : (
                // Pending placeholders while waiting
                Array.from(selectedStacks).map((name) => (
                  <div
                    key={name}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg border bg-white/[0.03] border-white/5"
                  >
                    <Loader2 size={16} className="text-cyan-400 animate-spin shrink-0" />
                    <p className="text-xs text-slate-400 truncate">{name}</p>
                  </div>
                ))
              )}
            </div>

            {/* Summary + Dismiss */}
            {isComplete && (
              <div className="flex items-center justify-between pt-2 border-t border-white/5">
                <p className="text-xs text-slate-500">
                  {batchResults.filter((r) => r.success).length} succeeded,{' '}
                  {batchResults.filter((r) => !r.success).length} failed
                </p>
                <button
                  onClick={() => {
                    setShowBatchProgress(false)
                    setBatchResults(null)
                    setSelectedStacks(new Set())
                    setBatchMode(false)
                  }}
                  className={BTN_SHEET_PRIMARY}
                >
                  <CheckCircle2 size={16} />
                  Done
                </button>
              </div>
            )}
          </div>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  )
}
