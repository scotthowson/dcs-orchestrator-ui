// =============================================================================
// VpnButton — "Through the VPN" next to Start on demand (an admin's, this server's compose containers, while the
// VPN is on in Config → Integrations): PUT /containers/{name}/vpn. The VPN page has the same switch per container.
// =============================================================================

import { useState } from 'react'
import { Lock, Loader2 } from 'lucide-react'
import Hint from '../common/Hint'
import { useConfirm } from '../common/ConfirmDialog'
import { useToast } from '../common/Toast'
import { useVpnEnabled } from '../../hooks/useTechnitiumEnabled'
import { useVpnBehind } from '../../hooks/useVpnBehind'
import { setContainerVpn } from '../../api/endpoints'
import { apiErrorMessage } from '../../api/errors'
import { refreshPoll } from '../../lib/poll'
import { pollKeys } from '../../api/pollKeys'
import { BTN_TOOLBAR, TONE_QUIET, TONE_OK } from '../../lib/ui'

/** ask, switch, say: shared by this button and the VPN page */
export function useContainerVpnSwitch(): (container: string, on: boolean) => Promise<boolean> {
  const confirm = useConfirm()
  const { addToast } = useToast()
  return async (container, on) => {
    const ok = await confirm(on
      ? { title: `Put ${container} through the VPN?`, message: `${container} is recreated sharing the VPN's network: it reaches the internet only through the tunnel, and nothing at all while the tunnel is down. Its web page stays on the same port (published on Gluetun now).`, confirmLabel: 'Through the VPN' }
      : { title: `Take ${container} out of the VPN?`, message: `${container} gets its own ports and networks back exactly as they were, and uses this home's connection again.`, confirmLabel: 'Take it out' })
    if (!ok) return false
    try {
      const r = await setContainerVpn(container, on)
      addToast({ type: 'success', message: r.message })
      await refreshPoll(pollKeys.vpnStatus)
      return true
    } catch (e) { addToast({ type: 'error', message: apiErrorMessage(e) }); return false }
  }
}

export default function VpnButton({ containerName, disabled }: { containerName: string; disabled?: boolean }) {
  const on = useVpnEnabled() === true
  const behind = useVpnBehind().has(containerName)
  const toggle = useContainerVpnSwitch()
  const [busy, setBusy] = useState(false)
  if (!on || containerName === 'Gluetun') return null
  return (
    <Hint label={behind ? 'It reaches the internet only through the VPN tunnel: take it out to use the home connection again' : 'Send everything this container does through the VPN tunnel (a kill switch: nothing leaves when the tunnel is down)'}>
      <button type="button" disabled={disabled || busy} className={`${BTN_TOOLBAR} ${behind ? TONE_OK : TONE_QUIET}`}
        onClick={async () => { setBusy(true); try { await toggle(containerName, !behind) } finally { setBusy(false) } }}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Lock size={14} />}
        {behind ? 'VPN: on' : 'Through the VPN'}
      </button>
    </Hint>
  )
}
