// =============================================================================
// PowerCard — the UPS at a glance: mains or battery, charge, runtime, load,
// and what DCS will do when the battery runs low
// =============================================================================

import { BatteryCharging, BatteryWarning, BatteryLow, Usb, ExternalLink } from 'lucide-react'
import { Badge } from '@mantine/core'
import { usePolling } from '../../hooks/usePolling'
import { useSettingsStore } from '../../stores/settingsStore'
import { pageLabel } from '../../constants/pageTitles'
import { fetchPower } from '../../api/endpoints'
import type { PowerStatus } from '../../../shared/types'
import { BTN_CARD, TONE_OK } from '../../lib/ui'
import { Card, CardBody, CardEmpty, CardError, CardLoading, TONE_FILL, TONE_TEXT, type CardCommonProps, type Tone } from './cardShared'

function fmtRuntime(s: number | null | undefined): string {
  if (s === null || s === undefined) return '—'
  if (s >= 3600) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`
  return `${Math.round(s / 60)} min`
}

const DOCS_PASSTHROUGH = 'https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/VM-IMAGES.md#hardware-you-pass-through'

const CAUSE_TITLE: Record<string, string> = {
  not_on_usb: "The UPS is not on this machine's USB",
  serial_device: 'apcupsd looks for the UPS on a serial line',
  restart_apcupsd: 'apcupsd lost the UPS',
  no_status: 'The UPS reported no status',
  no_answer: 'The UPS did not answer',
}

/** No reading to show, and why: the server says so (ok false, 4.0.30 and later), or an older server passed apcupsd's COMMLOST
 *  through as a reading, or the "reading" has nothing in it. Never "On mains" without a reading. */
function problemOf(d: PowerStatus): { title: string; detail: string } | null {
  const lost = /COMMLOST/i.test(d.status ?? '')
  const empty = !d.status && d.charge == null && d.runtime_seconds == null && d.load == null && d.input_voltage == null
  if (d.ok !== false && !lost && !empty) return null
  const title = (d.cause === 'no_usb' && (d.vm === false ? "This server's kernel has no USB support" : 'This VM has no USB support'))
    || (d.cause && CAUSE_TITLE[d.cause])
    || (lost ? 'apcupsd cannot talk to the UPS (COMMLOST)' : empty && d.ok !== false ? 'The UPS answered without a reading' : 'The UPS did not answer')
  // the server's sentence names the cause and the way out; "apcupsd cannot talk to the UPS (COMMLOST): …" is the title already
  const detail = (d.error || '').replace(/^apcupsd cannot talk to the UPS \(COMMLOST\):\s*/, '').replace(/^this VM has no USB support:\s*/i, '').replace(/^./, (c) => c.toUpperCase())
  return { title, detail: detail || (lost ? 'apcupsd answers, but it has no contact with the UPS: check the cable, or that the UPS is passed through to this machine.' : 'Nothing was read from the UPS.') }
}

export default function PowerCard(_props: CardCommonProps) {
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const { data, error, refresh } = usePolling(fetchPower, 15000)

  if (!data && error) return <Card card="power" tone="attention"><CardError title="Could not read the power status" error={error} onRetry={refresh} /></Card>
  if (!data) return <Card card="power"><CardLoading label="Reading the power status…" rows={3} /></Card>

  if (!data.enabled) {
    return (
      <Card card="power">
        <CardEmpty
          icon={<BatteryCharging size={22} />}
          title="No UPS is watched"
          hint="Point DCS at a NUT server (the nut-upsd template serves a USB unit), apcupsd or a CyberPower unit (pwrstat), and it will alert you and stop the stacks cleanly before the battery runs out."
          action={<button type="button" onClick={() => setCurrentPage('config')} className={`${BTN_CARD} ${TONE_OK}`}>Set it up in {pageLabel('config')}</button>}
        />
      </Card>
    )
  }

  const problem = problemOf(data)
  if (problem) {
    const noUsb = data.cause === 'no_usb' || data.usb === false
    return (
      <Card
        card="power"
        icon={noUsb ? Usb : BatteryWarning}
        tone="problem"
        badge={<Badge component="span" color="rose" leftSection={<span className={`w-1.5 h-1.5 rounded-full ${TONE_FILL.problem}`} />}>{data.status && /COMMLOST/i.test(data.status) ? 'UPS lost' : 'No reading'}</Badge>}
      >
        <CardBody>
          <div role="alert">
            <p className="text-sm font-medium text-rose-300">{problem.title}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400 break-words">{problem.detail}</p>
            {noUsb && data.cause !== 'no_usb' && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-amber-300">
                {data.vm === false
                  ? "This server's kernel has no USB drivers, so a UPS on USB cannot be seen here: boot a kernel with USB (Debian: linux-image-amd64), or read the UPS over NUT."
                  : "This VM has no USB support: its kernel has no USB drivers (Debian's cloud kernel has none), so a UPS passed through to it cannot be seen. Switch it to Debian's full kernel (linux-image-amd64), or read the UPS from the Proxmox host over NUT."}
              </p>
            )}
          </div>
          {noUsb && (
            <a href={DOCS_PASSTHROUGH} target="_blank" rel="noreferrer" className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-cyan-400 hover:underline">
              Passing a UPS through to a VM <ExternalLink size={11} aria-hidden />
            </a>
          )}
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
            <span>Source</span><span className="text-slate-300 text-right font-mono">{data.source}{data.ups ? ` · ${data.ups}` : ''}</span>
            {data.status && (<><span>Status</span><span className="text-slate-300 text-right font-mono">{data.status}</span></>)}
            {data.usb !== undefined && data.cause !== 'no_usb' && (<><span>USB in the kernel</span><span className={`text-right ${data.usb ? 'text-slate-300' : 'text-amber-300'}`}>{data.usb ? 'yes' : 'no'}</span></>)}
          </div>
          {(data.stale || !data.loop_running) && <p className="mt-2 text-[11px] text-amber-400">{!data.loop_running ? `Watch loop not running — restart the API from the ${pageLabel('updates')} page.` : 'Reading is stale.'}</p>}
        </CardBody>
      </Card>
    )
  }

  const charge = data.charge ?? null
  const onBatt = !!data.on_battery
  const low = !!data.low_battery
  const tone: Tone = low ? 'problem' : onBatt ? 'attention' : 'ok'
  const Icon = low ? BatteryLow : onBatt ? BatteryWarning : BatteryCharging
  const label = low ? 'Battery low' : onBatt ? 'On battery' : 'On mains'
  const color = low ? 'rose' : onBatt ? 'amber' : 'emerald'

  return (
    <Card
      card="power"
      icon={Icon}
      tone={low ? 'problem' : onBatt ? 'attention' : undefined}
      badge={<Badge component="span" color={color} leftSection={<span className={`w-1.5 h-1.5 rounded-full ${TONE_FILL[tone]} ${onBatt ? 'animate-pulse' : ''}`} />}>{label}</Badge>}
    >
      <CardBody>
        <div className="flex items-end gap-3 mb-2">
          <span className={`text-3xl font-bold tabular-nums ${TONE_TEXT[tone]}`}>{charge === null ? '—' : `${charge}%`}</span>
          <span className="text-[11px] text-slate-500 mb-1.5">{fmtRuntime(data.runtime_seconds)} left{data.load !== null && data.load !== undefined ? ` · load ${data.load}%` : ''}{data.load_watts !== null && data.load_watts !== undefined ? ` (${data.load_watts} W${data.rated_watts ? ` of ${data.rated_watts}` : ''})` : ''}</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/5 overflow-hidden mb-3" role="meter" aria-label="Battery charge" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0, Math.min(100, charge ?? 0))}>
          <div className={`h-full rounded-full transition-all duration-700 ${TONE_FILL[tone]}`} style={{ width: `${Math.max(0, Math.min(100, charge ?? 0))}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-slate-500">
          <span>Source</span><span className="text-slate-300 text-right font-mono">{data.source}{data.ups ? ` · ${data.ups}` : ''}</span>
          {data.model && (<><span>Model</span><span className="text-slate-300 text-right truncate">{data.model}</span></>)}
          {data.input_voltage !== null && data.input_voltage !== undefined && (<><span>Input</span><span className="text-slate-300 text-right tabular-nums">{data.input_voltage} V{data.output_voltage !== null && data.output_voltage !== undefined ? ` → ${data.output_voltage} V` : ''}</span></>)}
          {data.test_result && data.test_result !== 'Unknown' && (<><span>Self-test</span><span className="text-slate-300 text-right truncate" title={data.test_result}>{data.test_result}</span></>)}
          {data.last_power_event && (<><span>Last event</span><span className="text-slate-300 text-right truncate" title={data.last_power_event}>{data.last_power_event}</span></>)}
          {data.status && (<><span>Status</span><span className="text-slate-300 text-right font-mono">{data.status}</span></>)}
        </div>
        {data.stacks_stopped && <p className="mt-2 text-[11px] text-amber-300">The stacks were stopped for the battery. Start them from the {pageLabel('stacks')} page once mains is back.</p>}
        {data.last_event && !data.stacks_stopped && <p className="mt-2 text-[11px] text-slate-500 truncate" title={data.last_event}>{data.last_event}</p>}
        {(data.stale || !data.loop_running) && <p className="mt-2 text-[11px] text-amber-400">{!data.loop_running ? `Watch loop not running — restart the API from the ${pageLabel('updates')} page.` : 'Reading is stale.'}</p>}
      </CardBody>
    </Card>
  )
}
