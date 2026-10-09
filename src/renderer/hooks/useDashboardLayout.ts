// =============================================================================
// useDashboardLayout — Layout state, persistence (server + localStorage), drag
// =============================================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DashboardCard, DashboardLayout } from '../../shared/types'
import { getDefaultLayout, GRID_COLS, clampCardSize, CARD_REGISTRY, getCardEntry } from '../components/dashboard/cardRegistry'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'

const STORAGE_KEY_PREFIX = 'dashboard-layout-'

/** One cache per server and user: the app can talk to several servers */
function getStorageKey(person?: string): string {
  const user = person || useAuthStore.getState().currentUser || 'default'
  const server = (useSettingsStore.getState().serverUrl || 'local').replace(/[^a-z0-9]/gi, '_')
  return `${STORAGE_KEY_PREFIX}${server}-${user}`
}

/** Cards added to the catalogue since a layout was saved appear hidden, ready to enable */
function mergeRegistry(layout: DashboardLayout): DashboardLayout {
  const known = new Set(layout.cards.map((c) => c.id))
  const missing = CARD_REGISTRY.filter((e) => !known.has(e.id))
  if (missing.length === 0) return layout
  const maxY = Math.max(0, ...layout.cards.filter((c) => c.visible).map((c) => c.y + c.h))
  return {
    ...layout,
    cards: [...layout.cards, ...missing.map((e) => ({ id: e.id, visible: false, x: 0, y: maxY, w: e.defaultW, h: e.defaultH }))],
  }
}

/**
 * First grid position where a w×h card fits without covering a visible card.
 * The preferred spot (where the card was before it was hidden) wins when it
 * is still free; otherwise the grid is scanned top-down, left-to-right.
 */
function findFreeSpot(cards: DashboardCard[], skipId: string, w: number, h: number, px?: number, py?: number): { x: number; y: number } {
  const visible = cards.filter((c) => c.visible && c.id !== skipId)
  const maxY = Math.max(0, ...visible.map((c) => c.y + c.h))
  const free = (x: number, y: number) => !visible.some((o) => x < o.x + o.w && x + w > o.x && y < o.y + o.h && y + h > o.y)
  if (px !== undefined && py !== undefined && px >= 0 && px + w <= GRID_COLS && free(px, py)) return { x: px, y: py }
  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x + w <= GRID_COLS; x++) {
      if (free(x, y)) return { x, y }
    }
  }
  return { x: 0, y: maxY }
}

function stamped(layout: DashboardLayout): DashboardLayout {
  return { ...layout, updated_at: Date.now() }
}

const CURRENT_VERSION = 9

/**
 * A card saved without a usable position or size (a plugin card added from a
 * manifest with no dimensions) would break the whole grid; give it a place
 * below everything else instead of trusting the saved numbers.
 */
function repairCards(layout: DashboardLayout): DashboardLayout {
  const usable = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0
  let maxY = 0
  for (const c of layout.cards) if (usable(c.y) && usable(c.h)) maxY = Math.max(maxY, c.y + c.h)
  let changed = false
  const cards = layout.cards.map((c) => {
    if (usable(c.x) && usable(c.y) && usable(c.w) && usable(c.h) && c.w > 0 && c.h > 0) return c
    changed = true
    const entry = getCardEntry(c.id)
    const w = entry?.defaultW ?? 8
    const h = entry?.defaultH ?? 5
    const fixed = { ...c, x: 0, y: maxY, w, h }
    maxY += h
    return fixed
  })
  // Visible cards covering each other (every card added by a newer build used
  // to be shown at the same spot) are spread into the first free gaps
  const placed: DashboardCard[] = []
  const spread = cards.map((c) => {
    if (!c.visible) return c
    const spot = findFreeSpot(placed, c.id, c.w, c.h, c.x, c.y)
    const fixed = spot.x === c.x && spot.y === c.y ? c : { ...c, ...spot }
    if (fixed !== c) changed = true
    placed.push(fixed)
    return fixed
  })
  return changed ? { ...layout, cards: spread } : layout
}

/** Read layout from localStorage (auto-migrates old versions) */
function loadFromCache(): DashboardLayout | null {
  try {
    const raw = localStorage.getItem(getStorageKey())
    if (!raw) return null
    const parsed = JSON.parse(raw) as DashboardLayout
    // Discard old versions or malformed layouts
    if (!parsed.version || parsed.version < CURRENT_VERSION) return null
    // Validate cards have x,y,w,h fields (v9+ uses free placement)
    if (parsed.cards?.length > 0 && typeof parsed.cards[0].x !== 'number') return null
    return repairCards(mergeRegistry(parsed))
  } catch {}
  return null
}

/**
 * At sign-in (lib/userSync): put the person's layout from the server into the cache the Dashboard starts from, so its
 * first paint is their layout and not the stock one. The newer copy wins, like the fetch on mount.
 */
