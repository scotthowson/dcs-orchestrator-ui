// =============================================================================
// The last 30 minutes of a container, from facts only: Docker's own events
// (start, die, stop, pause, health_status, …) and the container's start time.
// Where neither says anything the time is "no data", and an availability that
// had to leave time out (or could not see the health check) is marked estimated.
// =============================================================================

import type { EventEntry, EventsResponse } from '../../../shared/types'

export const WINDOW_MIN = 30
const WINDOW_SEC = WINDOW_MIN * 60
/** GET /events answers with the last 50 Docker events of the last hour (handle_events: --since 1h | tail -50) */
const EVENTS_CAP = 50
const EVENTS_REACH_SEC = 3600

/** a minute of the bar: down (stopped), unhealthy (running, failing its check), up, sleeping (on demand), unknown (no data) */
export type SegStatus = 'up' | 'unhealthy' | 'down' | 'sleeping' | 'unknown'

/** what a row of the page needs to know about a container */
export interface UptimeRow {
  name: string
  state: string
  health: string
  on_demand?: boolean
  member?: string | null
  uptime_seconds?: number
}

/** the stretch of time the events of one server cover, and why it is shorter than the hour when it is */
export interface Coverage {
  from: number
  to: number
  note?: string
}

export interface Minute {
  start: number
  status: SegStatus
  /** seconds of the minute in each state */
  secs: Record<SegStatus, number>
  /** running, but whether the health check passed is not recorded */
  healthUnknown: boolean
  /** the container did not exist yet */
  absent: boolean
}

export interface Timeline {
  minutes: Minute[]
  /** share of the known time it was running and passing its check (on demand and asleep counts as available); null without any known time */
  availability: number | null
  estimated: boolean
  /** why it is estimated, in words */
  why: string[]
  downSec: number
  unhealthySec: number
}

/** the key of a server: '' is the hub (this server), otherwise a member id */
export const ownerKey = (member: string | null | undefined): string => member ?? ''

const RUN_UP = new Set(['start', 'restart', 'unpause'])
const RUN_DOWN = new Set(['die', 'stop', 'pause', 'destroy'])

function runValue(action: string): boolean | null {
  if (RUN_UP.has(action)) return true
  if (RUN_DOWN.has(action)) return false
  return null
}

type Health = 'ok' | 'unhealthy'
function healthValue(action: string): Health | null {
  if (!action.startsWith('health_status')) return null
  return action.includes('unhealthy') ? 'unhealthy' : 'ok' // healthy, starting
}

/** an event worth showing as "the last thing that happened" (a health check's exec is not) */
export function isNotableEvent(e: EventEntry): boolean {
  return (e.type === 'container' || !e.type) && !e.action.startsWith('exec_')
}

/**
 * How far back the events of each server reach. A server's list holds the last hour unless it is full (50 events), in
 * which case it starts at its oldest event; a VM that did not answer has none. `to` is when the list was taken, less
 * the API's own cache (5 s, 10 s for the fleet).
 */
export function coverageOf(res: EventsResponse | null, fetchedAt: number, scopeMember: string | null): Map<string, Coverage> {
  const map = new Map<string, Coverage>()
  if (!res) return map
  const to = fetchedAt - (res.fleet ? 10 : 5)
  const span = (owner: string, count: number, name: string): Coverage => {
    if (count < EVENTS_CAP) return { from: to - EVENTS_REACH_SEC, to }
    const own = res.events.filter((e) => ownerKey(e.member ?? scopeMember) === owner)
    const from = own.length ? Math.min(...own.map((e) => e.timestamp)) : to
    return { from, to, note: `Docker's event list of ${name} reaches back only ${Math.max(0, Math.round((to - from) / 60))} min (the API keeps the last ${EVENTS_CAP} events)` }
  }
  if (res.fleet && res.members) {
    for (const m of res.members) {
      const key = ownerKey(m.id)
      map.set(key, m.reachable ? span(key, m.count, m.id ? `the VM ${m.name}` : 'the hub') : { from: to, to, note: `${m.id ? `The VM ${m.name}` : 'The hub'} did not answer for its events` })
    }
    return map
  }
  const key = ownerKey(scopeMember)
  map.set(key, span(key, res.events.length, scopeMember ? 'the VM' : 'this server'))
  return map
}

