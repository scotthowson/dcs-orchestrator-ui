// =============================================================================
// HealthSummary — unified health card: score gauge + status + containers
// =============================================================================

import React from 'react'
import {
  ShieldCheck, ShieldAlert, ShieldX, ShieldQuestion, HeartPulse, Cpu, MemoryStick, HardDrive, Timer,
} from 'lucide-react'
import { Badge } from '@mantine/core'
import { useHealthStore } from '../../stores/healthStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useApiLink } from '../../hooks/useApiLink'
import { fetchHealthScore } from '../../api/endpoints'
import { pollKeys } from '../../api/pollKeys'
import { usePolling } from '../../hooks/usePolling'
import { useFleetScope } from '../../hooks/useFleetScope'
import { useStackCounts } from '../../hooks/useStackCounts'
import VmCapsule from '../fleet/VmCapsule'
import Hint from '../common/Hint'
import type { HealthContainer, HealthScoreResponse } from '../../../shared/types'
import { Card, CardBody, CardError, CardOffline, pctTone, TONE_TEXT, type CardTone } from './cardShared'
import { StateDot } from '../common/StateChip'
import { containerState, countStates, fineCount, isAsleep, statesLine, STATE_META } from '../../lib/containerState'

// ---------------------------------------------------------------------------
// Score gauge colors: a grade is a scale from fine to a problem
// ---------------------------------------------------------------------------

const gradeColors: Record<string, string> = {
  A: 'text-emerald-400', B: 'text-cyan-400', C: 'text-amber-400', D: 'text-orange-400', F: 'text-rose-400',
}
const gradeStroke: Record<string, string> = {
  A: '#10b981', B: '#06b6d4', C: '#f59e0b', D: '#f97316', F: '#f43f5e',
}
const gradeBadge: Record<string, string> = { A: 'emerald', B: 'cyan', C: 'amber', D: 'orange', F: 'rose' }

function getGrade(score: number): string {
  if (score >= 90) return 'A'
  if (score >= 75) return 'B'
  if (score >= 60) return 'C'
  if (score >= 40) return 'D'
  return 'F'
}

// ---------------------------------------------------------------------------
// Health status config
// ---------------------------------------------------------------------------

