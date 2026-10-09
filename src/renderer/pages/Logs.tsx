// =============================================================================
// Logs — the framework log with level filtering, colour coding, search and
// export; a live tail; and the archived (rotated) logs. Stats on demand.
// On a hub: the hub's own log or one VM's.
// =============================================================================

import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { SegmentedControl } from '@mantine/core'
import {
  ScrollText, Search, ArrowDownToLine, RefreshCw, FileText,
  Download, Copy, Check, Filter, X, BarChart3, Archive, ChevronDown,
  Radio,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useFleetScope } from '../hooks/useFleetScope'
import { fetchLogStats } from '../api/endpoints'
import { fetchLogsOn, fetchLogArchivesOn } from '../api/fleetScoped'
import LiveLogViewer from '../components/logs/LiveLogViewer'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import type { LogsResponse, LogStatsResponse, LogArchivesResponse } from '../../shared/types'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { ErrorState, EmptyState, LoadingState } from '../components/common/PageState'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD_QUIET, BTN_ICON_SM, TONE_QUIET, TONE_GHOST } from '../lib/ui'
import { CARD, SEARCH_FIELD, FOCUS_RING } from '../lib/pageKit'

// ---------------------------------------------------------------------------
// Log level config
// ---------------------------------------------------------------------------

const LOG_LEVELS = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'DEBUG', 'CRITICAL', 'TIMING', 'STEP', 'FOCUS', 'STATUS'] as const

const LINE_COUNT_OPTIONS = [100, 500, 1000, 2000, 5000] as const

