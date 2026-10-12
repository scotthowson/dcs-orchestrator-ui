// The kids' controls' words and sums, shared by the Kids tab's cards, the group editor, the device drawer and the tile.

import { Users, Baby, Smile, UserRound, Gamepad2, Tv, School, Moon, Star, Heart, Rocket, House, type LucideIcon } from 'lucide-react'
import type { TechnitiumCategory, TechnitiumGroup, TechnitiumGroupColor, TechnitiumGroupIcon, TechnitiumWindow, TechnitiumYoutube } from '../../../shared/types'

export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** "every day", "Mon–Fri", "weekends", or the days */
export function daysLabel(days: number[]): string {
  const d = [...days].sort().join()
  if (d === '1,2,3,4,5,6,7') return 'every day'
  if (d === '1,2,3,4,5') return 'Mon–Fri'
  if (d === '1,2,3,4,7') return 'Sun–Thu'
  if (d === '6,7') return 'weekends'
  return [...days].sort().map((x) => DAYS[x - 1]).join(', ')
}

/** how long a window lasts, "10 h" or "9 h 30" */
export function windowLength(from: string, to: string): string {
  const m = (t: string) => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm }
  const d = (m(to) - m(from) + 1440) % 1440
  return d === 0 ? '—' : `${Math.floor(d / 60)} h${d % 60 ? ` ${String(d % 60).padStart(2, '0')}` : ''}`
}

export const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** "Games and Video and streaming", "Games, Chat and Shopping" */
export function categoryNames(ids: string[], categories: TechnitiumCategory[]): string {
  const n = ids.map((id) => categories.find((c) => c.id === id)?.name ?? id)
  return n.length <= 1 ? (n[0] ?? '') : `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`
}

/** what a window blocks, in a few words */
export function windowBlocks(w: TechnitiumWindow, categories: TechnitiumCategory[]): string {
  return w.scope === 'all' ? 'every name' : categoryNames(w.categories, categories) || 'no category yet'
}

/** what a window blocks, YouTube included: "every name", "Games blocked, YouTube strict" */
export function windowEffect(w: TechnitiumWindow, categories: TechnitiumCategory[]): string {
  if (w.scope === 'all') return 'every name'
  const parts = [w.categories.length ? categoryNames(w.categories, categories) : '', w.youtube ? `YouTube ${YOUTUBE_LABEL[w.youtube].toLowerCase()}` : ''].filter(Boolean)
  return parts.join(', ') || 'no category yet'
}

/** when a window runs: "20:30–07:00, every day" or "on a week grid (14 h a week)" */
export function windowWhen(w: TechnitiumWindow): string {
  if (w.grid) { const h = w.grid.flat().filter(Boolean).length; return `on a week grid (${h} h a week)` }
  return `${w.from}–${w.to}, ${w.days.length ? daysLabel(w.days) : 'no day picked'}`
}

/** the pills of what is in force now: "Bedtime until 07:00", "Games blocked until 18:00" */
export function activeLabels(g: Pick<TechnitiumGroup, 'windows' | 'active'>, categories: TechnitiumCategory[]): { key: string; text: string; all: boolean }[] {
  return g.windows.filter((w) => w.active && w.id).map((w) => {
    const until = g.active?.ends?.[w.id!] ?? w.to
    const what = [w.categories.length ? `${categoryNames(w.categories, categories)} blocked` : '', w.youtube ? `YouTube ${YOUTUBE_LABEL[w.youtube].toLowerCase()}` : ''].filter(Boolean).join(', ')
    return { key: w.id!, all: w.scope === 'all', text: w.scope === 'all' ? `${w.name} until ${until}` : `${what || w.name} until ${until}` }
  })
}

