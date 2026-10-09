// =============================================================================
// StackList — the Stacks page: header, filters, the grid of stack cards, batch
// mode toggle, and the dialogs that belong to the list (delete, lint all)
// =============================================================================

import { useState, useMemo, useCallback, useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl } from '@mantine/core'
import { Layers, Filter, Plus, Play, Square, ArrowUpDown, X, Loader2, AlertTriangle, Sparkles, Trash2, ListChecks, Server, Home, ChevronDown } from 'lucide-react'
import { useStackStore } from '../../stores/stackStore'
import { useContainerStore } from '../../stores/containerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { usePluginStore } from '../../stores/pluginStore'
import { deleteStack, fetchStackCompose } from '../../api/endpoints'
import { lintCompose, isComposeLinterEnabled } from '../../hooks/useComposeLinter'
import type { LintDiagnostic } from '../../hooks/useComposeLinter'
import StackCard from './StackCard'
import { EmptyState, ErrorState } from '../common/PageState'
import ModalOverlay from '../common/ModalOverlay'
import PageHeader from '../common/PageHeader'
import Hint from '../common/Hint'
import { useConfirm } from '../common/ConfirmDialog'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_SHEET_QUIET, BTN_SHEET_DANGER, TONE_QUIET, TONE_OK, TONE_DANGER } from '../../lib/ui'
import SearchInput from '../common/SearchInput'
import CloseButton from '../common/CloseButton'
interface Props {
  onAction: (stackName: string, action: 'start' | 'stop' | 'restart' | 'update') => void
  onSelect: (stackName: string) => void
  onRefresh: () => void
  /** the first read of the list is under way */
  loading?: boolean
  /** the list could not be read (shown when there is nothing to show yet) */
  error?: Error | null
  onEdit?: (stackName: string) => void
  /** a hub: move one of its own stacks into a VM */
  onMoveToVm?: (stackName: string) => void
  onCreateStack?: () => void
  /** a hub: a stack on the hub itself (the New menu's second choice) */
  onCreateHubStack?: () => void
  /** a hub: the VMs are the stacks — the list is grouped into VMs and the hub's own stacks */
  hubMode?: boolean
  /** a hub: builds in flight, shown as a pill that leads to the Proxmox page */
  building?: number
  onOpenBuilds?: () => void
  batchMode?: boolean
  selectedStacks?: Set<string>
  onToggleSelect?: (name: string) => void
  onToggleBatchMode?: () => void
  isAdmin?: boolean
}

type StatusFilter = 'all' | 'running' | 'asleep' | 'stopped'
type SortMode = 'name' | 'status' | 'priority' | 'containers'

const priorityOrder: Record<string, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

/**
 * A button that opens a small menu. Escape, a click outside or a pick closes it; the first item takes the focus when it
 * opens, the arrow keys walk the items and focus goes back to the button when it closes. The menu is drawn on the page
 * (a portal) at the button, right-aligned and kept on the screen, so a narrow phone never cuts it off.
 */
function MenuButton({ ariaLabel, className, label, icon, width = 256, children }: {
  ariaLabel: string
  className: string
  label: ReactNode
  icon: ReactNode
  /** the menu's width in px (never wider than the screen) */
  width?: number
  /** the items: buttons with role="menuitem"; close() shuts the menu */
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 8, width })
  const menu = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const close = useCallback(() => { setOpen(false); trigger.current?.focus() }, [])
  const place = useCallback(() => {
    const r = trigger.current?.getBoundingClientRect()
    if (!r) return
    const w = Math.min(width, window.innerWidth - 16)
    setPos({ top: r.bottom + 4, left: Math.min(Math.max(8, r.right - w), window.innerWidth - w - 8), width: w })
  }, [width])

  useLayoutEffect(() => { if (open) place() }, [open, place])
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); close() }
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey, true)
    // the page scrolls or the window resizes: the menu stays at its button
    window.addEventListener('resize', place)
    document.addEventListener('scroll', place, true)
    menu.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', place)
      document.removeEventListener('scroll', place, true)
    }
  }, [open, close, place])

  const walk = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return
    const items = Array.from(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])
    if (items.length === 0) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : e.key === 'ArrowDown' ? (at + 1) % items.length : (at - 1 + items.length) % items.length
    items[next].focus()
  }

  return (
    <>
      <button ref={trigger} type="button" aria-haspopup="menu" aria-expanded={open} aria-label={ariaLabel} onClick={() => setOpen((v) => !v)} className={className}>
        {icon}
        <span>{label}</span>
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && createPortal(
        <div
          ref={menu}
          role="menu"
          aria-label={ariaLabel}
          onKeyDown={walk}
          style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width }}
          className="rounded-xl bg-slate-900/95 backdrop-blur-md border border-white/10 shadow-xl p-1.5 z-[60] animate-fade-in"
        >
          {children(close)}
        </div>,
        document.body,
      )}
    </>
  )
}

