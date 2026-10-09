import { create } from 'zustand'
import { resetsWithServer } from '../lib/serverScope'
import type { Schedule, ScheduleExecution } from '../../shared/types'
import * as api from '../api/endpoints'

interface ScheduleState {
  schedules: Schedule[]
  history: Record<string, ScheduleExecution[]>
  loading: boolean
  saving: boolean
  error: string | null
  /** the fleet scope of the list on screen ('hub', 'all' or a member id): a re-fetch after a change keeps it */
  scope: string | null | undefined
  fetchSchedules: (scope?: string | null) => Promise<void>
  createSchedule: (data: { name: string; schedule: string; action: string; target?: string }, member?: string | null) => Promise<boolean>
  updateSchedule: (id: string, updates: Partial<Schedule>, member?: string | null) => Promise<boolean>
  deleteSchedule: (id: string, member?: string | null) => Promise<boolean>
  toggleSchedule: (id: string, member?: string | null) => Promise<boolean>
  runSchedule: (id: string, member?: string | null) => Promise<{ success: boolean; output: string } | null>
  fetchHistory: (id: string, member?: string | null) => Promise<void>
}

/** the row an action was for: its id on its own server (in the Everywhere list two servers can have the same id) */
const sameRow = (s: { id: string; member?: string | null }, id: string, member?: string | null) =>
  s.id === id && (s.member == null || member == null || s.member === member)

export const useScheduleStore = create<ScheduleState>((set, get) => ({
  schedules: [],
  history: {},
  loading: false,
  saving: false,
  error: null,
  scope: undefined,

  fetchSchedules: async (scope) => {
    set({ loading: true, error: null, scope })
    try {
      const res = await api.fetchSchedules(scope)
      set({ schedules: res.schedules, loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch schedules' })
    }
  },

  createSchedule: async (data, member) => {
    set({ saving: true, error: null })
    try {
      await api.createSchedule(data, member)
      set({ saving: false })
      // the scope of the list on screen: a scope-less fetch would replace a VM's list with the hub's
      get().fetchSchedules(get().scope)
      return true
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to create schedule' })
      return false
    }
  },

  updateSchedule: async (id, updates, member) => {
    set({ saving: true, error: null })
    try {
      await api.updateSchedule(id, updates, member)
      set({ saving: false })
      get().fetchSchedules(get().scope)
      return true
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to update schedule' })
      return false
    }
  },

  deleteSchedule: async (id, member) => {
    set({ saving: true, error: null })
    try {
      await api.deleteSchedule(id, member)
      set(prev => ({ schedules: prev.schedules.filter(s => !sameRow(s, id, member)), saving: false }))
      return true
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to delete schedule' })
      return false
    }
  },

  toggleSchedule: async (id, member) => {
    try {
      const res = await api.toggleSchedule(id, member)
      // The server answers {success, id, enabled}: merge the flag, keep the entry
      const enabled = (res as { enabled?: boolean }).enabled
      set(prev => ({ schedules: prev.schedules.map(s => sameRow(s, id, member) ? { ...s, enabled: enabled ?? !s.enabled } : s) }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : 'Failed to toggle schedule' })
      return false
    }
  },

  runSchedule: async (id, member) => {
    try {
      const result = await api.runSchedule(id, member)
      get().fetchSchedules(get().scope) // Refresh to update run_count and last_run
      get().fetchHistory(id, member) // Refresh history (on the member that ran it)
      return result
    } catch { return null }
  },

  // the runs live where the schedule does: a VM's are asked on that VM, not the hub
  fetchHistory: async (id, member) => {
    try {
      const res = await api.fetchScheduleHistory(id, member)
      set(prev => ({ history: { ...prev.history, [id]: res.history } }))
    } catch { /* ignore */ }
  },
}))

resetsWithServer(useScheduleStore)
