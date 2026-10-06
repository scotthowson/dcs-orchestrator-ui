// =============================================================================
// ServerInfo — the server at a glance: host, uptime, load, memory, disk, Docker
// =============================================================================

import React from 'react'
import {
  Globe, Cpu, MemoryStick, Clock, Network,
  HardDrive, Layers, Box, Activity, Server,
} from 'lucide-react'
import { useSystemStore } from '../../stores/systemStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useFleetScope } from '../../hooks/useFleetScope'
import { useStackCounts } from '../../hooks/useStackCounts'
import { Card, CardBody, CardError, CardLoading, CardOffline, loadTone, pctTone, TONE_TEXT, type Tone } from './cardShared'

/** a value is plain text; it takes a colour only when it means something (needs attention, a problem) */
function InfoRow({ icon, label, value, tone = 'neutral' }: {
  icon: React.ReactNode
  label: string
  value: string | number
  tone?: Tone
}) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-white/[0.03] last:border-b-0">
      <span className="text-slate-500 shrink-0" aria-hidden>{icon}</span>
      <span className="text-[10px] text-slate-500 uppercase tracking-wider shrink-0 w-16 md:w-20">{label}</span>
      <span className={`ml-auto text-xs font-mono text-right truncate ${tone === 'neutral' ? 'text-slate-200' : TONE_TEXT[tone]}`}>{value}</span>
    </div>
  )
}

export default function ServerInfo() {
  const { hasFleet } = useFleetScope()
  const status = useSystemStore((s) => s.status)
  const error = useSystemStore((s) => s.error)
  const version = useSystemStore((s) => s.version)
  const system = useSystemStore((s) => s.system)
  const connectionStatus = useConnectionStore((s) => s.status)
  // the stacks of this server asleep on demand: fine, they count with the running ones
  const hereStacks = useStackCounts('hub')

  if (!status && error) return <Card card="server-info"><CardError title="Could not load the server details" error={error} onRetry={() => window.dispatchEvent(new Event('app-refresh'))} /></Card>
  if (!status && connectionStatus === 'connected') return <Card card="server-info"><CardLoading label="Loading the server details…" rows={7} /></Card>
  if (!status) return <Card card="server-info" dim><CardOffline /></Card>

  const memTotal = status.system.memory_mb.total
  const memAvail = status.system.memory_mb.available
  const memUsed = memTotal - memAvail
  const memPct = memTotal > 0 ? Math.round((memUsed / memTotal) * 100) : 0
  const diskPct = parseInt(String(status.system.disk.percent).replace('%', ''), 10) || 0

  const dockerVersion = version?.docker_version?.replace('Docker version ', '').split(',')[0] ?? '--'
  const composeVersion = version?.compose_version?.replace(/Docker Compose version\s*/i, '').split(' ')[0] ?? '--'
  const apiVersion = version?.api_version ?? '--'
  const stacksAsleep = hereStacks.loaded ? hereStacks.sleeping : 0
  const stacksAll = status.stacks.running + stacksAsleep >= status.stacks.total
  const cAsleep = status.docker.containers.sleeping ?? 0
  const cStopped = Math.max(0, status.docker.containers.stopped - cAsleep)

  return (
    <Card card="server-info">
      <CardBody>
        <InfoRow icon={<Globe size={12} />} label="Hostname" value={status.hostname} />
        <InfoRow icon={<Clock size={12} />} label="Uptime" value={formatUptime(status.uptime_seconds)} />
        <InfoRow
          icon={<Cpu size={12} />}
          label="Load avg"
          value={status.system.load_average.map((v) => v.toFixed(2)).join(' / ')}
          tone={loadTone(status.system.load_average[0], system?.cpu_count) === 'ok' ? 'neutral' : loadTone(status.system.load_average[0], system?.cpu_count)}
        />
        <InfoRow
          icon={<MemoryStick size={12} />}
          label="Memory"
          value={`${formatMb(memUsed)} / ${formatMb(memTotal)} (${memPct}%)`}
          tone={pctTone(memPct) === 'ok' ? 'neutral' : pctTone(memPct)}
        />
        <InfoRow
          icon={<HardDrive size={12} />}
          label="Disk"
          value={`${status.system.disk.used} / ${status.system.disk.total} (${status.system.disk.percent})`}
          tone={pctTone(diskPct) === 'ok' ? 'neutral' : pctTone(diskPct)}
        />
        <InfoRow
          icon={<Layers size={12} />}
          label={hasFleet ? 'Stacks here' : 'Stacks'}
          value={`${status.stacks.running + stacksAsleep} / ${status.stacks.total} up${stacksAsleep ? ` (${stacksAsleep} asleep)` : ''}`}
          tone={stacksAll ? 'neutral' : 'attention'}
        />
        <InfoRow
          icon={<Box size={12} />}
          label={hasFleet ? 'Containers here' : 'Containers'}
          value={`${status.docker.containers.running} running${cAsleep ? `, ${cAsleep} asleep` : ''}, ${cStopped} stopped`}
        />
        <InfoRow icon={<Activity size={12} />} label={hasFleet ? 'Images here' : 'Images'} value={`${status.docker.images} images`} />
        <InfoRow icon={<Network size={12} />} label="Networks" value={`${status.docker.networks} networks, ${status.docker.volumes} volumes`} />
        <InfoRow icon={<Server size={12} />} label="Docker" value={dockerVersion} />
        <InfoRow icon={<Server size={12} />} label="Compose" value={composeVersion} />
        <InfoRow icon={<Server size={12} />} label="API" value={`v${apiVersion}`} />
      </CardBody>
    </Card>
  )
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  parts.push(`${minutes}m`)
  return parts.join(' ')
}

function formatMb(mb: number): string {
  return `${(mb / 1024).toFixed(2)} GB`
}
