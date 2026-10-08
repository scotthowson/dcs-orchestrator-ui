// =============================================================================
// Discord: what CrowdSec tells your channel. Everything about the message is
// here and nothing is left to a config file: whether it is on, which webhook,
// who sends it and how it looks, what triggers it, the text and the fields
// with placeholders, delivery, a live preview drawn by the server, a test
// message, and the honest outcome of every change (which restarts CrowdSec).
// A viewer sees the same settings as words and chips, no buttons.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { AlertTriangle, Braces, ChevronRight, Clock, Eye, EyeOff, Filter, Info, KeyRound, ListChecks, Loader2, Palette, RefreshCw, RotateCcw, Save, ShieldCheck, Trash2, Undo2, Webhook } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecNotify, crowdsecPreviewNotify, crowdsecResetNotify, crowdsecSaveNotify, crowdsecSimulation, crowdsecTestNotify } from '../../api/endpoints'
import type { CrowdSecNotifyBody, CrowdSecNotifyResponse, DiscordWebhookPayload } from '../../../shared/types'
import { BTN_DANGER, BTN_PRIMARY, BTN_QUIET, BTN_WARN, CARD, Chip, CsSheet, Dot, HINT, INPUT, LABEL, Skel, TEXTAREA, errData, errMsg, useCs } from './kit'
import {
  GROUP_WORD, LIM, NUM, changeRows, cpLen, deepEqual, describeChanges, diffPatch, draftMemory, mentionTag, orderSamples, approximatePayload, redact, sectionOfError, settingsOf, toForm, validateForm, webhookProblem,
  type Errors, type GroupBy, type Limits, type MentionMode, type NotifyForm, type Settings, type WebhookMode,
} from './NotifyModel'
import {
  ChoiceCards, ColorField, Counter, FieldShell, FieldsEditor, Notice, NumberField, PhProvider, PillChoice, PlaceholderInput, PlaceholderPicker, Section, ToggleRow, TokenInput, useMedia, usePhRegistry,
  type TokenSuggestion,
} from './NotifyFields'
import { ApplyProgress, StatusCard, type TestOutcomeData } from './NotifyStatus'
import PreviewPanel from './NotifyPreview'
import DigestCard from './NotifyDigest'
import { ApiError } from '../../api/client'
import { getRun, setRun, subscribeRun, type Outcome } from './NotifyRun'

const DEFAULT_LIMITS: Limits = { title: 200, description: 1500, footer: 200, fields: 8, group_threshold_max: 100 }
/** viewers get the server's drawing too (it only renders, it never sends); an older server that still refuses them falls back to the local sketch */
const VIEWER_SERVER_PREVIEW = true

