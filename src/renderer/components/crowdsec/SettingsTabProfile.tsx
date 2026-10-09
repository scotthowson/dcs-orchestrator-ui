// =============================================================================
// Settings → how long CrowdSec bans. The ban profile (profiles.yaml) as a form:
// the length for an address and for a network, repeat-offender escalation, a
// length for particular attacks, and the length a manual ban starts with. It
// says in words what the result is, refuses what the API would refuse before it
// asks, and shows the apply honestly: CrowdSec is checked, the file is backed
// up and replaced, CrowdSec restarts, and if it does not come back healthy the
// old file is put back. Nothing here can tell which step it is on, so it does
// not pretend to.
// =============================================================================

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import {
  AlertTriangle, Archive, ArrowDown, ArrowUp, ChevronDown, ChevronRight, CircleAlert, CircleCheck, FileCode, Info, Loader2, Lock, LockOpen, Plus, RefreshCw, RotateCcw, Save, Timer, Trash2, Undo2,
} from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecSettings, crowdsecSaveSettings } from '../../api/endpoints'
import { ApiError } from '../../api/client'
import type { CrowdSecSettingsBody, CrowdSecSettingsResponse } from '../../../shared/types'
import { errData, errMsg, fmtAgo, fmtTime, parseDuration, useCs, useNow, Ago } from './kit'
import { CAP_PRESETS, CompactLength, LengthPicker, MANUAL_DEFAULT, ProfileSentence, ScenarioInput, Setting, TEN_YEARS_SECONDS, YEAR_SECONDS, changedFields, checkDraft, draftFrom, fmtBytes, ladderWords, lengthWords, matchCount, newRowId, profileOf, sameDraft, sameLength, sameProfile, scenarioLabel, shortName, type Draft, type Field, type OverrideRow, type Problems, type RowProblem, type ScenarioInfo } from './SettingsTabParts'
import { BTN_ICON_QUIET, BTN_TOOLBAR_ATTN, BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { LABEL } from '../../lib/fieldStyles'
import { type Tone } from '../../lib/tone'
import { Pill } from '../common/Pill'
import SectionHeader from '../common/SectionHeader'
import { SkeletonBlock } from '../common/PageState'
import { CopyButton } from '../common/CopyButton'
import { Toggle } from '../common/Toggle'
import Notice from '../common/Notice'
import { Panel } from '../dashboard/cardShared'
const POLL_MS = 30_000

type Result =
  | { kind: 'ok'; message: string; restarted: boolean; backup: string | null }
  | { kind: 'fail'; tone: Tone; title: string; body: string; detail: string; unknown?: boolean; custom?: boolean }

/** what a refused or failed save means, in words (the API's own message goes in the details) */
function explainFailure(e: unknown): Extract<Result, { kind: 'fail' }> {
  const d = errData(e)
  const status = e instanceof ApiError ? e.status : 0
  const msg = errMsg(e, 'The change was not applied')
  const reason = typeof d.reason === 'string' ? d.reason : ''
  const stage = typeof d.stage === 'string' ? d.stage : ''
  const output = typeof d.output === 'string' && d.output.trim() ? `\n${d.output.trim()}` : ''
  if (reason === 'custom_profile') return { kind: 'fail', tone: 'attention', custom: true, title: 'The ban profile was edited by hand in the meantime', body: 'profiles.yaml now holds profiles DCS did not write, so DCS changed nothing. Read the file, and take it over if you want DCS to manage it.', detail: '' }
  if (status === 0) return { kind: 'fail', tone: 'attention', unknown: true, title: 'The server did not answer', body: 'The request timed out or the connection dropped, so it is not known whether the change went through: CrowdSec may still be restarting. Check in a moment.', detail: msg }
  if (status === 403) return { kind: 'fail', tone: 'problem', title: 'Only an admin can change this', body: 'Nothing was changed.', detail: '' }
  if (stage === 'validation') return { kind: 'fail', tone: 'problem', title: 'CrowdSec would not accept the new profile', body: 'DCS had CrowdSec check the file before touching anything. Nothing was changed: the old profile is still in force.', detail: msg + output }
  if (stage === 'busy') return { kind: 'fail', tone: 'attention', title: 'Another change is still running', body: 'Only one configuration change can run at a time. Nothing was changed. Try again in a minute.', detail: '' }
  if (stage === 'apply' && d.rolled_back === true) return { kind: 'fail', tone: 'problem', title: 'CrowdSec did not come back with the new profile, so DCS put the old one back', body: 'CrowdSec was rolled back to the previous file and is healthy again. Your edits are still in the form: fix them and try again.', detail: msg + output }
  if (stage === 'apply') return { kind: 'fail', tone: 'problem', title: 'CrowdSec is not healthy and could not be rolled back', body: 'The new profile failed, and CrowdSec did not come back even with the previous file restored. Open the Logs tab to see why. The previous files are under Backups.', detail: msg + output }
  if (status === 400) return { kind: 'fail', tone: 'problem', title: 'The server refused these values', body: msg, detail: '' }
  return { kind: 'fail', tone: 'problem', title: 'The change was not applied', body: msg, detail: output.trim() }
}

// What an apply is doing lives outside the component. While CrowdSec restarts, the page swaps its tabs for a
// "CrowdSec is starting" view, which unmounts this card; the request goes on, and the card that comes back must
// still know about it (the clock, and in the end the banner). Kept per server.
interface Applied { applying: { since: number; restart: boolean } | null; result: Result | null; attempt: { draft: Draft; takeOver: boolean } | null; swapped: boolean; at: number }
const NOTHING: Applied = { applying: null, result: null, attempt: null, swapped: false, at: 0 }
const applyStore = new Map<string, Applied>()
const appliedSubs = new Set<() => void>()
const RESULT_MS = 120_000
function setApplied(key: string, patch: Partial<Omit<Applied, 'at'>>): void {
  const cur = applyStore.get(key) ?? NOTHING
  applyStore.set(key, { ...cur, ...patch, at: 'applying' in patch || 'result' in patch ? Date.now() : cur.at })
  appliedSubs.forEach((f) => f())
}
function useApplied(key: string): Applied {
  return useSyncExternalStore((cb) => { appliedSubs.add(cb); return () => { appliedSubs.delete(cb) } }, () => applyStore.get(key) ?? NOTHING)
}

// Unsaved edits also outlive the card: switching to another tab and back must not throw them away. Kept per server,
// dropped as soon as the form is saved, discarded or matches the server again.
interface Unsaved { draft: Draft; base: Draft; takeOver: boolean }
const unsavedStore = new Map<string, Unsaved>()

const APPLY_STEPS: { long: string; short: string }[] = [
  { long: 'CrowdSec checks the new file', short: 'Check' },
  { long: 'The current file is backed up', short: 'Back up' },
  { long: 'The new file is written', short: 'Write' },
  { long: 'CrowdSec restarts', short: 'Restart' },
  { long: 'DCS waits until it is healthy', short: 'Health check' },
]
const StepLabel = ({ step }: { step: { long: string; short: string } }) => <><span className="sm:hidden">{step.short}</span><span className="hidden sm:inline">{step.long}</span></>

/** shown while the request runs: the steps in order, an elapsed clock, an honest bar that only says "working" */
function ApplyingPanel({ since }: { since: number }) {
  const now = useNow()
  const secs = Math.max(0, Math.floor((now - since) / 1000))
  return (
    <div role="status" aria-live="polite" className="rounded-xl bg-slate-900 shadow-lg border border-cyan-500/25 px-4 py-3" data-testid="applying">
      <div className="flex items-center gap-2">
        <Loader2 size={15} className="animate-spin text-cyan-400 shrink-0" aria-hidden="true" />
        <p className="text-sm text-slate-100">Applying the new ban profile… <span className="tabular-nums text-slate-500">{secs} s</span></p>
      </div>
      <div className="relative h-1 mt-3 rounded-full bg-white/10 overflow-hidden" aria-hidden="true">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-emerald-400/70 to-transparent animate-shimmer" />
      </div>
      <ol className="mt-3 flex flex-wrap gap-x-4 sm:gap-x-5 gap-y-1 text-[11px] text-slate-500" aria-label="What happens, in order">
        {APPLY_STEPS.map((st, i) => <li key={st.short} className="flex items-center gap-1.5"><span className="tabular-nums text-slate-500">{i + 1}</span><StepLabel step={st} /></li>)}
      </ol>
      <p className="text-[11px] text-slate-500 mt-2 leading-relaxed">It takes 10 to 40 seconds, and DCS cannot see which step it is on. Bans stay in place. If CrowdSec does not come back healthy, DCS puts the old file back by itself.</p>
    </div>
  )
}

/** the read-only face of a length (a viewer, or a plain line of text) */
function Static({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <p className={`text-sm ${muted ? 'text-slate-500' : 'text-slate-200'}`}>{children}</p>
}

export default function ProfileCard({ scenarios }: { scenarios: ScenarioInfo[] }) {
  const { member, isAdmin, refreshStatus, goTab } = useCs()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()

  const [server, setServer] = useState<CrowdSecSettingsResponse | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState<Draft | null>(null)
  const [rev, setRev] = useState(0)
  const [takeOver, setTakeOver] = useState(false)
  const [elsewhere, setElsewhere] = useState(false)
  const key = member ?? 'hub'
  const ap = useApplied(key)
  const applying = ap.applying
  const result = ap.result
  // an old outcome is not news any more: a card that opens a while after it does not start with it
  useEffect(() => {
    const a = applyStore.get(key)
    if (a?.result && !a.applying && Date.now() - a.at > RESULT_MS) setApplied(key, { result: null, attempt: null })
  }, [key])
  const setResult = useCallback((v: Result | null | ((r: Result | null) => Result | null)) => {
    const cur = applyStore.get(key)?.result ?? null
    setApplied(key, { result: typeof v === 'function' ? v(cur) : v })
  }, [key])
  const [showRaw, setShowRaw] = useState(false)
  const [showBackups, setShowBackups] = useState(false)
  const [justAdded, setJustAdded] = useState<number | null>(null)
  const busy = applying !== null

  const poll = usePolling(() => crowdsecSettings(member), POLL_MS, { enabled: isConnected && !busy })
  const draftRef = useRef<Draft | null>(null); draftRef.current = draft
  const baseRef = useRef<Draft | null>(null); baseRef.current = base

  /** take a server answer as the truth: the form shows it, edits are gone */
  const adopt = useCallback((s: CrowdSecSettingsResponse) => {
    const d = draftFrom(s)
    setServer(s); setBase(d); setDraft(d); setRev((r) => r + 1); setElsewhere(false); setTakeOver(false); setJustAdded(null)
  }, [])

  // the server answered: follow it while nothing is being edited, and say so when it moved under an edit
  useEffect(() => {
    const s = poll.data
    if (!s) return
    setServer(s)
    const b = baseRef.current, d = draftRef.current
    if (!b || !d) {
      // this card came back after the page swapped the tabs away during a failed apply: the edits that failed are put back
      const last = applyStore.get(key)
      if (last?.attempt && last.result?.kind === 'fail' && Date.now() - last.at < RESULT_MS) {
        setServer(s); setBase(draftFrom(s)); setDraft(last.attempt.draft); setTakeOver(last.attempt.takeOver); setRev((r) => r + 1); setElsewhere(false)
        setApplied(key, { attempt: null })
      } else if (unsavedStore.has(key)) {
        // this card came back after a visit to another tab: the edits made before are put back
        const u = unsavedStore.get(key) as Unsaved
        setServer(s); setBase(u.base); setDraft(u.draft); setTakeOver(u.takeOver); setRev((r) => r + 1)
        setElsewhere(!sameDraft(draftFrom(s), u.base))
      } else adopt(s)
      return
    }
    const incoming = draftFrom(s)
    if (sameDraft(incoming, b)) return
    if (sameDraft(d, b)) adopt(s)
    else setElsewhere(true)
  }, [poll.data, adopt, key])

  // (the store follows the form: edits are kept while there are any)
  useEffect(() => {
    if (!draft || !base) return
    if (!sameDraft(draft, base) || takeOver) unsavedStore.set(key, { draft, base, takeOver })
    else unsavedStore.delete(key)
  }, [draft, base, takeOver, key])

  // the page took this card away while an apply was running: when it is back, the person lands where the outcome is shown
  const barRef = useRef<HTMLDivElement>(null)
  useEffect(() => () => { const a = applyStore.get(key); if (a?.applying) applyStore.set(key, { ...a, swapped: true }) }, [key])
  const loaded = !!server && !!draft
  useEffect(() => {
    const a = applyStore.get(key)
    if (!loaded || !a?.swapped || a.applying) return
    applyStore.set(key, { ...a, swapped: false })
    const t = setTimeout(() => barRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' }), 250)
    return () => clearTimeout(t)
  }, [loaded, key, applying])

  const mode = server?.mode
  const locked = !!server && !server.editable && !takeOver
  const disabled = busy || locked || !isAdmin
  // (a missing file is written on the first save even when nothing was edited, and so is a hand-written one that is taken over)
  const edited = !!draft && !!base && (!sameDraft(draft, base) || takeOver)
  const mustWrite = takeOver || mode === 'missing'
  const dirty = edited || mode === 'missing'
  const changed = useMemo<Set<Field>>(() => (draft && base ? changedFields(draft, base) : new Set<Field>()), [draft, base])
  const limits = server?.limits
  const autoMax = useMemo(() => parseDuration(limits?.auto_max ?? '') ?? YEAR_SECONDS, [limits?.auto_max])
  const problems: Problems | null = useMemo(() => (draft ? checkDraft(draft, { autoMax, manualMax: TEN_YEARS_SECONDS, maxRows: limits?.overrides_max ?? 12, scenarios }) : null), [draft, autoMax, limits?.overrides_max, scenarios])
  const defaults = server ? draftFrom({ profile: server.defaults, presets: server.presets, manual_duration: MANUAL_DEFAULT }) : null
  const atDefaults = !!defaults && !!base && sameProfile(base, defaults) && sameLength(base.manual, MANUAL_DEFAULT)
  const presets = server?.presets ?? ['30m', '1h', '4h', '12h', '24h', '3d', '7d', '30d']
  const profileChanged = !!draft && !!base && (!sameProfile(draft, base) || mustWrite)
  // a locked file cannot be edited, but the manual length is not in the file, so it still saves
  const canSave = isAdmin && !busy && dirty && !!problems && problems.hard === 0

  const upd = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d))
    setResult((r) => (r && r.kind === 'ok' ? null : r))
  }
  const setRows = (rows: OverrideRow[]) => upd({ overrides: rows })
  const patchRow = (id: number, patch: Partial<OverrideRow>) => draft && setRows(draft.overrides.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const moveRow = (i: number, by: -1 | 1) => {
    if (!draft) return
    const rows = draft.overrides.slice(), j = i + by
    if (j < 0 || j >= rows.length) return
    ;[rows[i], rows[j]] = [rows[j], rows[i]]
    setRows(rows)
  }
  const addRow = () => {
    if (!draft) return
    const id = newRowId()
    setJustAdded(id)
    setRows([...draft.overrides, { id, pattern: '', duration: presets.includes('24h') ? '24h' : presets[0] }])
  }

  /** send the form (or `d`) to the API and show what came of it */
  const run = async (d: Draft, opts: { force?: boolean; restore?: boolean } = {}) => {
    if (!server || !base) return
    const sendProfile = !sameProfile(d, base) || mustWrite || !!opts.force || !!opts.restore
    const sendManual = !sameLength(d.manual, base.manual)
    if (!sendProfile && !sendManual) return
    const body: CrowdSecSettingsBody = {}
    if (sendProfile) body.profile = profileOf(d, base.escalate.max)
    if (sendManual) body.manual_duration = d.manual.trim()
    if (takeOver || (opts.restore && server.mode === 'custom')) body.take_over = true
    setApplied(key, { result: null, applying: { since: Date.now(), restart: sendProfile }, attempt: { draft: d, takeOver } })
    try {
      const r = await crowdsecSaveSettings(body, member)
      unsavedStore.delete(key)
      adopt(r)
      const done = r.applied
      const restarted = sendProfile && !!done?.changed
      const message = sendProfile ? (done?.message || 'Saved') : `Saved. Manual bans now start at ${lengthWords(d.manual)}. CrowdSec was not restarted.`
      setApplied(key, { result: { kind: 'ok', message, restarted, backup: done?.backup ?? null }, attempt: null })
      addToast({ type: 'success', message: sendProfile ? message : `Manual bans now start at ${lengthWords(d.manual)}`, duration: 6000 })
      refreshStatus()
    } catch (e) {
      const f = explainFailure(e)
      setApplied(key, { result: f })
      addToast({ type: f.unknown ? 'warning' : 'error', message: errMsg(e, 'The change was not applied'), duration: 9000 })
      if (f.custom) setElsewhere(true)
      refreshStatus()
    } finally {
      setApplied(key, { applying: null })
    }
  }

  const save = async () => {
    if (!draft || !server || !canSave) return
    if (server.mode === 'stock' && profileChanged && !(await confirm({
      danger: true,
      title: 'Replace the shipped ban profile?',
      message: 'profiles.yaml is still the file that CrowdSec or the DCS installer shipped. DCS will write its own from these settings (the current file is backed up first) and restart CrowdSec. It takes 10 to 40 seconds and the bans stay in place.',
      confirmLabel: 'Save and apply',
    }))) return
    await run(draft)
  }
  const dismissResult = useCallback(() => setResult(null), [setResult])
  const discard = () => { if (server) { adopt(server); setResult(null) } }
  const restore = async () => {
    if (!server || busy) return
    const custom = server.mode === 'custom'
    const ok = await confirm({
      danger: true,
      title: 'Restore the DCS defaults?',
      message: `Every ban length goes back to its default (${lengthWords(server.defaults.duration)}), repeat-offender escalation and the lengths for particular attacks are switched off, and manual bans start at ${lengthWords(MANUAL_DEFAULT)} again. CrowdSec restarts to apply it (10 to 40 seconds); bans stay in place.${custom ? ' The hand-written profiles.yaml is replaced (a backup is kept).' : ''}`,
      confirmLabel: 'Restore the defaults',
    })
    if (!ok) return
    const d = draftFrom({ profile: server.defaults, presets: server.presets, manual_duration: MANUAL_DEFAULT })
    setDraft(d); setRev((r) => r + 1)
    await run(d, { restore: true })
  }
  const takeOverFile = async () => {
    const ok = await confirm({
      title: 'Let DCS manage the ban profile?',
      message: 'DCS will replace profiles.yaml with a file it writes from the settings on this page. Anything you added by hand (extra profiles, filters, other notification targets) is not kept. A backup of the current file is made first; it is listed under Backups.',
      confirmLabel: 'Take over the file',
    })
    if (ok) { setTakeOver(true); setResult((r) => (r && r.kind === 'ok' ? null : r)) }
  }
  const applyAgain = async () => {
    if (!base || busy) return
    const ok = await confirm({
      title: 'Apply DCS’s version again?',
      message: 'DCS rewrites profiles.yaml from the settings it saved and restarts CrowdSec (10 to 40 seconds). The file as it is now is backed up first. Bans stay in place.',
      confirmLabel: 'Apply again',
    })
    if (ok) await run(base, { force: true })
  }
  /** after a timeout: ask the server whether the change did go through */
  const checkNow = async () => {
    try {
      const fresh = await crowdsecSettings(member)
      const d = draftRef.current
      if (d && sameDraft(draftFrom(fresh), d)) {
        adopt(fresh)
        setResult({ kind: 'ok', message: 'The change did go through: CrowdSec has the new profile.', restarted: false, backup: null })
        refreshStatus()
      } else {
        setServer(fresh)
        addToast({ type: 'info', message: 'CrowdSec does not have these settings (yet). Give it a minute, or save again.', duration: 7000 })
      }
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Could not ask the server'), duration: 7000 }) }
  }

  // ---- loading and failing to load ----
  if (!server || !draft || !base || !problems) {
    return (
      <Panel id="cs-profile" icon={Timer} title="How long CrowdSec bans" sub="Every address CrowdSec catches is banned for the length you choose here.">
        {busy && applying ? (
          <ApplyingPanel since={applying.since} />
        ) : poll.error ? (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-3 flex items-start gap-2.5" role="alert">
            <CircleAlert size={16} className="text-rose-400 shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-100">Could not read the ban profile</p>
              <p className="text-xs text-slate-300 mt-1 break-words">{poll.error.message}</p>
              <button type="button" onClick={poll.refresh} className={`${BTN_TOOLBAR_QUIET} mt-2`}><RefreshCw size={14} /> Try again</button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" aria-busy="true" aria-label="Loading the ban profile">
            <SkeletonBlock className="h-16" /><SkeletonBlock className="h-20" /><SkeletonBlock className="h-20" /><SkeletonBlock className="h-28" />
          </div>
        )}
      </Panel>
    )
  }

  const live = server.live
  const maxRows = server.limits.overrides_max
  const modeChip: { tone: Tone; text: string; title: string } =
    mode === 'dcs' ? { tone: 'ok', text: 'Managed by DCS', title: 'DCS wrote this file and can change it' }
    : mode === 'stock' ? { tone: 'info', text: 'Default file', title: 'The file CrowdSec (or the DCS installer) shipped, not changed since' }
    : mode === 'custom' ? { tone: 'attention', text: 'Edited by hand', title: 'The file has profiles DCS did not write' }
    : { tone: 'problem', text: 'No profile file', title: 'CrowdSec has no ban profile' }
  const nChanges = draft && base ? changedFields(draft, base).size : 0
  const errorCount = problems.hard
  const ladder = draft.escalate.enabled ? ladderWords(draft.duration, draft.escalate.max) : null
  const overrideChanged = changed.has('overrides')

  return (
    <Panel
      id="cs-profile"
      icon={Timer}
      title="How long CrowdSec bans"
      sub="Every address CrowdSec catches is banned for the length you choose here. A ban you add by hand chooses its own length."
      actions={<>
        {edited && <Pill tone="attention">unsaved changes</Pill>}
        <Pill tone={modeChip.tone} title={modeChip.title}>{modeChip.text}</Pill>
      </>}
    >
      {/* the result in words */}
      <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3.5 py-3">
        <p className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-1">{edited ? 'With your changes' : 'Right now'}</p>
        <ProfileSentence d={draft} />
      </div>

      {poll.error && (
        <p className="mt-3 text-[11px] text-amber-300 flex items-center gap-1.5" role="status"><AlertTriangle size={12} aria-hidden="true" /> Could not refresh just now, so this is the last answer. <button type="button" onClick={poll.refresh} className="text-cyan-400 hover:text-cyan-300 underline-offset-2 hover:underline">Try again</button></p>
      )}

      {/* what state the file is in */}
      <div className="mt-4 space-y-2">
        {elsewhere && (
          <Notice tone="info" icon={Info} role="status" title="These settings changed on the server while you were editing"
            action={isAdmin ? <button type="button" className={BTN_TOOLBAR_QUIET} onClick={discard}><Undo2 size={14} /> Load the new values (drops your edits)</button> : undefined}>
            Someone else saved, or the file was changed by hand. Saving now would overwrite that.
          </Notice>
        )}
        {mode === 'custom' && (
          <Notice tone="attention" icon={locked ? Lock : LockOpen} title={locked ? 'This ban profile was edited by hand' : 'DCS will replace the hand-written profile when you save'}
            action={isAdmin ? (
              <>
                {locked && <button type="button" className={BTN_TOOLBAR_ATTN} onClick={takeOverFile} disabled={busy}><LockOpen size={14} /> Let DCS manage it</button>}
                {!locked && <button type="button" className={BTN_TOOLBAR_QUIET} onClick={discard} disabled={busy}><Lock size={14} /> Keep my file</button>}
                {server.raw && <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => setShowRaw((v) => !v)} aria-expanded={showRaw}><FileCode size={14} /> {showRaw ? 'Hide the file' : 'Show the file'}</button>}
              </>
            ) : undefined}>
            {locked
              ? <>profiles.yaml has profiles DCS did not write, so DCS will not change it without asking. If you take it over, DCS replaces the whole file with one written from the settings below. Anything you added by hand (extra profiles, filters, other notification targets) is not kept. A backup of the current file is made first.{!isAdmin && ' Only an admin can hand it over.'}</>
              : <>Saving writes a new profiles.yaml from the settings below and restarts CrowdSec. The current file is backed up first. The values shown were read from your file: the default and network lengths and whether repeat offenders escalate. Everything else in it is not kept.</>}
          </Notice>
        )}
        {mode === 'custom' && isAdmin && showRaw && server.raw && (
          <div className="relative">
            <pre tabIndex={0} aria-label="profiles.yaml as it is now" className="max-h-72 overflow-auto scrollbar-thin rounded-lg bg-slate-950/60 border border-white/5 p-3 pr-9 text-[11px] leading-relaxed font-mono text-slate-300 whitespace-pre">{server.raw}</pre>
            <div className="absolute top-1.5 right-1.5"><CopyButton text={server.raw} label="Copy the file" /></div>
          </div>
        )}
        {mode === 'stock' && (
          <Notice tone="info" icon={Info} title="The ban profile has not been changed from this page yet">
            profiles.yaml is still the file that CrowdSec, or the DCS installer, shipped.{isAdmin && <> The first save replaces it with one DCS writes from these settings. It behaves the same until you change something{live.notified ? ', and the Discord alerts stay wired' : ''}. The old file is backed up.</>}
          </Notice>
        )}
        {mode === 'missing' && (
          <Notice tone="attention" icon={AlertTriangle} title="CrowdSec has no ban profile">
            profiles.yaml is missing or empty, so CrowdSec raises alerts but does not ban anyone by itself.{isAdmin && ' Saving here writes a working one.'}
          </Notice>
        )}
        {server.drift && (
          <Notice tone="attention" icon={AlertTriangle} title="The live file no longer matches what DCS wrote"
            action={isAdmin ? <button type="button" className={BTN_TOOLBAR_ATTN} onClick={applyAgain} disabled={busy}><RefreshCw size={14} /> Apply again</button> : undefined}>
            Someone edited profiles.yaml after DCS applied it, or an update replaced it. The values below are the ones DCS saved.
            {live.ip_duration && <> The file itself says {lengthWords(live.ip_duration)} for an address{live.range_duration ? ` and ${lengthWords(live.range_duration)} for a network` : ''}.</>}
            {' '}Applying again puts DCS’s version back; the current file is backed up first.
          </Notice>
        )}
      </div>

      {/* the settings */}
      <div className="mt-5 divide-y divide-white/5">
        <Setting id="duration" title="Default ban length" changed={changed.has('duration')}
          help="How long CrowdSec bans one address that it caught attacking."
          hint={`Default: ${lengthWords(server.defaults.duration)}. At most ${lengthWords(server.limits.auto_max)}.`}>
          {isAdmin
            ? <LengthPicker key={`d${rev}`} value={draft.duration} onChange={(v) => upd({ duration: v })} presets={presets} ariaLabel="Default ban length" disabled={disabled} error={problems.length} />
            : <Static>{lengthWords(draft.duration)}</Static>}
        </Setting>

        <Setting id="range" title="Ban length for a whole network" changed={changed.has('range')}
          help="When an attack points at a whole network rather than one address, the network is banned for this long. Rare, but it has its own length."
          hint={`Default: ${lengthWords(server.defaults.range_duration)}. At most ${lengthWords(server.limits.auto_max)}.`}>
          {isAdmin
            ? <LengthPicker key={`r${rev}`} value={draft.range_duration} onChange={(v) => upd({ range_duration: v })} presets={presets} ariaLabel="Ban length for a whole network" disabled={disabled} error={problems.range} />
            : <Static>{lengthWords(draft.range_duration)}</Static>}
        </Setting>

        <Setting id="escalate" title="Ban repeat offenders for longer" changed={changed.has('escalate')}
          help={`Each new ban of the same address lasts longer than the last, up to the maximum you set. CrowdSec remembers an address’s earlier bans for ${server.retention_days} day${server.retention_days === 1 ? '' : 's'}.`}
          hint={`Default: off${server.defaults.escalate.max ? `, with a maximum of ${lengthWords(server.defaults.escalate.max)}` : ''}.`}>
          {isAdmin ? (
            <div className="flex items-center gap-3">
              <Toggle checked={draft.escalate.enabled} onChange={(v) => upd({ escalate: { ...draft.escalate, enabled: v } })} label="Ban repeat offenders for longer" disabled={disabled} />
              <span className="text-sm text-slate-300">{draft.escalate.enabled ? 'On' : 'Off'}</span>
            </div>
          ) : <Static>{draft.escalate.enabled ? `On, up to ${lengthWords(draft.escalate.max)}` : 'Off'}</Static>}
          {draft.escalate.enabled && (
            <div className="mt-3">
              {isAdmin ? (
                <>
                  <p className={LABEL}>Longest ban</p>
                  <LengthPicker key={`c${rev}`} value={draft.escalate.max} onChange={(v) => upd({ escalate: { ...draft.escalate, max: v } })} presets={CAP_PRESETS} ariaLabel="Longest ban for a repeat offender" disabled={disabled} error={problems.cap} />
                </>
              ) : null}
              {ladder && <p className="text-xs text-slate-500 mt-2.5 leading-relaxed">An address that keeps coming back is banned for {ladder}.</p>}
              {problems.capNote && <p className="text-xs text-amber-300 mt-2 flex items-start gap-1.5"><AlertTriangle size={12} className="shrink-0 mt-0.5" aria-hidden="true" /> {problems.capNote}</p>}
            </div>
          )}
        </Setting>

        <Setting id="overrides" title="Lengths for particular attacks" changed={overrideChanged}
          help="Give one kind of attack its own length: SSH brute force for a day, known exploits for a week. The first matching row wins, so put the more specific one first. It counts for addresses and networks alike."
          hint={`Default: none, every attack uses the default. Up to ${maxRows} rows.`}>
          <OverridesEditor
            rows={draft.overrides} problems={problems} scenarios={scenarios} presets={presets} rev={rev} editing={isAdmin} disabled={disabled} maxRows={maxRows} justAdded={justAdded}
            onPatch={patchRow} onMove={moveRow} onRemove={(id) => setRows(draft.overrides.filter((r) => r.id !== id))} onAdd={addRow}
          />
          {problems.rowCount && <p className="text-xs text-rose-300 mt-2" role="alert">{problems.rowCount}</p>}
        </Setting>

        <Setting id="manual" title="Length of a manual ban" changed={changed.has('manual')}
          help="What a ban you add yourself lasts when you do not pick a length: the Ban form starts with it, and imports use it for lines without one. Saved right away; CrowdSec is not restarted."
          hint={`Default: ${lengthWords(MANUAL_DEFAULT)}. At most ${server.limits.manual_max}.`}>
          {isAdmin
            ? <LengthPicker key={`m${rev}`} value={draft.manual} onChange={(v) => upd({ manual: v })} presets={presets} ariaLabel="Length of a manual ban" disabled={busy || !isAdmin} error={problems.manual} />
            : <Static>{lengthWords(draft.manual)}</Static>}
        </Setting>
      </div>

      {isAdmin && (
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between gap-x-4 gap-y-2 flex-wrap">
          <p className="text-xs text-slate-500 leading-relaxed min-w-0 flex-1 basis-64">Want to start over? Every value goes back to how DCS ships it: {lengthWords(server.defaults.duration)} for addresses and networks, no escalation, no lengths for particular attacks, {lengthWords(MANUAL_DEFAULT)} for a manual ban.</p>
          <button type="button" className={BTN_TOOLBAR_QUIET} onClick={restore} disabled={busy || (atDefaults && mode !== 'custom' && !takeOver)} title={atDefaults && mode !== 'custom' ? 'Everything is at its default already' : 'Set every value back to the DCS default and apply it'}><RotateCcw size={14} /> Restore DCS defaults</button>
        </div>
      )}

      {/* what is really in the file */}
      <div className="mt-5 pt-4 border-t border-white/5">
        <SectionHeader icon={FileCode} title="The file on the server" />
        <dl className="mt-3 grid grid-cols-1 sm:grid-cols-[11rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 sm:gap-y-2.5 text-xs">
          <dt className="text-slate-500">File</dt>
          <dd className="text-slate-200 min-w-0 flex items-center gap-1"><span className="font-mono truncate" title={live.file}>{live.file}</span><CopyButton text={live.file} label="Copy the file path" /></dd>
          <dt className="text-slate-500">Who manages it</dt>
          <dd className="text-slate-200">
            {mode === 'dcs' && 'DCS wrote it, and can change it from here.'}
            {mode === 'stock' && 'Nobody yet: it is the file CrowdSec or the DCS installer shipped. DCS can replace it.'}
            {mode === 'custom' && 'Someone, by hand. DCS changes it only if you take it over.'}
            {mode === 'missing' && 'Nobody: there is no file. DCS can create it.'}
            <span className="text-slate-500"> Editable here: {server.editable ? 'yes' : 'not until you take it over'}.</span>
          </dd>
          <dt className="text-slate-500">Ban length in the file</dt>
          <dd className="text-slate-200">{live.ip_duration ? lengthWords(live.ip_duration) : '—'} for an address, {live.range_duration ? lengthWords(live.range_duration) : '—'} for a network</dd>
          <dt className="text-slate-500">Repeat offenders</dt>
          <dd className="text-slate-200">{live.escalate ? 'The file makes each new ban longer' : 'Every ban has the same length'}</dd>
          <dt className="text-slate-500">Profiles</dt>
          <dd className="flex flex-wrap gap-1.5 min-w-0">{live.profiles.length ? live.profiles.map((p) => <Pill key={p} tone="neutral"><span className="font-mono">{p}</span></Pill>) : <span className="text-slate-500">none</span>}</dd>
          <dt className="text-slate-500">Discord alerts</dt>
          <dd className="text-slate-200 min-w-0">
            {live.notified
              ? <><Pill tone="ok">wired in</Pill> <span className="text-slate-500">Bans are sent to Discord. DCS keeps this wired when it saves.</span></>
              : <><Pill tone="neutral">not connected</Pill> <span className="text-slate-500">Bans are not sent to Discord.</span> <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => goTab('notifications')}>Set it up</button></>}
          </dd>
        </dl>

        <div className="mt-4">
          <button type="button" onClick={() => setShowBackups((v) => !v)} aria-expanded={showBackups} className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-200 transition-colors">
            {showBackups ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            <Archive size={12} aria-hidden="true" /> Backups <span className="text-slate-500 tabular-nums">{server.backups.length}</span>
            {server.backups[0] && <span className="text-slate-500">· newest <Ago at={server.backups[0].created_at} /></span>}
          </button>
          {showBackups && (
            <div className="mt-2.5">
              <p className="text-[11px] text-slate-500 leading-relaxed">Backups are kept so a bad change can be undone by hand. DCS puts the newest one back by itself when applying fails.</p>
              {server.backups.length === 0 ? (
                <p className="text-xs text-slate-500 mt-3">No backups yet. DCS makes one every time it replaces a file.</p>
              ) : (
                <>
                  <table className="hidden sm:table w-full mt-3 text-xs">
                    <thead><tr className="text-[10px] uppercase tracking-wider text-slate-500 text-left"><th className="font-semibold py-1.5 pr-3">File</th><th className="font-semibold py-1.5 pr-3">Kind</th><th className="font-semibold py-1.5 pr-3">Made</th><th className="font-semibold py-1.5 text-right">Size</th></tr></thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {server.backups.map((b) => (
                        <tr key={b.name} className="text-slate-500">
                          <td className="py-1.5 pr-3 font-mono text-[11px] text-slate-300 break-all">{b.name}</td>
                          <td className="py-1.5 pr-3">{b.kind === 'http' ? 'Discord message' : 'Ban profile'}</td>
                          <td className="py-1.5 pr-3 whitespace-nowrap" title={fmtTime(b.created_at)}>{fmtTime(b.created_at)} <span className="text-slate-500">· <Ago at={b.created_at} /></span></td>
                          <td className="py-1.5 text-right tabular-nums">{fmtBytes(b.size)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <ul className="sm:hidden mt-3 divide-y divide-white/[0.04]">
                    {server.backups.map((b) => (
                      <li key={b.name} className="py-2 text-xs text-slate-500">
                        <p className="font-mono text-[11px] text-slate-300 break-all">{b.name}</p>
                        <p className="mt-0.5">{b.kind === 'http' ? 'Discord message' : 'Ban profile'} · {fmtTime(b.created_at)} · <Ago at={b.created_at} /> · <span className="tabular-nums">{fmtBytes(b.size)}</span></p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* what is happening, and the buttons */}
      <div ref={barRef} className="sticky bottom-14 md:bottom-3 z-20 mt-5 space-y-2">
        {applying?.restart && <ApplyingPanel since={applying.since} />}
        {result && !busy && <ResultPanel result={result} onDismiss={dismissResult} onCheck={checkNow} onOpenFile={result.kind === 'fail' && result.custom ? () => setShowRaw(true) : undefined} />}
        {isAdmin && (
          <div className={`rounded-xl bg-slate-900 shadow-lg border px-3 py-2.5 md:pr-16 flex items-center gap-x-3 gap-y-2 flex-wrap ${edited ? 'border-emerald-500/25' : 'border-white/10'}`} role="group" aria-label="Save the ban profile">
            <p className={`text-xs min-w-0 flex-1 basis-56 leading-relaxed ${errorCount > 0 && dirty ? 'text-rose-300' : 'text-slate-500'}`} aria-live="polite">
              {busy ? 'Working… please wait.'
                : locked && !dirty ? 'Take over the file to change it.'
                : !dirty ? 'Nothing to save: these settings are in force.'
                : errorCount > 0 ? `Fix ${errorCount} setting${errorCount === 1 ? '' : 's'} marked in red to save.`
                : profileChanged ? `${nChanges > 0 ? `${nChanges} change${nChanges === 1 ? '' : 's'} not saved` : mode === 'missing' ? 'The missing profile file will be created' : 'The hand-written file will be replaced'}. Saving restarts CrowdSec for 10 to 40 seconds; bans stay in place.`
                : 'Not saved yet. This one is saved right away, without restarting CrowdSec.'}
            </p>
            <div className="w-full sm:w-auto grid grid-cols-2 sm:flex sm:items-center gap-2">
              <button type="button" className={BTN_TOOLBAR_QUIET} onClick={discard} disabled={busy || (!edited && !elsewhere)}><Undo2 size={14} /> Discard changes</button>
              <button type="button" className={BTN_TOOLBAR_OK} onClick={save} disabled={!canSave}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} Save and apply</button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

// ---------------------------------------------------------------------------
// The lengths for particular attacks
// ---------------------------------------------------------------------------

function OverridesEditor({ rows, problems, scenarios, presets, rev, editing, disabled, maxRows, justAdded, onPatch, onMove, onRemove, onAdd }: {
  rows: OverrideRow[]; problems: Problems; scenarios: ScenarioInfo[]; presets: string[]; rev: number; editing: boolean; disabled: boolean; maxRows: number; justAdded: number | null
  onPatch: (id: number, patch: Partial<OverrideRow>) => void; onMove: (i: number, by: -1 | 1) => void; onRemove: (id: number) => void; onAdd: () => void
}) {
  if (!editing) {
    return rows.length === 0 ? <Static muted>None: every attack uses the default length.</Static> : (
      <ul className="space-y-1.5">
        {rows.map((r) => (
          <li key={r.id} className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0"><span className="text-slate-200">{scenarioLabel(r.pattern) ?? shortName(r.pattern)}</span> <span className="font-mono text-[11px] text-slate-500 break-all">{r.pattern}</span></span>
            <span className="text-slate-200 tabular-nums shrink-0">{lengthWords(r.duration)}</span>
          </li>
        ))}
      </ul>
    )
  }
  return (
    <div>
      {rows.length === 0 && <p className="text-xs text-slate-500 mb-2">No special lengths: every attack uses the default length above.</p>}
      {rows.length > 0 && (
        <ol className="space-y-2" aria-label="Lengths for particular attacks, checked from the top">
          {rows.map((r, i) => {
            const pr: RowProblem = problems.rows[r.id] ?? {}
            const pat = r.pattern.trim()
            const known = pat && !pr.pattern ? matchCount(pat, scenarios) : 0
            const installed = scenarios.find((s) => s.name === pat)
            const label = pat ? scenarioLabel(pat) : null
            const note = [label, installed ? installed.description : known > 1 ? `${known} installed scenarios` : known === 1 && pat.endsWith('*') ? '1 installed scenario' : ''].filter(Boolean).join(' · ')
            return (
              <li key={`${r.id}-${rev}`} className={`rounded-lg border p-2.5 ${pr.pattern || pr.length ? 'border-rose-500/25 bg-rose-500/[0.04]' : 'border-white/5 bg-white/[0.02]'}`}>
                <div className="grid gap-2 lg:grid-cols-[1.25rem_minmax(0,1fr)_auto_auto] lg:items-start">
                  <span className="hidden lg:flex h-9 items-center justify-center text-[11px] tabular-nums text-slate-500" aria-hidden="true">{i + 1}</span>
                  <ScenarioInput value={r.pattern} onChange={(v) => onPatch(r.id, { pattern: v })} scenarios={scenarios} ariaLabel={`Scenario, row ${i + 1}`} invalid={!!pr.pattern} disabled={disabled} autoFocus={justAdded === r.id} />
                  <div className="flex items-center justify-between gap-2 lg:contents">
                    <CompactLength value={r.duration} onChange={(v) => onPatch(r.id, { duration: v })} presets={presets} ariaLabel={`Ban length, row ${i + 1}`} disabled={disabled} invalid={!!pr.length} />
                    <div className="flex items-center gap-1 shrink-0">
                      <button type="button" className={BTN_ICON_QUIET} aria-label={`Move row ${i + 1} up`} title="Check this one earlier" disabled={disabled || i === 0} onClick={() => onMove(i, -1)}><ArrowUp size={14} /></button>
                      <button type="button" className={BTN_ICON_QUIET} aria-label={`Move row ${i + 1} down`} title="Check this one later" disabled={disabled || i === rows.length - 1} onClick={() => onMove(i, 1)}><ArrowDown size={14} /></button>
                      <button type="button" className={`${BTN_ICON_QUIET} hover:!bg-rose-500/15 hover:!text-rose-300`} aria-label={`Remove row ${i + 1}`} title="Remove this row" disabled={disabled} onClick={() => onRemove(r.id)}><Trash2 size={14} /></button>
                    </div>
                  </div>
                </div>
                {(pr.pattern || pr.length || pr.warn || note) && (
                  <div className="lg:pl-[1.75rem] mt-1.5 space-y-0.5">
                    {pr.pattern && <p className="text-[11px] text-rose-300" role="alert">{pr.pattern}</p>}
                    {pr.length && <p className="text-[11px] text-rose-300" role="alert">{pr.length}</p>}
                    {pr.warn && <p className="text-[11px] text-amber-300">{pr.warn}</p>}
                    {!pr.pattern && !pr.warn && note && <p className="text-[11px] text-slate-500 truncate" title={note}>{note}</p>}
                  </div>
                )}
              </li>
            )
          })}
        </ol>
      )}
      <div className="mt-2.5 flex items-center gap-3 flex-wrap">
        <button type="button" className={BTN_TOOLBAR_QUIET} onClick={onAdd} disabled={disabled || rows.length >= maxRows}><Plus size={14} /> Add a length for an attack</button>
        <span className="text-[11px] text-slate-500 tabular-nums">{rows.length} of {maxRows}</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// The outcome
// ---------------------------------------------------------------------------

function ResultPanel({ result, onDismiss, onCheck, onOpenFile }: { result: Result; onDismiss: () => void; onCheck: () => void; onOpenFile?: () => void }) {
  // good news steps aside after a while (the toast said it too, and the Backups list keeps the file); trouble stays until it is dismissed
  useEffect(() => {
    if (result.kind !== 'ok') return
    const t = setTimeout(onDismiss, 15_000)
    return () => clearTimeout(t)
  }, [result, onDismiss])
  if (result.kind === 'ok') {
    return (
      <div className="rounded-xl bg-slate-900 shadow-lg">
        <Notice tone="ok" icon={CircleCheck} role="status" title={result.message} onDismiss={onDismiss}>
          {result.restarted && (
            <ol className="mt-0.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-slate-500" aria-label="What was done">
              {APPLY_STEPS.map((st) => <li key={st.short} className="flex items-center gap-1"><CircleCheck size={11} className="text-emerald-400 shrink-0" aria-hidden="true" /><StepLabel step={st} /></li>)}
            </ol>
          )}
          {result.backup && <p className="mt-1.5">The previous file was kept as <span className="font-mono text-[11px]">{result.backup}</span> (see Backups).</p>}
        </Notice>
      </div>
    )
  }
  return (
    <div className="rounded-xl bg-slate-900 shadow-lg">
      <Notice tone={result.tone} icon={result.tone === 'attention' ? AlertTriangle : CircleAlert} role="alert" title={result.title} onDismiss={onDismiss}
        action={<>
          {result.unknown && <button type="button" className={BTN_TOOLBAR_QUIET} onClick={onCheck}><RefreshCw size={14} /> Check now</button>}
          {onOpenFile && <button type="button" className={BTN_TOOLBAR_QUIET} onClick={onOpenFile}><FileCode size={14} /> Show the file</button>}
        </>}>
        <p>{result.body}</p>
        {result.detail && (
          <details className="mt-1.5">
            <summary className="cursor-pointer text-[11px] text-slate-500 hover:text-slate-200">What the server said</summary>
            <p className="mt-1 font-mono text-[11px] text-slate-300 whitespace-pre-wrap break-words max-h-40 overflow-y-auto scrollbar-thin" data-testid="fail-detail">{result.detail}</p>
          </details>
        )}
      </Notice>
    </div>
  )
}
