// =============================================================================
// Logs: the tail of CrowdSec's own log. A level, a text filter, how many lines,
// the noisy API request lines on request, and a refresh every 5 seconds while
// the page is in front. The newest line is at the bottom and the view stays
// there until you scroll up to read; then a pill takes you back.
// =============================================================================

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Search, RefreshCw, Copy, Download, ArrowDown, WrapText, AlertTriangle, ScrollText, X, Info, Loader2 } from 'lucide-react'
import { useToast } from '../common/Toast'
import { crowdsecLogs } from '../../api/endpoints'
import { usePolling } from '../../hooks/usePolling'
import { copyText } from '../../lib/clipboard'
import type { CrowdSecLogLine, CrowdSecLogsResponse } from '../../../shared/types'
import { BTN_QUIET, CARD, INPUT, Segmented, Skel, Switch, downloadText, errMsg, fmtNum, useCs, useDebounced } from './kit'

type Level = 'all' | 'warn' | 'error'
const LEVEL_LABEL: Record<Level, string> = { all: 'All levels', warn: 'Warnings and errors', error: 'Errors only' }
const LINE_CHOICES = [100, 300, 500]
const REFRESH_MS = 5000
const NEAR_BOTTOM = 48

const LEVEL_TEXT: Record<string, string> = { info: 'text-slate-300', warn: 'text-amber-300', error: 'text-rose-300', debug: 'text-slate-500' }
const LEVEL_TAG: Record<string, string> = { info: 'text-slate-500', warn: 'text-amber-300', error: 'text-rose-300', debug: 'text-slate-500' }
const LEVEL_ROW: Record<string, string> = { warn: 'bg-amber-500/10', error: 'bg-rose-500/10' }
const LEVEL_NAME: Record<string, string> = { info: 'INFO', warn: 'WARN', error: 'ERROR', debug: 'DEBUG' }

/** where the trailing run of key=value pairs of a message starts (-1 when it has none) */
const KV = /\s+[A-Za-z_][\w.-]*=(?:"(?:[^"\\]|\\.)*"|\S*)/y
function tailStart(m: string): number {
  if (m.length > 2000 || !m.includes('=')) return -1
  for (const c of m.matchAll(/\s[A-Za-z_][\w.-]*=/g)) {
    let pos = c.index as number
    let ok = true
    while (pos < m.length) {
      KV.lastIndex = pos
      const r = KV.exec(m)
      if (!r) { ok = m.slice(pos).trim() === ''; break }
      pos = KV.lastIndex
    }
    if (ok) return c.index as number
  }
  return -1
}

/** text with the search words marked (built from plain text: nothing from the log is ever treated as HTML) */
function Marked({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const parts: React.ReactNode[] = []
  const low = text.toLowerCase(), needle = q.toLowerCase()
  let from = 0
  for (let at = low.indexOf(needle); at !== -1; at = low.indexOf(needle, from)) {
    if (at > from) parts.push(text.slice(from, at))
    parts.push(<mark key={at} className="bg-amber-500/20 text-inherit rounded-sm">{text.slice(at, at + needle.length)}</mark>)
    from = at + needle.length
  }
  parts.push(text.slice(from))
  return <>{parts}</>
}

const clockOf = (t: string): string => {
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }) : ''
}
const dayOf = (t: string): string => {
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? new Date(ms).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }) : ''
}
/** one line as plain text, for Copy and Download */
const lineText = (l: CrowdSecLogLine): string => `${l.time || ''} ${(LEVEL_NAME[l.level] || l.level.toUpperCase()).padEnd(5)} ${l.module ? `[${l.module}] ` : ''}${l.message}`.trim()

function Toggle({ id, label, help, on, onChange }: { id: string; label: string; help: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start gap-3 min-w-0">
      <Switch id={id} checked={on} onChange={onChange} label={label} />
      <div className="min-w-0">
        <label htmlFor={id} className="text-xs text-slate-200 cursor-pointer">{label}</label>
        <p className="text-[11px] text-slate-500 leading-snug mt-0.5">{help}</p>
      </div>
    </div>
  )
}

