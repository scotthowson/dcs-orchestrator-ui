// =============================================================================
// OnDemandDialog — start a container on demand (Sablier), with the same choices
// as the deploy sheet: idle time, waiting page, the name shown there. When the
// container already starts on demand the same dialog changes the settings or
// serves it normally again.
// =============================================================================

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Moon, Loader2, AlertTriangle, Sun } from 'lucide-react'
import { fetchContainerSablier, setContainerSablierOn } from '../../api/fleetScoped'
import type { RowMember } from '../../../shared/fleetScoped'
import type { SablierSettingsResponse, SablierToggleResponse } from '../../../shared/types'
import { SABLIER_DEFAULTS, SABLIER_SESSIONS, SABLIER_THEMES, SABLIER_THEME_NOTES, describeSession } from '../../lib/sablier'
import ModalOverlay from '../common/ModalOverlay'
import Hint from '../common/Hint'
import { BTN_SHEET, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_QUIET } from '../../lib/ui'
import CloseButton from '../common/CloseButton'
interface Props {
  containerName: string
  member: RowMember
  /** what the list says, until the settings answer */
  onDemand: boolean
  onClose: () => void
  onChanged: (res: SablierToggleResponse) => void
  onError: (message: string) => void
}

const field = 'w-full px-2.5 py-2 rounded-lg bg-slate-900/60 border border-white/10 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/40 focus:ring-1 focus:ring-emerald-500/20 disabled:opacity-50'

