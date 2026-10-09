// =============================================================================
// Hub: CrowdSec's library. Collections (bundles for one service), scenarios
// (attack detectors) and parsers (log readers): what is installed, what is
// recommended for a Traefik and SSH server, a search for more, and the updates.
// Installing, removing and upgrading download from the internet and reload
// CrowdSec, so they can take a while: one runs at a time and the page says so.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Package, Sparkles, Plus, Trash2, RefreshCw, CircleArrowUp, Loader2, X, AlertTriangle, ChevronDown, Info } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { ApiTimeoutError } from '../../api/client'
import { crowdsecHub, crowdsecHubAvailable, crowdsecHubInstall, crowdsecHubRemove, crowdsecHubUpdate, crowdsecHubUpgrade } from '../../api/endpoints'
import type { CrowdSecHubAvailableResponse, CrowdSecHubItem, CrowdSecHubResponse } from '../../../shared/types'
import { errMsg, fmtNum, useCs, useDebounced, useNow } from './kit'
import { BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { CARD } from '../../lib/pageKit'
import { Pill } from '../common/Pill'
import SectionHeader from '../common/SectionHeader'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import SearchInput from '../common/SearchInput'
type Kind = 'collections' | 'scenarios' | 'parsers'
const KINDS: { value: Kind; label: string; one: string; blurb: string; tries: string[] }[] = [
  { value: 'collections', label: 'Collections', one: 'collection', blurb: 'A collection is a ready-made bundle for one service, such as Traefik or SSH. It brings the scenarios and parsers that service needs.', tries: ['nginx', 'wordpress', 'postfix', 'mysql', 'appsec'] },
  { value: 'scenarios', label: 'Scenarios', one: 'scenario', blurb: 'A scenario is one attack detector, for example “too many failed SSH logins in a short time”.', tries: ['ssh', 'http', 'cve', 'brute'] },
  { value: 'parsers', label: 'Parsers', one: 'parser', blurb: 'A parser teaches CrowdSec to read one kind of log line, so the scenarios can tell what happened.', tries: ['nginx', 'syslog', 'traefik', 'docker'] },
]
const AVAILABLE_SHOWN = 40

/** What a person should know before removing the things a Traefik and SSH server leans on. (The API does not stop a removal, so the warning is ours.) */
const RELIED_ON: Record<string, string> = {
  'crowdsecurity/traefik': 'This is what lets CrowdSec read Traefik’s access log. Without it, web attacks on your sites go unseen and nothing is banned from that log.',
  'crowdsecurity/base-http-scenarios': 'These are the core web-attack detectors: probing, bad user agents, sensitive files, path traversal, SQL injection. Without them most scanners go unnoticed.',
  'crowdsecurity/http-cve': 'This catches exploit attempts for known vulnerabilities in web requests. Without it those attacks are no longer detected.',
  'crowdsecurity/linux': 'This teaches CrowdSec to read the server’s own log and covers SSH logins. Without it, attacks on the server itself go unseen.',
  'crowdsecurity/sshd': 'This detects SSH password guessing. Without it, brute-force attempts on SSH are no longer noticed.',
  'crowdsecurity/whitelist-good-actors': 'This keeps search engines, CDNs and public DNS servers from being banned by mistake. Without it they could be.',
}

/** the message of a failed hub call; a timeout says that the server may still be at it */
function hubError(e: unknown, fallback: string): string {
  if (e instanceof ApiTimeoutError) return 'CrowdSec did not answer in time. The server may still be working on it: check the list again in a minute.'
  const m = errMsg(e, fallback)
  return m.length > 320 ? `${m.slice(0, 317)}…` : m
}

type Op = 'install' | 'remove' | 'update' | 'upgrade'
interface Busy { op: Op; name?: string; since: number }
const BUSY_TEXT: Record<Op, (name?: string) => string> = {
  install: (n) => `Installing ${n}… CrowdSec downloads it from the hub and reloads. That usually takes under half a minute, and up to two on a slow connection.`,
  remove: (n) => `Removing ${n}… then CrowdSec reloads without it. This takes a few seconds.`,
  update: () => 'Asking the hub what is new… This needs internet access from the server and can take up to two minutes.',
  upgrade: () => 'Upgrading everything that has a newer version… CrowdSec downloads each one, then reloads. This can take a few minutes.',
}

function BusyBanner({ busy }: { busy: Busy }) {
  const now = useNow()
  const s = Math.max(0, Math.round((now - busy.since) / 1000))
  return (
    <div className="rounded-xl bg-cyan-500/10 border border-cyan-500/20 px-4 py-3 flex items-start gap-3" role="status" aria-live="polite">
      <Loader2 size={16} className="animate-spin text-cyan-400 shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-slate-200 break-words">{BUSY_TEXT[busy.op](busy.name)}</p>
        <p className="text-[11px] text-slate-500 mt-0.5 tabular-nums">{s} second{s === 1 ? '' : 's'} so far. The other hub buttons wait until this is done.</p>
      </div>
    </div>
  )
}

/** "crowdsecurity/http-cve" with the owner dimmed */
function HubName({ name, className = '' }: { name: string; className?: string }) {
  const i = name.indexOf('/')
  return (
    <span className={`min-w-0 break-all ${className}`} title={name}>
      {i > 0 && <span className="text-slate-500">{name.slice(0, i + 1)}</span>}
      <span className="text-slate-100">{i > 0 ? name.slice(i + 1) : name}</span>
    </span>
  )
}

function StatusChips({ item }: { item: CrowdSecHubItem }) {
  return (
    <>
      {item.update && <Pill tone="info" title="A newer version is in the hub. “Upgrade all” installs it.">update available</Pill>}
      {item.local && <Pill tone="neutral" title="A file you added yourself, not something from the hub. The hub never updates or removes it.">custom</Pill>}
      {item.tainted && <Pill tone="attention" title="You edited this file after installing it. Upgrades leave edited files alone. Remove it and install it again to get the original back.">edited</Pill>}
      {!item.enabled && <Pill tone="neutral" title="Downloaded but switched off: CrowdSec does not use it.">off</Pill>}
    </>
  )
}

export default function HubTab() {
  const { member, isAdmin, refreshStatus } = useCs()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [kind, setKind] = useState<Kind>('collections')
  const [filter, setFilter] = useState('')
  const [search, setSearch] = useState('')
  const dsearch = useDebounced(search.trim(), 350)
  const [busy, setBusy] = useState<Busy | null>(null)
  const [showRec, setShowRec] = useState<boolean | null>(null)

  // ---- what is installed ----
  const [hub, setHub] = useState<CrowdSecHubResponse | null>(null)
  const [err, setErr] = useState('')
  const reload = useCallback(async (): Promise<CrowdSecHubResponse | null> => {
    try {
      const r = await crowdsecHub(member)
      setHub(r); setErr('')
      return r
    } catch (e) {
      setErr(errMsg(e, 'Could not read the hub'))
      return null
    }
  }, [member])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => {
    if (!isConnected || busy) return
    const t = setInterval(() => { if (!document.hidden) void reload() }, 30000)
    return () => clearInterval(t)
  }, [isConnected, busy, reload])

  // ---- what could be installed ----
  const [avail, setAvail] = useState<{ key: string; res: CrowdSecHubAvailableResponse } | null>(null)
  const [availErr, setAvailErr] = useState('')
  const [availLoading, setAvailLoading] = useState(false)
  const [tick, setTick] = useState(0)
  const availKey = `${kind}|${dsearch}`
  useEffect(() => {
    if (dsearch.length < 2) { setAvail(null); setAvailErr(''); setAvailLoading(false); return }
    let live = true
    setAvailLoading(true); setAvailErr('')
    crowdsecHubAvailable(kind, dsearch, AVAILABLE_SHOWN, member)
      .then((r) => { if (live) setAvail({ key: `${kind}|${dsearch}`, res: r }) })
      .catch((e) => { if (live) setAvailErr(errMsg(e, 'Could not search the hub')) })
      .finally(() => { if (live) setAvailLoading(false) })
    return () => { live = false }
  }, [kind, dsearch, member, tick])

  const k = KINDS.find((x) => x.value === kind) as (typeof KINDS)[number]
  const installed = hub?.installed[kind] ?? []
  const shown = useMemo(() => {
    const f = filter.trim().toLowerCase()
    return f ? installed.filter((i) => `${i.name} ${i.description}`.toLowerCase().includes(f)) : installed
  }, [installed, filter])
  const updatesTotal = hub?.counts.updates ?? 0
  const suggestions = hub?.suggestions ?? []
  const recInstalled = suggestions.filter((s) => s.installed).length
  const recOpen = showRec ?? recInstalled < suggestions.length
  const allItems = useMemo(() => (hub ? [...hub.installed.collections, ...hub.installed.scenarios, ...hub.installed.parsers] : []), [hub])
  const updateOf = (name: string) => allItems.find((i) => i.name === name)?.update ?? false
  const locked = busy !== null

  // ---- the four things that change the hub ----
  const finish = useCallback(() => { refreshStatus(); setTick((n) => n + 1) }, [refreshStatus])

  const install = async (kd: Kind, name: string) => {
    if (busy) return
    setBusy({ op: 'install', name, since: Date.now() })
    try {
      await crowdsecHubInstall(kd, name, member)
      const fresh = await reload()
      const there = fresh ? fresh.installed[kd].some((i) => i.name === name) : true
      addToast(there
        ? { type: 'success', message: `Installed ${name}. CrowdSec is reloading to use it; the new detections start within a few seconds.`, duration: 6500 }
        : { type: 'warning', message: `CrowdSec accepted ${name}, but it does not show as installed yet. Look again in a moment.`, duration: 8000 })
      finish()
    } catch (e) {
      // the answer failed, but the job may have been done: look before saying it was not
      const fresh = await reload()
      const done = !!fresh && fresh.installed[kd].some((i) => i.name === name)
      addToast(done
        ? { type: 'warning', message: `${name} is installed, although the server reported a problem: ${hubError(e, 'no details')}`, duration: 9000 }
        : { type: 'error', message: hubError(e, `Could not install ${name}`), duration: 8000 })
      if (done) finish()
    } finally { setBusy(null) }
  }

  const remove = async (kd: Kind, item: CrowdSecHubItem) => {
    if (busy) return
    const last = kd === 'collections' && (hub?.installed.collections.length ?? 0) <= 1
    const message = [
      RELIED_ON[item.name] ?? '',
      last ? 'It is your last collection: CrowdSec would have nothing left to detect with.' : '',
      kd !== 'collections' ? 'If a collection you installed needs it, CrowdSec keeps it and nothing changes. Remove the collection instead.' : '',
      'CrowdSec reloads without it. You can install it again from “Find more”.',
    ].filter(Boolean).join('\n\n')
    if (!(await confirm({ title: `Remove ${item.name}?`, message, confirmLabel: 'Remove', danger: true }))) return
    setBusy({ op: 'remove', name: item.name, since: Date.now() })
    try {
      await crowdsecHubRemove(kd, item.name, member)
      const fresh = await reload()
      const still = fresh ? fresh.installed[kd].some((i) => i.name === item.name) : false
      addToast(still
        ? { type: 'warning', message: `${item.name} is still installed: ${kd === 'collections' ? 'another collection may need it, so CrowdSec kept it' : 'a collection you installed needs it, so CrowdSec kept it. Remove that collection instead'}.`, duration: 9000 }
        : { type: 'success', message: `Removed ${item.name}. CrowdSec is reloading without it.`, duration: 6000 })
      finish()
    } catch (e) {
      const fresh = await reload()
      const done = !!fresh && !fresh.installed[kd].some((i) => i.name === item.name)
      addToast(done
        ? { type: 'warning', message: `${item.name} is removed, although the server reported a problem: ${hubError(e, 'no details')}`, duration: 9000 }
        : { type: 'error', message: hubError(e, `Could not remove ${item.name}`), duration: 8000 })
      if (done) finish()
    } finally { setBusy(null) }
  }

  const checkUpdates = async () => {
    if (busy) return
    setBusy({ op: 'update', since: Date.now() })
    try {
      await crowdsecHubUpdate(member)
      const fresh = await reload()
      const n = fresh?.counts.updates ?? 0
      addToast({
        type: 'success',
        message: !fresh
          ? 'The hub list is up to date, but what is installed could not be read again. Try again in a moment to see the updates.'
          : n > 0
            ? `The hub list is up to date. ${n} installed item${n === 1 ? ' has' : 's have'} a newer version; nothing is changed until you press “Upgrade all”.`
            : 'The hub list is up to date, and everything you have installed is the newest version.',
        duration: 7000,
      })
      finish()
    } catch (e) {
      addToast({ type: 'error', message: hubError(e, 'The hub did not answer'), duration: 8000 })
    } finally { setBusy(null) }
  }

  const upgradeAll = async () => {
    if (busy) return
    const names = allItems.filter((i) => i.update).map((i) => i.name)
    const n = names.length || updatesTotal
    const list = names.slice(0, 6).join('\n') + (names.length > 6 ? `\nand ${names.length - 6} more` : '')
    if (!(await confirm({
      title: `Upgrade ${n} item${n === 1 ? '' : 's'}?`,
      message: `${list ? `${list}\n\n` : ''}CrowdSec downloads the newer version${n === 1 ? '' : 's'} and reloads. Bans stay in place and detection restarts within a few seconds. This can take a couple of minutes.`,
      confirmLabel: 'Upgrade',
    }))) return
    setBusy({ op: 'upgrade', since: Date.now() })
    try {
      await crowdsecHubUpgrade(member)
      const fresh = await reload()
      const left = fresh?.counts.updates ?? 0
      addToast(left > 0
        ? { type: 'warning', message: `Upgraded, but ${left} item${left === 1 ? ' still has' : 's still have'} a newer version. An item you edited yourself is left alone.`, duration: 9000 }
        : { type: 'success', message: `Upgraded ${n} item${n === 1 ? '' : 's'}. CrowdSec is reloading with the new version${n === 1 ? '' : 's'}.${fresh ? '' : ' What is installed could not be read again yet.'}`, duration: 6500 })
      finish()
    } catch (e) {
      addToast({ type: 'error', message: hubError(e, 'The upgrade failed'), duration: 9000 })
      void reload()
    } finally { setBusy(null) }
  }

  const availNow = avail && avail.key === availKey ? avail.res : null
  const c = hub?.counts

  return (
    <div className="space-y-4">
      {/* what the hub is */}
      <section className={`${CARD} p-4`} aria-label="The hub">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1 basis-72">
            <h2 className="text-sm font-semibold text-slate-200 flex items-center gap-2"><Package size={15} className="text-slate-500" /> What CrowdSec knows how to detect</h2>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed max-w-2xl">
              The hub is CrowdSec’s public library of detection rules. <span className="text-slate-300">Collections</span> bundle what one service needs, <span className="text-slate-300">scenarios</span> are the attack detectors and <span className="text-slate-300">parsers</span> read the logs. Installing or removing one reloads CrowdSec; bans stay in place.
            </p>
            <p className="text-xs text-slate-300 mt-2 tabular-nums">
              {c ? <>{fmtNum(c.collections)} collection{c.collections === 1 ? '' : 's'} · {fmtNum(c.scenarios)} scenario{c.scenarios === 1 ? '' : 's'} · {fmtNum(c.parsers)} parser{c.parsers === 1 ? '' : 's'} installed</> : 'Reading what is installed…'}
              {c && c.updates > 0 && <Pill tone="info" className="ml-2 align-middle">{c.updates} update{c.updates === 1 ? '' : 's'} available</Pill>}
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" className={BTN_TOOLBAR_QUIET} disabled={locked || !hub} onClick={checkUpdates} title="Download the newest list of what the hub offers. Nothing is installed or changed yet.">
                {busy?.op === 'update' ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Check for updates
              </button>
              {updatesTotal > 0 && (
                <button type="button" className={BTN_TOOLBAR_OK} disabled={locked} onClick={upgradeAll} title="Install the newer version of everything that has one, then reload CrowdSec">
                  {busy?.op === 'upgrade' ? <Loader2 size={14} className="animate-spin" /> : <CircleArrowUp size={14} />} Upgrade all ({updatesTotal})
                </button>
              )}
            </div>
          )}
        </div>
      </section>

      {busy && <BusyBanner busy={busy} />}

      {err && !hub && (
        <div className={`${CARD} p-4 flex items-start gap-3`} role="alert">
          <AlertTriangle size={16} className="text-rose-400 shrink-0 mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-rose-300 break-words">{err}</p>
            <p className="text-xs text-slate-500 mt-1">The list of installed items could not be read. CrowdSec may be restarting.</p>
            <button type="button" onClick={() => void reload()} className={`${BTN_TOOLBAR_QUIET} mt-3`}><RefreshCw size={14} /> Try again</button>
          </div>
        </div>
      )}
      {err && hub && (
        <p className="text-xs text-amber-300 flex items-center gap-2 flex-wrap rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2" role="status">
          <AlertTriangle size={13} className="shrink-0" /> <span className="min-w-0">Could not refresh the list ({err}). Showing the last answer.</span>
          <button type="button" onClick={() => void reload()} className="text-cyan-400 hover:text-cyan-300 hover:underline underline-offset-2">Try again</button>
        </p>
      )}
      {!hub && !err && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading the hub">
          <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5">{[0, 1, 2, 3].map((i) => <SkeletonBlock key={i} className="h-24" />)}</div>
          <SkeletonBlock className="h-9 w-72" />
          {[0, 1, 2, 3, 4].map((i) => <SkeletonBlock key={i} className="h-14" />)}
        </div>
      )}

      {hub && suggestions.length > 0 && (
        <section aria-label="Recommended for you">
          <SectionHeader
            icon={Sparkles}
            title="Recommended for you"
            count={`${recInstalled} of ${suggestions.length} installed`}
            className="mb-2"
            right={<button type="button" onClick={() => setShowRec(!recOpen)} aria-expanded={recOpen} className="text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1">{recOpen ? 'Hide' : 'Show'} <ChevronDown size={11} className={`transition-transform ${recOpen ? 'rotate-180' : ''}`} /></button>}
          />
          {recOpen && <p className="text-xs text-slate-500 mb-2">Bundles for a server with Traefik in front and SSH open. Each one works from logs CrowdSec already reads.</p>}
          {recOpen ? (
            <div className="flex sm:grid sm:grid-cols-2 xl:grid-cols-4 gap-2.5 overflow-x-auto sm:overflow-visible snap-x scrollbar-none -mx-1 px-1 pb-1 sm:mx-0 sm:px-0 sm:pb-0">
              {suggestions.map((sg) => (
                <div key={sg.name} className={`${CARD} p-3.5 flex flex-col gap-2 min-w-0 shrink-0 w-[16rem] sm:w-auto snap-start`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wider text-slate-500">{sg.group}</p>
                      <p className="text-sm font-medium text-slate-100 leading-snug">{sg.title}</p>
                    </div>
                    {sg.installed
                      ? <span className="flex items-center gap-1 flex-wrap justify-end"><Pill tone="ok">installed</Pill>{updateOf(sg.name) && <Pill tone="info">update</Pill>}</span>
                      : isAdmin
                        ? <button type="button" className={`${BTN_TOOLBAR_OK} !h-8`} disabled={locked} onClick={() => void install('collections', sg.name)} aria-label={`Install ${sg.title} (${sg.name})`}>
                          {busy?.op === 'install' && busy.name === sg.name ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Install
                        </button>
                        : <Pill tone="neutral">not installed</Pill>}
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed line-clamp-3">{sg.description}</p>
                  <p className="text-[10px] font-mono text-slate-500 truncate mt-auto" title={sg.name}>{sg.name}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-500">You have every collection we recommend for a Traefik and SSH server.</p>
          )}
        </section>
      )}

      {hub && (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <Segmented<Kind>
              value={kind}
              onChange={(v) => { setKind(v); setFilter('') }}
              ariaLabel="What to look at"
              options={KINDS.map((x) => ({ value: x.value, label: x.label, count: hub.installed[x.value].length, title: x.blurb }))}
            />
            <p className="text-xs text-slate-500 min-w-0 basis-64 flex-1">{k.blurb}</p>
          </div>

          {/* installed */}
          <section aria-label={`Installed ${k.label.toLowerCase()}`}>
            <SectionHeader
              title={`Installed ${k.label.toLowerCase()}`}
              count={filter && shown.length !== installed.length ? `${shown.length} of ${installed.length}` : installed.length}
              className="mb-2"
              right={installed.length > 8 ? (
                <SearchInput size="sm" className="w-full sm:w-64" id="hub-filter" value={filter} onChange={setFilter} label={`Filter the installed ${k.label.toLowerCase()}`} placeholder={`Filter these ${installed.length}`} autoComplete="off" />
              ) : undefined}
            />
            {installed.length === 0 ? (
              <div className={`${CARD} px-6 py-10 text-center`}>
                <Package size={26} className="mx-auto text-slate-500" />
                <p className="mt-3 text-sm text-slate-300">No {k.label.toLowerCase()} installed.</p>
                <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">{kind === 'collections' ? 'Without a collection CrowdSec has nothing to detect with. Install one of the recommended ones above.' : `Search below to add ${k.one === 'parser' ? 'a parser' : 'a scenario'} on its own.`}</p>
              </div>
            ) : shown.length === 0 ? (
              <div className={`${CARD} px-6 py-8 text-center`}>
                <p className="text-sm text-slate-300">None of the {installed.length} installed {k.label.toLowerCase()} matches “{filter}”.</p>
                <button type="button" onClick={() => setFilter('')} className={`${BTN_TOOLBAR_QUIET} mt-3`}><X size={14} /> Clear the filter</button>
              </div>
            ) : (
              <ul className={`${CARD} divide-y divide-white/5`}>
                {shown.map((it) => (
                  <li key={it.name} className="px-4 py-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <HubName name={it.name} className="text-sm" />
                        {it.version && <span className="text-[11px] text-slate-500 tabular-nums shrink-0" title="Installed version">v{it.version}</span>}
                        <StatusChips item={it} />
                      </div>
                      {it.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{it.description}</p>}
                    </div>
                    {isAdmin && !it.local && (
                      <button type="button" className={`${BTN_TOOLBAR_QUIET} !h-8 !px-2.5 hover:!bg-rose-500/15 hover:!text-rose-300 hover:!border-rose-500/25`} disabled={locked} onClick={() => void remove(kind, it)} aria-label={`Remove ${it.name}`} title={`Remove ${it.name}`}>
                        {busy?.op === 'remove' && busy.name === it.name ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}<span className="hidden sm:inline">Remove</span>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* find more */}
          <section aria-label={`Find more ${k.label.toLowerCase()}`}>
            <SectionHeader title={`Find more ${k.label.toLowerCase()}`} className="mb-2" />
            <div className={`${CARD} p-4 space-y-3`}>
              <div>
                <SearchInput id="hub-search" value={search} maxLength={80} onChange={setSearch} label={`Search the hub for ${k.label.toLowerCase()}`} placeholder={`Search the hub, for example ${k.tries[0]}`} autoComplete="off" spellCheck={false} />
                <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1.5 flex-wrap">
                  <span>Type at least two letters. It searches names and descriptions. Try</span>
                  {k.tries.map((t) => <button key={t} type="button" onClick={() => setSearch(t)} className="px-2 h-7 sm:h-5 sm:px-1.5 rounded-md bg-white/5 border border-white/10 text-slate-300 hover:bg-white/10">{t}</button>)}
                </p>
              </div>

              {dsearch.length >= 2 && availErr && (
                <div className="rounded-lg bg-rose-500/[0.08] border border-rose-500/25 px-3 py-2.5 text-sm text-rose-300 flex items-start gap-2" role="alert">
                  <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-400" />
                  <div className="min-w-0"><p className="break-words">{availErr}</p><button type="button" onClick={() => setTick((n) => n + 1)} className="mt-1.5 text-[11px] text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1"><RefreshCw size={11} /> Try again</button></div>
                </div>
              )}
              {dsearch.length >= 2 && !availErr && !availNow && <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <SkeletonBlock key={i} className="h-12" />)}</div>}
              {availNow && availNow.items.length === 0 && (
                <p className="text-sm text-slate-300 py-3 text-center">Nothing in the hub matches “{dsearch}”. Try a shorter word.</p>
              )}
              {availNow && availNow.items.length > 0 && (
                <div className={availLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
                  <ul className="divide-y divide-white/5 rounded-lg border border-white/5">
                    {availNow.items.map((it) => (
                      <li key={it.name} className="px-3.5 py-2.5 flex items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <HubName name={it.name} className="text-sm" />
                            {it.installed && <Pill tone="ok">installed</Pill>}
                            {it.installed && it.update && <Pill tone="info" title="A newer version is in the hub. “Upgrade all” installs it.">update available</Pill>}
                          </div>
                          {it.description && <p className="text-xs text-slate-500 mt-0.5 leading-relaxed">{it.description}</p>}
                        </div>
                        {isAdmin && !it.installed && (
                          <button type="button" className={`${BTN_TOOLBAR_OK} !h-8 !px-2.5`} disabled={locked} onClick={() => void install(kind, it.name)} aria-label={`Install ${it.name}`}>
                            {busy?.op === 'install' && busy.name === it.name ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Install
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="text-[11px] text-slate-500 mt-2 px-1">
                    {availNow.count > availNow.items.length
                      ? `Showing ${availNow.items.length}. ${fmtNum(availNow.count - availNow.items.length)} more match “${dsearch}”: refine your search to narrow it down.`
                      : `${availNow.items.length} match${availNow.items.length === 1 ? '' : 'es'} in ${fmtNum(availNow.total)} ${k.label.toLowerCase()} in the hub.`}
                  </p>
                </div>
              )}
              <p className="text-[11px] text-slate-500 flex items-start gap-1.5"><Info size={11} className="shrink-0 mt-0.5" /> The list comes from the hub index CrowdSec last downloaded. “Check for updates” fetches a newer one.</p>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
