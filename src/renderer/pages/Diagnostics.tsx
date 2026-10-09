// =============================================================================
// Diagnostics — the system in depth: a health score, resource gauges, Start /
// Stop / Restart for every stack, the container and image matrices, the ports,
// the event mix, the networks and the alerts — and the factory reset.
// =============================================================================

import React, { useMemo, useState, useCallback, useEffect, useId } from 'react'
import {
  Shield, Activity, Cpu, MemoryStick, Box, HardDrive, Network,
  AlertTriangle, CheckCircle, XCircle, BarChart3, RefreshCw,
  Zap, TrendingUp, Server, Play, Square, RotateCw, Loader2, Power,
  Lock, Trash2, RotateCcw, ExternalLink,
} from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts'
import { Switch, Badge } from '@mantine/core'
import { usePolling } from '../hooks/usePolling'
import { pollKeys } from '../api/pollKeys'
import { useFleetScope } from '../hooks/useFleetScope'
import {
  fetchServerStatus, fetchHealthReport, fetchContainers,
  fetchImages, fetchNetworks, fetchEvents, fetchSystemInfo,
  fetchHealthScore, batchStackAction, authFactoryReset,
} from '../api/endpoints'
import { apiClient } from '../api/client'
import { useConnectionStore } from '../stores/connectionStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { EmptyState } from '../components/common/PageState'
import { useConfirm } from '../components/common/ConfirmDialog'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { pageLabel } from '../constants/pageTitles'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_SHEET, BTN_SHEET_QUIET, BTN_SHEET_DANGER, TONE_OK, TONE_DANGER } from '../lib/ui'
import { CARD, FOCUS_RING } from '../lib/pageKit'
import { useSettingsStore, DEFAULT_SETTINGS } from '../stores/settingsStore'
import { useAuthStore } from '../stores/authStore'
import { useServerStore } from '../stores/serverStore'
import { containerState, isAsleep, STATE_META } from '../lib/containerState'
import type {
  ServerStatus, HealthReport, ContainerInfo, ImageInfo,
  NetworkInfo, EventEntry, SystemInfo, HealthScoreResponse,
  ContainerListResponse, ImageListResponse, NetworkListResponse, EventsResponse,
} from '../../shared/types'

// =============================================================================
// Types
// =============================================================================

// =============================================================================
// Helpers
// =============================================================================

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v))
}

function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0
}

function scoreLabel(score: number): { text: string; color: string; neon: string } {
  if (score >= 90) return { text: 'Excellent', color: 'text-emerald-400', neon: 'neon-emerald' }
  if (score >= 70) return { text: 'Good', color: 'text-cyan-400', neon: 'neon-cyan' }
  if (score >= 50) return { text: 'Fair', color: 'text-amber-400', neon: 'neon-amber' }
  if (score >= 30) return { text: 'Poor', color: 'text-orange-400', neon: 'neon-rose' }
  return { text: 'Critical', color: 'text-rose-400', neon: 'neon-rose' }
}

function scoreGradientId(score: number): string {
  if (score >= 70) return 'gaugeGradientGood'
  if (score >= 40) return 'gaugeGradientWarn'
  return 'gaugeGradientBad'
}

function gaugeColor(pctVal: number): string {
  if (pctVal <= 50) return '#10b981'
  if (pctVal <= 75) return '#f59e0b'
  return '#f43f5e'
}

/** For gauges where 100 % is the good end (containers running, images current) */
function healthGaugeColor(pctVal: number): string {
  if (pctVal >= 90) return '#10b981'
  if (pctVal >= 70) return '#f59e0b'
  return '#f43f5e'
}

// =============================================================================
// SVG Health Score Ring
// =============================================================================

function HealthScoreRing({ score }: { score: number }) {
  const radius = 88
  const stroke = 10
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (clamp(score, 0, 100) / 100) * circumference
  const gradId = scoreGradientId(score)
  const label = scoreLabel(score)

  return (
    <div className="relative inline-flex items-center justify-center" role="img" aria-label={`Health score ${score} of 100: ${label.text}`}>
      <svg width={220} height={220} viewBox="0 0 220 220" className="transform -rotate-90" aria-hidden>
        <defs>
          <linearGradient id="gaugeGradientGood" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="gaugeGradientWarn" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
          <linearGradient id="gaugeGradientBad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#f43f5e" />
            <stop offset="100%" stopColor="#e11d48" />
          </linearGradient>
          <filter id="glow">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {/* Track */}
        <circle
          cx="110" cy="110" r={radius}
          fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={stroke}
        />
        {/* Score arc */}
        <circle
          cx="110" cy="110" r={radius}
          fill="none"
          stroke={`url(#${gradId})`}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          filter="url(#glow)"
          style={{ transition: 'stroke-dashoffset 1.2s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-5xl font-bold tabular-nums text-slate-100">{score}</span>
        <span className={`text-xs font-semibold uppercase tracking-widest mt-1 ${label.color} ${label.neon}`}>
          {label.text}
        </span>
      </div>
    </div>
  )
}

// =============================================================================
// Semi-Circular Gauge
// =============================================================================

function SemiGauge({
  label, value, icon, suffix = '%', mode = 'usage',
}: {
  label: string; value: number; icon: React.ReactNode; suffix?: string
  /** usage: high is bad (CPU, memory); health: high is good (containers up, images current) */
  mode?: 'usage' | 'health'
}) {
  const clamped = clamp(value, 0, 100)
  const radius = 52
  const stroke = 8
  // Semi-circle: PI * r
  const halfCircumference = Math.PI * radius
  const dashOffset = halfCircumference - (clamped / 100) * halfCircumference
  const color = mode === 'health' ? healthGaugeColor(clamped) : gaugeColor(clamped)

  return (
    <div className={`flex flex-col items-center ${CARD} px-3 sm:px-5 py-4 sm:py-5 hover:border-white/10 transition-colors`}>
      <div className="relative mb-2" role="img" aria-label={`${label}: ${Math.round(clamped)}${suffix}`}>
        <svg width={120} height={68} viewBox="0 0 120 68" aria-hidden>
          <defs>
            <linearGradient id={`semiGrad-${label.replace(/\s/g, '')}`} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#10b981" />
              <stop offset="50%" stopColor="#f59e0b" />
              <stop offset="100%" stopColor="#f43f5e" />
            </linearGradient>
          </defs>
          {/* Track */}
          <path
            d={`M ${60 - radius} 62 A ${radius} ${radius} 0 0 1 ${60 + radius} 62`}
            fill="none" stroke="rgba(255,255,255,0.05)" strokeWidth={stroke}
            strokeLinecap="round"
          />
          {/* Value arc */}
          <path
            d={`M ${60 - radius} 62 A ${radius} ${radius} 0 0 1 ${60 + radius} 62`}
            fill="none"
            stroke={color}
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={halfCircumference}
            strokeDashoffset={dashOffset}
            style={{ transition: 'stroke-dashoffset 1s cubic-bezier(0.4,0,0.2,1), stroke 0.5s ease' }}
          />
        </svg>
        {/* Center value */}
        <div className="absolute inset-0 flex items-end justify-center pb-1">
          <span className="text-xl font-bold tabular-nums text-slate-100">
            {Math.round(clamped)}<span className="text-xs text-slate-500 ml-0.5">{suffix}</span>
          </span>
        </div>
      </div>
      <div className="flex items-center gap-1.5 mt-1">
        <span className="text-slate-500 opacity-60" aria-hidden>{icon}</span>
        <span className="text-[10px] uppercase tracking-widest font-semibold text-slate-400">{label}</span>
      </div>
    </div>
  )
}

// =============================================================================
// Section Header
// =============================================================================

function SectionHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4 w-full">
      <span className="text-slate-500" aria-hidden>{icon}</span>
      <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h2>
      <div className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent" aria-hidden />
    </div>
  )
}

