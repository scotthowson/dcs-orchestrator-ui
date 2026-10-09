// =============================================================================
// DomainsPanel — the domains this server answers for. The primary one carries
// the hub's own stacks; the others are for VMs (each VM answers under one, the
// hub's by default) and for hub stacks that pick one at deploy time. One
// Cloudflare token covers them all: each domain gets its wildcard certificate,
// its sign-in (auth.<domain>) and its apex record on the public address.
// =============================================================================

import { useState } from 'react'
import { Globe, Plus, Trash2, Loader2, ShieldCheck, Lock, Server, Star, AlertTriangle } from 'lucide-react'
import type { DomainsResponse, DomainEntry } from '../../../shared/types'
import { addDomain, removeDomain, setVmDefaultDomain } from '../../api/endpoints'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import Hint from '../common/Hint'
import VmCapsule from '../fleet/VmCapsule'
import { BTN_CARD, BTN_ICON_SM, TONE_OK, TONE_GHOST_DANGER } from '../../lib/ui'
import { INPUT } from '../../lib/fieldStyles'
import { Pill } from '../common/Pill'
const DOMAIN_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?)+$/

function StatusChip({ ok, label, offLabel, title }: { ok: boolean | null; label: string; offLabel: string; title: string }) {
  if (ok === null) return null
  return ok
    ? <Pill tone="ok" icon={<ShieldCheck size={10} aria-hidden />} title={title}>{label}</Pill>
    : <Pill tone="attention" icon={<AlertTriangle size={10} aria-hidden />} title={title}>{offLabel}</Pill>
}

