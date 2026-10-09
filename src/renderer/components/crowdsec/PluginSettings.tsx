// =============================================================================
// Settings: the Traefik bouncer plugin. The plugin is the part inside Traefik
// that refuses banned visitors; its own options (mode, how often it asks, how
// long it remembers an answer, the timeout, the status a banned visitor sees,
// the log level, and the two lists of addresses) live in the middleware file
// DCS wrote when it registered the bouncer. The API validates them, writes the
// file atomically, keeps the old one, and Traefik reloads it by itself.
// =============================================================================

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plug, Loader2, Save, RotateCcw, Info, TriangleAlert, ShieldCheck, Undo2 } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConnectionStore } from '../../stores/connectionStore'
import { usePolling } from '../../hooks/usePolling'
import { crowdsecPlugin, crowdsecSavePlugin } from '../../api/endpoints'
import type { CrowdSecPluginSettings } from '../../../shared/types'
import { errData, errMsg, fmtAgo, looksLikeTarget, useCs } from './kit'
import { Setting } from './SettingsTabParts'
import { BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { HINT, INPUT } from '../../lib/fieldStyles'
import { Pill } from '../common/Pill'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import { Toggle } from '../common/Toggle'
import Notice from '../common/Notice'
import { Panel } from '../dashboard/cardShared'
type Draft = { mode: 'live' | 'stream'; update_interval: string; default_decision_seconds: string; http_timeout: string; remediation_status_code: string; log_level: CrowdSecPluginSettings['log_level']; trust_home: boolean; client: string; forwarded: string }

const STATUS_PRESETS = [403, 401, 429]

const toDraft = (s: CrowdSecPluginSettings): Draft => ({
  mode: s.mode, update_interval: String(s.update_interval), default_decision_seconds: String(s.default_decision_seconds), http_timeout: String(s.http_timeout),
  remediation_status_code: String(s.remediation_status_code), log_level: s.log_level, trust_home: s.trust_home,
  client: s.client_trusted_ips.join('\n'), forwarded: s.forwarded_headers_trusted_ips.join('\n'),
})
/** one address or network per line (commas and spaces also separate) */
const listOf = (text: string): string[] => text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)

function wide(v: string): boolean {
  const [a, b] = v.split('/')
  if (b === undefined) return false
  const bits = Number(b)
  return a.includes(':') ? bits < 16 : bits < 8
}
function listProblem(text: string, max: number): string | undefined {
  const items = listOf(text)
  if (items.length > max) return `At most ${max} entries`
  const bad = items.find((x) => !looksLikeTarget(x))
  if (bad) return `Not an IP address or network: ${bad.slice(0, 40)}`
  const w = items.find(wide)
  if (w) return `${w} is far too wide: a list that says "everyone" switches the check off`
  return undefined
}
function numProblem(v: string, [lo, hi]: [number, number], unit: string): string | undefined {
  if (!/^\d{1,5}$/.test(v.trim())) return 'A whole number'
  const n = Number(v)
  return n < lo || n > hi ? `Between ${lo} and ${hi} ${unit}`.trim() : undefined
}

