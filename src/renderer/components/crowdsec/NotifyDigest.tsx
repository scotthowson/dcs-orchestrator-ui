// =============================================================================
// The daily summary on the Discord tab: once a day at an hour of the server's
// clock, one message with the last 24 hours (attempts, addresses, the top
// addresses and attacks, the bans). A switch, the hour, "Send now", and what
// the last runs said. It is its own setting (CROWDSEC_DIGEST_HOUR): changing it
// restarts nothing. A viewer sees the same as words.
// =============================================================================

import { useEffect, useState } from 'react'
import { CalendarClock, Loader2, Send } from 'lucide-react'
import type { CrowdSecDigestOutcome, CrowdSecDigestView } from '../../../shared/types'
import { crowdsecSendDigest, crowdsecSetDigestHour } from '../../api/endpoints'
import { useToast } from '../common/Toast'
import { errMsg, fmtAgo, useNow } from './kit'
import { BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { INPUT } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import { Pill, Dot } from '../common/Pill'
import { Toggle } from '../common/Toggle'
const hh = (h: number): string => `${String(h).padStart(2, '0')}:00`

function outcomeLine(o: CrowdSecDigestOutcome | null, now: number): { tone: 'ok' | 'problem' | 'neutral' | 'attention'; text: string } | null {
  if (!o) return null
  const when = fmtAgo(o.at, now)
  if (o.running) return { tone: 'neutral', text: `Being sent (started ${when})` }
  if (o.skipped) return { tone: 'neutral', text: `${o.message ?? 'Not sent'} (${when})` }
  if (o.ok) {
    const n = o.attempts ?? 0, a = o.addresses ?? 0
    return { tone: 'ok', text: `Delivered ${when}: ${n === 0 ? 'a quiet day' : `${n.toLocaleString()} attempt${n === 1 ? '' : 's'} from ${a.toLocaleString()} address${a === 1 ? '' : 'es'}`}` }
  }
  return { tone: 'problem', text: `Not delivered ${when}: ${o.message ?? 'Discord did not take it'}${o.tries ? ` (try ${o.tries} of 3)` : ''}` }
}

export default function DigestCard({ digest, member, isAdmin, alertsOn, webhookReady, onChanged }: {
  digest: CrowdSecDigestView
  member: string | null
  isAdmin: boolean
  /** the Discord alerts are on (the summary is sent only then) */
  alertsOn: boolean
  /** a webhook is set (Send now needs one) */
  webhookReady: boolean
  onChanged: () => void
}) {
  const { addToast } = useToast()
  const now = useNow()
  const [view, setView] = useState<CrowdSecDigestView>(digest)
  useEffect(() => { setView(digest) }, [digest])
  const [lastHour, setLastHour] = useState<number>(digest.hour ?? digest.default_hour)
  const [saving, setSaving] = useState(false)
  const [sending, setSending] = useState(false)

  const setHour = async (h: number | 'off') => {
    if (!isAdmin || saving) return
    setSaving(true)
    try {
      const v = await crowdsecSetDigestHour(h, member)
      setView(v)
      if (typeof h === 'number') setLastHour(h)
      addToast({ type: 'success', message: h === 'off' ? 'The daily summary is off' : `The daily summary goes out at ${hh(h)}` })
      onChanged()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'The hour could not be saved'), duration: 8000 })
    } finally { setSaving(false) }
  }

  const sendNow = async () => {
    if (!isAdmin || sending) return
    setSending(true)
    try {
      const r = await crowdsecSendDigest(member)
      setView(r.digest)
      addToast(r.delivered ? { type: 'success', message: 'The summary was delivered to Discord' } : { type: 'error', message: r.message, duration: 8000 })
      onChanged()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, 'The summary could not be sent'), duration: 8000 })
    } finally { setSending(false) }
  }

  const on = view.enabled && view.hour !== null
  const when = on ? hh(view.hour as number) : null
  const next = !on ? 'Off' : view.next === 'tomorrow' ? `Tomorrow at ${when}` : view.next === 'soon' ? 'Within a minute' : `Today at ${when}`
  const today = outcomeLine(view.scheduled && view.scheduled.date ? view.scheduled : null, now)
  const last = view.last && view.last.kind === 'manual' ? outcomeLine(view.last, now) : null
  const sendBlocked = !webhookReady ? 'There is no webhook to post to yet' : null

  return (
    <section className={`${CARD} p-4 space-y-3`} aria-labelledby="notify-digest-title">
      <div className="flex items-start gap-3 flex-wrap">
        <span className="h-9 w-9 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 inline-flex items-center justify-center shrink-0"><CalendarClock size={16} /></span>
        <div className="min-w-0 flex-1 basis-56">
          <h3 id="notify-digest-title" className="text-sm font-medium text-slate-100 flex items-center gap-2 flex-wrap">
            Daily summary
            <Pill tone={on ? (alertsOn ? 'ok' : 'attention') : 'neutral'}>{on ? (alertsOn ? `every day at ${when}` : 'waits for the alerts') : 'off'}</Pill>
          </h3>
          <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">
            One message a day with the last 24 hours: how many attempts from how many addresses, the top addresses and attacks, and what happened to the bans.
            It goes to the same webhook as the alerts{alertsOn ? '' : ', and only while the alerts are on'}. The hour is this server&rsquo;s clock{view.timezone ? ` (${view.timezone})` : ''}.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        {isAdmin ? (
          <>
            <div className="flex items-center gap-2.5">
              <Toggle id="notify-digest-on" checked={on} onChange={(v) => void setHour(v ? lastHour : 'off')} label="Send a daily summary" disabled={saving} />
              <label htmlFor="notify-digest-on" className="text-sm text-slate-200 cursor-pointer">Send it every day</label>
            </div>
            <div className="flex items-center gap-2">
              <label htmlFor="notify-digest-hour" className="text-xs text-slate-500">at</label>
              <select id="notify-digest-hour" className={`${INPUT} !w-28 !h-9`} value={on ? String(view.hour) : String(lastHour)} disabled={saving || !on}
                onChange={(e) => void setHour(Number(e.target.value))} aria-label="The hour the summary goes out">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hh(h)}</option>)}
              </select>
              {saving && <Loader2 size={14} className="animate-spin text-slate-400" aria-label="Saving" />}
            </div>
            <button type="button" className={`${BTN_TOOLBAR_QUIET} sm:ml-auto`} onClick={sendNow} disabled={sending || !!sendBlocked} title={sendBlocked ?? 'Post the summary of the last 24 hours to Discord now, whatever the hour'}>
              {sending ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send now
            </button>
          </>
        ) : (
          <p className="text-sm text-slate-300">{on ? `Every day at ${when}` : 'Off'}</p>
        )}
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
        <dt className="text-slate-500">Next</dt>
        <dd className="text-slate-300">{next}{on && !alertsOn ? ' (only while the alerts are on)' : ''}</dd>
        {today && (<><dt className="text-slate-500">Today&rsquo;s</dt><dd className="text-slate-300 flex items-center gap-1.5 min-w-0"><Dot tone={today.tone} /><span className="break-words min-w-0">{today.text}</span></dd></>)}
        {last && (<><dt className="text-slate-500">Last sent by hand</dt><dd className="text-slate-300 flex items-center gap-1.5 min-w-0"><Dot tone={last.tone} /><span className="break-words min-w-0">{last.text}</span></dd></>)}
      </dl>
      {isAdmin && sendBlocked && <p className="text-[11px] text-slate-500">{sendBlocked}: choose one in the Webhook section and save.</p>}
    </section>
  )
}
