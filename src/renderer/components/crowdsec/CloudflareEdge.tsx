// =============================================================================
// Push bans to Cloudflare — the Bouncers tab's switch beside Traefik enforcement.
//   the switch          on: a sheet that says what DCS makes at Cloudflare (the
//                       list, one blocking rule per zone, a bouncer in CrowdSec),
//                       takes the token (checked before anything is made) and the
//                       capacity; off: a sheet that asks whether the list and the
//                       rule go too
//   the status          health in one sentence, then the checklist: Cloudflare's
//                       list, the zones, the bouncer, the last sync, what was left
//                       out, what was repaired
//   the leftovers       off without the clean-up: the list and the rule are still
//                       at Cloudflare, frozen; one button removes them
// The server does the work (POST /crowdsec/cloudflare/…); see docs/CROWDSEC.md
// "Push bans to Cloudflare" for why it is a list and a WAF rule, not a Worker.
// =============================================================================

import { useEffect, useState } from 'react'
import { Check, Cloud, CloudOff, KeyRound, Loader2, RefreshCw, Settings2, ShieldCheck, Trash2 } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecCloudflare, crowdsecCloudflareDisable, crowdsecCloudflareEnable, crowdsecCloudflareSettings, crowdsecCloudflareSync, crowdsecCloudflareVerify } from '../../api/endpoints'
import type { CloudflareBouncerRefusal, CloudflareBouncerStatus, CloudflareBouncerVerifyResponse, CloudflarePermission } from '../../../shared/types'
import { Ago, errData, errMsg, useCs, useNow } from './kit'
import { BTN_SHEET_DANGER, BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { CHOICE, CHOICE_OFF, CHOICE_ON, HINT, INPUT, LABEL } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import { TONE_TILE, type Tone } from '../../lib/tone'
import { Pill } from '../common/Pill'
import { Toggle, ToggleRow } from '../common/Toggle'
import SectionHeader from '../common/SectionHeader'
import { SkeletonBlock } from '../common/PageState'
import Sheet from '../common/Sheet'
import StatusLine from '../common/StatusLine'
import Notice from '../common/Notice'

/** the rights the token needs, for a server that does not list them */
const RIGHTS: CloudflarePermission[] = [
  { group: 'Account', item: 'Account Filter Lists', level: 'Edit', why: 'keeps the list of banned addresses' },
  { group: 'Zone', item: 'Zone WAF', level: 'Edit', why: 'adds the custom rule that blocks the list' },
  { group: 'Zone', item: 'Zone', level: 'Read', why: 'finds the zones of your domains' },
]
const TOKEN_RE = /^[A-Za-z0-9_-]{30,200}$/
const iso = (epoch: number | null | undefined) => (epoch ? new Date(epoch * 1000).toISOString() : null)
/** whole numbers, never abbreviated: the free plan's limit is 10,000, not 10.0k */
const whole = (n: number) => n.toLocaleString('en-US')
const plural = (n: number, one: string, many = `${one}s`) => `${whole(n)} ${n === 1 ? one : many}`

/** a capacity typed in a field: 1 to 500,000 addresses */
function capacityOk(text: string): boolean {
  const n = Number(text)
  return /^\d{1,6}$/.test(text.trim()) && n >= 1 && n <= 500000
}

function CapacityField({ id, value, onChange, autoFocus = false }: { id: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  const bad = !capacityOk(value)
  return (
    <div>
      <label className={LABEL} htmlFor={id}>Capacity</label>
      <input id={id} inputMode="numeric" autoFocus={autoFocus} className={`${INPUT} sm:max-w-[12rem] ${bad ? '!border-rose-500/40' : ''}`} value={value}
        onChange={(e) => onChange(e.target.value)} aria-invalid={bad} aria-describedby={`${id}-hint`} />
      <p id={`${id}-hint`} className={`${HINT} ${bad ? '!text-rose-300' : ''}`}>{bad ? 'A number from 1 to 500,000.' : 'At most this many addresses on the list, the newest bans first. The free plan holds 10,000 over all lists.'}</p>
    </div>
  )
}

function Rights({ list, missing }: { list: CloudflarePermission[]; missing?: CloudflarePermission[] }) {
  const lacks = (p: CloudflarePermission) => !!missing?.some((m) => m.item === p.item && m.group === p.group)
  return (
    <ul className="space-y-1.5" aria-label="The token's rights">
      {list.map((p) => (
        <li key={`${p.group}/${p.item}`} className="flex items-start gap-2 text-xs leading-relaxed">
          <Pill tone={lacks(p) ? 'problem' : 'neutral'} size="xs">{lacks(p) ? 'missing' : p.level}</Pill>
          <span className="min-w-0 text-slate-300">
            <span className="font-medium text-slate-200">{p.group} → {p.item} → {p.level}</span>
            <span className="text-slate-500"> · {p.why}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Turning it on: what will be made, the token, the capacity
// ---------------------------------------------------------------------------

function EnableSheet({ st, onClose, onDone }: { st: CloudflareBouncerStatus; onClose: () => void; onDone: () => void }) {
  const { member } = useCs()
  const { addToast } = useToast()
  const [token, setToken] = useState('')
  const [capacity, setCapacity] = useState(String(st.settings.capacity))
  // the community blocklist is a choice made here, never carried over: unticked every time the sheet opens
  const [community, setCommunity] = useState(false)
  const [busy, setBusy] = useState<'' | 'verify' | 'enable'>('')
  const [refusal, setRefusal] = useState<CloudflareBouncerRefusal | null>(null)
  const [checked, setChecked] = useState<CloudflareBouncerVerifyResponse | null>(null)

  const t = token.trim()
  const tokenBad = !!t && !TOKEN_RE.test(t)
  const needToken = !st.token.set
  const cap = Number(capacity)
  const capBad = !capacityOk(capacity)
  const canGo = !busy && !tokenBad && !capBad && (!needToken || !!t)
  const domains = st.settings.domains
  const rights = st.permissions?.length ? st.permissions : RIGHTS
  const close = () => { if (!busy) onClose() }

  const fail = (e: unknown, fallback: string) => {
    const d = errData(e) as CloudflareBouncerRefusal
    setRefusal({ reason: d.reason, message: d.message || errMsg(e, fallback), missing: Array.isArray(d.missing) ? d.missing : [] })
  }
  const verify = async () => {
    setBusy('verify'); setRefusal(null); setChecked(null)
    try { setChecked(await crowdsecCloudflareVerify(t || undefined, member)) } catch (e) { fail(e, 'The token could not be checked') } finally { setBusy('') }
  }
  const enable = async () => {
    if (!canGo) return
    setBusy('enable'); setRefusal(null)
    try {
      const r = await crowdsecCloudflareEnable({ ...(t ? { token: t } : {}), capacity: cap, community }, member)
      // the answer comes before the first sync: the panel says "Turning on" from the status until it is done
      addToast({ type: 'success', message: r.message, duration: 7000 })
      onDone(); onClose()
    } catch (e) { fail(e, 'Push bans to Cloudflare was not turned on') } finally { setBusy('') }
  }

  return (
    <Sheet
      title="Push bans to Cloudflare" subtitle="Cloudflare refuses the addresses CrowdSec bans, before they reach this server." icon={<Cloud size={18} />} tone="info" onClose={close} wide
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={close} disabled={!!busy} className={BTN_SHEET_QUIET}>Cancel</button>
          <button type="button" onClick={verify} disabled={!!busy || tokenBad || (needToken && !t)} className={BTN_SHEET_QUIET}>
            {busy === 'verify' ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />} Check the token
          </button>
          <button type="button" onClick={enable} disabled={!canGo} className={BTN_SHEET_PRIMARY}>
            {busy === 'enable' ? <Loader2 size={16} className="animate-spin" /> : <Cloud size={16} />} {busy === 'enable' ? 'Turning on…' : 'Turn on'}
          </button>
        </div>
      }
    >
      <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void enable() }}>
        <div>
          <p className={LABEL}>What DCS makes at Cloudflare</p>
          <ul className="space-y-2 text-sm text-slate-300 leading-relaxed">
            <li className="flex gap-2"><ShieldCheck size={16} className="shrink-0 mt-0.5 text-cyan-400" aria-hidden />
              <span>An IP list, <span className="font-mono text-slate-200">{st.cloudflare.list}</span>, in your Cloudflare account: CrowdSec’s bans, the newest first, at most {plural(capBad ? st.settings.capacity : cap, 'address', 'addresses')}.</span></li>
            <li className="flex gap-2"><ShieldCheck size={16} className="shrink-0 mt-0.5 text-cyan-400" aria-hidden />
              <span>A WAF custom rule in the zone of {domains.length ? domains.map((d, i) => <span key={d}>{i ? ', ' : ''}<span className="font-mono text-slate-200">{d}</span></span>) : 'each of your domains'} that blocks every address on the list (action Block, the zone’s first custom rule).</span></li>
            <li className="flex gap-2"><ShieldCheck size={16} className="shrink-0 mt-0.5 text-cyan-400" aria-hidden />
              <span>In CrowdSec, the bouncer <span className="font-mono text-slate-200">{st.bouncer.name}</span>. Every {st.settings.interval} s DCS keeps the list in step with the bans; Traefik’s bouncer stays as it is.</span></li>
          </ul>
          <p className={HINT}>Nothing else at Cloudflare is touched. Turning it off removes what DCS made, if you ask it to. On the free plan this is the account’s one custom list (10,000 addresses) and one of the zone’s five custom rules; it uses no Worker and no request quota.</p>
        </div>

        <div>
          {st.token.set && (
            <div className="mb-3">
              <Notice tone="ok" role="status" title={st.token.source === 'env' ? `Using ${st.token.setting} from the server’s .env` : `Using the secret ${st.token.setting}`}>
                {st.token.source === 'env' ? 'Leave the field empty to use it, or paste a different token below.' : 'Kept on the Secrets page. Leave the field empty to use it, or paste a different token below: it replaces the secret.'}
              </Notice>
            </div>
          )}
          <label className={LABEL} htmlFor="cf-token">{st.token.set ? 'A different token (optional)' : 'Cloudflare API token'}</label>
          <input
            id="cf-token" type="password" autoComplete="off" spellCheck={false} autoFocus className={`${INPUT} font-mono ${tokenBad ? '!border-rose-500/40' : ''}`}
            value={token} onChange={(e) => { setToken(e.target.value); setRefusal(null); setChecked(null) }}
            placeholder={st.token.set ? 'Leave empty to use the stored token' : 'Paste the token'} aria-invalid={tokenBad} aria-describedby="cf-token-hint"
          />
          <p id="cf-token-hint" className={`${HINT} ${tokenBad ? '!text-rose-300' : ''}`}>
            {tokenBad ? 'That is not an API token: paste the token itself (about 40 letters, digits, - and _), not the Global API Key.'
              : 'A token of its own, not the DNS token. Make it at dash.cloudflare.com → My Profile → API Tokens → Create Token → Custom token, with these rights and your zones. It is kept as the secret CLOUDFLARE_BOUNCER_TOKEN (encrypted, on the Secrets page) and never shown again.'}
          </p>
          <div className="mt-3"><Rights list={rights} missing={refusal?.missing} /></div>
        </div>

        <div className="space-y-4">
          <CapacityField id="cf-capacity" value={capacity} onChange={setCapacity} />
          <ToggleRow id="cf-community" label="Also push the community blocklist (fills the list up to the capacity; slower)" checked={community} onChange={setCommunity} def="off"
            help="Tens of thousands of addresses other CrowdSec users caught. Your own bans always come first; these fill what is left of the capacity." />
        </div>

        {checked && (
          <Notice tone="ok" role="status" title="The token works">
            {checked.zones.map((z) => z.name).join(', ')}{checked.warnings?.length ? `. ${checked.warnings.join(' ')}` : ''}
          </Notice>
        )}
        {refusal && (
          <Notice tone="problem" role="alert" title={refusal.reason === 'missing_permissions' ? 'The token lacks a right' : 'Not turned on'}>
            <span className="break-words">{refusal.message}</span>
          </Notice>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Turning it off: what happens to the list and the rule
// ---------------------------------------------------------------------------

function DisableSheet({ st, onClose, onDone }: { st: CloudflareBouncerStatus; onClose: () => void; onDone: () => void }) {
  const { member } = useCs()
  const { addToast } = useToast()
  const [cleanup, setCleanup] = useState(true)
  const [forget, setForget] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const zones = st.cloudflare.zones.map((z) => z.name)
  const n = st.cloudflare.items ?? st.sync.items
  const go = async () => {
    setBusy(true); setError('')
    try {
      const r = await crowdsecCloudflareDisable({ cleanup, forget_token: forget }, member)
      addToast({ type: r.success ? 'success' : 'warning', message: r.message, duration: r.success ? 7000 : 12000 })
      onDone(); onClose()
    } catch (e) { setError(errMsg(e, 'Push bans to Cloudflare was not turned off')) } finally { setBusy(false) }
  }
  const option = (value: boolean, title: string, text: string) => (
    <button type="button" role="radio" aria-checked={cleanup === value} onClick={() => setCleanup(value)}
      className={`${CHOICE} ${cleanup === value ? CHOICE_ON : CHOICE_OFF} w-full !justify-start text-left !items-start !h-auto py-3`}>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-slate-400 mt-0.5 font-normal leading-relaxed">{text}</span>
      </span>
    </button>
  )
  return (
    <Sheet
      title="Turn off Push bans to Cloudflare?" subtitle="The sync stops at once and the bouncer is deleted in CrowdSec. Traefik keeps blocking banned addresses." icon={<CloudOff size={18} />} tone="attention" onClose={() => { if (!busy) onClose() }}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_SHEET_QUIET} autoFocus>Cancel</button>
          <button type="button" onClick={go} disabled={busy} className={BTN_SHEET_DANGER}>{busy ? <Loader2 size={16} className="animate-spin" /> : <CloudOff size={16} />} Turn off</button>
        </div>
      }
    >
      <div className="space-y-4">
        <div role="radiogroup" aria-label="What happens at Cloudflare" className="space-y-2">
          {option(true, 'Remove the list and the rule from Cloudflare (recommended)', `DCS deletes its custom rule${zones.length ? ` in ${zones.join(', ')}` : ''} and the list ${st.cloudflare.list}. Your own lists and rules are not touched.`)}
          {option(false, 'Leave them at Cloudflare', `They stay as they are, frozen with the last ${plural(n, 'address', 'addresses')}, which then never expire at Cloudflare. You can remove them from this tab later.`)}
        </div>
        <ToggleRow id="cf-forget" label="Forget the token" checked={forget} onChange={setForget} def="off" help="Deletes the stored token. Keep it to turn this on again with one click." />
        {error && <Notice tone="problem" role="alert">{error}</Notice>}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The settings while it is on: capacity and the community blocklist
// ---------------------------------------------------------------------------

function SettingsSheet({ st, onClose, onDone }: { st: CloudflareBouncerStatus; onClose: () => void; onDone: () => void }) {
  const { member } = useCs()
  const { addToast } = useToast()
  const [capacity, setCapacity] = useState(String(st.settings.capacity))
  const [community, setCommunity] = useState(st.settings.community)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const cap = Number(capacity)
  const capBad = !capacityOk(capacity)
  const save = async () => {
    if (capBad || busy) return
    setBusy(true); setError('')
    try {
      const r = await crowdsecCloudflareSettings({ capacity: cap, community }, member)
      addToast({ type: r.error ? 'warning' : 'success', message: r.error ? r.error.message : `Saved: ${plural(r.sync.items, 'address', 'addresses')} on Cloudflare’s list`, duration: 7000 })
      onDone(); onClose()
    } catch (e) { setError(errMsg(e, 'The settings were not saved')) } finally { setBusy(false) }
  }
  return (
    <Sheet title="What goes to Cloudflare" icon={<Settings2 size={18} />} tone="info" onClose={() => { if (!busy) onClose() }}
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className={BTN_SHEET_QUIET}>Cancel</button>
          <button type="button" onClick={save} disabled={busy || capBad} className={BTN_SHEET_PRIMARY}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />} Save and apply</button>
        </div>
      }
    >
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <CapacityField id="cf-capacity-set" value={capacity} onChange={setCapacity} autoFocus />
        <ToggleRow id="cf-community-set" label="Also push the community blocklist (fills the list up to the capacity; slower)" checked={community} onChange={setCommunity} def="off"
          help="Your own bans always come first; these fill what is left of the capacity." />
        {error && <Notice tone="problem" role="alert">{error}</Notice>}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The section
// ---------------------------------------------------------------------------

/** the tone of the "Last sync" line for each health */
const SYNC_TONE: Record<CloudflareBouncerStatus['health'], Tone> = { off: 'neutral', starting: 'info', ok: 'ok', stale: 'attention', error: 'problem' }

const HEAD: Record<CloudflareBouncerStatus['health'], { tone: Tone; title: string }> = {
  off: { tone: 'neutral', title: 'Off: banned addresses still reach Traefik through Cloudflare' },
  starting: { tone: 'info', title: 'Turning on: the first sync is on its way' },
  ok: { tone: 'ok', title: 'Cloudflare refuses your bans at its edge' },
  stale: { tone: 'attention', title: 'The bans at Cloudflare are not up to date' },
  error: { tone: 'problem', title: 'Cloudflare is not getting the bans' },
}

export default function CloudflareEdge({ onChanged }: { onChanged?: () => void }) {
  const { member, isAdmin, refreshStatus } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const now = useNow()
  // every 3 s while a sync works (the first one after turning on), every 15 s otherwise
  const [fast, setFast] = useState(false)
  const poll = usePolling<CloudflareBouncerStatus>(() => crowdsecCloudflare(member), fast ? 3000 : 15000)
  useEffect(() => { setFast(!!poll.data && poll.data.enabled && (poll.data.health === 'starting' || !!poll.data.sync.running)) }, [poll.data])
  const [sheet, setSheet] = useState<'' | 'on' | 'off' | 'settings'>('')
  const [busy, setBusy] = useState('')
  const st = poll.data
  const after = () => { poll.refresh(); refreshStatus(); onChanged?.() }

  if (!st && poll.error) {
    // an older server has no such route: nothing to show
    if (/404|not found/i.test(poll.error.message)) return null
    return <Notice tone="problem" role="alert" title="Could not read Push bans to Cloudflare" action={<button type="button" onClick={poll.refresh} className={BTN_TOOLBAR_QUIET}>Try again</button>}>{poll.error.message}</Notice>
  }
  if (!st) return <SkeletonBlock className="h-40" />

  const on = st.enabled
  const head = HEAD[st.health] ?? HEAD.off
  const zones = st.cloudflare.zones
  const cfItems = st.cloudflare.items
  let text: string
  if (!on) text = 'Cloudflare forwards a scanner CrowdSec banned, and Traefik answers it 403: one more request at your server, one more detection for CrowdSec. Turn this on to have Cloudflare refuse banned addresses at its edge.'
  else if (st.health === 'error' && st.error) text = st.error.message
  else if (st.health === 'stale') text = `${st.sync.last_sync ? 'The last good sync with Cloudflare was more than 10 minutes ago.' : 'No sync with Cloudflare has succeeded yet.'} Cloudflare keeps refusing the addresses it holds; new bans reach it once the sync works again.`
  else if (st.health === 'starting') text = st.sync.running ? `DCS is working through ${plural(st.sync.running.rows, 'address', 'addresses')} and pushing them to Cloudflare. This takes a few seconds.` : 'DCS is pushing the bans to Cloudflare. This takes a few seconds.'
  else text = `${plural(cfItems ?? st.sync.items, 'address', 'addresses')} on Cloudflare’s list, blocked in ${zones.map((z) => z.name).join(', ') || 'your zones'} before they reach this server.`

  const sync = async () => {
    setBusy('sync')
    try {
      const r = await crowdsecCloudflareSync(member)
      addToast({ type: r.error ? 'warning' : 'success', message: r.error ? r.error.message : `In step: ${plural(r.cloudflare.items ?? r.sync.items, 'address', 'addresses')} on Cloudflare’s list`, duration: 7000 })
      after()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'The sync did not run'), duration: 8000 }) } finally { setBusy('') }
  }
  const removeLeftovers = async () => {
    if (!(await confirm({
      title: 'Remove the list and the rule from Cloudflare?',
      message: `DCS deletes its custom rule${zones.length ? ` in ${zones.map((z) => z.name).join(', ')}` : ''} and the list ${st.cloudflare.list}. Your own lists and rules are not touched.`,
      confirmLabel: 'Remove them', danger: true,
    }))) return
    setBusy('cleanup')
    try {
      const r = await crowdsecCloudflareDisable({ cleanup: true }, member)
      addToast({ type: r.success ? 'success' : 'warning', message: r.message, duration: 9000 })
      after()
    } catch (e) { addToast({ type: 'error', message: errMsg(e, 'Nothing was removed'), duration: 8000 }) } finally { setBusy('') }
  }

  const repairedRecently = st.sync.repaired && now / 1000 - st.sync.repaired.at < 86400
  let bouncerTone: Tone = 'neutral'
  if (st.bouncer.registered) bouncerTone = 'ok'
  else if (st.bouncer.crowdsec_running) bouncerTone = 'attention'
  return (
    <section className={`${CARD} p-4`} aria-label="Push bans to Cloudflare">
      <SectionHeader icon={Cloud} title="Push bans to Cloudflare" className="mb-3"
        right={<Toggle checked={on} onChange={(v) => setSheet(v ? 'on' : 'off')} disabled={!isAdmin || !!busy} label="Push bans to Cloudflare" />} />
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl shrink-0 ${TONE_TILE[head.tone]}`} aria-hidden="true">{on ? <Cloud size={18} /> : <CloudOff size={18} />}</div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-100 leading-snug">{head.title}</h3>
          <p className="text-sm text-slate-300 mt-0.5 leading-relaxed max-w-3xl break-words">{text}</p>
        </div>
        {isAdmin && on && (
          <div className="hidden md:flex shrink-0 gap-2">
            <button type="button" onClick={sync} disabled={!!busy} className={BTN_TOOLBAR_QUIET}>{busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now</button>
            <button type="button" onClick={() => setSheet('settings')} disabled={!!busy} className={BTN_TOOLBAR_QUIET}><Settings2 size={14} /> Settings</button>
          </div>
        )}
      </div>
      {isAdmin && on && (
        <div className="md:hidden mt-3 grid grid-cols-2 gap-2">
          <button type="button" onClick={sync} disabled={!!busy} className={BTN_TOOLBAR_QUIET}>{busy === 'sync' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Sync now</button>
          <button type="button" onClick={() => setSheet('settings')} disabled={!!busy} className={BTN_TOOLBAR_QUIET}><Settings2 size={14} /> Settings</button>
        </div>
      )}

      {!on && st.left_at_cloudflare && (
        <div className="mt-4">
          <Notice tone="attention" title="The list and the rule are still at Cloudflare"
            action={isAdmin ? <button type="button" onClick={removeLeftovers} disabled={!!busy} className={BTN_TOOLBAR_QUIET}>{busy === 'cleanup' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} Remove them from Cloudflare</button> : undefined}>
            Turned off without the clean-up: Cloudflare keeps refusing the last {plural(st.sync.items, 'address', 'addresses')}, which no longer change or expire.
          </Notice>
        </div>
      )}

      {on && (
        <ul className="mt-4 pt-4 border-t border-white/5 divide-y divide-white/5" aria-label="What is checked">
          <StatusLine as="li" tone={cfItems === null ? 'neutral' : 'ok'} title="Cloudflare’s list">
            {cfItems === null ? <>Not read back yet: <span className="font-mono text-slate-300">{st.cloudflare.list}</span></>
              : <>{plural(cfItems, 'address', 'addresses')} on <span className="font-mono text-slate-300">{st.cloudflare.list}</span>{st.cloudflare.checked_at ? <> · checked <Ago at={iso(st.cloudflare.checked_at)} /></> : null}</>}
          </StatusLine>
          <StatusLine as="li" tone={zones.length ? 'ok' : 'attention'} title="Blocked in">
            {zones.length ? (
              <span className="inline-flex flex-wrap items-center gap-1.5">
                {zones.map((z) => <span key={z.id} className="inline-flex items-center gap-1"><span className="font-mono text-slate-300">{z.name}</span>{z.plan ? <Pill tone="neutral" size="xs">{z.plan}</Pill> : null}</span>)}
                <span className="text-slate-500">· the first custom rule of each zone blocks the list</span>
              </span>
            ) : 'No zone yet'}
          </StatusLine>
          <StatusLine as="li" tone={bouncerTone} title="Bouncer in CrowdSec">
            <span className="font-mono text-slate-300">{st.bouncer.name}</span>
            {st.bouncer.registered ? <> · {st.bouncer.last_pull ? <>last pull <Ago at={st.bouncer.last_pull} /></> : 'has not pulled yet'}</> : st.bouncer.crowdsec_running ? ' · not registered: the next sync registers it again' : ' · CrowdSec is not running'}
          </StatusLine>
          <StatusLine as="li" tone={SYNC_TONE[st.health] ?? 'problem'} title="Last sync">
            {st.sync.running ? <>Working through {plural(st.sync.running.rows, 'address', 'addresses')} now{st.sync.last_sync ? <> · last in step <Ago at={iso(st.sync.last_sync)} /></> : null}</>
              : st.sync.last_sync ? <>In step <Ago at={iso(st.sync.last_sync)} />{st.sync.last_push ? <> · list changed <Ago at={iso(st.sync.last_push)} /></> : null}</> : 'Not yet'}
          </StatusLine>
          <StatusLine as="li" tone={st.sync.dropped ? 'attention' : 'neutral'} title="What goes to Cloudflare">
            {st.settings.community ? 'Your own bans, then the community blocklist' : 'Your own bans (CrowdSec’s detections, this page, imports, the console)'}, the newest first, at most {whole(st.settings.capacity)}
            {st.sync.dropped ? <> · <span className="text-amber-300">{plural(st.sync.dropped, 'address', 'addresses')} left out over the capacity</span></> : null}
            {st.sync.skipped ? <> · {plural(st.sync.skipped, 'address', 'addresses')} never pushed (private, this server, your home or the allowlist)</> : null}
          </StatusLine>
          {repairedRecently && st.sync.repaired && (
            <StatusLine as="li" tone="info" title="Repaired">
              {st.sync.repaired.what.join(', ')} · <Ago at={iso(st.sync.repaired.at)} />
            </StatusLine>
          )}
        </ul>
      )}
      {!isAdmin && <p className="text-xs text-slate-500 leading-relaxed mt-4">An administrator can turn this on or off.</p>}

      {sheet === 'on' && <EnableSheet st={st} onClose={() => setSheet('')} onDone={after} />}
      {sheet === 'off' && <DisableSheet st={st} onClose={() => setSheet('')} onDone={after} />}
      {sheet === 'settings' && <SettingsSheet st={st} onClose={() => setSheet('')} onDone={after} />}
    </section>
  )
}