/**
 * The container's last 30 minutes. `events` are its own (any order), `cov` what its server's events cover,
 * `startedAt` when the running container started (from its uptime), `now` the end of the window.
 */
export function buildTimeline(row: UptimeRow, events: EventEntry[], cov: Coverage | undefined, startedAt: number | null, now: number): Timeline {
  const ws = now - WINDOW_SEC
  const curUp = row.state.toLowerCase() === 'running'
  const h = row.health.toLowerCase()
  const curHealth: Health = h === 'unhealthy' ? 'unhealthy' : 'ok'
  const evts = [...events].sort((a, b) => a.timestamp - b.timestamp)
  const runEv = evts.filter((e) => runValue(e.action) !== null)
  const healthEv = evts.filter((e) => healthValue(e.action) !== null)
  const hasCheck = h === 'healthy' || h === 'unhealthy' || h === 'starting' || healthEv.length > 0
  const factUp = curUp && startedAt !== null
  // the container was created inside the covered time (its first event is a create): until its first start there was nothing to run
  const created = evts.length > 0 && evts[0].action === 'create' && runEv.length > 0 && runValue(runEv[0].action)
    ? runEv[0].timestamp
    : null

  // the state the events leave it in at the end of what they cover
  const lastRun = runEv.length ? runEv[runEv.length - 1] : null
  const atCovEnd: boolean | null = lastRun
    ? runValue(lastRun.action)
    : curUp ? (factUp && cov && startedAt! <= cov.from ? true : null) : false

  type Run = 'up' | 'down' | 'unknown' | 'absent'
  const runAt = (t: number): Run => {
    if (factUp && t >= startedAt!) return 'up'
    if (!cov || t < cov.from) return 'unknown'
    if (created !== null && t < created) return 'absent'
    if (t > cov.to) return atCovEnd === curUp ? (curUp ? 'up' : 'down') : 'unknown'
    let last: EventEntry | null = null
    for (const e of runEv) { if (e.timestamp <= t) last = e; else break }
    if (last) return runValue(last.action) ? 'up' : 'down'
    const first = runEv.find((e) => e.timestamp > t)
    if (first) return runValue(first.action) ? 'down' : 'up'
    if (atCovEnd === null) return 'unknown'
    return atCovEnd ? 'up' : 'down'
  }

  // the health of a running second: 'ok', 'unhealthy' or null when not recorded
  const healthAt = (t: number): Health | null => {
    if (!hasCheck) return 'ok'
    if (!cov || t < cov.from) return null
    // the start of the run t is in
    let rs: number | null = null
    for (const e of runEv) { if (e.timestamp <= t && runValue(e.action)) rs = e.timestamp; if (e.timestamp > t) break }
    if (factUp && t >= startedAt! && (rs === null || startedAt! > rs)) rs = startedAt
    const nextRunChange = runEv.find((e) => e.timestamp > t)
    const runEnd = nextRunChange ? nextRunChange.timestamp : Infinity
    const inRun = healthEv.filter((e) => (rs === null || e.timestamp >= rs) && e.timestamp < runEnd)
    let last: EventEntry | null = null
    for (const e of inRun) { if (e.timestamp <= t) last = e; else break }
    if (last) return healthValue(last.action)
    const startSeen = rs !== null && rs >= cov.from
    const next = inRun.find((e) => e.timestamp > t)
    if (next) {
      if (healthValue(next.action) === 'unhealthy') return 'ok'
      return startSeen ? 'ok' : null // before "healthy": starting, or failing since before the events reach
    }
    // no health event in this run: the current run keeps the current health; an earlier one was starting if its start is seen
    if (runEnd === Infinity && curUp) return curHealth
    return startSeen ? 'ok' : null
  }

  // the moments the answer can change, then one answer per stretch between them
  const cuts = new Set<number>([ws, now])
  for (let i = 1; i < WINDOW_MIN; i++) cuts.add(ws + i * 60)
  const add = (t: number | null | undefined) => { if (t != null && t > ws && t < now) cuts.add(t) }
  for (const e of evts) add(e.timestamp)
  add(startedAt); add(cov?.from); add(cov?.to); add(created)
  const points = [...cuts].sort((a, b) => a - b)

  const zero = (): Record<SegStatus, number> => ({ up: 0, unhealthy: 0, down: 0, sleeping: 0, unknown: 0 })
  const minutes: Minute[] = Array.from({ length: WINDOW_MIN }, (_, i) => ({ start: ws + i * 60, status: 'unknown', secs: zero(), healthUnknown: false, absent: false }))
  let healthUnknownSec = 0
  let unknownSec = 0
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    const len = b - a
    if (len <= 0) continue
    const mid = (a + b) / 2
    const m = minutes[Math.min(WINDOW_MIN - 1, Math.floor((a - ws) / 60))]
    const run = runAt(mid)
    if (run === 'absent') { m.secs.unknown += len; m.absent = true; continue }
    if (run === 'unknown') { m.secs.unknown += len; unknownSec += len; continue }
    if (run === 'down') { m.secs[row.on_demand ? 'sleeping' : 'down'] += len; continue }
    const hv = healthAt(mid)
    if (hv === 'unhealthy') m.secs.unhealthy += len
    else {
      m.secs.up += len
      if (hv === null) { m.healthUnknown = true; healthUnknownSec += len }
    }
  }

  let up = 0, down = 0, unhealthy = 0, sleeping = 0
  for (const m of minutes) {
    const s = m.secs
    up += s.up; down += s.down; unhealthy += s.unhealthy; sleeping += s.sleeping
    if (s.down >= 1) m.status = 'down'
    else if (s.unhealthy >= 1) m.status = 'unhealthy'
    else {
      const best = (['up', 'sleeping', 'unknown'] as const).reduce((x, y) => (s[y] > s[x] ? y : x))
      m.status = s[best] > 0 ? best : 'unknown'
    }
  }
  const known = up + down + unhealthy + sleeping
  const availability = known >= 1 ? Math.round(((up + sleeping) / known) * 10000) / 100 : null

  const why: string[] = []
  if (unknownSec >= 1) {
    if (!cov) why.push('No Docker events from its server yet')
    else if (cov.note && cov.from > ws) why.push(cov.note)
    else if (cov.from > ws) why.push(`Docker's event list reaches back only ${Math.round((now - cov.from) / 60)} min`)
    else why.push('Its state changed after the last event list was read; the next refresh fills it in')
  }
  if (healthUnknownSec >= 1) why.push('It was running, but whether it passed its health check then is not recorded')

  return { minutes, availability, estimated: why.length > 0, why, downSec: down, unhealthySec: unhealthy }
}

/** fully available is fine, from 95 % needs a look, below that is a problem */
export function availabilityTone(pct: number): 'ok' | 'attention' | 'problem' {
  return pct >= 100 ? 'ok' : pct >= 95 ? 'attention' : 'problem'
}

export function availabilityText(pct: number | null): string {
  if (pct === null) return '—'
  return `${pct >= 99.995 ? 100 : Number(pct.toFixed(pct >= 99 ? 2 : 1))}%`
}

export function formatAverageUptime(seconds: number): string {
  if (seconds <= 0) return '0m'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  if (minutes > 0) return `${minutes}m`
  return `${Math.floor(seconds)}s`
}

export function relativeTime(ts: number): string {
  const diff = Math.max(0, Math.floor(Date.now() / 1000 - ts))
  if (diff < 60) return `${diff}s ago`
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
  return `${Math.floor(diff / 86400)}d ago`
}
