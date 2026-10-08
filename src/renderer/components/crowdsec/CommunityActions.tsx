// =============================================================================
// The two things a person can do about the community from the page instead of
// a terminal:
//   Register again   when the central API refuses this engine (HTTP 403), give
//                    it a new registration; CrowdSec restarts, bans stay
//   Enrol            put this engine in the free CrowdSec Console with a key
//                    copied from app.crowdsec.net (the key is never shown back)
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { ExternalLink, KeyRound, Loader2, RotateCw } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecCommunityRegister, crowdsecConsoleEnroll } from '../../api/endpoints'
import { useSystemStore } from '../../stores/systemStore'
import { serverLabel } from '../../hooks/useBrand'
import type { CrowdSecConsoleEnrollResponse } from '../../../shared/types'
import { BTN_PRIMARY, BTN_QUIET, BTN_WARN, INPUT, LABEL, errData, errMsg, useCs } from './kit'

export const CONSOLE_URL = 'https://app.crowdsec.net'

/** the overview's "Enrol in the console" opens the Bouncers tab: the form scrolls into view and takes the focus once */
let focusEnrolNext = false
export function focusEnrolOnOpen(): void { focusEnrolNext = true }

/** "Register again": asks first, then re-registers and calls onDone (refetch) */
export function RegisterAgainButton({ onDone, label = 'Register again' }: { onDone: () => void; label?: string }) {
  const { member, refreshStatus } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState(false)
  const run = async () => {
    if (busy) return
    if (!(await confirm({
      title: 'Register with the community again?',
      message: 'Re-registers this engine with the CrowdSec community. Bans and settings stay; if the engine was enrolled in the console, enrol it again afterwards.',
      confirmLabel: label,
    }))) return
    setBusy(true)
    try {
      const r = await crowdsecCommunityRegister(member)
      addToast({ type: r.ok === false ? 'warning' : 'success', message: r.message || 'Registered with the CrowdSec community again', duration: 8000 })
      onDone(); refreshStatus()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'Could not register with the community'), duration: 9000 })
      onDone()
    } finally { setBusy(false) }
  }
  return (
    <button type="button" className={BTN_WARN} disabled={busy} onClick={run}>
      {busy ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} {busy ? 'Registering…' : label}
    </button>
  )
}

/** the key must never reach a toast, even if an answer repeats it */
function scrub(text: string, key: string): string {
  return key ? text.split(key).join('[key]') : text
}

type Outcome = { kind: 'done' | 'already' | 'register'; message: string; accept?: boolean }

/**
 * The enrol form, for admins on a server that is not enrolled. needsRegister: the community refuses the engine, so the
 * console would refuse it too; the form says to register again first.
 */
