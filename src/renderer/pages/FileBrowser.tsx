// =============================================================================
// File Browser — explore the filesystem inside a running container through the
// DCS REST API: pick a container, walk its folders, read a file's text.
// On a hub: the hub's containers or one VM's (every call rides the hub's
// proxy to that VM); a file's text comes back as JSON, so it can be saved.
// =============================================================================

import { fetchContainers } from '../api/endpoints'
import { useState, useCallback, useEffect, useMemo, useRef, useId } from 'react'
import { FolderOpen, FileText, Link, Folder, ChevronRight, Loader2, WifiOff, AlertTriangle, ArrowUp, RefreshCw, Search, Box, Download, Info } from 'lucide-react'
import { createPortal } from 'react-dom'
import { useConnectionStore } from '../stores/connectionStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useToast } from '../components/common/Toast'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import {
  fetchContainerFilesScoped,
  fetchContainerFileContentScoped,
} from '../api/fleetScopedOps'
import type {
  ContainerFilesResponse,
  ContainerFileContentResponse,
  ContainerInfo,
} from '../../shared/types'
import { LoadingState, ErrorState, EmptyState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'
import PageHeader from '../components/common/PageHeader'
import { BTN_TOOLBAR_QUIET, BTN_CARD_QUIET, FOCUS_RING } from '../lib/ui'
import { CARD } from '../lib/pageKit'
import { INPUT } from '../lib/fieldStyles'
import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface FileEntry {
  name: string
  type: 'file' | 'directory' | 'symlink'
  size: number
  permissions: string
  modified: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format bytes into a human-readable string */
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  const val = bytes / Math.pow(1024, i)
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

/** Split a path into breadcrumb segments */
function pathSegments(path: string): { name: string; fullPath: string }[] {
  const parts = path.split('/').filter(Boolean)
  const segments: { name: string; fullPath: string }[] = [
    { name: '/', fullPath: '/' },
  ]
  for (let i = 0; i < parts.length; i++) {
    segments.push({
      name: parts[i],
      fullPath: '/' + parts.slice(0, i + 1).join('/'),
    })
  }
  return segments
}

/** Sort entries: directories first, then files, alphabetically within each group */
function sortEntries(entries: FileEntry[]): FileEntry[] {
  return [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })
}

// ---------------------------------------------------------------------------
// File Content Viewer Modal
// ---------------------------------------------------------------------------

interface FileViewerProps {
  filePath: string
  content: string
  size: number
  /** where the container runs, for the title */
  where?: string
  onClose: () => void
}

/** the text the API returned, saved from the browser (it came as JSON, so it rides the hub's proxy fine) */
function saveText(filePath: string, content: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filePath.split('/').filter(Boolean).pop() || 'file.txt'
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function FileViewer({ filePath, content, size, where, onClose }: FileViewerProps) {
  const isEmpty = !content || content.length === 0
  const isTooLarge = size > 1024 * 1024 // 1 MB

  return createPortal(
    <ModalOverlay onClose={onClose} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in p-4">
      <div className="w-full max-w-6xl glass rounded-2xl shadow-2xl shadow-black/40 flex flex-col animate-scale-in overflow-hidden max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between gap-2 px-4 sm:px-5 py-3 sm:py-4 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={16} className="text-cyan-400 shrink-0" aria-hidden />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-slate-200 truncate">{filePath}</h2>
              <p className="text-[11px] text-slate-500">{formatBytes(size)}{where ? ` · ${where}` : ''}{isTooLarge ? ' · first part only' : ''}</p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => saveText(filePath, content)}
              disabled={isEmpty}
              title={isEmpty ? 'Nothing to save: the file is empty or binary' : isTooLarge ? 'Saves the retrieved part of the file as text' : 'Save this text as a file'}
              className={`${BTN_CARD_QUIET} ${FOCUS_RING}`}
            >
              <Download size={12} aria-hidden />
              Save
            </button>
            <CloseButton onClick={onClose} />
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto p-0">
          {isEmpty && (
            <EmptyState icon={<FileText size={28} />} title="File is empty or binary content cannot be displayed" />
          )}
          {!isEmpty && isTooLarge && (
            <div className="flex flex-col items-center justify-center py-10 gap-2 text-center px-4">
              <AlertTriangle size={26} className="text-amber-500/70" aria-hidden />
              <p className="text-sm text-slate-400">File content is too large to display ({formatBytes(size)})</p>
              <p className="text-xs text-slate-500">Only the retrieved portion is shown below</p>
            </div>
          )}
          {!isEmpty && (
            <pre tabIndex={0} aria-label={`Text of ${filePath}`} className={`p-4 md:p-6 text-xs text-slate-300 font-mono leading-relaxed whitespace-pre-wrap break-all bg-slate-950/50 min-h-[200px] overflow-auto scrollbar-thin ${FOCUS_RING}`}>
              {content}
            </pre>
          )}
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Main File Browser Page
// ---------------------------------------------------------------------------

export default function FileBrowser() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()

  // Files live on one server: the hub or one VM (Everywhere reads as the hub here)
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const pageScope = scope === 'all' ? 'hub' : scope
  const member = pageScope === 'hub' ? null : scopeMember
  const whereLabel = hasFleet ? (member ? `VM ${memberName}` : 'the hub') : ''
  const uid = useId()
  const scopeVmid = scopeMembers.find((m) => m.id === member)?.vmid

  // -------------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------------

  const [containers, setContainers] = useState<ContainerInfo[]>([])
  const [containersLoading, setContainersLoading] = useState(false)
  const [containersError, setContainersError] = useState<string | null>(null)

  const [selectedContainer, setSelectedContainer] = useState<string>('')
  const [currentPath, setCurrentPath] = useState<string>('/')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [fileContent, setFileContent] = useState<{
    path: string
    content: string
    size: number
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // -------------------------------------------------------------------------
  // Fetch running containers
  // -------------------------------------------------------------------------

  // the load a listing belongs to: a slow answer from the previous server never overwrites the current one's
  const containersLoadRef = useRef(0)
  const loadContainers = useCallback(async () => {
    if (!isConnected) return
    const load = ++containersLoadRef.current
    setContainersLoading(true)
    setContainers([])
    setContainersError(null)
    try {
      const data = await fetchContainers(member)
      if (load !== containersLoadRef.current) return
      // a hub's own list carries its VMs' containers too (tagged member): the Hub view keeps only its own
      setContainers(
        (data.containers ?? []).filter((c) => c.state === 'running' && (member ? true : !c.member)),
      )
    } catch (err) {
      if (load !== containersLoadRef.current) return
      setContainersError(err instanceof Error ? err.message : 'Could not list the containers')
    } finally {
      if (load === containersLoadRef.current) setContainersLoading(false)
    }
  }, [isConnected, member])

  useEffect(() => {
    loadContainers()
  }, [loadContainers])

  // another server: its own containers, from the top
  useEffect(() => {
    setSelectedContainer('')
    setCurrentPath('/')
    setEntries([])
    setFileContent(null)
    setError(null)
  }, [member])

  // -------------------------------------------------------------------------
  // Fetch directory listing
  // -------------------------------------------------------------------------

  const loadDirectory = useCallback(async () => {
    if (!selectedContainer || !isConnected) return
    setLoading(true)
    setError(null)
    try {
      const data: ContainerFilesResponse = await fetchContainerFilesScoped(
        member,
        selectedContainer,
        currentPath,
      )
      setEntries(data.entries ?? [])
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Failed to list directory'
      // Detect common docker exec errors
      if (msg.includes('exit code 125') || msg.includes('permission denied')) {
        setError(
          'Permission denied or container does not support file browsing. The container may lack the required binaries (ls, stat).',
        )
      } else {
        setError(msg)
      }
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [selectedContainer, currentPath, isConnected, member])

  useEffect(() => {
    loadDirectory()
  }, [loadDirectory])

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleContainerChange = useCallback(
    (name: string) => {
      setSelectedContainer(name)
      setCurrentPath('/')
      setEntries([])
      setFileContent(null)
      setError(null)
    },
    [],
  )

  const navigateTo = useCallback((path: string) => {
    setCurrentPath(path)
    setFileContent(null)
    setError(null)
  }, [])

  const navigateUp = useCallback(() => {
    if (currentPath === '/') return
    const parts = currentPath.split('/').filter(Boolean)
    parts.pop()
    navigateTo(parts.length === 0 ? '/' : '/' + parts.join('/'))
  }, [currentPath, navigateTo])

  const handleEntryClick = useCallback(
    async (entry: FileEntry) => {
      if (entry.type === 'directory') {
        const newPath =
          currentPath === '/'
            ? `/${entry.name}`
            : `${currentPath}/${entry.name}`
        navigateTo(newPath)
        return
      }

      // It's a file (or symlink) — fetch content
      setLoading(true)
      try {
        const filePath =
          currentPath === '/'
            ? `/${entry.name}`
            : `${currentPath}/${entry.name}`
        const data: ContainerFileContentResponse =
          await fetchContainerFileContentScoped(member, selectedContainer, filePath)
        setFileContent({
          path: data.path,
          content: data.content,
          size: data.size,
        })
      } catch (err: unknown) {
        const msg =
          err instanceof Error ? err.message : 'Failed to read file'
        addToast({ type: 'error', message: msg })
      } finally {
        setLoading(false)
      }
    },
    [currentPath, selectedContainer, addToast, navigateTo, member],
  )

  const handleRefresh = useCallback(() => {
    loadDirectory()
  }, [loadDirectory])

  // -------------------------------------------------------------------------
  // Derived data
  // -------------------------------------------------------------------------

  const sortedEntries = useMemo(() => sortEntries(entries), [entries])
  const breadcrumbs = useMemo(() => pathSegments(currentPath), [currentPath])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />

      <PageHeader
        page="file-browser"
        badge={hasFleet ? <VmCapsule member={member} name={memberName} vmid={scopeVmid} /> : undefined}
        subtitle={hasFleet ? `Browse files inside the running containers on ${whereLabel}` : undefined}
        actions={isConnected ? (
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loading || !selectedContainer}
            className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        ) : undefined}
      >
        {hasFleet && <FleetScopeChips scope={pageScope} members={scopeMembers} onChange={setScope} label="Files of" busy={containersLoading} everywhere={false} />}
      </PageHeader>

      {!isConnected ? (
        <EmptyState icon={<WifiOff size={28} />} title="Connect to a server to browse container files" />
      ) : (
      <>
      {/* ----------------------------------------------------------------- */}
      {/* Note                                                               */}
      {/* ----------------------------------------------------------------- */}
      <div className="rounded-xl border border-cyan-500/15 bg-cyan-500/[0.06] px-4 py-3 flex items-start gap-2.5">
        <Info size={14} className="text-cyan-400 mt-0.5 shrink-0" aria-hidden />
        <p className="text-xs text-cyan-200/90 leading-relaxed">
          Commands run as the container's default user. Some containers may not
          support file browsing.
        </p>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Container selector                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className={`${CARD} p-4`}>
        <label htmlFor={`${uid}-container`} className="text-[11px] text-slate-400 uppercase tracking-wider mb-2 block font-semibold">
          Select container{whereLabel ? ` on ${whereLabel}` : ''}
        </label>
        <div className="relative">
          <Box size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
          <select
            id={`${uid}-container`}
            value={selectedContainer}
            onChange={(e) => handleContainerChange(e.target.value)}
            disabled={containersLoading}
            className={`${INPUT} !pl-9 !pr-9 !py-2.5 !text-xs appearance-none cursor-pointer`}
          >
            <option value="" className="bg-slate-900 text-slate-400">
              {containersLoading
                ? 'Loading containers…'
                : containers.length === 0
                  ? `No running containers${whereLabel ? ` on ${whereLabel}` : ''}`
                  : 'Choose a container…'}
            </option>
            {containers.map((c) => (
              <option
                key={c.name}
                value={c.name}
                className="bg-slate-900 text-slate-200"
              >
                {c.name}
              </option>
            ))}
          </select>
          {/* Custom dropdown chevron */}
          <ChevronRight
            size={14}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none rotate-90"
            aria-hidden
          />
        </div>
        {containersError && (
          <div role="alert" className="mt-2 flex items-center justify-between gap-2 text-xs text-rose-300">
            <span className="flex items-center gap-1.5 min-w-0"><AlertTriangle size={12} className="shrink-0" aria-hidden /><span className="truncate">Could not list the containers{whereLabel ? ` on ${whereLabel}` : ''}: {containersError}</span></span>
            <button type="button" onClick={loadContainers} className={`${BTN_CARD_QUIET} ${FOCUS_RING}`}>Try again</button>
          </div>
        )}
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* Empty state — no container selected                                */}
      {/* ----------------------------------------------------------------- */}
      {!selectedContainer && (
        <EmptyState
          icon={<Search size={28} />}
          title="Select a running container above to browse its filesystem"
          hint={!containersLoading && containers.length === 0 ? 'Nothing is running here yet — start a stack and its containers show up in the list.' : undefined}
        />
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Breadcrumb path bar                                                */}
      {/* ----------------------------------------------------------------- */}
      {selectedContainer && (
        <nav aria-label="Path" className={`${CARD} px-3 sm:px-4 py-2`}>
          <div className="flex items-center gap-1 flex-wrap text-xs">
            <FolderOpen size={14} className="text-cyan-400 shrink-0 mr-1" aria-hidden />
            {breadcrumbs.map((seg, i) => (
              <span key={seg.fullPath} className="flex items-center gap-1">
                {i > 0 && (
                  <ChevronRight size={12} className="text-slate-500" aria-hidden />
                )}
                <button
                  type="button"
                  onClick={() => navigateTo(seg.fullPath)}
                  aria-current={i === breadcrumbs.length - 1 ? 'location' : undefined}
                  className={`min-h-8 px-2 rounded-lg transition-colors ${FOCUS_RING} ${
                    i === breadcrumbs.length - 1
                      ? 'text-slate-100 font-medium bg-white/[0.06]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                  }`}
                >
                  {seg.name}
                </button>
              </span>
            ))}
          </div>
        </nav>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Loading state                                                      */}
      {/* ----------------------------------------------------------------- */}
      {selectedContainer && loading && entries.length === 0 && !error && <LoadingState label="Reading the container's files…" />}

      {/* ----------------------------------------------------------------- */}
      {/* Error state                                                        */}
      {/* ----------------------------------------------------------------- */}
      {selectedContainer && error && <ErrorState title="Failed to browse files" error={error} onRetry={handleRefresh} />}

      {/* ----------------------------------------------------------------- */}
      {/* Directory listing                                                  */}
      {/* ----------------------------------------------------------------- */}
      {selectedContainer && !error && (entries.length > 0 || (!loading && entries.length === 0 && currentPath !== '/')) && (
        <div className={`${CARD} overflow-hidden`}>
          {/* Column names (the rows are buttons that read out their own cells) */}
          <div className="hidden sm:grid grid-cols-[auto_1fr_auto_auto_auto] gap-4 px-4 py-3 border-b border-white/5 text-[10px] font-semibold uppercase tracking-wider text-slate-400" aria-hidden>
            <span className="w-5" />
            <span>Name</span>
            <span className="w-20 text-right">Size</span>
            <span className="w-24 text-center">Permissions</span>
            <span className="w-32 text-right">Modified</span>
          </div>

          <div className="divide-y divide-white/[0.03]">
            {/* Parent directory (..) */}
            {currentPath !== '/' && (
              <button
                type="button"
                onClick={navigateUp}
                aria-label="Up to the parent folder"
                className={`w-full grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors group ${FOCUS_RING} focus-visible:ring-inset`}
              >
                <ArrowUp
                  size={16}
                  className="text-slate-500 group-hover:text-slate-300 transition-colors"
                  aria-hidden
                />
                <span className="text-xs text-slate-400 group-hover:text-slate-200 transition-colors font-medium">
                  ..
                </span>
                <span className="hidden sm:block w-20" />
                <span className="hidden sm:block w-24" />
                <span className="hidden sm:block w-32" />
              </button>
            )}

            {/* File/directory rows */}
            {sortedEntries.map((entry) => (
              <button
                type="button"
                key={entry.name}
                onClick={() => handleEntryClick(entry)}
                className={`w-full grid grid-cols-[auto_1fr] sm:grid-cols-[auto_1fr_auto_auto_auto] items-center gap-4 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors group ${FOCUS_RING} focus-visible:ring-inset`}
              >
                {/* Icon */}
                <span className="flex" aria-hidden>
                  {entry.type === 'directory' ? (
                    <Folder
                      size={16}
                      className="text-cyan-400/80 group-hover:text-cyan-400 transition-colors"
                    />
                  ) : entry.type === 'symlink' ? (
                    <Link
                      size={16}
                      className="text-slate-400 group-hover:text-slate-200 transition-colors"
                    />
                  ) : (
                    <FileText
                      size={16}
                      className="text-slate-500 group-hover:text-slate-300 transition-colors"
                    />
                  )}
                </span>

                {/* Name */}
                <span
                  className={`text-xs truncate transition-colors ${
                    entry.type === 'directory'
                      ? 'text-cyan-400 group-hover:text-cyan-300 font-medium'
                      : entry.type === 'symlink'
                        ? 'text-slate-300 italic group-hover:text-slate-100'
                        : 'text-slate-300 group-hover:text-slate-100'
                  }`}
                >
                  {entry.name}
                  {entry.type === 'directory' && '/'}
                </span>

                {/* Size */}
                <span className="hidden sm:block w-20 text-right text-[11px] text-slate-500 tabular-nums">
                  {entry.type === 'directory' ? '--' : formatBytes(entry.size)}
                </span>

                {/* Permissions */}
                <span className="hidden sm:block w-24 text-center">
                  <code className="text-[10px] text-slate-500 font-mono bg-white/[0.03] px-1.5 py-0.5 rounded">
                    {entry.permissions}
                  </code>
                </span>

                {/* Modified */}
                <span className="hidden sm:block w-32 text-right text-[11px] text-slate-500">
                  {entry.modified || '--'}
                </span>
              </button>
            ))}
          </div>

          {/* Empty directory */}
          {sortedEntries.length === 0 && !loading && (
            <EmptyState compact icon={<FolderOpen size={28} />} title="Directory is empty" />
          )}

          {/* Loading indicator for subsequent fetches */}
          {loading && entries.length > 0 && (
            <div className="flex items-center justify-center py-4 border-t border-white/[0.03]" role="status">
              <Loader2 size={16} className="animate-spin text-slate-500" aria-hidden />
              <span className="text-xs text-slate-500 ml-2">Loading…</span>
            </div>
          )}
        </div>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* Empty directory at root (first load, no entries, no error)         */}
      {/* ----------------------------------------------------------------- */}
      {selectedContainer &&
        !error &&
        !loading &&
        entries.length === 0 &&
        currentPath === '/' && (
          <div className={`${CARD} overflow-hidden`}>
            <EmptyState
              compact
              icon={<FolderOpen size={28} />}
              title="No entries found at the root"
              hint="The container may not support file listing."
            />
          </div>
        )}
      </>
      )}

      {/* ----------------------------------------------------------------- */}
      {/* File content viewer modal                                          */}
      {/* ----------------------------------------------------------------- */}
      {fileContent && (
        <FileViewer
          filePath={fileContent.path}
          content={fileContent.content}
          size={fileContent.size}
          where={hasFleet ? `${selectedContainer} on ${whereLabel}` : selectedContainer}
          onClose={() => setFileContent(null)}
        />
      )}
    </div>
  )
}
