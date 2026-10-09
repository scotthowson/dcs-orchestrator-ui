// =============================================================================
// DashboardGrid — 24-column free-placement grid with x,y positioning
// =============================================================================

import React, { useCallback, useRef, useState, useEffect } from 'react'
import { X, RotateCcw, Settings2, Plus, Check, Move, LayoutDashboard, Box, Puzzle } from 'lucide-react'
import { createPortal } from 'react-dom'
import type { DashboardCard } from '../../../shared/types'
import { getCardEntry, clampCardSize, CARD_ICONS, H_UNIT, GRID_COLS } from './cardRegistry'
import Hint from '../common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_DANGER } from '../../lib/ui'
import { pageLabel } from '../../constants/pageTitles'

// The CSS grid gap (px); the real row pitch is H_UNIT + GRID_GAP
const GRID_GAP = 8

import { fetchPluginCards } from '../../api/endpoints'
import { PluginCardFrame } from './PluginFrame'
import type { PluginCardMeta } from '../../../shared/types'
import { useConnectionStore } from '../../stores/connectionStore'

import OverviewCards from './OverviewCards'
import StackStatusGrid from './StackStatusGrid'
import HealthSummary from './HealthSummary'
import ResourceChart from './ResourceChart'
import ContainerOverview from './ContainerOverview'
import ServerInfoComp from './ServerInfo'
import DiskMonitor from './DiskMonitor'
import PersistentTrends from './PersistentTrends'
import TopResourceConsumers from './TopResourceConsumers'
import ImageUpdateAlert from './ImageUpdateAlert'
import BackupStatusCard from './BackupStatusCard'
import LogHealthSummary from './LogHealthSummary'
import MaintenanceSummary from './MaintenanceSummary'
import NotificationStatus from './NotificationStatus'
import ActiveAutomations from './ActiveAutomations'
import RecentEvents from './RecentEvents'
import QuickActions from './QuickActions'
import CrowdSecStatus from './CrowdSecStatus'
import StackControls from './StackControls'
import ContainerSpotlight from './ContainerSpotlight'
import RoutesDns from './RoutesDns'
import NotesCard from './NotesCard'
import PowerCard from './PowerCard'
import BookmarksCard from './BookmarksCard'
import ProxmoxCard from './ProxmoxCard'
import NeedsYouCard from './NeedsYouCard'
import ModalOverlay from '../common/ModalOverlay'

import { Pill } from '../common/Pill'
import CloseButton from '../common/CloseButton'
const COMPONENT_MAP: Record<string, React.ComponentType<any>> = {
  'needs-you': NeedsYouCard,
  'overview': OverviewCards, 'stack-grid': StackStatusGrid,
  'health-summary': HealthSummary, 'resource-chart': ResourceChart,
  'container-overview': ContainerOverview, 'server-info': ServerInfoComp,
  'disk-monitor': DiskMonitor, 'trends': PersistentTrends,
  'top-consumers': TopResourceConsumers, 'image-updates': ImageUpdateAlert,
  'backup-status': BackupStatusCard, 'log-health': LogHealthSummary,
  'maintenance': MaintenanceSummary, 'notifications': NotificationStatus,
  'automations': ActiveAutomations, 'recent-events': RecentEvents,
  'quick-actions': QuickActions, 'crowdsec': CrowdSecStatus,
  'stack-controls': StackControls, 'container-spotlight': ContainerSpotlight,
  'routes-dns': RoutesDns, 'notes': NotesCard, 'bookmarks': BookmarksCard,
  'power': PowerCard, 'proxmox': ProxmoxCard,
}

interface Props {
  cards: DashboardCard[]
  editMode: boolean
  labels: Record<string, string>
  onToggleCard: (id: string) => void
  onResizeCard: (id: string, w: number, h: number) => void
  onMoveCard: (id: string, x: number, y: number) => void
  onExitEdit: () => void
  onDiscardEdit: () => void
  onResetLayout: () => void
  onAddSpecial: (type: 'spacer' | 'divider') => void
  onAddPluginCard: (id: string, w: number, h: number) => void
  onSetLabel: (id: string, title: string) => void
  cardProps?: Record<string, Record<string, unknown>>
  /** Per-card settings from the layout, and how a card saves its own */
  cardConfig?: Record<string, unknown>
  onSaveCardConfig?: (id: string, cfg: unknown) => Promise<boolean> | void
}

