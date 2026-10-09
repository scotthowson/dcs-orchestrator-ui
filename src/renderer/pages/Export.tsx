// =============================================================================
// Export — download what the server knows as JSON files: one full system report,
// or any of nine reports on their own (one at a time, or several selected).
// Exports real data from working API endpoints — bypasses the broken
// /export/:type endpoint which references non-existent internal functions.
// =============================================================================

import React, { useState, useCallback, useEffect, useRef } from 'react'
import {
  Download, Layers, HeartPulse, Monitor, Settings2, Loader2,
  ShieldAlert, Box, Image, Network, FileText, Zap, Clock,
  CheckCircle2, FileJson, Archive, ChevronDown, ChevronUp,
  HardDrive, AlertTriangle, Trash2,
} from 'lucide-react'
import {
  fetchServerStatus,
  fetchHealthReport,
  fetchStacks,
  fetchStackCompose,
  fetchContainers,
  fetchSystemInfo,
  fetchConfig,
  fetchImages,
  fetchNetworks,
  fetchEvents,
  fetchAuditLog,
  fetchVolumes,
} from '../api/endpoints'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useToast } from '../components/common/Toast'
import PageHeader from '../components/common/PageHeader'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, TONE_OK, TONE_QUIET, TONE_GHOST, TONE_GHOST_DANGER } from '../lib/ui'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ExportCardDef {
  id: string
  title: string
  description: string
  icon: React.ElementType
  fetcher: () => Promise<unknown>
}

interface ExportHistoryEntry {
  id: string
  title: string
  timestamp: number
  sizeBytes: number
  /** (older entries carry the colour their card once had; nothing reads it now) */
  color?: string
}

// ---------------------------------------------------------------------------
// Data fetchers — call real working endpoints
// ---------------------------------------------------------------------------

async function fetchStackConfigs(): Promise<unknown> {
  const stacksRes = await fetchStacks()
  const stacks = stacksRes.stacks ?? []
  const configs: Record<string, { compose?: string; status: string; running_containers: number }> = {}
  // Fetch compose file for each stack (parallel, with graceful failure)
  const results = await Promise.allSettled(
    stacks.map(async (s: { name: string; status: string; running_containers: number }) => {
      try {
        const compose = await fetchStackCompose(s.name)
        return { name: s.name, compose: compose.content ?? '', status: s.status, running: s.running_containers }
      } catch {
        return { name: s.name, compose: undefined, status: s.status, running: s.running_containers }
      }
    })
  )
  for (const r of results) {
    if (r.status === 'fulfilled') {
      configs[r.value.name] = {
        compose: r.value.compose,
        status: r.value.status,
        running_containers: r.value.running,
      }
    }
  }
  return { exported_at: new Date().toISOString(), total_stacks: stacks.length, stacks: configs }
}

async function fetchFullReport(): Promise<unknown> {
  const [status, health, stacks, containers, system, images, networks, volumes] = await Promise.allSettled([
    fetchServerStatus(),
    fetchHealthReport(),
    fetchStacks(),
    fetchContainers(),
    fetchSystemInfo(),
    fetchImages(),
    fetchNetworks(),
    fetchVolumes(),
  ])
  return {
    exported_at: new Date().toISOString(),
    report_type: 'full_system_report',
    status: status.status === 'fulfilled' ? status.value : null,
    health: health.status === 'fulfilled' ? health.value : null,
    stacks: stacks.status === 'fulfilled' ? stacks.value : null,
    containers: containers.status === 'fulfilled' ? containers.value : null,
    system: system.status === 'fulfilled' ? system.value : null,
    images: images.status === 'fulfilled' ? images.value : null,
    networks: networks.status === 'fulfilled' ? networks.value : null,
    volumes: volumes.status === 'fulfilled' ? volumes.value : null,
  }
}

// ---------------------------------------------------------------------------
// Export card definitions
// ---------------------------------------------------------------------------

