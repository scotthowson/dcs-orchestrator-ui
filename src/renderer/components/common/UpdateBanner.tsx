// =============================================================================
// UpdateBanner — offers a reload when the served dashboard build has changed
// =============================================================================
// A single-page app keeps running the bundle it loaded. After the DCS-UI image
// is updated, an open tab would otherwise show the old screens for days. The
// build stamps build.json next to index.html; this compares it with the id
// compiled into the running bundle. Only meaningful when served by nginx: the
// desktop and Android apps ship their bundle inside the app.

import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, X } from 'lucide-react'
import { BUILD_ID } from '../../constants/buildInfo'
import { isWebMode } from '../../lib/env'
import { usePolling } from '../../hooks/usePolling'

const CHECK_INTERVAL = 60_000

interface BuildStamp { version?: string; build?: string }

export default function UpdateBanner() {
  const [next, setNext] = useState<BuildStamp | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [reloading, setReloading] = useState(false)

  const check = useCallback(async () => {
    try {
      const base = import.meta.env.BASE_URL || './'
      const res = await fetch(`${base}build.json?t=${Date.now()}`, { cache: 'no-store', credentials: 'same-origin' })
      if (!res.ok) return
      const stamp = (await res.json()) as BuildStamp
      if (stamp.build && stamp.build !== BUILD_ID) setNext(stamp)
    } catch {
      // offline or a proxy hiccup: the next tick tries again
    }
  }, [])

  // every minute while the tab shows (the dashboard's own file, not the API: also before a server answers), at once when
  // it shows again, and when the window gets the focus
  const enabled = isWebMode() && !!BUILD_ID
  const { refresh } = usePolling(check, CHECK_INTERVAL, { enabled, requireConnection: false })
  useEffect(() => {
    if (!enabled) return
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [enabled, refresh])

  if (!next || !next.build || dismissed === next.build) return null

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[99990] w-[calc(100%-2rem)] max-w-md animate-fade-in safe-area-bottom">
      <div className="flex items-center gap-3 rounded-xl border border-emerald-500/25 bg-slate-900/95 backdrop-blur-xl px-4 py-3 shadow-2xl shadow-black/40">
        <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-500/15 border border-emerald-500/20 shrink-0">
          <RefreshCw size={14} className="text-emerald-400" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-slate-100">
            A new dashboard {next.version ? `(v${next.version}) ` : ''}is ready
          </p>
          <p className="text-[11px] text-slate-400">Reload to switch this tab to the new build. Nothing running is affected.</p>
        </div>
        <button
          onClick={() => { setReloading(true); window.location.reload() }}
          disabled={reloading}
          className="shrink-0 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500 text-white hover:bg-emerald-400 transition-colors disabled:opacity-60"
        >
          {reloading ? 'Reloading…' : 'Reload'}
        </button>
        <button onClick={() => setDismissed(next.build ?? null)} className="shrink-0 p-1 rounded-md text-slate-500 hover:text-slate-300 hover:bg-white/5 transition-colors" title="Later">
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