/** What edit mode draws over a card: its name, a remove button, the move handle, the size and the resize corner */
function EditChrome({ label, showName = true, tone, w, h, active, onRemove, onMoveDown, onResizeDown }: {
  label: string
  /** a card with a header of its own says its name there: the chip would sit on top of it */
  showName?: boolean
  tone: 'card' | 'other'
  w: number
  h: number
  active: boolean
  onRemove: () => void
  onMoveDown: (e: React.MouseEvent) => void
  onResizeDown: (e: React.MouseEvent) => void
}) {
  return (
    <>
      {/* The name (top-left) */}
      {showName && (
        <div className="absolute top-2 left-7 z-20 pointer-events-none max-w-[calc(100%-4rem)]">
          <span className={`block truncate px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-900/90 border shadow-lg ${tone === 'card' ? 'text-emerald-400 border-emerald-500/20' : 'text-slate-300 border-white/10'}`}>
            {label}
          </span>
        </div>
      )}
      {/* Remove (top-right) */}
      <div className="absolute top-1.5 right-1.5 z-20">
        <Hint label="Remove from the dashboard">
          <button
            type="button"
            aria-label={`Remove ${label}`}
            onClick={(e) => { e.stopPropagation(); onRemove() }}
            className="h-6 w-6 rounded-full flex items-center justify-center shadow-lg bg-slate-800/90 border border-white/10 text-rose-400 hover:bg-rose-500/30 transition-colors"
          >
            <X size={11} />
          </button>
        </Hint>
      </div>
      {/* Move handle */}
      <div className="absolute -left-1 top-3 z-20 cursor-move" onMouseDown={onMoveDown} aria-hidden>
        <div className="h-8 w-5 rounded-md bg-slate-800/90 border border-white/10 flex items-center justify-center shadow-lg hover:bg-emerald-500/20 hover:border-emerald-500/30 transition-colors">
          <Move size={10} className="text-slate-400" />
        </div>
      </div>
      {/* Size */}
      <div className="absolute bottom-2 left-2 z-10 pointer-events-none">
        <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-bold border shadow ${
          active ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/30' : 'bg-slate-900/90 text-slate-500 border-white/[0.06]'
        }`}>{w}×{h}</span>
      </div>
      {/* Resize corner */}
      <div
        className="absolute -bottom-1 -right-1 z-[40] w-6 h-6 cursor-nwse-resize bg-slate-800/80 border border-white/10 rounded-tl-lg rounded-br-xl hover:bg-cyan-500/20 hover:border-cyan-500/30 transition-all shadow-lg flex items-center justify-center"
        onMouseDown={onResizeDown}
        aria-hidden
      >
        <svg width="10" height="10" viewBox="0 0 10 10" className="text-slate-500 hover:text-cyan-400">
          <path d="M8 2L2 8M8 5L5 8M8 8L8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
    </>
  )
}

export default function DashboardGrid({
  cards, editMode, labels, onToggleCard, onResizeCard, onMoveCard,
  onExitEdit, onDiscardEdit, onResetLayout, onAddSpecial, onAddPluginCard, onSetLabel, cardProps = {},
  cardConfig = {}, onSaveCardConfig,
}: Props) {
  const [showPicker, setShowPicker] = useState(false)
  const [resizingId, setResizingId] = useState<string | null>(null)
  const [movingId, setMovingId] = useState<string | null>(null)
  const [pluginCards, setPluginCards] = useState<PluginCardMeta[]>([])
  const gridRef = useRef<HTMLDivElement>(null)
  const isConnected = useConnectionStore((s) => s.status === 'connected')

  // Phones get one column: 24 columns squeeze a quarter-width card to a few pixels
  const [isNarrow, setIsNarrow] = useState(() => typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const onChange = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  const stacked = isNarrow && !editMode

  // Discover plugin cards from enabled plugins
  useEffect(() => {
    if (!isConnected) return
    let cancelled = false
    fetchPluginCards().then((res) => { if (!cancelled) setPluginCards(res.cards || []) }).catch(() => {})
    return () => { cancelled = true }
  }, [isConnected])

  // Escape key exits edit mode (discard)
  React.useEffect(() => {
    if (!editMode) return
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const t = e.target as HTMLElement | null
      // Typing a divider title or using a picker must not throw the session away
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      if (showPicker) { setShowPicker(false); return }
      onDiscardEdit()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [editMode, onDiscardEdit, showPicker])

  // Calculate total grid height
  const visibleCards = cards.filter((c) => c.visible)
  // Stacked order is top to bottom, left to right; spacers only pad the wide grid
  const renderCards = stacked
    ? visibleCards.filter((c) => !c.id.startsWith('spacer-')).sort((a, b) => a.y - b.y || a.x - b.x)
    : visibleCards
  const placeCard = (card: DashboardCard): React.CSSProperties => stacked
    ? { gridColumn: '1 / -1', gridRow: `span ${card.h}` }
    : { gridColumn: `${card.x + 1} / span ${Math.min(card.w, GRID_COLS - card.x)}`, gridRow: `${card.y + 1} / span ${card.h}` }
  const hiddenCards = cards.filter((c) => !c.visible)
  const maxRow = Math.max(...visibleCards.map((c) => c.y + c.h), 1)

  // ── Resize (mousedown → drag → mouseup) ──
  const handleResizeDown = useCallback((e: React.MouseEvent, id: string, startW: number, startH: number) => {
    if (!editMode || !gridRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startY = e.clientY
    const colPx = gridRef.current.offsetWidth / GRID_COLS
    setResizingId(id)

    function onMove(ev: MouseEvent) {
      ev.preventDefault()
      const dw = Math.round((ev.clientX - startX) / colPx)
      const dh = Math.round((ev.clientY - startY) / (H_UNIT + GRID_GAP))
      const clamped = clampCardSize(id, startW + dw, startH + dh)
      onResizeCard(id, clamped.w, clamped.h)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setResizingId(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [editMode, onResizeCard])

  // ── Move (mousedown → drag → mouseup) — snaps to grid position ──
  const handleMoveDown = useCallback((e: React.MouseEvent, id: string, startCardX: number, startCardY: number) => {
    if (!editMode || !gridRef.current) return
    e.preventDefault()
    e.stopPropagation()
    const startMouseX = e.clientX
    const startMouseY = e.clientY
    const colPx = gridRef.current.offsetWidth / GRID_COLS
    setMovingId(id)

    function onMove(ev: MouseEvent) {
      ev.preventDefault()
      const dx = Math.round((ev.clientX - startMouseX) / colPx)
      const dy = Math.round((ev.clientY - startMouseY) / (H_UNIT + GRID_GAP))
      const newX = Math.max(0, Math.min(GRID_COLS - 1, startCardX + dx))
      const newY = Math.max(0, startCardY + dy)
      onMoveCard(id, newX, newY)
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
      setMovingId(null)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [editMode, onMoveCard])

  return (
    <div>
      {/* ── Edit toolbar ── */}
      {editMode && (
        <div className="flex flex-wrap items-center justify-between px-4 py-3 mb-4 bg-slate-900/80 backdrop-blur-md border border-emerald-500/20 rounded-xl animate-fade-in sticky top-0 z-30 gap-2">
          <div className="flex items-center gap-3">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center" aria-hidden>
              <Settings2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <div>
              <span className="text-sm font-semibold text-emerald-400">Edit dashboard</span>
              <span className="text-[11px] text-slate-500 ml-2 hidden lg:inline">{visibleCards.length} cards · Esc to cancel</span>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => setShowPicker(true)} className={BTN_TOOLBAR_QUIET}>
              <Plus size={14} /> Add card
            </button>
            <button type="button" onClick={() => onAddSpecial('spacer')} className={BTN_TOOLBAR_QUIET}>
              <Plus size={14} /> Add spacer
            </button>
            <button type="button" onClick={() => onAddSpecial('divider')} className={BTN_TOOLBAR_QUIET}>
              <Plus size={14} /> Add divider
            </button>
            <div className="w-px h-5 bg-white/10" aria-hidden />
            <button type="button" onClick={onResetLayout} className={BTN_TOOLBAR_QUIET}>
              <RotateCcw size={14} /> Reset layout
            </button>
            <Hint label="Throw away every change (Esc)">
              <button type="button" onClick={onDiscardEdit} className={`${BTN_TOOLBAR} ${TONE_DANGER}`}>
                <X size={14} /> Discard
              </button>
            </Hint>
            <button type="button" onClick={onExitEdit} className={`${BTN_TOOLBAR} font-semibold text-white bg-emerald-600 hover:bg-emerald-500`}>
              <Check size={14} /> Save layout
            </button>
          </div>
        </div>
      )}

      {/* ── Free-placement grid ── */}
      <div
        ref={gridRef}
        className="dashboard-grid relative"
        style={{
          display: 'grid',
          gridTemplateColumns: stacked ? '1fr' : `repeat(${GRID_COLS}, 1fr)`,
          gridAutoRows: `${H_UNIT}px`,
          gap: '8px',
          minHeight: editMode ? `${(maxRow + 4) * H_UNIT}px` : undefined,
        }}
      >
        {/* Empty state */}
        {visibleCards.length === 0 && editMode && (
          <div className="col-span-full flex flex-col items-center justify-center py-20 text-center" style={{ gridColumn: '1 / -1', gridRow: '1 / span 6' }}>
            <div className="w-12 h-12 rounded-xl bg-slate-800/60 border border-white/5 flex items-center justify-center mb-4">
              <LayoutDashboard className="h-5 w-5 text-slate-500" />
            </div>
            <p className="text-sm text-slate-400 font-medium mb-1">No cards on the dashboard</p>
            <p className="text-xs text-slate-500">Choose "Add card" above to put one here</p>
          </div>
        )}

        {/* Grid overlay in edit mode — subtle lines showing the grid structure */}
        {editMode && (
          <div
            className="pointer-events-none absolute inset-0 z-0 opacity-[0.03]"
            style={{
              backgroundImage: `
                linear-gradient(to right, white 1px, transparent 1px),
                linear-gradient(to bottom, white 1px, transparent 1px)
              `,
              backgroundSize: `calc(100% / ${GRID_COLS}) ${H_UNIT}px`,
            }}
          />
        )}
        {renderCards.filter((c) => c.id).map((card) => {
          const isSpacer = card.id.startsWith('spacer-')
          const isDivider = card.id.startsWith('divider-')
          const isSpecial = isSpacer || isDivider
          const isMoving = movingId === card.id
          const isResizing = resizingId === card.id
          const frame = `relative transition-all duration-150 ${isMoving ? 'opacity-60 z-20 scale-[0.98]' : ''} ${isResizing ? 'ring-2 ring-cyan-500/30 rounded-xl z-10' : ''}`
          const chrome = (label: string, tone: 'card' | 'other', showName = true) => (
            <EditChrome
              label={label}
              showName={showName}
              tone={tone}
              w={card.w}
              h={card.h}
              active={isResizing || isMoving}
              onRemove={() => onToggleCard(card.id)}
              onMoveDown={(e) => handleMoveDown(e, card.id, card.x, card.y)}
              onResizeDown={(e) => handleResizeDown(e, card.id, card.w, card.h)}
            />
          )

          // ── Special cards (spacer/divider) ──
          if (isSpecial) {
            return (
              <div key={card.id} className={frame} style={placeCard(card)}>
                {editMode && chrome(isDivider ? 'Divider' : 'Spacer', 'other')}
                {isDivider ? (
                  <div className="h-full flex items-center gap-3 px-4">
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                    {editMode ? (
                      <input type="text" value={labels[card.id] || ''} onChange={(e) => onSetLabel(card.id, e.target.value)}
                        aria-label="Section title" placeholder="Section title" onClick={(e) => e.stopPropagation()}
                        className="bg-transparent border border-transparent rounded-md text-[11px] font-semibold uppercase tracking-widest text-slate-400 placeholder-slate-500 text-center outline-none focus:border-emerald-500/40 focus:ring-2 focus:ring-emerald-500/30 w-40 pointer-events-auto" />
                    ) : labels[card.id] ? (
                      <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-500">{labels[card.id]}</span>
                    ) : null}
                    <div className="flex-1 h-px bg-gradient-to-r from-transparent via-white/[0.08] to-transparent" />
                  </div>
                ) : editMode ? (
                  <div className="h-full border-2 border-dashed border-white/[0.06] rounded-xl flex items-center justify-center">
                    <span className="text-[10px] text-slate-600 uppercase tracking-wider">Spacer</span>
                  </div>
                ) : <div className="h-full" />}
              </div>
            )
          }

          // ── Plugin cards (sandboxed iframe via srcdoc) ──
          if (card.id.startsWith('plugin:')) {
            const parts = card.id.split(':')  // plugin:pluginName:cardName
            const pluginName = parts[1] || 'unknown'
            const cardName = parts[2] || 'default'
            const pluginMeta = pluginCards.find((p) => p.id === card.id)

            return (
              <div
                key={card.id}
                className={`${frame} ${editMode && !isMoving && !isResizing ? 'hover:ring-1 hover:ring-emerald-500/20 hover:rounded-xl' : ''}`}
                style={placeCard(card)}
              >
                {editMode && chrome(pluginMeta?.title || cardName, 'other')}
                <div className={`glass-card h-full overflow-hidden ${editMode ? 'pointer-events-none select-none border-dashed border-white/10' : ''}`}>
                  <PluginCardFrame pluginName={pluginName} cardName={cardName} title={pluginMeta?.title || cardName} refreshInterval={pluginMeta?.refreshInterval} />
                </div>
              </div>
            )
          }

          // ── Regular cards ──
          const entry = getCardEntry(card.id)
          if (!entry) return null
          const Comp = COMPONENT_MAP[card.id]
          if (!Comp) return null
          const props = cardProps[card.id] || {}

          return (
            <div
              key={card.id}
              className={`${frame} ${editMode && !isMoving && !isResizing ? 'hover:ring-1 hover:ring-emerald-500/20 hover:rounded-xl' : ''}`}
              style={placeCard(card)}
            >
              {editMode && chrome(entry.title, 'card', card.id === 'overview')}
              <div className={`dash-card-body h-full rounded-xl overflow-hidden [&>*]:h-full [&>*]:overflow-y-auto [&>*]:overflow-x-hidden [&>*]:scrollbar-none ${
                editMode ? 'pointer-events-none select-none border border-dashed border-white/10' : ''
              }`}>
                <Comp
                  {...props}
                  cardConfig={cardConfig[card.id]}
                  onSaveConfig={onSaveCardConfig ? (cfg: unknown) => onSaveCardConfig(card.id, cfg) : undefined}
                  dashboardEditMode={editMode}
                />
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Card picker ── */}
      {showPicker && editMode && createPortal(
        <ModalOverlay onClose={() => setShowPicker(false)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowPicker(false)}>
          <div className="glass rounded-2xl p-6 w-full max-w-md mx-4 animate-scale-in border border-white/10" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2"><Plus className="h-4 w-4 text-emerald-400" aria-hidden /><h3 className="text-sm font-semibold text-slate-200">Add cards</h3></div>
              <Hint label="Close"><CloseButton size="sm" onClick={() => setShowPicker(false)} /></Hint>
            </div>
            <div className="space-y-2 max-h-[60vh] overflow-y-auto scrollbar-thin">
              {hiddenCards.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-8">Every card is on the dashboard</p>
              ) : hiddenCards.filter((c) => c.id).map((card) => {
                const entry = getCardEntry(card.id)
                if (!entry) return null
                const Icon = CARD_ICONS[entry.iconName] || Box
                return (
                  <button key={card.id} type="button" onClick={() => { onToggleCard(card.id); if (hiddenCards.length <= 1) setShowPicker(false) }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/5 hover:border-emerald-500/20 transition-all text-left">
                    <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0"><Icon className="h-4 w-4 text-slate-300" aria-hidden /></div>
                    <div className="flex-1 min-w-0"><p className="text-xs font-medium text-slate-200">{entry.title}</p><p className="text-[11px] text-slate-500 truncate">{entry.description}</p></div>
                    <Plus size={14} className="text-emerald-400 shrink-0" aria-hidden />
                  </button>
                )
              })}

              {/* Plugin cards section — always show */}
              <div className="flex items-center gap-2 mt-4 mb-2">
                <div className="flex-1 h-px bg-white/[0.06]" />
                <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Plugin cards</span>
                <div className="flex-1 h-px bg-white/[0.06]" />
              </div>
              {(() => {
                const availablePluginCards = pluginCards.filter((pc) => !visibleCards.some((vc) => vc.id === pc.id))
                if (availablePluginCards.length === 0) {
                  return (
                    <p className="text-[11px] text-slate-500 text-center py-4">
                      {pluginCards.length === 0
                        ? `No plugin cards yet. Build one in Card Studio on the ${pageLabel('plugins')} page.`
                        : 'Every plugin card is on the dashboard.'}
                    </p>
                  )
                }
                return availablePluginCards.map((pc) => (
                    <button
                      key={pc.id}
                      type="button"
                      onClick={() => {
                        onAddPluginCard(pc.id, Number.isFinite(pc.defaultW) ? pc.defaultW : 8, Number.isFinite(pc.defaultH) ? pc.defaultH : 5)
                        setShowPicker(false)
                      }}
                      className="w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/5 hover:border-emerald-500/20 transition-all text-left"
                    >
                      <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                        <Puzzle className="h-4 w-4 text-slate-300" aria-hidden />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="text-xs font-medium text-slate-200">{pc.title}</p>
                          <Pill tone="neutral">Plugin</Pill>
                        </div>
                        <p className="text-[11px] text-slate-500 truncate">{pc.description}</p>
                      </div>
                      <Plus size={14} className="text-emerald-400 shrink-0" aria-hidden />
                    </button>
                  ))
              })()}
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  )
}