export default function PluginSettings() {
  const { member, isAdmin, status, refreshStatus, goTab } = useCs()
  const { addToast } = useToast()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const poll = usePolling(() => crowdsecPlugin(member), 60000, { enabled: isConnected })
  const data = poll.data
  const [draft, setDraft] = useState<Draft | null>(null)
  const [base, setBase] = useState<Draft | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  // the form is filled from the server once, and again after a save or a discard; a refresh in the background never touches what is being typed
  const loaded = !!data?.settings
  useEffect(() => {
    if (data?.settings && draft === null) { const d = toDraft(data.settings); setDraft(d); setBase(d) }
  }, [data, draft])

  const lim = data?.limits
  const problems = useMemo(() => {
    if (!draft || !lim) return {} as Record<string, string | undefined>
    return {
      update_interval: numProblem(draft.update_interval, lim.update_interval, 'seconds'),
      default_decision_seconds: numProblem(draft.default_decision_seconds, lim.default_decision_seconds, 'seconds'),
      http_timeout: numProblem(draft.http_timeout, lim.http_timeout, 'seconds'),
      remediation_status_code: numProblem(draft.remediation_status_code, lim.remediation_status_code, ''),
      client: listProblem(draft.client, lim.list_max),
      forwarded: listProblem(draft.forwarded, lim.forwarded_max),
    }
  }, [draft, lim])
  const invalid = Object.values(problems).some(Boolean)
  const dirty = !!draft && !!base && JSON.stringify(draft) !== JSON.stringify(base)
  const changed = (k: keyof Draft) => !!draft && !!base && draft[k] !== base[k]
  const set = useCallback(<K extends keyof Draft>(k: K, v: Draft[K]) => { setDraft((d) => (d ? { ...d, [k]: v } : d)); setError(''); setNote('') }, [])

  const save = async () => {
    if (!draft || invalid || busy) return
    setBusy(true); setError(''); setNote('')
    try {
      const r = await crowdsecSavePlugin({
        mode: draft.mode, update_interval: Number(draft.update_interval), default_decision_seconds: Number(draft.default_decision_seconds), http_timeout: Number(draft.http_timeout),
        remediation_status_code: Number(draft.remediation_status_code), log_level: draft.log_level, trust_home: draft.trust_home,
        client_trusted_ips: listOf(draft.client), forwarded_headers_trusted_ips: listOf(draft.forwarded),
      }, member)
      addToast({ type: 'success', message: r.applied?.changed ? 'Bouncer settings saved. Traefik reloads them within seconds.' : (r.applied?.message || 'Nothing changed'), duration: 6000 })
      if (r.settings) { const d = toDraft(r.settings); setDraft(d); setBase(d) }
      setNote(r.applied?.message || '')
      poll.refresh(); refreshStatus()
    } catch (e) {
      const d = errData(e)
      setError(errMsg(e, 'The settings were not saved') + (d.reason === 'write_failed' ? ' The previous file is still in place.' : ''))
    } finally { setBusy(false) }
  }
  const discard = () => { setDraft(base); setError(''); setNote('') }
  const useDefaults = () => { if (data?.defaults) { setDraft(toDraft({ ...data.defaults, client_trusted_ips: [], trust_home: true })); setError(''); setNote('') } }

  const enf = status?.enforcement
  if (!enf) return null
  const head = { id: 'cs-plugin', icon: Plug, title: 'Traefik bouncer plugin', sub: 'The part inside Traefik that refuses banned visitors. Its options are written into Traefik’s middleware file; Traefik reloads the file by itself within seconds.' }

  if (!data && !poll.error) return <Panel {...head}><div className="space-y-3" aria-busy="true"><SkeletonBlock className="h-12" /><SkeletonBlock className="h-12" /><SkeletonBlock className="h-12" /></div></Panel>
  if (!data && poll.error) return <Panel {...head}><Notice tone="problem" icon={TriangleAlert} title="Could not read the plugin’s settings" role="alert" action={<button type="button" className={BTN_TOOLBAR_QUIET} onClick={poll.refresh}>Try again</button>}>{poll.error.message}</Notice></Panel>
  if (!data) return null
  if (!data.available) {
    return (
      <Panel {...head}>
        <Notice tone="neutral" icon={Info} title={data.reason || 'The bouncer plugin is not set up on this server.'}
          action={isAdmin ? <button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => goTab('bouncers')}>Open Bouncers</button> : undefined}>
          Once the Traefik bouncer is registered, its mode, timings and trusted networks can be set here.
        </Notice>
      </Panel>
    )
  }
  if (!loaded || !draft || !base || !lim) return null
  const dflt = data.defaults
  const ro = !isAdmin
  const inputCls = (bad?: string) => `${INPUT} !h-9 !text-xs font-mono max-w-[8rem] ${bad ? '!border-rose-500/40' : ''}`
  const num = (k: 'update_interval' | 'default_decision_seconds' | 'http_timeout', label: string) => (
    <div>
      <div className="flex items-center gap-2">
        <input className={inputCls(problems[k])} inputMode="numeric" value={draft[k]} disabled={ro || busy} aria-label={label} aria-invalid={!!problems[k]} onChange={(e) => set(k, e.target.value.replace(/[^\d]/g, '').slice(0, 5))} />
        <span className="text-xs text-slate-500">seconds</span>
      </div>
      {problems[k] && <p className={`${HINT} !text-rose-300`}>{problems[k]}</p>}
    </div>
  )

  return (
    <Panel {...head} actions={<>
      {data.managed ? <Pill tone="ok" title="These settings are managed here: registering the bouncer again keeps them"><ShieldCheck size={10} /> managed here</Pill> : <Pill tone="neutral" title="The file is as DCS first wrote it. Saving takes it over: the settings are then kept when the bouncer is registered again">as first written</Pill>}
      {data.plugin.version && <Pill tone="neutral">{data.plugin.name.replace('-traefik-plugin', '')} {data.plugin.version}</Pill>}
    </>}>
      <div className="divide-y divide-white/5">
        <Setting title="Mode" changed={changed('mode')} hint={`Default: ${dflt?.mode ?? 'live'}`}
          help={data.help?.mode ?? ''}>
          <Segmented<'live' | 'stream'> ariaLabel="Mode" value={draft.mode} onChange={(v) => set('mode', v)} options={[{ value: 'live', label: 'Live', disabled: ro }, { value: 'stream', label: 'Stream', disabled: ro }]} />
        </Setting>
        <Setting title="Update interval" changed={changed('update_interval')} hint={`Default: ${dflt?.update_interval ?? 60} seconds. Used in stream mode.`} help={data.help?.update_interval ?? ''}>
          {num('update_interval', 'Update interval in seconds')}
        </Setting>
        <Setting title="Cache a clean verdict for" changed={changed('default_decision_seconds')} hint={`Default: ${dflt?.default_decision_seconds ?? 10} seconds. Used in live mode. Shorter means a new ban bites faster.`} help={data.help?.default_decision_seconds ?? 'How long a clean verdict is cached; shorter means a new ban bites faster.'}>
          {num('default_decision_seconds', 'Seconds a clean verdict is cached')}
        </Setting>
        <Setting title="Timeout" changed={changed('http_timeout')} hint={`Default: ${dflt?.http_timeout ?? 10} seconds`} help={data.help?.http_timeout ?? ''}>
          {num('http_timeout', 'Timeout in seconds')}
        </Setting>
        <Setting title="Status a banned visitor gets" changed={changed('remediation_status_code')} hint={`Default: ${dflt?.remediation_status_code ?? 403}`} help={data.help?.remediation_status_code ?? ''}>
          <div className="flex items-center gap-2 flex-wrap">
            <Segmented<string> ariaLabel="Status code" value={STATUS_PRESETS.map(String).includes(draft.remediation_status_code) ? draft.remediation_status_code : ''} onChange={(v) => set('remediation_status_code', v)}
              options={STATUS_PRESETS.map((c) => ({ value: String(c), label: `${c}`, title: c === 403 ? 'Forbidden' : c === 401 ? 'Unauthorized' : 'Too many requests', disabled: ro }))} />
            <input className={inputCls(problems.remediation_status_code)} inputMode="numeric" value={draft.remediation_status_code} disabled={ro || busy} aria-label="Status code, another number" aria-invalid={!!problems.remediation_status_code} onChange={(e) => set('remediation_status_code', e.target.value.replace(/[^\d]/g, '').slice(0, 3))} />
          </div>
          {problems.remediation_status_code && <p className={`${HINT} !text-rose-300`}>{problems.remediation_status_code} (400 to 599)</p>}
        </Setting>
        <Setting title="Log level" changed={changed('log_level')} hint={`Default: ${dflt?.log_level ?? 'INFO'}`} help={data.help?.log_level ?? ''}>
          <Segmented<CrowdSecPluginSettings['log_level']> ariaLabel="Log level" value={draft.log_level} onChange={(v) => set('log_level', v)} options={(['DEBUG', 'INFO', 'WARN', 'ERROR'] as const).map((l) => ({ value: l, label: l, disabled: ro }))} />
        </Setting>
        <Setting title="Visitors that are never checked" changed={changed('client') || changed('trust_home')} help={data.help?.client_trusted_ips ?? ''}
          hint={<>Always in: your LAN <span className="font-mono">{data.lan}</span>{draft.trust_home && data.home ? <> and your home address <span className="font-mono">{data.home}</span></> : null}.</>}>
          <div className="flex items-center justify-between gap-3 mb-2">
            <label htmlFor="pl-home" className="text-xs text-slate-300">Never check my home address{data.home ? '' : ' (not known yet)'}</label>
            <Toggle id="pl-home" checked={draft.trust_home} onChange={(v) => set('trust_home', v)} label="Never check my home address" disabled={ro || busy || !data.home} />
          </div>
          <label htmlFor="pl-client" className="sr-only">Addresses and networks that are never checked, one per line</label>
          <textarea id="pl-client" className={`${INPUT} font-mono text-xs ${problems.client ? '!border-rose-500/40' : ''}`} rows={3} value={draft.client} disabled={ro || busy} placeholder={'10.8.0.0/24\n203.0.113.7'} spellCheck={false} aria-invalid={!!problems.client} onChange={(e) => set('client', e.target.value)} />
          <p className={`${HINT} ${problems.client ? '!text-rose-300' : ''}`}>{problems.client ?? 'Your own extra networks: a VPN, another LAN. One address or network per line.'}</p>
        </Setting>
        <Setting title="Proxies whose forwarded address is believed" changed={changed('forwarded')} help={data.help?.forwarded_headers_trusted_ips ?? ''} hint={<>Default: Cloudflare’s ranges. Your LAN <span className="font-mono">{data.lan}</span> is always in.</>}>
          <label htmlFor="pl-fwd" className="sr-only">Proxy addresses and networks, one per line</label>
          <textarea id="pl-fwd" className={`${INPUT} font-mono text-xs ${problems.forwarded ? '!border-rose-500/40' : ''}`} rows={5} value={draft.forwarded} disabled={ro || busy} spellCheck={false} aria-invalid={!!problems.forwarded} onChange={(e) => set('forwarded', e.target.value)} />
          <p className={`${HINT} ${problems.forwarded ? '!text-rose-300' : ''}`}>{problems.forwarded ?? `${listOf(draft.forwarded).length} entries. Only these may say who the real visitor is. Empty it if no proxy sits in front of Traefik.`}</p>
        </Setting>
      </div>

      {error && <Notice tone="problem" icon={TriangleAlert} title={error} role="alert" className="mt-4" />}
      {note && !error && !dirty && <Notice tone="ok" icon={ShieldCheck} title={note} role="status" className="mt-4" />}

      {isAdmin && (
        <div className="mt-4 pt-4 border-t border-white/5 flex items-center gap-2 flex-wrap">
          <button type="button" className={BTN_TOOLBAR_OK} disabled={!dirty || invalid || busy} onClick={save}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save</button>
          <button type="button" className={BTN_TOOLBAR_QUIET} disabled={!dirty || busy} onClick={discard}><Undo2 size={13} /> Discard changes</button>
          <button type="button" className={`${BTN_TOOLBAR_QUIET} sm:ml-auto`} disabled={busy} onClick={useDefaults} title="Fill the form with the defaults; nothing is saved until you press Save"><RotateCcw size={13} /> Defaults</button>
          <p className="text-[11px] text-slate-500 basis-full leading-relaxed">DCS checks every value, keeps the previous file{data.backups && data.backups.length ? ` (${data.backups.length} kept, the newest ${fmtAgo(data.backups[0].created_at)})` : ''} and only then replaces it; the key and every other option in the file stay as they are.</p>
        </div>
      )}
    </Panel>
  )
}