// ---- YouTube ----
export const YOUTUBE_LABEL: Record<TechnitiumYoutube, string> = { off: 'Off', moderate: 'Moderate', strict: 'Strict', kids_only: 'Kids only', blocked: 'Blocked' }
export const YOUTUBE_HELP: Record<TechnitiumYoutube, string> = {
  off: 'YouTube as it is.',
  moderate: 'Restricted mode, moderate: most mature videos hidden.',
  strict: 'Restricted mode, strict: more hidden, and the comments.',
  kids_only: 'YouTube blocked; YouTube Kids (the app and youtubekids.com) keeps working.',
  blocked: 'Every YouTube name, YouTube Kids too.',
}
/** what a DNS filter cannot do: said wherever YouTube is set */
export const YOUTUBE_CEILING = 'A DNS filter decides per name, not per video: it cannot hide Shorts, a channel, the comments or the ads.'
export const YOUTUBE_MODES: TechnitiumYoutube[] = ['off', 'moderate', 'strict', 'kids_only', 'blocked']

// ---- a group's colour and icon ----
export const GROUP_COLORS: TechnitiumGroupColor[] = ['blue', 'green', 'orange', 'purple', 'pink', 'teal', 'red', 'yellow', 'gray']
/** the icon's tint and its tile */
export const GROUP_TEXT: Record<TechnitiumGroupColor, string> = {
  blue: 'text-blue-300', green: 'text-green-300', orange: 'text-orange-300', purple: 'text-purple-300', pink: 'text-pink-300',
  teal: 'text-teal-300', red: 'text-red-300', yellow: 'text-yellow-300', gray: 'text-slate-300',
}
export const GROUP_TILE: Record<TechnitiumGroupColor, string> = {
  blue: 'bg-blue-500/15', green: 'bg-green-500/15', orange: 'bg-orange-500/15', purple: 'bg-purple-500/15', pink: 'bg-pink-500/15',
  teal: 'bg-teal-500/15', red: 'bg-red-500/15', yellow: 'bg-yellow-500/15', gray: 'bg-white/5',
}
export const GROUP_SWATCH: Record<TechnitiumGroupColor, string> = {
  blue: 'bg-blue-400', green: 'bg-green-400', orange: 'bg-orange-400', purple: 'bg-purple-400', pink: 'bg-pink-400',
  teal: 'bg-teal-400', red: 'bg-red-400', yellow: 'bg-yellow-400', gray: 'bg-slate-400',
}
export const GROUP_ICONS: Record<TechnitiumGroupIcon, { icon: LucideIcon; label: string }> = {
  users: { icon: Users, label: 'People' }, baby: { icon: Baby, label: 'Little one' }, child: { icon: Smile, label: 'Child' },
  teen: { icon: UserRound, label: 'Teen' }, gamepad: { icon: Gamepad2, label: 'Controller' }, tv: { icon: Tv, label: 'TV' },
  school: { icon: School, label: 'School' }, moon: { icon: Moon, label: 'Night' }, star: { icon: Star, label: 'Star' },
  heart: { icon: Heart, label: 'Heart' }, rocket: { icon: Rocket, label: 'Rocket' }, house: { icon: House, label: 'House' },
}

// ---- the week grid: 7 days from Monday × 24 hours ----
export const emptyGrid = (): boolean[][] => Array.from({ length: 7 }, () => Array<boolean>(24).fill(false))
/** a from/to/days window as a grid (whole hours: a window from 20:30 starts at 20:00) */
export function gridFrom(w: TechnitiumWindow): boolean[][] {
  const g = emptyGrid()
  const f = Number(w.from.slice(0, 2)), t = Number(w.to.slice(0, 2)) + (w.to.slice(3) !== '00' ? 1 : 0)
  for (const d of w.days) {
    for (let h = 0; h < 24; h++) {
      const on = f < t ? h >= f && h < t : f > t ? h >= f : false
      if (on) g[d - 1][h] = true
      // a window that runs into the next morning
      if (f > t && h < t) g[d % 7][h] = true
    }
  }
  return g
}

export const NEW_WINDOW: TechnitiumWindow = { name: 'Bedtime', enabled: true, from: '21:00', to: '07:00', days: [1, 2, 3, 4, 5, 6, 7], scope: 'all', categories: [] }
