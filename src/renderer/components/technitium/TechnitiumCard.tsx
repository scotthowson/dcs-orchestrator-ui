// The Technitium card on DNS & routes: the home's resolver at a glance, a click from its page
import { ShieldHalf, ArrowRight } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import StatusLine from '../common/StatusLine'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { fetchTechnitiumStatus } from '../../api/endpoints'
import { pageLabel } from '../../constants/pageTitles'
import { useSettingsStore } from '../../stores/settingsStore'
import { BTN_TOOLBAR_QUIET } from '../../lib/ui'
import type { Tone } from '../../lib/tone'
import type { TechnitiumInstance, TechnitiumStatus } from '../../../shared/types'

/** the one line the card says, and its tone */
function verdict(data: TechnitiumStatus | null): { tone: Tone; title: string } {
  if (!data) return { tone: 'neutral', title: 'Technitium DNS' }
  if (!data.configured) return { tone: 'neutral', title: 'Not connected' }
  const servers = [data.primary, data.secondary].filter((s): s is TechnitiumInstance => !!s?.configured)
  const down = servers.filter((s) => !s.reachable).length
  const plural = servers.length === 1 ? '' : 's'
  if (down) return { tone: 'problem', title: `${down} of ${servers.length} server${plural} not answering` }
  if (data.primary.blocking === false) return { tone: 'attention', title: 'Blocking is paused' }
  if (data.in_sync === false) return { tone: 'attention', title: `${servers.length} server${plural} answering, out of sync` }
  return { tone: 'ok', title: `${servers.length} server${plural} answering${data.in_sync ? ', in sync' : ''}` }
}

export default function TechnitiumCard() {
  const setPage = useSettingsStore((s) => s.setCurrentPage)
  const { data } = usePolling(fetchTechnitiumStatus, 60000, { key: pollKeys.technitiumStatus })
  const { tone, title } = verdict(data)
  return (
    <Panel icon={ShieldHalf} title={pageLabel('technitium')} actions={<button type="button" className={BTN_TOOLBAR_QUIET} onClick={() => setPage('technitium')}>Open {pageLabel('technitium')} <ArrowRight size={14} /></button>}>
      <StatusLine tone={tone} title={title}>
        {data?.configured ? `${data.groups} kids' group${data.groups === 1 ? '' : 's'}${data.bedtime_active.length ? `, ${data.bedtime_active.length} in bedtime now` : ''}` : "The home's resolver: blocking, the kids' groups and their bedtime, run from DCS"}
      </StatusLine>
    </Panel>
  )
}
