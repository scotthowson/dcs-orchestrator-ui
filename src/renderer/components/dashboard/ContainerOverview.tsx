// =============================================================================
// ContainerOverview — live container status list for the Dashboard, with a
//                     compact donut of the status breakdown
// =============================================================================

import { Box, RotateCcw } from 'lucide-react'
import { PieChart, Pie, Cell, ResponsiveContainer } from 'recharts'
import { useConnectionStore } from '../../stores/connectionStore'
import { useContainerStore } from '../../stores/containerStore'
import type { ContainerInfo } from '../../../shared/types'
import { Card, CardBody, CardEmpty, CardLoading, CardOffline } from './cardShared'
import { StateDot, AsleepCount } from '../common/StateChip'
import { containerState, countStates, fineCount, isAsleep, statesLine, STATE_META } from '../../lib/containerState'

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

function healthBadge(health: string): string {
  switch (health) {
    case 'healthy': return 'bg-emerald-500/10 text-emerald-400'
    case 'unhealthy': return 'bg-rose-500/10 text-rose-400'
    case 'starting': return 'bg-amber-500/10 text-amber-400'
    default: return 'bg-slate-500/10 text-slate-400'
  }
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

// ---------------------------------------------------------------------------
// The donut: running is fine, paused needs a look, stopped is off (neutral)
// ---------------------------------------------------------------------------

// asleep on demand is its own calm slice (indigo): Sablier stopped it on purpose and wakes it on the first request
const STATUS_COLORS = {
  running: '#10b981',  // emerald-500
  asleep: STATE_META.asleep.color,
  stopped: '#64748b',  // slate-500
  problem: '#f59e0b',  // amber-500: unhealthy, restarting, can't wake
}

function StatusDonut({ containers }: { containers: ContainerInfo[] }) {
  const n = countStates(containers)
  const running = n.running
  const stopped = n.stopped
  const problem = n.unhealthy + n.restarting + n.stuck

  const data = [
    { name: 'Running', value: running, color: STATUS_COLORS.running },
    { name: 'Asleep', value: n.asleep, color: STATUS_COLORS.asleep },
    { name: 'Needs a look', value: problem, color: STATUS_COLORS.problem },
    { name: 'Stopped', value: stopped, color: STATUS_COLORS.stopped },
  ].filter((d) => d.value > 0)

  // If no containers, show a single grey ring
  if (data.length === 0) data.push({ name: 'None', value: 1, color: '#1e293b' })

  return (
    <div className="relative h-20 w-20 shrink-0" role="img" aria-label={`${containers.length} containers: ${statesLine(n, { noun: false })}`}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={26}
            outerRadius={36}
            paddingAngle={data.length > 1 ? 3 : 0}
            dataKey="value"
            stroke="none"
            animationBegin={0}
            animationDuration={600}
          >
            {data.map((entry, index) => (
              <Cell key={`status-cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-sm font-bold text-white leading-none">{containers.length}</span>
        <span className="text-[10px] text-slate-500 uppercase tracking-wider mt-0.5">total</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export default function ContainerOverview({ containers }: { containers: ContainerInfo[] }) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const loading = useContainerStore((s) => s.loading)

  if (!isConnected && containers.length === 0) return <Card card="container-overview" dim><CardOffline /></Card>
  if (containers.length === 0) {
    return (
      <Card card="container-overview" open="containers">
        {loading
          ? <CardLoading label="Loading the containers…" rows={5} />
          : <CardEmpty icon={<Box size={22} />} title="No containers yet" hint="Start a stack or deploy a template and its containers appear here." />}
      </Card>
    )
  }

  // running first, then asleep on demand (fine), then the rest
  const rank = (c: ContainerInfo) => { const k = containerState(c); return k === 'running' || k === 'starting' ? 0 : k === 'asleep' ? 1 : 2 }
  const sorted = [...containers].sort((a, b) => rank(a) - rank(b))
  const n = countStates(containers)
  const running = containers.filter((c) => c.state === 'running')
  const exited = n.stopped
  const paused = containers.filter((c) => c.state === 'paused').length

  return (
    <Card
      card="container-overview"
      open="containers"
      meta={<span title={statesLine(n)}><span className="text-emerald-400 font-medium">{fineCount(n) + n.unhealthy}</span><span className="text-slate-600 mx-0.5">/</span>{containers.length}</span>}
    >
      <CardBody>
        <div className="flex items-center gap-4 mb-3 pb-3 border-b border-white/5">
          <StatusDonut containers={containers} />
          <div className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px]">
            {running.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
                <span className="text-slate-400">{running.length} running</span>
              </div>
            )}
            {n.asleep + n.stuck > 0 && (
              <div className="flex items-center gap-1.5">
                <AsleepCount n={n.asleep} stuck={n.stuck} />
              </div>
            )}
            {exited > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-slate-500" aria-hidden />
                <span className="text-slate-400">{exited} stopped</span>
              </div>
            )}
            {paused > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden />
                <span className="text-slate-400">{paused} paused</span>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-0.5">
          {sorted.map((container) => (
            <div
              key={`${container.member ?? ''}|${container.name}`}
              className="flex items-center gap-2.5 py-2 px-2 rounded-lg hover:bg-white/[0.03] transition-colors group"
            >
              <StateDot state={containerState(container)} />
              <span className="flex-1 text-xs font-mono text-slate-300 truncate group-hover:text-white transition-colors" title={container.name}>
                {container.name}
              </span>
              {isAsleep(container) && <span className={`text-[10px] ${STATE_META[containerState(container)].text}`} title={STATE_META[containerState(container)].hint}>{STATE_META[containerState(container)].label}</span>}
              {container.health && container.health !== 'none' && container.health !== '' && !isAsleep(container) && (
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${healthBadge(container.health)}`}>{container.health}</span>
              )}
              {container.state === 'running' && container.uptime_seconds > 0 && (
                <span className="text-[10px] text-slate-500 tabular-nums shrink-0">{formatUptime(container.uptime_seconds)}</span>
              )}
              {container.restart_count > 0 && (
                <span
                  className="inline-flex items-center gap-0.5 text-[10px] text-amber-400 tabular-nums shrink-0"
                  title={`${container.restart_count} restart${container.restart_count === 1 ? '' : 's'}`}
                  role="img"
                  aria-label={`${container.restart_count} restart${container.restart_count === 1 ? '' : 's'}`}
                >
                  <RotateCcw size={9} aria-hidden />{container.restart_count}
                </span>
              )}
            </div>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
