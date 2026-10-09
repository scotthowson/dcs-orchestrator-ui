// =============================================================================
// Ban an address: an IP or a network, a length (presets, custom, or permanent =
// ten years) and a reason. The server refuses your own address, this server, the
// home address, LAN ranges and far too wide networks; its words are shown as is.
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { Ban, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecBan, crowdsecSettings } from '../../api/endpoints'
import { DurationPicker, PERMANENT, errData, errMsg, humanDuration, looksLikeTarget, parseDuration, canonicalDuration, useCs } from './kit'
import { BTN_TOOLBAR_DANGER, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { HINT, INPUT, LABEL } from '../../lib/fieldStyles'
import Sheet from '../common/Sheet'
const REASONS: Record<string, string> = {
  own: 'That is the address you are connected from.',
  server: 'That covers this server itself.',
  home: 'That is your home address, which DCS keeps allowed.',
  private: 'A private or local address can never be blocked at Traefik.',
  too_broad: 'That network is far too wide.',
  trusted: 'That is on the trusted list.',
  allowlisted: 'That address is on the allowlist.',
  already_banned: 'It is already banned for longer.',
}

/** how many addresses a network covers, when the server accepts it but it is a lot (a /8 to a /15 in IPv4, a /16 to a /31 in IPv6); wider ones the server refuses in its own words */
function wideNetwork(t: string): string | null {
  const [a, b] = t.split('/')
  if (b === undefined) return null
  const bits = Number(b)
  if (/^\d+\.\d+\.\d+\.\d+$/.test(a)) return bits >= 8 && bits < 16 ? `${(2 ** (32 - bits)).toLocaleString()} addresses` : null
  return bits >= 16 && bits < 32 ? 'an enormous number of addresses' : null
}

export default function BanSheet({ initialValue = '', initialReason = '', onClose, onDone }: { initialValue?: string; initialReason?: string; onClose: () => void; onDone: () => void }) {
  const { member, status, goTab } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [value, setValue] = useState(initialValue)
  const [duration, setDuration] = useState('24h')
  const [reason, setReason] = useState(initialReason)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; reason?: string } | null>(null)

  // the length the form starts with is the one Settings chose for manual bans
  useEffect(() => {
    let live = true
    crowdsecSettings(member).then((s) => { if (live && s.manual_duration) setDuration(s.manual_duration) }).catch(() => { /* the default stays */ })
    return () => { live = false }
  }, [member])

  const target = value.trim()
  const valid = looksLikeTarget(target)
  const perm = duration === PERMANENT
  const sec = perm ? null : parseDuration(duration)
  const durOk = perm || (sec !== null && sec >= 60 && sec <= 315360000)
  // (on a VM the client address is the hub's, not yours: no guard there)
  const own = !member && !!status?.client_ip && target === status.client_ip
  const label = perm ? 'permanently' : `for ${humanDuration(sec !== null ? canonicalDuration(sec) : duration)}`
  const hint = useMemo(() => {
    if (!target) return 'An address such as 203.0.113.7, an IPv6 address, or a network such as 203.0.113.0/24.'
    if (!valid) return 'That does not look like an IP address or a network.'
    if (own) return 'That is the address you are connected from: banning it would lock you out.'
    return target.includes('/') ? 'Every address in that network is banned.' : 'This one address is banned.'
  }, [target, valid, own])

  const submit = async () => {
    if (!valid || !durOk || busy) return
    if (perm && !(await confirm({ title: 'Ban permanently?', message: `${target} will be banned for ten years. CrowdSec has no ban without an end. You can lift it any time from the list.`, confirmLabel: 'Ban permanently', danger: true }))) return
    const wide = wideNetwork(target)
    if (wide && !(await confirm({ title: 'Ban a very large network?', message: `${target} covers ${wide}. Everyone on those addresses, including people who never did anything, is refused until the ban ends.`, confirmLabel: 'Ban it anyway', danger: true }))) return
    setBusy(true); setError(null)
    try {
      const r = await crowdsecBan(perm ? { value: target, permanent: true, reason: reason.trim() || undefined } : { value: target, duration, reason: reason.trim() || undefined }, member)
      addToast({ type: 'success', message: r.message || `${r.value} banned`, duration: 5000 })
      onDone(); onClose()
    } catch (e) {
      const d = errData(e)
      setError({ message: errMsg(e, 'The ban was refused'), reason: typeof d.reason === 'string' ? d.reason : undefined })
      setBusy(false)
    }
  }

  return (
    <Sheet
      title="Ban an address" subtitle="An IP address or a network. Traefik refuses it at the door." icon={<Ban size={18} />} tone="problem" onClose={onClose}
      footer={
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" onClick={onClose} className={BTN_TOOLBAR_QUIET}>Cancel</button>
          <button type="button" onClick={submit} disabled={!valid || !durOk || busy || own} className={`${BTN_TOOLBAR_DANGER} min-w-[10rem]`}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Ban size={13} />} {valid && durOk ? `Ban ${target.length > 22 ? `${target.slice(0, 20)}…` : target} ${label}` : 'Ban'}
          </button>
        </div>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); void submit() }} className="space-y-4">
        <div>
          <label className={LABEL} htmlFor="ban-address">Address or network</label>
          <input id="ban-address" autoFocus className={`${INPUT} font-mono ${target && !valid ? '!border-rose-500/40' : ''}`} value={value} onChange={(e) => { setValue(e.target.value); setError(null) }} placeholder="203.0.113.7 or 203.0.113.0/24" spellCheck={false} autoComplete="off" aria-invalid={!!target && !valid} aria-describedby="ban-address-hint" />
          <p id="ban-address-hint" className={`${HINT} ${own || (target && !valid) ? '!text-rose-300' : ''}`}>{hint}</p>
        </div>
        <div>
          <p className={LABEL}>How long</p>
          <DurationPicker value={duration} onChange={setDuration} allowPermanent maxSeconds={315360000} ariaLabel="Ban length" />
        </div>
        <div>
          <label className={LABEL} htmlFor="ban-reason">Reason <span className="text-slate-500 font-normal">(optional, shown in the list and in Discord)</span></label>
          <input id="ban-reason" className={INPUT} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="e.g. scanned my mail server" />
        </div>
        {error && (
          <div className="rounded-lg bg-rose-500/[0.08] border border-rose-500/25 px-3 py-2.5 text-sm text-rose-300 flex items-start gap-2" role="alert">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-400" />
            <div className="min-w-0">
              <p className="break-words">{error.message}</p>
              {error.reason && REASONS[error.reason] && error.reason !== 'already_banned' && <p className="text-[11px] text-rose-300 mt-1">{REASONS[error.reason]}</p>}
              {error.reason === 'allowlisted' && <button type="button" onClick={() => { onClose(); goTab('allowlist') }} className="mt-2 text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><ShieldCheck size={11} /> Open the allowlist</button>}
            </div>
          </div>
        )}
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Sheet>
  )
}
