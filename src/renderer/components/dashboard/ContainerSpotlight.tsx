// =============================================================================
// ContainerSpotlight — the containers you pinned, watched live
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Crosshair, Settings2, X, Check, Search } from 'lucide-react'
import { useContainerStore } from '../../stores/containerStore'
import { useSettingsStore } from '../../stores/settingsStore'
import Hint from '../common/Hint'
import ModalOverlay from '../common/ModalOverlay'
import { BTN_CARD, BTN_ICON_SM, BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, TONE_GHOST, TONE_OK } from '../../lib/ui'
import { Card, CardBody, type CardCommonProps } from './cardShared'
import { StateDot } from '../common/StateChip'
import { containerState, isAsleep, STATE_META } from '../../lib/containerState'

import { pctTone, TONE_FILL } from '../../lib/tone'
import { Skeleton, EmptyState } from '../common/PageState'
import SearchInput from '../common/SearchInput'
import CloseButton from '../common/CloseButton'
interface SpotlightConfig { containers: string[] }

function pct(v: string | undefined): number | null {
  if (!v) return null
  const n = parseFloat(String(v).replace('%', ''))
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null
}

function formatUptime(s: number): string {
  if (!s || s <= 0) return '—'
  if (s < 3600) return `${Math.floor(s / 60)}m`
  if (s < 86400) return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`
  return `${Math.floor(s / 86400)}d ${Math.floor((s % 86400) / 3600)}h`
}

function Bar({ value }: { value: number | null }) {
  return (
    <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-700 ${TONE_FILL[pctTone(value ?? 0)]}`} style={{ width: `${value ?? 0}%` }} />
    </div>
  )
}

