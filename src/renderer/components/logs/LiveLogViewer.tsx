// =============================================================================
// LiveLogViewer — Real-time log tailing with auto-scroll, search, level colors
// =============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Pause, Download, Trash2, ArrowDown, Filter, RefreshCw, AlertTriangle, AlertCircle, Info, Bug } from 'lucide-react'
import { fetchContainerLogsLiveOn, fetchAppLogsLiveOn } from '../../api/fleetScoped'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { LoadingState, EmptyState } from '../common/PageState'
import Hint from '../common/Hint'
import { BTN_CARD, BTN_CARD_QUIET, BTN_ICON_SM, TONE_QUIET, FOCUS_RING } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'
import type { LogStreamEntry, LiveLogsResponse } from '../../../shared/types'
import type { RowMember } from '../../../shared/fleetScoped'

import SearchInput from '../common/SearchInput'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LiveLogViewerProps {
  /** Container name (omit for DCS app logs) */
  containerName?: string
  /** The server whose log this is: a fleet member id polls that VM through the hub's proxy (streams cannot ride it); null or undefined = this server */
  member?: RowMember
  /** Number of initial lines to fetch */
  initialLines?: number
  /** Polling interval in ms */
  pollInterval?: number
  /** Max lines to keep in buffer */
  maxLines?: number
}

type LogLevel = 'error' | 'warn' | 'info' | 'debug' | 'unknown'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function detectLevel(entry: LogStreamEntry): LogLevel {
  if (entry.level) {
    const l = entry.level.toLowerCase()
    if (l.includes('error') || l.includes('fatal') || l.includes('crit')) return 'error'
    if (l.includes('warn')) return 'warn'
    if (l.includes('info') || l.includes('notice')) return 'info'
    if (l.includes('debug') || l.includes('trace')) return 'debug'
  }
  // Fallback: check the line content
  const line = entry.line.toLowerCase()
  if (/\b(error|fatal|crit|exception|panic)\b/.test(line)) return 'error'
  if (/\b(warn|warning)\b/.test(line)) return 'warn'
  if (/\b(info|notice)\b/.test(line)) return 'info'
  if (/\b(debug|trace)\b/.test(line)) return 'debug'
  return 'unknown'
}

const levelConfig: Record<LogLevel, { color: string; bg: string; icon: React.ReactNode; label: string }> = {
  error: {
    color: 'text-rose-400',
    bg: 'bg-rose-500/8 border-l-2 border-l-rose-500/40',
    icon: <AlertCircle size={12} />,
    label: 'ERROR',
  },
  warn: {
    color: 'text-amber-400',
    bg: 'bg-amber-500/5 border-l-2 border-l-amber-500/30',
    icon: <AlertTriangle size={12} />,
    label: 'WARN',
  },
  info: {
    color: 'text-cyan-400',
    bg: 'border-l-2 border-l-transparent',
    icon: <Info size={12} />,
    label: 'INFO',
  },
  debug: {
    color: 'text-slate-500',
    bg: 'border-l-2 border-l-transparent opacity-60',
    icon: <Bug size={12} />,
    label: 'DEBUG',
  },
  unknown: {
    color: 'text-slate-400',
    bg: 'border-l-2 border-l-transparent',
    icon: null,
    label: '',
  },
}

function formatTimestamp(ts: string): string {
  if (!ts) return ''
  try {
    const d = new Date(ts)
    return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
  } catch {
    return ts.slice(11, 19)
  }
}

/** what a log line is told apart by from one poll to the next */
function entryKey(e: LogStreamEntry): string { return `${e.timestamp}\n${e.line}` }
/** how many times each line appears in a batch (a line that repeats within one second is logged that often) */
function batchCounts(entries: LogStreamEntry[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const e of entries) { const k = entryKey(e); m.set(k, (m.get(k) ?? 0) + 1) }
  return m
}

// ---------------------------------------------------------------------------
// LiveLogViewer
// ---------------------------------------------------------------------------

