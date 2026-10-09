// =============================================================================
// The strip under the page header: engine version and API health, active bans,
// alerts of the last day, bouncers, log lines parsed, the community list.
// =============================================================================

import { Activity, Ban, Bell, Plug, FileText, Globe2 } from 'lucide-react'
import type { CrowdSecStatusResponse } from '../../../shared/types'
import { fmtAgo, fmtNum, useNow } from './kit'
import StatTile from '../common/StatTile'
export default function StatusStrip({ s, onOpenTab }: { s: CrowdSecStatusResponse; onOpenTab: (tab: string) => void }) {
  const now = useNow()
  const c = s.counts
  const acq = s.acquisition
  const rate = acq?.parse_rate
  const dcsB = s.bouncer
  const pull = dcsB?.registered ? (dcsB.last_pull ? `pulled ${fmtAgo(dcsB.last_pull, now)}` : 'not pulled yet') : 'no Traefik bouncer'
  const uptime = s.started_at ? fmtAgo(s.started_at, now).replace(' ago', '') : ''
  return (
    <div className="grid grid-cols-3 xl:grid-cols-6 gap-2 sm:gap-2.5" role="region" aria-label="CrowdSec at a glance">
      <StatTile label="Engine" short="Engine" icon={Activity} value={`v${s.version_number || s.version || '?'}`}
        sub={<span className="inline-flex items-center gap-1.5"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> API healthy{uptime && uptime !== 'never' ? ` · up ${uptime}` : ''}</span>}
        title={s.version ? `CrowdSec ${s.version} in ${s.container}` : undefined} />
      <StatTile label="Active bans" short="Bans" icon={Ban} tone={c && c.decisions_active > 0 ? 'attention' : 'neutral'} value={fmtNum(c?.decisions_active)}
        sub={c && c.simulated > 0 ? `${c.simulated} only simulated` : 'made by CrowdSec or by you'} onClick={() => onOpenTab('bans')} title="Open the list of bans" />
      <StatTile label="Alerts · 24 h" short="Alerts 24h" icon={Bell} tone={c && c.alerts_24h > 0 ? 'info' : 'neutral'} value={fmtNum(c?.alerts_24h)}
        sub={c ? `${c.sources_24h} source${c.sources_24h === 1 ? '' : 's'} · ${c.countries_24h} countr${c.countries_24h === 1 ? 'y' : 'ies'}` : ''} onClick={() => onOpenTab('alerts')} title="Open the alerts" />
      <StatTile label="Bouncers" short="Bouncers" icon={Plug} tone={dcsB?.registered ? 'neutral' : 'attention'} value={fmtNum(c?.bouncers)} sub={pull} onClick={() => onOpenTab('bouncers')} title="Bouncers and machines" />
      <StatTile label="Log lines" short="Log lines" icon={FileText} tone="neutral" value={acq ? fmtNum(acq.parsed) : '—'}
        sub={acq && acq.reads > 0 ? `${rate !== null && rate !== undefined ? Math.round(rate * 100) : '—'}% understood · since start` : 'none read since start'} title="Lines CrowdSec has read and understood since it started" />
      <StatTile label="Community list" short="Community" icon={Globe2} value={fmtNum(c?.community)} sub="known bad addresses" title="CrowdSec also pulls a community blocklist. The bouncer enforces those addresses, but they are not listed one by one." />
    </div>
  )
}
