import { create } from 'zustand'
import { HealthReport } from '../../shared/types'
import { resetsWithServer } from '../lib/serverScope'

interface HealthState {
  report: HealthReport | null
  /** why the last poll failed; cleared by the next report */
  error: string | null
  setReport: (report: HealthReport | null) => void
  setError: (error: string | null) => void
}

export const useHealthStore = create<HealthState>((set) => ({
  report: null,
  error: null,

  setReport: (report) => set({ report, error: null }),
  setError: (error) => set({ error }),
}))

resetsWithServer(useHealthStore)
