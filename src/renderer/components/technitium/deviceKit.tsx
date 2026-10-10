// The Technitium page's devices, drawn once: the icon of each kind of device, its name as the page says it, the
// icon picker (a popover of every icon, keyboard reachable), the directory as one shared request, and time-ago.

import { useMemo, useState } from 'react'
import { Popover } from '@mantine/core'
import {
  Monitor, Laptop, Smartphone, Tablet, Tv, Gamepad2, Speaker, Cctv, Printer, Router, Server, Cpu, Lightbulb, Thermometer, Watch, Car, CircleHelp,
  type LucideIcon,
} from 'lucide-react'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { fetchTechnitiumDevices } from '../../api/endpoints'
import type { TechnitiumIcon, TechnitiumNetDevice } from '../../../shared/types'
import { FOCUS_RING } from '../../lib/ui'

export const DEVICE_ICONS: Record<TechnitiumIcon, { icon: LucideIcon; label: string }> = {
  desktop: { icon: Monitor, label: 'Desktop' },
  laptop: { icon: Laptop, label: 'Laptop' },
  phone: { icon: Smartphone, label: 'Phone' },
  tablet: { icon: Tablet, label: 'Tablet' },
  tv: { icon: Tv, label: 'TV' },
  console: { icon: Gamepad2, label: 'Console' },
  speaker: { icon: Speaker, label: 'Speaker' },
  camera: { icon: Cctv, label: 'Camera' },
  printer: { icon: Printer, label: 'Printer' },
  router: { icon: Router, label: 'Router' },
  server: { icon: Server, label: 'Server' },
  iot: { icon: Cpu, label: 'Smart home' },
  lightbulb: { icon: Lightbulb, label: 'Light' },
  thermostat: { icon: Thermometer, label: 'Thermostat' },
  watch: { icon: Watch, label: 'Watch' },
  car: { icon: Car, label: 'Car' },
  unknown: { icon: CircleHelp, label: 'Unknown' },
}
export const ICON_ORDER = Object.keys(DEVICE_ICONS) as TechnitiumIcon[]

/** the round tile a device's icon sits in (a guessed icon is drawn quieter) */
export function DeviceIcon({ icon, guessed = false, size = 'md' }: { icon: TechnitiumIcon | null | undefined; guessed?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const I = DEVICE_ICONS[icon ?? 'unknown']?.icon ?? CircleHelp
  const box = size === 'lg' ? 'h-11 w-11' : size === 'sm' ? 'h-6 w-6' : 'h-9 w-9'
  return (
    <span aria-hidden className={`${box} shrink-0 rounded-full inline-flex items-center justify-center border ${guessed ? 'bg-white/[0.03] border-white/5 text-slate-500' : 'bg-cyan-500/10 border-cyan-500/20 text-cyan-300'}`}>
      <I size={size === 'lg' ? 20 : size === 'sm' ? 12 : 16} />
    </span>
  )
}

/** the name the page gives a device: its nickname, else the name it gives itself (without the domain), else its vendor, else its address */
export function deviceName(d: Pick<TechnitiumNetDevice, 'nickname' | 'hostname' | 'ip' | 'id'> & { vendor?: string | null }): string {
  return d.nickname || (d.hostname ? d.hostname.replace(/\.(local|home|lan)\.?$/i, '') : '')
    || (d.vendor && d.vendor !== 'Private address' ? d.vendor : '') || d.ip || d.id
}

/** "3 min ago", "2 h ago", "4 days ago" from epoch seconds */
export function ago(epoch: number | null | undefined, now = Date.now() / 1000): string {
  if (!epoch) return '—'
  const s = Math.max(0, now - epoch)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  const d = Math.round(s / 86400)
  return `${d} day${d === 1 ? '' : 's'} ago`
}
export const exact = (epoch: number | null | undefined) => (epoch ? new Date(epoch * 1000).toLocaleString() : '')

/** the device directory, one request for the page (30 s); devices by address for the other tabs */
export function useDeviceDirectory(enabled = true) {
  const poll = usePolling(fetchTechnitiumDevices, 30000, { key: pollKeys.technitiumDevices, enabled })
  const byIp = useMemo(() => {
    const m = new Map<string, TechnitiumNetDevice>()
    for (const d of poll.data?.devices ?? []) if (d.ip && !m.has(d.ip)) m.set(d.ip, d)
    return m
  }, [poll.data])
  const byId = useMemo(() => new Map((poll.data?.devices ?? []).map((d) => [d.id, d])), [poll.data])
  return { ...poll, byIp, byId }
}

/** the icon of a device as a button that opens the picker (an admin's); a viewer sees the icon alone */
export function IconPicker({ device, canEdit, onPick }: { device: TechnitiumNetDevice; canEdit: boolean; onPick: (icon: TechnitiumIcon) => void }) {
  const [open, setOpen] = useState(false)
  const name = deviceName(device)
  const tile = <DeviceIcon icon={device.icon} guessed={device.icon_guessed} />
  if (!canEdit) return <span title={`${DEVICE_ICONS[device.icon]?.label ?? 'Unknown'}${device.icon_guessed ? ' (a guess)' : ''}`}>{tile}</span>
  return (
    <Popover opened={open} onChange={setOpen} position="bottom-start" withinPortal shadow="md" radius="md" trapFocus returnFocus>
      <Popover.Target>
        <button type="button" onClick={() => setOpen((o) => !o)} className={`rounded-full ${FOCUS_RING}`}
          aria-label={`Icon of ${name}: ${DEVICE_ICONS[device.icon]?.label ?? 'Unknown'}${device.icon_guessed ? ' (a guess)' : ''}. Change it`} aria-haspopup="dialog" aria-expanded={open}>
          {tile}
        </button>
      </Popover.Target>
      <Popover.Dropdown className="glass !p-2">
        <IconGrid value={device.icon_guessed ? null : device.icon} onPick={(i) => { setOpen(false); onPick(i) }} label={`Icon of ${name}`} />
      </Popover.Dropdown>
    </Popover>
  )
}

/** every icon, four or five a row, the chosen one marked (a radio group: arrows move, Enter or Space picks) */
export function IconGrid({ value, onPick, label, disabled = false }: { value: TechnitiumIcon | null; onPick: (icon: TechnitiumIcon) => void; label: string; disabled?: boolean }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-5 sm:grid-cols-6 gap-1.5 w-max max-w-full"
      onKeyDown={(e) => {
        const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button')]
        const i = btns.indexOf(document.activeElement as HTMLButtonElement)
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (i >= 0 && step) { e.preventDefault(); btns[(i + step + btns.length) % btns.length]?.focus() }
      }}>
      {ICON_ORDER.map((k) => {
        const { icon: I, label: l } = DEVICE_ICONS[k]
        const on = value === k
        return (
          <button key={k} type="button" role="radio" aria-checked={on} aria-label={l} title={l} disabled={disabled} onClick={() => onPick(k)}
            className={`h-12 w-14 rounded-lg inline-flex flex-col items-center justify-center gap-1 border transition-colors ${FOCUS_RING} ${on ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-white/[0.03] border-white/5 text-slate-400 hover:text-slate-200 hover:border-white/10'}`}>
            <I size={16} />
            <span className="text-[10px] leading-none whitespace-nowrap">{l}</span>
          </button>
        )
      })}
    </div>
  )
}
