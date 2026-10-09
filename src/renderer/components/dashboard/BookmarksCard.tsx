// =============================================================================
// BookmarksCard — the Bookmarks page's saved items as tiles
// =============================================================================

import React, { useEffect, useState } from 'react'
import * as Icons from 'lucide-react'
import { Bookmark, ExternalLink } from 'lucide-react'
import { useSettingsStore } from '../../stores/settingsStore'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_CARD, TONE_OK } from '../../lib/ui'
import type { PageId } from '../../../shared/types'
import { Card, CardBody, ACCENTS } from './cardShared'
import { EmptyState } from '../common/PageState'
interface BookmarkItem {
  id: string
  type: 'page' | 'stack' | 'container' | 'custom'
  label: string
  target: string
  color: string
  icon: string
  notes?: string
}

function load(): BookmarkItem[] {
  try {
    const raw = localStorage.getItem('user-bookmarks')
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((b) => b && typeof b.label === 'string') : []
  } catch { return [] }
}

/** The Bookmarks page stores the colour's name ("emerald"); a bookmark saved by an older build holds a class name ("text-emerald-400") */
function accentOf(color: string): typeof ACCENTS[string] {
  if (ACCENTS[color]) return ACCENTS[color]
  const m = /-(emerald|cyan|violet|amber|rose|blue|teal|orange|pink|slate)-/.exec(color || '')
  return ACCENTS[m?.[1] ?? 'cyan']
}

export default function BookmarksCard() {
  const [items, setItems] = useState<BookmarkItem[]>(load)
  const setCurrentPage = useSettingsStore((s) => s.setCurrentPage)
  useEffect(() => {
    const refresh = () => setItems(load())
    window.addEventListener('storage', refresh)
    window.addEventListener('bookmarks-changed', refresh)
    return () => { window.removeEventListener('storage', refresh); window.removeEventListener('bookmarks-changed', refresh) }
  }, [])

  const open = (b: BookmarkItem) => {
    if (b.type === 'page') setCurrentPage(b.target as PageId)
    else if (b.type === 'stack') setCurrentPage('stacks', { highlight: b.target })
    else if (b.type === 'container') setCurrentPage('containers', { focusContainer: b.target })
    else if (/^https?:\/\//i.test(b.target)) window.open(b.target, '_blank', 'noopener')
  }

  return (
    <Card card="bookmarks" meta={items.length || undefined} open="bookmarks" clickable={false}>
      {items.length === 0 ? (
        <EmptyState card
          icon={<Bookmark size={22} />}
          title="No bookmarks yet"
          hint={`Save pages, stacks, containers and links on the ${pageLabel('bookmarks')} page.`}
          action={<button type="button" onClick={() => setCurrentPage('bookmarks')} className={`${BTN_CARD} ${TONE_OK}`}>Open {pageLabel('bookmarks')}</button>}
        />
      ) : (
        <CardBody className="grid grid-cols-2 gap-1.5 content-start">
          {items.map((b) => {
            const acc = accentOf(b.color)
            const Icon = ((Icons as unknown as Record<string, React.ElementType>)[b.icon] ?? Bookmark) as React.ElementType
            return (
              <button key={b.id} type="button" onClick={() => open(b)} className={`group flex items-center gap-2 rounded-lg px-2.5 py-2 border ${acc.ring} bg-white/[0.02] hover:bg-white/[0.05] text-left transition-colors`} title={b.notes || b.target}>
                <span className={`flex items-center justify-center w-7 h-7 rounded-md shrink-0 ${acc.bg} ${acc.text}`}><Icon size={14} /></span>
                <span className="flex-1 min-w-0">
                  <span className="block text-xs font-medium text-slate-200 truncate">{b.label}</span>
                  <span className="block text-[10px] text-slate-500 truncate">{b.type === 'custom' ? b.target.replace(/^https?:\/\//, '') : b.type}</span>
                </span>
                {b.type === 'custom' && <ExternalLink size={11} className="text-slate-500 group-hover:text-cyan-400 shrink-0" aria-hidden />}
              </button>
            )
          })}
        </CardBody>
      )}
    </Card>
  )
}