export function EnrolBox({ onDone, onEnrolled, needsRegister = false }: { onDone: () => void; onEnrolled?: () => void; needsRegister?: boolean }) {
  const { member, memberName } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const hostName = useSystemStore((s) => serverLabel(s.status))
  const defaultName = (member ? memberName : hostName) || ''
  const [key, setKey] = useState('')
  // null until the person types: the server's name may arrive after the form
  const [name, setName] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const keyRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!focusEnrolNext) return
    focusEnrolNext = false
    keyRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    keyRef.current?.focus({ preventScroll: true })
  }, [])

  const k = key.trim()
  const keyProblem = k && /\s/.test(k) ? 'The key is one word, without spaces.' : ''

  const send = async (overwrite: boolean) => {
    if (!k || keyProblem || busy) return
    if (overwrite && !(await confirm({
      title: 'Replace the existing enrolment?',
      message: 'This engine leaves the console account it is enrolled in now and joins the one this key belongs to. Accept it on app.crowdsec.net afterwards.',
      confirmLabel: 'Replace it',
    }))) return
    setBusy(true)
    const n = (name ?? defaultName).trim()
    const settle = (r: Partial<CrowdSecConsoleEnrollResponse>, fallback: string) => {
      const message = scrub(String(r.message || fallback), k)
      if (r.already_enrolled) { setOutcome({ kind: 'already', message }); return }
      if (r.needs_register) { setOutcome({ kind: 'register', message }); return }
      return message
    }
    try {
      const r = await crowdsecConsoleEnroll({ key: k, ...(n ? { name: n } : {}), ...(overwrite ? { overwrite: true } : {}) }, member)
      const message = settle(r, r.ok ? 'Enrolled' : 'CrowdSec did not enrol this engine')
      if (message !== undefined) {
        if (r.ok === false) {
          addToast({ type: 'error', message, duration: 9000 })
        } else {
          setKey('')
          const accept = r.needs_acceptance !== false
          setOutcome({ kind: 'done', message, accept })
          onEnrolled?.()
          addToast({ type: 'success', message: accept ? 'Enrolled: accept the engine on app.crowdsec.net' : 'Enrolled in the CrowdSec Console', duration: 7000 })
        }
      }
    } catch (e) {
      const message = settle(errData(e) as Partial<CrowdSecConsoleEnrollResponse>, errMsg(e, 'Could not enrol this engine'))
      if (message !== undefined) addToast({ type: 'error', message, duration: 9000 })
    } finally {
      setBusy(false)
      onDone()
    }
  }

  if (outcome?.kind === 'done' && !outcome.accept) return <p className="mt-2 text-xs text-emerald-300" role="status">{outcome.message}</p>
  if (outcome?.kind === 'done') {
    return (
      <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5" role="status">
        <p className="text-xs text-emerald-300 font-medium">One step left: open app.crowdsec.net and accept this engine.</p>
        <p className="text-xs text-slate-400 mt-1 leading-relaxed">It waits under Security Engines until someone accepts it. Its alerts appear in the console from then on.</p>
        <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" className={`${BTN_QUIET} mt-2`}><ExternalLink size={13} /> Open app.crowdsec.net</a>
      </div>
    )
  }

  return (
    <form className="mt-2 space-y-2.5" onSubmit={(e) => { e.preventDefault(); void send(false) }} autoComplete="off">
      <p className="text-xs text-slate-400 leading-relaxed">
        Optional. The CrowdSec Console is a free web console: your alerts online and more blocklists to pick from. Copy an enrolment key from{' '}
        <a href={CONSOLE_URL} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-0.5">app.crowdsec.net <ExternalLink size={11} aria-hidden="true" /></a>
        {' '}(Security Engines, Add Security Engine) and paste it here.
      </p>
      {needsRegister && (
        <p className="text-xs text-amber-300 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">The community service refuses this engine, so the console would too. Use Register again above first.</p>
      )}
      <div className="grid sm:grid-cols-2 gap-2.5">
        <div className="min-w-0">
          <label className={LABEL} htmlFor="cs-enrol-key">Enrolment key</label>
          <input ref={keyRef} id="cs-enrol-key" className={INPUT} type="password" value={key} onChange={(e) => { setKey(e.target.value); if (outcome) setOutcome(null) }}
            placeholder="Paste the key" autoComplete="off" spellCheck={false} disabled={busy} aria-invalid={!!keyProblem} />
          {keyProblem && <p className="text-[11px] text-rose-300 mt-1">{keyProblem}</p>}
        </div>
        <div className="min-w-0">
          <label className={LABEL} htmlFor="cs-enrol-name">Name in the console <span className="font-normal">(optional)</span></label>
          <input id="cs-enrol-name" className={INPUT} value={name ?? defaultName} onChange={(e) => setName(e.target.value)} placeholder="This server" maxLength={64} spellCheck={false} disabled={busy} />
        </div>
      </div>
      {outcome?.kind === 'already' && (
        <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <p className="text-xs text-amber-300 break-words">{outcome.message}</p>
          <button type="button" className={`${BTN_WARN} mt-2`} disabled={busy || !k || !!keyProblem} onClick={() => void send(true)}>Replace the existing enrolment</button>
        </div>
      )}
      {outcome?.kind === 'register' && (
        <p className="text-xs text-amber-300 rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 break-words" role="status">{outcome.message} Use Register again above, then enrol.</p>
      )}
      <div className="flex items-center gap-2 flex-wrap">
        <button type="submit" className={BTN_PRIMARY} disabled={busy || !k || !!keyProblem}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />} {busy ? 'Enrolling…' : 'Enrol'}
        </button>
        <span className="text-[11px] text-slate-500">CrowdSec keeps the key; this page never shows it again.</span>
      </div>
    </form>
  )
}