export default function LogsTab() {
  const { member } = useCs()
  const { addToast } = useToast()
  const [level, setLevel] = useState<Level>('all')
  const [q, setQ] = useState('')
  const dq = useDebounced(q.trim(), 400)
  const [count, setCount] = useState(300)
  const [lapi, setLapi] = useState(false)
  const [auto, setAuto] = useState(true)
  const [wrap, setWrap] = useState(false)

  const [res, setRes] = useState<CrowdSecLogsResponse | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [at, setAt] = useState(0)
  const seq = useRef(0)
  const opts = useRef({ level, q: dq, count, lapi })
  opts.current = { level, q: dq, count, lapi }

  const load = useCallback(async () => {
    const mine = ++seq.current
    const o = opts.current
    setLoading(true)
    try {
      const r = await crowdsecLogs({ lines: o.count, level: o.level, q: o.q || undefined, lapi: o.lapi }, member)
      if (mine !== seq.current) return
      setRes(r); setErr(''); setAt(Date.now())
    } catch (e) {
      if (mine === seq.current) setErr(errMsg(e, 'Could not read the log'))
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [member])

  // a change of any control asks again at once
  useEffect(() => { void load() }, [level, dq, count, lapi, load])
  // and every few seconds while the page is in front
  usePolling(load, REFRESH_MS, { enabled: auto })

  // ---- the panel: stays at the newest line until the reader scrolls up ----
  const box = useRef<HTMLDivElement>(null)
  const stick = useRef(true)
  const [pinned, setPinned] = useState(true)
  const leftAt = useRef('')

  const lines = res?.lines ?? []
  const keyed = useMemo(() => {
    const seen = new Map<string, number>()
    return lines.map((l) => {
      const base = `${l.time}|${l.module}|${l.message}`
      const n = (seen.get(base) ?? 0) + 1
      seen.set(base, n)
      return { l, key: `${base}|${n}` }
    })
  }, [lines])
  const lastKey = keyed.length ? keyed[keyed.length - 1].key : ''

  const toEnd = useCallback(() => {
    const el = box.current
    if (el) el.scrollTop = el.scrollHeight
  }, [])
  useLayoutEffect(() => { if (stick.current) toEnd() }, [res, wrap, toEnd])
  const onScroll = () => {
    const el = box.current
    if (!el) return
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM
    if (near !== stick.current) {
      stick.current = near
      if (!near) leftAt.current = lastKey
      setPinned(near)
    }
  }
  const jump = () => { stick.current = true; setPinned(true); toEnd() }
  const newLines = useMemo(() => {
    if (pinned || !leftAt.current) return 0
    const i = keyed.map((k) => k.key).lastIndexOf(leftAt.current)
    return i === -1 ? keyed.length : keyed.length - 1 - i
  }, [pinned, keyed])

  const kindWord = level === 'warn' ? 'warning or error' : level === 'error' ? 'error' : 'line'
  const emptyTitle = dq ? `No ${kindWord} contains “${dq}”.` : level !== 'all' ? `No ${level === 'warn' ? 'warnings or errors' : 'errors'} in the recent log.` : 'No lines to show.'
  const stopped = !!res && res.state !== 'running'

  const copyVisible = async () => {
    if (!lines.length) return
    try {
      await copyText(lines.map(lineText).join('\n'))
      addToast({ type: 'success', message: `Copied ${fmtNum(lines.length)} log line${lines.length === 1 ? '' : 's'}` })
    } catch { addToast({ type: 'error', message: 'The browser would not copy. Select the lines and copy them by hand.', duration: 6000 }) }
  }
  const download = () => {
    if (!lines.length) return
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    downloadText(`crowdsec-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}.log`, `${lines.map(lineText).join('\n')}\n`)
    addToast({ type: 'success', message: `Saved ${fmtNum(lines.length)} log line${lines.length === 1 ? '' : 's'}` })
  }

  return (
    <div className="space-y-3">
      {/* what to show */}
      <div className="flex items-center gap-2 flex-wrap">
        <Segmented<Level>
          value={level}
          onChange={setLevel}
          ariaLabel="Level"
          options={[
            { value: 'all', label: 'All', title: 'Every line' },
            { value: 'warn', label: 'Warnings', title: 'Warnings and errors' },
            { value: 'error', label: 'Errors', title: 'Errors only' },
          ]}
        />
        <div className="flex items-center gap-2 ml-auto sm:order-last">
          <button type="button" onClick={() => void load()} className={BTN_QUIET} aria-label="Refresh the log" title="Read the log again now">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /><span className="hidden sm:inline">Refresh</span>
          </button>
          <button type="button" onClick={copyVisible} disabled={!lines.length} className={BTN_QUIET} aria-label="Copy the lines shown" title="Copy the lines shown, as text"><Copy size={13} /><span className="hidden sm:inline">Copy</span></button>
          <button type="button" onClick={download} disabled={!lines.length} className={BTN_QUIET} aria-label="Download the lines shown as a .log file" title="Save the lines shown as a .log file"><Download size={13} /><span className="hidden sm:inline">Download .log</span></button>
        </div>
        <Segmented<string>
          value={String(count)}
          onChange={(v) => setCount(Number(v))}
          ariaLabel="Number of lines"
          options={LINE_CHOICES.map((n) => ({ value: String(n), label: `${n} lines`, title: `The newest ${n} lines` }))}
        />
        <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[12rem] sm:max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <label htmlFor="logs-search" className="sr-only">Filter the log by text</label>
          <input id="logs-search" type="search" value={q} maxLength={100} onChange={(e) => setQ(e.target.value)} placeholder="Filter by text" className={`${INPUT} !h-9 !pl-9 !text-xs`} autoComplete="off" spellCheck={false} />
        </div>
      </div>

      {/* how to show it */}
      <div className={`${CARD} px-3.5 py-3 grid gap-x-6 gap-y-3 sm:grid-cols-3`}>
        <Toggle id="logs-lapi" label="Include API request lines" on={lapi} onChange={setLapi} help="CrowdSec notes every request to its own API, and the bouncer asks every few seconds: mostly noise, so they are hidden. Default: off." />
        <Toggle id="logs-auto" label="Refresh by itself" on={auto} onChange={setAuto} help="Reads the newest lines every 5 seconds while this page is in front. Default: on." />
        <Toggle id="logs-wrap" label="Wrap long lines" on={wrap} onChange={setWrap} help="Off keeps one line per row; scroll sideways for the rest. Default: off." />
      </div>

      {stopped && res && (
        <p className="text-xs text-amber-300 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <Info size={14} className="shrink-0 mt-0.5" /> <span>CrowdSec is not running (the container is {res.state}). {lines.length ? 'These are the last lines it wrote before it stopped.' : 'It has left no lines to show.'}</span>
        </p>
      )}
      {err && res && (
        <p className="text-xs text-amber-300 flex items-center gap-2 flex-wrap rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <AlertTriangle size={13} className="shrink-0" /> <span className="min-w-0">Could not refresh ({err}). Showing the lines from {new Date(at).toLocaleTimeString()}.</span>
          <button type="button" onClick={() => void load()} className="text-cyan-400 hover:text-cyan-300 hover:underline underline-offset-2">Try again</button>
        </p>
      )}

      {!res && !err && <div className={`${CARD} p-3 space-y-2`} aria-busy="true" aria-label="Loading the log">{[0, 1, 2, 3, 4, 5, 6, 7].map((i) => <Skel key={i} className="h-4" />)}</div>}
      {!res && err && (
        <div className={`${CARD} p-4 flex items-start gap-3`} role="alert">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-rose-300 break-words">{err}</p>
            <p className="text-xs text-slate-500 mt-1">The log could not be read. Docker may be busy or CrowdSec may be restarting.</p>
            <button type="button" onClick={() => void load()} className={`${BTN_QUIET} mt-3`}><RefreshCw size={13} /> Try again</button>
          </div>
        </div>
      )}

      {res && lines.length === 0 && (
        <div className={`${CARD} px-6 py-12 text-center`}>
          <ScrollText size={30} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm text-slate-300">{emptyTitle}</p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            {dq
              ? `CrowdSec's recent log has nothing like that${lapi ? '' : ', not counting the API request lines, which are hidden'}. Loosen the filter, or read a longer stretch.`
              : level !== 'all'
                ? `That is good news, or the stretch read is too short to hold one${lapi ? '' : ' (API request lines are not counted)'}. Read a longer stretch to look further back.`
                : lapi
                  ? 'CrowdSec has not written anything yet. Its log fills up as it reads and reacts.'
                  : 'The only lines CrowdSec has written lately are its API requests, which are hidden. Switch on “Include API request lines” to see them.'}
          </p>
          <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
            {(level !== 'all' || q) && <button type="button" onClick={() => { setLevel('all'); setQ('') }} className={BTN_QUIET}><X size={13} /> Clear the filters</button>}
            {!lapi && <button type="button" onClick={() => setLapi(true)} className={BTN_QUIET}>Include API request lines</button>}
            {count < 500 && <button type="button" onClick={() => setCount(500)} className={BTN_QUIET}>Read 500 lines</button>}
          </div>
        </div>
      )}

      {res && lines.length > 0 && (
        <div>
          <div className="relative">
            <div
              ref={box}
              onScroll={onScroll}
              role="log"
              aria-live="off"
              aria-label="CrowdSec log, newest line at the bottom"
              tabIndex={0}
              className={`${CARD} max-h-[58vh] min-h-[10rem] overflow-auto scrollbar-thin font-mono text-[12px] leading-[1.55] py-1.5 focus:outline-none focus-visible:border-emerald-500/40`}
            >
              {keyed.map(({ l, key }, i) => {
                const prev = i > 0 ? keyed[i - 1].l : null
                const day = dayOf(l.time)
                const newDay = !!day && (!prev || dayOf(prev.time) !== day)
                const tail = tailStart(l.message)
                const head = tail === -1 ? l.message : l.message.slice(0, tail)
                const rest = tail === -1 ? '' : l.message.slice(tail)
                return (
                  <div key={key}>
                    {newDay && <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wider text-slate-500 font-sans">{day}</div>}
                    <div className={`flex items-baseline gap-x-2 px-3 py-px ${LEVEL_ROW[l.level] ?? ''} ${wrap ? 'flex-wrap sm:flex-nowrap' : 'w-max min-w-full'}`}>
                      <span className="text-slate-500 tabular-nums shrink-0" title={l.time ? new Date(l.time).toLocaleString() : undefined}>{clockOf(l.time) || '        '}</span>
                      <span className={`w-[3.2rem] shrink-0 text-[10px] font-semibold tracking-wide ${LEVEL_TAG[l.level] ?? 'text-slate-500'}`}>{LEVEL_NAME[l.level] ?? l.level.toUpperCase()}</span>
                      {l.module && <span className="shrink-0 text-[10px] leading-none px-1 py-[3px] rounded bg-white/5 border border-white/10 text-slate-500 font-sans">{l.module}</span>}
                      <span className={`${LEVEL_TEXT[l.level] ?? 'text-slate-300'} select-text min-w-0 ${wrap ? 'whitespace-pre-wrap break-words basis-full sm:basis-0 sm:flex-1' : 'whitespace-pre'}`}>
                        <Marked text={head} q={dq} />
                        {rest && <span className="text-slate-500"><Marked text={rest} q={dq} /></span>}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
            {!pinned && (
              <button
                type="button"
                onClick={jump}
                className="absolute left-1/2 -translate-x-1/2 bottom-3 h-8 px-3.5 rounded-full glass border border-emerald-500/30 text-xs font-medium text-emerald-300 inline-flex items-center gap-1.5 shadow-lg hover:bg-emerald-500/10 transition-colors"
              >
                <ArrowDown size={13} /> Jump to latest{newLines > 0 ? ` · ${fmtNum(newLines)} new` : ''}
              </button>
            )}
          </div>
          <div className="flex items-center justify-between gap-3 flex-wrap text-[11px] text-slate-500 px-1 mt-2">
            <span className="tabular-nums">
              {res.count > lines.length ? `The newest ${fmtNum(lines.length)} of ${fmtNum(res.count)} matching lines in the recent log` : `${fmtNum(lines.length)} line${lines.length === 1 ? '' : 's'}`}
              {level !== 'all' ? ` · ${LEVEL_LABEL[level].toLowerCase()}` : ''}{dq ? ` · containing “${dq}”` : ''}
              {res.lapi_included ? ' · with API request lines' : ''}
            </span>
            <span className="inline-flex items-center gap-2">
              {loading && <Loader2 size={11} className="animate-spin" aria-label="Reading" />}
              {auto ? `Refreshes every ${REFRESH_MS / 1000} seconds` : 'Not refreshing by itself'}
              {wrap && <WrapText size={11} aria-hidden="true" />}
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
