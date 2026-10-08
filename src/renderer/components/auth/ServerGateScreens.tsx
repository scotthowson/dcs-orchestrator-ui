// =============================================================================
// The screens shown instead of the dashboard while the active server has no confirmed session (serverStore.gate):
// "Checking your sign-in" and "can't be reached". Both are full screens: nothing of any server sits behind them.
// The sign-in itself is pages/Login. ServerAccountList is the list of the other servers they (and the sign-in) offer.
// =============================================================================

import { useEffect, useState } from 'react'
import { Layers, Loader2, WifiOff, RotateCw, Globe, Server, Pencil } from 'lucide-react'
import { useServerStore } from '../../stores/serverStore'
import type { ServerProfile } from '../../../shared/types'
import { BTN_SHEET_PRIMARY, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { FOCUS_RING } from '../../lib/fieldStyles'

/** The account line of a server: "signed in as scott · admin", "needs sign-in", "can't be reached" */
export function accountLine(p: ServerProfile, opts: { active: boolean; signedInHere: boolean; unreachable?: string }): { text: string; tone: 'ok' | 'quiet' | 'bad' } {
  if (opts.unreachable && !(opts.active && opts.signedInHere)) return { text: 'can’t be reached', tone: 'bad' }
  if (p.session?.token && (!opts.active || opts.signedInHere)) {
    const role = p.session.role
    return { text: `signed in as ${p.session.username || 'someone'}${role ? ` · ${role}` : ''}`, tone: 'ok' }
  }
  return { text: p.remember ? 'needs sign-in · password saved' : 'needs sign-in', tone: 'quiet' }
}

const TONE_TEXT = { ok: 'text-emerald-400', quiet: 'text-slate-500', bad: 'text-rose-400' } as const

/** The other servers, to switch to from a screen without the dashboard */
export function ServerAccountList({ excludeId }: { excludeId?: string | null }) {
  const servers = useServerStore((s) => s.servers)
  const unreachable = useServerStore((s) => s.unreachable)
  const [busy, setBusy] = useState<string | null>(null)
  const others = servers.filter((s) => s.id !== excludeId)
  if (others.length === 0) return null
  return (
    <div className="mt-6">
      <p className="text-[11px] font-medium text-slate-500 mb-2">Other servers</p>
      <ul className="space-y-1.5" aria-label="Other servers">
        {others.map((s) => {
          const line = accountLine(s, { active: false, signedInHere: false, unreachable: unreachable[s.id] })
          return (
            <li key={s.id}>
              <button
                type="button"
                disabled={!!busy}
                onClick={async () => { setBusy(s.id); await useServerStore.getState().switchServer(s.id); setBusy(null) }}
                className={`w-full flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] px-3 py-2 text-left transition-colors disabled:opacity-60 ${FOCUS_RING}`}
              >
                {busy === s.id ? <Loader2 size={14} className="text-cyan-400 animate-spin shrink-0" /> : <Server size={14} className="text-slate-500 shrink-0" />}
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-slate-200 truncate">{s.name}</span>
                  <span className="block text-[10px] text-slate-500 font-mono truncate">{s.url}</span>
                </span>
                <span className={`text-[10px] shrink-0 ${TONE_TEXT[line.tone]}`}>{line.text}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-950 relative overflow-y-auto overflow-x-hidden px-4 py-8">
      <div className="relative z-10 w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-emerald-500/10 ring-1 ring-emerald-500/20 mb-4">
            <Layers className="w-8 h-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-slate-100 tracking-tight">DCS Orchestrator</h1>
        </div>
        <div className="glass p-8">{children}</div>
      </div>
    </div>
  )
}

function ServerBadge({ server }: { server: ServerProfile | null }) {
  if (!server) return null
  return (
    <div className="flex items-center gap-2 rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 min-w-0">
      <Globe size={12} className="text-slate-500 shrink-0" />
      <span className="text-xs font-medium text-slate-300 truncate">{server.name}</span>
      <span className="text-[11px] text-slate-500 font-mono truncate">{server.url}</span>
    </div>
  )
}

export function ServerCheckingScreen() {
  const server = useServerStore((s) => s.servers.find((x) => x.id === s.activeServerId) ?? null)
  return (
    <Frame>
      <div role="status" aria-live="polite" className="flex flex-col items-center text-center gap-4">
        <Loader2 className="w-6 h-6 text-emerald-400 animate-spin" />
        <div>
          <h2 className="text-lg font-semibold text-slate-100">Checking your sign-in</h2>
          <p className="text-xs text-slate-500 mt-1">The server confirms the session before anything is shown.</p>
        </div>
        <div className="w-full"><ServerBadge server={server} /></div>
      </div>
    </Frame>
  )
}

const AUTO_RETRY_MS = 10000

export function ServerUnreachableScreen() {
  const server = useServerStore((s) => s.servers.find((x) => x.id === s.activeServerId) ?? null)
  const detail = useServerStore((s) => s.gateDetail)
  const [retrying, setRetrying] = useState(false)

  // it tries again by itself every few seconds: a server that comes back is entered without a click
  useEffect(() => {
    const t = setInterval(() => {
      if (!retrying) void useServerStore.getState().enterActiveServer({ quiet: true })
    }, AUTO_RETRY_MS)
    return () => clearInterval(t)
  }, [retrying])

  const retry = async () => {
    setRetrying(true)
    await useServerStore.getState().enterActiveServer({ quiet: true })
    setRetrying(false)
  }

  return (
    <Frame>
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
            <WifiOff size={18} className="text-rose-400" />
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-slate-100 truncate">{server?.name ?? 'The server'} can’t be reached</h2>
            <p className="text-xs text-slate-500 mt-0.5">Nothing is shown until it answers and your sign-in is confirmed.</p>
          </div>
        </div>
        <ServerBadge server={server} />
        {detail && <p className="text-[11px] text-slate-400 break-words" role="status">{detail}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={retry} disabled={retrying} className={`${BTN_SHEET_PRIMARY} flex-1`}>
            {retrying ? <Loader2 size={16} className="animate-spin" /> : <RotateCw size={16} />}
            {retrying ? 'Trying…' : 'Retry'}
          </button>
          <button
            type="button"
            onClick={() => useServerStore.setState({ gate: 'open', signInReason: 'edit-address' })}
            className={`${BTN_TOOLBAR_QUIET} justify-center`}
          >
            <Pencil size={14} />
            Change the address
          </button>
        </div>
        <p className="text-[10px] text-slate-500">Tries again every {AUTO_RETRY_MS / 1000} seconds.</p>
      </div>
      <ServerAccountList excludeId={server?.id} />
    </Frame>
  )
}
