// =============================================================================
// ContainerFileBrowser — Tree-style file browser for running Docker containers
// =============================================================================

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'
import { fetchContainerFilesOn, fetchContainerFileContentOn } from '../../api/fleetScoped'
import type { ContainerFileEntry } from '../../../shared/types'
import type { RowMember } from '../../../shared/fleetScoped'
import { useModalA11y } from '../../hooks/useModalA11y'
import Hint from '../common/Hint'
import { EmptyState } from '../common/PageState'
import { BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM, TONE_QUIET, TONE_DANGER } from '../../lib/ui'
import { Folder, File, FileText, ChevronRight, ArrowLeft, Download, RefreshCw, AlertCircle, FolderOpen, FileCode, FileJson } from 'lucide-react'
import CloseButton from '../common/CloseButton'
// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  containerName: string
  /** The server the container runs on: a fleet member id rides the hub's proxy; null or undefined = this server */
  member?: RowMember
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format raw byte count to human-readable KB/MB/GB. */
function formatSize(bytes: number): string {
  if (bytes < 0) return '--'
  if (bytes === 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** Get the file extension from a filename. */
function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  if (dot === -1 || dot === 0) return ''
  return name.slice(dot + 1).toLowerCase()
}

/** Choose the appropriate icon component for a file entry. */
function FileIcon({ entry }: { entry: ContainerFileEntry }) {
  if (entry.type === 'directory') {
    return <Folder className="h-4 w-4 text-emerald-400 flex-shrink-0" />
  }
  if (entry.type === 'symlink') {
    return <File className="h-4 w-4 text-cyan-400 flex-shrink-0" />
  }
  const ext = getExtension(entry.name)
  if (ext === 'json') {
    return <FileJson className="h-4 w-4 text-teal-400 flex-shrink-0" />
  }
  if (['sh', 'bash', 'zsh', 'py', 'js', 'ts', 'rb', 'go', 'rs', 'lua', 'pl'].includes(ext)) {
    return <FileCode className="h-4 w-4 text-purple-400 flex-shrink-0" />
  }
  return <FileText className="h-4 w-4 text-slate-400 flex-shrink-0" />
}

/** Map file extension to a syntax-hint label for the content viewer. */
function getSyntaxLabel(name: string): string {
  const ext = getExtension(name)
  const map: Record<string, string> = {
    json: 'JSON',
    yml: 'YAML',
    yaml: 'YAML',
    toml: 'TOML',
    ini: 'INI',
    conf: 'Config',
    cfg: 'Config',
    properties: 'Properties',
    sh: 'Shell',
    bash: 'Shell',
    zsh: 'Shell',
    py: 'Python',
    js: 'JavaScript',
    ts: 'TypeScript',
    rb: 'Ruby',
    go: 'Go',
    rs: 'Rust',
    lua: 'Lua',
    pl: 'Perl',
    xml: 'XML',
    html: 'HTML',
    css: 'CSS',
    sql: 'SQL',
    md: 'Markdown',
    env: 'Env',
    log: 'Log',
    txt: 'Text',
    csv: 'CSV',
  }
  return map[ext] || 'Plain'
}

/** Build path segments for breadcrumb navigation. */
function buildBreadcrumbs(path: string): Array<{ label: string; path: string }> {
  const crumbs: Array<{ label: string; path: string }> = [{ label: '/', path: '/' }]
  if (path === '/') return crumbs

  const parts = path.split('/').filter(Boolean)
  let accumulated = ''
  for (const part of parts) {
    accumulated += '/' + part
    crumbs.push({ label: part, path: accumulated })
  }
  return crumbs
}

/** Determine the color class for an entry name based on its type. */
function entryNameColor(entry: ContainerFileEntry): string {
  if (entry.type === 'directory') return 'text-emerald-400'
  if (entry.type === 'symlink') return 'text-cyan-400'
  return 'text-slate-300'
}

/** Resolve the parent directory of a given path. */
function parentPath(path: string): string {
  if (path === '/') return '/'
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  const lastSlash = trimmed.lastIndexOf('/')
  if (lastSlash <= 0) return '/'
  return trimmed.slice(0, lastSlash)
}

// ---------------------------------------------------------------------------
// Skeleton Rows (loading state)
// ---------------------------------------------------------------------------

function SkeletonRows({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <tr key={i} className="border-b border-white/[0.03]">
          <td className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="h-4 w-4 rounded bg-white/[0.06] animate-pulse" />
              <div
                className="h-3.5 rounded bg-white/[0.06] animate-pulse"
                style={{ width: `${60 + Math.random() * 120}px` }}
              />
            </div>
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-12 rounded bg-white/5 animate-pulse" />
          </td>
          <td className="px-4 py-3">
            <div className="h-3 w-14 rounded bg-white/5 animate-pulse" />
          </td>
          <td className="px-4 py-3 hidden md:table-cell">
            <div className="h-3 w-20 rounded bg-white/5 animate-pulse" />
          </td>
          <td className="px-4 py-3 hidden lg:table-cell">
            <div className="h-3 w-28 rounded bg-white/5 animate-pulse" />
          </td>
        </tr>
      ))}
    </>
  )
}

