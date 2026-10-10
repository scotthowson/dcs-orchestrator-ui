// The Technitium page's Devices tab (a device's recent queries, blocked ones marked, Allow / Block per row; admin
// only, the API refuses a viewer) and its Lists tab (the blocklists, the names allowed and blocked for everyone).

import { useCallback, useMemo, useState } from 'react'
import { Ban, CheckCircle2, ListChecks, MonitorSmartphone, Plus, Trash2, Loader2, Link2 } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import SearchInput from '../common/SearchInput'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { EmptyState, ErrorState, Skeleton } from '../common/PageState'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { apiErrorMessage } from '../../api/errors'
import { fetchTechnitiumActivity, fetchTechnitiumGroups, fetchTechnitiumLists, fetchTechnitiumStats, technitiumBlocklist, technitiumListName } from '../../api/endpoints'
import { BTN_CARD_QUIET, BTN_ICON_SM, TONE_GHOST_OK, TONE_GHOST_DANGER, TEXT_META } from '../../lib/ui'
import { INPUT, LABEL } from '../../lib/fieldStyles'

const time = (iso: string) => new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })

export function ActivityTab() {
  const { addToast } = useToast()
  const [client, setClient] = useState('')
  const [blockedOnly, setBlockedOnly] = useState(false)
  const [filter, setFilter] = useState('')
  const fetchClients = useCallback(() => fetchTechnitiumStats('lastDay'), [])
  const { data: stats } = usePolling(fetchClients, 60000, { key: 'technitium-stats:lastDay' })
  const { data: groups } = usePolling(fetchTechnitiumGroups, 60000, { key: 'technitium-groups' })
  const valid = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{2,39}$/i.test(client)
  const fetchLog = useCallback(() => fetchTechnitiumActivity({ client, blocked: blockedOnly, limit: 200 }), [client, blockedOnly])
  const { data, error, loading, refresh } = usePolling(fetchLog, 15000, { key: `technitium-activity:${client}:${blockedOnly}`, enabled: valid })
  const devices = useMemo(() => {
    const m = new Map<string, string>()
    for (const g of groups?.groups ?? []) for (const d of g.devices) m.set(d.ip, `${d.label || d.ip} (${g.name})`)
    for (const c of stats?.top_clients ?? []) if (!m.has(c.ip)) m.set(c.ip, c.name ?? c.ip)
    return [...m.entries()]
  }, [groups, stats])
  const rows = useMemo(() => (data?.entries ?? []).filter((e) => !filter || e.name.includes(filter.toLowerCase())), [data, filter])
  const act = async (list: 'allow' | 'block', name: string) => {
    try { const r = await technitiumListName(list, name); addToast({ type: 'success', message: r.message }); void refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
  }
  return (
    <Panel icon={MonitorSmartphone} title="A device's queries" sub="From both servers' query logs (kept 30 days), newest first.">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[12rem]">
            <label htmlFor="tt-client" className={LABEL}>Device</label>
            <select id="tt-client" className={INPUT} value={devices.some(([ip]) => ip === client) ? client : ''} onChange={(e) => setClient(e.target.value)}>
              <option value="">Pick a device…</option>
              {devices.map(([ip, name]) => <option key={ip} value={ip}>{name === ip ? ip : `${name} · ${ip}`}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label htmlFor="tt-client-ip" className={LABEL}>or its address</label>
            <input id="tt-client-ip" className={`${INPUT} font-mono`} value={client} onChange={(e) => setClient(e.target.value.trim())} placeholder="192.168.2.50" />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <SearchInput className="flex-1 min-w-[12rem]" size="sm" value={filter} onChange={setFilter} placeholder="Filter by name" label="Filter the queries by name" />
          <div className="w-56"><ToggleRow label="Blocked only" checked={blockedOnly} onChange={setBlockedOnly} /></div>
        </div>
        {!valid && <EmptyState compact icon={<MonitorSmartphone size={28} />} title="Pick a device" hint="Its queries of the last days show here, the blocked ones marked." />}
        {valid && loading && !data && <Skeleton rows={6} />}
        {valid && error && !data && <ErrorState title="Could not read the query log" error={error} onRetry={() => void refresh()} />}
        {valid && data && data.unavailable.length > 0 && <Notice tone="attention">{data.unavailable.map((u) => u.error).join(' ')}</Notice>}
        {valid && data && (rows.length === 0
          ? <EmptyState compact icon={<ListChecks size={28} />} title="No queries" hint={filter ? 'Nothing matches the filter.' : 'This device asked nothing in the log, or it uses another DNS server.'} />
          : (
            <div className="overflow-x-auto -mx-4 md:-mx-5">
              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-slate-500"><th className="px-4 md:px-5 py-2 font-medium">When</th><th className="py-2 font-medium">Name</th><th className="py-2 font-medium hidden sm:table-cell">Answer</th><th className="py-2 pr-4 md:pr-5 font-medium text-right"><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {rows.map((e, i) => (
                    <tr key={`${e.time}-${e.instance}-${i}`} className={`border-t border-white/5 ${e.blocked ? 'bg-rose-500/5' : ''}`}>
                      <td className="px-4 md:px-5 py-1.5 text-xs text-slate-500 whitespace-nowrap tabular-nums">{time(e.time)}</td>
                      <td className="py-1.5 font-mono text-xs text-slate-300 break-all">{e.name} <span className="text-slate-500">{e.type}</span></td>
                      <td className="py-1.5 hidden sm:table-cell">{e.blocked ? <Pill tone="problem" size="xs">Blocked</Pill> : <span className="text-xs text-slate-500">{e.response}</span>}</td>
                      <td className="py-1.5 pr-4 md:pr-5 text-right whitespace-nowrap">
                        {e.blocked
                          ? <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`} onClick={() => void act('allow', e.name)} aria-label={`Allow ${e.name} for everyone`} title="Allow for everyone"><CheckCircle2 size={14} /></button>
                          : <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} onClick={() => void act('block', e.name)} aria-label={`Block ${e.name} for everyone`} title="Block for everyone"><Ban size={14} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        {valid && data && <p className={TEXT_META}>{rows.length} of {data.entries.length} shown{data.entries.length >= 200 ? ' (the newest 200)' : ''}.</p>}
      </div>
    </Panel>
  )
}

export function ListsTab({ isAdmin }: { isAdmin: boolean }) {
  const { data, error, loading, refresh } = usePolling(fetchTechnitiumLists, 60000, { key: 'technitium-lists' })
  const { addToast } = useToast()
  const confirm = useConfirm()
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try { await fn(); addToast({ type: 'success', message: msg }); await refresh() } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
  }
  if (loading && !data) return <Skeleton rows={6} />
  if (error && !data) return <ErrorState title="Could not read the lists" error={error} onRetry={() => void refresh()} />
  if (!data) return null
  const label = (u: string) => (data.baseline_lists.includes(u) ? 'baseline' : data.categories.find((c) => c.url === u)?.name)
  return (
    <div className="space-y-4">
      <ListEditor icon={Link2} title="Blocklists" sub="Downloaded by Technitium every day; a name on any of them is blocked for everyone." items={data.blocklists} mono
        tag={label} isAdmin={isAdmin} placeholder="https://…/list.txt" valid={(v) => /^https?:\/\/\S+$/.test(v)}
        onAdd={(v) => run(() => technitiumBlocklist(v), 'The list is added: Technitium downloads it now')}
        onRemove={async (v) => { if (await confirm({ title: 'Remove this blocklist?', message: v, confirmLabel: 'Remove list', danger: true })) await run(() => technitiumBlocklist(v, true), 'The list is removed') }} />
      <div className="grid gap-4 lg:grid-cols-2">
        <ListEditor icon={CheckCircle2} title="Allowed for everyone" sub="Answered even when a blocklist has it." items={data.allowed} mono isAdmin={isAdmin} placeholder="example.com" valid={(v) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)}
          onAdd={(v) => run(() => technitiumListName('allow', v), `${v} is allowed`)}
          onRemove={(v) => run(() => technitiumListName('allow', v, true), `${v} is off the allowed list`)} />
        <ListEditor icon={Ban} title="Blocked for everyone" sub="Names you blocked yourself, and their subdomains." items={data.blocked} mono isAdmin={isAdmin} placeholder="ads.example.com" valid={(v) => /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(v)}
          onAdd={(v) => run(() => technitiumListName('block', v), `${v} is blocked`)}
          onRemove={(v) => run(() => technitiumListName('block', v, true), `${v} is off the blocked list`)} />
      </div>
    </div>
  )
}

function ListEditor({ icon, title, sub, items, mono, tag, isAdmin, placeholder, valid, onAdd, onRemove }: {
  icon: typeof Ban
  title: string
  sub: string
  items: string[]
  mono?: boolean
  tag?: (v: string) => string | undefined
  isAdmin: boolean
  placeholder: string
  valid: (v: string) => boolean
  onAdd: (v: string) => Promise<void>
  onRemove: (v: string) => Promise<void> | void
}) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const add = async () => { setBusy(true); await onAdd(value.trim()); setValue(''); setBusy(false) }
  return (
    <Panel icon={icon} title={title} sub={sub} badge={<Pill tone="neutral">{items.length}</Pill>}>
      {items.length ? (
        <ul className="divide-y divide-white/5">
          {items.map((v) => (
            <li key={v} className="flex items-center gap-2 py-1.5 min-w-0">
              <span className={`min-w-0 flex-1 text-sm text-slate-300 break-all ${mono ? 'font-mono text-xs' : ''}`}>{v}</span>
              {tag?.(v) && <Pill tone="neutral" size="xs">{tag(v)}</Pill>}
              {isAdmin && <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} onClick={() => void onRemove(v)} aria-label={`Remove ${v}`} title="Remove"><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
      ) : <p className={TEXT_META}>None.</p>}
      {isAdmin && (
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (valid(value.trim())) void add() }}>
          <input aria-label={`Add to ${title.toLowerCase()}`} className={`${INPUT} ${mono ? 'font-mono' : ''}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
          <button type="submit" className={BTN_CARD_QUIET} disabled={busy || !valid(value.trim())}>{busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add</button>
        </form>
      )}
    </Panel>
  )
}