// =============================================================================
// Container Health Matrix
// =============================================================================

function ContainerHealthMatrix({ containers }: { containers: ContainerInfo[] }) {
  if (containers.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-500 text-xs">
        No containers detected
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex flex-wrap gap-1.5" role="list" aria-label="Containers by health">
        {containers.map((c) => {
          const state = c.state?.toLowerCase() ?? ''
          const health = c.health?.toLowerCase() ?? ''
          let bg = 'bg-slate-600/40' // stopped
          if (isAsleep(c)) bg = containerState(c) === 'stuck' ? 'bg-amber-500/80' : 'bg-indigo-400/70' // asleep on demand
          else if (state === 'running') {
            if (health === 'healthy') bg = 'bg-emerald-500'
            else if (health === 'unhealthy') bg = 'bg-rose-500'
            else bg = 'bg-amber-500/80' // starting / no healthcheck
          }
          const what = `${c.name}: ${isAsleep(c) ? `${STATE_META[containerState(c)].label} (on demand)` : state || 'unknown'}${health && !isAsleep(c) ? ` / ${health}` : ''}${c.member ? ` (VM ${c.member_name || c.member})` : ''}`

          return (
            <Hint key={`${c.member ?? ''}|${c.name}`} label={what}>
              <div
                role="listitem"
                aria-label={what}
                className={`w-5 h-5 rounded-[4px] cursor-default transition-transform duration-200 ${bg} hover:scale-125 hover:ring-2 hover:ring-white/20`}
              />
            </Hint>
          )
        })}
      </div>
      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-4 pt-3 border-t border-white/[0.03]">
        {[
          { label: 'Healthy', color: 'bg-emerald-500' },
          { label: 'Starting', color: 'bg-amber-500/80' },
          { label: 'Unhealthy', color: 'bg-rose-500' },
          { label: 'Stopped', color: 'bg-slate-600/40' },
          ...(containers.some((c) => isAsleep(c)) ? [{ label: 'Asleep (on demand)', color: 'bg-indigo-400/70' }] : []),
        ].map(({ label: l, color }) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${color}`} aria-hidden />
            <span className="text-[11px] text-slate-500 font-medium">{l}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Image Freshness Bar
// =============================================================================

function ImageFreshnessBar({ images }: { images: ImageInfo[] }) {
  const counts = useMemo(() => {
    const c = { current: 0, aging: 0, stale: 0, unknown: 0 }
    for (const img of images) {
      const s = img.staleness ?? 'unknown'
      if (s in c) (c as Record<string, number>)[s]++
      else c.unknown++
    }
    return c
  }, [images])

  const total = images.length
  if (total === 0) {
    return <EmptyState compact title="No images found" hint={`Run a registry check on the ${pageLabel('images')} page to discover images, or pull one from Docker Hub.`} />
  }

  const segments = [
    { key: 'current', label: 'Current', count: counts.current, color: 'bg-emerald-500', textColor: 'text-emerald-400' },
    { key: 'aging', label: 'Aging', count: counts.aging, color: 'bg-amber-500', textColor: 'text-amber-400' },
    { key: 'stale', label: 'Stale', count: counts.stale, color: 'bg-rose-500', textColor: 'text-rose-400' },
    { key: 'unknown', label: 'Unknown', count: counts.unknown, color: 'bg-slate-500', textColor: 'text-slate-400' },
  ].filter(s => s.count > 0)

  return (
    <div>
      {/* Bar */}
      <div className="flex h-5 rounded-full overflow-hidden bg-slate-800/60 mb-4" role="img" aria-label={`Image freshness: ${segments.map((seg) => `${seg.count} ${seg.label.toLowerCase()}`).join(', ')}`}>
        {segments.map((seg) => (
          <div
            key={seg.key}
            className={`${seg.color} transition-all duration-700 ease-out relative group`}
            style={{ width: `${(seg.count / total) * 100}%` }}
          >
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity bg-white/10" aria-hidden />
          </div>
        ))}
      </div>
      {/* Labels */}
      <div className="flex items-center gap-x-5 gap-y-1 flex-wrap">
        {segments.map((seg) => (
          <div key={seg.key} className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${seg.color}`} aria-hidden />
            <span className="text-xs text-slate-400 font-medium">{seg.label}</span>
            <span className={`text-xs font-bold tabular-nums ${seg.textColor}`}>
              {seg.count}
            </span>
            <span className="text-[11px] text-slate-500">
              ({pct(seg.count, total)}%)
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Port Allocation Map
// =============================================================================

function PortAllocationMap({ containers }: { containers: ContainerInfo[] }) {
  const portEntries = useMemo(() => {
    // a VM's ports are on the VM: each row keeps where it lives (the same port on two VMs is two rows, not a clash)
    const entries: { container: string; host: string; container_port: string; protocol: string; member: string | null; member_name: string; address: string }[] = []
    for (const c of containers) {
      if (!c.ports) continue
      // Parse formats like: "0.0.0.0:8080->80/tcp, :::8080->80/tcp"
      const parts = c.ports.split(',').map(p => p.trim()).filter(Boolean)
      for (const part of parts) {
        const match = part.match(/(?:(\S+):)?(\d+)->(\d+)\/(tcp|udp)/i)
        if (match) {
          entries.push({
            container: c.name,
            host: match[2],
            container_port: match[3],
            protocol: match[4].toUpperCase(),
            member: c.member ?? null,
            member_name: c.member_name ?? '',
            address: c.member ? (c.member_host || '') : window.location.hostname,
          })
        }
      }
    }
    // Deduplicate by host port + container (0.0.0.0 and ::: map to same)
    const seen = new Set<string>()
    return entries.filter(e => {
      const key = `${e.member ?? ''}|${e.container}:${e.host}:${e.container_port}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    }).sort((a, b) => parseInt(a.host) - parseInt(b.host))
  }, [containers])

  if (portEntries.length === 0) {
    return (
      <div className="flex items-center justify-center py-6 text-slate-500 text-xs">
        No port mappings detected
      </div>
    )
  }

  return (
    <div className="overflow-x-auto -mx-1">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5">
            <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Host port</th>
            <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Container port</th>
            <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Protocol</th>
            <th scope="col" className="text-left px-3 py-2.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Container</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.03]">
          {portEntries.slice(0, 20).map((entry) => (
            <tr key={`${entry.member ?? ''}|${entry.container}-${entry.host}-${entry.container_port}`} className="hover:bg-white/[0.03] transition-colors duration-150 group/port">
              <td className="px-3 py-2">
                <button
                  type="button"
                  onClick={() => { if (entry.address) window.open(`http://${entry.address}:${entry.host}`, '_blank') }}
                  disabled={!entry.address}
                  className={`inline-flex items-center gap-1 rounded-md bg-cyan-500/10 border border-cyan-500/20 px-2 py-1 text-xs font-mono font-medium text-cyan-400 hover:bg-cyan-500/20 hover:text-cyan-300 transition-colors cursor-pointer disabled:cursor-default disabled:opacity-60 ${FOCUS_RING}`}
                  title={entry.address ? `Open http://${entry.address}:${entry.host}` : 'The VM\'s address is not known yet'}
                >
                  :{entry.host}
                  <ExternalLink size={10} className="opacity-60 group-hover/port:opacity-100 group-focus-within/port:opacity-100 transition-opacity" aria-hidden />
                </button>
              </td>
              <td className="px-3 py-2 font-mono text-xs text-slate-300">{entry.container_port}</td>
              <td className="px-3 py-2">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{entry.protocol}</span>
              </td>
              <td className="px-3 py-2 text-xs font-medium text-slate-200 truncate max-w-[240px]" title={entry.member ? `${entry.container} · VM ${entry.member_name || entry.member}` : entry.container}>
                {entry.container}
                {entry.member && <span className="ml-1.5 text-[10px] font-normal text-violet-300/80">· {entry.member_name || entry.member}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {portEntries.length > 20 && (
        <div className="text-center py-2 text-[11px] text-slate-500">
          +{portEntries.length - 20} more port mappings
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Event Frequency Chart
// =============================================================================

const EVENT_COLORS: Record<string, string> = {
  start: '#10b981',
  create: '#06b6d4',
  stop: '#f43f5e',
  destroy: '#e11d48',
  die: '#fb7185',
  kill: '#f97316',
  restart: '#f59e0b',
  pull: '#8b5cf6',
  connect: '#22d3ee',
  disconnect: '#94a3b8',
}

function EventFrequencyChart({ events }: { events: EventEntry[] }) {
  const chartData = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of events) {
      counts[e.action] = (counts[e.action] || 0) + 1
    }
    return Object.entries(counts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10)
  }, [events])

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-slate-500 text-xs">
        No events to chart
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={chartData} margin={{ top: 8, right: 8, bottom: 4, left: -12 }}>
        <XAxis
          dataKey="action"
          tick={{ fontSize: 10, fill: '#64748b' }}
          axisLine={{ stroke: 'rgba(255,255,255,0.06)' }}
          tickLine={false}
        />
        <YAxis
          tick={{ fontSize: 10, fill: '#64748b' }}
          axisLine={false}
          tickLine={false}
          allowDecimals={false}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgba(15,23,42,0.95)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '10px',
            fontSize: '12px',
            color: '#e2e8f0',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
          }}
          labelStyle={{ color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}
          cursor={{ fill: 'rgba(255,255,255,0.03)' }}
        />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} maxBarSize={36}>
          {chartData.map((entry) => (
            <Cell key={entry.action} fill={EVENT_COLORS[entry.action] || '#64748b'} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

// =============================================================================
// Networks summary
// =============================================================================

function NetworkSummary({ networks }: { networks: NetworkInfo[] }) {
  if (networks.length === 0) {
    return <EmptyState compact title="No networks found" hint={`Docker networks appear here once a stack creates one, or create one on the ${pageLabel('networks')} page.`} />
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
      {networks.map((net, idx) => (
        <div
          key={net.id}
          className={`${CARD} p-4 hover:border-white/10 transition-colors group animate-fade-in`}
          style={{ animationDelay: `${idx * 60}ms` }}
        >
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center group-hover:bg-cyan-500/15 transition-colors shrink-0">
              <Network size={14} className="text-cyan-400" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold text-slate-200 truncate" title={net.name}>{net.name}</p>
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Driver</span>
              <span className="text-[11px] font-mono text-slate-300">{net.driver}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Scope</span>
              <span className="text-[11px] font-mono text-slate-300">{net.scope}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">Containers</span>
              <span className={`text-xs font-bold tabular-nums ${net.containers.length > 0 ? 'text-emerald-400' : 'text-slate-500'}`}>
                {net.containers.length}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// =============================================================================
// Alerts Panel
// =============================================================================

interface Alert {
  id: string
  severity: 'critical' | 'warning' | 'info'
  title: string
  detail: string
}

function AlertsPanel({
  containers, images, status, cpuCount,
}: {
  containers: ContainerInfo[]
  images: ImageInfo[]
  status: ServerStatus | null
  cpuCount: number
}) {
  const alerts = useMemo<Alert[]>(() => {
    const a: Alert[] = []

    // Containers with restart_count > 0
    for (const c of containers) {
      if (c.restart_count > 0) {
        a.push({
          id: `restart-${c.name}`,
          severity: c.restart_count > 5 ? 'critical' : 'warning',
          title: `Container "${c.name}" has restarted ${c.restart_count} time${c.restart_count !== 1 ? 's' : ''}`,
          detail: 'Check container logs for crash loops or resource issues.',
        })
      }
    }

    // Unhealthy containers
    for (const c of containers) {
      if (c.health?.toLowerCase() === 'unhealthy') {
        a.push({
          id: `unhealthy-${c.name}`,
          severity: 'critical',
          title: `Container "${c.name}" is unhealthy`,
          detail: 'Health check is failing. Inspect the container for errors.',
        })
      }
    }

    // Stale images
    const staleImages = images.filter(i => i.staleness === 'stale')
    if (staleImages.length > 0) {
      a.push({
        id: 'stale-images',
        severity: 'warning',
        title: `${staleImages.length} stale image${staleImages.length !== 1 ? 's' : ''} detected`,
        detail: `Images older than 30 days: ${staleImages.slice(0, 3).map(i => i.repository).join(', ')}${staleImages.length > 3 ? '...' : ''}`,
      })
    }

    // High memory usage
    if (status?.system) {
      const { total, available } = status.system.memory_mb
      const usedPct = total > 0 ? ((total - available) / total) * 100 : 0
      if (usedPct > 90) {
        a.push({
          id: 'memory-critical',
          severity: 'critical',
          title: `Memory usage is critically high (${Math.round(usedPct)}%)`,
          detail: `${Math.round(available)} MB available out of ${Math.round(total)} MB total.`,
        })
      } else if (usedPct > 80) {
        a.push({
          id: 'memory-high',
          severity: 'warning',
          title: `Memory usage is high (${Math.round(usedPct)}%)`,
          detail: `${Math.round(available)} MB available out of ${Math.round(total)} MB total.`,
        })
      }
    }

    // High load average
    if (status?.system && cpuCount > 0) {
      const load = status.system.load_average[0]
      if (load > cpuCount) {
        a.push({
          id: 'load-high',
          severity: load > cpuCount * 2 ? 'critical' : 'warning',
          title: `Load average (${load.toFixed(2)}) exceeds CPU count (${cpuCount})`,
          detail: 'System may be overloaded. Check for CPU-intensive processes.',
        })
      }
    }

    return a
  }, [containers, images, status, cpuCount])

  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-3 py-6 justify-center">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center">
          <CheckCircle size={20} className="text-emerald-400" />
        </div>
        <div>
          <p className="text-sm font-semibold text-emerald-400">All clear</p>
          <p className="text-xs text-slate-500">No alerts or issues detected</p>
        </div>
      </div>
    )
  }

  const severityConfig = {
    critical: {
      border: 'border-rose-500/20',
      bg: 'bg-rose-500/[0.06]',
      icon: <XCircle size={16} className="text-rose-400 shrink-0" aria-hidden />,
      titleColor: 'text-rose-300',
    },
    warning: {
      border: 'border-amber-500/20',
      bg: 'bg-amber-500/[0.06]',
      icon: <AlertTriangle size={16} className="text-amber-400 shrink-0" aria-hidden />,
      titleColor: 'text-amber-300',
    },
    info: {
      border: 'border-cyan-500/20',
      bg: 'bg-cyan-500/[0.06]',
      icon: <Zap size={16} className="text-cyan-400 shrink-0" aria-hidden />,
      titleColor: 'text-cyan-300',
    },
  }

  return (
    <div className="space-y-2.5 max-h-[400px] overflow-y-auto scrollbar-thin pr-1" role="list" aria-label="Active alerts">
      {alerts.map((alert, idx) => {
        const cfg = severityConfig[alert.severity]
        return (
          <div
            key={alert.id}
            role="listitem"
            className={`flex items-start gap-3 rounded-xl border p-3.5 ${cfg.border} ${cfg.bg} animate-fade-in`}
            style={{ animationDelay: `${idx * 80}ms` }}
          >
            <div className="mt-0.5">{cfg.icon}</div>
            <div className="min-w-0 flex-1">
              <p className={`text-xs font-semibold ${cfg.titleColor}`}>{alert.title}</p>
              <p className="text-xs text-slate-500 mt-0.5">{alert.detail}</p>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// =============================================================================
// Server Control Card
// =============================================================================

/** Start / Stop / Restart for every stack. The tone of each tile is written out in full (no `bg-${color}` pieces) so the theme engine sees every class. */
const CONTROLS = [
  {
    id: 'start' as const, label: 'Start all', icon: Play, desc: 'Start all stacks',
    tile: 'hover:bg-emerald-500/15 hover:border-emerald-500/25',
    well: 'bg-emerald-500/10 border-emerald-500/15 group-hover:bg-emerald-500/20',
    iconColor: 'text-emerald-400',
  },
  {
    id: 'stop' as const, label: 'Stop all', icon: Square, desc: 'Stop all stacks',
    tile: 'hover:bg-rose-500/15 hover:border-rose-500/25',
    well: 'bg-rose-500/10 border-rose-500/15 group-hover:bg-rose-500/20',
    iconColor: 'text-rose-400',
  },
  {
    id: 'restart' as const, label: 'Restart all', icon: RotateCw, desc: 'Restart all stacks',
    tile: 'hover:bg-amber-500/15 hover:border-amber-500/25',
    well: 'bg-amber-500/10 border-amber-500/15 group-hover:bg-amber-500/20',
    iconColor: 'text-amber-400',
  },
]

function ServerControlCard() {
  const confirm = useConfirm()
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ action: string; success: boolean; message: string } | null>(null)

  const handleAction = useCallback(async (action: 'start' | 'stop' | 'restart') => {
    // stopping or restarting every stack takes the whole system with it (core infrastructure and the VMs' stacks too): ask first
    if (action !== 'start') {
      const ok = await confirm({
        title: action === 'stop' ? 'Stop all stacks' : 'Restart all stacks',
        message: action === 'stop'
          ? 'Every stack stops — core infrastructure (Traefik, the sign-in, the web dashboard) and the stacks inside your VMs included. This page may stop answering until the stacks are started again.'
          : 'Every stack restarts, one after the other — core infrastructure (Traefik, the sign-in, the web dashboard) and the stacks inside your VMs included. Services are down for a moment, and this page may stop answering meanwhile.',
        confirmLabel: action === 'stop' ? 'Stop all stacks' : 'Restart all stacks',
        danger: true,
      })
      if (!ok) return
    }
    setActionLoading(action)
    setLastResult(null)
    try {
      const result = await batchStackAction(action, 'all')
      const successCount = result.results?.filter((r: { success: boolean }) => r.success).length ?? 0
      const totalCount = result.results?.length ?? 0
      setLastResult({
        action,
        success: successCount === totalCount,
        message: `${action.charAt(0).toUpperCase() + action.slice(1)}: ${successCount}/${totalCount} stacks succeeded`,
      })
    } catch (err) {
      setLastResult({
        action,
        success: false,
        message: `Failed to ${action}: ${err instanceof Error ? err.message : 'Unknown error'}`,
      })
    } finally {
      setActionLoading(null)
    }
  }, [confirm])

  return (
    <div className="space-y-4">
      {/* Action buttons row */}
      <div className="grid grid-cols-3 gap-2 sm:gap-3">
        {CONTROLS.map((action) => {
          const Icon = action.icon
          const isLoading = actionLoading === action.id
          const isDisabled = actionLoading !== null

          return (
            <button
              type="button"
              key={action.id}
              onClick={() => handleAction(action.id)}
              disabled={isDisabled}
              className={`
                group relative flex flex-col items-center gap-2 sm:gap-2.5 rounded-xl p-3 sm:p-5
                bg-white/[0.03] border border-white/5
                ${action.tile}
                transition-colors duration-300 disabled:opacity-50 disabled:cursor-not-allowed ${FOCUS_RING}
              `}
            >
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${action.well} transition-colors duration-300`}>
                {isLoading ? (
                  <Loader2 size={20} className={`${action.iconColor} animate-spin`} />
                ) : (
                  <Icon size={20} className={action.iconColor} />
                )}
              </div>
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-200">{action.label}</p>
                <p className="hidden sm:block text-[11px] text-slate-500 mt-0.5">{action.desc}</p>
              </div>
            </button>
          )
        })}
      </div>

      {/* Result message */}
      {lastResult && (
        <div role="status" className={`
          flex items-center gap-3 rounded-xl px-4 py-3 border animate-fade-in
          ${lastResult.success
            ? 'bg-emerald-500/[0.06] border-emerald-500/20'
            : 'bg-rose-500/[0.06] border-rose-500/20'
          }
        `}>
          {lastResult.success ? (
            <CheckCircle size={15} className="text-emerald-400 shrink-0" aria-hidden />
          ) : (
            <XCircle size={15} className="text-rose-400 shrink-0" aria-hidden />
          )}
          <p className={`text-xs font-medium ${lastResult.success ? 'text-emerald-300' : 'text-rose-300'}`}>
            {lastResult.message}
          </p>
        </div>
      )}
    </div>
  )
}

// =============================================================================
// Factory Reset Card — shared password verification + two reset modes
// =============================================================================

/** Verify the current user's password using Web Crypto PBKDF2 / SHA-256 */
async function verifyCurrentPassword(password: string): Promise<{ valid: boolean; error?: string }> {
  const { currentUser } = useAuthStore.getState()
  if (!currentUser) return { valid: false, error: 'Not logged in' }

  const accounts: { username: string; passwordHash: string; salt?: string; hashVersion?: number }[] = await (async () => {
    if (window.electronAPI) {
      const accts = await window.electronAPI.getSetting('userAccounts')
      return (accts as typeof accounts) ?? []
    }
    try {
      const raw = localStorage.getItem('userAccounts')
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  })()

  const account = accounts.find((a) => a.username.toLowerCase() === currentUser.toLowerCase())
  if (!account) return { valid: false, error: 'Account not found' }

  let valid = false
  if (!crypto?.subtle) {
    // No Web Crypto (HTTP context) — skip client-side verification, let server handle it
    return { valid: true }
  }
  if (account.hashVersion === 2 && account.salt) {
    const encoder = new TextEncoder()
    const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits'])
    const saltBytes = new Uint8Array(account.salt.match(/.{2}/g)!.map((b: string) => parseInt(b, 16)))
    const derivedBits = await crypto.subtle.deriveBits(
      { name: 'PBKDF2', salt: saltBytes, iterations: 100_000, hash: 'SHA-256' },
      keyMaterial,
      256,
    )
    const derived = Array.from(new Uint8Array(derivedBits)).map((b) => b.toString(16).padStart(2, '0')).join('')
    valid = derived === account.passwordHash
  } else {
    const encoder = new TextEncoder()
    const hashBuffer = await crypto.subtle.digest('SHA-256', encoder.encode(password))
    const hash = Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('')
    valid = hash === account.passwordHash
  }

  return valid ? { valid: true } : { valid: false, error: 'Incorrect password' }
}

/** Perform the client-side reset (clear all local data, return to first-launch)
 *  @param redirectToSetup — if true (full server reset), navigate to setup wizard instead of dashboard */
async function performClientReset(redirectToSetup = false): Promise<void> {
  // Preserve server URL so we can reconnect to setup wizard after reset
  const currentServerUrl = useSettingsStore.getState().serverUrl

  localStorage.clear()
  sessionStorage.clear()

  if (window.electronAPI) {
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      await window.electronAPI.setSetting(key, undefined)
    }
    await window.electronAPI.setSetting('userAccounts', undefined)
  }

  useSettingsStore.setState({ ...DEFAULT_SETTINGS, currentPage: redirectToSetup ? 'setup' : 'dashboard' })

  // Restore server URL so setup wizard can reconnect
  useSettingsStore.getState().updateSetting('serverUrl', currentServerUrl)
  useConnectionStore.getState().setServerUrl(currentServerUrl)
  apiClient.setBaseUrl(currentServerUrl)
  apiClient.setAuthToken(null)

  useConnectionStore.getState().disconnect()
  useAuthStore.setState({
    isAuthenticated: false,
    currentUser: null,
    hasAccount: false,
    apiToken: null,
    validatedServerId: null,
  })
  // the server forgot every account: the sessions saved for it are gone too
  const { activeServerId, updateServer } = useServerStore.getState()
  if (activeServerId) updateServer(activeServerId, { session: null })
}

/** Perform server-side factory reset via dedicated endpoint */
async function performServerReset(resetCompose: boolean): Promise<{ success: boolean; error?: string }> {
  try {
    const result = await authFactoryReset({ confirm: 'FACTORY_RESET', reset_compose: resetCompose })
    return result.success ? { success: true } : { success: false, error: 'Server reset returned failure' }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to reach server' }
  }
}

function FactoryResetCard() {
  const uid = useId()
  const [activeMode, setActiveMode] = useState<'none' | 'app' | 'full'>('none')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [confirmText, setConfirmText] = useState('')
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetting, setResetting] = useState(false)
  const [serverResetResult, setServerResetResult] = useState<string | null>(null)
  const [resetCompose, setResetCompose] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)

  const confirmKeyword = activeMode === 'full' ? 'WIPE' : 'RESET'
  const canReset = confirmText === confirmKeyword && confirmPassword.length > 0

  const cancelConfirm = useCallback(() => {
    setActiveMode('none')
    setConfirmPassword('')
    setConfirmText('')
    setResetError(null)
    setServerResetResult(null)
    setResetCompose(false)
    setCountdown(null)
  }, [])

  const handleAppReset = useCallback(async () => {
    if (!canReset) return
    setResetting(true)
    setResetError(null)
    const pw = await verifyCurrentPassword(confirmPassword)
    if (!pw.valid) {
      setResetError(pw.error ?? 'Verification failed')
      setResetting(false)
      return
    }
    await performClientReset(false)
  }, [canReset, confirmPassword])

  const handleFullReset = useCallback(async () => {
    if (!canReset || countdown !== null) return
    // Verify password first, then start countdown
    setResetError(null)
    setServerResetResult(null)
    const pw = await verifyCurrentPassword(confirmPassword)
    if (!pw.valid) {
      setResetError(pw.error ?? 'Verification failed')
      return
    }
    // Start 5-second countdown
    setCountdown(5)
  }, [canReset, confirmPassword, countdown])

  // Countdown timer effect
  useEffect(() => {
    if (countdown === null || countdown < 0) return
    if (countdown === 0) {
      // Execute the reset
      ;(async () => {
        setResetting(true)
        const serverResult = await performServerReset(resetCompose)
        if (!serverResult.success) {
          setResetError(`Server reset failed: ${serverResult.error}`)
          setResetting(false)
          setCountdown(null)
          return
        }
        await performClientReset(true)
      })()
      return
    }
    const timer = setTimeout(() => setCountdown(countdown - 1), 1000)
    return () => clearTimeout(timer)
  }, [countdown, resetCompose])

  // ── Idle state: show both buttons ──
  if (activeMode === 'none') {
    return (
      <div className="space-y-4">
        {/* App-only reset */}
        <div className="flex items-start gap-4 p-4 rounded-xl bg-amber-500/[0.04] border border-amber-500/10">
          <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <RefreshCw size={16} className="text-amber-400" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">Reset app settings</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Clears everything this browser remembers about DCS — the saved session and API token, connection profiles, theme, dashboard layout cache and preferences — and returns to the login screen. <span className="text-slate-200">Nothing on the server changes: users, stacks, containers, compose files and configuration all stay.</span>
            </p>
            <button
              type="button"
              onClick={() => setActiveMode('app')}
              className={`${BTN_TOOLBAR} mt-3 bg-amber-500/10 border border-amber-500/20 text-amber-300 hover:bg-amber-500/20 ${FOCUS_RING}`}
            >
              <RefreshCw size={14} />
              Reset app
            </button>
          </div>
        </div>

        {/* Full server + app reset */}
        <div className="flex items-start gap-4 p-4 rounded-xl bg-rose-500/[0.04] border border-rose-500/10">
          <div className="w-9 h-9 rounded-lg bg-rose-500/10 border border-rose-500/15 flex items-center justify-center shrink-0 mt-0.5">
            <Trash2 size={16} className="text-rose-400" aria-hidden />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-rose-300">Full server reset</p>
            <p className="text-xs text-slate-400 mt-1 leading-relaxed">
              Everything in Reset app, <span className="text-rose-300 font-medium">plus</span> the server forgets every API user, token, invite and session, its setup-complete flag, and the root <span className="font-mono">.env</span> goes back to the bundled defaults — the {pageLabel('setup')} runs again on the next connection. <span className="text-slate-200">Stacks, containers, images, compose files, secrets, plugins, schedules and metrics are kept</span> unless you also choose to wipe the stacks below.
            </p>
            <button
              type="button"
              onClick={() => setActiveMode('full')}
              className={`${BTN_TOOLBAR} ${TONE_DANGER} mt-3 ${FOCUS_RING}`}
            >
              <Trash2 size={14} />
              Full reset
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Confirmation state ──
  const isFullReset = activeMode === 'full'

  // Pre-defined class sets to avoid Tailwind purge issues with dynamic class names
  const styles = isFullReset
    ? {
        banner: 'bg-rose-500/[0.06] border-rose-500/15',
        icon: 'text-rose-400',
        title: 'text-rose-300',
        desc: 'text-slate-400',
        keyword: 'text-rose-300',
        inputFocus: 'focus:border-rose-500/50 focus:ring-rose-500/25',
        confirmMatch: 'border-rose-500/50 focus:border-rose-500/50 focus:ring-rose-500/25',
        button: BTN_SHEET_DANGER,
      }
    : {
        banner: 'bg-amber-500/[0.06] border-amber-500/15',
        icon: 'text-amber-400',
        title: 'text-amber-300',
        desc: 'text-slate-400',
        keyword: 'text-amber-300',
        inputFocus: 'focus:border-amber-500/50 focus:ring-amber-500/25',
        confirmMatch: 'border-amber-500/50 focus:border-amber-500/50 focus:ring-amber-500/25',
        button: `${BTN_SHEET} font-semibold text-slate-900 bg-amber-500 hover:bg-amber-400`,
      }

  return (
    <div className="space-y-4 animate-fade-in">
      <div className={`flex items-start gap-3 rounded-xl ${styles.banner} border px-4 py-3`}>
        <AlertTriangle size={15} className={`${styles.icon} shrink-0 mt-0.5`} aria-hidden />
        <div>
          <p className={`text-sm font-semibold ${styles.title}`}>
            {isFullReset ? 'Confirm full server reset' : 'Confirm app reset'}
          </p>
          <p className={`text-xs ${styles.desc} mt-0.5`}>
            Enter your current password and type{' '}
            <span className={`font-mono font-bold ${styles.keyword}`}>{confirmKeyword}</span> to confirm.
            {isFullReset && (
              <span className="block mt-1 text-slate-400">
                {resetCompose
                  ? `Users, sessions, .env, every stack except core infrastructure and all their data will be gone. The ${pageLabel('setup')} runs again afterwards.`
                  : `Users, sessions and the root .env are reset; stacks and containers keep running. The ${pageLabel('setup')} runs again afterwards.`}
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="space-y-3">
        <div>
          <label htmlFor={`${uid}-pw`} className="block text-xs font-medium text-slate-400 mb-1">Current password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" aria-hidden />
            <input
              id={`${uid}-pw`}
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setResetError(null) }}
              placeholder="Enter your password"
              autoComplete="current-password"
              className={`
                w-full pl-9 pr-3 py-2.5 bg-white/5 border border-white/10 rounded-lg
                text-sm text-slate-200 placeholder-slate-600
                focus:outline-none focus:ring-1 ${styles.inputFocus}
                transition-colors
              `}
            />
          </div>
        </div>

        <div>
          <label htmlFor={`${uid}-kw`} className="block text-xs font-medium text-slate-400 mb-1">
            Type {confirmKeyword} to confirm
          </label>
          <input
            id={`${uid}-kw`}
            type="text"
            value={confirmText}
            onChange={(e) => { setConfirmText(e.target.value); setResetError(null) }}
            placeholder={confirmKeyword}
            autoComplete="off"
            className={`
              w-full px-3 py-2.5 bg-white/5 border rounded-lg
              text-sm text-slate-200 placeholder-slate-600 font-mono
              focus:outline-none focus:ring-1 transition-colors
              ${confirmText === confirmKeyword
                ? styles.confirmMatch
                : 'border-white/10 focus:border-white/20 focus:ring-white/10'
              }
            `}
          />
        </div>
      </div>

      {/* Compose reset toggle (full reset only) */}
      {isFullReset && (
        <div className={`${CARD} p-3`}>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium text-rose-300">Also wipe the stacks and their data</p>
            <Switch color="rose" aria-label="Also wipe the stacks and their data" checked={resetCompose} onChange={() => setResetCompose(!resetCompose)} className="shrink-0" />
          </div>
          <p className="text-xs text-slate-500 leading-relaxed mt-1">
            Stops and removes every DCS stack except core infrastructure (the dashboard keeps running), deletes their App-Data, named volumes and images, removes user-created stacks and templates, installed plugins, secrets, snapshots, metrics, automations and the DNS records DCS created, then restores the bundled compose files. Other containers on this host are never touched.
          </p>
        </div>
      )}

      {resetError && (
        <div role="alert" className="flex items-center gap-2 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2">
          <XCircle size={13} className="text-rose-400 shrink-0" aria-hidden />
          <p className="text-xs text-rose-300">{resetError}</p>
        </div>
      )}

      {serverResetResult && (
        <div role="status" className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
          <CheckCircle size={13} className="text-emerald-400 shrink-0" aria-hidden />
          <p className="text-xs text-emerald-300">{serverResetResult}</p>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center">
        <button
          type="button"
          onClick={isFullReset ? handleFullReset : handleAppReset}
          disabled={!canReset || resetting || (countdown !== null && countdown > 0)}
          className={`${styles.button} disabled:cursor-not-allowed ${FOCUS_RING}`}
        >
          {resetting ? (
            <Loader2 size={14} className="animate-spin" />
          ) : countdown !== null && countdown > 0 ? (
            <RotateCcw size={14} />
          ) : isFullReset ? (
            <Trash2 size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          {resetting
            ? 'Resetting…'
            : countdown !== null && countdown > 0
              ? `Confirm in ${countdown}s…`
              : isFullReset
                ? 'Confirm full reset'
                : 'Confirm app reset'
          }
        </button>
        <button
          type="button"
          onClick={cancelConfirm}
          className={`${BTN_SHEET_QUIET} ${FOCUS_RING}`}
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

// =============================================================================
// Disconnected Hero
// =============================================================================

function DisconnectedHero() {
  const connect = useConnectionStore((s) => s.connect)
  const connectionStatus = useConnectionStore((s) => s.status)
  const isConnecting = connectionStatus === 'connecting'

  return (
    <EmptyState
      icon={<Shield size={32} />}
      title={isConnecting ? 'Connecting…' : 'Diagnostics unavailable'}
      hint="Connect to your Docker API to see the system diagnostics."
      action={!isConnecting ? (
        <button type="button" onClick={() => connect()} className={`${BTN_TOOLBAR} ${TONE_OK} ${FOCUS_RING}`}>
          <Server size={14} />
          Connect
        </button>
      ) : undefined}
    />
  )
}

// =============================================================================
// Main Diagnostics Page
// =============================================================================

export default function Diagnostics() {
  const connectionStatus = useConnectionStore((s) => s.status)
  const isConnected = connectionStatus === 'connected'
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'

  // --- Data polling: every poll watches the link; the requests other places ask too are keyed (one request serves them) ---
  const watch = { reportsLink: true } as const

  const statusPoll = usePolling<ServerStatus>(fetchServerStatus, 5000, { ...watch, key: pollKeys.status })
  const healthPoll = usePolling<HealthReport>(fetchHealthReport, 5000, { ...watch, key: pollKeys.health(null) })
  const containersPoll = usePolling<ContainerListResponse>(fetchContainers, 10000, { ...watch, key: pollKeys.containers() })
  const imagesPoll = usePolling<ImageListResponse>(fetchImages, 30000, watch)
  const networksPoll = usePolling<NetworkListResponse>(fetchNetworks, 30000, watch)
  const eventsPoll = usePolling<EventsResponse>(fetchEvents, 5000, { ...watch, key: pollKeys.events(null) })
  const systemInfoPoll = usePolling<SystemInfo>(fetchSystemInfo, 60000, { ...watch, key: pollKeys.systemInfo() })

  const { scope: fleetScope } = useFleetScope()
  const healthScorePoll = usePolling<HealthScoreResponse>(() => fetchHealthScore(fleetScope), 15000, { ...watch, key: pollKeys.healthScore(fleetScope) })

  // --- Extracted data ---

  const status = statusPoll.data
  const health = healthPoll.data
  const containers: ContainerInfo[] = containersPoll.data?.containers ?? []
  const images: ImageInfo[] = imagesPoll.data?.images ?? []
  const networks: NetworkInfo[] = networksPoll.data?.networks ?? []
  const events: EventEntry[] = eventsPoll.data?.events ?? []
  const systemInfo = systemInfoPoll.data
  const healthScoreData = healthScorePoll.data
  const cpuCount = systemInfo?.cpu_count ?? 1

  // --- Computed gauges ---

  const memoryUsedPct = useMemo(() => {
    if (!status?.system) return 0
    const { total, available } = status.system.memory_mb
    return total > 0 ? ((total - available) / total) * 100 : 0
  }, [status])

  const cpuLoadPct = useMemo(() => {
    if (!status?.system) return 0
    const load = status.system.load_average[0]
    return clamp((load / cpuCount) * 100, 0, 100)
  }, [status, cpuCount])

  const containerRunPct = useMemo(() => {
    if (!status?.docker) return 0
    // asleep on demand is up: Sablier stopped it on purpose and the first request wakes it
    const { running, total, sleeping = 0 } = status.docker.containers
    return total > 0 ? ((running + sleeping) / total) * 100 : 0
  }, [status])

  const imageHealthPct = useMemo(() => {
    if (images.length === 0) return 100
    const current = images.filter(i => i.staleness === 'current').length
    return (current / images.length) * 100
  }, [images])

  // --- Health score computation ---

  const localHealthScore = useMemo(() => {
    let score = 100
    let factors = 0

    // 1. Container health ratio (weight: 35)
    if (health) {
      // the asleep ones stay out (as in the server's own score): they are fine, not unhealthy
      const { total, healthy, sleeping = 0 } = health.summary
      if (total - sleeping > 0) {
        score -= (1 - (healthy / (total - sleeping))) * 35
      }
      factors++
    }

    // 2. Image freshness (weight: 20)
    if (images.length > 0) {
      const stale = images.filter(i => i.staleness === 'stale').length
      const aging = images.filter(i => i.staleness === 'aging').length
      score -= (stale / images.length) * 20
      score -= (aging / images.length) * 5
      factors++
    }

    // 3. Memory usage (weight: 25)
    if (status?.system) {
      const memPct = memoryUsedPct
      if (memPct > 90) score -= 25
      else if (memPct > 80) score -= 15
      else if (memPct > 70) score -= 8
      factors++
    }

    // 4. Load average (weight: 20)
    if (status?.system && cpuCount > 0) {
      const loadRatio = status.system.load_average[0] / cpuCount
      if (loadRatio > 2) score -= 20
      else if (loadRatio > 1.5) score -= 15
      else if (loadRatio > 1) score -= 10
      else if (loadRatio > 0.8) score -= 5
      factors++
    }

    return factors > 0 ? Math.max(0, Math.round(score)) : 0
  }, [health, images, status, memoryUsedPct, cpuCount])

  // Use API score when available, fall back to local
  const healthScore = healthScoreData?.score ?? localHealthScore

  // --- Refresh all ---
  const refreshAll = useCallback(() => {
    statusPoll.refresh()
    healthPoll.refresh()
    containersPoll.refresh()
    imagesPoll.refresh()
    networksPoll.refresh()
    eventsPoll.refresh()
    systemInfoPoll.refresh()
    healthScorePoll.refresh()
  }, [statusPoll, healthPoll, containersPoll, imagesPoll, networksPoll, eventsPoll, systemInfoPoll, healthScorePoll])

  const isLoading = statusPoll.loading && !status

  // Determine if we should show disconnected state
  const hasNoData = !status && !health && containers.length === 0
  const showDisconnected = !isConnected && hasNoData

  return (
    <div className="space-y-4 md:space-y-5">
      <DisconnectedBanner />
      {/* ── Page header ──────────────────────────────────────────── */}
      <PageHeader
        page="diagnostics"
        badge={isConnected ? (
          <Badge
            color="emerald"
            leftSection={
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inset-0 rounded-full bg-emerald-400 animate-ping opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
            }
          >
            Live
          </Badge>
        ) : undefined}
        actions={isConnected ? (
          <button type="button" onClick={refreshAll} disabled={isLoading} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
            Refresh all
          </button>
        ) : undefined}
      />

      {showDisconnected ? (
        <DisconnectedHero />
      ) : (
        <div className="space-y-4 md:space-y-5 stagger-children">

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 1: Health Score + Resource Gauges                     */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-5">

            {/* Health Score Ring */}
            <div className="lg:col-span-4">
              <div className={`${CARD} p-4 md:p-6 flex flex-col items-center justify-center h-full relative overflow-hidden`}>
                {/* Ambient glow behind ring */}
                <div className="absolute inset-0 pointer-events-none">
                  <div
                    className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-48 h-48 rounded-full blur-3xl animate-breathe"
                    style={{
                      backgroundColor: healthScore >= 70
                        ? 'rgba(16,185,129,0.06)'
                        : healthScore >= 40
                          ? 'rgba(245,158,11,0.06)'
                          : 'rgba(244,63,94,0.06)',
                    }}
                  />
                </div>
                <SectionHeader icon={<Shield size={14} />} title="System health score" />
                <HealthScoreRing score={healthScore} />
                {healthScoreData?.grade && (
                  <div className="flex items-center gap-3 mt-3">
                    {healthScoreData.factors && (
                      <div className="flex items-center gap-2">
                        {(['stacks', 'resources', 'images', 'uptime'] as const).map((key) => {
                          const f = healthScoreData.factors[key]
                          if (!f) return null
                          const color = f.score >= 80 ? 'text-emerald-400' : f.score >= 60 ? 'text-amber-400' : 'text-rose-400'
                          return (
                            <div key={key} className="text-center">
                              <p className={`text-xs font-bold tabular-nums ${color}`}>{f.score}</p>
                              <p className="text-[10px] text-slate-500 uppercase tracking-wider">{key}</p>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
                <p className="text-[11px] text-slate-500 mt-4 text-center max-w-[200px]">
                  Calculated from container health, image freshness, memory, and CPU load
                </p>
              </div>
            </div>

            {/* Resource Gauges + Server Control */}
            <div className="lg:col-span-8 flex flex-col gap-4 md:gap-5">
              <div className={`${CARD} p-4 md:p-6`}>
                <SectionHeader icon={<Activity size={14} />} title="Resource gauges" />
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
                  <SemiGauge
                    label="CPU load"
                    value={cpuLoadPct}
                    icon={<Cpu size={12} />}
                  />
                  <SemiGauge
                    label="Memory"
                    value={memoryUsedPct}
                    icon={<MemoryStick size={12} />}
                  />
                  <SemiGauge
                    label="Containers"
                    value={containerRunPct}
                    icon={<Box size={12} />}
                    mode="health"
                  />
                  <SemiGauge
                    label="Image health"
                    value={imageHealthPct}
                    icon={<HardDrive size={12} />}
                    mode="health"
                  />
                </div>
              </div>
              {isAdmin && (
                <div className={`${CARD} p-4 md:p-6`}>
                  <SectionHeader icon={<Power size={14} />} title="Server control" />
                  <ServerControlCard />
                </div>
              )}
              {isAdmin && (
                <div className={`${CARD} !border-rose-500/10 p-4 md:p-6`}>
                  <SectionHeader icon={<Trash2 size={14} />} title="Factory reset" />
                  <FactoryResetCard />
                </div>
              )}
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 2: Container Matrix + Image Freshness                */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

            {/* Container Health Matrix */}
            <div className={`${CARD} p-4 md:p-6`}>
              <SectionHeader icon={<Box size={14} />} title="Container health matrix" />
              <ContainerHealthMatrix containers={containers} />
            </div>

            {/* Image Freshness Breakdown */}
            <div className={`${CARD} p-4 md:p-6`}>
              <SectionHeader icon={<HardDrive size={14} />} title="Image freshness" />
              <ImageFreshnessBar images={images} />
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 3: Port Map + Event Chart                            */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-5">

            {/* Port Allocation Map */}
            <div className={`${CARD} p-4 md:p-6`}>
              <SectionHeader icon={<TrendingUp size={14} />} title="Port allocation map" />
              <PortAllocationMap containers={containers} />
            </div>

            {/* Event Frequency */}
            <div className={`${CARD} p-4 md:p-6`}>
              <SectionHeader icon={<BarChart3 size={14} />} title="Event frequency" />
              <EventFrequencyChart events={events} />
            </div>
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 4: Networks                                          */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className={`${CARD} p-4 md:p-6`}>
            <SectionHeader icon={<Network size={14} />} title="Networks" />
            <NetworkSummary networks={networks} />
          </div>

          {/* ══════════════════════════════════════════════════════════ */}
          {/* ROW 5: Alerts Panel                                      */}
          {/* ══════════════════════════════════════════════════════════ */}
          <div className={`${CARD} p-4 md:p-6`}>
            <SectionHeader icon={<AlertTriangle size={14} />} title="Active alerts" />
            <AlertsPanel
              containers={containers}
              images={images}
              status={status}
              cpuCount={cpuCount}
            />
          </div>

        </div>
      )}
    </div>
  )
}
