// =============================================================================
// Bouncers: what enforces the bans, and who reports to CrowdSec.
//   Traefik enforcement   a checklist (Traefik, the DCS bouncer, its middleware file,
//                         the chain, the last pull) and the one button that repairs it
//   Bouncers              the programs that ask CrowdSec for the ban list; add one (its
//                         key is shown once) or delete one
//   Machines              the engines that read logs and report to this CrowdSec
//   Community and console the blocklist, the sharing and the console; register the
//                         engine again when the community refuses it, enrol it in the console
// ============================================================================

import { useState } from 'react'
import { CheckNowButton, EnrolBox, PAUSED_TEXT, enrolRequested, REFUSED_TEXT, RegisterAgainButton, capiState, lastContact } from './CommunityActions'
import { AlertTriangle, Check, CircleAlert, CircleCheck, Clock, Copy, Info, KeyRound, Loader2, Plug, Plus, RefreshCw, Server, ShieldCheck, Trash2, Users } from 'lucide-react'
import { usePolling, type UsePollingResult } from '../../hooks/usePolling'
import { useConnectionStore } from '../../stores/connectionStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecAddBouncer, crowdsecBouncers, crowdsecCommunity, crowdsecDeleteBouncer, crowdsecMachines, crowdsecRegisterTraefikBouncer } from '../../api/endpoints'
import type { CrowdSecBouncerRow, CrowdSecBouncersResponse, CrowdSecCommunityResponse, CrowdSecMachine, CrowdSecMachinesResponse } from '../../../shared/types'
import { BTN_PRIMARY, BTN_QUIET, CARD, Chip, CsSheet, HINT, ICON_BTN, INPUT, LABEL, SectionHead, Skel, errMsg, fmtAgo, fmtNum, fmtTime, useCs, useNow, type Tone } from './kit'