function DomainRow({ d, isAdmin, busy, onRemove }: { d: DomainEntry; isAdmin: boolean; busy: boolean; onRemove: () => void }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
      <Globe size={14} className={d.primary ? 'text-emerald-400' : 'text-cyan-400'} aria-hidden />
      <span className="text-sm font-mono text-slate-100">{d.domain}</span>
      {d.primary && <Pill tone="ok" icon={<Star size={10} aria-hidden />}>this server</Pill>}
      <StatusChip ok={d.certificate} label="certificate" offLabel="no certificate yet" title="The wildcard certificate *.domain Traefik asks Let's Encrypt for" />
      <StatusChip ok={d.sign_in} label="sign-in" offLabel="no sign-in" title={`Authelia's sign-in at auth.${d.domain}`} />
      <span className="flex flex-wrap items-center gap-1.5 ml-auto">
        {d.vms.map((v) => <VmCapsule key={v.id} member={v.id} name={v.name} vmid={v.vmid} size="xs" />)}
        {!d.primary && isAdmin && (
          <Hint label={d.vms.length ? 'VMs still answer under it: give them another domain first' : `Take ${d.domain} off this server`}>
            <button type="button" onClick={onRemove} disabled={busy || d.vms.length > 0} aria-label={`Remove ${d.domain}`} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER} disabled:opacity-40`}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
            </button>
          </Hint>
        )}
      </span>
    </li>
  )
}

export default function DomainsPanel({ data, isAdmin, onChanged }: { data: DomainsResponse; isAdmin: boolean; onChanged: () => void }) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [value, setValue] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState('')
  const [savingDefault, setSavingDefault] = useState(false)
  const typed = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\*\./, '')
  const valid = DOMAIN_RE.test(typed) && !data.domains.some((d) => d.domain === typed)

  const add = async () => {
    if (!valid) return
    setAdding(true)
    try {
      const r = await addDomain(typed)
      const failed = (r.dns ?? []).filter((x) => !x.ok)
      addToast({ type: failed.length ? 'warning' : 'success', message: failed.length ? `${typed} added, but Cloudflare: ${failed.map((x) => x.message).join('; ')}` : (r.message ?? `${typed} added`) })
      if (r.traefik_restarted || r.authelia_restarted) addToast({ type: 'info', message: 'Traefik and Authelia restart in a moment to load it' })
      setValue('')
      onChanged()
    } catch (e) {
      addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not add the domain' })
    } finally { setAdding(false) }
  }
  const remove = async (d: string) => {
    const ok = await confirm({
      title: `Remove ${d}?`,
      message: `${d} stops being one of this server's domains: no certificate or sign-in for it any more. Its DNS records stay in Cloudflare.`,
      confirmLabel: 'Remove', danger: true,
    })
    if (!ok) return
    setRemoving(d)
    try { await removeDomain(d); addToast({ type: 'success', message: `${d} removed` }); onChanged() }
    catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not remove the domain' }) }
    finally { setRemoving('') }
  }
  const setDefault = async (d: string) => {
    setSavingDefault(true)
    try { const r = await setVmDefaultDomain(d); addToast({ type: 'success', message: `New VMs answer under ${r.effective}` }); onChanged() }
    catch (e) { addToast({ type: 'error', message: e instanceof Error ? e.message : 'Could not save' }) }
    finally { setSavingDefault(false) }
  }

  const effectiveDefault = data.vm_default ?? data.primary ?? ''
  return (
    <div className="glass border border-white/5 rounded-xl p-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
        <div className="flex items-center gap-2 min-w-0">
          <Globe size={15} className="text-cyan-400" aria-hidden />
          <h3 className="text-sm font-semibold text-slate-200">Domains</h3>
          <Pill tone="neutral">{data.domains.length}</Pill>
        </div>
        {data.domains.length > 1 && (
          <label className="flex items-center gap-2 text-[11px] text-slate-400">
            <Server size={12} aria-hidden /> New VMs answer under
            <select
              value={effectiveDefault}
              disabled={!isAdmin || savingDefault}
              onChange={(e) => void setDefault(e.target.value === data.primary ? '' : e.target.value)}
              aria-label="The domain new VMs answer under"
              className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-xs text-slate-200 font-mono focus:outline-none focus:border-emerald-500/40"
            >
              {data.domains.map((d) => <option key={d.domain} value={d.domain}>{d.domain}{d.primary ? ' (this server)' : ''}</option>)}
            </select>
          </label>
        )}
      </div>
      <p className="text-[11px] text-slate-500 mb-2">
        The hub&apos;s stacks answer under {data.primary ? <span className="font-mono text-slate-400">{data.primary}</span> : 'its own domain'}. A VM answers under one of these (change it on the VM), and a stack you deploy here can pick one.
        {data.cloudflare ? ' One Cloudflare token covers them all.' : ' Store the Cloudflare token (Secrets) so each one gets its certificate and DNS.'}
      </p>

      <ul className="divide-y divide-white/[0.04]">
        {data.domains.map((d) => <DomainRow key={d.domain} d={d} isAdmin={isAdmin} busy={removing === d.domain} onRemove={() => void remove(d.domain)} />)}
      </ul>

      {isAdmin && data.primary && (
        <form className="mt-3 flex flex-col sm:flex-row gap-2" onSubmit={(e) => { e.preventDefault(); void add() }}>
          <div className="relative flex-1">
            <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" aria-hidden />
            <input
              type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder="another domain, e.g. example.org"
              aria-label="A domain to add" autoComplete="off" spellCheck={false}
              className={`${INPUT} !pl-8 font-mono !py-2`}
            />
          </div>
          <button type="submit" disabled={!valid || adding} className={`${BTN_CARD} ${TONE_OK} !h-9 justify-center`}>
            {adding ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add domain
          </button>
          {typed && !valid && <span className="text-[11px] text-slate-500 self-center">{data.domains.some((d) => d.domain === typed) ? 'already here' : 'a name like example.org'}</span>}
        </form>
      )}
      {!data.wildcard && data.domains.length > 1 && (
        <p className="mt-2 text-[11px] text-slate-500">Traefik asks for a certificate per address here (no wildcard list): each new address gets its own on first use.</p>
      )}
    </div>
  )
}
