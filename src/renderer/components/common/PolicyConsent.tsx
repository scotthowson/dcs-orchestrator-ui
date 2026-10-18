// =============================================================================
// PolicyConsent — what the compose policy refuses unless an admin allows it (4.0.60): one row per need or
// refusal (the rule, the service, why), each with a box "Allow for this image on this server", unticked. The
// ticked rows go with the deploy or the save as allow_policy; the server records each one it actually refused
// as this server's exception (listed, and removable, on the Config page). A refusal of the file itself (an
// include: outside the stack's folder) has no box: the file has to change.
//
//   <PolicyConsent title="This template needs" items={needItems(needs)} checked={consent} onToggle={toggle} />
// =============================================================================

import { useCallback, useState } from 'react'
import { ShieldAlert } from 'lucide-react'
import type { PolicyAllow, PolicyNeed, PolicyRefusal } from '../../../shared/types'

export interface ConsentItem {
  rule: string
  service: string | null
  /** why it is needed (a template's reason) or what the policy says about it */
  why: string
  image?: string | null
  line?: number | null
}

export const consentKey = (rule: string, service: string | null) => `${service ?? ''}|${rule}`

export function needItems(needs: PolicyNeed[] | undefined): ConsentItem[] {
  return (needs ?? []).map((n) => ({ rule: n.rule, service: n.service, why: n.reason }))
}

export function refusalItems(refusals: PolicyRefusal[] | undefined): ConsentItem[] {
  return (refusals ?? []).map((r) => ({ rule: r.rule, service: r.scope_suggestion ? r.service : null, why: r.message, image: r.image, line: r.line }))
}

/** the policy refusals of an error answer (a 422 of a deploy or a save), [] when it has none */
export function refusalsOf(data: Record<string, unknown>): PolicyRefusal[] {
  return Array.isArray(data.policy_refusals) ? data.policy_refusals as PolicyRefusal[] : []
}

/** the ticked rows as the API takes them: allowed for the image */
export function allowPolicy(checked: Set<string>): PolicyAllow[] {
  return [...checked].map((k) => {
    const i = k.indexOf('|')
    return { rule: k.slice(i + 1), service: k.slice(0, i) || undefined, scope: 'image' as const }
  })
}

/** the ticked rows (keys of consentKey), a toggle for one, and a way to clear them */
export function useConsent(): [Set<string>, (key: string, on: boolean) => void, (next: Set<string>) => void] {
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const toggle = useCallback((key: string, on: boolean) => setChecked((prev) => {
    const next = new Set(prev)
    if (on) next.add(key)
    else next.delete(key)
    return next
  }), [])
  return [checked, toggle, setChecked]
}

export default function PolicyConsent({ title, intro, items, checked, onToggle, disabled }: {
  title: string
  intro?: string
  items: ConsentItem[]
  checked: Set<string>
  onToggle: (key: string, on: boolean) => void
  disabled?: boolean
}) {
  if (items.length === 0) return null
  return (
    <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 space-y-2" data-policy-consent={title}>
      <div className="flex items-center gap-2">
        <ShieldAlert size={14} className="text-amber-400 shrink-0" aria-hidden />
        <p className="text-xs font-semibold text-amber-300">{title}</p>
      </div>
      {intro && <p className="text-[11px] text-slate-400 leading-relaxed">{intro}</p>}
      <ul className="space-y-2">
        {items.map((it) => {
          const key = consentKey(it.rule, it.service)
          return (
            <li key={key + (it.line ?? '')} className="rounded-md border border-white/5 bg-slate-900/40 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <code className="text-[11px] font-mono text-amber-200">{it.rule}</code>
                {it.service && <span className="text-[11px] text-slate-400">service <span className="font-mono text-slate-300">{it.service}</span></span>}
                {it.image && <span className="text-[11px] text-slate-500 font-mono break-all">{it.image}</span>}
                {it.line ? <span className="text-[11px] text-slate-500">line {it.line}</span> : null}
              </div>
              <p className="text-xs text-slate-300 leading-5 mt-1 break-words">{it.why}</p>
              {it.service ? (
                <label className="mt-1.5 inline-flex items-center gap-2 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-amber-500"
                    checked={checked.has(key)}
                    disabled={disabled}
                    onChange={(e) => onToggle(key, e.target.checked)}
                    aria-label={`Allow ${it.rule} for this image on this server (${it.service})`}
                  />
                  Allow for this image on this server
                </label>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">Not something to allow: the file has to change</p>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
