import { create } from 'zustand'
import { ContainerInfo, ContainerStats } from '../../shared/types'
import { refreshPoll } from '../lib/poll'
import { pollKeys } from '../api/pollKeys'
import { onServerReset } from '../lib/serverScope'

export interface StatsHistoryEntry {
  time: number
  cpu: number
  mem: number
}

interface ContainerState {
  containers: ContainerInfo[]
  stats: Record<string, ContainerStats>
  statsHistory: Record<string, StatsHistoryEntry[]>
  favorites: string[]
  loading: boolean
  /** Fetch the list now: the global poller's request (GlobalPoller fills the store with its answer) */
  refresh: () => Promise<void>
  setContainers: (containers: ContainerInfo[]) => void
  setStats: (name: string, stats: ContainerStats) => void
  pushStatsHistory: (name: string, cpu: number, mem: number) => void
  setLoading: (loading: boolean) => void
  toggleFavorite: (name: string) => void
}

const MAX_HISTORY_ENTRIES = 60

// Stable empty array to avoid new reference on every selector call
const EMPTY_HISTORY: StatsHistoryEntry[] = []

// Load persisted favorites from localStorage
function loadFavorites(): string[] {
  try {
    const raw = localStorage.getItem('container-favorites')
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export const useContainerStore = create<ContainerState>((set) => ({
  containers: [],
  stats: {},
  statsHistory: {},
  favorites: loadFavorites(),
  // True until the first list arrives, so an empty list is never shown as "no containers"
  loading: true,

  refresh: async () => {
    refreshPoll(pollKeys.containers())
  },
  setContainers: (containers) => set({ containers, loading: false }),
  setStats: (name, stats) =>
    set((state) => ({
      stats: { ...state.stats, [name]: stats },
    })),
  pushStatsHistory: (name, cpu, mem) =>
    set((state) => {
      const existing = state.statsHistory[name] ?? []
      const entry: StatsHistoryEntry = { time: Date.now(), cpu, mem }
      const updated = [...existing, entry].slice(-MAX_HISTORY_ENTRIES)
      return {
        statsHistory: { ...state.statsHistory, [name]: updated },
      }
    }),
  setLoading: (loading) => set({ loading }),
  toggleFavorite: (name) =>
    set((state) => {
      const isFav = state.favorites.includes(name)
      const next = isFav
        ? state.favorites.filter((f) => f !== name)
        : [...state.favorites, name]
      try { localStorage.setItem('container-favorites', JSON.stringify(next)) } catch {}
      return { favorites: next }
    }),
}))

/**
 * Stable selector for stats history — avoids creating a new empty array
 * reference on every render when no history exists for a container.
 */
export function selectStatsHistory(name: string) {
  return (s: ContainerState) => s.statsHistory[name] ?? EMPTY_HISTORY
}

// what the server said goes with it; the favourites are this device's
onServerReset(() => useContainerStore.setState({ containers: [], stats: {}, statsHistory: {}, loading: true }))
