// =============================================================================
// containerState — one answer, everywhere, to "how is this container doing?"
//
// A container is running, ASLEEP (it starts on demand: Sablier stopped it while idle on
// purpose, and the first request wakes it — healthy), stopped, unhealthy or restarting.
// Asleep is never counted, coloured or worded as a problem: it has its own calm state
// (indigo, a moon, the word "asleep"). The one exception is an on-demand container whose
// Sablier is not running: nothing can wake it, so it is a problem ("can't wake").
// Every count of running/total, every state chip and dot reads this file.
// =============================================================================

export type ContainerStateKey = 'running' | 'starting' | 'unhealthy' | 'restarting' | 'paused' | 'asleep' | 'stuck' | 'created' | 'stopped'

/** what a row from the API carries (GET /containers, /health, /stacks/:name, the fleet snapshot, the topology) */
export interface ContainerStateInput {
  state?: string
  status?: string
  health?: string
  on_demand?: boolean
  /** an on-demand container's Sablier runs (it can wake); false: nothing can wake it */
  sablier_up?: boolean | null
}

export function containerState(c: ContainerStateInput): ContainerStateKey {
  const s = String(c.state ?? c.status ?? '').toLowerCase()
  const h = String(c.health ?? '').toLowerCase()
  const running = s === 'running' || s.startsWith('up')
  if (running) {
    if (h === 'unhealthy') return 'unhealthy'
    if (h === 'starting') return 'starting'
    return 'running'
  }
  if (s === 'restarting') return 'restarting'
  if (s === 'paused') return 'paused'
  if (c.on_demand) return c.sablier_up === false ? 'stuck' : 'asleep'
  if (s === 'created') return 'created'
  return 'stopped'
}

export const ASLEEP_HINT = 'On demand: Sablier stopped it while idle — it wakes on the first request'
export const STUCK_HINT = 'On demand, but Sablier is not running: nothing can wake it until Sablier starts again'

export interface StateMeta {
  /** the word on a chip */
  label: string
  /** a sentence for a tooltip */
  hint: string
  /** Tailwind classes: the pill and the dot */
  bg: string
  text: string
  ring: string
  dot: string
  /** for charts and inline colours (theme-aware) */
  color: string
  /** a problem that needs someone */
  problem: boolean
}

