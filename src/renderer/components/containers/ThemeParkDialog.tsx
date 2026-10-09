// =============================================================================
// ThemeParkDialog — a theme.park theme on a container's pages (Sonarr, Radarr,
// qBittorrent, Plex… every app theme.park supports). Like Start on demand, DCS
// writes a Traefik middleware onto the container's route: the theme reaches the
// app wherever it is opened through that route, nothing inside the container
// changes, and removing it is instant.
// =============================================================================

import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Palette, Loader2, X, AlertTriangle, ExternalLink, Trash2 } from 'lucide-react'
import { setContainerTheme } from '../../api/fleetScoped'
import type { RowMember } from '../../../shared/fleetScoped'
import type { ContainerThemeState, ContainerThemeResponse } from '../../../shared/types'
import ModalOverlay from '../common/ModalOverlay'
import Hint from '../common/Hint'
import { BTN_ICON_SM, BTN_SHEET, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_DANGER, TONE_GHOST } from '../../lib/ui'

import CloseButton from '../common/CloseButton'
interface Props {
  containerName: string
  member: RowMember
  state: ContainerThemeState
  onClose: () => void
  onChanged: (res: ContainerThemeResponse) => void
  onError: (message: string) => void
}

/** "space-gray" → "Space gray", "catppuccin-mocha" → "Catppuccin mocha" */
function label(slug: string): string {
  const s = slug.replace(/-/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/** "sonarr-4k-logo" → "4K logo" (the app's name is implied) */
function addonLabel(app: string, addon: string): string {
  const rest = addon.startsWith(`${app}-`) ? addon.slice(app.length + 1) : addon
  return label(rest).replace(/\b4k\b/i, '4K')
}

export default function ThemeParkDialog({ containerName, member, state, onClose, onChanged, onError }: Props) {
  // a theme written by hand may spell a name without its dash ("spacegray" for "space-gray"): the catalogue's spelling is preselected
  const known = (t: string) => [...state.catalog.themes, ...state.catalog.community].find((c) => c.replace(/-/g, '') === t.replace(/-/g, '')) ?? t
  const [theme, setTheme] = useState(state.enabled && state.theme ? known(state.theme) : (state.catalog.themes.includes('nord') ? 'nord' : state.catalog.themes[0] ?? 'dark'))
  const [addons, setAddons] = useState<string[]>(state.enabled ? state.addons : [])
  const [busy, setBusy] = useState<'apply' | 'remove' | null>(null)
  const darker = addons.some((a) => a.endsWith('-darker'))

  // a "darker" add-on replaces the theme: theme.park wants the base theme under it
  useEffect(() => { if (darker && theme !== 'base') setTheme('base') }, [darker, theme])

  const cannot = !state.traefik
    ? (state.reason || 'No Traefik runs where this theme would be applied.')
    : !state.routed
      ? (state.reason || 'No Traefik route points at this container yet — deploy it with an HTTPS route first: the theme reaches the app through that route.')
      : ''

  const apply = async (on: boolean) => {
    setBusy(on ? 'apply' : 'remove')
    try {
      const res = await setContainerTheme(containerName, member, on ? { enabled: true, theme, addons } : { enabled: false })
      onChanged(res)
      onClose()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not change the theme')
    } finally {
      setBusy(null)
    }
  }

  const official = useMemo(() => state.catalog.themes, [state.catalog.themes])
  const community = useMemo(() => state.catalog.community, [state.catalog.community])
  const appName = label(state.app)

  return createPortal(
    <ModalOverlay onClose={() => { if (!busy) onClose() }} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => { if (!busy) onClose() }}>
      <div className="relative w-full max-w-lg glass p-5 sm:p-6 animate-scale-in max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-fuchsia-500/10 border border-fuchsia-500/15 shrink-0">
            <Palette size={18} className="text-fuchsia-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">{state.enabled ? `Theme: ${label(state.theme)}${state.managed === false ? ' (from your route)' : ''}` : 'Theme'}</h3>
            <p className="text-[11px] text-slate-500 truncate"><span className="font-mono">{containerName}</span> · theme.park for {appName}</p>
          </div>
          <Hint label="Close">
            <CloseButton onClick={onClose} disabled={!!busy} />
          </Hint>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed mb-4">
          Traefik adds the theme's stylesheet to {appName}'s pages as they pass through its route{state.host ? <> (<span className="font-mono text-slate-300">{state.host}</span>)</> : null}. Nothing inside the container changes; opened directly by its port, the app keeps its own look.
        </p>

        {(state.foreign ?? []).length > 0 && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-fuchsia-500/[0.05] border border-fuchsia-500/15 mb-4">
            <Palette size={13} className="text-fuchsia-300 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-300 leading-relaxed">
              This route already carries a theme.park middleware written by hand:{' '}
              {(state.foreign ?? []).map((f) => (
                <span key={f.middleware} className="font-mono text-fuchsia-200">{f.middleware} ({label(f.theme || 'base')}{f.addons.length ? ` + ${f.addons.map((a) => addonLabel(state.app, a)).join(', ')}` : ''})</span>
              ))}
              . Saving here puts this theme in its place on the route; your definition stays in the route file.
            </p>
          </div>
        )}

        {cannot && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/15 mb-4">
            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/80">{cannot}</p>
          </div>
        )}

        <div className="space-y-4">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Theme</div>
            {darker ? (
              <p className="text-[11px] text-slate-500">A “darker” add-on is its own theme: the base theme goes under it.</p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {official.map((t) => (
                    <button key={t} type="button" disabled={!!busy} aria-pressed={theme === t} onClick={() => setTheme(t)}
                      className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${theme === t ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-100' : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'}`}>
                      {label(t)}
                    </button>
                  ))}
                </div>
                {community.length > 0 && (
                  <>
                    <div className="text-[10px] text-slate-500">Community themes</div>
                    <div className="flex flex-wrap gap-1.5">
                      {community.map((t) => (
                        <button key={t} type="button" disabled={!!busy} aria-pressed={theme === t} onClick={() => setTheme(t)}
                          className={`px-2.5 py-1 rounded-full text-[11px] border transition-colors ${theme === t ? 'bg-fuchsia-500/20 border-fuchsia-500/40 text-fuchsia-100' : 'bg-white/[0.03] border-white/10 text-slate-400 hover:text-slate-200 hover:bg-white/[0.06]'}`}>
                          {label(t)}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {state.catalog.addons.length > 0 && (
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">Add-ons for {appName}</div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                {state.catalog.addons.map((a) => {
                  const on = addons.includes(a)
                  return (
                    <label key={a} className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
                      <input type="checkbox" checked={on} disabled={!!busy} className="accent-fuchsia-500"
                        onChange={() => setAddons((prev) => on ? prev.filter((x) => x !== a) : [...prev, a])} />
                      {addonLabel(state.app, a)}
                    </label>
                  )
                })}
              </div>
            </div>
          )}

          <a href="https://docs.theme-park.dev/theme-options/" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-fuchsia-300/80 hover:text-fuchsia-200">
            See every theme on theme.park <ExternalLink size={11} />
          </a>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={!!busy} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none`}>
            Close
          </button>
          {state.enabled && (
            <Hint label="Remove the theme middleware: the app shows its own look again">
              <button type="button" onClick={() => void apply(false)} disabled={!!busy} className={`${BTN_SHEET} ${TONE_DANGER} flex-1 sm:flex-none`}>
                {busy === 'remove' ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                Remove theme
              </button>
            </Hint>
          )}
          <button type="button" onClick={() => void apply(true)} disabled={!!busy || !!cannot} className={`${BTN_SHEET_PRIMARY} flex-1 sm:flex-none`}>
            {busy === 'apply' ? <Loader2 size={16} className="animate-spin" /> : <Palette size={16} />}
            {state.enabled ? 'Save' : 'Apply theme'}
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
