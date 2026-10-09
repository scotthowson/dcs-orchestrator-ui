// =============================================================================
// The sheet behind an alert: who it came from, when, why CrowdSec fired, what it
// did about it and the requests that raised it. Admins can ban the address, put
// it on the allowlist or jump to it in the Bans tab. Also home of the small
// helpers the alert list shares (outcome chip, source of an alert, Go durations).
// =============================================================================

import { useEffect, useState } from 'react'
import { Bell, Ban, Loader2, UserCheck, ArrowRight, AlertTriangle, ChevronDown, FlaskConical, ShieldCheck, RefreshCw, Infinity as InfinityIcon } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecAlert, crowdsecAllow, crowdsecAllowlist, crowdsecDecisions } from '../../api/endpoints'
import type { CrowdSecAlert, CrowdSecAlertDetail } from '../../../shared/types'
import { Country, errMsg, fmtLeft, fmtNum, looksLikeTarget, originLabel, originTone, useCs, useNow } from './kit'
import BanSheet from './BanSheet'

import { BTN_TOOLBAR_DANGER, BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'
import { type Tone } from '../../lib/tone'
import { Pill } from '../common/Pill'
import { SkeletonBlock } from '../common/PageState'
import Sheet from '../common/Sheet'
import { CopyButton } from '../common/CopyButton'
// ---------------------------------------------------------------------------
// Small helpers (the list uses them too)
// ---------------------------------------------------------------------------

export function plural(n: number, word: string): string {
  return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`
}

/** Go durations as cscli prints them ("3h10m1s", "-4h24m35s", "1m0s", "10s", "0") in seconds; null when it is not one */
export function goSeconds(d: string | null | undefined): number | null {
  if (d === null || d === undefined || d === '') return null
  const s = String(d).trim()
  if (s === '0') return 0
  const factor: Record<string, number> = { ns: 1e-9, us: 1e-6, 'µs': 1e-6, ms: 1e-3, s: 1, m: 60, h: 3600 }
  let total = 0
  let found = false
  for (const m of s.replace(/^-/, '').matchAll(/(\d+(?:\.\d+)?)(ns|us|µs|ms|s|m|h)/g)) {
    found = true
    total += parseFloat(m[1]) * factor[m[2]]
  }
  if (!found) return null
  return s.startsWith('-') ? -total : total
}

/** 10 → "10 seconds", 60 → "1 minute", 5400 → "90 minutes", 7200 → "2 hours" */
export function humanSecs(sec: number): string {
  const s = Math.round(sec)
  if (s < 60) return plural(Math.max(s, 0), 'second')
  if (s < 3600) return s % 60 === 0 ? plural(s / 60, 'minute') : plural(s, 'second')
  if (s < 86400) return s % 3600 === 0 ? plural(s / 3600, 'hour') : plural(Math.round(s / 60), 'minute')
  return plural(Math.round(s / 86400), 'day')
}

/** the moment an alert's first and last request happened apart, in words */
function spanWords(start: string, stop: string): string {
  const a = Date.parse(start), b = Date.parse(stop)
  if (!Number.isFinite(a) || !Number.isFinite(b)) return ''
  const sec = Math.max(0, (b - a) / 1000)
  return sec < 1 ? 'within a second' : `over ${humanSecs(sec)}`
}

/** "2026-09-29 19:13:01.769047693 +0000 UTC" (a Go time) or an ISO stamp → epoch ms */
export function parseGoTime(s: string): number | null {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d+)?\s*(Z|[+-]\d{2}:?\d{2})?/.exec(s)
  if (!m) return null
  const tz = !m[4] || m[4] === 'Z' ? 'Z' : m[4].length === 5 ? `${m[4].slice(0, 3)}:${m[4].slice(3)}` : m[4]
  const ms = Date.parse(`${m[1]}T${m[2]}${(m[3] || '').slice(0, 4)}${tz}`)
  return Number.isFinite(ms) ? ms : null
}

function fmtFull(iso: string | null | undefined): string {
  const ms = iso ? Date.parse(iso) : NaN
  if (!Number.isFinite(ms)) return '—'
  return new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** the address an alert is about: a detection has a source; a manual ban usually has one; an import has none, only the decisions it made */
export function sourceOf(a: Pick<CrowdSecAlert, 'source' | 'decisions'>): { value: string; more: number; own: boolean } {
  if (a.source.value) return { value: a.source.value, more: 0, own: true }
  const vals = [...new Set(a.decisions.map((d) => d.value).filter(Boolean))]
  return { value: vals[0] ?? '', more: Math.max(0, vals.length - 1), own: false }
}

export interface Outcome { tone: Tone; text: string; title: string }
/** what came of an alert, with words that say what is known and what is not */
export function outcomeOf(a: Pick<CrowdSecAlert, 'kind' | 'simulated' | 'banned' | 'remediation'>): Outcome {
  if (a.kind === 'cscli') return { tone: 'info', text: 'Manual ban', title: 'Not a detection: someone banned this address by hand, or imported it. CrowdSec did not see an attack.' }
  if (a.simulated) return { tone: 'attention', text: 'Simulated', title: 'This detector is in simulation mode (Settings): CrowdSec raised the alert but did not ban the address.' }
  if (a.banned) return { tone: 'problem', text: 'Banned now', title: 'This address has an active ban right now.' }
  return { tone: 'neutral', text: 'Not banned', title: a.remediation ? 'The ban this alert led to has ended, or it was lifted. The address is not blocked at the moment.' : 'CrowdSec raised the alert but decided not to ban this address.' }
}

const FIELD_LABEL: Record<string, string> = {
  user_agent: 'User agent', method: 'Method', status: 'Status codes', target_uri: 'Paths requested', target_user: 'Usernames tried', service: 'Service',
  target_fqdn: 'Sites', http_path: 'Path', http_verb: 'Method', http_status: 'Status', http_user_agent: 'User agent',
}
function prettyKey(k: string): string {
  return FIELD_LABEL[k] ?? k.replace(/[_-]+/g, ' ').replace(/^./, (c) => c.toUpperCase())
}
function listOf(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x)))
  if (v === null || v === undefined) return []
  if (typeof v === 'object') return [JSON.stringify(v)]
  return [String(v)]
}

function statusTone(s: string): Tone {
  if (/^2/.test(s)) return 'ok'
  if (/^3/.test(s)) return 'info'
  if (/^4/.test(s)) return 'attention'
  if (/^5/.test(s)) return 'problem'
  return 'neutral'
}

/** the one line an event is shown as; the rest waits behind "All fields" */
function summarize(f: Record<string, string>): { primary: string; status: string; parts: string[] } {
  if (f.http_verb || f.http_path) {
    return { primary: `${f.http_verb || 'GET'} ${f.http_path || '/'}`, status: f.http_status || '', parts: [f.target_fqdn, f.http_user_agent].filter(Boolean) }
  }
  const type = (f.log_type || '').replace(/[_-]+/g, ' ').trim()
  const who = f.target_user ? ` as ${f.target_user}` : ''
  const primary = /failed auth/i.test(type) ? `Failed login${who}` : type ? `${type.charAt(0).toUpperCase()}${type.slice(1)}${who}` : f.program || f.service || 'Log line'
  return { primary, status: '', parts: [f.program || f.service, f.machine, f.source_ip].filter((x, i, arr) => !!x && arr.indexOf(x) === i) }
}

function Section({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{title}</h4>
        {right}
      </div>
      {children}
    </section>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 min-w-0">
      <dt className="text-xs text-slate-500 shrink-0">{label}</dt>
      <dd className="text-xs text-slate-200 text-right min-w-0 break-words select-text">{children}</dd>
    </div>
  )
}

/** a ban's remaining time, counting down; a ban of a year or more is a "permanent" one */
function Left({ secs, at }: { secs: number; at: number }) {
  const now = useNow()
  if (secs >= 365 * 86400) return <Pill tone="problem" title="CrowdSec has no ban without an end, so a permanent ban lasts ten years."><InfinityIcon size={10} /> permanent</Pill>
  const left = Math.round(secs - (now - at) / 1000)
  if (left <= 0) return <span className="text-xs text-slate-500">ended</span>
  return <span className={`text-xs tabular-nums ${left < 300 ? 'text-amber-300' : 'text-slate-300'}`}>ends in {fmtLeft(left)}</span>
}

function EventRow({ ev, n }: { ev: CrowdSecAlertDetail['events'][number]; n: number }) {
  const [open, setOpen] = useState(false)
  const s = summarize(ev.fields)
  const ms = parseGoTime(ev.timestamp)
  const clock = ms === null ? ev.timestamp : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  const keys = Object.keys(ev.fields).sort()
  return (
    <li className="py-2 first:pt-0 last:pb-0">
      <div className="flex items-start gap-2.5 min-w-0">
        <span className="text-[11px] font-mono text-slate-500 tabular-nums shrink-0 w-[4.6rem] pt-0.5" title={ev.timestamp}>{clock}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="font-mono text-xs text-slate-200 line-clamp-2 break-all select-text" title={s.primary}>{s.primary}</span>
            {s.status && <Pill tone={statusTone(s.status)} title={`The server answered ${s.status}`}>{s.status}</Pill>}
          </div>
          {s.parts.length > 0 && <p className="text-[11px] text-slate-500 truncate select-text" title={s.parts.join(' · ')}>{s.parts.join(' · ')}</p>}
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={`${open ? 'Hide' : 'Show'} all fields of request ${n}`}
          className="shrink-0 h-8 sm:h-6 px-2 sm:px-1.5 rounded-md text-[11px] text-slate-500 hover:text-slate-200 hover:bg-white/10 inline-flex items-center gap-1 transition-colors"
        >
          All fields <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open && (
        <dl className="mt-2 ml-[5.1rem] grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-[11px] rounded-lg bg-white/[0.03] border border-white/5 p-2.5">
          {keys.map((k) => (
            <div key={k} className="contents">
              <dt className="text-slate-500 font-mono">{k}</dt>
              <dd className="text-slate-300 font-mono break-all select-text">{ev.fields[k]}</dd>
            </div>
          ))}
        </dl>
      )}
    </li>
  )
}

const EVENTS_SHOWN = 20

// ---------------------------------------------------------------------------
// The sheet
// ---------------------------------------------------------------------------

export function AlertSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const { member, isAdmin, refreshStatus, goTab } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [tries, setTries] = useState(0)
  const [res, setRes] = useState<{ alert: CrowdSecAlertDetail; at: number } | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [lk, setLk] = useState<{ banned: boolean | null; simulated: boolean; allowed: boolean | null } | null>(null)
  const [lkTick, setLkTick] = useState(0)
  const [banning, setBanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const [allEvents, setAllEvents] = useState(false)
  const [tech, setTech] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true); setErr('')
    crowdsecAlert(id, member)
      .then((r) => { if (live) { setRes({ alert: r.alert, at: Date.now() }); setLoading(false) } })
      .catch((e) => { if (live) { setErr(errMsg(e, 'Could not load this alert')); setLoading(false) } })
    return () => { live = false }
  }, [id, member, tries])

  const a = res?.alert ?? null
  const src = a ? sourceOf(a) : { value: '', more: 0, own: false }
  const value = src.value
  const targetOk = !!a && looksLikeTarget(value)

  // is the address banned or allowlisted right now? (best effort: the alert itself does not say)
  useEffect(() => {
    if (!targetOk) { setLk(null); return }
    let live = true
    Promise.allSettled([crowdsecDecisions({ q: value, limit: 50 }, member), crowdsecAllowlist(member)]).then(([d, l]) => {
      if (!live) return
      const mine = d.status === 'fulfilled' ? d.value.decisions.filter((x) => (x.value ?? x.ip) === value) : null
      setLk({
        banned: mine ? mine.some((x) => !x.simulated) : null,
        simulated: !!mine && mine.length > 0 && mine.every((x) => x.simulated),
        allowed: l.status === 'fulfilled' ? l.value.entries.some((e) => e.value === value) : null,
      })
    })
    return () => { live = false }
  }, [value, targetOk, member, lkTick])

  const banReason = a ? (a.kind === 'cscli' ? a.scenario : a.label && a.label !== a.scenario ? `${a.label} (${a.scenario})` : a.scenario).slice(0, 200) : ''

  const allow = async () => {
    if (!value || busy) return
    const banned = lk?.banned
    const ok = await confirm({
      title: 'Never ban this address?',
      message: `${value} goes on the allowlist: CrowdSec will not ban it again.${banned === false ? '' : ' Any ban it has right now is lifted at once.'}\nYou can take it off again in the Allowlist tab.`,
      confirmLabel: 'Never ban it',
    })
    if (!ok) return
    setBusy(true)
    try {
      const r = await crowdsecAllow({ value, comment: `Allowlisted from alert ${id}` }, member)
      addToast({ type: 'success', message: `${value} will never be banned${r.removed_bans > 0 ? `. Lifted ${plural(r.removed_bans, 'active ban')} on it.` : ''}`, duration: 6000 })
      refreshStatus(); setLkTick((n) => n + 1); setTries((n) => n + 1)
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not allowlist this address'), duration: 7000 })
    } finally { setBusy(false) }
  }

  // the ban form is a sheet of its own: show it alone (two sheets would both answer Escape)
  if (banning && a) {
    return <BanSheet initialValue={value} initialReason={banReason} onClose={() => setBanning(false)} onDone={() => { refreshStatus(); setLkTick((n) => n + 1); setTries((n) => n + 1) }} />
  }

  const out = a ? outcomeOf({ kind: a.kind, simulated: a.simulated, banned: !!lk?.banned, remediation: a.remediation }) : null
  const events = a?.events ?? []
  const shownEvents = allEvents ? events : events.slice(0, EVENTS_SHOWN)
  const detector = a && a.kind !== 'cscli' && (a.capacity > 0 || goSeconds(a.leakspeed))
    ? (a.capacity > 0
      ? `CrowdSec fires after ${plural(a.capacity + 1, 'matching request')} from one address, arriving faster than the detector forgets them${goSeconds(a.leakspeed) ? ` (it forgets one every ${humanSecs(goSeconds(a.leakspeed) as number)})` : ''}.`
      : 'This detector fires on a single matching request.')
    : null
  const ctxKeys = a ? Object.keys(a.context ?? {}) : []
  const extraMeta = a ? (a.meta ?? []).filter((m) => !ctxKeys.includes(m.key)) : []
  const canAct = isAdmin && !!a && targetOk
  const title = a ? (a.label || `Alert ${id}`) : `Alert ${id}`
  const subtitle = a ? (a.scenario && a.scenario !== title ? a.scenario : `Alert ${id}`) : undefined

  return (
    <Sheet
      wide
      title={title}
      subtitle={subtitle}
      icon={<Bell size={18} />}
      tone={out?.tone === 'problem' ? 'problem' : out?.tone === 'attention' ? 'attention' : 'info'}
      onClose={onClose}
      footer={canAct ? (
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => { goTab('bans', value); onClose() }} title="Show this address in the list of bans"><ArrowRight size={13} /> Open in Bans</button>
          <button type="button" className={BTN_TOOLBAR_OK} disabled={busy || lk?.allowed === true} onClick={allow} title={lk?.allowed ? 'Already on the allowlist' : 'Put the address on the allowlist so CrowdSec never bans it'}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} {lk?.allowed ? 'On the allowlist' : 'Never ban this address'}
          </button>
          {lk?.banned !== true && lk?.allowed !== true && <button type="button" className={BTN_TOOLBAR_DANGER} disabled={busy} onClick={() => setBanning(true)}><Ban size={13} /> Ban this address</button>}
        </div>
      ) : undefined}
    >
      {loading && !a && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the alert">
          <SkeletonBlock className="h-6 w-2/3" /><SkeletonBlock className="h-28" /><SkeletonBlock className="h-20" /><SkeletonBlock className="h-32" />
        </div>
      )}
      {err && !a && (
        <div className="rounded-lg bg-rose-500/[0.08] border border-rose-500/25 px-3 py-2.5 text-sm text-rose-300 flex items-start gap-2" role="alert">
          <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-400" />
          <div className="min-w-0">
            <p className="break-words">{err}</p>
            <button type="button" className="mt-2 text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1" onClick={() => setTries((n) => n + 1)}><RefreshCw size={11} /> Try again</button>
          </div>
        </div>
      )}

      {a && out && res && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 flex-wrap">
            <Pill tone={out.tone} title={out.title}>{out.tone === 'attention' && <FlaskConical size={10} />} {out.text}</Pill>
            {lk?.allowed && <Pill tone="ok" title="This address is on the allowlist: CrowdSec never bans it."><ShieldCheck size={10} /> Allowlisted</Pill>}
            {lk?.simulated && <Pill tone="attention" title="Its ban is only simulated: it is never enforced."><FlaskConical size={10} /> Ban simulated</Pill>}
            {a.kind !== 'cscli' && <span className="text-xs text-slate-500 tabular-nums">{plural(a.events_count, 'event')} {spanWords(a.start_at, a.stop_at)}</span>}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <Section title={a.kind === 'cscli' ? 'Address' : 'Source'}>
              <div className={`${CARD} px-3.5 py-2.5`}>
                {value ? (
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="font-mono text-sm text-slate-100 break-all select-text">{value}</span>
                    <CopyButton text={value} label={`Copy ${value}`} />
                    {src.more > 0 && <span className="text-[11px] text-slate-500 shrink-0">+{src.more} more</span>}
                  </div>
                ) : <p className="text-xs text-slate-500">No address was recorded.</p>}
                {a.kind === 'cscli' && !src.own && <p className="text-[11px] text-slate-500 mt-1">This ban was added by hand or imported, so it has no source.</p>}
                <dl className="divide-y divide-white/5 mt-1">
                  {a.source.country && <Row label="Country"><Country code={a.source.country} name /></Row>}
                  {a.source.as_name && <Row label="Network owner">{`AS${a.source.as_number} · ${a.source.as_name}`}</Row>}
                  {a.source.range && <Row label="Network range"><span className="font-mono">{a.source.range}</span></Row>}
                  {a.source.latitude !== null && a.source.longitude !== null && <Row label="Location"><span title="Approximate, from the address database">{a.source.latitude}, {a.source.longitude}</span></Row>}
                  {a.source.scope && a.source.scope !== 'Ip' && <Row label="Kind">{a.source.scope === 'Range' ? 'A network' : a.source.scope}</Row>}
                </dl>
              </div>
            </Section>

            <Section title="When">
              <div className={`${CARD} px-3.5 py-2.5`}>
                <dl className="divide-y divide-white/5">
                  <Row label="Raised">{fmtFull(a.created_at)}</Row>
                  {a.kind !== 'cscli' && <Row label="First request">{fmtFull(a.start_at)}</Row>}
                  {a.kind !== 'cscli' && <Row label="Last request">{fmtFull(a.stop_at)}</Row>}
                </dl>
                {detector && <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">{detector}</p>}
              </div>
            </Section>
          </div>

          <Section title="What CrowdSec did" right={a.decisions.length > 0 ? <span className="text-[11px] text-slate-500 tabular-nums">{plural(a.decisions.length, 'decision')}</span> : undefined}>
            {a.decisions.length === 0 ? (
              <p className={`${CARD} px-3.5 py-3 text-xs text-slate-300 leading-relaxed`}>
                {a.simulated
                  ? 'Nothing was banned: this detector is in simulation mode, so it only raises alerts.'
                  : a.kind === 'cscli'
                    ? 'No ban is left on record. The ban added by hand has ended or was lifted. The entry itself is kept for the alerts’ retention time.'
                    : a.remediation
                      ? 'No ban is left on record. The ban this alert led to has ended or was lifted, and CrowdSec has cleaned it up. The alert itself is kept for its retention time.'
                      : 'CrowdSec raised this alert but did not ban anything.'}
              </p>
            ) : (
              <ul className={`${CARD} divide-y divide-white/5`}>
                {a.decisions.slice(0, 30).map((d) => {
                  const secs = goSeconds(d.duration)
                  return (
                    <li key={d.id} className="px-3.5 py-2 flex items-center gap-2 flex-wrap min-w-0">
                      <Pill tone={d.type === 'ban' ? 'problem' : 'attention'} title={d.type === 'ban' ? 'The address is refused' : `Decision type: ${d.type}`}>{d.type || 'ban'}</Pill>
                      <span className="font-mono text-xs text-slate-100 break-all select-text min-w-0">{d.value}</span>
                      <Pill tone={originTone(d.origin)} title={`Origin: ${d.origin || 'unknown'}`}>{originLabel(d.origin)}</Pill>
                      {d.simulated && <Pill tone="attention" title="Only simulated: never enforced"><FlaskConical size={10} /> simulated</Pill>}
                      <span className="ml-auto">{secs === null ? <span className="text-xs text-slate-500">{d.duration}</span> : <Left secs={secs} at={res.at} />}</span>
                    </li>
                  )
                })}
                {a.decisions.length > 30 && <li className="px-3.5 py-2 text-[11px] text-slate-500">and {fmtNum(a.decisions.length - 30)} more</li>}
              </ul>
            )}
          </Section>

          {events.length > 0 && (
            <Section title="The requests that raised it" right={<span className="text-[11px] text-slate-500 tabular-nums">{events.length < a.events_count ? `first ${fmtNum(events.length)} of ${fmtNum(a.events_count)}` : plural(events.length, 'request')}</span>}>
              <ul className={`${CARD} px-3.5 py-3 divide-y divide-white/5`}>
                {shownEvents.map((ev, i) => <EventRow key={i} ev={ev} n={i + 1} />)}
              </ul>
              {events.length > EVENTS_SHOWN && (
                <button type="button" onClick={() => setAllEvents((v) => !v)} className="mt-2 text-xs text-cyan-400 hover:text-cyan-300">
                  {allEvents ? 'Show fewer' : `Show all ${fmtNum(events.length)}`}
                </button>
              )}
            </Section>
          )}

          {(ctxKeys.length > 0 || extraMeta.length > 0) && (
            <Section title="What the requests had in common">
              <dl className={`${CARD} px-3.5 py-2 divide-y divide-white/5`}>
                {ctxKeys.map((k) => {
                  const vals = listOf(a.context[k])
                  return (
                    <div key={k} className="py-1.5 grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-xs">
                      <dt className="text-slate-500 pt-px">{prettyKey(k)}</dt>
                      <dd className="text-slate-200 font-mono text-[11px] leading-relaxed break-all select-text">{vals.slice(0, 12).join(', ')}{vals.length > 12 ? <span className="text-slate-500"> and {vals.length - 12} more</span> : null}</dd>
                    </div>
                  )
                })}
                {extraMeta.map((m) => (
                  <div key={m.key} className="py-1.5 grid grid-cols-[7rem_minmax(0,1fr)] gap-3 text-xs">
                    <dt className="text-slate-500 pt-px">{prettyKey(m.key)}</dt>
                    <dd className="text-slate-200 font-mono text-[11px] break-all select-text">{m.value}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}

          <div>
            <button type="button" onClick={() => setTech((v) => !v)} aria-expanded={tech} className="text-[11px] text-slate-500 hover:text-slate-300 inline-flex items-center gap-1">
              Technical details <ChevronDown size={11} className={`transition-transform ${tech ? 'rotate-180' : ''}`} />
            </button>
            {tech && (
              <dl className={`${CARD} px-3.5 py-2 mt-2 divide-y divide-white/5`}>
                <Row label="Alert number">{a.id}</Row>
                <Row label="Identifier"><span className="font-mono text-[11px]">{a.uuid || '—'}</span></Row>
                <Row label="Detector"><span className="font-mono text-[11px]">{a.scenario || '—'}</span></Row>
                <Row label="Reported by">{a.machine || '—'}</Row>
                <Row label="Kind">{a.kind === 'cscli' ? 'added with cscli (by hand)' : a.kind || '—'}</Row>
                {a.message && <Row label="CrowdSec says">{a.message}</Row>}
              </dl>
            )}
          </div>
        </div>
      )}
    </Sheet>
  )
}