export default function OnDemandDialog({ containerName, member, onDemand, onClose, onChanged, onError }: Props) {
  const [settings, setSettings] = useState<SablierSettingsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [session, setSession] = useState(SABLIER_DEFAULTS.session)
  const [theme, setTheme] = useState(SABLIER_DEFAULTS.theme)
  const [showDetails, setShowDetails] = useState(SABLIER_DEFAULTS.showDetails)
  const [displayName, setDisplayName] = useState(containerName)
  const [busy, setBusy] = useState<'save' | 'off' | null>(null)
  const enabled = settings ? settings.enabled : onDemand

  // the current settings (an older DCS has no settings endpoint: the defaults stand)
  useEffect(() => {
    let alive = true
    fetchContainerSablier(containerName, member)
      .then((s) => {
        if (!alive) return
        setSettings(s)
        setSession(s.session || SABLIER_DEFAULTS.session)
        setTheme(s.theme || SABLIER_DEFAULTS.theme)
        setShowDetails(s.show_details !== false)
        setDisplayName(s.display_name || containerName)
      })
      .catch(() => { /* defaults */ })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [containerName, member])

  const apply = async (on: boolean) => {
    setBusy(on ? 'save' : 'off')
    try {
      const res = await setContainerSablierOn(
        containerName,
        on ? { enabled: true, session, theme, display_name: displayName.trim() || containerName, show_details: showDetails } : { enabled: false },
        member,
      )
      onChanged(res)
      onClose()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Could not change on-demand start')
    } finally {
      setBusy(null)
    }
  }

  const cannot = settings && !settings.traefik_routed
    ? 'No Traefik route points at this container yet — deploy it with an HTTPS route first.'
    : settings && !settings.sablier_deployed
      ? 'Deploy the Sablier template first: it stops idle containers and starts them on the first request.'
      : ''
  const sessionOptions = SABLIER_SESSIONS.includes(session) ? SABLIER_SESSIONS : [...SABLIER_SESSIONS, session]
  const themeOptions = SABLIER_THEMES.includes(theme) ? SABLIER_THEMES : [...SABLIER_THEMES, theme]

  return createPortal(
    <ModalOverlay onClose={() => { if (!busy) onClose() }} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => { if (!busy) onClose() }}>
      <div className="relative w-full max-w-md glass p-5 sm:p-6 animate-scale-in" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3 mb-4">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/15 shrink-0">
            <Moon size={18} className="text-indigo-300" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold text-slate-200">{enabled ? 'On demand' : 'Start on demand'}</h3>
            <p className="text-[11px] text-slate-500 truncate font-mono">{containerName}</p>
          </div>
          <Hint label="Close">
            <CloseButton onClick={onClose} disabled={!!busy} />
          </Hint>
        </div>

        <p className="text-xs text-slate-400 leading-relaxed mb-4">
          Traefik starts the container on the first request and Sablier stops it again once it has idled for the sleep time. Visitors see a short waiting page while it starts.
        </p>

        {settings?.group && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-slate-500/[0.06] border border-white/10 mb-4">
            <AlertTriangle size={13} className="text-slate-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-slate-400">A hand-written Sablier group (<span className="font-mono">{settings.middleware}</span>) wakes this container together with others. That group is left as it is; the settings here apply to this container's own route.</p>
          </div>
        )}

        {cannot && (
          <div className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/[0.06] border border-amber-500/15 mb-4">
            <AlertTriangle size={13} className="text-amber-400 shrink-0 mt-0.5" />
            <p className="text-[11px] text-amber-200/80">{cannot}</p>
          </div>
        )}

        {loading ? (
          <div role="status" className="flex items-center gap-2 text-xs text-slate-500 py-6 justify-center"><Loader2 size={14} className="animate-spin" /> Reading the current settings…</div>
        ) : (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="text-[10px] text-slate-400">
                <span className="block mb-1 uppercase tracking-wider">Sleep after idle</span>
                <select value={session} onChange={(e) => setSession(e.target.value)} className={field} disabled={!!busy}>
                  {sessionOptions.map((s) => <option key={s} value={s}>{describeSession(s)}</option>)}
                </select>
              </label>
              <label className="text-[10px] text-slate-400">
                <span className="block mb-1 uppercase tracking-wider">Waiting page</span>
                <select value={theme} onChange={(e) => setTheme(e.target.value)} className={field} disabled={!!busy}>
                  {themeOptions.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
                <span className="block mt-1 text-[10px] text-slate-500">{SABLIER_THEME_NOTES[theme] ?? ''}</span>
              </label>
            </div>
            <label className="block text-[10px] text-slate-400">
              <span className="block mb-1 uppercase tracking-wider">Name on the waiting page</span>
              <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={containerName} className={field} disabled={!!busy} spellCheck={false} />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-slate-400 cursor-pointer">
              <input type="checkbox" checked={showDetails} onChange={(e) => setShowDetails(e.target.checked)} className="accent-indigo-500" disabled={!!busy} />
              Show the container name and status on the waiting page
            </label>
            {enabled && settings && (
              <p className="text-[10px] text-slate-500">
                Starts on demand now: sleeps after {describeSession(settings.session)}, {settings.theme} page{settings.middleware ? <> · middleware <span className="font-mono">{settings.middleware}</span></> : null}.
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} disabled={!!busy} className={`${BTN_SHEET_QUIET} flex-1 sm:flex-none`}>
            Close
          </button>
          {enabled && (
            <Hint label="Remove the Sablier middleware from its route; the container keeps running until you stop it">
              <button
                type="button"
                onClick={() => void apply(false)}
                disabled={!!busy || loading}
                className={`${BTN_SHEET} ${TONE_QUIET} flex-1 sm:flex-none`}
              >
                {busy === 'off' ? <Loader2 size={16} className="animate-spin" /> : <Sun size={16} />}
                Serve normally
              </button>
            </Hint>
          )}
          <button
            type="button"
            onClick={() => void apply(true)}
            disabled={!!busy || loading || !!cannot}
            className={`${BTN_SHEET_PRIMARY} flex-1 sm:flex-none`}
          >
            {busy === 'save' ? <Loader2 size={16} className="animate-spin" /> : <Moon size={16} />}
            {enabled ? 'Save changes' : 'Start on demand'}
          </button>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
