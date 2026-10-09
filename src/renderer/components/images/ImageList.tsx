// =============================================================================
// ImageList — Image table with a freshness filter and sortable columns
// =============================================================================

import React, { useState, useMemo } from 'react'
import { SegmentedControl } from '@mantine/core'
import { ImageInfo } from '../../../shared/types'
import VmCapsule from '../fleet/VmCapsule'
import { EmptyState } from '../common/PageState'
import SortableTh from '../common/SortableTh'
import { BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { sizeBytes, shortCreated, imageKey } from './imageFormat'
import { useImageStore } from '../../stores/imageStore'
import {
  HardDrive,
  Tag,
  Database,
  Search,
  X,
  ArrowUpCircle,
  CheckCircle,
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Sort helpers
// ---------------------------------------------------------------------------

type SortKey = keyof ImageInfo
type SortDirection = 'asc' | 'desc'

interface SortConfig {
  key: SortKey
  direction: SortDirection
}

/** what a column sorts by: a size by its bytes, everything else as it is */
function sortValue(image: ImageInfo, key: SortKey): unknown {
  return key === 'size' ? sizeBytes(image.size) : image[key]
}

function compareValues(a: unknown, b: unknown, direction: SortDirection): number {
  const mult = direction === 'asc' ? 1 : -1

  if (typeof a === 'number' && typeof b === 'number') {
    return (a - b) * mult
  }

  const strA = String(a ?? '').toLowerCase()
  const strB = String(b ?? '').toLowerCase()
  return strA.localeCompare(strB) * mult
}

// ---------------------------------------------------------------------------
// Filter (freshness)
// ---------------------------------------------------------------------------

type FilterTab = 'all' | 'current' | 'aging' | 'stale'

const TABS: { key: FilterTab; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'current', label: 'Current' },
  { key: 'aging', label: 'Aging' },
  { key: 'stale', label: 'Stale' },
]

// ---------------------------------------------------------------------------
// Staleness badge styles
// ---------------------------------------------------------------------------

interface StalenessStyle {
  bg: string
  text: string
  ring: string
  dot: string
}

const STALENESS_STYLES: Record<string, StalenessStyle> = {
  current: {
    bg: 'bg-emerald-500/10',
    text: 'text-emerald-400',
    ring: 'ring-emerald-500/20',
    dot: 'bg-emerald-400',
  },
  aging: {
    bg: 'bg-amber-500/10',
    text: 'text-amber-400',
    ring: 'ring-amber-500/20',
    dot: 'bg-amber-400',
  },
  stale: {
    bg: 'bg-rose-500/10',
    text: 'text-rose-400',
    ring: 'ring-rose-500/20',
    dot: 'bg-rose-400',
  },
  unknown: {
    bg: 'bg-slate-500/10',
    text: 'text-slate-400',
    ring: 'ring-slate-500/20',
    dot: 'bg-slate-400',
  },
}

// ---------------------------------------------------------------------------
// Column definitions
// ---------------------------------------------------------------------------

interface ColumnDef {
  key: SortKey
  label: string
  align?: 'left' | 'center' | 'right'
}

const COLUMNS: ColumnDef[] = [
  { key: 'repository', label: 'Repository' },
  { key: 'tag', label: 'Tag' },
  { key: 'id', label: 'ID' },
  { key: 'created', label: 'Created' },
  { key: 'size', label: 'Size' },
  { key: 'age_days', label: 'Age (days)', align: 'center' },
  { key: 'staleness', label: 'Staleness', align: 'center' },
]

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ImageListProps {
  /** the rows to list (the page's search already applied); the store's images when left out */
  rows?: ImageInfo[]
  /** what the search box says: a search that matched nothing names itself in the empty state */
  query?: string
  onClearSearch?: () => void
  batchMode?: boolean
  /** keys of the selected rows: member|id */
  selectedImages?: Set<string>
  onToggleImage?: (key: string) => void
  /** the fleet view: every row says where it lives */
  showWhere?: boolean
  onPickWhere?: (member: string | null) => void
  /** an empty library offers the Docker Hub search as its next step */
  onSearchHub?: () => void
}

const ImageList: React.FC<ImageListProps> = ({ rows, query = '', onClearSearch, batchMode = false, selectedImages, onToggleImage, showWhere = false, onPickWhere, onSearchHub }) => {
  const storeImages = useImageStore((s) => s.images)
  const images = rows ?? storeImages
  const loading = useImageStore((s) => s.loading)

  const [activeTab, setActiveTab] = useState<FilterTab>('all')
  const [sort, setSort] = useState<SortConfig>({ key: 'repository', direction: 'asc' })

  // Filter by staleness tab
  const filtered = useMemo(() => {
    if (activeTab === 'all') return images
    return images.filter((img) => img.staleness === activeTab)
  }, [images, activeTab])

  // Sort
  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) =>
      compareValues(sortValue(a, sort.key), sortValue(b, sort.key), sort.direction),
    )
  }, [filtered, sort])

  // Tab counts
  const tabCounts: Record<FilterTab, number> = useMemo(
    () => ({
      all: images.length,
      current: images.filter((i) => i.staleness === 'current').length,
      aging: images.filter((i) => i.staleness === 'aging').length,
      stale: images.filter((i) => i.staleness === 'stale').length,
    }),
    [images],
  )

  // Toggle sort column
  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === 'asc' ? 'desc' : 'asc' }
        : { key, direction: 'asc' },
    )
  }

  /** Truncate image ID for display. */
  const shortId = (id: string): string => (id.length > 19 ? id.slice(0, 19) : id)

  return (
    <div className="flex flex-col gap-4">
      {/* ---- Freshness filter: one choice; a phone swipes it sideways ---- */}
      <div className="min-w-0 max-w-full self-start overflow-x-auto scrollbar-none">
        <SegmentedControl
          aria-label="Show images that are"
          value={activeTab}
          onChange={(v) => setActiveTab(v as FilterTab)}
          data={TABS.map((tab) => ({
            value: tab.key,
            label: <span className="flex items-center gap-1.5">{tab.label}<span className="tabular-nums text-[10px] opacity-60">{tabCounts[tab.key]}</span></span>,
          }))}
        />
      </div>

      {/* ---- Table ---- */}
      <div className="glass overflow-hidden">
        <div className="overflow-x-auto scrollbar-thin">
          <table className="w-full">
            <thead>
              <tr className="border-b border-white/5">
                {batchMode && (
                  <th className="px-3 py-3 w-10"><span className="sr-only">Select</span></th>
                )}
                {COLUMNS.map((col) => (
                  <SortableTh
                    key={col.key}
                    label={col.label}
                    active={sort.key === col.key}
                    direction={sort.direction}
                    onSort={() => handleSort(col.key)}
                    align={col.align === 'center' ? 'center' : 'left'}
                  />
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && images.length === 0 ? (
                <>
                  {[...Array(5)].map((_, i) => (
                    <tr key={i}>
                      <td colSpan={COLUMNS.length + (batchMode ? 1 : 0)} className="py-1.5 px-3">
                        <div className="animate-pulse bg-slate-800/40 rounded-lg h-10 border border-white/[0.03]" />
                      </td>
                    </tr>
                  ))}
                </>
              ) : sorted.length === 0 ? (
                <tr>
                  <td colSpan={COLUMNS.length + (batchMode ? 1 : 0)}>
                    <EmptyState
                      icon={<HardDrive size={28} />}
                      title={activeTab !== 'all' ? `No ${activeTab} images found.` : query ? 'No images match your search.' : 'No images found.'}
                      hint={activeTab !== 'all' ? 'Pick another filter to see the rest.' : query ? 'Try another name, tag or ID.' : 'Run a registry check to discover images, or pull one from Docker Hub.'}
                      action={activeTab !== 'all'
                        ? <button type="button" onClick={() => setActiveTab('all')} className={BTN_TOOLBAR_QUIET}>Show all images</button>
                        : query && onClearSearch ? <button type="button" onClick={onClearSearch} className={BTN_TOOLBAR_QUIET}><X size={14} /> Clear the search</button>
                        : onSearchHub ? <button type="button" onClick={onSearchHub} className={BTN_TOOLBAR_QUIET}><Search size={14} /> Search Docker Hub</button> : undefined}
                    />
                  </td>
                </tr>
              ) : (
                sorted.map((image, idx) => {
                  const ss =
                    STALENESS_STYLES[image.staleness] ?? STALENESS_STYLES.unknown
                  const rowSelected = batchMode && !!selectedImages?.has(imageKey(image))

                  return (
                    <tr
                      key={`${imageKey(image)}-${idx}`}
                      onClick={() => batchMode && onToggleImage?.(imageKey(image))}
                      className={`group border-b border-white/[0.03] hover:bg-white/5 transition-colors ${
                        batchMode ? 'cursor-pointer' : ''
                      } ${rowSelected ? 'bg-cyan-500/[0.08]' : ''}`}
                    >
                      {/* Batch checkbox */}
                      {batchMode && (
                        <td className="px-3 py-3">
                          <button
                            onClick={(e) => { e.stopPropagation(); onToggleImage?.(imageKey(image)) }}
                            role="checkbox"
                            aria-checked={rowSelected}
                            aria-label={`Select ${image.repository}:${image.tag}`}
                            className="flex items-center justify-center p-1.5 -m-1.5 rounded"
                          >
                            <span className={`flex items-center justify-center w-5 h-5 rounded border transition-all ${
                              rowSelected
                                ? 'bg-cyan-500 border-cyan-500'
                                : 'bg-white/5 border-white/20 hover:border-white/40'
                            }`}>
                              {rowSelected && (
                                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              )}
                            </span>
                          </button>
                        </td>
                      )}

                      {/* Repository */}
                      <td className="px-3 py-3">
                        <div className="flex items-center gap-2">
                          <Database className="h-4 w-4 text-slate-500 group-hover:text-cyan-400 transition-colors flex-shrink-0" />
                          <span
                            className="text-sm font-medium text-slate-200 group-hover:text-white transition-colors truncate max-w-[240px]"
                            title={image.repository}
                          >
                            {image.repository}
                          </span>
                          {showWhere && <VmCapsule member={image.member} name={image.member_name} vmid={image.vmid} size="xs" onClick={onPickWhere ? () => onPickWhere(image.member ?? null) : undefined} />}
                        </div>
                      </td>

                      {/* Tag */}
                      <td className="px-3 py-3">
                        <span className="inline-flex items-center gap-1 text-xs font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded">
                          <Tag className="h-3 w-3" />
                          {image.tag}
                        </span>
                      </td>

                      {/* ID */}
                      <td className="px-3 py-3">
                        <span className="text-xs font-mono text-slate-500" title={image.id}>
                          {shortId(image.id)}
                        </span>
                      </td>

                      {/* Created */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-sm text-slate-400" title={image.created}>{shortCreated(image.created)}</span>
                      </td>

                      {/* Size */}
                      <td className="px-3 py-3 whitespace-nowrap">
                        <span className="text-sm text-slate-400">{image.size}</span>
                      </td>

                      {/* Age (days) */}
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`text-sm font-medium ${
                            image.age_days > 90
                              ? 'text-rose-400'
                              : image.age_days > 30
                              ? 'text-amber-400'
                              : 'text-slate-300'
                          }`}
                        >
                          <span className="tabular-nums">{image.age_days}</span>
                        </span>
                      </td>

                      {/* Staleness + Update/Latest */}
                      <td className="px-3 py-3 text-center">
                        <div className="inline-flex items-center gap-1.5 flex-wrap justify-center">
                          <span
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ring-1 ${ss.bg} ${ss.text} ${ss.ring}`}
                          >
                            <span className={`h-1.5 w-1.5 rounded-full ${ss.dot}`} />
                            {image.staleness}
                          </span>
                          {image.update_available === true && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-emerald-500/15 text-emerald-400">
                              <ArrowUpCircle size={10} />
                              Update
                            </span>
                          )}
                          {image.update_available === false && (
                            <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider bg-white/[0.04] text-slate-500">
                              <CheckCircle size={10} />
                              Latest
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

export default ImageList
