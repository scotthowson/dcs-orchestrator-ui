// =============================================================================
// Sign-in to your apps — Users: the second step Authelia asks for after the
// password (a code from an authenticator app, or a passkey). Off (a password
// alone) is where every server starts; "Every app" or "Chosen apps" switch it
// on. The server writes it into Authelia's access rules and restarts Authelia.
//
// Authelia only offers the registration of a device when one of its rules asks
// for two factors (otherwise its settings page says there are no protected
// applications): the server keeps one such rule on a name nothing is routed to
// (second-step.<domain>) in every mode. An older server's file may lack it:
// the card says so and Repair asks the server to add it.
//
// Registering a device needs a one-time code Authelia sends to confirm who is
// asking. Without e-mail, Authelia writes that message to a file on the server:
// this card shows the latest code, so a device can be registered before the
// second step is switched on. This dashboard signs in with its own accounts,
// never through Authelia, so it is always the way back to "Password only".
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { ShieldCheck, ShieldAlert, ExternalLink, Loader2, KeyRound, Smartphone, Fingerprint, Copy, Check, RefreshCw, LifeBuoy, Plus, X, Wrench } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { fetchAutheliaSecondStep, setAutheliaSecondStep, repairAutheliaSecondStep, fetchAutheliaVerificationCode } from '../../api/endpoints'
import type { AutheliaSecondStep, AutheliaStepMode, AutheliaVerificationCode } from '../../../shared/types'
import { BTN_CARD, BTN_CARD_QUIET, TONE_OK, SECTION_LABEL, FOCUS_RING } from '../../lib/ui'
import { CHOICE, CHOICE_ON, CHOICE_OFF, CHOICE_SM } from '../../lib/fieldStyles'
const MODES: { id: AutheliaStepMode; label: string; hint: string }[] = [
  { id: 'off', label: 'Password only', hint: 'Authelia asks for the password alone (how every server starts).' },
  { id: 'all', label: 'Every app', hint: 'Every app behind Authelia asks for a code or a passkey after the password.' },
  { id: 'apps', label: 'Chosen apps', hint: 'Only the apps you pick ask for it; the others keep the password alone.' },
]
const NAME_RE = /^[a-z0-9]([a-z0-9-]{0,62})(\.[a-z0-9]([a-z0-9-]{0,62}))*$/
/** how long the card keeps looking for a new code after "Show the latest code" */
const WATCH_MS = 5 * 60 * 1000

function ago(seconds: number | null | undefined): string {
  if (seconds == null || seconds < 0) return ''
  if (seconds < 60) return 'just now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`
}

const modeText = (m: AutheliaStepMode | undefined, apps: string[] | undefined) =>
  m === 'all' ? 'every app asks for the second step' : m === 'apps' ? `${apps?.length ?? 0} app${apps?.length === 1 ? '' : 's'} ask for the second step` : 'a password alone'

