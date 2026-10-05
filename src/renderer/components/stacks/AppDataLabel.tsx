// =============================================================================
// AppDataLabel — where a stack's App-Data is: the stack's own folder, or a drive of its own (with its free space, and a
// warning when that drive is not there). One line, for the stack card and the stack page.
// =============================================================================
import { HardDrive, FolderOpen, AlertTriangle } from 'lucide-react'
import type { StackAppData } from '../../../shared/types'
import { fmtBytes } from '../storage/StorageEverywhere'

/** `Stacks/<stack>/App-Data` for the default layout (the full path is in the tooltip) */
function shortPath(stack: string, ad: StackAppData): string {
  if (ad.external) return ad.path
  const i = ad.path.lastIndexOf(`/Stacks/${stack}/`)
  return i >= 0 ? ad.path.slice(i + 1) : ad.path
}

export default function AppDataLabel({ stack, appData, className = '' }: { stack: string; appData?: StackAppData; className?: string }) {
  if (!appData?.path) return null
  const missing = appData.external && !appData.ok
  const Icon = missing ? AlertTriangle : appData.external ? HardDrive : FolderOpen
  const tip = missing
    ? `${appData.path} is not there: is its drive mounted? DCS does not start the stack until it is back.`
    : `App-Data: ${appData.path}${appData.external ? ' (a drive of its own)' : ''}`
  return (
    <div className={`flex items-center gap-1.5 min-w-0 text-[10px] ${missing ? 'text-amber-300' : 'text-slate-500'} ${className}`} title={tip}>
      <Icon size={11} className={`shrink-0 ${missing ? '' : appData.external ? 'text-cyan-400/80' : ''}`} aria-hidden />
      <span className="uppercase tracking-wider font-semibold shrink-0">App-Data</span>
      <span className={`font-mono truncate min-w-0 ${missing ? '' : appData.external ? 'text-slate-300' : ''}`}>{shortPath(stack, appData)}</span>
      {missing
        ? <span className="shrink-0">· drive not mounted</span>
        : appData.external && appData.free_bytes != null && <span className="shrink-0 text-slate-500">· {fmtBytes(appData.free_bytes)} free</span>}
    </div>
  )
}
