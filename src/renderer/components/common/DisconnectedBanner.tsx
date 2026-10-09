import { useEffect, useState } from 'react'
import { WifiOff, RefreshCw, HeartPulse } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useApiLink } from '../../hooks/useApiLink'

import { BTN_TOOLBAR_QUIET, FOCUS_RING } from '../../lib/ui'
/** On every page that shows server data: says so, in the first seconds, when the API stops answering */
export function DisconnectedBanner() {
  const connect = useConnectionStore((s) => s.connect)
  const link = useApiLink()

  const show = !link.live
  // The banner leaves the page once its collapse has run. An invisible copy kept a slot in the page's spacing (a gap under the header) and a Retry button
  // that could still be tabbed to.
  const [present, setPresent] = useState(show)
  useEffect(() => {
    if (show) { setPresent(true); return }
    const t = setTimeout(() => setPresent(false), 320)
    return () => clearTimeout(t)
  }, [show])
  if (!show && !present) return null
  const reconnecting = link.state === 'reconnecting'
  const trouble = link.state === 'trouble'

  // Smooth height transition when the link comes back; `invisible` also takes the collapsing copy out of the tab order
  return (
    <div
      aria-hidden={!show}
      role={show ? 'status' : undefined}
      className={`overflow-hidden transition-all duration-300 ease-out ${
        show ? 'max-h-16 opacity-100 mb-4' : 'max-h-0 opacity-0 mb-0 invisible'
      }`}
    >
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
        trouble ? 'bg-amber-500/[0.06] border-amber-500/15' : 'bg-rose-500/[0.06] border-rose-500/20'
      }`}>
        {reconnecting || trouble ? (
          <HeartPulse className={`w-4 h-4 shrink-0 animate-pulse ${trouble ? 'text-amber-400' : 'text-rose-400'}`} />
        ) : (
          <WifiOff className="w-4 h-4 text-rose-400 shrink-0" />
        )}
        <span className="text-slate-300 flex-1">
          <span className="text-slate-200">{link.label}</span> — {link.note.toLowerCase()}
        </span>
        {!reconnecting && !trouble && (
          <button
            type="button"
            onClick={() => { void connect() }}
            className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}
          >
            <RefreshCw size={14} aria-hidden />
            Try again
          </button>
        )}
      </div>
    </div>
  )
}
