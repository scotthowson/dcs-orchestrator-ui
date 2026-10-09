// =============================================================================
// ImageCard — Card view for a single Docker image with staleness indicator
// =============================================================================

import React from 'react'
import { ImageInfo } from '../../../shared/types'
import VmCapsule from '../fleet/VmCapsule'
import { HardDrive, Tag, Clock, Hash, ArrowUpCircle, CheckCircle } from 'lucide-react'
import { shortCreated, imageKey } from './imageFormat'

// ---------------------------------------------------------------------------
// Staleness styling
// ---------------------------------------------------------------------------

interface StalenessStyle {
  bg: string
  text: string
  ring: string
  barColor: string
  label: string
}

const STALENESS_STYLES: Record<string, StalenessStyle> = {
  current: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/20',
    barColor: 'bg-emerald-400',
    label: 'Current',
  },
  aging: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    ring: 'ring-amber-500/20',
    barColor: 'bg-amber-400',
    label: 'Aging',
  },
  stale: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    ring: 'ring-rose-500/20',
    barColor: 'bg-rose-400',
    label: 'Stale',
  },
  unknown: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    ring: 'ring-slate-500/20',
    barColor: 'bg-slate-400',
    label: 'Unknown',
  },
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Truncate a string, appending ellipsis. */
function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str
  return str.slice(0, maxLen - 1) + '\u2026'
}

/** Compute the age bar percentage (cap at 100% / 365 days). */
function agePercent(ageDays: number): number {
  if (ageDays < 0) return 0
  return Math.min(100, Math.round((ageDays / 365) * 100))
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ImageCardProps {
  image: ImageInfo
  /** the fleet view: the card says where the image lives */
  showWhere?: boolean
  /** batch mode: the card is a check box (click it, or its box) */
  batchMode?: boolean
  selected?: boolean
  onToggle?: (key: string) => void
}

const ImageCard: React.FC<ImageCardProps> = ({ image, showWhere = false, batchMode = false, selected = false, onToggle }) => {
  const style = STALENESS_STYLES[image.staleness] ?? STALENESS_STYLES.unknown
  const pct = agePercent(image.age_days)
  const picked = batchMode && selected

  return (
    <div
      onClick={batchMode ? () => onToggle?.(imageKey(image)) : undefined}
      className={`surface hover:border-white/10 transition-colors duration-150 p-4 flex flex-col gap-3 ${batchMode ? 'cursor-pointer' : ''} ${picked ? 'ring-1 ring-cyan-500/40 bg-cyan-500/[0.06]' : ''}`}
    >
      {/* Header: repo:tag + staleness badge */}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {batchMode && (
            <button
              type="button"
              role="checkbox"
              aria-checked={picked}
              aria-label={`Select ${image.repository}:${image.tag}`}
              onClick={(e) => { e.stopPropagation(); onToggle?.(imageKey(image)) }}
              className="flex items-center justify-center p-1.5 -m-1.5 rounded shrink-0"
            >
              <span className={`flex items-center justify-center w-5 h-5 rounded border transition-all ${picked ? 'bg-cyan-500 border-cyan-500' : 'bg-white/5 border-white/20 hover:border-white/40'}`}>
                {picked && (
                  <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </span>
            </button>
          )}
          <HardDrive className="h-4 w-4 text-cyan-400 flex-shrink-0" />
          <div className="min-w-0">
            {showWhere && <div className="mb-1"><VmCapsule member={image.member} name={image.member_name} vmid={image.vmid} size="xs" /></div>}
            <p className="text-sm font-semibold text-slate-100 truncate" title={image.repository}>
              {truncate(image.repository, 35)}
            </p>
            <div className="flex items-center gap-1 mt-0.5">
              <Tag className="h-3 w-3 text-slate-500" />
              <span className="text-xs text-slate-400">{image.tag}</span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ring-1 ${style.bg} ${style.text} ${style.ring}`}
          >
            <span className={`h-1.5 w-1.5 rounded-full ${style.barColor}`} />
            {style.label}
          </span>
          {image.update_available === true && (
            <span title="Update available" className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400">
              <ArrowUpCircle size={9} />
              Update
            </span>
          )}
          {image.update_available === false && (
            <span title="Up to date" className="inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider bg-white/[0.04] text-slate-500">
              <CheckCircle size={9} />
              Latest
            </span>
          )}
        </div>
      </div>

      {/* Image ID (short) */}
      <div className="flex items-center gap-1.5">
        <Hash className="h-3 w-3 text-slate-500" />
        <span className="text-xs font-mono text-slate-500">
          {image.id.length > 19 ? image.id.slice(0, 19) : image.id}
        </span>
      </div>

      {/* Age indicator bar */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-slate-500 uppercase tracking-wide">Age</span>
          <span className="text-[10px] text-slate-400">
            {image.age_days >= 0 ? `${image.age_days}d` : 'N/A'}
          </span>
        </div>
        <div className="w-full h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${style.barColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {/* Footer: size + created */}
      <div className="flex items-center justify-between pt-1 border-t border-white/[0.03]">
        <div className="flex items-center gap-1">
          <HardDrive className="h-3 w-3 text-slate-500" />
          <span className="text-xs text-slate-400">{image.size}</span>
        </div>
        <div className="flex items-center gap-1">
          <Clock className="h-3 w-3 text-slate-500" />
          <span className="text-xs text-slate-500" title={image.created}>
            {shortCreated(image.created)}
          </span>
        </div>
      </div>
    </div>
  )
}

export default ImageCard