const MENU_ITEM = 'w-full text-left px-3 py-2 rounded-lg hover:bg-white/5 focus-visible:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40 disabled:opacity-50'

export default function StackList({ onAction, onSelect, onRefresh, loading = false, error = null, onEdit, onMoveToVm, onCreateStack, onCreateHubStack, batchMode, selectedStacks, onToggleSelect, onToggleBatchMode, isAdmin, hubMode = false, building = 0, onOpenBuilds }: Props) {
  const { stacks, actionLoading } = useStackStore()
  const confirm = useConfirm()
  const stackAnnotations = useSettingsStore((s) => s.stackAnnotations) ?? {}
  const linterPluginEnabled = usePluginStore((s) => { const p = s.plugins.find((pl) => pl.name === 'compose-linter'); return !p || p.enabled })
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [sortMode, setSortMode] = useState<SortMode>('priority')
  const [showDeleteModal, setShowDeleteModal] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [lintAllLoading, setLintAllLoading] = useState(false)
  const [lintAllResults, setLintAllResults] = useState<{ name: string; diagnostics: LintDiagnostic[] }[] | null>(null)

  const sorted = useMemo(() => {
    const list = [...stacks]
    switch (sortMode) {
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name))
        break
      case 'status':
        // running, then asleep on demand (fine), then stopped
        list.sort((a, b) => {
          const rank = (s: { status: string; sleeping?: boolean }) => (s.status === 'running' ? 0 : s.sleeping ? 1 : 2)
          if (rank(a) !== rank(b)) return rank(a) - rank(b)
          return a.name.localeCompare(b.name)
        })
        break
      case 'priority':
        list.sort((a, b) => {
          const ap = priorityOrder[stackAnnotations[a.name]?.priority ?? 'normal'] ?? 2
          const bp = priorityOrder[stackAnnotations[b.name]?.priority ?? 'normal'] ?? 2
          if (ap !== bp) return ap - bp
          if (a.status !== b.status) return a.status === 'running' ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        break
      case 'containers':
        list.sort((a, b) => b.running_containers - a.running_containers)
        break
    }
    return list
  }, [stacks, sortMode, stackAnnotations])

  // Containers per stack (from the global poll), so a search for a container finds its stack
  const allContainers = useContainerStore((s) => s.containers)
  const containersByStack = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const c of allContainers) {
      const project = c.stack
      if (!project) continue
      const list = map.get(project) ?? []
      list.push(c.name)
      map.set(project, list)
    }
    return map
  }, [allContainers])
  const containerMatches = useCallback((stackName: string): string[] => {
    const q = search.trim().toLowerCase()
    if (!q) return []
    return (containersByStack.get(stackName) ?? []).filter((n) => n.toLowerCase().includes(q))
  }, [search, containersByStack])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return sorted.filter((s) => {
      const matchesSearch = !q ||
        s.name.toLowerCase().includes(q) ||
        (stackAnnotations[s.name]?.label ?? '').toLowerCase().includes(q) ||
        containerMatches(s.name).length > 0
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'running' && s.status === 'running') ||
        (statusFilter === 'stopped' && s.status === 'stopped' && !s.sleeping) ||
        (statusFilter === 'asleep' && s.status !== 'running' && !!s.sleeping)
      return matchesSearch && matchesStatus
    })
  }, [sorted, search, statusFilter, stackAnnotations, containerMatches])

  const runningCount = stacks.filter((s) => s.status === 'running').length
  const stoppedCount = stacks.filter((s) => s.status === 'stopped' && !s.sleeping).length
  const sleepingCount = stacks.filter((s) => s.status === 'stopped' && s.sleeping).length
  const criticalCount = stacks.filter((s) => stackAnnotations[s.name]?.priority === 'critical').length
  const vmCount = stacks.filter((s) => s.placement === 'vm').length

  const handleLintAll = useCallback(async () => {
    if (lintAllLoading || stacks.length === 0 || !isComposeLinterEnabled()) return
    setLintAllLoading(true)
    const results: { name: string; diagnostics: LintDiagnostic[] }[] = []
    for (const stack of stacks) {
      try {
        const res = await fetchStackCompose(stack.name)
        const diagnostics = lintCompose(res.content)
        results.push({ name: stack.name, diagnostics })
      } catch {
        results.push({ name: stack.name, diagnostics: [] })
      }
    }
    setLintAllResults(results)
    setLintAllLoading(false)
  }, [lintAllLoading, stacks])

  const handleStartAll = useCallback(() => {
    // a stack Sablier keeps asleep wakes on its first request: starting everything would wake what is asleep on purpose
    stacks.filter((s) => s.status === 'stopped' && !s.sleeping).forEach((s) => onAction(s.name, 'start'))
  }, [stacks, onAction])

  // one click stops every running stack: ask first
  const handleStopAll = useCallback(async () => {
    const running = stacks.filter((s) => s.status === 'running')
    if (running.length === 0) return
    if (!(await confirm({
      title: 'Stop all stacks',
      message: `Stop ${running.length} running stack${running.length !== 1 ? 's' : ''}? Every container in ${running.length !== 1 ? 'them' : 'it'} stops until you start ${running.length !== 1 ? 'them' : 'it'} again.`,
      confirmLabel: 'Stop all',
      danger: true,
    }))) return
    running.forEach((s) => onAction(s.name, 'stop'))
  }, [stacks, onAction, confirm])

  const handleDelete = useCallback(async (name: string) => {
    setDeleting(true)
    setDeleteError(null)
    try {
      const result = await deleteStack(name)
      if (result.success) {
        setShowDeleteModal(null)
        onRefresh()
      } else {
        setDeleteError(result.message || 'Failed to delete stack')
      }
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Failed to delete stack')
    } finally {
      setDeleting(false)
    }
  }, [onRefresh])

  const filtering = !!search || statusFilter !== 'all'
  /** the list could not be read and there is nothing to count */
  const unreadable = stacks.length === 0 && !!error
  const closeDelete = () => { setShowDeleteModal(null); setDeleteError(null) }
  const batchClass = batchMode ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET

  return (
    <div className="space-y-4 md:space-y-5">
      {/* Delete Confirmation Modal */}
      {showDeleteModal && createPortal(
        <ModalOverlay onClose={closeDelete} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="glass p-6 max-w-sm w-full mx-4 space-y-4 animate-scale-in">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-rose-500/10 ring-1 ring-rose-500/20 shrink-0">
                <Trash2 className="w-5 h-5 text-rose-400" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Delete stack</h3>
                <p className="text-xs text-slate-400">
                  {(() => {
                    const vmStack = stacks.find((st) => st.name === showDeleteModal && st.placement === 'vm')
                    return vmStack
                      ? `This removes the stack's files from its VM${vmStack.member_name ? ` (${vmStack.member_name})` : ''}. The VM itself stays — remove it on the ${pageLabel('proxmox')} page when you no longer need it.`
                      : (() => {
                        const own = stacks.find((st) => st.name === showDeleteModal)?.app_data
                        return own?.external
                          ? `This will permanently remove the stack directory and its files. Its App-Data at ${own.path} is on a drive of its own and is kept.`
                          : 'This will permanently remove the stack directory and all its files.'
                      })()
                  })()}
                </p>
              </div>
            </div>
            <p className="text-sm text-slate-300">
              Are you sure you want to delete{' '}
              <span className="font-mono text-rose-400">{showDeleteModal}</span>?
            </p>

            {deleteError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2" role="alert">
                <AlertTriangle size={14} className="text-rose-400 shrink-0" />
                <p className="text-xs text-rose-300">{deleteError}</p>
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2">
              <button onClick={closeDelete} className={BTN_SHEET_QUIET}>
                Cancel
              </button>
              <button onClick={() => handleDelete(showDeleteModal)} disabled={deleting} className={BTN_SHEET_DANGER}>
                {deleting ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Delete
              </button>
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}

      {/* Header: the stats, the state of the builds and the actions */}
      <PageHeader
        page="stacks"
        badge={unreadable ? undefined : (
          <span className="text-sm text-slate-400">
            <span className="text-emerald-400 font-semibold">{runningCount} running</span>
            {sleepingCount > 0 && <><span className="mx-1.5 text-slate-500">&middot;</span><span className="text-indigo-300">{sleepingCount} asleep</span></>}
            <span className="mx-1.5 text-slate-500">&middot;</span>
            <span>{stacks.length} total</span>
            {criticalCount > 0 && (
              <>
                <span className="mx-1.5 text-slate-500">&middot;</span>
                <span className="text-rose-400">{criticalCount} critical</span>
              </>
            )}
          </span>
        )}
        subtitle={hubMode && !unreadable ? `${vmCount} VM${vmCount === 1 ? '' : 's'} · ${stacks.length - vmCount} on the hub` : undefined}
        actions={hubMode ? (
          // a hub keeps the header calm: New, a pill for builds in flight, and More
          <>
            {building > 0 && onOpenBuilds && (
              <Hint label={`Follow the builds on the ${pageLabel('proxmox')} page`}>
                <button onClick={onOpenBuilds} className={`${BTN_TOOLBAR} bg-violet-500/10 border border-violet-500/20 text-violet-200 hover:bg-violet-500/20`}>
                  <Loader2 size={14} className="animate-spin" />
                  {building} VM{building === 1 ? '' : 's'} being built
                </button>
              </Hint>
            )}
            {isAdmin && (
              <MenuButton ariaLabel="New stack" label="New stack" icon={<Plus size={14} />} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                {(close) => (
                  <>
                    <button role="menuitem" onClick={() => { close(); onCreateStack?.() }} className={MENU_ITEM}>
                      <p className="text-xs font-medium text-slate-200 flex items-center gap-2"><Server size={12} className="text-violet-300" /> In its own VM</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">The hub builds a VM and the stack runs there (the usual way)</p>
                    </button>
                    <button role="menuitem" onClick={() => { close(); onCreateHubStack?.() }} className={MENU_ITEM}>
                      <p className="text-xs font-medium text-slate-200 flex items-center gap-2"><Home size={12} className="text-emerald-400" /> On the hub</p>
                      <p className="text-[10px] text-slate-500 mt-0.5">Next to core-infrastructure, on this server</p>
                    </button>
                  </>
                )}
              </MenuButton>
            )}
            <MenuButton ariaLabel={batchMode ? 'More actions, batch mode is on' : 'More actions'} label={batchMode ? 'Batch mode on' : 'More'} icon={<ListChecks size={14} />} width={224} className={`${BTN_TOOLBAR} ${batchClass}`}>
              {(close) => (
                <>
                  {/* starting and stopping are admin calls on the API */}
                  {isAdmin && stoppedCount > 0 && (
                    <button role="menuitem" onClick={() => { close(); handleStartAll() }} className={`${MENU_ITEM} text-xs text-emerald-300 flex items-center gap-2`}><Play size={12} /> Start all ({stoppedCount} stopped)</button>
                  )}
                  {isAdmin && runningCount > 0 && (
                    <button role="menuitem" onClick={() => { close(); void handleStopAll() }} className={`${MENU_ITEM} text-xs text-rose-300 flex items-center gap-2`}><Square size={12} /> Stop all ({runningCount} running)</button>
                  )}
                  {isAdmin && onToggleBatchMode && (
                    <button role="menuitem" onClick={() => { close(); onToggleBatchMode() }} className={`${MENU_ITEM} text-xs text-slate-200 flex items-center gap-2`}><ListChecks size={12} /> {batchMode ? 'Exit batch mode' : 'Batch mode'}</button>
                  )}
                  {linterPluginEnabled && (
                    <button role="menuitem" onClick={() => { close(); void handleLintAll() }} disabled={lintAllLoading || stacks.length === 0} className={`${MENU_ITEM} text-xs text-slate-200 flex items-center gap-2`}>{lintAllLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />} Lint all</button>
                  )}
                </>
              )}
            </MenuButton>
          </>
        ) : (
          <>
            {/* Quick actions: Start all / Stop all (admin calls on the API) */}
            {isAdmin && !batchMode && stacks.length > 0 && (
              <>
                {stoppedCount > 0 && (
                  <button aria-label="Start all stacks" onClick={handleStartAll} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                    <Play size={14} />
                    <span className="hidden sm:inline">Start all</span>
                  </button>
                )}
                {runningCount > 0 && (
                  <button aria-label="Stop all stacks" onClick={() => void handleStopAll()} className={`${BTN_TOOLBAR} ${TONE_DANGER}`}>
                    <Square size={14} />
                    <span className="hidden sm:inline">Stop all</span>
                  </button>
                )}
              </>
            )}

            {/* Batch mode toggle */}
            {isAdmin && onToggleBatchMode && (
              <button
                onClick={onToggleBatchMode}
                aria-label={batchMode ? 'Exit batch mode' : 'Batch mode'}
                aria-pressed={batchMode}
                className={`${BTN_TOOLBAR} ${batchClass}`}
              >
                <ListChecks size={14} />
                <span className="hidden sm:inline">{batchMode ? 'Exit batch mode' : 'Batch mode'}</span>
              </button>
            )}

            {linterPluginEnabled && (
              <Hint label="Check every stack's compose file for mistakes">
                <button
                  onClick={handleLintAll}
                  disabled={lintAllLoading || stacks.length === 0}
                  aria-label="Lint all stacks"
                  className={BTN_TOOLBAR_QUIET}
                >
                  {lintAllLoading ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                  <span className="hidden sm:inline">Lint all</span>
                </button>
              </Hint>
            )}

            {isAdmin && (
              <button aria-label="New stack" onClick={onCreateStack} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                <Plus size={14} />
                <span className="hidden sm:inline">New stack</span>
              </button>
            )}
          </>
        )}
      />

      {/* Search, filter, and sort bar */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Search input */}
        <div className="relative flex-1 min-w-0 md:min-w-[200px] max-w-md basis-full sm:basis-auto sm:flex-1">
          <SearchInput value={search} onChange={setSearch} label="Search stacks" placeholder="Search stacks or containers…" />
        </div>

        {/* Status filter: one choice (the dashboard's segmented control); a phone swipes the row sideways */}
        <div className="flex items-center gap-2 min-w-0 max-w-full overflow-x-auto scrollbar-none">
          <Filter className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden />
          <SegmentedControl
            aria-label="Show"
            value={statusFilter}
            onChange={(v) => setStatusFilter(v as StatusFilter)}
            data={[{ value: 'all', label: 'All' }, { value: 'running', label: 'Running' },
              ...(sleepingCount > 0 || statusFilter === 'asleep' ? [{ value: 'asleep', label: 'Asleep' }] : []), { value: 'stopped', label: 'Stopped' }]}
          />
        </div>

        {/* Sort */}
        <div className="flex items-center gap-2 min-w-0 max-w-full overflow-x-auto scrollbar-none">
          <ArrowUpDown className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden />
          <SegmentedControl
            aria-label="Sort by"
            value={sortMode}
            onChange={(v) => setSortMode(v as SortMode)}
            data={[{ value: 'priority', label: 'Priority' }, { value: 'name', label: 'Name' }, { value: 'status', label: 'Status' }, { value: 'containers', label: 'Containers' }]}
          />
        </div>
      </div>

      {/* Batch mode indicator */}
      {batchMode && (
        <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/15">
          <ListChecks size={14} className="text-cyan-400 shrink-0" />
          <span className="text-xs text-cyan-300 font-medium">
            Batch mode is on — click stacks to select them, then use the bar that appears at the bottom
          </span>
          {selectedStacks && selectedStacks.size > 0 && (
            <span className="ml-auto shrink-0 text-xs text-cyan-400/70">
              {selectedStacks.size} selected
            </span>
          )}
        </div>
      )}

      {/* Stack grid */}
      {unreadable ? (
        <ErrorState title="Could not read the stacks" error={error} onRetry={onRefresh} />
      ) : loading && stacks.length === 0 ? (
        <div role="status" aria-label="Reading the stacks" className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="animate-pulse bg-slate-800/40 rounded-xl h-[200px] border border-white/[0.03]" />
          ))}
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 stagger-children">
          {/* a hub: each VM is a stack — VMs first, then what the hub itself runs */}
          {hubMode && filtered.some((s) => s.placement === 'vm') && (
            <p className="col-span-full text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 -mb-1"><Server size={12} /> VMs — click one for the containers running in it</p>
          )}
          {(hubMode ? [...filtered.filter((s) => s.placement === 'vm')] : filtered).map((stack) => (
            <StackCard
              key={`${stack.member ?? ''}|${stack.name}`}
              stack={stack}
              isActionLoading={actionLoading === stack.name}
              onAction={onAction}
              onSelect={onSelect}
              onEdit={isAdmin ? onEdit : undefined}
              onDelete={isAdmin ? (name) => setShowDeleteModal(name) : undefined}
              batchMode={batchMode}
              isSelected={selectedStacks?.has(stack.name)}
              onToggleSelect={onToggleSelect}
              matchedContainers={search.trim() ? containerMatches(stack.name) : undefined}
              isAdmin={isAdmin}
            />
          ))}

          {hubMode && filtered.some((s) => s.placement !== 'vm') && (
            <p className="col-span-full text-[11px] font-semibold uppercase tracking-wider text-slate-500 flex items-center gap-2 -mb-1 mt-2"><Home size={12} /> On the hub — this server's own stacks</p>
          )}
          {hubMode && filtered.filter((s) => s.placement !== 'vm').map((stack) => (
            <StackCard
              key={`${stack.member ?? ''}|${stack.name}`}
              stack={stack}
              isActionLoading={actionLoading === stack.name}
              onAction={onAction}
              onSelect={onSelect}
              onEdit={isAdmin ? onEdit : undefined}
              onMoveToVm={isAdmin ? onMoveToVm : undefined}
              onDelete={isAdmin ? (name) => setShowDeleteModal(name) : undefined}
              batchMode={batchMode}
              isSelected={selectedStacks?.has(stack.name)}
              onToggleSelect={onToggleSelect}
              matchedContainers={search.trim() ? containerMatches(stack.name) : undefined}
              isAdmin={isAdmin}
            />
          ))}

          {/* Create stack card — always at the end (hidden in batch mode and for non-admins) */}
          {isAdmin && !batchMode && (
            <button
              onClick={onCreateStack}
              className="
                group relative flex flex-col items-center justify-center
                min-h-[200px] rounded-xl border border-dashed
                border-white/10 hover:border-emerald-500/30
                bg-white/[0.02] hover:bg-emerald-500/[0.04]
                transition-all duration-300 cursor-pointer
              "
            >
              <div className="
                flex items-center justify-center w-12 h-12 rounded-xl
                bg-white/5 group-hover:bg-emerald-500/15
                border border-white/5 group-hover:border-emerald-500/20
                transition-all duration-300 mb-3
              ">
                <Plus className="w-5 h-5 text-slate-500 group-hover:text-emerald-400 transition-colors duration-300" />
              </div>
              <span className="text-sm font-medium text-slate-400 group-hover:text-emerald-400 transition-colors duration-300">
                New stack
              </span>
              <span className="text-[10px] text-slate-500 group-hover:text-slate-400 mt-1 transition-colors">
                {hubMode ? 'The hub builds a VM for it' : 'Add a compose stack to this server'}
              </span>
            </button>
          )}
        </div>
      ) : (
        <div className="glass-subtle rounded-xl">
          <EmptyState
            icon={<Layers size={28} />}
            title={filtering ? 'No stacks match your filters' : 'No stacks found'}
            hint={filtering ? 'Try another name or status.' : 'No stacks yet — deploy a template or create a stack.'}
            action={filtering ? (
              <button
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                }}
                className={BTN_TOOLBAR_QUIET}
              >
                <X size={14} /> Clear the filters
              </button>
            ) : isAdmin ? (
              <button onClick={onCreateStack} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
                <Plus size={14} />
                New stack
              </button>
            ) : undefined}
          />
        </div>
      )}

      {/* Bottom spacer when batch mode is active to avoid floating bar overlap */}
      {batchMode && selectedStacks && selectedStacks.size > 0 && (
        <div className="h-20" />
      )}

      {/* Lint all results */}
      {lintAllResults && createPortal(
        <ModalOverlay onClose={() => setLintAllResults(null)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setLintAllResults(null)}>
          <div className="glass rounded-2xl p-6 w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col min-h-0 border border-white/10 animate-scale-in gradient-border" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-cyan-500/15 flex items-center justify-center">
                  <Sparkles size={18} className="text-cyan-400" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-slate-200">Compose lint results</h3>
                  <p className="text-[10px] text-slate-500">{lintAllResults.length} stack{lintAllResults.length === 1 ? '' : 's'} checked</p>
                </div>
              </div>
              <Hint label="Close">
                <CloseButton size="sm" onClick={() => setLintAllResults(null)} />
              </Hint>
            </div>
            {/* Summary */}
            <div className="flex items-center gap-4 mb-4 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/5">
              <span className="flex items-center gap-1 text-[11px] font-medium text-rose-400">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                {lintAllResults.reduce((sum, r) => sum + r.diagnostics.filter(d => d.severity === 'error').length, 0)} errors
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-amber-400">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                {lintAllResults.reduce((sum, r) => sum + r.diagnostics.filter(d => d.severity === 'warning').length, 0)} warnings
              </span>
              <span className="flex items-center gap-1 text-[11px] font-medium text-cyan-400">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                {lintAllResults.reduce((sum, r) => sum + r.diagnostics.filter(d => d.severity === 'info').length, 0)} hints
              </span>
            </div>
            {/* Per-stack results — the only scrolling region */}
            <div className="space-y-2 overflow-y-auto scrollbar-thin min-h-0 flex-1 -mr-3 pr-3">
              {lintAllResults.map((result) => {
                const errors = result.diagnostics.filter(d => d.severity === 'error').length
                const warnings = result.diagnostics.filter(d => d.severity === 'warning').length
                const infos = result.diagnostics.filter(d => d.severity === 'info').length
                return (
                  <div key={result.name} className={`rounded-xl border p-3 ${errors > 0 ? 'border-rose-500/15 bg-rose-500/[0.03]' : warnings > 0 ? 'border-amber-500/10 bg-amber-500/[0.02]' : 'border-white/5'}`}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-mono text-slate-200">{result.name}</span>
                      <div className="flex items-center gap-2">
                        {errors > 0 && <span className="text-[10px] font-medium text-rose-400">{errors} error{errors === 1 ? '' : 's'}</span>}
                        {warnings > 0 && <span className="text-[10px] font-medium text-amber-400">{warnings} warning{warnings === 1 ? '' : 's'}</span>}
                        {infos > 0 && <span className="text-[10px] font-medium text-cyan-400">{infos} hint{infos === 1 ? '' : 's'}</span>}
                        {result.diagnostics.length === 0 && <span className="text-[10px] font-medium text-emerald-400">Clean</span>}
                      </div>
                    </div>
                    {result.diagnostics.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {result.diagnostics.slice(0, 5).map((d) => (
                          <div key={`${d.line}-${d.message}`} className="flex items-start gap-2 text-[10px]">
                            <span className={`shrink-0 mt-0.5 ${d.severity === 'error' ? 'text-rose-400' : d.severity === 'warning' ? 'text-amber-400' : 'text-cyan-400'}`}>
                              {d.severity === 'error' ? '●' : d.severity === 'warning' ? '▲' : 'ℹ'}
                            </span>
                            <span className="text-slate-500 tabular-nums shrink-0">L{d.line}</span>
                            <span className="text-slate-400">{d.message}</span>
                          </div>
                        ))}
                        {result.diagnostics.length > 5 && <p className="text-[9px] text-slate-500 ml-4">+{result.diagnostics.length - 5} more</p>}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </ModalOverlay>,
        document.body
      )}
    </div>
  )
}
