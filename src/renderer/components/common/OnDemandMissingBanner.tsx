// =============================================================================
// OnDemandMissingBanner — an on-demand (Sablier) container that no longer
// exists cannot be woken: say so wherever containers are listed, with the fix.
// =============================================================================

import { useState } from 'react'
import { Moon, Loader2, Wrench } from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { useAuthStore } from '../../stores/authStore'
import { useToast } from './Toast'
import { fetchHealthReport, repairOnDemand } from '../../api/endpoints'

export function OnDemandMissingBanner() {
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const { addToast } = useToast()
  const { data, refetch } = usePolling(fetchHealthReport, 30000, { key: pollKeys.health(null) })
  const [busy, setBusy] = useState(false)
  const missing = data?.summary?.on_demand_missing ?? []
  if (missing.length === 0) return null

  const repair = async () => {
    setBusy(true)
    try {
      const res = await repairOnDemand()
      addToast({ type: res.success ? 'success' : 'warning', message: res.message, duration: 8000 })
      refetch()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Repair failed' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-indigo-500/20 bg-indigo-500/[0.06] px-4 py-3 animate-fade-in">
      <Moon size={14} className="text-indigo-300 shrink-0" />
      <p className="text-xs text-indigo-100/90 flex-1">
        {missing.length === 1 ? 'An on-demand container is gone' : `${missing.length} on-demand containers are gone`}: <span className="font-mono">{missing.join(', ')}</span>. Traefik routes to {missing.length === 1 ? 'it' : 'them'} and Sablier would wake {missing.length === 1 ? 'it' : 'them'}, but there is nothing to start (an older prune removed stopped containers). Recreating puts {missing.length === 1 ? 'it' : 'them'} back stopped, ready for the first request.
      </p>
      {isAdmin && (
        <button onClick={repair} disabled={busy} className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-indigo-500 text-white hover:bg-indigo-400 disabled:opacity-50 transition-all press">
          {busy ? <Loader2 size={12} className="animate-spin" /> : <Wrench size={12} />}
          {busy ? 'Recreating…' : 'Recreate'}
        </button>
      )}
    </div>
  )
}
