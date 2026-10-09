// =============================================================================
// Settings: how long CrowdSec bans (the ban profile), simulation mode (scenarios
// that only alert), and the two buttons that act on the engine itself. The
// cards live in their own files (SettingsTabProfile, SettingsTabSimulation);
// this one puts them on the page and owns maintenance.
// =============================================================================

import { useState } from 'react'
import { Loader2, RefreshCw, RotateCw, Wrench } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { crowdsecService } from '../../api/endpoints'
import { errMsg, useCs } from './kit'
import ProfileCard from './SettingsTabProfile'
import SimulationCard, { useSimulation } from './SettingsTabSimulation'
import PluginSettings from './PluginSettings'

import { BTN_TOOLBAR_DANGER, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { Panel } from '../dashboard/cardShared'
function MaintenanceCard() {
  const { member, refreshStatus } = useCs()
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [busy, setBusy] = useState<'' | 'reload' | 'restart'>('')

  const run = async (action: 'reload' | 'restart') => {
    if (action === 'restart' && !(await confirm({
      title: 'Restart CrowdSec?',
      message: 'Detection pauses for a few seconds while the container restarts. Bans stay in place and the Traefik bouncer keeps enforcing them.',
      confirmLabel: 'Restart CrowdSec',
    }))) return
    setBusy(action)
    try {
      const r = await crowdsecService(action, member)
      addToast({ type: 'success', message: r.message || (action === 'reload' ? 'CrowdSec reloaded its configuration' : 'CrowdSec restarted'), duration: 5000 })
      refreshStatus()
    } catch (e) {
      addToast({ type: 'error', message: errMsg(e, `Could not ${action} CrowdSec`), duration: 8000 })
    } finally { setBusy('') }
  }

  return (
    <Panel id="cs-maintenance" icon={Wrench} title="Maintenance" sub="Two buttons for when you changed a file by hand. Saving the ban profile already restarts CrowdSec by itself.">
      <div className="divide-y divide-white/5">
        <div className="flex items-center justify-between gap-4 flex-wrap py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="text-sm font-medium text-slate-200">Reload the configuration</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">CrowdSec re-reads its parsers, scenarios and allowlists without stopping. Detection carries on and nothing is interrupted.</p>
          </div>
          <button type="button" className={BTN_TOOLBAR_QUIET} disabled={busy !== ''} onClick={() => run('reload')}>{busy === 'reload' ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />} Reload configuration</button>
        </div>
        <div className="flex items-center justify-between gap-4 flex-wrap py-3 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="text-sm font-medium text-slate-200">Restart CrowdSec</h3>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">Stops and starts the container. Needed after editing profiles.yaml or the notification files by hand. Detection pauses for a few seconds; bans stay in place.</p>
          </div>
          <button type="button" className={BTN_TOOLBAR_DANGER} disabled={busy !== ''} onClick={() => run('restart')}>{busy === 'restart' ? <Loader2 size={13} className="animate-spin" /> : <RotateCw size={13} />} Restart CrowdSec</button>
        </div>
      </div>
    </Panel>
  )
}

export default function SettingsTab() {
  const { isAdmin } = useCs()
  const sim = useSimulation()
  return (
    <div className="space-y-4">
      <ProfileCard scenarios={sim.installed} />
      <SimulationCard sim={sim} />
      <PluginSettings />
      {isAdmin && <MaintenanceCard />}
    </div>
  )
}