export default function AppSignInCard() {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [state, setState] = useState<AutheliaSecondStep | null>(null)
  const [missing, setMissing] = useState(false)   // a server from before this setting
  const [mode, setMode] = useState<AutheliaStepMode>('off')
  const [apps, setApps] = useState<string[]>([])
  const [other, setOther] = useState('')
  const [busy, setBusy] = useState(false)
  const [repairing, setRepairing] = useState(false)
  const [code, setCode] = useState<AutheliaVerificationCode | null>(null)
  const [watching, setWatching] = useState(false)
  const [copied, setCopied] = useState(false)
  const watchUntil = useRef(0)

  const load = useCallback(() => {
    fetchAutheliaSecondStep()
      .then((s) => { setState(s); setMode(s.mode); setApps(s.apps); setMissing(false) })
      .catch(() => setMissing(true))
  }, [])
  useEffect(() => { load() }, [load])

  const readCode = useCallback(() => {
    fetchAutheliaVerificationCode().then(setCode).catch((e) => {
      setWatching(false)
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not read the verification code' })
    })
  }, [addToast])
  // while watching: a new code shows up within a few seconds of Authelia writing it
  useEffect(() => {
    if (!watching) return
    const t = setInterval(() => {
      if (Date.now() > watchUntil.current) { setWatching(false); return }
      readCode()
    }, 4000)
    return () => clearInterval(t)
  }, [watching, readCode])
  const watch = () => { watchUntil.current = Date.now() + WATCH_MS; setWatching(true); readCode() }

  if (missing) return <p className="text-xs text-slate-500">This server does not have this setting yet: update DCS (Updates) to bring it.</p>
  if (!state) return <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Reading…</p>

  const signIn = state.sign_in_url
  const choices = state.choices ?? []
  // apps chosen before that have no route behind Authelia now stay listed, so they can be taken off
  const listed = [...choices.map((c) => c.name), ...apps.filter((a) => !choices.some((c) => c.name === a))]
  const changed = mode !== state.mode || (mode === 'apps' && [...apps].sort().join(' ') !== [...state.apps].sort().join(' '))
  const outOfStep = state.in_sync === false
  const canApply = !busy && (changed || outOfStep) && !(mode === 'apps' && apps.length === 0) && state.live?.managed !== false

  const toggleApp = (name: string) => setApps((cur) => (cur.includes(name) ? cur.filter((a) => a !== name) : [...cur, name]))
  const addOther = () => {
    let n = other.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    if (state.domain && n.endsWith(`.${state.domain}`)) n = n.slice(0, -(state.domain.length + 1))
    if (!NAME_RE.test(n) || n === 'auth') { addToast({ type: 'error', message: `Type an app's name under your domain, like dash or pve${state.domain ? ` (for pve.${state.domain})` : ''}` }); return }
    if (!apps.includes(n)) setApps([...apps, n])
    setOther('')
  }

  const apply = async () => {
    if (mode !== 'off') {
      const ok = await confirm({
        title: 'Ask for a second step at sign-in',
        message:
          `${mode === 'all' ? 'Every app behind Authelia' : apps.map((a) => (state.domain ? `${a}.${state.domain}` : a)).join(', ')} will ask for a code from an authenticator app or a passkey after the password. ` +
          `Register a device for your Authelia user first (the steps on this card). A user with no device is not locked out: at the next sign-in Authelia says the app needs two-factor authentication and links to the registration, with the verification code shown here. ` +
          `This dashboard has its own sign-in, not Authelia's: open it on your network (port 3000 of this server) and choose Password only to come back.`,
        confirmLabel: 'Switch it on',
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      const r = await setAutheliaSecondStep(mode, apps)
      addToast({ type: 'success', message: r.message })
      load(); setTimeout(load, 6000)
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not change the sign-in', duration: 8000 })
    } finally { setBusy(false) }
  }

  const repair = async () => {
    setRepairing(true)
    try {
      const r = await repairAutheliaSecondStep()
      addToast({ type: 'success', message: r.message })
      load(); setTimeout(load, 6000)
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not repair Authelia\'s rules', duration: 8000 })
    } finally { setRepairing(false) }
  }

  const copyCode = (c: string) => {
    navigator.clipboard.writeText(c).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  const live = state.live
  return (
    <div className="space-y-4">
      {/* where it stands */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1 space-y-1.5">
          <p className="text-xs text-slate-400">
            Authelia is the sign-in in front of your apps. After the password it can ask for a second step: a six-digit code from an authenticator app on your phone, or a passkey.
            A stolen password alone then opens nothing.
          </p>
          <p className="text-xs flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${state.mode === 'off' ? 'border-white/10 bg-white/5 text-slate-400' : 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300'}`}>
              {state.mode === 'off' ? 'password only' : state.mode === 'all' ? 'every app' : 'chosen apps'}
            </span>
            {!state.authelia && <span className="text-amber-300">Authelia is not deployed here: deploy its template first. The setting is kept, and a new Authelia follows it.</span>}
            {state.authelia && !state.config_found && <span className="text-amber-300">Authelia's configuration file was not found here.</span>}
            {live && live.managed === false && (
              <span className="text-rose-300 flex items-center gap-1"><ShieldAlert size={12} /> Authelia's configuration has no rule for *.{state.domain ?? 'your domain'} that DCS manages: set the policy there by hand.</span>
            )}
            {live?.managed && !outOfStep && <span className="text-slate-500">Authelia now: {modeText(live.mode, live.apps)}</span>}
            {live?.managed && outOfStep && (
              <span className="text-amber-300">Authelia's configuration says {modeText(live.mode, live.apps)}: Apply to bring it in line.</span>
            )}
            {live?.managed && (live.other_rules ?? 0) > 0 && (
              <span className="text-slate-500">· {live.other_rules} rule{live.other_rules === 1 ? '' : 's'} you added by hand keep their own policy</span>
            )}
          </p>
        </div>
        {signIn && (
          <a href={signIn} target="_blank" rel="noreferrer" className={`${BTN_CARD} ${TONE_OK}`}><ExternalLink size={12} /> Open {signIn.replace(/^https:\/\//, '')}</a>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 1. register a device */}
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2.5">
          <p className={SECTION_LABEL}>1 · Register a device first</p>
          {live?.managed && live.enrol === false && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5 flex items-start gap-2 flex-wrap" role="status">
              <ShieldAlert size={14} className="text-amber-300 shrink-0 mt-0.5" aria-hidden />
              <p className="text-[11px] text-slate-300 flex-1 min-w-[12rem]">
                Authelia's rules lack the one that lets a device be registered: its settings page says there are no protected applications that require a second factor.
                Repair adds one rule for {state.enrol_host ?? 'second-step.<your domain>'}, a name nothing is routed to; no app changes, Authelia restarts for a few seconds.
              </p>
              <button type="button" onClick={repair} disabled={repairing} className={`${BTN_CARD} ${TONE_OK}`}>
                {repairing ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />} Repair
              </button>
            </div>
          )}
          <ol className="space-y-2 text-xs text-slate-300 list-decimal list-outside pl-4">
            <li>
              <span className="inline-flex items-center gap-1"><Smartphone size={12} className="text-cyan-400" aria-hidden /> Install an authenticator app</span> on your phone: Google Authenticator, Aegis, 1Password, Bitwarden, Microsoft Authenticator… Or use a{' '}
              <span className="inline-flex items-center gap-1"><Fingerprint size={12} className="text-cyan-400" aria-hidden /> passkey</span> (your phone, Windows Hello, Touch ID, a security key).
            </li>
            <li>
              Open {signIn
                ? <a href={`${signIn}/settings/two-factor-authentication`} target="_blank" rel="noreferrer" className={`text-cyan-300 underline underline-offset-2 ${FOCUS_RING}`}>{signIn.replace(/^https:\/\//, '')}/settings/two-factor-authentication</a>
                : <span className="font-mono">auth.&lt;your domain&gt;/settings/two-factor-authentication</span>} and sign in with your Authelia user and password.
            </li>
            <li>
              Choose Add for a one-time password (scan the QR code with the app) or a WebAuthn credential (the passkey). Authelia first asks for a verification code to be sure it is you:{' '}
              {state.file_notifier ? 'it writes that code on this server instead of e-mailing it, and it shows up just below.' : 'it e-mails it to the address of your Authelia user.'}
            </li>
            <li>Confirm with the six-digit code the app shows (or the passkey itself). The device is registered: now choose below and Apply.</li>
          </ol>

          {state.file_notifier && (
            <div className="rounded-lg border border-white/5 bg-black/10 p-3 space-y-2" aria-live="polite">
              <div className="flex items-center gap-2 flex-wrap">
                <KeyRound size={12} className="text-amber-300" aria-hidden />
                <span className="text-xs text-slate-300 flex-1 min-w-0">Your verification code</span>
                <button type="button" onClick={watch} className={BTN_CARD_QUIET}>
                  {watching ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} {code ? 'Look again' : 'Show the latest code'}
                </button>
              </div>
              {code && code.found && code.code && (
                <div className="flex items-center gap-3 flex-wrap">
                  <span className={`font-mono text-xl tracking-[0.25em] ${code.fresh ? 'text-slate-100' : 'text-slate-500 line-through'}`}>{code.code}</span>
                  <button type="button" aria-label="Copy the verification code" onClick={() => copyCode(code.code as string)} className={BTN_CARD_QUIET}>
                    {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
                  </button>
                  <span className="text-[11px] text-slate-500">
                    {code.sent_at ? new Date(code.sent_at * 1000).toLocaleTimeString() : ''}{code.age_seconds != null ? ` (${ago(code.age_seconds)})` : ''}
                    {code.recipient ? ` · for ${code.recipient}` : ''}
                  </span>
                </div>
              )}
              {code && code.found && !code.code && (
                <p className="text-[11px] text-slate-500">Authelia's last message ({code.subject || 'no subject'}, {ago(code.age_seconds)}) has no code in it.</p>
              )}
              {code && code.found && code.code && !code.fresh && (
                <p className="text-[11px] text-amber-300">This code is older than five minutes, the time a code lasts: ask Authelia for a new one.</p>
              )}
              {code && !code.found && <p className="text-[11px] text-slate-500">{code.message}</p>}
              {watching && <p className="text-[11px] text-slate-500">Looking for a new code every few seconds for five minutes.</p>}
              {!code && <p className="text-[11px] text-slate-500">Ask Authelia for a code (step 3), then show it here. Only admins see it.</p>}
            </div>
          )}
        </div>

        {/* 2. choose */}
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-3">
          <p className={SECTION_LABEL} id="second-step-label">2 · Second step at sign-in</p>
          <div role="radiogroup" aria-labelledby="second-step-label" className="flex gap-2 flex-wrap">
            {MODES.map((m) => (
              <button key={m.id} type="button" role="radio" aria-checked={mode === m.id} onClick={() => setMode(m.id)}
                className={`${CHOICE} ${mode === m.id ? CHOICE_ON : CHOICE_OFF}`}>
                {m.id === 'off' ? <KeyRound size={12} aria-hidden /> : <ShieldCheck size={12} aria-hidden />} {m.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-slate-500">{MODES.find((m) => m.id === mode)?.hint}</p>

          {mode === 'apps' && (
            <div className="space-y-2">
              {listed.length === 0 && <p className="text-[11px] text-slate-500">No app sits behind Authelia yet: name one below.</p>}
              {listed.length > 0 && (
                <ul className="flex gap-1.5 flex-wrap" aria-label="Apps behind Authelia">
                  {listed.map((name) => {
                    const c = choices.find((x) => x.name === name)
                    const on = apps.includes(name)
                    return (
                      <li key={name}>
                        <button type="button" role="checkbox" aria-checked={on} onClick={() => toggleApp(name)} title={c ? (c.where === 'vm' ? `${c.host} (in a VM)` : c.where ? `${c.host} (${c.where})` : c.host) : 'no route behind Authelia found for it now'}
                          className={`${CHOICE_SM} ${FOCUS_RING} ${on ? CHOICE_ON : CHOICE_OFF}`}>
                          {on ? <Check size={11} aria-hidden /> : <Plus size={11} aria-hidden />}
                          <span className="font-mono">{c ? c.host : state.domain ? `${name}.${state.domain}` : name}</span>
                          {!c && <X size={11} className="text-slate-500" aria-hidden />}
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
              <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); addOther() }}>
                <input type="text" value={other} onChange={(e) => setOther(e.target.value)} aria-label="Another app's name under your domain"
                  placeholder={state.domain ? `another app: pve or pve.${state.domain}` : 'another app: pve'}
                  className="flex-1 min-w-[12rem] rounded-md bg-black/20 border border-white/10 px-2 py-1 text-xs text-slate-200 font-mono" />
                <button type="submit" disabled={!other.trim()} className={BTN_CARD_QUIET}><Plus size={12} /> Add to the list</button>
              </form>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap pt-1">
            <button type="button" onClick={apply} disabled={!canApply} className={`${BTN_CARD} ${TONE_OK}`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <ShieldCheck size={12} />} Apply
            </button>
            {changed && <span className="text-[11px] text-slate-500">Authelia restarts to read it (a few seconds; nobody is signed out).</span>}
            {mode !== 'off' && <span className="text-[11px] text-slate-500">A user with no device registered is sent to the registration at sign-in, not locked out.</span>}
          </div>

          <div className="rounded-lg border border-cyan-500/15 bg-cyan-500/5 p-2.5 flex gap-2">
            <LifeBuoy size={14} className="text-cyan-300 shrink-0 mt-0.5" aria-hidden />
            <p className="text-[11px] text-slate-400">
              <span className="text-slate-200">The way back.</span> This dashboard has its own sign-in (its own accounts), separate from Authelia's.
              Opened on your network at port 3000 of this server, it never goes through Authelia: you can always come back here and choose Password only.
              Authelia also locks a user for five minutes after three wrong tries.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
