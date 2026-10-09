// =============================================================================
// Bookmarks — pin pages, stacks and containers for quick access. They are kept
// in this browser (localStorage); the page names come from the page registry.
// =============================================================================

import React, { useState, useCallback, useId } from 'react'
import { Badge, SegmentedControl } from '@mantine/core'
import {
  Bookmark, Plus, Trash2, Star, Layers,
  Box, HardDrive, Network, HeartPulse, Monitor, Settings2,
  ScrollText, Cog, LayoutDashboard,
  Tag, Clock, Search, X, FolderHeart,
} from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import { pageLabel } from '../constants/pageTitles'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { EmptyState } from '../components/common/PageState'
import { useConfirm } from '../components/common/ConfirmDialog'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_ICON_SM, TONE_OK, TONE_QUIET, TONE_GHOST, FOCUS_RING } from '../lib/ui'
import { CARD, CARD_HOVER, REVEAL } from '../lib/pageKit'
import type { PageId } from '../../shared/types'

import { SEARCH_FIELD, INPUT } from '../lib/fieldStyles'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface BookmarkItem {
  id: string
  type: 'page' | 'stack' | 'container' | 'custom'
  label: string
  target: string       // PageId or stack/container name
  color: string        // accent color class
  icon: string         // icon name
  notes?: string
  createdAt: number
  pinned?: boolean
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

function loadBookmarks(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem('user-bookmarks')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

function saveBookmarks(items: BookmarkItem[]) {
  localStorage.setItem('user-bookmarks', JSON.stringify(items))
  window.dispatchEvent(new Event('bookmarks-changed'))
}

// ---------------------------------------------------------------------------
// Icon mapping
// ---------------------------------------------------------------------------

const iconMap: Record<string, React.ElementType> = {
  dashboard: LayoutDashboard,
  stacks: Layers,
  containers: Box,
  images: HardDrive,
  health: HeartPulse,
  networks: Network,
  logs: ScrollText,
  system: Monitor,
  config: Settings2,
  settings: Cog,
  bookmark: Bookmark,
  star: Star,
  tag: Tag,
}

// the colours a bookmark can wear: a choice the person makes (so all of them, amber included), the card's classes
// written out in full for the theme engine and the swatch's own colour for the picker
const colorOptions = [
  { label: 'Emerald', value: 'emerald', hex: '#10b981', class: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/25' },
  { label: 'Cyan', value: 'cyan', hex: '#06b6d4', class: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/25' },
  { label: 'Amber', value: 'amber', hex: '#f59e0b', class: 'bg-amber-500/15 text-amber-400 border-amber-500/25' },
  { label: 'Rose', value: 'rose', hex: '#f43f5e', class: 'bg-rose-500/15 text-rose-400 border-rose-500/25' },
  { label: 'Violet', value: 'violet', hex: '#8b5cf6', class: 'bg-violet-500/15 text-violet-400 border-violet-500/25' },
  { label: 'Blue', value: 'blue', hex: '#3b82f6', class: 'bg-blue-500/15 text-blue-400 border-blue-500/25' },
  { label: 'Pink', value: 'pink', hex: '#ec4899', class: 'bg-pink-500/15 text-pink-400 border-pink-500/25' },
  { label: 'Orange', value: 'orange', hex: '#f97316', class: 'bg-orange-500/15 text-orange-400 border-orange-500/25' },
]

function getColorClass(color: string): string {
  return colorOptions.find((c) => c.value === color)?.class ?? colorOptions[0].class
}

const pageTargets: { id: PageId; label: string }[] = (['dashboard', 'stacks', 'containers', 'images', 'health', 'networks', 'logs', 'system', 'config', 'settings'] as const)
  .map((id) => ({ id, label: pageLabel(id) }))

// ---------------------------------------------------------------------------
// Add Bookmark Form
// ---------------------------------------------------------------------------

const TYPE_LABEL: Record<BookmarkItem['type'], string> = { page: 'Page', stack: 'Stack', container: 'Container', custom: 'Custom' }

function AddBookmarkForm({ onAdd, onCancel }: {
  onAdd: (item: Omit<BookmarkItem, 'id' | 'createdAt'>) => void
  onCancel: () => void
}) {
  const [type, setType] = useState<BookmarkItem['type']>('page')
  const [label, setLabel] = useState('')
  const [target, setTarget] = useState('dashboard')
  const [color, setColor] = useState('emerald')
  const [notes, setNotes] = useState('')
  const uid = useId()

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!label.trim()) return
    onAdd({
      type,
      label: label.trim(),
      target,
      color,
      icon: type === 'page' ? target : 'bookmark',
      notes: notes.trim() || undefined,
    })
  }

  const labelCls = 'block text-[11px] text-slate-400 uppercase tracking-wider mb-1.5 font-semibold'

  return (
    <form onSubmit={handleSubmit} className={`${CARD} p-4 sm:p-5 border-t-2 !border-t-emerald-500 animate-fade-in`} aria-labelledby={`${uid}-title`}>
      <h2 id={`${uid}-title`} className="text-sm font-semibold text-slate-200 mb-4 flex items-center gap-2">
        <Plus size={14} className="text-emerald-400" aria-hidden />
        Add bookmark
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Type */}
        <div>
          <span id={`${uid}-type`} className={labelCls}>Type</span>
          <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none">
            <SegmentedControl
              aria-labelledby={`${uid}-type`}
              value={type}
              onChange={(v) => setType(v as BookmarkItem['type'])}
              data={(['page', 'stack', 'container', 'custom'] as const).map((t) => ({ value: t, label: TYPE_LABEL[t] }))}
            />
          </div>
        </div>

        {/* Color */}
        <div>
          <span id={`${uid}-color`} className={labelCls}>Color</span>
          <div role="radiogroup" aria-labelledby={`${uid}-color`} className="flex gap-1.5 flex-wrap">
            {colorOptions.map((c) => {
              const chosen = color === c.value
              return (
                <Hint key={c.value} label={c.label}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={chosen}
                    aria-label={c.label}
                    onClick={() => setColor(c.value)}
                    className={`w-8 h-8 sm:w-7 sm:h-7 rounded-md border-2 transition-shadow ${FOCUS_RING}`}
                    style={{
                      backgroundColor: `color-mix(in srgb, ${c.hex} 22%, transparent)`,
                      borderColor: chosen ? c.hex : 'transparent',
                      boxShadow: chosen ? `0 0 0 2px color-mix(in srgb, ${c.hex} 25%, transparent)` : undefined,
                    }}
                  />
                </Hint>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        {/* Label */}
        <div>
          <label htmlFor={`${uid}-label`} className={labelCls}>Label</label>
          <input
            id={`${uid}-label`}
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="My bookmark"
            autoFocus
            className={INPUT}
          />
        </div>

        {/* Target */}
        <div>
          <label htmlFor={`${uid}-target`} className={labelCls}>
            {type === 'page' ? 'Page' : type === 'stack' ? 'Stack name' : type === 'container' ? 'Container name' : 'Reference'}
          </label>
          {type === 'page' ? (
            <select
              id={`${uid}-target`}
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              className={INPUT}
            >
              {pageTargets.map((p) => (
                <option key={p.id} value={p.id}>{p.label}</option>
              ))}
            </select>
          ) : (
            <input
              id={`${uid}-target`}
              type="text"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder={type === 'stack' ? 'core-infrastructure' : type === 'container' ? 'nginx-proxy' : 'anything…'}
              className={INPUT}
            />
          )}
        </div>
      </div>

      {/* Notes */}
      <div className="mb-4">
        <label htmlFor={`${uid}-notes`} className={labelCls}>Notes (optional)</label>
        <input
          id={`${uid}-notes`}
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Quick notes about this bookmark…"
          className={INPUT}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={!label.trim()}
          className={`${BTN_TOOLBAR} ${TONE_OK} ${FOCUS_RING}`}
        >
          <Bookmark size={14} />
          Add bookmark
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={`${BTN_TOOLBAR} ${TONE_QUIET} ${FOCUS_RING}`}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

// ---------------------------------------------------------------------------
// Bookmark Card
// ---------------------------------------------------------------------------

function BookmarkCard({ item, onDelete, onTogglePin, onNavigate }: {
  item: BookmarkItem
  onDelete: (item: BookmarkItem) => void
  onTogglePin: (id: string) => void
  onNavigate: (item: BookmarkItem) => void
}) {
  const Icon = iconMap[item.icon] || Bookmark
  const colorClass = getColorClass(item.color)
  const timeAgo = getTimeAgo(item.createdAt)

  return (
    <div className={`group relative ${CARD_HOVER} p-4 cursor-pointer animate-fade-in`} onClick={() => onNavigate(item)}>
      <div className="flex items-start gap-3">
        {/* Icon */}
        <div className={`rounded-lg p-2.5 ${colorClass} border shrink-0`} aria-hidden>
          <Icon size={18} />
        </div>

        {/* Content: the name is the card's button (the whole card is its target), so a keyboard can open it */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-slate-200 truncate group-hover:text-white transition-colors min-w-0">
              <button
                type="button"
                className={`text-left max-w-full truncate rounded after:absolute after:inset-0 after:rounded-xl ${FOCUS_RING}`}
              >
                {item.label}
              </button>
            </h3>
            {item.pinned && <Star size={11} className="text-amber-400 fill-amber-400 shrink-0" aria-hidden />}
            <Badge color="slate">{item.type}</Badge>
          </div>
          <p className="text-xs text-slate-500 font-mono truncate mt-0.5">{item.target}</p>
          {item.notes && (
            <p className="text-[11px] text-slate-400 mt-1 line-clamp-1">{item.notes}</p>
          )}
          <p className="text-[11px] text-slate-500 mt-1.5 flex items-center gap-1">
            <Clock size={10} aria-hidden />
            {timeAgo}
          </p>
        </div>

        {/* Actions: above the card's own button; there when the card is pointed at or has the keyboard, always on a device without hover */}
        <div className="relative z-10 flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
          <Hint label={item.pinned ? 'Unpin' : 'Pin'}>
            <button
              type="button"
              onClick={() => onTogglePin(item.id)}
              aria-pressed={!!item.pinned}
              aria-label={`${item.pinned ? 'Unpin' : 'Pin'} ${item.label}`}
              className={`${BTN_ICON_SM} ${REVEAL} ${FOCUS_RING} ${item.pinned ? 'text-amber-400 hover:text-amber-300' : 'text-slate-500 hover:text-amber-400'} hover:bg-white/5`}
            >
              <Star size={13} className={item.pinned ? 'fill-current' : ''} />
            </button>
          </Hint>
          <Hint label="Delete">
            <button
              type="button"
              onClick={() => onDelete(item)}
              aria-label={`Delete ${item.label}`}
              className={`${BTN_ICON_SM} ${REVEAL} ${FOCUS_RING} text-slate-500 hover:text-rose-400 hover:bg-rose-500/10`}
            >
              <Trash2 size={13} />
            </button>
          </Hint>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimeAgo(ts: number): string {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  return new Date(ts).toLocaleDateString()
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function Bookmarks() {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>(loadBookmarks)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'pinned' | 'page' | 'stack' | 'container' | 'custom'>('all')
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  const confirm = useConfirm()

  const handleAdd = useCallback((item: Omit<BookmarkItem, 'id' | 'createdAt'>) => {
    const newItem: BookmarkItem = {
      ...item,
      id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: Date.now(),
    }
    const updated = [newItem, ...bookmarks]
    setBookmarks(updated)
    saveBookmarks(updated)
    setShowForm(false)
  }, [bookmarks])

  const handleDelete = useCallback(async (item: BookmarkItem) => {
    const ok = await confirm({
      title: 'Delete bookmark',
      message: `Delete the bookmark "${item.label}"? It is only removed from this browser.`,
      confirmLabel: 'Delete bookmark',
      danger: true,
    })
    if (!ok) return
    const updated = bookmarks.filter((b) => b.id !== item.id)
    setBookmarks(updated)
    saveBookmarks(updated)
  }, [bookmarks, confirm])

  const handleTogglePin = useCallback((id: string) => {
    const updated = bookmarks.map((b) =>
      b.id === id ? { ...b, pinned: !b.pinned } : b
    )
    setBookmarks(updated)
    saveBookmarks(updated)
  }, [bookmarks])

  const handleNavigate = useCallback((item: BookmarkItem) => {
    if (item.type === 'page') {
      setCurrentPage(item.target as PageId)
    } else if (item.type === 'stack') {
      setCurrentPage('stacks')
    } else if (item.type === 'container') {
      setCurrentPage('containers')
    }
  }, [setCurrentPage])

  // Filter and search
  let filtered = [...bookmarks]
  if (filter === 'pinned') filtered = filtered.filter((b) => b.pinned)
  else if (filter !== 'all') filtered = filtered.filter((b) => b.type === filter)
  if (search) {
    const q = search.toLowerCase()
    filtered = filtered.filter(
      (b) => b.label.toLowerCase().includes(q) || b.target.toLowerCase().includes(q) || b.notes?.toLowerCase().includes(q)
    )
  }

  // Sort: pinned first, then by creation date
  filtered.sort((a, b) => {
    if (a.pinned && !b.pinned) return -1
    if (!a.pinned && b.pinned) return 1
    return b.createdAt - a.createdAt
  })

  const stats = {
    total: bookmarks.length,
    pinned: bookmarks.filter((b) => b.pinned).length,
    pages: bookmarks.filter((b) => b.type === 'page').length,
    stacks: bookmarks.filter((b) => b.type === 'stack').length,
  }

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="bookmarks"
        actions={
          <button
            type="button"
            onClick={() => setShowForm(!showForm)}
            aria-expanded={showForm}
            className={`${BTN_TOOLBAR} ${FOCUS_RING} ${showForm ? TONE_QUIET : TONE_OK}`}
          >
            {showForm ? <X size={14} /> : <Plus size={14} />}
            {showForm ? 'Cancel' : 'Add bookmark'}
          </button>
        }
      />

      {/* Stats bar */}
      <div className="flex items-center gap-3 animate-fade-in">
        <div className={`${CARD} flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5`}>
          <span className="text-xs text-slate-500">
            <span className="text-slate-200 font-semibold">{stats.total}</span> bookmark{stats.total === 1 ? '' : 's'}
          </span>
          <span className="w-px h-4 bg-white/[0.06]" aria-hidden />
          <span className="text-xs text-slate-500">
            <span className="text-amber-400 font-semibold">{stats.pinned}</span> pinned
          </span>
          <span className="w-px h-4 bg-white/[0.06]" aria-hidden />
          <span className="text-xs text-slate-500">
            <span className="text-cyan-400 font-semibold">{stats.pages}</span> page{stats.pages === 1 ? '' : 's'}
          </span>
          <span className="w-px h-4 bg-white/[0.06]" aria-hidden />
          <span className="text-xs text-slate-500">
            <span className="text-cyan-400 font-semibold">{stats.stacks}</span> stack{stats.stacks === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Add form */}
      {showForm && <AddBookmarkForm onAdd={handleAdd} onCancel={() => setShowForm(false)} />}

      {/* Search & Filter */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[12rem] max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search bookmarks"
            placeholder="Search bookmarks…"
            className={SEARCH_FIELD}
          />
          {search && (
            <Hint label="Clear the search">
              <button
                type="button"
                aria-label="Clear the search"
                onClick={() => setSearch('')}
                className={`${BTN_ICON_SM} ${TONE_GHOST} ${FOCUS_RING} absolute right-1.5 top-1/2 -translate-y-1/2`}
              >
                <X size={14} />
              </button>
            </Hint>
          )}
        </div>
        <div className="min-w-0 max-w-full overflow-x-auto scrollbar-none">
          <SegmentedControl
            aria-label="Show"
            value={filter}
            onChange={(v) => setFilter(v as typeof filter)}
            data={[
              { value: 'all', label: 'All' },
              { value: 'pinned', label: 'Pinned' },
              { value: 'page', label: 'Page' },
              { value: 'stack', label: 'Stack' },
              { value: 'container', label: 'Container' },
              { value: 'custom', label: 'Custom' },
            ]}
          />
        </div>
      </div>

      {/* Bookmark grid */}
      {filtered.length === 0 ? (
        bookmarks.length === 0 ? (
          <EmptyState
            icon={<FolderHeart size={40} />}
            title="No bookmarks yet"
            hint="Add your first bookmark to quickly reach your favorite pages, stacks and containers."
            action={
              <button type="button" onClick={() => setShowForm(true)} className={`${BTN_TOOLBAR} ${TONE_OK} ${FOCUS_RING}`}>
                <Plus size={14} />
                Add your first bookmark
              </button>
            }
          />
        ) : (
          <EmptyState
            icon={<FolderHeart size={40} />}
            title="No matches"
            hint="Try another search or filter."
            action={
              <button type="button" onClick={() => { setSearch(''); setFilter('all') }} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
                <X size={14} />
                Show all bookmarks
              </button>
            }
          />
        )
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 stagger-children">
          {filtered.map((item) => (
            <BookmarkCard
              key={item.id}
              item={item}
              onDelete={handleDelete}
              onTogglePin={handleTogglePin}
              onNavigate={handleNavigate}
            />
          ))}
        </div>
      )}
    </div>
  )
}