export function primeDashboardLayout(person: string, serverLayout: DashboardLayout): void {
  if (!serverLayout || !serverLayout.version || serverLayout.version < CURRENT_VERSION || !Array.isArray(serverLayout.cards)) return
  try {
    const key = getStorageKey(person)
    const raw = localStorage.getItem(key)
    const local = raw ? (JSON.parse(raw) as DashboardLayout) : null
    if (local && (local.updated_at ?? 0) > (serverLayout.updated_at ?? 0)) return
    localStorage.setItem(key, JSON.stringify(repairCards(mergeRegistry(serverLayout))))
  } catch {}
}

/** Write layout to localStorage */
function saveToCache(layout: DashboardLayout): void {
  try {
    localStorage.setItem(getStorageKey(), JSON.stringify(layout))
  } catch {}
}

/** Save layout to the server. Resolves false when the server refused (the cache still holds it). */
async function saveToServer(layout: DashboardLayout): Promise<boolean> {
  try {
    const { saveDashboardLayout } = await import('../api/endpoints')
    await saveDashboardLayout(layout)
    return true
  } catch {
    return false
  }
}

/** Fetch layout from server */
async function fetchFromServer(): Promise<DashboardLayout | null> {
  try {
    const { fetchDashboardLayout } = await import('../api/endpoints')
    const res = await fetchDashboardLayout()
    return res.layout
  } catch {
    return null
  }
}

let nextSpecialId = Date.now()