/** the API's rule for a bouncer name: 2 to 63 characters, letters, digits, dots, dashes and underscores, starting with a letter or a digit */
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/
function nameProblem(n: string): string {
  if (!n) return ''
  if (/\s/.test(n)) return 'No spaces: use a dash or an underscore instead.'
  if (n.length < 2) return 'At least 2 characters.'
  if (n.length > 63) return 'At most 63 characters.'
  if (!/^[A-Za-z0-9]/.test(n)) return 'Start with a letter or a digit.'
  if (!/^[A-Za-z0-9._-]+$/.test(n)) return 'Only letters, digits, dots, dashes and underscores.'
  return ''
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

// ---------------------------------------------------------------------------
// The small pieces
// ---------------------------------------------------------------------------

function Ago({ at }: { at: string | null | undefined }) {
  const now = useNow()
  return <span title={at ? fmtTime(at) : undefined}>{fmtAgo(at, now)}</span>
}

function Notice({ tone = 'warn', children }: { tone?: 'warn' | 'bad'; children: React.ReactNode }) {
  return (
    <p className={`text-xs flex items-start gap-2 rounded-lg px-3 py-2 ${tone === 'bad' ? 'text-rose-300 bg-rose-500/10 border border-rose-500/20' : 'text-amber-300 bg-amber-500/10 border border-amber-500/20'}`} role="status">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span className="min-w-0 flex-1 break-words">{children}</span>
    </p>
  )
}

function LoadError({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div className={`${CARD} p-4 flex items-start gap-3`} role="alert">
      <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-rose-300">Could not read {what}</p>
        <p className="text-xs text-slate-500 mt-0.5 break-words">{error.message}</p>
      </div>
      <button type="button" onClick={onRetry} className={BTN_QUIET}>Try again</button>
    </div>
  )
}

const TONE_TEXT: Record<Tone, string> = { good: 'text-emerald-400', warn: 'text-amber-400', bad: 'text-rose-400', info: 'text-cyan-400', mute: 'text-slate-500' }

/** one line of a checklist: a symbol in the tone of the answer, what is checked, what was found */
function CheckRow({ tone, label, children }: { tone: Tone; label: string; children: React.ReactNode }) {
  const Icon = tone === 'good' ? CircleCheck : tone === 'mute' || tone === 'info' ? Info : CircleAlert
  return (
    <li className="flex items-start gap-3 py-2.5 first:pt-0 last:pb-0">
      <Icon size={16} className={`${TONE_TEXT[tone]} shrink-0 mt-0.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1 sm:flex sm:items-baseline sm:gap-4">
        <p className="text-sm text-slate-200 sm:w-44 sm:shrink-0">{label}</p>
        <p className="text-xs text-slate-300 min-w-0 break-words mt-0.5 sm:mt-0 leading-relaxed">{children}</p>
      </div>
    </li>
  )
}

/** a status row of the community card: a symbol, a headline, a line of explanation, an optional action */
function StatusRow({ tone, title, children, action, icon }: { tone: Tone; title: string; children?: React.ReactNode; action?: React.ReactNode; icon?: React.ElementType }) {
  const Icon = icon ?? (tone === 'good' ? CircleCheck : tone === 'mute' || tone === 'info' ? Info : CircleAlert)
  return (
    <div className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <Icon size={16} className={`${TONE_TEXT[tone]} shrink-0 mt-0.5`} aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 leading-snug">{title}</p>
        {children && <div className="text-xs text-slate-300 mt-0.5 leading-relaxed">{children}</div>}
        {action && <div className="mt-2">{action}</div>}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// A bouncer's state in words
// ---------------------------------------------------------------------------

type BStatus = 'active' | 'idle' | 'never' | 'revoked'
const B_STATUS: Record<BStatus, { label: string; tone: Tone; tip: string }> = {
  active: { label: 'Active', tone: 'good', tip: 'It asked CrowdSec for the ban list in the last 15 minutes.' },
  idle: { label: 'Idle', tone: 'warn', tip: 'It pulled the ban list before, but not in the last 15 minutes. It may be stopped.' },
  never: { label: 'Never pulled', tone: 'mute', tip: 'It has never asked for the ban list. It may not be set up yet.' },
  revoked: { label: 'Revoked', tone: 'bad', tip: 'Its key was revoked, so it can no longer read the ban list.' },
}
function statusOf(b: CrowdSecBouncerRow, now: number): BStatus {
  if (b.status && b.status in B_STATUS) return b.status
  if (b.revoked) return 'revoked'
  if (!b.last_pull) return 'never'
  return now - Date.parse(b.last_pull) < 900_000 ? 'active' : 'idle'
}

function StatusChip({ b }: { b: CrowdSecBouncerRow }) {
  const now = useNow()
  const st = statusOf(b, now)
  const s = B_STATUS[st]
  // the bouncer DCS made for Traefik that never pulled is a problem once Traefik had time to load it; any other one may simply not be set up yet
  const waiting = st === 'never' && !!b.dcs && now - Date.parse(b.created_at) < 180_000
  const tone: Tone = st === 'never' && b.dcs ? (waiting ? 'info' : 'warn') : s.tone
  return <Chip tone={tone} title={waiting ? 'Registered a moment ago: Traefik asks for the ban list a few seconds after it loads the new middleware.' : s.tip}>{s.label}</Chip>
}

function BouncerName({ b }: { b: CrowdSecBouncerRow }) {
  return (
    <div className="flex items-center gap-2 flex-wrap min-w-0">
      <span className="font-mono text-[13px] text-slate-100 break-all">{b.name}</span>
      {b.dcs && <Chip tone="info" title="The bouncer DCS registered for Traefik. Traefik uses its key to ask CrowdSec for the ban list.">Traefik bouncer made by DCS</Chip>}
      {b.auto_created && <Chip tone="mute" title="CrowdSec created this bouncer by itself the first time it connected, it was not registered by hand.">auto-registered</Chip>}
    </div>
  )
}

function bouncerSub(b: CrowdSecBouncerRow): string {
  const parts = [b.type, b.version, b.ip_address].filter(Boolean)
  return parts.length ? parts.join(' · ') : b.last_pull ? 'It reported no type or address' : 'Its type and address appear after the first pull'
}

// ---------------------------------------------------------------------------
// Add a bouncer: a name, then the key, once
// ---------------------------------------------------------------------------

function KeyBox({ value }: { value: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'manual'>('idle')
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setState('copied'); setTimeout(() => setState('idle'), 2500)
    } catch {
      // no clipboard here: select the key so that Ctrl+C / long-press copies it
      const el = document.getElementById('bouncer-key')
      const sel = window.getSelection()
      if (el && sel) { const r = document.createRange(); r.selectNodeContents(el); sel.removeAllRanges(); sel.addRange(r) }
      setState('manual')
    }
  }
  return (
    <div>
      <div id="bouncer-key" className="rounded-lg bg-slate-800/60 border border-emerald-500/25 px-3 py-3 font-mono text-[13px] text-slate-100 break-all select-all leading-relaxed">{value}</div>
      <div className="mt-2.5 flex items-center gap-3 flex-wrap">
        <button type="button" autoFocus onClick={copy} className={BTN_PRIMARY}>{state === 'copied' ? <Check size={13} /> : <Copy size={13} />} {state === 'copied' ? 'Copied' : 'Copy the key'}</button>
        {state === 'manual' && <span className="text-xs text-amber-300" role="status">Your browser would not copy it. The key is selected: press Ctrl+C.</span>}
      </div>
    </div>
  )
}

function AddBouncerSheet({ existing, onClose, onDone }: { existing: string[]; onClose: () => void; onDone: () => void }) {
  const { member } = useCs()
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [made, setMade] = useState<{ name: string; key: string } | null>(null)

  const n = name.trim()
  const problem = nameProblem(n)
  const taken = !problem && existing.includes(n)
  const valid = NAME_RE.test(n) && !taken
  // the key lives in this component only: closing it by any road (button, Escape, backdrop, the cross) drops it.
  // While the request is out the window stays: closing now would lose the key of a bouncer that is about to exist
  const close = () => { if (busy) return; setMade(null); onClose() }

  const submit = async () => {
    if (!valid || busy) return
    setBusy(true); setError('')
    try {
      const r = await crowdsecAddBouncer(n, member)
      // no toast: the key window that opens now is the confirmation, and a toast would cover its button on a phone
      setMade({ name: r.name, key: r.api_key })
      onDone()
    } catch (e) {
      setError(errMsg(e, 'The bouncer was not registered'))
    } finally { setBusy(false) }
  }

  if (made) {
    return (
      <CsSheet
        title="Copy the API key now" subtitle={`Bouncer ${made.name} is registered.`} icon={<KeyRound size={18} />} tone="warn" onClose={close}
        footer={<div className="flex justify-end"><button type="button" onClick={close} className={BTN_PRIMARY}><Check size={13} /> I have saved the key</button></div>}
      >
        <div className="space-y-4">
          <KeyBox value={made.key} />
          <p className="text-xs text-amber-300 flex items-start gap-2 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2.5" role="alert">
            <AlertTriangle size={14} className="shrink-0 mt-0.5" /> <span>This key is shown once and cannot be looked up later. When you close this window it is gone; if you lose it, delete the bouncer and add it again.</span>
          </p>
          <div>
            <p className={LABEL}>How to use it</p>
            <p className="text-xs text-slate-300 leading-relaxed">Give the key to the bouncer as its <span className="font-mono text-slate-300">api_key</span> setting, and point its CrowdSec API URL at <span className="font-mono text-slate-300">http://crowdsec:8080</span> when it runs in the same Docker network as CrowdSec. From anywhere else, use this server’s address and the port you publish for CrowdSec’s API.</p>
          </div>
        </div>
      </CsSheet>
    )
  }

  return (
    <CsSheet
      title="Add a bouncer" subtitle="A program that asks CrowdSec for the ban list and blocks those addresses." icon={<Plug size={18} />} onClose={close}
      footer={
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" onClick={close} disabled={busy} className={BTN_QUIET}>Cancel</button>
          <button type="button" onClick={submit} disabled={!valid || busy} className={`${BTN_PRIMARY} min-w-[9rem]`}>{busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} Register and get a key</button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="bouncer-name">Name</label>
          <input
            id="bouncer-name" autoFocus className={`${INPUT} font-mono ${(n && problem) || taken ? '!border-rose-500/40' : ''}`}
            value={name} onChange={(e) => { setName(e.target.value); setError('') }} maxLength={80}
            placeholder="e.g. firewall-bouncer" spellCheck={false} autoComplete="off" aria-invalid={!!n && (!!problem || taken)} aria-describedby="bouncer-name-hint"
          />
          <p id="bouncer-name-hint" className={`${HINT} ${(n && problem) || taken ? '!text-rose-300' : ''}`}>
            {taken ? `A bouncer called ${n} already exists. Pick another name.` : problem || '2 to 63 characters: letters, digits, dots, dashes and underscores. Start with a letter or a digit; no spaces.'}
          </p>
        </div>
        <p className="text-xs text-slate-500 leading-relaxed">CrowdSec makes a secret key for the bouncer and shows it once. Whatever you connect needs that key to read the ban list.</p>
        {error && (
          <div className="rounded-lg bg-rose-500/[0.08] border border-rose-500/25 px-3 py-2.5 text-sm text-rose-300 flex items-start gap-2" role="alert">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-400" />
            <p className="min-w-0 break-words">{error}</p>
          </div>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </CsSheet>
  )
}

// ---------------------------------------------------------------------------
// Traefik enforcement
// ---------------------------------------------------------------------------

function Enforcement({ b, isAdmin, busy, onRegister }: { b: CrowdSecBouncersResponse; isAdmin: boolean; busy: boolean; onRegister: (again: boolean) => void }) {
  const now = useNow()
  const tr = b.traefik
  const { goTab } = useCs()
  const enf = b.enforcement
  const dcs = b.dcs_bouncer
  const registered = !!dcs && !dcs.revoked
  // without Traefik's routes folder (a Traefik run outside DCS) the files cannot be inspected: the pulls are then the only evidence
  const blind = !enf.routes_dir
  const ready = registered && (blind || (enf.middleware_present && enf.in_chain))
  const pullAge = dcs?.last_pull ? Math.max(0, Math.round((now - Date.parse(dcs.last_pull)) / 1000)) : null
  const fresh = !!dcs && now - Date.parse(dcs.created_at) < 180_000
  const mwName = enf.middleware_file ? enf.middleware_file.split('/').pop() : 'crowdsec-bouncer.yml'

  let tone: Tone = 'good'
  let title = 'Traefik is enforcing the bans'
  let text = 'Every request goes through the CrowdSec middleware first: a banned address or network is refused before it reaches a service.'
  if (!tr.present) {
    tone = 'mute'; title = 'Traefik is not on this server'
    text = 'CrowdSec still detects attackers and keeps its ban list, but nothing in front of your services blocks them. Deploy Traefik to enforce the bans here, or add a bouncer for another proxy or a firewall below.'
  } else if (!ready) {
    tone = 'warn'; title = 'Bans are not enforced yet'
    text = 'CrowdSec decides who is banned; Traefik only obeys once the DCS bouncer is registered, its middleware file exists and it is part of Traefik’s chain.'
  } else if (!tr.running) {
    tone = 'warn'; title = 'Traefik is not running'
    text = `Nothing is enforced while Traefik is stopped${tr.state ? ` (it is ${tr.state})` : ''}. Start it from the Containers page; the bouncer is set up and will work again as soon as it runs.`
  } else if (pullAge === null && fresh) {
    tone = 'info'; title = 'Waiting for Traefik’s first pull'
    text = 'The bouncer is registered and in the chain. Traefik asks CrowdSec as soon as a request goes through the new middleware.'
  } else if (pullAge === null) {
    tone = 'warn'; title = 'Traefik has not pulled the ban list yet'
    text = 'The bouncer is registered and in the chain, but Traefik has never asked for bans. Check that Traefik is running and loaded the plugin; registering again gives it a fresh key.'
  } else if (pullAge >= 1800) {
    tone = 'warn'; title = 'Traefik has not asked CrowdSec for a long time'
    text = 'The plugin reports in at least every ten minutes while Traefik runs it. Check that Traefik is running and loaded the plugin; registering again gives it a fresh key.'
  } else if (blind) {
    text = 'Traefik asks CrowdSec for the ban list, so the bans are enforced. DCS cannot look inside Traefik’s files on this server, so it cannot check the middleware file or the chain.'
  }

  const ring = tone === 'good' ? 'bg-emerald-500/15 text-emerald-400' : tone === 'warn' ? 'bg-amber-500/15 text-amber-400' : tone === 'info' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-white/[0.04] text-slate-500 border border-white/10'
  const canFix = isAdmin && b.traefik_registerable
  const Btn = ready ? BTN_QUIET : BTN_PRIMARY
  const registerLabel = busy ? 'Registering…' : ready ? 'Register again' : 'Register the Traefik bouncer'
  const registerIcon = busy ? <Loader2 size={13} className="animate-spin" /> : ready ? <RefreshCw size={13} /> : <Plug size={13} />
  const explain = (
    <p className="text-xs text-slate-500 leading-relaxed">
      {busy
        ? 'Registering can take up to two minutes: CrowdSec makes a key, DCS writes the middleware file and Traefik may restart once.'
        : 'Registering makes a new key for the bouncer, writes the middleware file and adds it to Traefik’s chain. It is safe to repeat: it replaces what it wrote before, and Traefik restarts once if it has to load the plugin.'}
    </p>
  )

  return (
    <section className={`${CARD} p-4`} aria-label="Traefik enforcement">
      <SectionHead icon={ShieldCheck} title="Traefik enforcement" className="mb-3" />
      <div className="flex items-start gap-3">
        <div className={`p-2.5 rounded-xl shrink-0 ${ring}`} aria-hidden="true"><ShieldCheck size={18} /></div>
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-slate-100 leading-snug">{title}</h3>
          <p className="text-sm text-slate-300 mt-0.5 leading-relaxed max-w-3xl">{text}</p>
        </div>
        {canFix && (
          <div className="hidden md:block shrink-0">
            <button type="button" onClick={() => onRegister(ready)} disabled={busy} className={Btn}>{registerIcon} {registerLabel}</button>
          </div>
        )}
      </div>
      {canFix && (
        <div className="md:hidden mt-3 space-y-2.5">
          <button type="button" onClick={() => onRegister(ready)} disabled={busy} className={`${Btn} w-full`}>{registerIcon} {registerLabel}</button>
          {explain}
        </div>
      )}

      {tr.present && (
        <ul className="mt-4 pt-4 border-t border-white/5 divide-y divide-white/5" aria-label="What is checked">
          <CheckRow tone={tr.running ? 'good' : 'warn'} label="Traefik">
            {tr.running ? <>Running{tr.container ? <span className="text-slate-500"> · container {tr.container}</span> : null}</> : `Not running${tr.container ? `: the container ${tr.container}` : ''} is ${tr.state || 'stopped'}`}
          </CheckRow>
          <CheckRow tone={!dcs ? 'warn' : dcs.revoked ? 'bad' : 'good'} label="Bouncer registered">
            {!dcs ? <>No bouncer called <span className="font-mono text-slate-300">{b.name}</span> in CrowdSec</> : dcs.revoked ? <>The key of <span className="font-mono text-slate-300">{dcs.name}</span> was revoked</> : <><span className="font-mono text-slate-300">{dcs.name}</span>{dcs.type || dcs.version ? <span className="text-slate-500"> · {[dcs.type, dcs.version].filter(Boolean).join(' ')}</span> : null}</>}
          </CheckRow>
          <CheckRow tone={enf.middleware_present ? 'good' : blind ? 'mute' : 'warn'} label="Middleware file">
            {enf.middleware_present ? <><span className="font-mono text-slate-300" title={enf.middleware_file}>{mwName}</span> is in Traefik’s routes folder</> : blind ? 'Not known: DCS did not find Traefik’s routes folder' : <><span className="font-mono text-slate-300">crowdsec-bouncer.yml</span> is missing from Traefik’s routes folder</>}
          </CheckRow>
          <CheckRow tone={enf.in_chain ? 'good' : blind ? 'mute' : 'warn'} label="In Traefik’s chain">
            {enf.in_chain ? <><span className="font-mono text-slate-300">crowdsec-bouncer</span> is part of <span className="font-mono text-slate-300">traefik-chain</span>, so every service that uses the chain is checked</> : blind ? 'Not known without the routes folder' : <><span className="font-mono text-slate-300">crowdsec-bouncer</span> is not part of <span className="font-mono text-slate-300">traefik-chain</span>: the services do not ask CrowdSec</>}
          </CheckRow>
          {enf.plugin && (
            <CheckRow tone={enf.plugin.declared ? (enf.plugin.loaded === false ? 'warn' : 'good') : blind ? 'mute' : 'bad'} label="Plugin declared">
              {enf.plugin.declared ? <><span className="font-mono text-slate-300">{enf.plugin.name}</span> {enf.plugin.version} is declared in Traefik&rsquo;s static configuration{enf.plugin.loaded === false ? ': Traefik has not been restarted since, so it is not loaded yet' : ''}</> : blind ? 'Not known without the routes folder' : 'Traefik&rsquo;s static configuration does not declare the plugin: Traefik refuses the middleware. Registering again declares it.'}
            </CheckRow>
          )}
          {enf.plugin && dcs && enf.middleware_present && (
            <CheckRow tone={Date.parse(dcs.created_at) / 1000 > (enf.middleware_mtime ?? 0) + 120 ? 'bad' : enf.plugin.key_present ? 'good' : 'warn'} label="Key in the file">
              {Date.parse(dcs.created_at) / 1000 > (enf.middleware_mtime ?? 0) + 120 ? 'The bouncer was registered again after the file was written, so the key in the file no longer works. Register again writes a fresh one.' : enf.plugin.key_present ? 'The file holds the key of the bouncer CrowdSec knows' : 'The file has no key'}
            </CheckRow>
          )}
          {enf.plugin?.mode && (
            <CheckRow tone="mute" label="Mode">
              <span className="font-mono text-slate-300">{enf.plugin.mode}</span>{enf.plugin.mode === 'live' ? ': Traefik asks CrowdSec about a visitor when it first sees one' : ': Traefik downloads the ban list every few seconds'}. {isAdmin ? <button type="button" className="text-cyan-400 hover:text-cyan-300" onClick={() => goTab('settings')}>Change it in Settings</button> : null}
            </CheckRow>
          )}
          <CheckRow tone={!dcs ? 'mute' : pullAge === null ? (fresh ? 'info' : 'warn') : pullAge >= 1800 ? 'warn' : 'good'} label="Last pull">
            {!dcs ? 'Nothing to pull without a bouncer' : pullAge === null ? (fresh ? 'Not yet: Traefik asks with the first request that goes through the new middleware' : 'Never: Traefik has not asked CrowdSec') : <><Ago at={dcs.last_pull} />{pullAge >= 1800 ? ': it normally pulls every few seconds' : ''}</>}
          </CheckRow>
        </ul>
      )}

      {canFix && <div className="hidden md:block mt-4">{explain}</div>}
      {tr.present && !b.traefik_registerable && (
        <p className="text-xs text-slate-500 leading-relaxed mt-4">DCS could not find Traefik’s routes folder (App-Data/Traefik/custom_routes in one of your stacks), so it cannot set the bouncer up for you. If Traefik runs outside DCS, add the CrowdSec middleware to it by hand and use a bouncer key from “Add a bouncer” below.</p>
      )}
      {tr.present && b.traefik_registerable && !isAdmin && !ready && (
        <p className="text-xs text-slate-500 leading-relaxed mt-4">An administrator can register the Traefik bouncer from this page.</p>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The bouncers
// ---------------------------------------------------------------------------

function BouncerSection({ poll, isAdmin, busy, onAdd, onDelete }: { poll: UsePollingResult<CrowdSecBouncersResponse>; isAdmin: boolean; busy: string; onAdd: () => void; onDelete: (b: CrowdSecBouncerRow) => void }) {
  const b = poll.data
  // when they could not be read, the error card above the page says so
  if (!b && poll.error) return null
  const rows = [...(b?.bouncers ?? [])].sort((x, y) => Number(!!y.dcs) - Number(!!x.dcs) || x.name.localeCompare(y.name))

  const delBtn = (row: CrowdSecBouncerRow, phone: boolean) => {
    if (!isAdmin) return null
    if (!NAME_RE.test(row.name)) return <span className="text-[11px] text-slate-500" title="This name cannot be removed from the page: use cscli bouncers delete">use cscli</span>
    const k = `del:${row.name}`
    return phone
      ? <button type="button" className={`${ICON_BTN} !w-auto px-2.5 gap-1.5 text-[11px]`} aria-label={`Delete the bouncer ${row.name}`} disabled={busy === k} onClick={() => onDelete(row)}>{busy === k ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Delete</button>
      : <button type="button" className={`${ICON_BTN} hover:!bg-rose-500/15 hover:!text-rose-300`} aria-label={`Delete the bouncer ${row.name}`} title="Delete this bouncer" disabled={busy === k} onClick={() => onDelete(row)}>{busy === k ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}</button>
  }

  return (
    <section className="space-y-3" aria-label="Bouncers">
      <SectionHead icon={Plug} title="Bouncers" count={b ? b.count : undefined} right={isAdmin && b ? <button type="button" onClick={onAdd} className={BTN_PRIMARY}><Plus size={14} /> Add a bouncer</button> : undefined} />
      <p className="text-xs text-slate-500 -mt-1 leading-relaxed max-w-3xl">A bouncer is a program that asks CrowdSec for the ban list and blocks those addresses: Traefik’s plugin, a firewall, another proxy. Without one, a ban is only a note in CrowdSec’s database.</p>
      {!b && <div className="space-y-2" aria-busy="true">{[0, 1].map((i) => <Skel key={i} className="h-14" />)}</div>}
      {b && rows.length === 0 && (
        <div className={`${CARD} px-6 py-12 text-center`}>
          <Plug size={30} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm text-slate-300">No bouncer is registered.</p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">CrowdSec can detect attackers, but nothing asks it for the ban list, so nothing blocks them. {b.traefik.present ? 'Register the Traefik bouncer above to have Traefik enforce the bans' : 'Add a bouncer for your proxy or firewall'}{isAdmin ? '.' : ': an administrator can do it.'}</p>
          {isAdmin && <div className="mt-4"><button type="button" onClick={onAdd} className={BTN_PRIMARY}><Plus size={14} /> Add a bouncer</button></div>}
        </div>
      )}
      {b && rows.length > 0 && (
        <>
          <div className={`${CARD} overflow-hidden hidden lg:block`}>
            <table className="w-full text-sm table-fixed">
              <caption className="sr-only">Bouncers registered in CrowdSec</caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th scope="col" className="text-left font-semibold px-4 py-2.5">Bouncer</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-28">Last pull</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-32">Status</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-40">Registered</th>
                  {isAdmin && <th scope="col" className="w-16 pr-4"><span className="sr-only">Actions</span></th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {rows.map((r) => (
                  <tr key={r.name} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-2.5 min-w-0">
                      <BouncerName b={r} />
                      <p className="text-[11px] text-slate-500 mt-0.5 break-words">{bouncerSub(r)}</p>
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-300 tabular-nums"><Ago at={r.last_pull} /></td>
                    <td className="px-3 py-2.5"><StatusChip b={r} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap text-xs text-slate-500">{r.created_at ? fmtTime(r.created_at) : '—'}</td>
                    {isAdmin && <td className="pr-4 py-2.5"><div className="flex items-center justify-end">{delBtn(r, false)}</div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lg:hidden space-y-2">
            {rows.map((r) => (
              <div key={r.name} className={`${CARD} p-3.5`}>
                <BouncerName b={r} />
                <p className="text-[11px] text-slate-500 mt-1 break-words">{bouncerSub(r)}</p>
                <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-white/5">
                  <div className="flex items-center gap-2 min-w-0 flex-wrap">
                    <StatusChip b={r} />
                    {r.last_pull && <span className="text-[11px] text-slate-500">pulled <Ago at={r.last_pull} /></span>}
                  </div>
                  {delBtn(r, true)}
                </div>
                {r.created_at && <p className="text-[10px] text-slate-500 mt-2">registered {fmtTime(r.created_at)}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The machines
// ---------------------------------------------------------------------------

function Validated({ m }: { m: CrowdSecMachine }) {
  return m.validated
    ? <Chip tone="good" title="The machine was accepted by this CrowdSec">Validated</Chip>
    : <Chip tone="warn" title={`This machine asked to join but was not approved yet. Approve it with: cscli machines validate ${m.id}`}>Waiting for approval</Chip>
}

function Seen({ m, now }: { m: CrowdSecMachine; now: number }) {
  const hb = m.last_heartbeat ? Date.parse(m.last_heartbeat) : NaN
  const stale = Number.isFinite(hb) && now - hb > 300_000
  return (
    <div className="text-xs leading-snug">
      <p className={stale ? 'text-amber-300' : m.last_heartbeat ? 'text-slate-300' : 'text-slate-500'} title={m.last_heartbeat ? fmtTime(m.last_heartbeat) : undefined}>
        {m.last_heartbeat ? <>Heartbeat {fmtAgo(m.last_heartbeat, now)}</> : 'No heartbeat yet'}{stale ? ' · quiet for a while' : ''}
      </p>
      <p className="text-[11px] text-slate-500" title={m.last_push ? fmtTime(m.last_push) : undefined}>{m.last_push ? <>Sent alerts {fmtAgo(m.last_push, now)}</> : 'Has not sent alerts'}</p>
    </div>
  )
}

function Sources({ m }: { m: CrowdSecMachine }) {
  const ds = Object.entries(m.datasources ?? {})
  if (ds.length === 0) return <span className="text-xs text-slate-500" title="This machine reported no data sources">none reported</span>
  return (
    <span className="inline-flex items-center gap-1 flex-wrap">
      {ds.map(([k, n]) => <Chip key={k} tone="mute" title={`${plural(n, 'data source', 'data sources')} of type ${k}`}>{k} {n}</Chip>)}
    </span>
  )
}

function MachineSection({ poll }: { poll: UsePollingResult<CrowdSecMachinesResponse> }) {
  const now = useNow()
  const machines = poll.data?.machines ?? []
  return (
    <section className="space-y-3" aria-label="Machines">
      <SectionHead icon={Server} title="Machines" count={poll.data ? poll.data.count : undefined} />
      <p className="text-xs text-slate-500 -mt-1 leading-relaxed max-w-3xl">A machine is a CrowdSec engine that reads logs and reports attacks to this CrowdSec. The one inside the CrowdSec container is called localhost; more can join from other servers.</p>
      {!poll.data && !poll.error && <Skel className="h-16" />}
      {!poll.data && poll.error && <LoadError what="the machines" error={poll.error} onRetry={poll.refresh} />}
      {poll.data && poll.error && <Notice>The last refresh failed ({poll.error.message}). Showing what was loaded before.</Notice>}
      {poll.data && machines.length === 0 && (
        <div className={`${CARD} px-6 py-10 text-center`}>
          <Server size={28} className="mx-auto text-slate-500" />
          <p className="mt-3 text-sm text-slate-300">No machine has reported yet.</p>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">CrowdSec’s own engine registers itself when the container starts. If this stays empty, look at the CrowdSec log.</p>
        </div>
      )}
      {machines.length > 0 && (
        <>
          <div className={`${CARD} overflow-hidden hidden lg:block`}>
            <table className="w-full text-sm table-fixed">
              <caption className="sr-only">Machines that report to CrowdSec</caption>
              <thead>
                <tr className="text-[10px] uppercase tracking-wider text-slate-500 border-b border-white/5">
                  <th scope="col" className="text-left font-semibold px-4 py-2.5">Machine</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-36">Status</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-44">Last seen</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-36">Reads</th>
                  <th scope="col" className="text-left font-semibold px-3 py-2.5 w-32 hidden xl:table-cell">Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                {machines.map((m) => (
                  <tr key={m.id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="px-4 py-2.5 min-w-0">
                      <span className="font-mono text-[13px] text-slate-100 break-all">{m.id}</span>
                      <p className="text-[11px] text-slate-500 mt-0.5 break-words">{[m.version, m.os].filter(Boolean).join(' · ') || 'Version not known'}<span className="xl:hidden font-mono">{m.ip_address ? ` · ${m.ip_address}` : ''}</span></p>
                    </td>
                    <td className="px-3 py-2.5"><Validated m={m} /></td>
                    <td className="px-3 py-2.5"><Seen m={m} now={now} /></td>
                    <td className="px-3 py-2.5"><Sources m={m} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap font-mono text-xs text-slate-300 hidden xl:table-cell">{m.ip_address || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="lg:hidden space-y-2">
            {machines.map((m) => (
              <div key={m.id} className={`${CARD} p-3.5`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <span className="font-mono text-sm text-slate-100 break-all">{m.id}</span>
                    <p className="text-[11px] text-slate-500 mt-0.5 break-words">{[m.version, m.os].filter(Boolean).join(' · ') || 'Version not known'}</p>
                  </div>
                  <Validated m={m} />
                </div>
                <div className="mt-3 pt-2.5 border-t border-white/5 space-y-1.5">
                  <Seen m={m} now={now} />
                  <div className="flex items-center gap-2 flex-wrap"><Sources m={m} />{m.ip_address && <span className="font-mono text-[11px] text-slate-500">{m.ip_address}</span>}</div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Community and console (register again and enrol are the two things done from here; the rest is CrowdSec's own settings)
// ---------------------------------------------------------------------------

/** the sharing options the console gets, in plain words */
const CONSOLE_SHARING: Record<string, string> = { custom: 'your own scenarios', manual: 'manual bans', tainted: 'modified scenarios', context: 'log details of an alert' }

function CommunitySection({ poll }: { poll: UsePollingResult<CrowdSecCommunityResponse> }) {
  const { isAdmin } = useCs()
  const now = useNow()
  // the enrol form stays after a success (the next step is on app.crowdsec.net) even once the refetch says enrolled
  const [keepEnrol, setKeepEnrol] = useState(false)
  // while the enrolment is not known the form stays behind "Enrol anyway" (open at once when the overview asked for it)
  const [enrolAnyway, setEnrolAnyway] = useState(enrolRequested)
  const cm = poll.data
  if (!cm && poll.error) return <LoadError what="the community status" error={poll.error} onRetry={poll.refresh} />

  // the API's note says what the console is (its cscli command is left out: enrolling is the form below); the first sentence only
  // repeats the row's title, so it is left out of the detail
  const noteText = cm
    ? (cm.note.replace(/\s*\(cscli [^)]+\)/, '').replace(/^(Not enrolled in|This engine is enrolled in) the CrowdSec console\.?\s*/i, '').trim() || (cm.console.enrolled ? 'Your alerts also appear in the online console.' : ''))
    : ''
  const capiError = cm?.capi.error ? cm.capi.error.replace(/^Error:\s*(cscli [a-z ]+:\s*)?/i, '') : ''
  // the community link: null on an older server (the rows read needs_register and the flags as before)
  const capi = capiState(cm)
  const refused = capi ? capi === 'refused' : !!cm?.needs_register
  const checkNow = isAdmin && capi ? <CheckNowButton onDone={poll.refresh} availableAt={cm?.capi.check_available_at} /> : undefined
  const consoleUnknown = !!cm && cm.console.known === false && !cm.console.enrolled

  return (
    <section className={`${CARD} p-4`} aria-label="Community and console">
      <SectionHead icon={Users} title="Community and console" className="mb-3" />
      {!cm && <div className="space-y-2"><Skel className="h-12" /><Skel className="h-12" /><Skel className="h-12" /></div>}
      {cm && (
        <>
          {poll.error && <div className="mb-3"><Notice>The last refresh failed ({poll.error.message}). Showing what was loaded before.</Notice></div>}
          <div className="divide-y divide-white/5">
            {refused ? (
              <StatusRow tone="bad" title="CrowdSec can’t reach the community service"
                action={isAdmin ? <div className="flex flex-wrap items-start gap-2"><div><RegisterAgainButton onDone={poll.refresh} /></div>{checkNow}</div> : undefined}>
                <span className="break-words">{cm.hint || REFUSED_TEXT}</span>
                {!isAdmin && <p className="text-slate-500 mt-1">An admin can register it again here.</p>}
              </StatusRow>
            ) : capi === 'disabled' ? (
              <StatusRow tone="mute" title="The community connection is switched off">CrowdSec is set to run without the community service, so it neither receives the community blocklist nor shares what it sees.</StatusRow>
            ) : capi === 'paused' ? (
              <StatusRow tone="warn" icon={Clock} title="Community service pausing this engine">
                <span className="break-words">{cm.hint || PAUSED_TEXT}</span>
                <p className="text-slate-400 mt-1">{lastContact(cm, now)}</p>
              </StatusRow>
            ) : !cm.capi.registered ? (
              <StatusRow tone="mute" title="Not connected to the community" action={isAdmin ? <RegisterAgainButton onDone={poll.refresh} label="Register" /> : undefined}>CrowdSec is not registered with the central API, so it neither receives the community blocklist nor shares what it sees.</StatusRow>
            ) : capi === 'unknown' ? (
              <StatusRow tone="mute" title="Not checked yet" action={checkNow}>
                DCS Orchestrator asks the community service only when you check, so it adds no logins of its own.{cm.capi.pulling && cm.community_decisions > 0 ? ` CrowdSec holds ${fmtNum(cm.community_decisions)} community addresses.` : ''}
              </StatusRow>
            ) : cm.capi.error ? (
              <StatusRow tone="warn" title="The community service does not answer" action={checkNow}><span className="break-words">{capiError}</span></StatusRow>
            ) : cm.capi.pulling ? (
              <StatusRow tone="good" title={cm.community_decisions > 0 ? `Pulling the community blocklist: ${fmtNum(cm.community_decisions)} known bad addresses` : 'Pulling the community blocklist: nothing received yet'} action={checkNow}>
                CrowdSec downloads the addresses other people already caught attacking, and the Traefik bouncer blocks them too. They are not listed on the Bans page.
              </StatusRow>
            ) : (
              <StatusRow tone="warn" title="Not pulling the community blocklist" action={checkNow}>CrowdSec is registered with the central API, but the download of the blocklist is switched off, so only your own bans are enforced.</StatusRow>
            )}
            {capi === 'disabled' ? null : refused || (cm.capi.registered && cm.capi.error && capi !== 'paused') ? (
              <StatusRow tone="mute" title="Sharing not known">CrowdSec could not reach the central service, so it cannot tell whether your detections are shared.</StatusRow>
            ) : (
              <StatusRow tone={cm.capi.sharing ? 'good' : 'mute'} title={cm.capi.sharing ? 'Sharing your detections' : 'Not sharing your detections'}>
                {cm.capi.sharing ? 'When CrowdSec catches an attacker it reports the address and the scenario (nothing else), so others can block it too.' : 'Nothing leaves this server: your detections are not reported to the community.'}
              </StatusRow>
            )}
            {consoleUnknown ? (
              <StatusRow tone="mute" title="Enrolment not checked yet"
                action={isAdmin ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <CheckNowButton onDone={poll.refresh} availableAt={cm.capi.check_available_at} />
                    {!enrolAnyway && <button type="button" className="text-[11px] text-cyan-400 hover:text-cyan-300" onClick={() => setEnrolAnyway(true)}>Enrol anyway</button>}
                  </div>
                ) : undefined}>
                <p>Whether this engine is in the CrowdSec Console is known after a check, an enrolment or a line in CrowdSec’s log.</p>
                {isAdmin && enrolAnyway && <EnrolBox onDone={poll.refresh} onEnrolled={() => setKeepEnrol(true)} needsRegister={refused} />}
              </StatusRow>
            ) : (
            <StatusRow tone={cm.console.enrolled ? 'good' : 'mute'} title={cm.console.enrolled ? `Enrolled in the CrowdSec Console${cm.console.plan ? ` (${cm.console.plan})` : ''}` : 'Not enrolled in the CrowdSec Console'}>
              {(cm.console.enrolled || !isAdmin) && <p>{noteText}</p>}
              {!cm.console.enrolled && !isAdmin && <p className="text-slate-500 mt-1">An admin can enrol it here with a key from app.crowdsec.net.</p>}
              {isAdmin && (!cm.console.enrolled || keepEnrol) && <EnrolBox onDone={poll.refresh} onEnrolled={() => setKeepEnrol(true)} needsRegister={refused} />}
              {cm.console.enrolled && (
                <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span className="text-slate-500">Sent to the console:</span>
                  {Object.entries(CONSOLE_SHARING).map(([k, label]) => {
                    const on = !!cm.console.sharing[k]
                    return <Chip key={k} tone={on ? 'good' : 'mute'} title={on ? `The console receives ${label}` : `The console does not receive ${label}`}>{label}: {on ? 'yes' : 'no'}</Chip>
                  })}
                </div>
              )}
            </StatusRow>
            )}
          </div>
          <p className="text-[11px] text-slate-500 mt-3 pt-3 border-t border-white/5 leading-relaxed">Registering and enrolling are done here. Sharing and the console options are settings of CrowdSec itself, changed with cscli on the server.</p>
        </>
      )}
    </section>
  )
}

// ---------------------------------------------------------------------------
// The tab
// ---------------------------------------------------------------------------

export default function BouncersTab() {
  const { member, isAdmin, refreshStatus } = useCs()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const bp = usePolling<CrowdSecBouncersResponse>(() => crowdsecBouncers(member), 15000, { enabled: isConnected })
  const mp = usePolling<CrowdSecMachinesResponse>(() => crowdsecMachines(member), 30000, { enabled: isConnected })
  const cp = usePolling<CrowdSecCommunityResponse>(() => crowdsecCommunity(member), 60000, { enabled: isConnected })
  const [busy, setBusy] = useState('')
  const [adding, setAdding] = useState(false)

  const b = bp.data
  const after = () => { bp.refresh(); refreshStatus() }

  const register = async (again: boolean) => {
    if (again && !(await confirm({
      title: 'Register the Traefik bouncer again?',
      message: 'This gives Traefik a new key and rewrites the middleware file and the chain entry. It is safe, and Traefik restarts once if it has to load the plugin.\nUse it when the bans are not enforced although everything here looks fine.',
      confirmLabel: 'Register again',
    }))) return
    setBusy('register')
    try {
      const r = await crowdsecRegisterTraefikBouncer(member)
      addToast({ type: 'success', message: (r.message || 'The Traefik bouncer is registered').trim(), duration: 7000 })
      after()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not register the Traefik bouncer'), duration: 9000 })
      bp.refresh()
    } finally { setBusy('') }
  }

  const remove = async (row: CrowdSecBouncerRow) => {
    const dcs = !!row.dcs
    if (!(await confirm({
      title: dcs ? 'Delete the Traefik bouncer?' : `Delete the bouncer ${row.name}?`,
      message: dcs
        ? 'Traefik will stop enforcing bans until you register the Traefik bouncer again. The bans stay in CrowdSec, but nothing blocks those addresses in the meantime.'
        : `Its key stops working at once. Whatever uses it (a firewall, a proxy) stops receiving bans until you add a bouncer for it again.${row.last_pull ? '' : '\nIt has never pulled, so nothing depends on it yet.'}`,
      confirmLabel: dcs ? 'Delete it anyway' : 'Delete',
      danger: true,
    }))) return
    setBusy(`del:${row.name}`)
    try {
      const r = await crowdsecDeleteBouncer(row.name, member)
      addToast({ type: r.was_dcs_bouncer ? 'warning' : 'success', message: r.message || `Bouncer ${row.name} removed`, duration: r.was_dcs_bouncer ? 9000 : 5000 })
      after()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not delete the bouncer'), duration: 7000 })
      bp.refresh()
    } finally { setBusy('') }
  }

  return (
    <div className="space-y-5" data-cs-tab="bouncers">
      {!b && !bp.error && <Skel className="h-72" />}
      {!b && bp.error && <LoadError what="the bouncers" error={bp.error} onRetry={bp.refresh} />}
      {b && bp.error && <Notice>The last refresh failed ({bp.error.message}). Showing what was loaded before.</Notice>}
      {b && <Enforcement b={b} isAdmin={isAdmin} busy={busy === 'register'} onRegister={register} />}
      <BouncerSection poll={bp} isAdmin={isAdmin} busy={busy} onAdd={() => setAdding(true)} onDelete={remove} />
      <MachineSection poll={mp} />
      <CommunitySection poll={cp} />
      {adding && <AddBouncerSheet existing={(b?.bouncers ?? []).map((r) => r.name)} onClose={() => setAdding(false)} onDone={after} />}
    </div>
  )
}
