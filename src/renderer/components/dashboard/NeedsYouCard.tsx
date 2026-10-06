// =============================================================================
// NeedsYouCard — "Needs your attention": only what is broken or waiting on you,
// each with the page that fixes it, worst first. Nothing to do → one calm line.
// The rules are lib/needs.ts; this card draws them from what the Dashboard
// already polls (stacks, image updates, backup status, disks) and the health
// report, and asks the server nothing itself.
//
// "Hide" puts an item away on this device until it changes (another stack
// stops, the backup fails again): the key is what it is, the fingerprint what
// it says.
// =============================================================================

import { useMemo, useState } from 'react'
import { Badge } from '@mantine/core'
import { CheckCircle2, ChevronRight, EyeOff } from 'lucide-react'
import { useHealthStore } from '../../stores/healthStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import { pageLabel } from '../../constants/pageTitles'
import type { BackupStatusResponse, DiskInfo, ImageCheckResponse, StackInfo } from '../../../shared/types'
import { collectNeeds, plural, type NeedItem } from '../../lib/needs'
import { Card, CardLoading, CardOffline } from './cardShared'

const HIDDEN_KEY = 'dcs-needs-you-hidden'

function loadHidden(): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(HIDDEN_KEY) || '{}') as Record<string, string> } catch { return {} }
}

interface Props {
  stacks: StackInfo[] | null
  /** the stack list could not be read: list what the rest says instead of waiting for it */
  stacksError?: Error | null
  images: ImageCheckResponse | null
  backup: BackupStatusResponse | null
  disks: DiskInfo[] | null
}

export default function NeedsYouCard({ stacks, stacksError, images, backup, disks }: Props) {
  const health = useHealthStore((s) => s.report)
  // the DCS update count is what an admin's check found (kept on this device): no item for anyone else, who cannot install it
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const storedUpdates = useSettingsStore((s) => s.updatesAvailable) ?? 0
  const dcsUpdates = isAdmin ? storedUpdates : 0
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const [hidden, setHidden] = useState(loadHidden)

  const items = useMemo(() => collectNeeds({ stacks, health, images, backup, disks, dcsUpdates }), [stacks, health, images, backup, disks, dcsUpdates])
  const shown = items.filter((i) => hidden[i.key] !== i.fingerprint)
  const hiddenNow = items.length - shown.length

  const saveHidden = (next: Record<string, string>) => {
    setHidden(next)
    try { localStorage.setItem(HIDDEN_KEY, JSON.stringify(next)) } catch { /* private window */ }
  }
  const hide = (i: NeedItem) => {
    // forget what no longer applies, so the list never grows
    const live = Object.fromEntries(Object.entries(hidden).filter(([k]) => items.some((x) => x.key === k)))
    saveHidden({ ...live, [i.key]: i.fingerprint })
  }

  if (!isConnected && !stacks && !health) return <Card card="needs-you" dim><CardOffline /></Card>
  // half a list would say "all good" too early: wait for the stacks (most of what can need you) unless they failed
  if (!stacks && !stacksError) return <Card card="needs-you"><CardLoading label="Checking what needs you…" rows={2} /></Card>

  const problems = shown.filter((i) => i.severity === 'problem').length
  const badge = shown.length
    ? <Badge component="span" color={problems ? 'rose' : 'amber'}>{shown.length}</Badge>
    : <Badge component="span" color="emerald">All good</Badge>

  return (
    <Card card="needs-you" badge={badge} tone={problems ? 'problem' : shown.length ? 'attention' : undefined} clickable={false}>
      {shown.length === 0 ? (
        <div className="flex flex-1 items-center gap-3 min-h-0">
          <CheckCircle2 size={20} className="shrink-0 text-emerald-400" aria-hidden />
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200">Nothing needs you right now</p>
            <p className="text-xs text-slate-500 truncate">
              {stacks ? `${plural(stacks.filter((s) => s.status === 'running').length, 'stack')} running` : 'Stacks running'}
              {backup?.last_backup ? ' · backups OK' : ''}
              {hiddenNow > 0 && <> · <button type="button" className="underline underline-offset-2 hover:text-slate-300" onClick={() => saveHidden({})}>{hiddenNow} hidden</button></>}
            </p>
          </div>
        </div>
      ) : (
        <ul className="-mx-1 flex-1 min-h-0 overflow-y-auto scrollbar-thin divide-y divide-white/5">
          {shown.map((i) => (
            <li key={i.key} className="group flex items-stretch gap-3 px-1 py-2">
              <span className={`w-1 shrink-0 rounded-full ${i.severity === 'problem' ? 'bg-rose-500' : 'bg-amber-500'}`} aria-hidden />
              <button type="button" onClick={() => setCurrentPage(i.page)} className="min-w-0 flex-1 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
                <span className="block text-[13px] font-medium text-slate-200 truncate">{i.title}</span>
                {i.detail && <span className="block text-xs text-slate-500 truncate" title={i.detail}>{i.detail}</span>}
              </button>
              <div className="flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => hide(i)} aria-label={`Hide “${i.title}” until it changes`} title="Hide until it changes"
                  className="h-7 w-7 rounded-md flex items-center justify-center text-slate-500 hover:text-slate-300 hover:bg-white/5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100 transition-opacity">
                  <EyeOff size={13} />
                </button>
                <button type="button" onClick={() => setCurrentPage(i.page)} className="h-7 px-2 rounded-md flex items-center gap-1 text-[11px] font-medium text-slate-400 hover:text-slate-200 hover:bg-white/5 whitespace-nowrap">
                  {pageLabel(i.page)} <ChevronRight size={12} aria-hidden />
                </button>
              </div>
            </li>
          ))}
          {hiddenNow > 0 && (
            <li className="px-1 pt-2 text-[11px] text-slate-500">
              <button type="button" className="underline underline-offset-2 hover:text-slate-300" onClick={() => saveHidden({})}>Show {plural(hiddenNow, 'hidden item')}</button>
            </li>
          )}
        </ul>
      )}
    </Card>
  )
}