export default function ContainerSpotlight({ cardConfig, onSaveConfig, dashboardEditMode }: CardCommonProps) {
  const containers = useContainerStore((s) => s.containers)
  const loading = useContainerStore((s) => s.loading)
  const stats = useContainerStore((s) => s.stats)
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const picked = useMemo(() => {
    const cfg = cardConfig as SpotlightConfig | undefined
    return Array.isArray(cfg?.containers) ? cfg!.containers.filter((c) => typeof c === 'string') : []
  }, [cardConfig])
  const [picking, setPicking] = useState(false)
  const [draft, setDraft] = useState<string[]>(picked)
  const [search, setSearch] = useState('')
  useEffect(() => { if (picking) setDraft(picked) }, [picking, picked])

  const rows = picked.map((name) => ({ name, info: containers.find((c) => c.name === name) ?? null, st: stats[name] }))
  const canEdit = !!onSaveConfig && !dashboardEditMode

  return (
    <Card
      card="container-spotlight"
      meta={picked.length || undefined}
      actions={canEdit ? (
        <Hint label="Choose containers">
          <button type="button" aria-label="Choose containers" onClick={() => setPicking(true)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><Settings2 size={12} /></button>
        </Hint>
      ) : undefined}
    >
      {picked.length === 0 ? (
        <EmptyState card
          icon={<Crosshair size={22} />}
          title="Nothing pinned yet"
          hint="Pick the containers you want to keep an eye on."
          action={canEdit ? <button type="button" onClick={() => setPicking(true)} className={`${BTN_CARD} ${TONE_OK}`}>Choose containers</button> : undefined}
        />
      ) : loading && containers.length === 0 ? (
        <Skeleton label="Loading the containers…" rows={3} />
      ) : (
        <CardBody className="space-y-1.5">
          {rows.map(({ name, info, st }) => {
            const running = info?.state === 'running'
            const health = info?.health && info.health !== 'none' ? info.health : null
            const cpu = pct(st?.cpu_percent ?? (info?.cpu_percent != null ? `${info.cpu_percent}` : undefined))
            const mem = pct(st?.memory_percent ?? (info?.mem_percent != null ? `${info.mem_percent}` : undefined))
            return (
              <button
                key={name}
                type="button"
                onClick={() => setCurrentPage('containers', { focusContainer: name })}
                className="w-full text-left rounded-lg px-2.5 py-2 bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  {info && isAsleep(info)
                    ? <StateDot state={containerState(info)} />
                    : <span className={`h-2 w-2 rounded-full shrink-0 ${!info ? 'bg-slate-700' : running ? (health === 'unhealthy' ? 'bg-rose-400' : 'bg-emerald-400') : 'bg-slate-500'}`} aria-hidden />}
                  <span className="text-xs font-mono font-medium text-slate-200 truncate">{name}</span>
                  <span className="ml-auto text-[10px] text-slate-500 shrink-0">
                    {!info ? 'not found' : running ? (health ? health : 'running') : isAsleep(info) ? <span className={STATE_META[containerState(info)].text} title={STATE_META[containerState(info)].hint}>{STATE_META[containerState(info)].label} · on demand</span> : info.state}
                    {info && running ? ` · ${formatUptime(info.uptime_seconds)}` : ''}
                  </span>
                </div>
                {info && running && (
                  <div className="mt-1.5 grid grid-cols-2 gap-3">
                    <div>
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-0.5"><span>CPU</span><span className="text-slate-400 tabular-nums">{cpu != null ? `${cpu.toFixed(1)}%` : '—'}</span></div>
                      <Bar value={cpu} />
                    </div>
                    <div>
                      <div className="flex justify-between text-[10px] uppercase tracking-wider text-slate-500 mb-0.5"><span>Memory</span><span className="text-slate-400 tabular-nums">{mem != null ? `${mem.toFixed(1)}%` : '—'}</span></div>
                      <Bar value={mem} />
                    </div>
                  </div>
                )}
              </button>
            )
          })}
        </CardBody>
      )}

      {picking && createPortal(
        <ModalOverlay onClose={() => setPicking(false)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setPicking(false)}>
          <div className="w-full max-w-md mx-4 max-h-[85vh] flex flex-col bg-slate-900/95 backdrop-blur-2xl border border-white/10 rounded-2xl shadow-2xl shadow-black/40 animate-scale-in" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
              <div>
                <h3 className="text-sm font-semibold text-slate-200">Spotlight containers</h3>
                <p className="text-[11px] text-slate-500">{draft.length} chosen</p>
              </div>
              <Hint label="Close"><CloseButton onClick={() => setPicking(false)} /></Hint>
            </div>
            <div className="px-5 py-3">
              <div className="relative">
                <SearchInput size="sm" value={search} onChange={setSearch} label="Filter containers" placeholder="Filter containers…" />
              </div>
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none px-3 pb-3 space-y-0.5">
              {containers.filter((c) => !search || c.name.toLowerCase().includes(search.toLowerCase())).map((c) => {
                const on = draft.includes(c.name)
                return (
                  <button
                    key={`${c.member ?? ''}|${c.name}`}
                    type="button"
                    role="checkbox"
                    aria-checked={on}
                    onClick={() => setDraft((d) => on ? d.filter((n) => n !== c.name) : [...d, c.name])}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${on ? 'bg-emerald-500/[0.08]' : 'hover:bg-white/[0.04]'}`}
                  >
                    <span className={`flex items-center justify-center w-4 h-4 rounded border ${on ? 'bg-emerald-500 border-emerald-500' : 'border-white/20'}`}>{on && <Check size={11} className="text-white" strokeWidth={3} />}</span>
                    <span className="text-xs font-mono text-slate-200 truncate">{c.name}</span>
                    <span className="ml-auto text-[10px] text-slate-500">{c.state}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-white/5">
              <button type="button" onClick={() => setPicking(false)} className={BTN_SHEET_QUIET}>Cancel</button>
              <button type="button" onClick={async () => { await onSaveConfig?.({ containers: draft }); setPicking(false) }} className={BTN_SHEET_PRIMARY}>Save</button>
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}
    </Card>
  )
}