export const STATE_META: Record<ContainerStateKey, StateMeta> = {
  running:    { label: 'running', hint: 'Running', bg: 'bg-emerald-500/10', text: 'text-emerald-400', ring: 'ring-emerald-500/20', dot: 'bg-emerald-400', color: 'var(--dcs-success, #34d399)', problem: false },
  starting:   { label: 'starting', hint: 'Running, its health check has not passed yet', bg: 'bg-cyan-500/10', text: 'text-cyan-400', ring: 'ring-cyan-500/20', dot: 'bg-cyan-400', color: 'var(--dcs-info, #22d3ee)', problem: false },
  unhealthy:  { label: 'unhealthy', hint: 'Running, but failing its health check', bg: 'bg-rose-500/10', text: 'text-rose-400', ring: 'ring-rose-500/20', dot: 'bg-rose-400', color: 'var(--dcs-danger, #fb7185)', problem: true },
  restarting: { label: 'restarting', hint: 'Docker is restarting it', bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', dot: 'bg-amber-400', color: 'var(--dcs-warning, #fbbf24)', problem: true },
  paused:     { label: 'paused', hint: 'Paused', bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', dot: 'bg-amber-400', color: 'var(--dcs-warning, #fbbf24)', problem: false },
  asleep:     { label: 'asleep', hint: ASLEEP_HINT, bg: 'bg-indigo-500/10', text: 'text-indigo-300', ring: 'ring-indigo-500/20', dot: 'bg-indigo-400', color: '#818cf8', problem: false },
  stuck:      { label: "can't wake", hint: STUCK_HINT, bg: 'bg-amber-500/10', text: 'text-amber-400', ring: 'ring-amber-500/20', dot: 'bg-amber-400', color: 'var(--dcs-warning, #fbbf24)', problem: true },
  created:    { label: 'created', hint: 'Created, never started', bg: 'bg-slate-500/10', text: 'text-slate-400', ring: 'ring-slate-500/20', dot: 'bg-slate-400', color: 'var(--dcs-text-muted, #94a3b8)', problem: false },
  stopped:    { label: 'stopped', hint: 'Stopped', bg: 'bg-rose-500/10', text: 'text-rose-400', ring: 'ring-rose-500/20', dot: 'bg-rose-400', color: 'var(--dcs-danger, #fb7185)', problem: true },
}

export function isAsleep(c: ContainerStateInput): boolean {
  const k = containerState(c)
  return k === 'asleep' || k === 'stuck'
}

/** up and doing its job: running (healthy or not checked), or asleep on demand */
export function isFine(c: ContainerStateInput): boolean {
  const k = containerState(c)
  return k === 'running' || k === 'starting' || k === 'asleep'
}

export interface StateCounts {
  total: number
  /** running, its health check passing or not checked (starting included) */
  running: number
  unhealthy: number
  restarting: number
  /** on demand, asleep, Sablier there to wake it: fine */
  asleep: number
  /** on demand, asleep, and no Sablier: a problem */
  stuck: number
  /** stopped, exited, dead, created or paused */
  stopped: number
}

export function countStates(list: readonly ContainerStateInput[] | undefined | null): StateCounts {
  const n: StateCounts = { total: 0, running: 0, unhealthy: 0, restarting: 0, asleep: 0, stuck: 0, stopped: 0 }
  for (const c of list ?? []) {
    n.total++
    switch (containerState(c)) {
      case 'running': case 'starting': n.running++; break
      case 'unhealthy': n.unhealthy++; break
      case 'restarting': n.restarting++; break
      case 'asleep': n.asleep++; break
      case 'stuck': n.stuck++; break
      default: n.stopped++
    }
  }
  return n
}

/** counts from numbers an endpoint added up (running/total plus the asleep ones): stopped is what is left */
export function countsFrom(total: number, running: number, asleep = 0, stuck = 0): StateCounts {
  const t = Math.max(0, total || 0), r = Math.max(0, running || 0)
  const z = Math.max(0, Math.min(asleep || 0, t - r))
  const k = Math.max(0, Math.min(stuck || 0, z))
  return { total: t, running: r, unhealthy: 0, restarting: 0, asleep: z - k, stuck: k, stopped: Math.max(0, t - r - z) }
}

/** running or asleep: the share that is fine (unhealthy is running, but not fine) */
export function fineCount(n: StateCounts): number { return n.running + n.asleep }
export function problemCount(n: StateCounts): number { return n.stopped + n.stuck + n.unhealthy + n.restarting }

/** "2 containers · 1 running · 1 asleep" (the parts add up to the total; those that are zero are left out, running always said) */
export function statesLine(n: StateCounts, opts: { noun?: boolean } = {}): string {
  const parts: string[] = []
  if (opts.noun !== false) parts.push(`${n.total} container${n.total === 1 ? '' : 's'}`)
  parts.push(`${n.running} running`)
  if (n.asleep) parts.push(`${n.asleep} asleep`)
  if (n.stuck) parts.push(`${n.stuck} can't wake`)
  if (n.restarting) parts.push(`${n.restarting} restarting`)
  if (n.unhealthy) parts.push(`${n.unhealthy} unhealthy`)
  if (n.stopped) parts.push(`${n.stopped} stopped`)
  return parts.join(' · ')
}

// ── Stacks ──────────────────────────────────────────────────────────────────

export type StackStateKey = 'running' | 'partial' | 'asleep' | 'stuck' | 'stopped' | 'unknown'

export interface StackStateInput {
  status?: string
  running_containers?: number
  total_containers?: number
  sleeping?: boolean
  sleeping_containers?: number
  sablier_up?: boolean | null
  reachable?: boolean
}

/** running (every container runs or sleeps), partial (some are down), asleep (all of it on demand, asleep), stopped */
export function stackState(s: StackStateInput): StackStateKey {
  if (s.reachable === false || s.status === 'unknown') return 'unknown'
  const asleepAll = !!s.sleeping || (s.status !== 'running' && (s.running_containers ?? 0) === 0 && (s.sleeping_containers ?? 0) > 0
    && (s.total_containers == null || s.total_containers <= (s.sleeping_containers ?? 0)))
  if (s.status === 'running') {
    const down = s.total_containers != null ? s.total_containers - (s.running_containers ?? 0) - (s.sleeping_containers ?? 0) : 0
    return down > 0 ? 'partial' : 'running'
  }
  if (asleepAll) return s.sablier_up === false ? 'stuck' : 'asleep'
  return 'stopped'
}

/** a stack that is fine: running, or asleep on demand */
export function stackIsFine(s: StackStateInput): boolean {
  const k = stackState(s)
  return k === 'running' || k === 'asleep'
}

export const STACK_META: Record<StackStateKey, { label: string; hint: string; dot: string; text: string }> = {
  running: { label: 'Running', hint: 'Every container runs (or sleeps on demand)', dot: 'bg-emerald-400', text: 'text-emerald-400' },
  partial: { label: 'Partly down', hint: 'Some of its containers are stopped', dot: 'bg-amber-400', text: 'text-amber-400' },
  asleep:  { label: 'Asleep', hint: 'All of it starts on demand: Sablier wakes it on the first request', dot: 'bg-indigo-400', text: 'text-indigo-300' },
  stuck:   { label: "Can't wake", hint: STUCK_HINT, dot: 'bg-amber-400', text: 'text-amber-400' },
  stopped: { label: 'Stopped', hint: 'Stopped', dot: 'bg-slate-500', text: 'text-slate-400' },
  unknown: { label: 'Unknown', hint: 'Its server does not answer', dot: 'bg-slate-600', text: 'text-slate-500' },
}

/** a stack's short line: "3 running · 1 asleep", "asleep", "can't wake", "2 running · 1 stopped", "stopped" */
export function stackLine(s: StackStateInput): string {
  const k = stackState(s)
  if (k === 'asleep') return 'asleep'
  if (k === 'stuck') return "can't wake"
  if (k === 'stopped') return 'stopped'
  if (k === 'unknown') return 'not answering'
  const parts = [`${s.running_containers ?? 0} running`]
  if ((s.sleeping_containers ?? 0) > 0) parts.push(`${s.sleeping_containers} asleep`)
  const down = s.total_containers != null ? s.total_containers - (s.running_containers ?? 0) - (s.sleeping_containers ?? 0) : 0
  if (down > 0) parts.push(`${down} stopped`)
  return parts.join(' · ')
}

/** the colour of a stack's short line: calm indigo asleep, amber when part of it is down or it can't wake, muted otherwise */
export function stackLineTone(s: StackStateInput): string {
  const k = stackState(s)
  return k === 'asleep' ? 'text-indigo-300' : k === 'partial' || k === 'stuck' ? 'text-amber-400' : 'text-slate-500'
}

// ── Events ──────────────────────────────────────────────────────────────────

/** a container event of an on-demand container: its stop is falling asleep (not a crash), its start waking up */
export function onDemandEventWord(e: { type?: string; action: string; on_demand?: boolean }): 'fell asleep' | 'woke up' | null {
  if (!e.on_demand || (e.type && e.type !== 'container')) return null
  const a = e.action.toLowerCase()
  if (a === 'stop' || a === 'die' || a === 'kill') return 'fell asleep'
  if (a === 'start') return 'woke up'
  return null
}
