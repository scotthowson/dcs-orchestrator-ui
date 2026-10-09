// =============================================================================
// Allowlist: the addresses and networks CrowdSec must never ban. Says how it is
// done on this server (CrowdSec's own allowlist, or a DCS whitelist on an older
// CrowdSec), whether the address you connect from is covered, and lists every
// entry with its source, note and a live countdown for the ones that expire.
// Add one (an address or a network, a note, an expiry) or take one off. The
// server has the last word on what is accepted; its own words are shown as is.
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, ArrowRight, Info, ListChecks, Loader2, Lock, Plus, Search, ShieldCheck, Trash2, UserCheck, X } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecAllow, crowdsecAllowlist, crowdsecDisallow } from '../../api/endpoints'
import type { CrowdSecAllowAddResponse, CrowdSecAllowEntry, CrowdSecAllowlistResponse } from '../../../shared/types'
import { canonicalDuration, errMsg, fmtAgo, fmtLeft, fmtTime, looksLikeTarget, parseDuration, useCs, useNow } from './kit'
import { addressCount, apiRefusesNet, isPrivateNet, isSingle, isWideNet, netCovers, netSame, parseNet } from './AllowlistTab.net'

import { BTN_ICON_QUIET, BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { HINT, INPUT, LABEL } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import { type Tone } from '../../lib/tone'
import { Pill } from '../common/Pill'
import SectionHeader from '../common/SectionHeader'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import Sheet from '../common/Sheet'
import { Panel } from '../dashboard/cardShared'
type Source = CrowdSecAllowEntry['source']

/** where an entry comes from, in the words the person sees, with an honest tooltip */
const SOURCE: Record<Source, { label: string; tone: Tone; tip: string }> = {
  managed: { label: 'Home address', tone: 'info', tip: 'Your home address. DCS looks up your public IP regularly and keeps it on the list, so you can never ban yourself. It follows your address when your provider changes it, so it cannot be removed here.' },
  env: { label: 'From .env', tone: 'info', tip: 'Listed in CROWDSEC_TRUSTED_IPS in the .env file. It is not managed from this page: change that setting to change this entry.' },
  allowlist: { label: 'Added here', tone: 'neutral', tip: 'On the allowlist DCS keeps in CrowdSec: added from this page, or with cscli allowlists add. You can remove it here.' },
  trusted: { label: 'Trusted list', tone: 'neutral', tip: 'On the DCS trusted list, a whitelist for CrowdSec’s log reader that DCS keeps in step. It never expires. You can remove it here.' },
  other: { label: 'Other list', tone: 'neutral', tip: 'On an allowlist that DCS did not create. CrowdSec honours it, but DCS does not manage it.' },
}
const SOURCE_ORDER: Source[] = ['managed', 'env', 'allowlist', 'trusted', 'other']

const keyOf = (e: CrowdSecAllowEntry) => `${e.list ?? e.source}|${e.value}`
const rank = (e: CrowdSecAllowEntry) => (e.source === 'managed' ? 0 : e.source === 'env' ? 1 : 2)
/** what DCS keeps first, then the newest */
function sortEntries(list: CrowdSecAllowEntry[]): CrowdSecAllowEntry[] {
  return [...list].sort((a, b) => rank(a) - rank(b) || (Date.parse(b.created_at) || 0) - (Date.parse(a.created_at) || 0) || a.value.localeCompare(b.value))
}
/** why an entry has no Remove button, in a sentence */
function lockReason(e: CrowdSecAllowEntry): string {
  if (e.source === 'managed') return 'DCS keeps your home address allowed and follows it when your provider changes it, so it cannot be removed here.'
  if (e.source === 'env') return 'It comes from CROWDSEC_TRUSTED_IPS in the .env file. Change that setting to change it.'
  if (e.source === 'other') return `It belongs to the “${e.list ?? 'other'}” allowlist, which DCS does not manage. Use cscli allowlists remove ${e.list ?? '<list>'} ${e.value}.`
  return 'DCS does not manage this entry, so it cannot be removed here.'
}
/** when an entry was added; for the home address, the moment DCS last looked the address up */
function addedText(e: CrowdSecAllowEntry, long = false): string {
  if (!e.created_at) return '—'
  if (e.source === 'managed') return `checked ${fmtAgo(e.created_at)}`
  return long ? `added ${fmtTime(e.created_at)}` : fmtTime(e.created_at)
}
const fmtWhen = (ms: number) => new Date(ms).toLocaleString([], { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------------------
// The small pieces
// ---------------------------------------------------------------------------

/** a live countdown to the moment an entry stops counting; "never" for the ones that stay */
function Countdown({ at }: { at: string | null }) {
  const now = useNow()
  if (!at) return <span className="text-xs text-slate-500" title="This entry stays until it is removed">never</span>
  const left = Math.round((Date.parse(at) - now) / 1000)
  return (
    <span title={`Ends ${fmtTime(at)}`} className={`tabular-nums text-xs ${left < 300 ? 'text-amber-300' : 'text-slate-300'}`}>
      {left <= 0 ? 'ending…' : `in ${fmtLeft(left)}`}
    </span>
  )
}

function SourceChip({ e }: { e: CrowdSecAllowEntry }) {
  const s = SOURCE[e.source] ?? SOURCE.other
  const label = e.source === 'other' && e.list ? `List: ${e.list}` : s.label
  return <Pill tone={s.tone} title={s.tip}>{label}</Pill>
}

function KindChip({ e }: { e: CrowdSecAllowEntry }) {
  const net = parseNet(e.value)
  return <Pill tone="neutral" title={net ? addressCount(net) : undefined}>{e.kind === 'range' ? 'Network' : 'Address'}</Pill>
}

// ---------------------------------------------------------------------------
// How long an entry lasts: "No expiry" is the calm default (the tab's own picker: the
// kit's DurationPicker words its last chip for bans, "Permanent … ten years")
// ---------------------------------------------------------------------------

interface Expiry { mode: 'none' | 'preset' | 'custom'; text: string }
const PRESETS = [{ v: '1d', label: '1 day' }, { v: '7d', label: '7 days' }, { v: '30d', label: '30 days' }]
const MAX_EXPIRY = 315360000

/** seconds = 0 means no expiry */
function expiryOf(x: Expiry): { ok: boolean; seconds: number } {
  if (x.mode === 'none') return { ok: true, seconds: 0 }
  const s = parseDuration(x.text)
  return s !== null && s >= 60 && s <= MAX_EXPIRY ? { ok: true, seconds: s } : { ok: false, seconds: 0 }
}

function ExpiryPicker({ value, onChange, disabled = false }: { value: Expiry; onChange: (v: Expiry) => void; disabled?: boolean }) {
  const chip = (on: boolean) => `h-8 px-2.5 rounded-lg text-xs font-medium border transition-colors shrink-0 disabled:opacity-50 ${on ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-white/5 text-slate-300 border-white/10 hover:bg-white/10'}`
  const bad = value.mode === 'custom' && value.text.trim() !== '' && !expiryOf(value).ok
  return (
    <div>
      <div role="group" aria-label="How long the entry lasts" className="flex flex-wrap gap-1.5">
        <button type="button" disabled={disabled} aria-pressed={value.mode === 'none'} className={chip(value.mode === 'none')} onClick={() => onChange({ mode: 'none', text: '' })}>No expiry</button>
        {PRESETS.map((p) => {
          const on = value.mode === 'preset' && value.text === p.v
          return <button key={p.v} type="button" disabled={disabled} aria-pressed={on} className={chip(on)} onClick={() => onChange({ mode: 'preset', text: p.v })}>{p.label}</button>
        })}
        <button type="button" disabled={disabled} aria-pressed={value.mode === 'custom'} className={chip(value.mode === 'custom')} onClick={() => onChange({ mode: 'custom', text: value.mode === 'custom' ? value.text : '' })}>Custom</button>
      </div>
      {value.mode === 'custom' && (
        <div className="mt-2">
          <input
            className={`${INPUT} max-w-[14rem] ${bad ? '!border-rose-500/40' : ''}`}
            value={value.text}
            disabled={disabled}
            placeholder="e.g. 90m, 12h, 10d, 2w"
            aria-label="Custom expiry"
            aria-invalid={bad}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => onChange({ mode: 'custom', text: e.target.value })}
          />
          <p className={`${HINT} ${bad ? '!text-rose-300' : ''}`}>{bad ? 'Use minutes, hours, days or weeks, between 1 minute and 10 years.' : 'Minutes (m), hours (h), days (d) or weeks (w); combine them, like 1d12h.'}</p>
        </div>
      )}
    </div>
  )
}

/** "1d" / "168h" → the picker state it should open with */
function expiryFrom(text?: string): Expiry {
  if (!text) return { mode: 'none', text: '' }
  return PRESETS.some((p) => p.v === text) ? { mode: 'preset', text } : { mode: 'custom', text }
}

// ---------------------------------------------------------------------------
// The sheet that adds an entry
// ---------------------------------------------------------------------------

interface AllowSeed { value?: string; comment?: string; expires?: string }

function AllowSheet({ data, seed, onClose, onDone }: { data: CrowdSecAllowlistResponse; seed: AllowSeed; onClose: () => void; onDone: (r: CrowdSecAllowAddResponse) => void }) {
  const { member } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [value, setValue] = useState(seed.value ?? '')
  const [comment, setComment] = useState(seed.comment ?? '')
  const [exp, setExp] = useState<Expiry>(expiryFrom(data.supports_expiry ? seed.expires : undefined))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const target = value.trim()
  const net = useMemo(() => parseNet(target), [target])
  const valid = looksLikeTarget(target) && net !== null
  const listed = useMemo(() => data.entries.map((e) => ({ e, net: parseNet(e.value) })), [data.entries])
  // an entry of the lists DCS keeps cannot be changed by adding it again: remove it first
  const dupe = net ? listed.find((p) => p.net && netSame(p.net, net) && (p.e.source === 'allowlist' || p.e.source === 'trusted'))?.e : undefined
  const covering = net ? listed.find((p) => p.net && !netSame(p.net, net) && netCovers(p.net, net))?.e : undefined
  const { ok: expOk, seconds } = expiryOf(exp)

  let hint: { text: string; tone: 'help' | 'problem' | 'attention' } = { tone: 'help', text: 'An address such as 203.0.113.7, an IPv6 address, or a network such as 203.0.113.0/24.' }
  if (target) {
    if (!valid || !net) hint = { tone: 'problem', text: 'That does not look like an IP address or a network.' }
    else if (dupe) hint = { tone: 'problem', text: `${dupe.value} is already on the list${dupe.comment ? ` (${dupe.comment})` : ''}. To change its note or expiry, remove it and add it again.` }
    else if (apiRefusesNet(net)) hint = { tone: 'attention', text: `A network of ${addressCount(net)} is far too wide: the server will refuse it.` }
    else if (isWideNet(net)) hint = { tone: 'attention', text: `A very wide network: ${addressCount(net)}. You will be asked to confirm.` }
    else if (isPrivateNet(net)) hint = { tone: 'help', text: 'A private address. Traefik trusts local addresses and DCS refuses to ban them, so this entry changes little.' }
    else if (covering) hint = { tone: 'help', text: `Already covered by ${covering.value}${covering.comment ? ` (${covering.comment})` : ''}. You can still add it, for example to give it its own expiry.` }
    else hint = { tone: 'help', text: isSingle(net) ? 'This one address will never be banned.' : `All ${addressCount(net)} in this network will never be banned.` }
  }

  const submit = async () => {
    if (!valid || !net || !expOk || dupe || busy) return
    if (isWideNet(net) && !apiRefusesNet(net) && !(await confirm({
      title: 'Allow a very wide network?',
      message: `${target} covers ${addressCount(net)}. CrowdSec will never ban any of them, so anything inside that network can scan or attack you freely.\nOnly do this for a network that is yours.`,
      confirmLabel: 'Allow the whole network',
      danger: true,
    }))) return
    setBusy(true); setError('')
    try {
      const r = await crowdsecAllow({ value: target, comment: comment.trim() || undefined, expires: seconds > 0 ? canonicalDuration(seconds) : undefined }, member)
      const lifted = r.removed_bans > 0 ? ` · also lifted ${plural(r.removed_bans, 'ban', 'bans')}` : ''
      addToast({ type: 'success', message: `${r.value} ${r.expires_at ? `will not be banned until ${fmtTime(r.expires_at)}` : 'will never be banned'}${lifted}`, duration: 6000 })
      onDone(r)
      onClose()
    } catch (e) {
      setError(errMsg(e, 'The entry was refused'))
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Allow an address" subtitle="CrowdSec will never ban it." icon={<ShieldCheck size={18} />} onClose={onClose}
      footer={
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" onClick={onClose} className={BTN_TOOLBAR_QUIET}>Cancel</button>
          <button type="button" onClick={submit} disabled={!valid || !expOk || !!dupe || busy} className={`${BTN_TOOLBAR_OK} min-w-[10rem]`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />} {valid ? `Allow ${target.length > 22 ? `${target.slice(0, 20)}…` : target}` : 'Allow'}
          </button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="allow-address">Address or network</label>
          <input
            id="allow-address" autoFocus className={`${INPUT} font-mono ${target && (!valid || dupe) ? '!border-rose-500/40' : ''}`}
            value={value} onChange={(e) => { setValue(e.target.value); setError('') }}
            placeholder="203.0.113.7 or 203.0.113.0/24" spellCheck={false} autoComplete="off" aria-invalid={!!target && (!valid || !!dupe)} aria-describedby="allow-address-hint"
          />
          <p id="allow-address-hint" className={`${HINT} ${hint.tone === 'problem' ? '!text-rose-300' : hint.tone === 'attention' ? '!text-amber-300' : ''}`}>{hint.text}</p>
          <p className={HINT}>The server refuses a network wider than a /8 (IPv4) and ::/0 (IPv6). Anything wider than a /16 (IPv4) or a /48 (IPv6) asks you to confirm first.</p>
        </div>
        <div>
          <label className={LABEL} htmlFor="allow-comment">Note <span className="text-slate-500 font-normal">(optional, shown in the list)</span></label>
          <input id="allow-comment" className={INPUT} value={comment} maxLength={200} onChange={(e) => setComment(e.target.value)} placeholder="e.g. office, uptime monitor" />
        </div>
        <div>
          <p className={LABEL}>How long</p>
          {data.supports_expiry ? (
            <>
              <ExpiryPicker value={exp} onChange={setExp} disabled={busy} />
              <p className={HINT}>{exp.mode === 'none' ? 'Default: no expiry. The entry stays until you remove it.' : expOk ? `The address can be banned again after ${fmtWhen(Date.now() + seconds * 1000)}; the entry then disappears by itself.` : ''}</p>
            </>
          ) : (
            <p className="text-xs text-slate-300 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2.5 flex items-start gap-2"><Info size={14} className="shrink-0 mt-0.5 text-slate-500" /> Entries cannot expire on this server: this CrowdSec is older than 1.6.8, so an entry stays until you remove it.</p>
          )}
        </div>
        {error && (
          <div className="rounded-lg bg-rose-500/[0.08] border border-rose-500/25 px-3 py-2.5 text-sm text-rose-300 flex items-start gap-2" role="alert">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-400" />
            <p className="min-w-0 break-words">{error}</p>
          </div>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export default function AllowlistTab() {
  const { member, isAdmin, status, refreshStatus, goTab } = useCs()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const poll = usePolling<CrowdSecAllowlistResponse>(() => crowdsecAllowlist(member), 15000, { enabled: isConnected })
  const refresh = poll.refresh
  const data = poll.data
  const [q, setQ] = useState('')
  const [source, setSource] = useState<'' | Source>('')
  const [sheet, setSheet] = useState<AllowSeed | null>(null)
  const [busy, setBusy] = useState('')
  const [added, setAdded] = useState('')

  // the row that was just added glows for a few seconds
  useEffect(() => {
    if (!added) return
    const t = setTimeout(() => setAdded(''), 4500)
    return () => clearTimeout(t)
  }, [added])

  const entries = useMemo(() => sortEntries(data?.entries ?? []), [data])
  const listed = useMemo(() => entries.map((e) => ({ e, net: parseNet(e.value) })), [entries])
  // a dual-stack server may report an IPv4 client as ::ffff:203.0.113.7: that is the address 203.0.113.7
  const clientIp = (data?.client_ip ?? '').replace(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i, '$1')
  const clientNet = useMemo(() => parseNet(clientIp), [clientIp])
  // the entries that cover the address you connect from (a lapsed one no longer counts)
  const covering = useMemo(() => {
    if (!clientNet) return []
    const t = Date.now()
    return listed.filter((p) => p.net && netCovers(p.net, clientNet) && (!p.e.expires_at || Date.parse(p.e.expires_at) > t)).sort((a, b) => (b.net?.prefix ?? 0) - (a.net?.prefix ?? 0)).map((p) => p.e)
  }, [listed, clientNet])
  const coversYou = useMemo(() => new Set(covering.map(keyOf)), [covering])

  const many = entries.length > 8
  const qq = q.trim().toLowerCase()
  const qNet = useMemo(() => parseNet(qq), [qq])
  const shown = useMemo(() => listed.filter(({ e, net }) => (
    (!source || e.source === source)
    && (!qq || e.value.toLowerCase().includes(qq) || e.comment.toLowerCase().includes(qq) || (e.list ?? '').toLowerCase().includes(qq) || (!!qNet && !!net && netCovers(net, qNet)))
  )).map((p) => p.e), [listed, source, qq, qNet])
  const filtered = !!(qq || source)
  const counts = useMemo(() => {
    const c: Partial<Record<Source, number>> = {}
    for (const e of entries) c[e.source] = (c[e.source] ?? 0) + 1
    return c
  }, [entries])
  const clearFilters = () => { setQ(''); setSource('') }

  const after = (value?: string) => { refresh(); refreshStatus(); if (value) setAdded(value) }

  const removeOne = async (e: CrowdSecAllowEntry) => {
    const you = coversYou.has(keyOf(e))
    if (!(await confirm({
      title: `Remove ${e.value}?`,
      message: `${e.value}${e.comment ? ` (${e.comment})` : ''} will no longer be protected: CrowdSec can ban it again, like any other address.${you ? '\nThis entry covers the address you are connecting from.' : ''}`,
      confirmLabel: 'Remove it',
      danger: true,
    }))) return
    setBusy(`rm:${keyOf(e)}`)
    try {
      const r = await crowdsecDisallow(e.value, member)
      addToast({ type: 'success', message: r.message || `${e.value} is no longer allowlisted` })
      after()
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not remove the entry'), duration: 7000 })
      refresh()
    } finally { setBusy('') }
  }

  // one click for the address you are connecting from: for 30 days where entries can expire (a public address can change hands), otherwise for good
  const allowMe = async () => {
    if (!data || !clientIp) return
    setBusy('me')
    try {
      const r = await crowdsecAllow({ value: clientIp, comment: 'My connection', ...(data.supports_expiry ? { expires: '30d' } : {}) }, member)
      const lifted = r.removed_bans > 0 ? ` · also lifted ${plural(r.removed_bans, 'ban', 'bans')}` : ''
      addToast({ type: 'success', message: `${r.value} ${r.expires_at ? `will not be banned until ${fmtTime(r.expires_at)}` : 'will never be banned'}${lifted}`, duration: 6000 })
      after(r.value)
    } catch (err) {
      addToast({ type: 'error', message: errMsg(err, 'Could not allow your address'), duration: 7000 })
    } finally { setBusy('') }
  }

  const native = data?.mechanism === 'native'
  const connBanned = !!status?.client_banned
  const connLocal = !!clientNet && isPrivateNet(clientNet)
  const strongest = covering[0]
  const canAdd = isAdmin && !!data

  const removeBtn = (e: CrowdSecAllowEntry, phone: boolean) => {
    const k = `rm:${keyOf(e)}`
    return phone
      ? <button type="button" className={`${BTN_ICON_QUIET} !w-auto px-2.5 gap-1.5 text-[11px]`} aria-label={`Remove ${e.value} from the allowlist`} disabled={busy === k} onClick={() => removeOne(e)}>{busy === k ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Remove</button>
      : <button type="button" className={`${BTN_ICON_QUIET} hover:!bg-rose-500/15 hover:!text-rose-300`} aria-label={`Remove ${e.value} from the allowlist`} title="Remove from the allowlist" disabled={busy === k} onClick={() => removeOne(e)}>{busy === k ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
  }
  const lockIcon = (e: CrowdSecAllowEntry) => <span className="h-8 w-8 inline-flex items-center justify-center text-slate-500" title={lockReason(e)} role="img" aria-label={`Cannot be removed here. ${lockReason(e)}`}><Lock size={13} /></span>

  return (
    <div className="space-y-4" data-cs-tab="allowlist">
      {/* what this is, and the difference to unbanning */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0 flex-1 basis-72">
          <h2 className="text-sm font-semibold text-slate-200">Addresses CrowdSec must never ban</h2>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 max-w-2xl">
            <p className="text-xs text-slate-500 leading-relaxed">Allowlisting keeps an address from ever being banned; unbanning only lifts a ban that exists now.</p>
            <button type="button" onClick={() => goTab('bans')} className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 py-1">Lift a ban instead <ArrowRight size={11} /></button>
          </div>
        </div>
        {canAdd && <button type="button" onClick={() => setSheet({})} className={`${BTN_TOOLBAR_OK} w-full sm:w-auto`}><Plus size={14} /> Allow an address</button>}
      </div>

      {poll.error && data && (
        <p className="text-xs text-amber-300 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span className="min-w-0 flex-1 break-words">The last refresh failed ({poll.error.message}). Showing what was loaded before.</span>
          <button type="button" onClick={refresh} className="text-cyan-400 hover:text-cyan-300 shrink-0">Try again</button>
        </p>
      )}

      {!data && !poll.error && (
        <div className="space-y-4" aria-busy="true" aria-label="Loading the allowlist">
          <div className="grid lg:grid-cols-2 gap-4"><SkeletonBlock className="h-40" /><SkeletonBlock className="h-40" /></div>
          <div className="space-y-2">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-12" />)}</div>
        </div>
      )}
      {!data && poll.error && (
        <div className={`${CARD} p-4 flex items-start gap-3`} role="alert">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-rose-300">Could not read the allowlist</p>
            <p className="text-xs text-slate-500 mt-0.5 break-words">{poll.error.message}</p>
          </div>
          <button type="button" onClick={refresh} className={BTN_TOOLBAR_QUIET}>Try again</button>
        </div>
      )}

      {data && (
        <>
          <div className={`grid gap-4 ${member ? '' : 'lg:grid-cols-2'}`}>
            {/* how it is done on this server */}
            <Panel title="How it is done on this server" icon={ShieldCheck}>
              <div className="flex items-center gap-2 flex-wrap">
                <Pill tone="info">{native ? 'CrowdSec allowlist' : 'DCS whitelist'}</Pill>
                {native && data.list_name && <span className="font-mono text-[11px] text-slate-300" title="The name of the list DCS keeps in CrowdSec">{data.list_name}</span>}
                <Pill tone={data.supports_expiry ? 'ok' : 'neutral'} title={data.supports_expiry ? 'An entry can be given an end date and then disappears by itself' : 'CrowdSec is older than 1.6.8: entries stay until they are removed'}>{data.supports_expiry ? 'Entries can expire' : 'Entries never expire'}</Pill>
              </div>
              <p className="text-sm text-slate-300 mt-2.5 leading-snug">{data.note}</p>
              <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
                {native
                  ? 'It is checked before every ban, also the bans you add by hand, so an address on it cannot be banned.'
                  : 'CrowdSec ignores what these addresses do, so it cannot ban them for it. The community blocklist and bans made outside DCS are not filtered by it.'}
              </p>
            </Panel>

            {/* the address you connect from (on a VM this would be the hub, so it is left out) */}
            {!member && (
              <Panel title="Your connection" icon={UserCheck}>
                {!clientIp ? (
                  <p className="text-sm text-slate-300">DCS could not tell which address you are connecting from.</p>
                ) : (
                  <div>
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono text-base text-slate-100 break-all">{clientIp}</span>
                      {connBanned
                        ? <Pill tone="problem">Banned right now</Pill>
                        : strongest
                          ? <Pill tone="ok">Never banned</Pill>
                          : connLocal
                            ? <Pill tone="neutral" title="A private address on your local network">Local network</Pill>
                            : <Pill tone="attention">Can be banned</Pill>}
                    </div>
                    <p className="text-sm text-slate-300 mt-2 leading-snug">
                      {connBanned
                        ? (strongest ? 'This address is on the allowlist, but a ban was added on top of it. Traefik refuses your requests.' : 'Traefik refuses your requests. Allowing this address lifts the ban and keeps it from happening again.')
                        : strongest
                          ? <>Covered by <span className="font-mono text-[13px]">{strongest.value}</span>{strongest.comment ? ` (${strongest.comment})` : ''}{strongest.expires_at ? `, until ${fmtTime(strongest.expires_at)}` : ''}. CrowdSec will not ban you.</>
                          : connLocal
                            ? 'This is a private address on your local network. Traefik trusts local addresses and DCS refuses to ban them, so there is nothing to allow.'
                            : 'This address is not on the allowlist. If CrowdSec takes it for an attacker, Traefik refuses it like any other address.'}
                    </p>
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {isAdmin && !strongest && !connLocal && (
                        <>
                          <button type="button" className={BTN_TOOLBAR_OK} disabled={busy === 'me'} onClick={allowMe} title={data.supports_expiry ? 'Allow this address for 30 days' : 'Allow this address for good'}>
                            {busy === 'me' ? <Loader2 size={13} className="animate-spin" /> : <UserCheck size={13} />} Add my address
                          </button>
                          <button type="button" className="text-xs text-cyan-400 hover:text-cyan-300 h-9 px-1" onClick={() => setSheet({ value: clientIp, comment: 'My connection', expires: data.supports_expiry ? '30d' : undefined })}>Choose how long…</button>
                        </>
                      )}
                      {connBanned && <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => goTab('bans', clientIp)}>Open the ban</button>}
                    </div>
                    {isAdmin && !strongest && !connLocal && <p className={HINT}>{data.supports_expiry ? 'Adds it for 30 days: a public address can change hands. Choose “No expiry” to keep it.' : 'Adds it for good: entries cannot expire on this server.'}</p>}
                    {!isAdmin && !strongest && !connLocal && <p className={HINT}>Ask an admin to allow it if it is yours.</p>}
                  </div>
                )}
              </Panel>
            )}
          </div>

          {/* the entries */}
          <section className="space-y-3" aria-label="The allowlist">
            <SectionHeader icon={ListChecks} title="On the allowlist" count={entries.length} />
            {many && (
              <div className="flex items-center gap-2 flex-wrap">
                <div className="relative w-full sm:w-auto sm:flex-1 sm:min-w-[12rem] sm:max-w-xs">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <label htmlFor="allow-search" className="sr-only">Search the allowlist</label>
                  <input id="allow-search" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, network or note" className={`${INPUT} !h-9 !pl-9 !text-xs`} autoComplete="off" />
                </div>
                <Segmented<'' | Source>
                  value={source} onChange={setSource} ariaLabel="Where an entry comes from"
                  options={[{ value: '', label: 'All' }, ...SOURCE_ORDER.filter((s) => counts[s]).map((s) => ({ value: s, label: s === 'other' ? 'Other lists' : SOURCE[s].label, count: counts[s] }))]}
                />
                {filtered && <button type="button" onClick={clearFilters} className="text-xs text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 h-9"><X size={12} /> Clear</button>}
              </div>
            )}

            {entries.length === 0 && (
              <div className={`${CARD} px-6 py-14 text-center`}>
                <ShieldCheck size={30} className="mx-auto text-slate-500" />
                <p className="mt-3 text-sm text-slate-300">Nothing is on the allowlist yet.</p>
                <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">Add the addresses CrowdSec must never ban: your office, a monitoring service, a friend’s server. Your home address is added by itself once DCS has looked it up.</p>
                {canAdd && <div className="mt-4"><button type="button" onClick={() => setSheet({})} className={BTN_TOOLBAR_OK}><Plus size={14} /> Allow an address</button></div>}
              </div>
            )}

            {entries.length > 0 && shown.length === 0 && (
              <div className={`${CARD} px-6 py-10 text-center`}>
                <Search size={26} className="mx-auto text-slate-500" />
                <p className="mt-3 text-sm text-slate-300">{qNet && !source ? `${qq} is not covered by the allowlist.` : 'No entry matches.'}</p>
                <p className="mt-1 text-xs text-slate-500">{qNet && !source ? 'CrowdSec can ban it like any other address.' : 'Loosen the search, or clear the filters.'}</p>
                <div className="mt-4 flex items-center justify-center gap-2 flex-wrap">
                  <button type="button" onClick={clearFilters} className={BTN_TOOLBAR_QUIET}><X size={13} /> Clear filters</button>
                  {canAdd && qNet && !source && <button type="button" onClick={() => setSheet({ value: q.trim() })} className={BTN_TOOLBAR_OK}><Plus size={14} /> Allow {q.trim().length > 22 ? `${q.trim().slice(0, 20)}…` : q.trim()}</button>}
                </div>
              </div>
            )}

            {shown.length > 0 && (
              <>
                {/* the table (a desktop) */}
                <div className={`${CARD} overflow-hidden hidden lg:block`}>
                  <table className="w-full text-sm table-fixed">
                    <caption className="sr-only">Addresses and networks CrowdSec never bans</caption>
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                        <th scope="col" className="text-left font-semibold px-4 py-2.5">Address or network</th>
                        <th scope="col" className="text-left font-semibold px-3 py-2.5 w-36">Source</th>
                        <th scope="col" className="text-left font-semibold px-3 py-2.5 w-28">Expires</th>
                        <th scope="col" className="text-left font-semibold px-3 py-2.5 w-40">Added</th>
                        {isAdmin && <th scope="col" className="w-16 pr-4"><span className="sr-only">Actions</span></th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/[0.04]">
                      {shown.map((e) => (
                        <tr key={keyOf(e)} className={`hover:bg-white/[0.03] transition-colors ${added === e.value ? 'bg-emerald-500/[0.07]' : ''}`}>
                          <td className="px-4 py-2.5 min-w-0">
                            <div className="flex items-center gap-2 min-w-0 flex-wrap">
                              <span className="font-mono text-[13px] text-slate-100 break-all">{e.value}</span>
                              <KindChip e={e} />
                              {coversYou.has(keyOf(e)) && <Pill tone="ok" title="Your connection is covered by this entry">covers you</Pill>}
                            </div>
                            {e.comment && <p className="text-[11px] text-slate-500 truncate mt-0.5" title={e.comment}>{e.comment}</p>}
                          </td>
                          <td className="px-3 py-2.5"><SourceChip e={e} /></td>
                          <td className="px-3 py-2.5 whitespace-nowrap"><Countdown at={e.expires_at} /></td>
                          <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-500">{addedText(e)}</td>
                          {isAdmin && <td className="pr-4 py-2.5"><div className="flex items-center justify-end">{e.removable ? removeBtn(e, false) : lockIcon(e)}</div></td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* cards (a phone) */}
                <div className="lg:hidden space-y-2">
                  {shown.map((e) => (
                    <div key={keyOf(e)} className={`${CARD} p-3.5 transition-colors ${added === e.value ? '!border-emerald-500/30 !bg-emerald-500/[0.07]' : ''}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono text-sm text-slate-100 break-all">{e.value}</span>
                            <KindChip e={e} />
                          </div>
                          {e.comment && <p className="text-xs text-slate-300 mt-1 break-words">{e.comment}</p>}
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0"><Countdown at={e.expires_at} /><span className="text-[10px] text-slate-500">expires</span></div>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5">
                        <div className="flex items-center gap-2 min-w-0 flex-wrap">
                          <SourceChip e={e} />
                          {coversYou.has(keyOf(e)) && <Pill tone="ok">covers you</Pill>}
                          {e.created_at && <span className="text-[10px] text-slate-500">{addedText(e, true)}</span>}
                        </div>
                        {isAdmin && e.removable && removeBtn(e, true)}
                      </div>
                      {!e.removable && <p className="text-[11px] text-slate-500 mt-2 flex items-start gap-1.5 leading-relaxed"><Lock size={11} className="shrink-0 mt-0.5" /> {lockReason(e)}</p>}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-500 px-1 tabular-nums">{filtered ? `${shown.length} of ${entries.length} entries match` : plural(entries.length, 'entry', 'entries')}</p>
              </>
            )}
          </section>

          {/* the allowlists CrowdSec holds */}
          {native && data.lists.length > 0 && (
            <section className={`${CARD} p-4`} aria-label="Allowlists in CrowdSec">
              <SectionHeader icon={ListChecks} title="Allowlists in CrowdSec" count={data.lists.length} />
              <ul className="divide-y divide-white/5 mt-2">
                {data.lists.map((l) => (
                  <li key={l.name} className="py-2.5 first:pt-1 last:pb-0 flex items-center gap-x-3 gap-y-1 flex-wrap text-xs">
                    <span className="font-mono text-slate-200">{l.name}</span>
                    {l.name === data.list_name ? <Pill tone="info" title="The list DCS keeps: entries added on this page go here">managed here</Pill> : <Pill tone="neutral" title="Created outside DCS: CrowdSec honours it, DCS only shows its entries">not managed by DCS</Pill>}
                    <span className="text-slate-500 min-w-0 flex-1 basis-40 break-words">{l.description || 'No description'}</span>
                    <span className="tabular-nums text-slate-300">{plural(l.items, 'entry', 'entries')}</span>
                    {l.updated_at && <span className="text-slate-500">updated {fmtAgo(l.updated_at)}</span>}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}

      {sheet && data && <AllowSheet data={data} seed={sheet} onClose={() => setSheet(null)} onDone={(r) => after(r.value)} />}
    </div>
  )
}