const statusConfig = {
  healthy: { icon: ShieldCheck, label: 'Healthy', color: 'emerald', tone: undefined },
  degraded: { icon: ShieldAlert, label: 'Degraded', color: 'amber', tone: 'attention' },
  critical: { icon: ShieldX, label: 'Critical', color: 'rose', tone: 'problem' },
  unknown: { icon: ShieldQuestion, label: 'Unknown', color: 'slate', tone: undefined },
} as const satisfies Record<string, { icon: typeof ShieldCheck; label: string; color: string; tone: CardTone | undefined }>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatUptime(seconds: number): string {
  if (seconds <= 0) return '--'
  const d = Math.floor(seconds / 86400)
  const h = Math.floor((seconds % 86400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreGauge({ score, grade, loading }: { score: number; grade: string; loading: boolean }) {
  const size = 96
  const strokeWidth = 7
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (score / 100) * circumference
  const stroke = gradeStroke[grade] || '#64748b'

  return (
    <div className="relative shrink-0" role="img" aria-label={loading ? 'Health score loading' : `Health score ${score} out of 100, grade ${grade}`}>
      <svg width={size} height={size} className="transform -rotate-90" aria-hidden>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth={strokeWidth} />
        {!loading && (
          <circle
            cx={size / 2} cy={size / 2} r={radius} fill="none"
            stroke={stroke} strokeWidth={strokeWidth} strokeLinecap="round"
            strokeDasharray={circumference} strokeDashoffset={offset}
            className="transition-all duration-1000 ease-out"
          />
        )}
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        {loading ? (
          <div className="w-6 h-6 rounded-full skeleton" />
        ) : (
          <>
            <span className="text-xl font-bold text-white leading-none">{score}</span>
            <span className={`text-[11px] font-semibold ${gradeColors[grade] || 'text-slate-400'}`}>{grade}</span>
          </>
        )}
      </div>
    </div>
  )
}

function FactorBar({ label, value, detail }: { label: string; value: number; detail?: string }) {
  const color = value >= 80 ? 'bg-emerald-500' : value >= 60 ? 'bg-amber-500' : 'bg-rose-500'
  return (
    <div className="flex items-center gap-2">
      <span className="text-[11px] text-slate-500 w-[60px] shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all duration-700`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] text-slate-400 w-6 text-right tabular-nums font-medium">{value}</span>
      {detail && <span className="text-[10px] text-slate-500 w-20 text-right truncate" title={detail}>{detail}</span>}
    </div>
  )
}

function SummaryBar({ healthy, unhealthy, stopped, sleeping = 0 }: { healthy: number; unhealthy: number; stopped: number; sleeping?: number }) {
  const total = healthy + unhealthy + stopped + sleeping
  if (total === 0) return null
  const healthyPct = (healthy / total) * 100
  const unhealthyPct = (unhealthy / total) * 100
  const stoppedPct = (stopped / total) * 100
  const sleepingPct = (sleeping / total) * 100

  return (
    <div>
      <div className="flex h-2 w-full overflow-hidden rounded-full bg-slate-800/60">
        {healthyPct > 0 && <div className="bg-emerald-500 transition-all duration-700" style={{ width: `${healthyPct}%` }} title={`${healthy} healthy`} />}
        {unhealthyPct > 0 && <div className="bg-rose-500 transition-all duration-700" style={{ width: `${unhealthyPct}%` }} title={`${unhealthy} unhealthy`} />}
        {stoppedPct > 0 && <div className="bg-slate-600 transition-all duration-700" style={{ width: `${stoppedPct}%` }} title={`${stopped} stopped`} />}
        {sleepingPct > 0 && <div className="bg-indigo-400/70 transition-all duration-700" style={{ width: `${sleepingPct}%` }} title={`${sleeping} asleep (on demand)`} />}
      </div>
      <div className="mt-1.5 flex items-center gap-3 text-[11px]">
        <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden /><span className="text-slate-500">{healthy} healthy</span></span>
        {unhealthy > 0 && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden /><span className="text-slate-500">{unhealthy} unhealthy</span></span>}
        {stopped > 0 && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-slate-600" aria-hidden /><span className="text-slate-500">{stopped} stopped</span></span>}
        {sleeping > 0 && <span className="flex items-center gap-1"><span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" aria-hidden /><span className="text-slate-500">{sleeping} asleep</span></span>}
      </div>
    </div>
  )
}

function ContainerRow({ container }: { container: HealthContainer }) {
  const key = containerState(container)
  const isSleeping = isAsleep(container)

  return (
    <div className="flex items-center justify-between py-1 px-0.5 group">
      <div className="flex items-center gap-1.5 min-w-0">
        <StateDot state={key} size={6} />
        <span className="text-[11px] text-slate-300 font-mono truncate">{container.name}</span>
        {container.member !== undefined && <VmCapsule member={container.member} name={container.member_name} vmid={container.vmid} size="xs" />}
      </div>
      <div className="flex items-center gap-1.5 shrink-0 ml-2">
        {isSleeping ? (
          <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${STATE_META[key].bg} ${STATE_META[key].text}`} title={STATE_META[key].hint}>on demand</span>
        ) : container.health && container.health !== 'none' && container.health !== 'sleeping' && (
          <span className={`rounded px-1 py-0.5 text-[10px] font-medium ${
            container.health === 'healthy' ? 'bg-emerald-500/10 text-emerald-400'
              : container.health === 'unhealthy' ? 'bg-rose-500/10 text-rose-400'
              : 'bg-amber-500/10 text-amber-400'
          }`}>
            {container.health}
          </span>
        )}
        <span className="text-[10px] text-slate-500">
          {isSleeping ? STATE_META[key].label : container.state}
        </span>
      </div>
    </div>
  )
}

/** a compact metric tile: neutral until the number needs attention */
function DetailCard({ icon, label, value, tone = 'neutral' }: { icon: React.ReactNode; label: string; value: string; tone?: 'neutral' | 'attention' | 'problem' }) {
  return (
    <div className="rounded-lg bg-white/[0.03] px-2 py-2 border border-white/5 text-center">
      <div className="flex items-center justify-center text-slate-500 mb-0.5" aria-hidden>{icon}</div>
      <p className={`text-xs font-semibold tabular-nums ${tone === 'neutral' ? 'text-slate-200' : TONE_TEXT[tone]}`}>{value}</p>
      <p className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function HealthSummary() {
  const report = useHealthStore((s) => s.report)
  const error = useHealthStore((s) => s.error)
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const link = useApiLink()

  // the same scope the Health page uses (everywhere on a hub with VMs), so both say the same (and ask one request)
  const { scope, hasFleet } = useFleetScope()
  const stackCounts = useStackCounts(scope)
  const scorePoll = usePolling<HealthScoreResponse>(() => fetchHealthScore(scope), 30000, { key: pollKeys.healthScore(scope) })
  const scoreData = scorePoll.data
  const scoreLoading = scorePoll.loading && !scoreData

  // The poll failed before anything loaded: say why instead of a skeleton that never resolves
  if (!report && error) return <Card card="health-summary"><CardError title="Could not load the health report" error={error} onRetry={() => window.dispatchEvent(new Event('app-refresh'))} /></Card>

  // Skeleton: the shape of the card once it is filled
  if (!report && isConnected) {
    return (
      <Card card="health-summary">
        <div role="status" aria-live="polite" className="flex-1 min-h-0">
          <span className="sr-only">Loading the health report…</span>
          <div aria-hidden>
            <div className="flex items-center gap-4">
              <div className="w-24 h-24 rounded-full skeleton shrink-0" />
              <div className="flex-1 space-y-2.5">
                <div className="skeleton h-3" /><div className="skeleton h-3 w-3/4" /><div className="skeleton h-3 w-1/2" /><div className="skeleton h-3 w-2/3" />
              </div>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-12" />)}</div>
            <div className="mt-4 space-y-1.5">{[1, 2, 3, 4].map((i) => <div key={i} className="skeleton h-5" />)}</div>
          </div>
        </div>
      </Card>
    )
  }
  if (!report) return <Card card="health-summary" dim><CardOffline /></Card>

  const summary = report.summary
  const effectiveStatus: 'healthy' | 'degraded' | 'critical' | 'unknown' = (() => {
    // the API's own verdict first: it knows when Docker does not answer or a VM is silent, which counts alone read as "healthy"
    if (report.status === 'critical' || report.status === 'degraded') return report.status
    if (summary.unhealthy >= 3) return 'critical'
    if (summary.unhealthy > 0) return 'degraded'
    return 'healthy'
  })()

  const config = statusConfig[effectiveStatus]
  const StatusIcon = config.icon
  const score = scoreData?.score ?? 0
  const grade = scoreData?.grade ?? getGrade(score)
  const factors = scoreData?.factors
  const containers = report.containers ?? []
  // asleep on demand is up (the first request wakes it): x/y counts it, the line says it apart
  const stateCounts = countStates(containers)
  const runningCount = fineCount(stateCounts) + stateCounts.unhealthy
  const cardTone: CardTone | undefined = link.live ? config.tone : (link.state === 'trouble' ? 'attention' : 'problem')

  return (
    <Card
      card="health-summary"
      icon={link.live ? undefined : HeartPulse}
      open="health"
      clickable={false}
      tone={cardTone}
      badge={link.live ? (
        <Badge component="span" color={config.color} leftSection={<StatusIcon size={11} />}>{config.label}</Badge>
      ) : (
        <Hint label={`${link.label} — showing the last known state`}>
          <Badge component="span" color={link.state === 'trouble' ? 'amber' : 'rose'} leftSection={<HeartPulse size={11} className="animate-pulse" />}>{link.short}</Badge>
        </Hint>
      )}
    >
      <CardBody className={`flex flex-col ${link.live ? '' : 'opacity-50 saturate-50'}`}>
        {/* Score gauge + factors */}
        <div className="flex items-start gap-4">
          <div className="flex flex-col items-center gap-1.5">
            <ScoreGauge score={score} grade={grade} loading={scoreLoading} />
            <Badge component="span" color={gradeBadge[grade] ?? 'slate'}>Grade {grade}</Badge>
          </div>

          <div className="flex-1 min-w-0">
            {scoreLoading ? (
              <div className="space-y-2.5">
                {[1, 2, 3, 4, 5].map((i) => <div key={i} className="skeleton h-3.5" />)}
              </div>
            ) : factors ? (
              <div className="space-y-2">
                <FactorBar label="Stacks" value={stackCounts.total > 0 ? Math.round((stackCounts.running / stackCounts.total) * 100) : 100} detail={`${stackCounts.running}/${stackCounts.total} running${stackCounts.sleeping > 0 ? ` · ${stackCounts.sleeping} asleep` : ''}${hasFleet && scope === 'all' ? ' · whole fleet' : ''}`} />
                <FactorBar label="Containers" value={factors.stacks.score} detail={`${factors.stacks.healthy}/${factors.stacks.total} healthy${factors.stacks.sleeping ? ` · ${factors.stacks.sleeping} asleep` : ''}`} />
                <FactorBar label="Resources" value={factors.resources.score} detail={`${factors.resources.cpu_pct}% cpu`} />
                <FactorBar label="Images" value={factors.images.score} detail={factors.images.stale > 0 ? `${factors.images.stale} stale` : 'fresh'} />
                <FactorBar label="Uptime" value={factors.uptime.score} detail={formatUptime(factors.uptime.seconds)} />
              </div>
            ) : null}
          </div>
        </div>

        {/* Resource detail tiles */}
        {factors && (
          <div className="grid grid-cols-4 gap-1.5 mt-3.5">
            <DetailCard icon={<Cpu size={12} />} label="CPU" value={`${factors.resources.cpu_pct}%`} tone={pctTone(factors.resources.cpu_pct) === 'ok' ? 'neutral' : (pctTone(factors.resources.cpu_pct) as 'attention' | 'problem')} />
            <DetailCard icon={<MemoryStick size={12} />} label="Memory" value={`${factors.resources.mem_pct}%`} tone={pctTone(factors.resources.mem_pct) === 'ok' ? 'neutral' : (pctTone(factors.resources.mem_pct) as 'attention' | 'problem')} />
            <DetailCard icon={<HardDrive size={12} />} label="Images" value={`${factors.images.total - factors.images.stale}/${factors.images.total}`} />
            <DetailCard icon={<Timer size={12} />} label="Uptime" value={formatUptime(factors.uptime.seconds)} />
          </div>
        )}

        {/* Distribution bar */}
        <div className="mt-3">
          <SummaryBar healthy={summary.healthy} unhealthy={summary.unhealthy} stopped={summary.stopped} sleeping={summary.sleeping ?? 0} />
        </div>

        {/* Container list: unhealthy first, then running, then stopped */}
        {containers.length > 0 && (
          <div className="mt-3 pt-3 border-t border-white/5 flex flex-col flex-1 min-h-[9rem]">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Containers</span>
              <span className="text-[10px] text-slate-500 tabular-nums" title={statesLine(stateCounts)}>{runningCount}/{containers.length} up{stateCounts.asleep > 0 ? ` · ${stateCounts.asleep} asleep` : ''}</span>
            </div>
            <div className="overflow-y-auto scrollbar-none space-y-0.5 flex-1 min-h-0">
              {containers
                .slice()
                .sort((a, b) => {
                  const priority = (c: HealthContainer) => c.health === 'unhealthy' ? 0 : c.state === 'running' ? 1 : 2
                  return priority(a) - priority(b)
                })
                .map((c) => <ContainerRow key={`${c.member ?? ''}|${c.name}`} container={c} />)
              }
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}
