// =============================================================================
// ComposePolicyExceptions — the Config page's list of this server's own compose-policy exceptions (4.0.60):
// what an admin allowed with a deploy's or a save's consent, or by hand (PUT /config/compose-policy). One
// row each: the rule, the image or stack, the service, who added it and when, why; Remove sends the list
// back without it. The shipped exceptions (.config/compose-policy.json) are counted, not listed.
// =============================================================================

import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'
import { fetchComposePolicy, saveComposePolicy } from '../../api/endpoints'
import { apiErrorMessage, apiOutcome } from '../../api/errors'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { BTN_TOOLBAR, TONE_DANGER } from '../../lib/ui'
import type { ComposePolicyAllowEntry, ComposePolicyResponse } from '../../../shared/types'

function when(at?: string): string {
  if (!at) return ''
  const d = new Date(at)
  return Number.isNaN(d.getTime()) ? at : d.toLocaleString()
}

export default function ComposePolicyExceptions() {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [policy, setPolicy] = useState<ComposePolicyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<number | null>(null)

  const load = useCallback(() => {
    fetchComposePolicy()
      .then((p) => { setPolicy(p); setError(null) })
      .catch((err) => setError(apiOutcome(err).kind === 'forbidden' ? 'Admins see this server\'s exceptions' : apiErrorMessage(err, 'The compose policy could not be read')))
  }, [])
  useEffect(load, [load])

  const remove = async (i: number, e: ComposePolicyAllowEntry) => {
    if (!policy) return
    const what = `${e.rules.join(', ')} for ${e.image ? `the image ${e.image}` : e.stack ? `the stack ${e.stack}` : 'any image'}${e.service ? ` (service ${e.service})` : ''}`
    if (!(await confirm({ title: 'Remove the exception?', message: `The compose policy refuses ${what} again: a deploy or a save that needs it asks first.`, confirmLabel: 'Remove', danger: true }))) return
    setBusy(i)
    try {
      const allow = (policy.local.allow ?? []).filter((_, j) => j !== i)
      await saveComposePolicy({ ...policy.local, allow })
      addToast({ type: 'success', message: `Removed: ${what}` })
      load()
    } catch (err) {
      addToast({ type: 'error', message: apiErrorMessage(err, 'The exception could not be removed') })
    } finally {
      setBusy(null)
    }
  }

  if (error) return <p className="py-3 text-xs text-slate-500">{error}</p>
  if (!policy) return <p className="py-3 text-xs text-slate-500">Reading the compose policy…</p>
  const rows = policy.local.allow ?? []
  return (
    <div className="py-2 space-y-2" data-compose-policy-exceptions>
      <p className="text-xs text-slate-500 leading-relaxed">
        DCS ships {policy.shipped.allow?.length ?? 0} exceptions of its own. This server's are below: each allows a rule the policy
        otherwise refuses, for one image (or stack); removing one makes the policy refuse it again.
      </p>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">None: nothing beyond the shipped exceptions is allowed on this server.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((e, i) => (
            <li key={i} className="rounded-lg border border-white/5 bg-slate-900/40 px-3 py-2.5 flex flex-col sm:flex-row sm:items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {e.rules.map((r) => <code key={r} className="text-[11px] font-mono text-amber-200">{r}</code>)}
                  <span className="text-xs text-slate-300 font-mono break-all">{e.image ?? (e.stack ? `stack ${e.stack}` : 'any image')}</span>
                  {e.service && <span className="text-[11px] text-slate-400">service <span className="font-mono text-slate-300">{e.service}</span></span>}
                </div>
                <p className="text-xs text-slate-300 leading-5 mt-1 break-words">{e.reason}</p>
                {(e.added_by || e.added_at || e.source) && (
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {[e.added_by && `added by ${e.added_by}`, e.added_at && when(e.added_at), e.source && `on ${e.source}`].filter(Boolean).join(' · ')}
                  </p>
                )}
              </div>
              <button type="button" onClick={() => void remove(i, e)} disabled={busy !== null} className={`${BTN_TOOLBAR} ${TONE_DANGER} self-start`} aria-label={`Remove the exception ${e.rules.join(', ')} for ${e.image ?? e.stack ?? 'any image'}`}>
                <Trash2 size={13} aria-hidden /> Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
