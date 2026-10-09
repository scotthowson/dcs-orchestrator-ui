import { create } from 'zustand'
import { EventEntry } from '../../shared/types'
import { resetsWithServer } from '../lib/serverScope'

/** the server's Docker events: the dashboard's Recent events card reads what the dashboard and the Activity timeline poll */
interface LogState {
  events: EventEntry[]
  setEvents: (events: EventEntry[]) => void
}

export const useLogStore = create<LogState>((set) => ({
  events: [],
  setEvents: (events) => set({ events }),
}))

resetsWithServer(useLogStore)