const DARK_KEY = 'dcs-crowdsec-notify-dark'
const OPEN_KEY = 'dcs-crowdsec-notify-open'
type SectionId = 'webhook' | 'appearance' | 'triggers' | 'message' | 'delivery'
const SECTION_ORDER: SectionId[] = ['webhook', 'appearance', 'triggers', 'message', 'delivery']
const DEFAULT_OPEN: Record<SectionId, boolean> = { webhook: true, appearance: true, triggers: true, message: true, delivery: false }
/** the Discord theme the preview uses: what was chosen last, else the one that matches this page */
const loadDark = (): boolean => {
  try { const v = localStorage.getItem(DARK_KEY); if (v === '0' || v === '1') return v === '1' } catch { /* private window */ }
  return !document.documentElement.classList.contains('light')
}
function loadOpen(): Record<SectionId, boolean> {
  try { return { ...DEFAULT_OPEN, ...(JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') as Partial<Record<SectionId, boolean>>) } } catch { return DEFAULT_OPEN }
}

const MODE_TITLE: Record<WebhookMode, string> = { global: 'Global', custom: 'Custom', keep: 'Keep current' }
const MENTION_WORDS: Record<MentionMode, string> = { none: 'nobody', role: 'a role', user: 'a user', here: '@here', everyone: '@everyone' }

/** one debounced value that follows at once when there was nothing yet */
function useSettled(value: string, ms: number): string {
  const [v, setV] = useState(value)
  useEffect(() => {
    if (value === v) return
    if (v === '' || value === '') { setV(value); return }
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, v, ms])
  return v
}

/** scenario names to offer, plus the prefixes that cover several of them (crowdsecurity/ssh*) */
function scenarioSuggestions(list: { name: string; description: string }[]): TokenSuggestion[] {
  const groups = new Map<string, number>()
  for (const s of list) {
    const m = /^([^/]+\/[^-]+)-/.exec(s.name)
    if (m) groups.set(m[1], (groups.get(m[1]) ?? 0) + 1)
  }
  const prefixes: TokenSuggestion[] = [...groups.entries()].filter(([, n]) => n >= 2).map(([p, n]) => ({ value: `${p}*`, hint: `A prefix: the ${n} scenarios starting with ${p}` }))
  return [...prefixes, ...list.map((s) => ({ value: s.name, hint: s.description }))]
}

/** the API appends CrowdSec's own log lines to a failure after "Log:": the sentence stays up front, the lines fold away */
function splitLog(detail?: string): { text: string; log: string } {
  const d = detail ?? ''
  const i = d.search(/\sLog:\s/)
  return i < 0 ? { text: d, log: '' } : { text: d.slice(0, i).trim(), log: d.slice(i).replace(/^\s*Log:\s*/, '').replace(/\s(?=time=")/g, '\n') }
}

function KV({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-0.5 py-2 first:pt-0 last:pb-0">
      <dt className="text-xs text-slate-500">{k}</dt>
      <dd className="text-sm text-slate-200 break-words min-w-0">{children}</dd>
    </div>
  )
}
function Template({ children }: { children: string }) {
  return <code className="block font-mono text-[12px] text-slate-200 bg-white/[0.03] border border-white/5 rounded-lg px-3 py-2 whitespace-pre-wrap break-words">{children === '' ? '(empty)' : children}</code>
}

// =============================================================================
// The tab: loads the answer, then hands it to the editor
// =============================================================================

export default function NotificationsTab() {
  const { member } = useCs()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const lastRef = useRef<CrowdSecNotifyResponse | null>(null)
  const fetchNow = async (): Promise<CrowdSecNotifyResponse> => {
    // while a change is being applied CrowdSec is restarting: asking it would only fail, and the answer would be older than the change
    if (getRun(member).busy && lastRef.current) return lastRef.current
    const startedAt = Date.now()
    const d = await crowdsecNotify(member)
    const run = getRun(member)
    if (run.busy && lastRef.current) return lastRef.current
    // a change ended while this request was on its way: what that change answered with is newer than this answer
    if (run.res && run.doneAt > startedAt) { lastRef.current = run.res; return run.res }
    lastRef.current = d
    return d
  }
  const poll = usePolling<CrowdSecNotifyResponse>(fetchNow, 30000, { enabled: isConnected })
  const data = poll.data

  if (!data && poll.error) {
    return (
      <div className={`${CARD} p-6 text-center`} role="alert">
        <AlertTriangle size={26} className="mx-auto text-rose-400" />
        <p className="mt-3 text-sm text-slate-200">Could not read the Discord settings.</p>
        <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto break-words">{poll.error.message}</p>
        <button type="button" onClick={poll.refresh} className={`${BTN_QUIET} mt-4`}><RefreshCw size={13} /> Try again</button>
      </div>
    )
  }
  if (!data) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading the Discord settings">
        <Skel className="h-64" />
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_28rem] gap-4"><div className="space-y-3"><Skel className="h-16" /><Skel className="h-16" /><Skel className="h-16" /><Skel className="h-16" /></div><Skel className="h-96 hidden xl:block" /></div>
      </div>
    )
  }
  return <Editor data={data} refresh={poll.refresh} refreshFailed={!!poll.error} />
}

// =============================================================================
// The editor
// =============================================================================

function Editor({ data, refresh, refreshFailed }: { data: CrowdSecNotifyResponse; refresh: () => void; refreshFailed: boolean }) {
  const { member, isAdmin, refreshStatus, goTab } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const wide = useMedia('(min-width: 1280px)')
  const reg = usePhRegistry()

  // ---- what the server said, what the person is editing ----
  const [server, setServer] = useState<CrowdSecNotifyResponse>(data)
  useEffect(() => { setServer(data) }, [data])
  const memo = useMemo(() => draftMemory.get(member), [member])
  const [base, setBase] = useState<Settings>(memo?.base ?? data.settings)
  const [form, setForm] = useState<NotifyForm>(memo?.form ?? toForm(data.settings))
  const [url, setUrl] = useState(memo?.url ?? '')
  const [showUrl, setShowUrl] = useState(false)
  const [sample, setSample] = useState(memo?.sample ?? 'burst')
  const [restored, setRestored] = useState(!!memo)
  const patchForm = useCallback((p: Partial<NotifyForm>) => setForm((f) => ({ ...f, ...p })), [])

  const limits = server.limits ?? DEFAULT_LIMITS
  const ph = server.placeholders
  const known = useMemo(() => (ph.length ? new Set(ph.map((p) => p.name)) : null), [ph])
  const def = server.defaults
  const settingsNow = useMemo(() => settingsOf(form, base.v), [form, base.v])
  const errors: Errors = useMemo(() => validateForm(form, known, limits), [form, known, limits])
  const patch = useMemo(() => (diffPatch(base, settingsNow) ?? {}) as NonNullable<CrowdSecNotifyBody['settings']>, [base, settingsNow])
  const urlTyped = url.trim()
  const urlProblem = useMemo(() => webhookProblem(url), [url])
  const urlSend = form.mode === 'custom' && urlTyped !== '' && !urlProblem
  const dirty = !deepEqual(base, settingsNow) || (form.mode === 'custom' && urlTyped !== '')

  // the saved settings changed elsewhere: follow them while nothing is being edited
  useEffect(() => {
    if (deepEqual(server.settings, base)) return
    if (!dirty) { setBase(server.settings); setForm(toForm(server.settings)) }
  }, [server.settings]) // eslint-disable-line react-hooks/exhaustive-deps
  const changedElsewhere = dirty && !deepEqual(server.settings, base)

  // the draft outlives a visit to another tab
  useEffect(() => {
    if (dirty) draftMemory.set(member, { form, base, url, sample })
    else draftMemory.clear(member)
  }, [dirty, form, base, url, sample, member])

  // ---- the webhook ----
  const wh = server.webhook
  const src = wh.sources
  const modeReady = (mode: WebhookMode): boolean => (mode === 'custom' ? urlSend || src.custom.configured : src[mode].configured)
  const webhookIssue: string | null = useMemo(() => {
    if (form.mode === 'custom' && urlTyped !== '' && urlProblem) return urlProblem
    if (modeReady(form.mode)) return null
    return form.mode === 'global' ? 'There is no global webhook. Set DISCORD_WEBHOOK_URL under Server Config → Notifications, or choose Custom and add an address.'
      : form.mode === 'custom' ? 'Add the address of the custom webhook, or choose another source.'
      : 'CrowdSec’s notification file has no webhook to keep. Choose Global or Custom.'
  }, [form.mode, urlTyped, urlProblem, src]) // eslint-disable-line react-hooks/exhaustive-deps
  const blockingWebhook = form.enabled ? webhookIssue : (urlTyped !== '' && urlProblem ? urlProblem : null)

  // ---- what saving would replace ----
  const st = server.state
  const fileTakeover = st.file === 'other' && form.enabled
  const profileTakeover = st.profile_mode === 'custom'
  const needsTakeOver = fileTakeover || profileTakeover
  const confirmTakeOver = async (what: string): Promise<boolean> => {
    const parts: string[] = []
    if (fileTakeover) parts.push('CrowdSec’s notification file was not written by this page (it is CrowdSec’s own sample, comes from a stack template or was edited by hand). It is replaced by the file built from these settings; a copy of the old one is kept.')
    if (profileTakeover) parts.push('profiles.yaml in CrowdSec has profiles DCS did not write. It is replaced by the ban profile DCS manages, with these notification settings; a copy of the old file is kept.')
    return confirm({ title: fileTakeover && profileTakeover ? 'Replace CrowdSec’s files?' : fileTakeover ? 'Replace the notification file?' : 'Replace profiles.yaml?', message: `${parts.join('\n')}\n${what}`, confirmLabel: 'Replace and continue', danger: true })
  }

  // ---- sections ----
  const [open, setOpenState] = useState<Record<SectionId, boolean>>(loadOpen)
  const toggle = (id: SectionId) => setOpenState((o) => { const n = { ...o, [id]: !o[id] }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)) } catch { /* private window */ } return n })
  const reveal = (id: SectionId) => {
    setOpenState((o) => (o[id] ? o : { ...o, [id]: true }))
    setTimeout(() => document.getElementById(`notify-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30)
  }
  const problemCount = useMemo(() => {
    const c: Record<SectionId, number> = { webhook: 0, appearance: 0, triggers: 0, message: 0, delivery: 0 }
    for (const k of Object.keys(errors)) c[sectionOfError(k)]++
    if (blockingWebhook) c.webhook++
    return c
  }, [errors, blockingWebhook])
  const totalProblems = SECTION_ORDER.reduce((n, s) => n + problemCount[s], 0)
  const edited = useMemo(() => {
    const p = patch as Record<string, unknown>
    return {
      webhook: 'webhook' in p || (form.mode === 'custom' && urlTyped !== ''),
      appearance: 'identity' in p || 'embed' in p || 'mention' in p,
      triggers: 'events' in p || 'filters' in p,
      message: 'message' in p,
      delivery: 'delivery' in p,
    } as Record<SectionId, boolean>
  }, [patch, form.mode, urlTyped])

  const focusFirstProblem = () => {
    const key = Object.keys(errors)[0]
    let id = ''
    let section: SectionId = 'message'
    if (key) {
      section = sectionOfError(key)
      const m = /^field\.(\d+)\.(name|value)$/.exec(key)
      if (m) id = `notify-field-${form.fields[Number(m[1])]?.key}-${m[2]}`
      else id = ({ name: 'notify-name', avatar: 'notify-avatar', color: 'notify-color-hex', mentionId: 'notify-mention-id', mentionText: 'notify-mention-text', minEvents: 'notify-min-events', only: 'notify-only', ignore: 'notify-ignore', groupWait: 'notify-group-wait', groupThreshold: 'notify-group-threshold', maxRetry: 'notify-max-retry', timeout: 'notify-timeout', title: 'notify-title', description: 'notify-description', footer: 'notify-footer', link: 'notify-link' } as Record<string, string>)[key] ?? ''
    } else if (blockingWebhook) { section = 'webhook'; id = 'notify-webhook-url' }
    setOpenState((o) => ({ ...o, [section]: true }))
    setTimeout(() => { const el = id ? document.getElementById(id) : null; (el ?? document.getElementById(`notify-${section}`))?.scrollIntoView({ behavior: 'smooth', block: 'center' }); el?.focus({ preventScroll: true }) }, 60)
  }

  // ---- the live preview ----
  const [dark, setDarkState] = useState(loadDark)
  const setDark = (d: boolean) => { setDarkState(d); try { localStorage.setItem(DARK_KEY, d ? '1' : '0') } catch { /* private window */ } }
  const samples = useMemo(() => orderSamples(server.samples), [server.samples])
  const sampleNow = samples.includes(sample) ? sample : (samples[0] ?? 'probe')
  const [serverRefused, setServerRefused] = useState(false)
  const askServer = (isAdmin || VIEWER_SERVER_PREVIEW) && !serverRefused
  const [pv, setPv] = useState<{ payload: DiscordWebhookPayload | null; problem: string | null; loading: boolean }>({ payload: null, problem: null, loading: askServer })
  const seq = useRef(0)
  const errorCount = Object.keys(errors).length
  const clientProblem = errorCount > 0 ? `${errorCount === 1 ? 'One field needs' : `${errorCount} fields need`} attention: ${Object.values(errors)[0]}` : null
  const previewKey = useSettled(clientProblem ? '' : JSON.stringify(patch), 400)
  useEffect(() => {
    if (!askServer || clientProblem) return
    const my = ++seq.current
    setPv((p) => ({ ...p, loading: true }))
    crowdsecPreviewNotify({ settings: JSON.parse(previewKey || '{}') as CrowdSecNotifyBody['settings'], sample: sampleNow }, member)
      .then((r) => { if (my === seq.current) setPv({ payload: r.valid ? r.payload : null, problem: r.valid ? null : (r.error ?? 'The server could not draw this message'), loading: false }) })
      .catch((e) => {
        if (my !== seq.current) return
        if (!isAdmin && e instanceof ApiError && e.status === 403) { setServerRefused(true); return }
        setPv((p) => ({ ...p, problem: `The preview could not be drawn: ${errMsg(e)}`, loading: false }))
      })
  }, [previewKey, sampleNow, askServer, member]) // eslint-disable-line react-hooks/exhaustive-deps
  const approx = useMemo(() => (askServer ? null : approximatePayload(settingsNow, ph)), [askServer, settingsNow, ph])
  const previewPayload = approx ?? pv.payload
  const previewProblem = approx ? clientProblem : (clientProblem ?? pv.problem)

  // ---- test, apply, reset ----
  const [testing, setTesting] = useState(false)
  const [includeMention, setIncludeMention] = useState(false)
  const [test, setTest] = useState<{ t: TestOutcomeData; webhook?: string } | null>(null)
  const [sheet, setSheet] = useState(false)
  const [review, setReview] = useState(false)
  // a change being applied is kept outside this component: CrowdSec restarts, the page shows "starting" instead of this tab, and the tab that comes back finds it here
  const run = useSyncExternalStore(subscribeRun, () => getRun(member))
  const applying = run.busy
  const outcome = run.outcome
  const seenSeq = useRef(run.seq)
  useEffect(() => {
    if (!run.res || run.seq <= seenSeq.current) return
    seenSeq.current = run.seq
    const res = run.res
    setServer(res)
    if (!run.keepDraft) { setBase(res.settings); setForm(toForm(res.settings)); setUrl(''); setRestored(false) }
    refresh()
  }, [run.seq]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (dirty && outcome?.kind === 'ok') setRun(member, { outcome: null }) }, [dirty]) // eslint-disable-line react-hooks/exhaustive-deps
  // the button that was pressed disappears when the change is done: keep the keyboard where the answer is
  const outcomeBox = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!outcome) return
    const a = document.activeElement
    if (!a || a === document.body) outcomeBox.current?.focus({ preventScroll: true })
  }, [outcome?.at]) // eslint-disable-line react-hooks/exhaustive-deps

  const serverTest: TestOutcomeData | null = server.status.last_test ? { at: server.status.last_test.at, ok: server.status.last_test.ok, http: server.status.last_test.http, message: server.status.last_test.message, sample: server.status.last_test.sample } : null
  const lastTest = test && (!serverTest || test.t.at >= serverTest.at) ? test.t : serverTest

  /** put a change through CrowdSec. Nothing after the await touches this component's state: it may be gone by then (see above). */
  const execute = async (o: { what: string; call: () => Promise<CrowdSecNotifyResponse>; clearDraft: boolean; ok: (res: CrowdSecNotifyResponse) => Outcome; fail: (e: unknown) => Outcome }) => {
    if (getRun(member).busy) return
    setRun(member, { busy: { what: o.what, at: Date.now() }, outcome: null })
    try {
      const res = await o.call()
      if (o.clearDraft) draftMemory.clear(member)
      const done = o.ok(res)
      setRun(member, { busy: null, outcome: done, res, seq: getRun(member).seq + 1, keepDraft: !o.clearDraft, doneAt: Date.now() })
      addToast({ type: 'success', message: done.detail ?? done.title, duration: 6000 })
    } catch (e) {
      const bad = o.fail(e)
      setRun(member, { busy: null, outcome: bad, res: null, doneAt: Date.now() })
      addToast({ type: 'error', message: `${bad.title}${bad.detail ? `. ${splitLog(bad.detail).text}` : ''}`, duration: 9000 })
    }
    refreshStatus()
  }
  const failure = (e: unknown, title: string): Outcome => {
    const d = errData(e)
    // the API's own words for a file it will not replace without being told to are about a request field; here the person is asked instead
    const detail = d.reason === 'custom_profile' ? 'profiles.yaml has profiles DCS did not write. Saving replaces the whole file (a copy is kept). Press Save and apply and confirm to do that.' : redact(errMsg(e))
    return { kind: 'error', title, detail, rolledBack: d.rolled_back === true, stage: typeof d.stage === 'string' ? d.stage : undefined, status: e instanceof ApiError ? e.status : 0, at: Date.now() }
  }

  const testBlocked: string | null = applying ? 'Wait until the change is applied.'
    : errorCount > 0 ? 'Fix the highlighted fields first.'
    : !modeReady(form.mode) ? (form.mode === 'custom' ? 'Add the address of the custom webhook first.' : form.mode === 'global' ? 'There is no global webhook to post to.' : 'There is no webhook to keep.')
    : urlProblem ? urlProblem : null

  const sendTest = async () => {
    if (testBlocked || testing) return
    setTesting(true)
    try {
      const r = await crowdsecTestNotify({ settings: patch, sample: sampleNow, include_mention: includeMention, ...(urlSend ? { webhook_url: urlTyped } : {}) }, member)
      setTest({ t: { at: r.at, ok: r.delivered, http: r.http, message: r.message, sample: r.sample }, webhook: r.webhook })
      setIncludeMention(false)   // a test pings nobody unless it is asked to, every time
      addToast(r.delivered ? { type: 'success', message: 'The test message was delivered to Discord' } : { type: 'error', message: r.message, duration: 8000 })
      refresh()
    } catch (e) {
      setTest({ t: { at: Math.floor(Date.now() / 1000), ok: false, http: 0, message: errMsg(e, 'The test message could not be sent'), sample: sampleNow } })
      addToast({ type: 'error', message: errMsg(e, 'The test message could not be sent'), duration: 8000 })
    } finally { setTesting(false) }
  }

  const save = async () => {
    if (!isAdmin || applying || !dirty) return
    if (totalProblems > 0) { addToast({ type: 'warning', message: 'Fix the highlighted fields first' }); focusFirstProblem(); return }
    if (needsTakeOver && !(await confirmTakeOver('CrowdSec restarts for a few seconds while the change is applied.'))) return
    const body: CrowdSecNotifyBody = { settings: patch, ...(urlSend ? { webhook_url: urlTyped } : {}), ...(needsTakeOver ? { take_over: true } : {}) }
    await execute({
      what: 'Applying your changes', clearDraft: true, call: () => crowdsecSaveNotify(body, member),
      ok: (res) => ({ kind: 'ok', title: res.applied?.changed === false ? 'Nothing needed to change' : 'Applied', detail: res.applied?.message ?? 'Saved', at: Date.now() }),
      fail: (e) => failure(e, errData(e).rolled_back === true ? 'Not applied. CrowdSec was put back as it was' : 'Not applied'),
    })
  }

  // a file an older DCS wrote (one block per alert): saving the settings as they are writes the grouped layout, the webhook stays
  const applyLayout = async () => {
    if (!isAdmin || applying) return
    if (needsTakeOver && !(await confirmTakeOver('CrowdSec restarts for a few seconds while the new layout is applied.'))) return
    await execute({
      what: 'Writing the new message layout', clearDraft: false, call: () => crowdsecSaveNotify({ settings: {}, ...(needsTakeOver ? { take_over: true } : {}) }, member),
      ok: (res) => ({ kind: 'ok', title: 'The new layout is in use', detail: res.applied?.message, at: Date.now() }),
      fail: (e) => failure(e, 'The new layout was not applied'),
    })
  }

  const discard = () => { setBase(server.settings); setForm(toForm(server.settings)); setUrl(''); setRestored(false); setRun(member, { outcome: null }); draftMemory.clear(member) }

  const resetShipped = async () => {
    if (!isAdmin || applying) return
    if (profileTakeover) {
      // the API only resets a profile file DCS wrote; here the shipped message goes into the editor and the save asks before replacing anything
      if (!(await confirm({ title: 'Load the shipped message?', message: 'profiles.yaml has profiles DCS did not write, so the reset cannot be applied straight away. This puts the shipped message into the editor. Nothing changes until you press Save and apply, which asks before replacing the file. The webhook and the on/off switch stay as they are.', confirmLabel: 'Load it' }))) return
      setForm((f) => ({ ...toForm(def), enabled: f.enabled, mode: f.mode }))
      addToast({ type: 'info', message: 'The shipped message is in the editor. Press Save and apply to use it.' })
      return
    }
    if (!(await confirm({ title: 'Reset to the shipped message?', message: `The message, the appearance, the mention, the filters and the delivery settings go back to what CrowdSec ships with. The webhook and the on/off switch stay as they are.${dirty ? '\nThe changes you have not saved are dropped.' : ''}\nCrowdSec restarts for a few seconds.`, confirmLabel: 'Reset and apply' }))) return
    await execute({
      what: 'Putting the shipped message back', clearDraft: true, call: () => crowdsecResetNotify(member),
      ok: (res) => ({ kind: 'ok', title: 'Back to the shipped message', detail: res.applied?.message, at: Date.now() }),
      fail: (e) => failure(e, 'Not reset'),
    })
  }

  const REMOVING = 'Removing the custom webhook'
  const removeCustom = async () => {
    if (!isAdmin || applying) return
    if (server.settings.enabled && server.settings.webhook.mode === 'custom') return
    const takes = (st.file === 'other' && server.settings.enabled) || profileTakeover
    if (!(await confirm({ title: 'Remove the custom webhook?', message: `The stored address is deleted from this server. Alerts keep going to the source you have chosen, and you can add another address any time.${takes ? '\nThis also rewrites CrowdSec’s files from the saved settings, which replaces the ones DCS did not write (a copy is kept).' : ''}`, confirmLabel: 'Remove it', danger: true }))) return
    await execute({
      what: REMOVING, clearDraft: false, call: () => crowdsecSaveNotify({ clear_custom_webhook: true, ...(takes ? { take_over: true } : {}) }, member),
      ok: () => ({ kind: 'ok', title: 'The custom webhook was removed', at: Date.now() }),
      fail: (e) => failure(e, 'The custom webhook was not removed'),
    })
  }

  // ---- pieces of the page ----
  const modeName = MODE_TITLE[form.mode]
  const maskedNow = form.mode === 'custom' && urlTyped !== '' && !urlProblem ? 'a new address, not saved yet' : (src[form.mode].configured ? (isAdmin ? src[form.mode].masked : 'set') : 'no address yet')
  const colorWords = form.colorMode === 'auto' ? 'automatic colour' : form.color
  const trig = [form.bans && 'new bans', form.simulated && 'simulated', form.detectOnly && 'detection only'].filter(Boolean).join(', ')
  const summaries: Record<SectionId, string> = {
    webhook: `${modeName} · ${maskedNow ?? ''}`,
    appearance: `${form.name || 'no name'} · ${colorWords} · mentions ${MENTION_WORDS[form.mention]}`,
    triggers: `${trig || 'no events'}${settingsNow.filters.min_events > 1 ? ` · at least ${settingsNow.filters.min_events} events` : ''}${form.only.length ? ` · only ${form.only.length}` : ''}${form.ignore.length ? ` · ignoring ${form.ignore.length}` : ''}`,
    message: `${form.fields.length} field${form.fields.length === 1 ? '' : 's'} · ${form.title || 'no title'}`,
    delivery: `${form.groupBy ? `${GROUP_WORD[form.groupBy].toLowerCase()} · ` : ''}wait ${form.groupWait || '?'} s · up to ${form.groupThreshold || '?'} alerts per message · ${form.maxRetry || '?'} retries · ${form.timeout || '?'} s timeout`,
  }
  const suggestions = useScenarios(member)
  const changes = describeChanges(patch, form.mode === 'custom' && urlTyped !== '' ? ['Webhook address'] : [])
  const rows = useMemo(() => (dirty && review ? changeRows(base, settingsNow, urlSend) : []), [dirty, review, base, settingsNow, urlSend])
  const previewPanel = (bare = false) => (
    <PreviewPanel bare={bare} payload={previewPayload} loading={askServer && pv.loading && !clientProblem} problem={previewProblem} approximate={!askServer} editable={isAdmin} samples={samples} sample={sampleNow} onSample={setSample}
      dark={dark} onDark={setDark} isAdmin={isAdmin} testBlocked={testBlocked} testing={testing} onTest={sendTest} includeMention={includeMention} onIncludeMention={setIncludeMention}
      hasMention={mentionTag(settingsNow.mention) !== ''} test={lastTest ? { ...lastTest } : null} testWebhook={test?.webhook} unsaved={dirty}
      lastApply={server.status.last_apply} deliveryErrors={server.status.delivery_errors} />
  )
  const openNotifications = () => setCurrentPage('notifications')
  const digestCard = server.digest
    ? <DigestCard digest={server.digest} member={member} isAdmin={isAdmin} alertsOn={server.settings.enabled} webhookReady={server.webhook.configured} onChanged={refresh} />
    : null
  const statusCard = (
    <StatusCard data={server} isAdmin={isAdmin} enabled={form.enabled} onToggle={(v) => patchForm({ enabled: v })} busy={!!applying} refreshFailed={refreshFailed} onRefresh={refresh} onOpenNotifications={openNotifications} lastTest={lastTest} />
  )

  // =========================================================================
  // A viewer: the same settings as words, no buttons that change anything
  // =========================================================================
  if (!isAdmin) {
    const s = server.settings
    return (
      <div className="space-y-4">
        {statusCard}
        {digestCard}
        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_28rem] gap-4 items-start">
          <div className="space-y-3 min-w-0">
            <Notice tone="info" icon={Eye}>You can read these settings. Only an administrator can change them or send a test message.</Notice>
            <Section id="notify-webhook" icon={Webhook} title="Webhook" summary={`${MODE_TITLE[s.webhook.mode]} · ${server.webhook.configured ? 'configured' : 'not configured'}`} open={open.webhook} onToggle={() => toggle('webhook')}>
              <dl className="divide-y divide-white/5">
                <KV k="Source"><Chip tone="mute">{MODE_TITLE[s.webhook.mode]}</Chip></KV>
                <KV k="Webhook"><Chip tone={server.webhook.configured ? 'good' : 'warn'}>{server.webhook.configured ? 'Configured' : 'Not configured'}</Chip></KV>
              </dl>
            </Section>
            <Section id="notify-appearance" icon={Palette} title="Appearance" summary={`${s.identity.name} · ${s.embed.color_mode === 'auto' ? 'automatic colour' : s.embed.color} · mentions ${MENTION_WORDS[s.mention.mode]}`} open={open.appearance} onToggle={() => toggle('appearance')}>
              <dl className="divide-y divide-white/5">
                <KV k="Sender name">{s.identity.name}</KV>
                <KV k="Avatar">{s.identity.avatar_url ? <span className="font-mono text-xs break-all">{s.identity.avatar_url}</span> : 'The webhook’s own picture'}</KV>
                <KV k="Colour">{s.embed.color_mode === 'auto' ? 'Automatic, by the kind of attack' : <span className="inline-flex items-center gap-2"><span aria-hidden="true" className="h-3.5 w-3.5 rounded-full border border-white/20" style={{ background: s.embed.color }} /><span className="font-mono text-xs">{s.embed.color}</span></span>}</KV>
                <KV k="Mention">{MENTION_WORDS[s.mention.mode].replace(/^./, (c) => c.toUpperCase())}{s.mention.id ? <span className="font-mono text-xs text-slate-500"> · {s.mention.id}</span> : null}{s.mention.text ? <span className="text-slate-500"> · “{s.mention.text}”</span> : null}</KV>
              </dl>
            </Section>
            <Section id="notify-triggers" icon={Filter} title="What triggers a message" summary={summaries.triggers} open={open.triggers} onToggle={() => toggle('triggers')}>
              <dl className="divide-y divide-white/5">
                <KV k="Events"><span className="flex flex-wrap gap-1.5"><Chip tone={s.events.bans ? 'good' : 'mute'}>new bans {s.events.bans ? 'on' : 'off'}</Chip><Chip tone={s.events.simulated ? 'good' : 'mute'}>simulated bans {s.events.simulated ? 'on' : 'off'}</Chip><Chip tone={s.events.detect_only ? 'good' : 'mute'}>detection only {s.events.detect_only ? 'on' : 'off'}</Chip></span></KV>
                <KV k="Minimum events">{s.filters.min_events > 1 ? `${s.filters.min_events} log lines` : 'Every alert'}</KV>
                <KV k="Only these scenarios">{s.filters.only.length ? <span className="flex flex-wrap gap-1.5">{s.filters.only.map((x) => <Chip key={x}><span className="font-mono">{x}</span></Chip>)}</span> : 'Every scenario'}</KV>
                <KV k="Ignored scenarios">{s.filters.ignore.length ? <span className="flex flex-wrap gap-1.5">{s.filters.ignore.map((x) => <Chip key={x}><span className="font-mono">{x}</span></Chip>)}</span> : 'None'}</KV>
              </dl>
            </Section>
            <Section id="notify-message" icon={Braces} title="Message" summary={summaries.message} open={open.message} onToggle={() => toggle('message')}>
              <dl className="divide-y divide-white/5">
                <KV k="Title"><Template>{s.message.title}</Template></KV>
                <KV k="Description"><Template>{s.message.description}</Template></KV>
                <KV k="Footer"><Template>{s.message.footer}</Template></KV>
                <KV k="Title link"><Template>{s.message.link}</Template></KV>
                <KV k="Time">{s.message.timestamp ? 'Shown next to the footer' : 'Not shown'}</KV>
                <KV k="Fields">{s.message.fields.length === 0 ? 'None' : (
                  <ul className="space-y-2">{s.message.fields.map((f, i) => (
                    <li key={i} className="min-w-0"><p className="text-xs text-slate-300 flex items-center gap-1.5 flex-wrap">{f.name} {f.inline && <Chip>side by side</Chip>}</p><Template>{f.value}</Template></li>
                  ))}</ul>
                )}</KV>
              </dl>
            </Section>
            <Section id="notify-delivery" icon={Clock} title="Delivery" summary={summaries.delivery} open={open.delivery} onToggle={() => toggle('delivery')}>
              <dl className="divide-y divide-white/5">
                {s.delivery.group_by && <KV k="Grouping">{GROUP_WORD[s.delivery.group_by]}</KV>}
                <KV k="Grouping wait">{s.delivery.group_wait} seconds</KV>
                <KV k="Group size">{s.delivery.group_threshold} alerts at most in one message</KV>
                <KV k="Retries">{s.delivery.max_retry}</KV>
                <KV k="Timeout">{s.delivery.timeout} seconds</KV>
              </dl>
            </Section>
          </div>
          {wide
            ? <aside className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin" aria-label="Preview">{previewPanel()}</aside>
            : <button type="button" onClick={() => setSheet(true)} className={`${BTN_QUIET} w-full`}><Eye size={13} /> Preview the message</button>}
        </div>
        {sheet && !wide && <CsSheet title="Preview" subtitle="How the message looks in Discord" icon={<Eye size={18} />} tone="info" wide onClose={() => setSheet(false)}>{previewPanel(true)}</CsSheet>}
      </div>
    )
  }

  // =========================================================================
  // An administrator
  // =========================================================================
  const busy = !!applying
  const canSave = dirty && !busy && totalProblems === 0
  const showBar = dirty || busy || !!outcome
  const setMention = (m: MentionMode) => patchForm({ mention: m })
  const customStored = src.custom.configured
  const customInUse = server.settings.enabled && server.settings.webhook.mode === 'custom'

  return (
    <PhProvider value={reg}>
      <div className="space-y-4">
        {statusCard}
        {digestCard}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_28rem] 2xl:grid-cols-[minmax(0,1fr)_32rem] gap-4 items-start">
          <div className="space-y-3 min-w-0">
            {st.layout_outdated && !dirty && (
              <Notice tone="info" icon={Info} title="A new message layout is ready"
                action={<button type="button" className="text-cyan-400 hover:text-cyan-300 text-xs inline-flex items-center gap-1" onClick={applyLayout} disabled={busy}><Save size={12} /> Apply it</button>}>
                CrowdSec still uses the file of an older DCS: one block per alert. Applying writes the new layout (one block per address, the attempts counted per attack) with the settings you have, and keeps the webhook. CrowdSec restarts for a few seconds.
              </Notice>
            )}
            {restored && <Notice tone="info" icon={Info} title="You have unsaved changes from earlier" action={<button type="button" className="text-cyan-400 hover:text-cyan-300 text-xs inline-flex items-center gap-1" onClick={discard}><Undo2 size={12} /> Discard them</button>}>They were kept while you looked at another tab. Nothing has been sent to CrowdSec yet.</Notice>}
            {changedElsewhere && <Notice tone="warn" icon={AlertTriangle} title="The saved settings changed since you started editing" action={<button type="button" className="text-cyan-400 hover:text-cyan-300 text-xs inline-flex items-center gap-1" onClick={discard}><Undo2 size={12} /> Discard my changes and load them</button>}>Someone else saved, or CrowdSec was changed by hand. When you save, only the things you edited are applied on top.</Notice>}
            {needsTakeOver && (form.enabled || dirty) && (
              <Notice tone="warn" icon={AlertTriangle} title={profileTakeover && !fileTakeover ? 'profiles.yaml has profiles DCS did not write' : 'CrowdSec’s notification file was not written by this page'}>
                {fileTakeover && <>It is CrowdSec’s own sample, comes from a stack template or was edited by hand. When you save, DCS replaces it with the file built from this page and keeps a copy of the old one. </>}
                {profileTakeover && <>profiles.yaml has profiles DCS did not write; saving replaces the whole file with the one DCS manages (a copy is kept). </>}
                You are asked to confirm before anything is replaced.
              </Notice>
            )}

            <nav aria-label="Sections" className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-slate-500 mr-1 shrink-0">Jump to</span>
              {SECTION_ORDER.map((id) => (
                <button key={id} type="button" onClick={() => reveal(id)} className="h-8 px-3 rounded-lg text-xs text-slate-300 bg-white/5 border border-white/10 hover:bg-white/10 shrink-0 inline-flex items-center gap-1.5 transition-colors">
                  {({ webhook: 'Webhook', appearance: 'Appearance', triggers: 'Triggers', message: 'Message', delivery: 'Delivery' } as Record<SectionId, string>)[id]}
                  {problemCount[id] > 0 && <Dot tone="bad" />}
                </button>
              ))}
            </nav>

            <fieldset disabled={busy} aria-busy={busy} className="min-w-0 border-0 p-0 m-0 space-y-3">
              {/* ---------------- webhook ---------------- */}
              <Section id="notify-webhook" icon={Webhook} title="Webhook" summary={summaries.webhook} open={open.webhook} onToggle={() => toggle('webhook')} problems={problemCount.webhook} edited={edited.webhook}>
                <p className="text-xs text-slate-500 leading-relaxed">Where the messages are posted. A webhook address works like a password, so it is stored as a secret on the server and never shown again.</p>
                <ChoiceCards<WebhookMode> value={form.mode} onChange={(m) => patchForm({ mode: m })} ariaLabel="Where the webhook comes from" disabled={busy}
                  options={([
                    { value: 'global', title: 'Global', text: 'Use the webhook DCS already uses for its own alerts.' },
                    { value: 'custom', title: 'Custom', text: 'Post to a separate channel, only for CrowdSec.' },
                    { value: 'keep', title: 'Keep current', text: 'Keep whatever webhook is already in CrowdSec’s notification file.' },
                  ] as const).map((o) => ({
                    ...o,
                    foot: o.value === 'custom' && form.mode === 'custom' && urlTyped !== '' && !urlProblem
                      ? <Chip tone="info">new address, not saved yet</Chip>
                      : src[o.value].configured
                        ? <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500 font-mono min-w-0 max-w-full"><Dot tone="good" /><span className="truncate">{src[o.value].masked}</span></span>
                        : <Chip tone={form.mode === o.value && form.enabled ? 'warn' : 'mute'}>not set</Chip>,
                  }))} />
                {form.mode === 'global' && (
                  src.global.configured
                    ? <p className="text-xs text-slate-500">DCS posts its own alerts to <span className="font-mono text-slate-300 break-all">{src.global.masked}</span>. CrowdSec’s alerts go there too. Change it under Server Config → Notifications.</p>
                    : <Notice tone="warn" icon={AlertTriangle} title="No global webhook is set" action={<button type="button" onClick={() => setCurrentPage('config')} className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1">Open Server Config <ChevronRight size={12} /></button>}>DCS has no webhook of its own to share. Set <span className="font-mono">DISCORD_WEBHOOK_URL</span> under Server Config → Notifications, or choose Custom and add an address for CrowdSec alone.</Notice>
                )}
                {form.mode === 'keep' && (
                  src.keep.configured
                    ? <p className="text-xs text-slate-500">CrowdSec’s notification file already posts to <span className="font-mono text-slate-300 break-all">{src.keep.masked}</span>. That address stays as it is.</p>
                    : <Notice tone="warn" icon={AlertTriangle} title="There is no webhook in CrowdSec’s file to keep">Choose Global, or Custom with a new address.</Notice>
                )}
                {form.mode === 'custom' && (
                  <div className="space-y-3">
                    {customStored && (
                      <div className="flex items-center gap-3 flex-wrap rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-slate-200">A custom webhook is stored</p>
                          <p className="text-xs text-slate-500 font-mono break-all">{src.custom.masked}</p>
                        </div>
                        <button type="button" className={BTN_DANGER} disabled={busy || customInUse} onClick={removeCustom} title={customInUse ? 'It is the webhook in use right now. Choose another source and save first.' : 'Delete the stored address'}>
                          {applying?.what === REMOVING ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Remove the custom webhook
                        </button>
                        {customInUse && <p className="w-full text-[11px] text-slate-500">It is the webhook in use right now. Choose another source and save, then you can remove it.</p>}
                      </div>
                    )}
                    <FieldShell id="notify-webhook-url" label={customStored ? 'Replace the address' : 'Webhook address'} error={urlProblem ?? undefined}
                      hint={<>In Discord: channel settings → Integrations → Webhooks → New webhook → Copy webhook URL. It starts with <span className="font-mono">https://discord.com/api/webhooks/</span>. It is checked here and again by the server, stored as a secret and never shown.</>}>
                      <div className="flex gap-2">
                        <input id="notify-webhook-url" name="dcs-crowdsec-webhook" type={showUrl ? 'text' : 'password'} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://discord.com/api/webhooks/…" autoComplete="off" spellCheck={false} data-1p-ignore data-lpignore="true"
                          className={`${INPUT} font-mono text-[13px] ${urlProblem ? '!border-rose-500/40' : ''}`} aria-invalid={!!urlProblem} aria-describedby="notify-webhook-url-err notify-webhook-url-hint" />
                        <button type="button" onClick={() => setShowUrl((v) => !v)} className={`${BTN_QUIET} !w-10 !px-0`} aria-label={showUrl ? 'Hide the address' : 'Show the address'} title={showUrl ? 'Hide the address' : 'Show what you typed'}>{showUrl ? <EyeOff size={14} /> : <Eye size={14} />}</button>
                      </div>
                    </FieldShell>
                    {urlTyped !== '' && !urlProblem && <p className="text-xs text-emerald-300 flex items-center gap-1.5"><KeyRound size={12} /> This address is stored as the custom webhook when you save.</p>}
                  </div>
                )}
                {form.enabled && webhookIssue && form.mode !== 'custom' && <p role="alert" className="text-[11px] text-rose-300">{webhookIssue}</p>}
                {form.enabled && webhookIssue && form.mode === 'custom' && urlTyped === '' && <p role="alert" className="text-[11px] text-rose-300">{webhookIssue}</p>}
              </Section>

              {/* ---------------- appearance ---------------- */}
              <Section id="notify-appearance" icon={Palette} title="Appearance" summary={summaries.appearance} open={open.appearance} onToggle={() => toggle('appearance')} problems={problemCount.appearance} edited={edited.appearance}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <FieldShell id="notify-name" label="Sender name" counter={<Counter n={cpLen(form.name)} max={LIM.name} />} error={errors.name} hint="The name Discord shows above each message." def={def.identity.name} onDefault={form.name !== def.identity.name ? () => patchForm({ name: def.identity.name }) : undefined}>
                    <input id="notify-name" className={`${INPUT} ${errors.name ? '!border-rose-500/40' : ''}`} value={form.name} onChange={(e) => patchForm({ name: e.target.value })} autoComplete="off" aria-invalid={!!errors.name} aria-describedby="notify-name-err notify-name-hint" />
                  </FieldShell>
                  <FieldShell id="notify-avatar" label="Avatar" counter={<Counter n={cpLen(form.avatar)} max={LIM.avatar} />} error={errors.avatar} hint="The sender’s picture, as an https:// address. Leave it empty to use the webhook’s own picture." def={def.identity.avatar_url} onDefault={form.avatar !== def.identity.avatar_url ? () => patchForm({ avatar: def.identity.avatar_url }) : undefined}>
                    <input id="notify-avatar" className={`${INPUT} font-mono text-[13px] ${errors.avatar ? '!border-rose-500/40' : ''}`} value={form.avatar} onChange={(e) => patchForm({ avatar: e.target.value })} placeholder="https://…/picture.png" autoComplete="off" spellCheck={false} aria-invalid={!!errors.avatar} aria-describedby="notify-avatar-err notify-avatar-hint" />
                  </FieldShell>
                </div>
                <div>
                  <p className={LABEL}>Colour of the bar</p>
                  <ColorField mode={form.colorMode} color={form.color} onMode={(m) => patchForm({ colorMode: m })} onColor={(c) => patchForm({ color: c })} error={errors.color} defColor={def.embed.color} disabled={busy} />
                  <p className={HINT}>Automatic colours each message by the kind of attack, so you can tell them apart at a glance. One colour uses the same bar for everything. Default: automatic.</p>
                </div>
                <div>
                  <p className={LABEL}>Mention</p>
                  <PillChoice<MentionMode> value={form.mention} onChange={setMention} ariaLabel="Who is mentioned" disabled={busy}
                    options={[{ value: 'none', label: 'Nobody' }, { value: 'role', label: 'A role' }, { value: 'user', label: 'A user' }, { value: 'here', label: '@here' }, { value: 'everyone', label: '@everyone' }]} />
                  <p className={HINT}>Who Discord notifies with each message. Default: nobody.</p>
                  {(form.mention === 'role' || form.mention === 'user') && (
                    <div className="mt-3 max-w-md">
                      <FieldShell id="notify-mention-id" label={form.mention === 'role' ? 'Role id' : 'User id'} error={errors.mentionId} hint="In Discord: Settings → Advanced → Developer mode, then right-click the role or the person and choose Copy ID.">
                        <input id="notify-mention-id" className={`${INPUT} font-mono ${errors.mentionId ? '!border-rose-500/40' : ''}`} inputMode="numeric" autoComplete="off" value={form.mentionId} onChange={(e) => patchForm({ mentionId: e.target.value.replace(/[^\d\s]/g, '') })} placeholder="123456789012345678" aria-invalid={!!errors.mentionId} aria-describedby="notify-mention-id-err notify-mention-id-hint" />
                      </FieldShell>
                    </div>
                  )}
                  {(form.mention === 'here' || form.mention === 'everyone') && (
                    <div className="mt-3"><Notice tone="warn" icon={AlertTriangle}>{form.mention === 'everyone' ? '@everyone notifies every member who can see the channel' : '@here notifies every member of the channel who is online'}, for every message. A role, and a minimum number of events under “What triggers a message”, keep it calmer.</Notice></div>
                  )}
                  <div className="mt-3">
                    <FieldShell id="notify-mention-text" label={form.mention === 'none' ? 'Text above the message (optional)' : 'Text next to the mention (optional)'} counter={<Counter n={cpLen(form.mentionText)} max={LIM.mentionText} />} error={errors.mentionText} hint="Plain words, for example “Someone is knocking:”. Placeholders do not work here." def="">
                      <textarea id="notify-mention-text" rows={2} className={`${TEXTAREA} resize-y ${errors.mentionText ? '!border-rose-500/40' : ''}`} value={form.mentionText} onChange={(e) => patchForm({ mentionText: e.target.value })} aria-invalid={!!errors.mentionText} aria-describedby="notify-mention-text-err notify-mention-text-hint" />
                    </FieldShell>
                  </div>
                </div>
              </Section>

              {/* ---------------- triggers ---------------- */}
              <Section id="notify-triggers" icon={Filter} title="What triggers a message" summary={summaries.triggers} open={open.triggers} onToggle={() => toggle('triggers')} problems={problemCount.triggers} edited={edited.triggers}>
                <div className="space-y-3">
                  <ToggleRow id="notify-ev-bans" label="New bans" checked={form.bans} onChange={(v) => patchForm({ bans: v })} disabled={busy} def={def.events.bans ? 'on' : 'off'}
                    help="A message whenever CrowdSec bans an address it caught by itself." />
                  <ToggleRow id="notify-ev-sim" label="Simulated bans" checked={form.simulated} onChange={(v) => patchForm({ simulated: v })} disabled={busy} def={def.events.simulated ? 'on' : 'off'}
                    help={<>Also for scenarios in simulation mode: they raise an alert but ban nobody. <button type="button" onClick={() => goTab('settings')} className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5">Simulation settings <ChevronRight size={11} /></button></>} />
                  <ToggleRow id="notify-ev-detect" label="Detection-only alerts" checked={form.detectOnly} onChange={(v) => patchForm({ detectOnly: v })} disabled={busy} def={def.events.detect_only ? 'on' : 'off'}
                    help="Also for alerts that end without any ban. This can be chatty." />
                  {!form.bans && !form.simulated && !form.detectOnly && <p className="text-[11px] text-amber-300">Every event is off, so no message will ever be sent.</p>}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1">
                  <NumberField id="notify-min-events" label="Minimum events" value={form.minEvents} onChange={(v) => patchForm({ minEvents: v })} min={NUM.minEvents.min} max={NUM.minEvents.max} unit="log lines" def={String(def.filters.min_events)} error={errors.minEvents} disabled={busy}
                    hint="Only alerts built from at least this many log lines. 0 or 1 sends every alert." />
                </div>
                <TokenInput id="notify-only" label="Only these scenarios" values={form.only} onChange={(v) => patchForm({ only: v })} suggestions={suggestions} error={errors.only} disabled={busy}
                  hint={<>Leave it empty to hear about every scenario. A name such as <span className="font-mono">crowdsecurity/ssh-bf</span>, or a prefix ending in * such as <span className="font-mono">crowdsecurity/ssh*</span>. Default: empty.</>} />
                <TokenInput id="notify-ignore" label="Never for these scenarios" values={form.ignore} onChange={(v) => patchForm({ ignore: v })} suggestions={suggestions} error={errors.ignore} disabled={busy}
                  hint="Scenarios that stay quiet even when they ban an address. Bans still happen. Default: empty." />
              </Section>

              {/* ---------------- message ---------------- */}
              <Section id="notify-message" icon={Braces} title="Message" summary={summaries.message} open={open.message} onToggle={() => toggle('message')} problems={problemCount.message} edited={edited.message}>
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <p className="text-xs text-slate-500 leading-relaxed flex-1 min-w-[14rem]">Write the message with placeholders such as <span className="font-mono text-slate-300">{'{ip}'}</span> or <span className="font-mono text-slate-300">{'{country_tag}'}</span>. Type <span className="font-mono text-slate-300">{'{'}</span> in a box to get suggestions. In the description and in field values Discord draws **bold**, `code` and [text](link); the footer is plain text.</p>
                  <div className="flex items-center gap-2 flex-wrap">
                    <button type="button" className={BTN_QUIET} onClick={resetShipped} disabled={busy} title="Put the message, the look, the filters and the delivery back to what CrowdSec ships with. The webhook and the switch stay."><RotateCcw size={13} /> Shipped message</button>
                    <PlaceholderPicker items={ph} label="All placeholders" target={() => reg.last()?.label ?? 'description'} onPick={(n) => (reg.last() ?? { insert: () => {} }).insert(`{${n}}`)} />
                  </div>
                </div>
                {errors.message && <p role="alert" className="text-[11px] text-rose-300">{errors.message}</p>}
                <PlaceholderInput id="notify-title" label="Title" value={form.title} onChange={(v) => patchForm({ title: v })} max={limits.title} placeholders={ph} error={errors.title} disabled={busy}
                  hint="The bold line at the top." def={def.message.title} onDefault={form.title !== def.message.title ? () => patchForm({ title: def.message.title }) : undefined} />
                <PlaceholderInput id="notify-description" label="Description" value={form.description} onChange={(v) => patchForm({ description: v })} max={limits.description} placeholders={ph} error={errors.description} disabled={busy} multiline rows={4}
                  hint="The text under the title. Line breaks are kept." def={def.message.description} onDefault={form.description !== def.message.description ? () => patchForm({ description: def.message.description }) : undefined} />
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <PlaceholderInput id="notify-footer" label="Footer" value={form.footer} onChange={(v) => patchForm({ footer: v })} max={limits.footer} placeholders={ph} error={errors.footer} disabled={busy}
                    hint="Small text at the bottom. Leave it empty for none." def={def.message.footer} onDefault={form.footer !== def.message.footer ? () => patchForm({ footer: def.message.footer }) : undefined} />
                  <PlaceholderInput id="notify-link" label="Title link" value={form.link} onChange={(v) => patchForm({ link: v })} max={LIM.link} placeholders={ph} error={errors.link} disabled={busy}
                    hint="Makes the title a link. Leave it empty for no link." def={def.message.link} onDefault={form.link !== def.message.link ? () => patchForm({ link: def.message.link }) : undefined} />
                </div>
                <ToggleRow id="notify-timestamp" label="Show the time" checked={form.timestamp} onChange={(v) => patchForm({ timestamp: v })} disabled={busy} def={def.message.timestamp ? 'on' : 'off'}
                  help="Adds the time the alert was raised next to the footer, in the reader’s time zone." />
                <div>
                  <p className={LABEL}>Fields</p>
                  <FieldsEditor fields={form.fields} onChange={(f) => patchForm({ fields: f })} errors={errors} max={limits.fields} placeholders={ph} disabled={busy} defFields={def.message.fields.length} />
                </div>
              </Section>

              {/* ---------------- delivery ---------------- */}
              <Section id="notify-delivery" icon={Clock} title="Delivery" summary={summaries.delivery} open={open.delivery} onToggle={() => toggle('delivery')} problems={problemCount.delivery} edited={edited.delivery}>
                <p className="text-xs text-slate-500 leading-relaxed">How CrowdSec hands the messages to Discord. The defaults suit most servers.</p>
                {form.groupBy && (
                  <div>
                    <p className={LABEL}>Blocks in a message</p>
                    <ChoiceCards<GroupBy> value={form.groupBy} onChange={(g) => patchForm({ groupBy: g })} ariaLabel="One block per address or per alert" disabled={busy}
                      options={[
                        { value: 'address', title: 'One per address', text: 'A scanner that fires 50 alerts is one block that counts its attempts per attack. Default.' },
                        { value: 'alert', title: 'One per alert', text: 'Every alert its own block, as before. Chatty when one address trips many rules.' },
                      ]} />
                    <p className={HINT}>With one block per address the placeholders describe the address: {'{attempts}'} adds up its alerts, {'{scenarios}'} lists every attack it tried. Discord shows 10 blocks a message; more addresses are listed in the tenth.</p>
                  </div>
                )}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <NumberField id="notify-group-wait" label="Wait before sending" value={form.groupWait} onChange={(v) => patchForm({ groupWait: v })} min={NUM.groupWait.min} max={NUM.groupWait.max} unit="seconds" def={String(def.delivery.group_wait)} error={errors.groupWait} disabled={busy}
                    hint="Alerts that arrive within this time are sent together in one message." />
                  <NumberField id="notify-group-threshold" label="Alerts per message" value={form.groupThreshold} onChange={(v) => patchForm({ groupThreshold: v })} min={NUM.groupThreshold.min} max={limits.group_threshold_max} unit="alerts" def={String(def.delivery.group_threshold)} error={errors.groupThreshold} disabled={busy}
                    hint="Send at once when this many alerts have piled up, whatever the wait. They are grouped into blocks first, so a burst from one address stays one block." />
                  <NumberField id="notify-max-retry" label="Retries" value={form.maxRetry} onChange={(v) => patchForm({ maxRetry: v })} min={NUM.maxRetry.min} max={NUM.maxRetry.max} unit="times" def={String(def.delivery.max_retry)} error={errors.maxRetry} disabled={busy}
                    hint="How many times a failed delivery is tried again." />
                  <NumberField id="notify-timeout" label="Give up after" value={form.timeout} onChange={(v) => patchForm({ timeout: v })} min={NUM.timeout.min} max={NUM.timeout.max} unit="seconds" def={String(def.delivery.timeout)} error={errors.timeout} disabled={busy}
                    hint="How long to wait for Discord to answer one request." />
                </div>
              </Section>
            </fieldset>

            <div className={`${CARD} p-4 flex items-center gap-3 flex-wrap`}>
              <div className="min-w-0 flex-1 basis-64">
                <p className="text-sm text-slate-200">Back to the shipped message</p>
                <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">Puts the text, the fields, the appearance, the mention, the filters and the delivery back to what CrowdSec ships with. The webhook and the on/off switch stay.</p>
              </div>
              <button type="button" className={BTN_WARN} onClick={resetShipped} disabled={busy}><RotateCcw size={13} /> Reset to the shipped message</button>
            </div>
          </div>

          {wide && <aside className="sticky top-4 max-h-[calc(100vh-7rem)] overflow-y-auto scrollbar-thin" aria-label="Preview">{previewPanel()}</aside>}
        </div>

        {showBar && (
          <div className="sticky bottom-2 z-30 xl:w-[calc(100%-29rem)] 2xl:w-[calc(100%-33rem)]" role="region" aria-label="Unsaved changes and actions">
            <div className="rounded-xl bg-slate-900 border border-emerald-500/25 px-3 py-2.5 shadow-xl shadow-black/40 animate-scale-in space-y-2.5">
              {applying && <ApplyProgress startedAt={applying.at} what={applying.what} />}
              {!applying && outcome && (
                <div ref={outcomeBox} tabIndex={-1} className="outline-none">
                  <Notice role={outcome.kind === 'error' ? 'alert' : 'status'} tone={outcome.kind === 'ok' ? 'good' : outcome.kind === 'error' ? 'bad' : 'info'} icon={outcome.kind === 'ok' ? ShieldCheck : AlertTriangle} title={outcome.title}
                    action={<button type="button" onClick={() => setRun(member, { outcome: null })} className="text-xs underline underline-offset-2 opacity-80 hover:opacity-100">Dismiss</button>}>
                    {splitLog(outcome.detail).text}
                    {splitLog(outcome.detail).log && (
                      <details className="mt-1.5 text-[11px]">
                        <summary className="cursor-pointer opacity-80 hover:opacity-100 select-none">CrowdSec’s log around it</summary>
                        <pre className="mt-1 font-mono whitespace-pre-wrap break-words max-h-40 overflow-auto scrollbar-thin bg-white/[0.04] border border-white/5 rounded-md p-2">{splitLog(outcome.detail).log}</pre>
                      </details>
                    )}
                    {outcome.kind === 'error' && <span className="block mt-1 opacity-90">{
                      outcome.rolledBack ? 'CrowdSec was restarted with the previous files and is healthy again. Nothing of this change is live.'
                        : outcome.stage === 'validation' ? 'CrowdSec checked the new files and refused them, so nothing was changed.'
                        : outcome.stage === 'busy' ? 'Another change is still being applied. Try again in a minute.'
                        : outcome.stage === 'apply' ? 'The change may be only partly applied. Look at the CrowdSec log on the Logs tab.'
                        : (outcome.status ?? 0) >= 400 && (outcome.status ?? 0) < 500 ? 'The server refused the settings before it wrote anything, so nothing was changed.'
                        : (outcome.status ?? 0) >= 500 ? 'The server failed while applying. Reload this page to see what CrowdSec has now, and look at the log.'
                        : 'The request did not finish, so this page cannot tell whether CrowdSec took the change. Reload it to see what CrowdSec has now.'
                    }</span>}
                  </Notice>
                </div>
              )}
              {!applying && (
                <div className="flex items-center gap-2 flex-wrap">
                  {dirty
                    ? (
                      <div className="min-w-0 flex-1 basis-40">
                        <p className="text-sm text-slate-100 flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse shrink-0" /> You have unsaved changes</p>
                        <p className="text-[11px] text-slate-500 flex items-center gap-2 min-w-0"><span className="truncate" title={changes.join(', ')}>{changes.length ? changes.slice(0, 4).join(', ') + (changes.length > 4 ? ` and ${changes.length - 4} more` : '') : 'Edited'}</span><button type="button" onClick={() => setReview(true)} className="shrink-0 text-cyan-400 hover:text-cyan-300 py-2 -my-2 px-1">Review</button></p>
                        {totalProblems > 0 && <button type="button" onClick={focusFirstProblem} className="text-[11px] text-rose-300 hover:text-rose-300 underline underline-offset-2">{totalProblems} thing{totalProblems === 1 ? '' : 's'} to fix first</button>}
                      </div>
                    )
                    : <div className="min-w-0 flex-1 basis-40"><p className="text-xs text-slate-500">No unsaved changes.</p></div>}
                  {!wide && <button type="button" className={BTN_QUIET} onClick={() => setSheet(true)}><Eye size={13} /> Preview</button>}
                  {dirty && <button type="button" className={BTN_QUIET} onClick={discard}><Undo2 size={13} /> Discard changes</button>}
                  {dirty && (
                    <button type="button" className={`${BTN_PRIMARY} min-w-[9.5rem]`} onClick={save} disabled={!canSave} title={totalProblems > 0 ? 'Fix the highlighted fields first' : blockingWebhook ? 'Saves the settings; the webhook problem is shown in the Webhook section' : 'Save the settings and restart CrowdSec to load them'}>
                      <Save size={13} /> Save and apply
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {!wide && !showBar && (
          <div className="sticky bottom-2 z-30 flex justify-start pointer-events-none">
            <button type="button" onClick={() => setSheet(true)} className="pointer-events-auto h-10 px-4 rounded-full inline-flex items-center gap-2 text-xs font-medium text-slate-200 bg-slate-900 border border-white/10 shadow-xl shadow-black/40 hover:bg-slate-800"><Eye size={14} /> Preview and test</button>
          </div>
        )}

        {review && dirty && (
          <CsSheet title="What Save and apply will change" subtitle="Nothing is sent to CrowdSec until you press Save and apply." icon={<ListChecks size={18} />} tone="info" wide onClose={() => setReview(false)}
            footer={
              <div className="flex gap-2 justify-end flex-wrap">
                <button type="button" className={BTN_QUIET} onClick={() => setReview(false)}>Close</button>
                <button type="button" className={BTN_PRIMARY} disabled={!canSave} onClick={() => { setReview(false); void save() }}><Save size={13} /> Save and apply</button>
              </div>
            }>
            <ul className="divide-y divide-white/5" aria-label="Changes">
              {rows.map((r) => (
                <li key={r.label} className="py-2.5 first:pt-0 min-w-0">
                  <p className="text-xs font-medium text-slate-300">{r.label}</p>
                  <p className="text-xs text-slate-500 line-through break-words mt-0.5">{r.before}</p>
                  <p className="text-sm text-emerald-300 break-words">{r.after}</p>
                </li>
              ))}
              {rows.length === 0 && <li className="text-xs text-slate-500 py-2">Nothing differs from what is saved.</li>}
            </ul>
          </CsSheet>
        )}

        {sheet && !wide && (
          <CsSheet title="Preview" subtitle="How the message looks in Discord, and a test message" icon={<Eye size={18} />} tone="info" wide onClose={() => setSheet(false)}>
            {previewPanel(true)}
          </CsSheet>
        )}
      </div>
    </PhProvider>
  )
}

/** the installed scenarios, once, for the filter inputs */
function useScenarios(member: string | null): TokenSuggestion[] {
  const [list, setList] = useState<TokenSuggestion[]>([])
  useEffect(() => {
    let live = true
    crowdsecSimulation(member).then((r) => { if (live) setList(scenarioSuggestions(r.scenarios)) }).catch(() => { /* free typing still works */ })
    return () => { live = false }
  }, [member])
  return list
}