export function useDashboardLayout() {
  const [layout, setLayout] = useState<DashboardLayout>(() => {
    return loadFromCache() || getDefaultLayout()
  })
  const [editMode, setEditMode] = useState(false)
  const [saving, setSaving] = useState(false)
  const [lastSaveOk, setLastSaveOk] = useState<boolean | null>(null)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const layoutRef = useRef(layout)
  const savedLayoutRef = useRef(layout)  // snapshot before edit mode
  layoutRef.current = layout

  // On mount: fetch from server in background. The newer copy wins (updated_at);
  // a save made while the request was in flight is never overwritten.
  const editModeRef = useRef(false)
  editModeRef.current = editMode
  const savedSinceMountRef = useRef(false)

  useEffect(() => {
    fetchFromServer().then((serverLayout) => {
      if (editModeRef.current || savedSinceMountRef.current) return
      if (!serverLayout || !serverLayout.version || serverLayout.version < CURRENT_VERSION) return
      const local = layoutRef.current
      const serverNewer = (serverLayout.updated_at ?? 0) >= (local.updated_at ?? 0)
      if (serverNewer) {
        const merged = repairCards(mergeRegistry(serverLayout))
        setLayout(merged)
        saveToCache(merged)
      } else {
        saveToServer(local)
      }
    })
  }, [])

  /** Get visible cards sorted by position (filter out malformed entries) */
  const visibleCards = layout.cards
    .filter((c) => c.id && c.visible)
    .sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)

  /** Get all cards sorted by position (filter out malformed entries) */
  const allCards = layout.cards.filter((c) => c.id).sort((a, b) => a.y !== b.y ? a.y - b.y : a.x - b.x)

  /** Save layout (to both localStorage and server). Resolves with the server result. */
  const persistLayout = useCallback(async (newLayout: DashboardLayout): Promise<boolean> => {
    const next = stamped(newLayout)
    savedSinceMountRef.current = true
    setLayout(next)
    saveToCache(next)
    setSaving(true)
    const ok = await saveToServer(next)
    setSaving(false)
    setLastSaveOk(ok)
    return ok
  }, [])

  /** Toggle card visibility (live edit, not persisted until Save) */
  const toggleCard = useCallback((id: string) => {
    setLayout((prev) => ({
      ...prev,
      cards: prev.cards.map((c) => {
        if (c.id !== id) return c
        if (c.visible) return { ...c, visible: false }
        // A card being shown lands in the first gap instead of on top of another card
        return { ...c, visible: true, ...findFreeSpot(prev.cards, id, c.w, c.h, c.x, c.y) }
      }),
    }))
  }, [])

  /** Check if placing a card at (x,y,w,h) would overlap any other visible card */
  const wouldOverlap = (cards: DashboardCard[], skipId: string, x: number, y: number, w: number, h: number): boolean => {
    for (const other of cards) {
      if (other.id === skipId || !other.visible) continue
      // Rectangle intersection check
      if (x < other.x + other.w && x + w > other.x &&
          y < other.y + other.h && y + h > other.y) {
        return true
      }
    }
    return false
  }

  /** Resize card — enforces per-card min/max, blocked if it would overlap */
  const resizeCard = useCallback((id: string, rawW: number, rawH: number) => {
    const { w, h } = clampCardSize(id, rawW, rawH)
    setLayout((prev) => {
      const card = prev.cards.find((c) => c.id === id)
      if (!card) return prev
      if (wouldOverlap(prev.cards, id, card.x, card.y, w, h)) return prev
      return { ...prev, cards: prev.cards.map((c) => c.id === id ? { ...c, w, h } : c) }
    })
  }, [])

  /** Move card — kept inside the grid, blocked if it would overlap another card */
  const moveCard = useCallback((id: string, x: number, y: number) => {
    setLayout((prev) => {
      const card = prev.cards.find((c) => c.id === id)
      if (!card) return prev
      const nx = Math.max(0, Math.min(GRID_COLS - card.w, x))
      const ny = Math.max(0, y)
      if (nx === card.x && ny === card.y) return prev
      if (wouldOverlap(prev.cards, id, nx, ny, card.w, card.h)) return prev
      return { ...prev, cards: prev.cards.map((c) => c.id === id ? { ...c, x: nx, y: ny } : c) }
    })
  }, [])

  /** Add spacer or divider at the bottom of the layout */
  const addSpecial = useCallback((type: 'spacer' | 'divider') => {
    setLayout((prev) => {
      const id = `${type}-${++nextSpecialId}`
      const visibleCards = prev.cards.filter((c) => c.visible)
      const maxY = Math.max(...visibleCards.map((c) => c.y + c.h), 0)
      const newCard: DashboardCard = {
        id,
        visible: true,
        x: 0,
        y: maxY,
        w: type === 'divider' ? GRID_COLS : 6,
        h: type === 'divider' ? 1 : 2,
      }
      return { ...prev, cards: [...prev.cards, newCard] }
    })
  }, [])

  /** Enter edit mode — snapshot current layout for discard */
  const enterEditMode = useCallback(() => {
    savedLayoutRef.current = layoutRef.current
    setEditMode(true)
  }, [])

  /** Save and exit edit mode — persist to cache + server; resolves with the server result */
  const exitEditMode = useCallback((): Promise<boolean> => {
    setEditMode(false)
    return persistLayout(layoutRef.current)
  }, [persistLayout])

  /** Discard changes — restore snapshot from before edit mode */
  const discardEdit = useCallback(() => {
    setEditMode(false)
    setLayout(savedLayoutRef.current)
  }, [])

  /** Reset to default layout (stays in edit mode so user can review) */
  const resetLayout = useCallback(() => {
    setLayout(getDefaultLayout())
  }, [])

  /** Add a plugin card to the layout at the bottom (re-adding a removed one just shows it again) */
  const addPluginCard = useCallback((id: string, rawW: number, rawH: number) => {
    const w = Number.isFinite(rawW) && rawW > 0 ? Math.min(GRID_COLS, Math.round(rawW)) : 8
    const h = Number.isFinite(rawH) && rawH > 0 ? Math.min(16, Math.round(rawH)) : 5
    setLayout((prev) => {
      const existing = prev.cards.find((c) => c.id === id)
      if (existing) {
        if (existing.visible) return prev
        return { ...prev, cards: prev.cards.map((c) => c.id === id ? { ...c, visible: true } : c) }
      }
      const visCards = prev.cards.filter((c) => c.visible)
      const maxY = Math.max(...visCards.map((c) => c.y + c.h), 0)
      const newCard: DashboardCard = { id, visible: true, x: 0, y: maxY, w, h }
      return { ...prev, cards: [...prev.cards, newCard] }
    })
  }, [])

  /**
   * Show a card at the very top, full width, and move every visible card down by its height:
   * the layout keeps its own shape, only one row taller. Saved at once (it is a choice, not an edit),
   * with `config` for that card in the same save.
   */
  const placeOnTop = useCallback((id: string, config?: unknown): Promise<boolean> => {
    const current = layoutRef.current
    const card = current.cards.find((c) => c.id === id)
    if (!card) return Promise.resolve(false)
    const h = card.h > 0 ? card.h : (getCardEntry(id)?.defaultH ?? 4)
    const cards = current.cards.map((c) => c.id === id
      ? { ...c, visible: true, x: 0, y: 0, w: GRID_COLS, h }
      : c.visible ? { ...c, y: c.y + h } : c)
    return persistLayout({ ...current, cards, ...(config === undefined ? {} : { config: { ...(current.config || {}), [id]: config } }) })
  }, [persistLayout])

  return {
    layout,
    visibleCards,
    placeOnTop,
    allCards,
    editMode,
    saving,
    lastSaveOk,
    dragIndex,
    setDragIndex,
    enterEditMode,
    exitEditMode,
    toggleCard,
    resizeCard,
    moveCard,
    resetLayout,
    addSpecial,
    addPluginCard,
    discardEdit,
    labels: layout.labels || {},
    cardConfig: layout.config || {},
    /** Save one card's settings right away (outside edit mode) */
    saveCardConfig: useCallback((id: string, cfg: unknown): Promise<boolean> => {
      const current = layoutRef.current
      return persistLayout({ ...current, config: { ...(current.config || {}), [id]: cfg } })
    }, [persistLayout]),
    setLabel: useCallback((id: string, title: string) => {
      setLayout((prev) => ({
        ...prev,
        labels: { ...(prev.labels || {}), [id]: title },
      }))
    }, []),
  }
}
