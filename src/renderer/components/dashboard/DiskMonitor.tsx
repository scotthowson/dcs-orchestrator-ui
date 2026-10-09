// =============================================================================
// DiskMonitor — mounted filesystems with custom labels and usage bars, a
//               warning banner and a pulsing bar for a disk near capacity
// =============================================================================

import { useState, useCallback } from 'react'
import { HardDrive, Pencil, Check, X, FolderPlus, AlertTriangle, ShieldAlert } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import Hint from '../common/Hint'
import { BTN_ICON_SM, TONE_GHOST, TONE_GHOST_OK } from '../../lib/ui'
import type { DiskInfo, CustomDiskEntry } from '../../../shared/types'
import { Card, CardBody } from './cardShared'
import { PCT_PROBLEM, pctTone, TONE_FILL, TONE_TEXT } from '../../lib/tone'
import { EmptyState } from '../common/PageState'
import { Pill } from '../common/Pill'
// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parsePercent(p: string): number {
  return parseInt(p.replace('%', ''), 10) || 0
}

// ---------------------------------------------------------------------------
// Disk warning banner
// ---------------------------------------------------------------------------

function DiskWarningBanner({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 mb-3 animate-fade-in" role="alert">
      <AlertTriangle size={14} className="text-rose-400 shrink-0" aria-hidden />
      <span className="text-xs font-medium text-rose-300">
        {count} disk{count !== 1 ? 's' : ''} above {PCT_PROBLEM}% capacity
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// One row: a mounted disk, a custom location that is mounted, or one that is not
// ---------------------------------------------------------------------------

function DiskRow({ mount, disk, custom, label, fallbackName, onLabelChange }: {
  mount: string
  disk: DiskInfo | null
  custom: boolean
  label: string
  /** the name a custom location was added under, when no label was set */
  fallbackName?: string
  onLabelChange: (mount: string, label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState(label)
  const [barHovered, setBarHovered] = useState(false)
  const pct = disk ? parsePercent(disk.percent) : 0
  const tone = pctTone(pct)
  const nearCapacity = !!disk && pct >= PCT_PROBLEM
  const displayName = label || fallbackName || mount
  const RowIcon = custom ? FolderPlus : HardDrive

  const handleSave = () => {
    onLabelChange(mount, editValue.trim())
    setEditing(false)
  }
  const handleCancel = () => {
    setEditValue(label)
    setEditing(false)
  }

  return (
    <div className={`group rounded-lg bg-white/[0.03] border ${disk ? 'border-white/5 hover:border-white/10' : 'border-dashed border-white/10'} p-3 transition-colors`}>
      <div className={`flex items-center justify-between gap-2 ${disk ? 'mb-2.5' : 'mb-1.5'}`}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <RowIcon size={14} className={disk ? 'text-slate-400 shrink-0' : 'text-slate-500 shrink-0'} aria-hidden />
          {editing ? (
            <div className="flex items-center gap-1 flex-1 min-w-0">
              <input
                type="text"
                aria-label={`Label for ${mount}`}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' ? handleSave() : e.key === 'Escape' ? handleCancel() : null}
                autoFocus
                className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30"
                placeholder="Custom label…"
              />
              <Hint label="Save"><button type="button" aria-label="Save the label" onClick={handleSave} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}><Check size={12} /></button></Hint>
              <Hint label="Cancel"><button type="button" aria-label="Cancel" onClick={handleCancel} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><X size={12} /></button></Hint>
            </div>
          ) : (
            <>
              <span className="text-xs font-semibold text-slate-200 truncate" title={mount}>{displayName}</span>
              {custom && <Pill tone="neutral">custom</Pill>}
              {nearCapacity && <span className="shrink-0 inline-flex" role="img" aria-label="Near capacity" title="Near capacity"><ShieldAlert size={12} className="text-rose-400" /></span>}
              <Hint label="Rename">
                <button
                  type="button"
                  aria-label={`Rename ${displayName}`}
                  onClick={() => { setEditValue(label); setEditing(true) }}
                  className={`${BTN_ICON_SM} ${TONE_GHOST} opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100`}
                >
                  <Pencil size={12} />
                </button>
              </Hint>
            </>
          )}
        </div>
        {disk && <span className={`text-xs font-bold tabular-nums ${TONE_TEXT[tone]}`}>{disk.percent}</span>}
      </div>

      {disk ? (
        <>
          <div className="relative mb-2" onMouseEnter={() => setBarHovered(true)} onMouseLeave={() => setBarHovered(false)}>
            {/* what the bar stands for, above it while the pointer is on it */}
            <div
              className={`
                absolute -top-9 z-20 flex items-center gap-2 px-2.5 py-1 rounded-lg
                bg-slate-800/95 border border-white/10 backdrop-blur-md shadow-lg shadow-black/30
                text-[11px] font-medium whitespace-nowrap pointer-events-none
                transition-all duration-150 origin-bottom
                ${barHovered ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}
              `}
              style={{ left: `clamp(0px, calc(${pct}% - 60px), calc(100% - 120px))` }}
              aria-hidden
            >
              <span className={`inline-block h-2 w-2 rounded-full shrink-0 ${TONE_FILL[tone]}`} />
              <span className="text-slate-200">{disk.used}</span>
              <span className="text-slate-500">/</span>
              <span className="text-slate-400">{disk.total}</span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-400">{disk.available} free</span>
            </div>
            <div className="h-2.5 rounded-full bg-slate-800/80 overflow-hidden" role="meter" aria-label={`${displayName} used`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
              <div
                className={`h-full rounded-full ${TONE_FILL[tone]} transition-all duration-700 ease-out ${nearCapacity ? 'animate-pulse' : ''} ${barHovered ? 'brightness-125 shadow-lg' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">
              <span className="text-slate-400 font-medium">{disk.used}</span>
              <span className="text-slate-600 mx-0.5">/</span>
              <span>{disk.total}</span>
            </span>
            <span className="text-slate-500">
              <span className="text-slate-400 font-medium">{disk.available}</span>
              <span className="ml-0.5">free</span>
            </span>
          </div>
          <div className="mt-1.5 text-[10px] text-slate-500 font-mono truncate" title={disk.device}>{label ? mount : disk.device}</div>
        </>
      ) : (
        <div className="flex items-center gap-2 text-[11px] text-slate-500">
          <span className="font-mono">{mount}</span>
          <span className="text-slate-600">—</span>
          <span className="italic">Not mounted, or the server sent no data</span>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function DiskMonitor({ disks }: { disks: DiskInfo[] }) {
  const diskLabels = useSettingsStore((s) => s.diskLabels) ?? {}
  const customDisks: CustomDiskEntry[] = useSettingsStore((s) => s.customDisks) ?? []
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  const handleLabelChange = useCallback((mount: string, label: string) => {
    const newLabels = { ...diskLabels }
    if (label) {
      newLabels[mount] = label
    } else {
      delete newLabels[mount]
    }
    updateSetting('diskLabels', newLabels)
  }, [diskLabels, updateSetting])

  // Custom locations the server does not report a disk for
  const customMountsNotInServer = customDisks.filter((c) => !disks.some((d) => d.mount === c.mount))
  const totalMounts = disks.length + customMountsNotInServer.length
  const disksNearCapacity = disks.filter((d) => parsePercent(d.percent) >= PCT_PROBLEM).length

  if (totalMounts === 0) {
    return (
      <Card card="disk-monitor">
        <EmptyState card icon={<HardDrive size={22} />} title="No disk data" hint="The server has not reported a disk yet." />
      </Card>
    )
  }

  return (
    <Card card="disk-monitor" meta={`${totalMounts} drive${totalMounts !== 1 ? 's' : ''}`} tone={disksNearCapacity > 0 ? 'problem' : undefined}>
      <CardBody>
        <DiskWarningBanner count={disksNearCapacity} />
        <div className="grid grid-cols-1 gap-2.5">
          {disks.map((disk) => {
            const custom = customDisks.find((c) => c.mount === disk.mount)
            return (
              <DiskRow
                key={disk.mount}
                mount={disk.mount}
                disk={disk}
                custom={!!custom}
                label={diskLabels[disk.mount] ?? ''}
                fallbackName={custom?.label}
                onLabelChange={handleLabelChange}
              />
            )
          })}
          {customMountsNotInServer.map((custom) => (
            <DiskRow
              key={custom.mount}
              mount={custom.mount}
              disk={null}
              custom
              label={diskLabels[custom.mount] ?? ''}
              fallbackName={custom.label}
              onLabelChange={handleLabelChange}
            />
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