const exportCards: ExportCardDef[] = [
  {
    id: 'stacks',
    title: 'Stack configurations',
    description: 'All compose files, stack status and running container counts per stack',
    icon: Layers,
    fetcher: fetchStackConfigs,
  },
  {
    id: 'health',
    title: 'Health report',
    description: 'Container health checks, uptime, restart counts and a health summary',
    icon: HeartPulse,
    fetcher: async () => {
      const data = await fetchHealthReport()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'containers',
    title: 'Container inventory',
    description: 'Full container list with status, image, ports, networks and labels',
    icon: Box,
    fetcher: async () => {
      const data = await fetchContainers()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'system',
    title: 'System & resources',
    description: 'CPU, memory, disk usage, Docker version, kernel and hostname',
    icon: Monitor,
    fetcher: async () => {
      const data = await fetchSystemInfo()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'images',
    title: 'Image inventory',
    description: 'All Docker images with size, age, tags and staleness',
    icon: Image,
    fetcher: async () => {
      const data = await fetchImages()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'networks',
    title: 'Network map',
    description: 'Docker networks, subnets, gateways and connected containers',
    icon: Network,
    fetcher: async () => {
      const data = await fetchNetworks()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'config',
    title: 'Server settings',
    description: 'Sanitized server settings and feature flags',
    icon: Settings2,
    fetcher: async () => {
      const data = await fetchConfig()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'events',
    title: 'Event log',
    description: 'Recent Docker events — container starts, stops, image pulls and more',
    icon: Clock,
    fetcher: async () => {
      const data = await fetchEvents()
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
  {
    id: 'audit',
    title: 'Audit trail',
    description: 'API audit log with user actions, timestamps and request details',
    icon: FileText,
    fetcher: async () => {
      const data = await fetchAuditLog({ limit: 500 })
      return { exported_at: new Date().toISOString(), ...data }
    },
  },
]

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) +
    ' \u00B7 ' + d.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function triggerDownload(json: string, filename: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

const HISTORY_KEY = 'dcs-export-history'

function loadHistory(): ExportHistoryEntry[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) || '[]')
  } catch { return [] }
}

function saveHistory(entries: ExportHistoryEntry[]) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, 20)))
}

// ---------------------------------------------------------------------------
// Export Card Component
// ---------------------------------------------------------------------------

function ExportCard({ card, selected, onToggle, onExport, isLoading, isConnected, isAdmin }: {
  card: ExportCardDef
  selected: boolean
  onToggle: () => void
  onExport: () => void
  isLoading: boolean
  isConnected: boolean
  isAdmin: boolean
}) {
  const Icon = card.icon

  return (
    <div className={`relative surface transition-colors ${selected ? 'border-cyan-500/30 bg-cyan-500/[0.05]' : 'hover:border-white/10'}`}>
      {isAdmin && (
        <button
          type="button"
          onClick={onToggle}
          aria-label={`Select ${card.title} for the batch export`}
          aria-pressed={selected}
          className="absolute top-1.5 right-1.5 z-10 w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
        >
          <span className={`w-5 h-5 rounded-md border flex items-center justify-center transition-colors ${selected ? 'bg-cyan-500/30 border-cyan-500/40 text-cyan-400' : 'border-white/15 text-transparent'}`}>
            {selected && <CheckCircle2 className="w-3.5 h-3.5" aria-hidden />}
          </span>
        </button>
      )}
      <div className="p-5">
        <div className="flex items-start gap-3.5 pr-7">
          <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-white/5 border border-white/10 shrink-0" aria-hidden>
            <Icon className="w-5 h-5 text-slate-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-200 leading-tight">{card.title}</h3>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">{card.description}</p>
          </div>
        </div>
        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <FileJson className="w-3 h-3 text-slate-500" aria-hidden />
            <span className="text-[10px] text-slate-500 uppercase tracking-wider font-medium">JSON</span>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={onExport}
              disabled={isLoading || !isConnected}
              aria-label={`Export ${card.title}`}
              className={`${BTN_CARD} ${TONE_QUIET}`}
            >
              {isLoading ? (
                <><Loader2 size={12} className="animate-spin" /> Exporting</>
              ) : (
                <><Download size={12} /> Export</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Export Page
// ---------------------------------------------------------------------------

export default function Export() {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'
  const { addToast } = useToast()

  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({})
  const [fullReportLoading, setFullReportLoading] = useState(false)
  const [history, setHistory] = useState<ExportHistoryEntry[]>(loadHistory)
  const [showHistory, setShowHistory] = useState(false)
  const [selectedCards, setSelectedCards] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const exportCountRef = useRef(0)

  // Persist history
  useEffect(() => { saveHistory(history) }, [history])

  const addHistoryEntry = useCallback((title: string, sizeBytes: number) => {
    setHistory((prev) => [{
      id: `${Date.now()}-${++exportCountRef.current}`,
      title,
      timestamp: Date.now(),
      sizeBytes,
    }, ...prev].slice(0, 20))
  }, [])

  const handleExport = useCallback(async (card: ExportCardDef) => {
    setLoadingMap((prev) => ({ ...prev, [card.id]: true }))
    try {
      const data = await card.fetcher()
      const json = JSON.stringify(data, null, 2)
      const date = new Date().toISOString().slice(0, 10)
      triggerDownload(json, `dcs-${card.id}-${date}.json`)
      addHistoryEntry(card.title, new Blob([json]).size)
      addToast({ type: 'success', message: `${card.title} exported` })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The export failed'
      addToast({ type: 'error', message: `Could not export ${card.title}: ${message}` })
    } finally {
      setLoadingMap((prev) => ({ ...prev, [card.id]: false }))
    }
  }, [addToast, addHistoryEntry])

  const handleFullReport = useCallback(async () => {
    setFullReportLoading(true)
    try {
      const data = await fetchFullReport()
      const json = JSON.stringify(data, null, 2)
      const date = new Date().toISOString().slice(0, 10)
      const time = new Date().toISOString().slice(11, 16).replace(':', '')
      triggerDownload(json, `dcs-full-report-${date}-${time}.json`)
      addHistoryEntry('Full system report', new Blob([json]).size)
      addToast({ type: 'success', message: 'Full system report exported' })
    } catch (err) {
      const message = err instanceof Error ? err.message : 'The export failed'
      addToast({ type: 'error', message: `The full report failed: ${message}` })
    } finally {
      setFullReportLoading(false)
    }
  }, [addToast, addHistoryEntry])

  const toggleCard = useCallback((id: string) => {
    setSelectedCards((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleBatchExport = useCallback(async () => {
    if (selectedCards.size === 0) return
    setBatchLoading(true)
    const selected = exportCards.filter((c) => selectedCards.has(c.id))
    let successCount = 0
    for (const card of selected) {
      try {
        setLoadingMap((prev) => ({ ...prev, [card.id]: true }))
        const data = await card.fetcher()
        const json = JSON.stringify(data, null, 2)
        const date = new Date().toISOString().slice(0, 10)
        triggerDownload(json, `dcs-${card.id}-${date}.json`)
        addHistoryEntry(card.title, new Blob([json]).size)
        successCount++
      } catch {
        addToast({ type: 'error', message: `Could not export ${card.title}` })
      } finally {
        setLoadingMap((prev) => ({ ...prev, [card.id]: false }))
      }
    }
    if (successCount > 0) {
      addToast({ type: 'success', message: `${successCount} export${successCount > 1 ? 's' : ''} completed` })
    }
    setSelectedCards(new Set())
    setBatchLoading(false)
  }, [selectedCards, addToast, addHistoryEntry])

  const clearHistory = useCallback(() => {
    setHistory([])
    addToast({ type: 'success', message: 'Export history cleared' })
  }, [addToast])

  const allSelected = selectedCards.size === exportCards.length

  return (
    <div className="space-y-4 md:space-y-6 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="export"
        actions={history.length > 0 ? (
          <button type="button" onClick={() => setShowHistory((p) => !p)} aria-expanded={showHistory} className={BTN_TOOLBAR_QUIET}>
            <Clock size={14} />
            History ({history.length})
            {showHistory ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
          </button>
        ) : undefined}
      />

      {/* ── Non-admin notice ── */}
      {!isAdmin && (
        <div className="surface p-4 border-cyan-500/20 flex items-center gap-3" role="status">
          <ShieldAlert className="w-5 h-5 text-cyan-400 shrink-0" aria-hidden />
          <p className="text-sm text-cyan-200/90">
            Admin privileges are required to export server data.
          </p>
        </div>
      )}

      {/* ── Full system report ── */}
      {isAdmin && (
        <section aria-labelledby="export-full-title" className="surface overflow-hidden">
          <div className="p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Archive size={16} className="text-slate-400" aria-hidden />
                <h2 id="export-full-title" className="text-sm font-semibold text-slate-200">Full system report</h2>
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Everything in one file: status, health, stacks, containers, system info, images, networks and volumes
              </p>
            </div>
            <button
              type="button"
              onClick={handleFullReport}
              disabled={fullReportLoading || !isConnected}
              className={`${BTN_TOOLBAR} ${TONE_OK} shrink-0`}
            >
              {fullReportLoading ? (
                <><Loader2 size={14} className="animate-spin" /> Generating</>
              ) : (
                <><Download size={14} /> Generate report</>
              )}
            </button>
          </div>
          <ul className="px-5 pb-4 flex flex-wrap items-center gap-x-5 gap-y-1.5">
            {[
              { icon: HardDrive, label: 'Status' },
              { icon: HeartPulse, label: 'Health' },
              { icon: Layers, label: 'Stacks' },
              { icon: Box, label: 'Containers' },
              { icon: Monitor, label: 'System' },
              { icon: Image, label: 'Images' },
              { icon: Network, label: 'Networks' },
              { icon: HardDrive, label: 'Volumes' },
            ].map(({ icon: I, label }) => (
              <li key={label} className="flex items-center gap-1.5">
                <I className="w-3 h-3 text-slate-500" aria-hidden />
                <span className="text-[10px] text-slate-500 font-medium">{label}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Batch selection toolbar ── */}
      {isAdmin && selectedCards.size > 0 && (
        <div className="surface p-3 border-cyan-500/20 flex flex-wrap items-center justify-between gap-2 animate-fade-in">
          <div className="flex items-center gap-2" role="status">
            <Zap className="w-4 h-4 text-cyan-400" aria-hidden />
            <span className="text-sm text-slate-300">
              <span className="font-semibold text-cyan-400 tabular-nums">{selectedCards.size}</span> export{selectedCards.size > 1 ? 's' : ''} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setSelectedCards(new Set())} className={`${BTN_TOOLBAR} ${TONE_GHOST}`}>
              Clear the selection
            </button>
            <button type="button" onClick={handleBatchExport} disabled={batchLoading || !isConnected} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
              {batchLoading ? (
                <><Loader2 size={14} className="animate-spin" /> Exporting</>
              ) : (
                <><Download size={14} /> Export selected</>
              )}
            </button>
          </div>
        </div>
      )}

      {/* ── Individual exports ── */}
      <section aria-labelledby="export-individual-title">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 id="export-individual-title" className="text-sm font-semibold text-slate-200">Individual exports</h2>
          {isAdmin && (
            <button
              type="button"
              onClick={() => {
                if (allSelected) setSelectedCards(new Set())
                else setSelectedCards(new Set(exportCards.map((c) => c.id)))
              }}
              className={`${BTN_CARD} ${TONE_GHOST}`}
            >
              {allSelected ? 'Clear the selection' : 'Select all'}
            </button>
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {exportCards.map((card) => (
            <ExportCard
              key={card.id}
              card={card}
              selected={selectedCards.has(card.id)}
              onToggle={() => toggleCard(card.id)}
              onExport={() => handleExport(card)}
              isLoading={loadingMap[card.id] ?? false}
              isConnected={isConnected}
              isAdmin={isAdmin}
            />
          ))}
        </div>
      </section>

      {/* ── Export history ── */}
      {showHistory && history.length > 0 && (
        <section aria-labelledby="export-history-title" className="surface overflow-hidden animate-fade-in">
          <div className="px-5 py-3 border-b border-white/5 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-400" aria-hidden />
              <h2 id="export-history-title" className="text-sm font-semibold text-slate-200">Export history</h2>
            </div>
            <button type="button" onClick={clearHistory} className={`${BTN_CARD} ${TONE_GHOST_DANGER}`}>
              <Trash2 size={12} />
              Clear the history
            </button>
          </div>
          <ul className="divide-y divide-white/[0.03]">
            {history.map((entry) => (
              <li key={entry.id} className="px-5 py-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 hover:bg-white/[0.03] transition-colors">
                <div className="flex items-center gap-3">
                  <div className="w-1.5 h-1.5 rounded-full bg-slate-500" aria-hidden />
                  <span className="text-sm text-slate-300">{entry.title}</span>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xs text-slate-500 tabular-nums font-medium">{formatBytes(entry.sizeBytes)}</span>
                  <span className="text-xs text-slate-500 tabular-nums">{formatTime(entry.timestamp)}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── Info footer ── */}
      {isAdmin && (
        <div className="flex items-start gap-3 px-1">
          <AlertTriangle className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" aria-hidden />
          <p className="text-[11px] text-slate-500 leading-relaxed">
            Exports contain server data. The Server settings export uses the sanitized API endpoint and leaves out passwords and secrets. Store exported files securely.
          </p>
        </div>
      )}
    </div>
  )
}
