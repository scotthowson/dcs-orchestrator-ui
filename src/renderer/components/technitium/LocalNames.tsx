// "Inside the house": Technitium's local names. The switch that makes the routes answer this server's LAN address at home
// (no trip out to Cloudflare and back), on DNS & routes and on the Technitium page's DHCP tab; there it also says how the
// devices get their names (<hostname>.home from DHCP, <nickname>.home from DCS). A viewer reads it.

import { useState } from 'react'
import { House, Loader2 } from 'lucide-react'
import { Panel } from '../dashboard/cardShared'
import StatusLine from '../common/StatusLine'
import Notice from '../common/Notice'
import { ToggleRow } from '../common/Toggle'
import { Pill } from '../common/Pill'
import { useToast } from '../common/Toast'
import { usePolling } from '../../hooks/usePolling'
import { useTechnitiumEnabled } from '../../hooks/useTechnitiumEnabled'
import { pollKeys } from '../../api/pollKeys'
import { apiErrorMessage } from '../../api/errors'
import { fetchTechnitiumLocal, setTechnitiumLocal } from '../../api/endpoints'
import type { TechnitiumDhcp } from '../../../shared/types'

export default function LocalNamesPanel({ isAdmin, onChanged, names }: {
  isAdmin: boolean
  /** after the switch: the page reads its routes again (their LAN address) */
  onChanged?: () => void
  /** the DHCP tab's names line */
  names?: TechnitiumDhcp['names']
}) {
  const on = useTechnitiumEnabled()
  const { data, refresh } = usePolling(fetchTechnitiumLocal, 60000, { key: pollKeys.technitiumLocal, enabled: on === true })
  const { addToast } = useToast()
  const [busy, setBusy] = useState(false)
  if (on !== true || !data?.available) return null
  const n = data.hosts.length
  const flip = async (v: boolean) => {
    setBusy(true)
    try {
      const r = await setTechnitiumLocal(v)
      addToast({ type: r.warning ? 'warning' : 'success', message: r.warning ? `${r.message}. ${r.warning}` : r.message, duration: r.warning ? 8000 : undefined })
    } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }) }
    await refresh(); onChanged?.(); setBusy(false)
  }
  return (
    <Panel icon={House} title="Inside the house"
      badge={data.routes ? <Pill tone="ok" dot>Routes resolve here</Pill> : <Pill tone="neutral" dot>Through the internet</Pill>}
      actions={busy ? <Loader2 size={14} className="animate-spin text-slate-500" aria-label="Saving" /> : undefined}>
      <div className="space-y-3">
        <ToggleRow label="Resolve my routes locally" checked={data.routes} disabled={!isAdmin || busy || !data.address} onChange={(v) => void flip(v)}
          help={<>
            Devices at home reach {data.routes ? `your ${n} route${n === 1 ? '' : 's'}` : 'your routes'} at this server's address{data.address ? <> (<span className="font-mono text-slate-400">{data.address}</span>)</> : ''} instead
            of going out to Cloudflare and back. Other names under your domains still resolve as before. Sign-in and certificates work
            as they do now (same names, same certificate); Cloudflare's firewall and bans do not apply to devices at home.
          </>} def="off" />
        {data.last && !data.last.ok && <Notice tone="attention" title="Technitium did not take it all">{data.last.message} The minute clock tries again.</Notice>}
        {data.last?.ok && data.last.message && <StatusLine dense tone="attention" title="Left alone">{data.last.message}</StatusLine>}
        {names && (names.on
          ? <StatusLine tone="ok" title={<>Names: on, zone <span className="font-mono">{names.zone}</span>, {names.count} name{names.count === 1 ? '' : 's'}</>}>
              {names.leases} from DHCP leases, {names.nicknames} from nicknames{names.secondary ? '; the secondary copies the zone' : ''}.
            </StatusLine>
          : <StatusLine tone="neutral" title={<>Names: nicknames only, zone <span className="font-mono">{names.zone}</span></>}>
              {names.nicknames} device{names.nicknames === 1 ? '' : 's'} answer their nickname; leases register their own name once Technitium hands out addresses.
            </StatusLine>)}
      </div>
    </Panel>
  )
}
