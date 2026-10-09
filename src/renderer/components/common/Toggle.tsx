// =============================================================================
// Toggle — on / off for a setting that is kept: the Mantine Switch as lib/mantine
// themes it (46 × 24, emerald when on), a real role="switch" with a name. A
// toggle that only changes the view (a filter, a "show more") is a Segmented or
// a pressed button instead.
//
//   <Toggle checked={on} onChange={setOn} label="Send a daily summary" />          the switch alone (named)
//   <ToggleRow id="x" checked={on} onChange={setOn} label="Show debug lines" help="…" def="off" />
//                                       the row of a settings list: what it is and a line on the left, the switch right
// =============================================================================

import { useId, type ReactNode } from 'react'
import { Switch } from '@mantine/core'

export function Toggle({ checked, onChange, label, disabled = false, id, describedBy }: {
  checked: boolean
  onChange: (v: boolean) => void
  /** the switch's name; leave it out when a <label htmlFor={id}> names it */
  label?: string
  disabled?: boolean
  id?: string
  describedBy?: string
}) {
  return (
    <Switch
      id={id}
      checked={checked}
      disabled={disabled}
      aria-label={label}
      aria-describedby={describedBy}
      onChange={(e) => onChange(e.currentTarget.checked)}
      className="shrink-0"
    />
  )
}

export function ToggleRow({ id, label, help, def, checked, onChange, disabled = false }: {
  id?: string
  label: string
  help?: ReactNode
  /** the value it has until someone changes it: "Default: on." ends the help line */
  def?: string
  checked: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
}) {
  const auto = useId()
  const key = id ?? auto
  return (
    <div className="flex items-start justify-between gap-4 min-w-0">
      <div className="min-w-0 flex-1">
        <label htmlFor={key} className="block text-sm text-slate-200 cursor-pointer">{label}</label>
        {(help || def) && <p id={`${key}-help`} className="text-xs text-slate-500 mt-0.5 leading-relaxed">{help}{def !== undefined && <> Default: {def}.</>}</p>}
      </div>
      <div className="pt-0.5"><Toggle id={key} checked={checked} onChange={onChange} disabled={disabled} describedBy={help || def ? `${key}-help` : undefined} /></div>
    </div>
  )
}