export default function LiveLogViewer({
  containerName,
  member = null,
  initialLines = 100,
  pollInterval = 2000,
  maxLines = 5000,
}: LiveLogViewerProps) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  const [lines, setLines] = useState<LogStreamEntry[]>([])
  const [isLive, setIsLive] = useState(true)
  const [search, setSearch] = useState('')
  const [levelFilter, setLevelFilter] = useState<LogLevel | 'all'>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const [loading, setLoading] = useState(true)
  const [showFilters, setShowFilters] = useState(false)

  const scrollRef = useRef<HTMLDivElement>(null)
  const lastTimestampRef = useRef<string>('')
  // the last batch's lines by key and count: the next poll asks `since` that timestamp inclusive, so
  // every line of that second comes back once more and is dropped once per copy already shown
  const lastBatchRef = useRef<Map<string, number>>(new Map())
  // the first page is in: the live tail asks only for what came after it
  const primedRef = useRef(false)
  const userScrolledRef = useRef(false)

  // Fetch function
  const fetchLogs = useCallback(async (since?: string) => {
    try {
      let data: LiveLogsResponse
      if (containerName) {
        data = await fetchContainerLogsLiveOn(containerName, member, since ? 50 : initialLines, since)
      } else {
        data = await fetchAppLogsLiveOn(member, since ? 50 : initialLines, since)
      }
      return data
    } catch {
      return null
    }
  }, [containerName, member, initialLines])

  // Initial fetch
  useEffect(() => {
    if (!isConnected) return
    setLoading(true)
    primedRef.current = false
    fetchLogs().then((data) => {
      primedRef.current = true
      if (data?.entries) {
        setLines(data.entries)
        lastBatchRef.current = batchCounts(data.entries)
        const last = data.entries[data.entries.length - 1]
        if (last?.timestamp) lastTimestampRef.current = last.timestamp
      }
      setLoading(false)
    })
  }, [isConnected, fetchLogs])

  // Live polling: what came after the last line, every pollInterval while live
  const tail = useCallback(async () => {
    if (!primedRef.current) return
    const data = await fetchLogs(lastTimestampRef.current || undefined)
    if (data?.entries && data.entries.length > 0) {
      // Deduplicate against the whole last batch, not only its last line: `since` is inclusive to the
      // second, so every line of that second comes back (the server filters most of it now that it
      // takes its own stamp; what remains is dropped here, once per copy already shown)
      const seen = new Map(lastBatchRef.current)
      const newEntries = data.entries.filter((e) => {
        const k = entryKey(e)
        const n = seen.get(k) ?? 0
        if (n > 0) { seen.set(k, n - 1); return false }
        return true
      })
      lastBatchRef.current = batchCounts(data.entries)
      const last = data.entries[data.entries.length - 1]
      if (last?.timestamp) lastTimestampRef.current = last.timestamp
      if (newEntries.length === 0) return
      setLines((prev) => {
        const combined = [...prev, ...newEntries]
        if (combined.length > maxLines) {
          return combined.slice(combined.length - maxLines)
        }
        return combined
      })
    }
  }, [fetchLogs, maxLines])
  usePolling(tail, pollInterval, { enabled: isLive })

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && !userScrolledRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [lines, autoScroll])

  // Detect user scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50
    userScrolledRef.current = !isAtBottom
    setAutoScroll(isAtBottom)
  }, [])

  // Scroll to bottom
  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      setAutoScroll(true)
      userScrolledRef.current = false
    }
  }, [])

  // Filter entries
  const filteredLines = useMemo(() => {
    return lines.filter((entry) => {
      // Level filter
      if (levelFilter !== 'all') {
        const level = detectLevel(entry)
        if (level !== levelFilter) return false
      }
      // Search filter
      if (search.trim()) {
        const q = search.toLowerCase()
        if (!entry.line.toLowerCase().includes(q)) return false
      }
      return true
    })
  }, [lines, levelFilter, search])

  // Export logs
  const handleExport = useCallback(() => {
    const text = filteredLines.map((e) => `${e.timestamp || ''} ${e.line}`).join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `logs-${member ? `${member}-` : ''}${containerName || 'app'}-${new Date().toISOString().slice(0, 19)}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }, [filteredLines, containerName, member])

  // Clear buffer
  const handleClear = useCallback(() => {
    setLines([])
    lastTimestampRef.current = ''
    lastBatchRef.current = new Map()
  }, [])

  // Level counts
  const levelCounts = useMemo(() => {
    const counts = { error: 0, warn: 0, info: 0, debug: 0, unknown: 0 }
    for (const entry of lines) {
      counts[detectLevel(entry)]++
    }
    return counts
  }, [lines])

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const LEVEL_NAME: Record<LogLevel, string> = { error: 'errors', warn: 'warnings', info: 'info lines', debug: 'debug lines', unknown: 'other lines' }

  return (
    <div className={`${CARD} relative flex flex-col h-full overflow-hidden`}>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 sm:px-4 py-2.5 border-b border-white/5 shrink-0">
        <div className="flex flex-wrap items-center gap-2">
          {/* Live toggle */}
          <button
            type="button"
            onClick={() => setIsLive(!isLive)}
            aria-pressed={isLive}
            className={`${BTN_CARD} border ${FOCUS_RING} ${
              isLive
                ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25 hover:bg-emerald-500/25'
                : 'bg-white/[0.03] text-slate-400 border-white/10 hover:bg-white/5'
            }`}
          >
            {isLive ? (
              <>
                <span className="relative flex h-2 w-2" aria-hidden>
                  <span className="absolute inset-0 rounded-full bg-emerald-400 opacity-50 animate-ping" style={{ animationDuration: '2s' }} />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
                </span>
                Live
              </>
            ) : (
              <>
                <Pause size={12} aria-hidden />
                Paused
              </>
            )}
          </button>

          {/* Level filter badges */}
          {levelCounts.error > 0 && (
            <button
              type="button"
              aria-pressed={levelFilter === 'error'}
              aria-label={`Show only errors (${levelCounts.error})`}
              onClick={() => setLevelFilter(levelFilter === 'error' ? 'all' : 'error')}
              className={`${BTN_CARD} font-semibold ${FOCUS_RING} ${
                levelFilter === 'error'
                  ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                  : 'bg-rose-500/10 text-rose-300/80 border border-rose-500/15 hover:bg-rose-500/15'
              }`}
            >
              <AlertCircle size={12} aria-hidden />
              {levelCounts.error}
            </button>
          )}
          {levelCounts.warn > 0 && (
            <button
              type="button"
              aria-pressed={levelFilter === 'warn'}
              aria-label={`Show only warnings (${levelCounts.warn})`}
              onClick={() => setLevelFilter(levelFilter === 'warn' ? 'all' : 'warn')}
              className={`${BTN_CARD} font-semibold ${FOCUS_RING} ${
                levelFilter === 'warn'
                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  : 'bg-amber-500/10 text-amber-300/80 border border-amber-500/15 hover:bg-amber-500/15'
              }`}
            >
              <AlertTriangle size={12} aria-hidden />
              {levelCounts.warn}
            </button>
          )}

          {/* Line count */}
          <span className="text-[11px] text-slate-500 tabular-nums" role="status">
            {filteredLines.length} / {lines.length} lines
          </span>
        </div>

        <div className="flex items-center gap-1.5 w-full sm:w-auto">
          {/* Search */}
          <div className="relative flex-1 sm:flex-none">
            <SearchInput size="sm" value={search} onChange={setSearch} label="Filter the lines" placeholder="Filter…" className="sm:w-40 sm:focus-within:w-56" />
          </div>

          {/* Filter dropdown */}
          <Hint label="Level filter">
            <button
              type="button"
              aria-label="Level filter"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
              className={`${BTN_ICON_SM} border ${FOCUS_RING} ${
                levelFilter !== 'all'
                  ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25'
                  : TONE_QUIET
              }`}
            >
              <Filter size={12} />
            </button>
          </Hint>

          {/* Export */}
          <Hint label="Export the lines">
            <button
              type="button"
              aria-label="Export the lines"
              onClick={handleExport}
              className={`${BTN_ICON_SM} ${TONE_QUIET} ${FOCUS_RING}`}
            >
              <Download size={12} />
            </button>
          </Hint>

          {/* Clear */}
          <Hint label="Clear the buffer">
            <button
              type="button"
              aria-label="Clear the buffer"
              onClick={handleClear}
              className={`${BTN_ICON_SM} ${TONE_QUIET} hover:text-rose-300 ${FOCUS_RING}`}
            >
              <Trash2 size={12} />
            </button>
          </Hint>
        </div>
      </div>

      {/* Level filter dropdown */}
      {showFilters && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 sm:px-4 py-2 border-b border-white/5 bg-white/[0.03]">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-2">Level</span>
          {(['all', 'error', 'warn', 'info', 'debug'] as const).map((level) => (
            <button
              type="button"
              key={level}
              aria-pressed={levelFilter === level}
              onClick={() => { setLevelFilter(level); setShowFilters(false) }}
              className={`${BTN_CARD} font-medium ${FOCUS_RING} ${
                levelFilter === level
                  ? 'bg-white/[0.08] text-slate-100 border border-white/15'
                  : 'bg-white/[0.03] text-slate-400 border border-white/10 hover:bg-white/5'
              }`}
              title={level === 'all' ? undefined : `Only ${LEVEL_NAME[level]}`}
            >
              {level === 'all' ? 'All' : level.toUpperCase()}
            </button>
          ))}
        </div>
      )}

      {/* Log output */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto scrollbar-thin font-mono text-[11px] leading-relaxed"
      >
        {loading && <LoadingState compact label="Reading the log…" />}

        {!loading && filteredLines.length === 0 && (
          <EmptyState
            compact
            icon={<RefreshCw size={28} />}
            title={search || levelFilter !== 'all' ? 'No lines match your filter' : 'Waiting for log output…'}
          />
        )}

        {filteredLines.map((entry, idx) => {
          const level = detectLevel(entry)
          const cfg = levelConfig[level]
          return (
            <div
              key={`${entry.timestamp}-${idx}`}
              className={`flex items-start gap-2 px-3 sm:px-4 py-0.5 hover:bg-white/[0.03] ${cfg.bg} transition-colors`}
            >
              {/* Timestamp */}
              {entry.timestamp && (
                <span className="text-slate-500 shrink-0 select-none tabular-nums">
                  {formatTimestamp(entry.timestamp)}
                </span>
              )}

              {/* Level badge */}
              {cfg.label && (
                <span className={`shrink-0 flex items-center gap-0.5 ${cfg.color} select-none w-12`}>
                  {cfg.icon}
                  <span className="text-[10px] font-bold">{cfg.label}</span>
                </span>
              )}

              {/* Log line */}
              <span className={`flex-1 break-all ${level === 'error' ? 'text-rose-300' : level === 'warn' ? 'text-amber-300' : 'text-slate-300'}`}>
                {search ? highlightSearch(entry.line, search) : entry.line}
              </span>
            </div>
          )
        })}
      </div>

      {/* Scroll to bottom FAB */}
      {!autoScroll && (
        <div className="absolute bottom-4 right-4">
          <button
            type="button"
            onClick={scrollToBottom}
            className={`${BTN_CARD_QUIET} !h-9 bg-slate-800/90 shadow-lg animate-fade-in ${FOCUS_RING}`}
          >
            <ArrowDown size={12} aria-hidden />
            Scroll to bottom
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Search highlight helper
// ---------------------------------------------------------------------------

function highlightSearch(text: string, query: string): React.ReactNode {
  if (!query.trim()) return text
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, 'gi'))
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase()
      ? <mark key={`${i}-${part}`} className="bg-amber-500/30 text-amber-200 rounded px-0.5">{part}</mark>
      : part
  )
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