const levelColors: Record<string, { text: string; bg: string; border: string }> = {
  INFO: { text: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/20' },
  SUCCESS: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  WARNING: { text: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  ERROR: { text: 'text-rose-400', bg: 'bg-rose-500/10', border: 'border-rose-500/20' },
  DEBUG: { text: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/20' },
  CRITICAL: { text: 'text-rose-500', bg: 'bg-rose-500/15', border: 'border-rose-500/20' },
  TIMING: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  STEP: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  FOCUS: { text: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/20' },
  STATUS: { text: 'text-cyan-300', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
}

/** Map level names to the stat-level key used in LogStatsResponse */
const levelStatKey: Record<string, keyof LogStatsResponse['levels']> = {
  ERROR: 'error',
  CRITICAL: 'critical',
  WARNING: 'warning',
  SUCCESS: 'success',
  INFO: 'info',
  DEBUG: 'debug',
  STEP: 'step',
  TIMING: 'timing',
}

function getLineLevel(line: string): string | null {
  const match = line.match(/\[([A-Z]+)\]/)
  if (match && match[1] in levelColors) return match[1]
  return null
}

function getLineColorClass(line: string): string {
  const level = getLineLevel(line)
  if (!level) return 'text-slate-400'
  return levelColors[level]?.text ?? 'text-slate-400'
}

// ---------------------------------------------------------------------------
// Tab type
// ---------------------------------------------------------------------------

type TabId = 'logs' | 'live' | 'archives'

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Logs() {
  const [searchQuery, setSearchQuery] = useState('')
  const [serverSearch] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const [activeLevels, setActiveLevels] = useState<Set<string>>(new Set())
  const [showFilters, setShowFilters] = useState(false)
  const [copied, setCopied] = useState(false)
  const [lineCount, setLineCount] = useState(500)
  const [serverLevel, setServerLevel] = useState('')
  const [showStats, setShowStats] = useState(false)
  const [activeTab, setActiveTab] = useState<TabId>('logs')
  const logContainerRef = useRef<HTMLDivElement>(null)

  // Stats & archives state (fetched on demand)
  const [stats, setStats] = useState<LogStatsResponse | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [statsError, setStatsError] = useState<Error | null>(null)
  const [archives, setArchives] = useState<LogArchivesResponse | null>(null)
  const [archivesLoading, setArchivesLoading] = useState(false)
  const [archivesError, setArchivesError] = useState<Error | null>(null)


  // a hub: the hub's own framework log or one VM's (through the hub's proxy, polled — streams do not ride it);
  // Everywhere is a view of lists, so here it shows the hub's log and says a VM's is one chip away
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()

  // Server-side filtered fetch function, tagged with the server it asked so a switch never shows the old log under the new label
  const fetchFn = useCallback(async () => ({
    member: scopeMember,
    res: await fetchLogsOn({
      lines: lineCount,
      level: serverLevel || undefined,
      search: serverSearch || undefined,
    }, scopeMember),
  }), [lineCount, serverLevel, serverSearch, scopeMember])

  const { data: tagged, loading: polling, error, refresh } = usePolling<{ member: string | null; res: LogsResponse }>(fetchFn, scopeMember ? 5000 : 3000)
  const data = tagged && tagged.member === scopeMember ? tagged.res : null
  const loading = polling || !data
  const memberRef = useRef(scopeMember)
  useEffect(() => { if (memberRef.current !== scopeMember) { memberRef.current = scopeMember; refresh() } }, [scopeMember, refresh])

  const rawLogs = data?.logs ?? ''

  // Split into lines for filtering and counting
  const allLines = useMemo(() => {
    if (!rawLogs) return []
    return rawLogs.split('\n').filter((l) => l.length > 0)
  }, [rawLogs])

  // Level statistics (client-side from visible lines)
  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const line of allLines) {
      const level = getLineLevel(line)
      if (level) counts[level] = (counts[level] ?? 0) + 1
    }
    return counts
  }, [allLines])

  // Filtered lines based on search and level filters (client-side)
  const filteredLines = useMemo(() => {
    let lines = allLines
    // Level filter (client-side, in addition to server-side)
    if (activeLevels.size > 0) {
      lines = lines.filter((line) => {
        const level = getLineLevel(line)
        return level ? activeLevels.has(level) : false
      })
    }
    // Text search (client-side)
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      lines = lines.filter((line) => line.toLowerCase().includes(q))
    }
    return lines
  }, [allLines, searchQuery, activeLevels])

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
  }, [filteredLines, autoScroll])

  // Detect manual scroll to auto-disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!logContainerRef.current) return
    const el = logContainerRef.current
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    if (autoScroll && !isAtBottom) {
      setAutoScroll(false)
    }
  }, [autoScroll])

  const scrollToBottom = useCallback(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight
    }
    setAutoScroll(true)
  }, [])

  // Toggle level filter — also pass to server for performance
  const toggleLevel = useCallback((level: string) => {
    setActiveLevels((prev) => {
      const next = new Set(prev)
      if (next.has(level)) next.delete(level)
      else next.add(level)

      // If exactly one level is active, pass it to server for server-side filtering
      if (next.size === 1) {
        const [only] = next
        setServerLevel(only)
      } else {
        setServerLevel('')
      }

      return next
    })
  }, [])

  // Copy logs to clipboard
  const handleCopy = useCallback(() => {
    const text = filteredLines.join('\n')
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [filteredLines])

  // Download logs as file
  const handleDownload = useCallback(() => {
    const text = filteredLines.join('\n')
    const blob = new Blob([text], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `docker-services-${scopeMember ? `${scopeMember}-` : ''}${new Date().toISOString().slice(0, 10)}.log`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [filteredLines, scopeMember])

  // Fetch stats on demand
  const loadStats = useCallback(async () => {
    setStatsLoading(true)
    setStatsError(null)
    try {
      const result = await fetchLogStats(scopeMember)
      setStats(result)
    } catch (err: unknown) {
      setStatsError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setStatsLoading(false)
    }
  }, [scopeMember])

  // Toggle stats panel
  const handleToggleStats = useCallback(() => {
    setShowStats((open) => !open)
  }, [])

  // An open stats panel loads when opened and again when the server chosen above changes
  useEffect(() => {
    if (showStats) { setStats(null); loadStats() }
  }, [showStats, loadStats])

  // Fetch archives on demand
  const loadArchives = useCallback(async () => {
    setArchivesLoading(true)
    setArchivesError(null)
    try {
      const result = await fetchLogArchivesOn(scopeMember)
      setArchives(result)
    } catch (err: unknown) {
      setArchivesError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setArchivesLoading(false)
    }
  }, [scopeMember])

  // Load archives when switching to that tab (and again when the server changes)
  useEffect(() => {
    if (activeTab === 'archives') { setArchives(null); loadArchives() }
  }, [activeTab, loadArchives])

  const hasFilters = activeLevels.size > 0 || searchQuery.trim().length > 0

  // Compute max level count for proportional bars in stats
  const statsMaxCount = useMemo(() => {
    if (!stats) return 1
    const counts = Object.values(stats.levels)
    return Math.max(...counts, 1)
  }, [stats])

  const scopeVmid = scopeMembers.find((m) => m.id === scopeMember)?.vmid

  // the page's own line (constants/pageTitles) unless it shows part of a fleet
  const subtitle = scopeMember
    ? `The framework log inside the VM ${memberName}, polled through the hub`
    : scope === 'all' && hasFleet
      ? 'The hub\'s own framework log — every VM keeps its own, one chip away'
      : undefined

  return (
    <div className="space-y-4 md:space-y-5 flex flex-col" style={{ height: 'calc(100vh - 160px)' }}>
      <DisconnectedBanner />
      <PageHeader
        page="logs"
        className="shrink-0"
        badge={hasFleet ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeVmid} /> : undefined}
        subtitle={subtitle}
        actions={<>
          {/* Stats toggle */}
          <button
            type="button"
            onClick={handleToggleStats}
            aria-label="Log statistics"
            aria-pressed={showStats}
            className={`${BTN_TOOLBAR} ${FOCUS_RING} ${showStats ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/25' : TONE_QUIET}`}
          >
            <BarChart3 size={14} />
            <span className="hidden sm:inline">Stats</span>
          </button>
          <button type="button" onClick={handleCopy} aria-label={copied ? 'Copied' : 'Copy the lines'} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
            <span className="hidden sm:inline">{copied ? 'Copied' : 'Copy'}</span>
          </button>
          <button type="button" onClick={handleDownload} disabled={filteredLines.length === 0} aria-label="Export the lines" className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <Download size={14} />
            <span className="hidden sm:inline">Export</span>
          </button>
          <button type="button" onClick={refresh} disabled={loading} aria-label="Refresh" className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </>}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Log of" busy={polling && !!data} />}
      </PageHeader>

      {/* Stats panel (collapsible) */}
      {showStats && (
        <div className={`${CARD} overflow-hidden shrink-0 animate-fade-in`}>
          <div className="px-4 sm:px-5 py-3 border-b border-white/5 flex items-center gap-2">
            <BarChart3 size={16} className="text-cyan-400" aria-hidden />
            <h2 className="text-sm font-semibold text-slate-200">Log statistics</h2>
            {statsLoading && <RefreshCw size={12} className="animate-spin text-slate-500 ml-auto" aria-hidden />}
            {!statsLoading && (
              <button
                type="button"
                onClick={loadStats}
                className={`${BTN_CARD_QUIET} ml-auto ${FOCUS_RING}`}
              >
                <RefreshCw size={12} aria-hidden />
                Refresh
              </button>
            )}
          </div>

          <div className="p-4 sm:p-5">
            {statsError && <ErrorState title="Failed to load log statistics" error={statsError} />}

            {statsLoading && !stats && (
              <LoadingState compact label="Loading the statistics…" />
            )}

            {stats && (
              <div className="space-y-4">
                {/* Overview row */}
                <div className="flex items-center gap-x-4 gap-y-1 flex-wrap text-xs">
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <FileText size={13} className="text-slate-500" aria-hidden />
                    <span className="font-medium text-slate-300">{stats.total_lines.toLocaleString()}</span> lines
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span className="font-medium text-slate-300">{stats.file_size}</span> file size
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <span className="font-medium text-slate-300">{stats.sessions}</span> sessions
                  </div>
                  <div className="flex items-center gap-1.5 text-slate-400">
                    <Archive size={13} className="text-slate-500" aria-hidden />
                    <span className="font-medium text-slate-300">{stats.archives.count}</span> archives
                    <span className="text-slate-500">({stats.archives.total_size})</span>
                  </div>
                </div>

                {/* Level count badges */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(['ERROR', 'CRITICAL', 'WARNING', 'SUCCESS', 'INFO', 'DEBUG', 'STEP', 'TIMING'] as const).map((level) => {
                    const key = levelStatKey[level]
                    if (!key) return null
                    const count = stats.levels[key]
                    const colors = levelColors[level]
                    if (!colors) return null
                    return (
                      <span
                        key={level}
                        className={`
                          inline-flex items-center gap-1.5 rounded-full px-2.5 py-1
                          text-[11px] font-medium border
                          ${colors.text} ${colors.bg} ${colors.border}
                        `}
                      >
                        {level}
                        <span className="font-semibold">{count.toLocaleString()}</span>
                      </span>
                    )
                  })}
                </div>

                {/* Proportional bars */}
                <div className="space-y-1.5">
                  {(['ERROR', 'CRITICAL', 'WARNING', 'SUCCESS', 'INFO', 'DEBUG', 'STEP', 'TIMING'] as const).map((level) => {
                    const key = levelStatKey[level]
                    if (!key) return null
                    const count = stats.levels[key]
                    if (count === 0) return null
                    const colors = levelColors[level]
                    if (!colors) return null
                    const widthPx = Math.max(2, Math.round((count / statsMaxCount) * 120))
                    return (
                      <div key={level} className="flex items-center gap-2 text-[11px]">
                        <span className={`w-16 text-right font-medium ${colors.text}`}>{level}</span>
                        <div
                          className={`h-2 rounded-full ${colors.bg} border ${colors.border}`}
                          style={{ width: `${widthPx}px` }}
                          aria-hidden
                        />
                        <span className="text-slate-500 tabular-nums">{count.toLocaleString()}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div role="alert" className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-300 shrink-0">
          Failed to fetch {scopeMember ? `the log of the VM ${memberName}` : 'the logs'}: {error.message}
        </div>
      )}

      {/* View: the log, the live tail, the archives */}
      <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none shrink-0 self-start">
        <SegmentedControl
          aria-label="Log view"
          value={activeTab}
          onChange={(v) => setActiveTab(v as TabId)}
          data={[
            { value: 'logs', label: <span className="flex items-center gap-1.5"><ScrollText size={13} aria-hidden />Logs</span> },
            { value: 'live', label: <span className="flex items-center gap-1.5"><Radio size={13} aria-hidden />Live</span> },
            { value: 'archives', label: <span className="flex items-center gap-1.5"><Archive size={13} aria-hidden />Archives</span> },
          ]}
        />
      </div>

      {/* ================================================================= */}
      {/* LOGS TAB */}
      {/* ================================================================= */}
      {activeTab === 'logs' && (
        <>
          {/* Controls bar */}
          <div className="flex items-center flex-wrap gap-3 shrink-0">
            {/* Search input */}
            <div className="relative flex-1 min-w-[12rem]">
              <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
              <input
                type="text"
                aria-label="Search the logs"
                placeholder="Search the logs…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={SEARCH_FIELD}
              />
              {searchQuery && (
                <Hint label="Clear the search">
                  <button type="button" aria-label="Clear the search" onClick={() => setSearchQuery('')} className={`${BTN_ICON_SM} ${TONE_GHOST} ${FOCUS_RING} absolute right-1.5 top-1/2 -translate-y-1/2`}>
                    <X size={14} />
                  </button>
                </Hint>
              )}
            </div>

            {/* Lines dropdown */}
            <div className="relative shrink-0">
              <select aria-label="Lines"
                value={lineCount}
                onChange={(e) => setLineCount(Number(e.target.value))}
                className="
                  appearance-none rounded-lg h-[38px] pl-3 pr-8
                  text-xs font-medium text-slate-300
                  bg-white/5 border border-white/10
                  focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/30
                  transition-colors cursor-pointer
                "
              >
                {LINE_COUNT_OPTIONS.map((n) => (
                  <option key={n} value={n}>{n} lines</option>
                ))}
              </select>
              <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
            </div>

            {/* Filter toggle */}
            <button
              type="button"
              onClick={() => setShowFilters(!showFilters)}
              aria-expanded={showFilters}
              className={`${BTN_TOOLBAR} !py-[9px] ${FOCUS_RING} ${
                showFilters || activeLevels.size > 0
                  ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25'
                  : TONE_QUIET
              }`}
            >
              <Filter size={14} />
              Filters
              {activeLevels.size > 0 && (
                <span className="rounded-full bg-emerald-500/20 px-1.5 text-[10px] font-semibold">{activeLevels.size}</span>
              )}
            </button>

            {/* Line count */}
            <div className="flex items-center gap-1.5 text-xs text-slate-500 shrink-0" role="status">
              <FileText size={14} aria-hidden />
              <span>
                {hasFilters
                  ? `${filteredLines.length} / ${allLines.length}`
                  : `${allLines.length}`} lines
              </span>
            </div>

            {/* Auto-scroll toggle */}
            <button
              type="button"
              onClick={() => {
                if (!autoScroll) scrollToBottom()
                else setAutoScroll(false)
              }}
              aria-pressed={autoScroll}
              className={`${BTN_TOOLBAR} !py-[9px] ${FOCUS_RING} ${
                autoScroll
                  ? 'bg-emerald-500/15 border border-emerald-500/25 text-emerald-300 hover:bg-emerald-500/25'
                  : TONE_QUIET
              }`}
            >
              <ArrowDownToLine size={14} />
              Auto-scroll
            </button>
          </div>

          {/* Level filter chips */}
          {showFilters && (
            <div className="flex items-center gap-2 flex-wrap shrink-0 animate-fade-in">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Filter by level</span>
              {LOG_LEVELS.every((l) => (levelCounts[l] ?? 0) === 0) && (
                <span className="text-[11px] text-slate-500">No log lines to filter yet</span>
              )}
              {LOG_LEVELS.filter((l) => (levelCounts[l] ?? 0) > 0).map((level) => {
                const active = activeLevels.has(level)
                const colors = levelColors[level]
                return (
                  <button
                    type="button"
                    key={level}
                    aria-pressed={active}
                    onClick={() => toggleLevel(level)}
                    className={`
                      flex items-center gap-1.5 rounded-full px-3 h-8 sm:h-7
                      text-[11px] font-medium border transition-colors ${FOCUS_RING}
                      ${active
                        ? `${colors.text} ${colors.bg} ${colors.border}`
                        : 'text-slate-400 bg-white/[0.03] border-white/10 hover:bg-white/5'
                      }
                    `}
                  >
                    {level}
                    <span className={`text-[10px] ${active ? 'opacity-80' : 'opacity-60'}`}>
                      {levelCounts[level] ?? 0}
                    </span>
                  </button>
                )
              })}
              {activeLevels.size > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setActiveLevels(new Set())
                    setServerLevel('')
                  }}
                  className={`flex h-8 items-center gap-1 rounded-lg px-2 text-[11px] text-slate-400 hover:text-slate-200 hover:bg-white/5 transition-colors ${FOCUS_RING}`}
                >
                  <X size={12} aria-hidden />
                  Clear
                </button>
              )}
            </div>
          )}

          {/* Log output area */}
          <div className={`${CARD} overflow-hidden flex-1 min-h-0 flex flex-col`}>
            <div className="px-4 sm:px-5 py-3 border-b border-white/5 flex items-center gap-2 shrink-0">
              <ScrollText size={16} className="text-emerald-400" aria-hidden />
              <h2 className="text-sm font-semibold text-slate-200">Output</h2>
              {loading && (
                <RefreshCw size={12} className="animate-spin text-slate-500 ml-auto" aria-hidden />
              )}
            </div>

            <div
              ref={logContainerRef}
              onScroll={handleScroll}
              tabIndex={0}
              role="log"
              aria-label="Log output"
              aria-live="off"
              className={`
                flex-1 overflow-auto p-3 sm:p-4
                bg-slate-950 border-t border-white/[0.03]
                text-xs leading-relaxed
                font-mono
                scrollbar-thin select-text ${FOCUS_RING}
              `}
            >
              {loading && filteredLines.length === 0 && (
                <span className="text-slate-500">Loading the logs…</span>
              )}
              {!loading && filteredLines.length === 0 && (
                <span className="text-slate-500">
                  {hasFilters ? 'No lines match your filters.' : 'No log data available.'}
                </span>
              )}
              {filteredLines.map((line, idx) => (
                <div key={idx} className={`${getLineColorClass(line)} hover:bg-white/[0.03] px-1 -mx-1 rounded`}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* ================================================================= */}
      {/* LIVE TAB */}
      {/* ================================================================= */}
      {activeTab === 'live' && (
        <div className="flex-1 min-h-0">
          <LiveLogViewer key={scopeMember ?? 'hub'} member={scopeMember} initialLines={200} pollInterval={scopeMember ? 3000 : 2000} maxLines={5000} />
        </div>
      )}

      {/* ================================================================= */}
      {/* ARCHIVES TAB */}
      {/* ================================================================= */}
      {activeTab === 'archives' && (
        <div className={`${CARD} overflow-hidden flex-1 min-h-0 flex flex-col`}>
          <div className="px-4 sm:px-5 py-3 border-b border-white/5 flex items-center gap-2 shrink-0">
            <Archive size={16} className="text-emerald-400" aria-hidden />
            <h2 className="text-sm font-semibold text-slate-200">Archived logs</h2>
            {archives && (
              <span className="text-xs text-slate-500 ml-1">
                ({archives.archives.length} files, {archives.total_size} total)
              </span>
            )}
            {archivesLoading && <RefreshCw size={12} className="animate-spin text-slate-500 ml-auto" aria-hidden />}
            {!archivesLoading && (
              <button
                type="button"
                onClick={loadArchives}
                className={`${BTN_CARD_QUIET} ml-auto ${FOCUS_RING}`}
              >
                <RefreshCw size={12} aria-hidden />
                Refresh
              </button>
            )}
          </div>

          <div className="flex-1 overflow-auto">
            {archivesError && (
              <div className="p-5">
                <ErrorState title="Failed to load archived logs" error={archivesError} />
              </div>
            )}

            {archivesLoading && !archives && (
              <LoadingState compact label="Loading the archives…" />
            )}

            {archives && archives.archives.length === 0 && (
              <EmptyState compact title="No archived log files found" hint={`Rotate the logs on the ${pageLabel('maintenance')} page and the archive appears here.`} />
            )}

            {archives && archives.archives.length > 0 && (
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-white/5 text-left">
                    <th scope="col" className="px-4 sm:px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Filename</th>
                    <th scope="col" className="px-4 sm:px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Size</th>
                    <th scope="col" className="px-4 sm:px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {archives.archives.map((archive) => (
                    <tr
                      key={archive.filename}
                      className="border-b border-white/[0.03] hover:bg-white/[0.03] transition-colors"
                    >
                      <td className="px-4 sm:px-5 py-3">
                        <span className="font-mono text-slate-300 break-all">{archive.filename}</span>
                      </td>
                      <td className="px-4 sm:px-5 py-3 text-slate-400 whitespace-nowrap">{archive.size}</td>
                      <td className="px-4 sm:px-5 py-3 text-slate-400 whitespace-nowrap">{archive.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