// ---------------------------------------------------------------------------
// File Content Viewer Overlay
// ---------------------------------------------------------------------------

interface FileViewerProps {
  containerName: string
  member?: RowMember
  filePath: string
  fileName: string
  onClose: () => void
}

function FileViewer({ containerName, member = null, filePath, fileName, onClose }: FileViewerProps) {
  const [content, setContent] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number>(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const overlayRef = useRef<HTMLDivElement>(null)

  const syntaxLabel = getSyntaxLabel(fileName)

  // Load file content
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    setContent(null)

    fetchContainerFileContentOn(containerName, filePath, member)
      .then((res) => {
        if (!cancelled) {
          setContent(res.content)
          setFileSize(res.size)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err)
          if (msg.toLowerCase().includes('permission')) {
            setError('Permission denied: unable to read this file.')
          } else if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('404')) {
            setError('File not found: the file may have been removed or renamed.')
          } else {
            setError(msg || 'Failed to read file content.')
          }
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [containerName, filePath])

  // Escape closes, focus stays inside and returns to what opened it
  useModalA11y(overlayRef, onClose)

  // Close on backdrop click
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose],
  )

  // Download file as blob
  const handleDownload = useCallback(() => {
    if (content === null) return
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = fileName
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [content, fileName])

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="
        fixed inset-0 z-[9999]
        flex items-center justify-center
        bg-black/70 backdrop-blur-sm
        animate-fade-in
      "
    >
      <div
        className="
          relative
          w-full max-w-4xl mx-4 max-h-[85vh]
          bg-slate-900/95 backdrop-blur-2xl
          border border-white/10 rounded-2xl
          shadow-2xl shadow-black/50
          flex flex-col overflow-hidden
          animate-fade-in
        "
        role="dialog"
        aria-modal="true"
        aria-labelledby="file-viewer-title"
      >
        {/* Title bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FileIcon entry={{ name: fileName, type: 'file', size: 0, permissions: '', modified: '' }} />
            <div className="min-w-0">
              <h2
                id="file-viewer-title"
                className="text-sm font-semibold text-slate-200 truncate"
                title={filePath}
              >
                {fileName}
              </h2>
              <p className="text-[11px] text-slate-400 font-mono truncate" title={filePath}>
                {filePath}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Syntax label badge */}
            <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-cyan-500/10 text-cyan-400 ring-1 ring-cyan-500/20">
              {syntaxLabel}
            </span>
            {/* Size badge */}
            {!loading && !error && (
              <span className="text-[10px] text-slate-500 font-mono">
                {formatSize(fileSize)}
              </span>
            )}
            {/* Download button */}
            <button onClick={handleDownload} disabled={content === null} className={BTN_TOOLBAR_QUIET}>
              <Download size={14} />
              <span className="hidden sm:inline">Download</span>
              <span className="sm:hidden sr-only">Download</span>
            </button>
            {/* Close button */}
            <Hint label="Close">
              <CloseButton label="Close file viewer" onClick={onClose} />
            </Hint>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-hidden">
          {loading && (
            <div role="status" className="flex items-center justify-center h-64 gap-3">
              <RefreshCw className="h-5 w-5 text-emerald-400 animate-spin" />
              <span className="text-sm text-slate-400">Reading the file…</span>
            </div>
          )}

          {error && (
            <div role="alert" className="flex flex-col items-center justify-center h-64 gap-3 px-6">
              <AlertCircle className="h-8 w-8 text-rose-400" />
              <p className="text-sm text-rose-300 text-center">{error}</p>
            </div>
          )}

          {!loading && !error && content !== null && (
            <pre
              tabIndex={0}
              aria-label={`Contents of ${fileName}`}
              className="
                px-6 py-5
                text-[12px] leading-relaxed font-mono text-slate-300
                whitespace-pre-wrap break-words
                overflow-auto max-h-[calc(85vh-130px)]
                scrollbar-thin
                selection:bg-emerald-500/30
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40
              "
            >
              {content || '(empty file)'}
            </pre>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// ContainerFileBrowser Component
// ---------------------------------------------------------------------------

const ContainerFileBrowser: React.FC<Props> = ({ containerName, member = null }) => {
  const [currentPath, setCurrentPath] = useState('/')
  const [entries, setEntries] = useState<ContainerFileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  // File viewer overlay state
  const [viewingFile, setViewingFile] = useState<{ path: string; name: string } | null>(null)

  // Sort entries: directories first, then alphabetical
  const sortedEntries = [...entries].sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1
    if (a.type !== 'directory' && b.type === 'directory') return 1
    return a.name.localeCompare(b.name)
  })

  const breadcrumbs = buildBreadcrumbs(currentPath)
  const isRoot = currentPath === '/'

  // Fetch directory listing
  const fetchDirectory = useCallback(
    async (path: string) => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetchContainerFilesOn(containerName, path, member)
        setEntries(res.entries)
        setCurrentPath(res.path || path)
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err)
        if (msg.toLowerCase().includes('permission')) {
          setError('Permission denied: cannot list this directory.')
        } else if (msg.toLowerCase().includes('not found') || msg.toLowerCase().includes('404')) {
          setError('Directory not found.')
        } else {
          setError(msg || 'Failed to list directory contents.')
        }
        setEntries([])
      } finally {
        setLoading(false)
      }
    },
    [containerName, member],
  )

  // Initial load
  useEffect(() => {
    fetchDirectory('/')
  }, [fetchDirectory])

  // Navigate into a directory
  const navigateTo = useCallback(
    (path: string) => {
      fetchDirectory(path)
    },
    [fetchDirectory],
  )

  // Navigate to parent
  const navigateUp = useCallback(() => {
    if (!isRoot) {
      navigateTo(parentPath(currentPath))
    }
  }, [currentPath, isRoot, navigateTo])

  // Handle clicking an entry row
  const handleEntryClick = useCallback(
    (entry: ContainerFileEntry) => {
      if (entry.type === 'directory') {
        const target = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`
        navigateTo(target)
      } else {
        // File or symlink — open viewer
        const target = currentPath === '/' ? `/${entry.name}` : `${currentPath}/${entry.name}`
        setViewingFile({ path: target, name: entry.name })
      }
    },
    [currentPath, navigateTo],
  )

  // Refresh current directory
  const handleRefresh = useCallback(() => {
    fetchDirectory(currentPath)
  }, [fetchDirectory, currentPath])

  return (
    <>
      <section className="animate-fade-in">
        <div className="bg-slate-900/60 backdrop-blur-xl border border-white/5 rounded-xl overflow-hidden">
          {/* Header with collapse toggle */}
          <button
            onClick={() => setCollapsed(!collapsed)}
            aria-expanded={!collapsed}
            className="flex items-center gap-2 w-full px-5 py-4 hover:bg-white/[0.03] transition-colors"
          >
            <FolderOpen className="h-4 w-4 text-emerald-400" />
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              File browser
            </h2>
            <ChevronRight
              className={`h-4 w-4 text-slate-500 ml-auto transition-transform duration-200 ${
                collapsed ? 'rotate-0' : 'rotate-90'
              }`}
            />
          </button>

          {!collapsed && (
            <div className="px-5 pb-5 space-y-4">
              {/* Toolbar: breadcrumbs + actions */}
              <div className="flex items-center gap-3 flex-wrap">
                {/* Back / parent directory button */}
                <Hint label="Go to the parent directory">
                  <button onClick={navigateUp} disabled={isRoot || loading} className={BTN_CARD_QUIET}>
                    <ArrowLeft size={12} />
                    Up
                  </button>
                </Hint>

                {/* Breadcrumb navigation */}
                <nav aria-label="Path" className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto scrollbar-none">
                  {breadcrumbs.map((crumb, idx) => {
                    const isLast = idx === breadcrumbs.length - 1
                    return (
                      <React.Fragment key={crumb.path}>
                        {idx > 0 && (
                          <ChevronRight className="h-3 w-3 text-slate-500 flex-shrink-0" aria-hidden="true" />
                        )}
                        <button
                          onClick={() => !isLast && navigateTo(crumb.path)}
                          disabled={isLast || loading}
                          aria-current={isLast ? 'location' : undefined}
                          className={`
                            min-w-7 px-1.5 py-1.5 rounded text-xs font-mono text-center flex-shrink-0
                            transition-colors duration-150
                            ${isLast
                              ? 'text-slate-200 font-semibold cursor-default'
                              : 'text-slate-400 hover:text-emerald-400 hover:bg-white/5'
                            }
                          `}
                          title={crumb.path}
                        >
                          {crumb.label}
                        </button>
                      </React.Fragment>
                    )
                  })}
                </nav>

                {/* Refresh button */}
                <Hint label="Refresh the directory">
                  <button onClick={handleRefresh} disabled={loading} className={`${BTN_ICON_SM} ${TONE_QUIET}`} aria-label="Refresh the directory">
                    <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  </button>
                </Hint>
              </div>

              {/* Error banner */}
              {error && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-rose-500/10 border border-rose-500/20 px-4 py-3">
                  <AlertCircle className="h-5 w-5 text-rose-400 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-rose-300 break-words">{error}</p>
                  </div>
                  <button onClick={handleRefresh} className={`${BTN_CARD} ${TONE_DANGER}`}>
                    <RefreshCw size={12} />
                    Try again
                  </button>
                </div>
              )}

              {/* File listing table */}
              <div className="overflow-x-auto scrollbar-thin rounded-lg border border-white/[0.03]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5">
                        Name
                      </th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5 w-20">
                        Type
                      </th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5 w-24">
                        Size
                      </th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5 w-28 hidden md:table-cell">
                        Permissions
                      </th>
                      <th scope="col" className="text-left text-slate-400 uppercase tracking-wider font-semibold px-4 py-2.5 w-40 hidden lg:table-cell">
                        Modified
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading && entries.length === 0 && <SkeletonRows />}

                    {!loading && !error && sortedEntries.length === 0 && (
                      <tr>
                        <td colSpan={5}>
                          <EmptyState compact icon={<FolderOpen size={28} />} title="This directory is empty." />
                        </td>
                      </tr>
                    )}

                    {!loading &&
                      sortedEntries.map((entry, idx) => (
                        <tr
                          key={entry.name}
                          onClick={() => handleEntryClick(entry)}
                          className={`
                            border-b border-white/[0.03]
                            hover:bg-white/[0.03]
                            cursor-pointer
                            transition-colors duration-150
                            animate-fade-in
                            ${idx % 2 === 0 ? 'bg-white/[0.01]' : 'bg-transparent'}
                          `}
                          style={{ animationDelay: `${Math.min(idx * 15, 300)}ms` }}
                        >
                          {/* Name */}
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-3 min-w-0">
                              <FileIcon entry={entry} />
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleEntryClick(entry) }}
                                className={`font-mono truncate rounded text-left ${entryNameColor(entry)}`}
                                title={entry.name}
                              >
                                {entry.name}
                                {entry.type === 'directory' && '/'}
                              </button>
                            </div>
                          </td>

                          {/* Type */}
                          <td className="px-4 py-2.5">
                            <span
                              className={`
                                inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide
                                ${entry.type === 'directory'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : entry.type === 'symlink'
                                    ? 'bg-cyan-500/10 text-cyan-400'
                                    : 'bg-slate-500/10 text-slate-400'
                                }
                              `}
                            >
                              {entry.type === 'directory' ? 'dir' : entry.type === 'symlink' ? 'link' : 'file'}
                            </span>
                          </td>

                          {/* Size */}
                          <td className="px-4 py-2.5 font-mono text-slate-400">
                            {entry.type === 'directory' ? '--' : formatSize(entry.size)}
                          </td>

                          {/* Permissions */}
                          <td className="px-4 py-2.5 font-mono text-slate-500 hidden md:table-cell">
                            {entry.permissions || '--'}
                          </td>

                          {/* Modified */}
                          <td className="px-4 py-2.5 text-slate-500 hidden lg:table-cell">
                            {entry.modified || '--'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>

              {/* Footer info: entry count */}
              {!loading && !error && entries.length > 0 && (
                <div className="flex items-center justify-between text-[10px] text-slate-500 px-1">
                  <span>
                    {sortedEntries.filter((e) => e.type === 'directory').length} directories,{' '}
                    {sortedEntries.filter((e) => e.type !== 'directory').length} files
                  </span>
                  <span className="font-mono">{currentPath}</span>
                </div>
              )}
            </div>
          )}
        </div>
      </section>

      {/* File content viewer overlay */}
      {viewingFile && (
        <FileViewer
          containerName={containerName}
          member={member}
          filePath={viewingFile.path}
          fileName={viewingFile.name}
          onClose={() => setViewingFile(null)}
        />
      )}
    </>
  )
}

export default ContainerFileBrowser
