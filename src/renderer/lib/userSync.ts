// =============================================================================
// userSync — what belongs to the PERSON follows the person. The server keeps a
// document per user (GET/POST /settings/profile); until 4.0.1 the dashboard read
// it only when the Settings page was opened, so a client that had never seen the
// person (a phone that just installed the app, a new browser) came up in the
// stock look with no icon and no accent until someone went looking. Now every
// sign-in reads it first:
//
//   the profile     name, icon, status, accent colour, background image
//   the choices     dark / light / follow the device, the personal theme, reduced
//                   motion, 24-hour clock, the page after sign-in, custom CSS —
//                   kept in the same document under `prefs`
//   the themes      the ones the server holds and the one it set for everyone
//   the layout      the dashboard's cards, into the cache the Dashboard starts from
//
// and a choice made on this device is written back a moment later, so the next
// device gets it too. hydrateUser() is called by the sign-in page (awaited, with a
// short limit, so the first page is already dressed) and by the app shell (any
// other way of arriving: a restored session, a server switch); it runs once per
// person, server and token.
// =============================================================================

import { useAuthStore } from '../stores/authStore'
import { useSettingsStore, DEFAULT_SETTINGS, type PersistedSettings } from '../stores/settingsStore'
import { useThemeStore, resolveTheme } from '../stores/themeStore'
import { fetchProfile, saveProfileToServer, fetchDashboardLayout } from '../api/endpoints'
import { apiClient } from '../api/client'
import { pageMeta } from '../constants/pageTitles'
import type { PageId } from '../../shared/types'

/** the fields of the profile the Settings page edits */
export const PROFILE_KEYS = ['displayName', 'email', 'icon', 'bio', 'statusEmoji', 'statusText', 'timezone', 'accentColor', 'backgroundImage'] as const
export type ProfileKey = (typeof PROFILE_KEYS)[number]

/** the settings that describe how this PERSON wants the dashboard to look and behave (not the device: polling, sidebar, server address, disk labels stay local) */
export const SYNCED_PREFS = ['theme', 'themeName', 'reduceMotion', 'use24hClock', 'defaultPage', 'customCSS'] as const
type PrefKey = (typeof SYNCED_PREFS)[number]
export type Prefs = Pick<PersistedSettings, PrefKey>

/** A person is a username ON a server: the same name on two servers is two people, and what one of them keeps on this
 *  device (the profile, when the choices were made, whose choices the settings hold) never goes to the other server. */
const identity = (user: string, server = apiClient.getBaseUrl()) => `${user}@${server}`
/** this device's copy of the person's profile on the server in use */
export const profileStorageKey = (user: string, server?: string) => `user-profile-${identity(user, server)}`
const prefsAtKey = (user: string, server?: string) => `dcs-prefs-at-${identity(user, server)}`
/** whose choices this device's settings currently hold, as user@server (settings are per device, the choices per person) */
const OWNER_KEY = 'dcs-prefs-owner'
const PUSH_DELAY_MS = 1200

function readObject(key: string): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(key)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function storeItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // storage full or unavailable: the next sign-in reads the server again
  }
}

/** Builds before 4.0.37 kept these under the username alone: they move once to the server in use (the server the
 *  device was used with), and are never read again for another server. */
function migrateLegacyKeys(server: string): void {
  try {
    let moved = false
    for (const k of Object.keys(localStorage)) {
      if (!/^(user-profile|dcs-prefs-at)-./.test(k) || k.includes('://')) continue
      const value = localStorage.getItem(k)
      const scoped = `${k}@${server}`
      if (value !== null && localStorage.getItem(scoped) === null) localStorage.setItem(scoped, value)
      localStorage.removeItem(k)
      moved = true
    }
    const owner = localStorage.getItem(OWNER_KEY)
    if (owner && !owner.includes('://')) localStorage.setItem(OWNER_KEY, identity(owner, server))
    if (moved) window.dispatchEvent(new Event('profile-updated'))
  } catch {
    // storage unavailable: nothing to move
  }
}

/** the profile this device holds for the person (null: none yet) */
export function readLocalProfile(user: string): Record<string, unknown> | null {
  return readObject(profileStorageKey(user))
}

/** true when this device already holds a profile for the person (it is not a first sight) */
export function hasLocalProfile(user: string, server?: string): boolean {
  return !!readObject(profileStorageKey(user, server))
}

/** an emoji older builds saved as its JSON escape text ("🟢") */
function decodeEmoji(v: string): string {
  if (!/^(\\u[0-9A-Fa-f]{4})+$/.test(v)) return v
  try {
    return JSON.parse('"' + v + '"') as string
  } catch {
    return ''
  }
}

/**
 * Take the server's copy of the profile into this device: the server wins for
 * every field it has a value for, the device keeps its own where the server's is
 * empty (a person who never saved on the server keeps what they set here).
 * Returns the merged fields; tells the header and the shell when something changed.
 */
export function mergeServerProfile(user: string, server: Record<string, unknown>, at?: string): Record<string, unknown> {
  const local = readObject(profileStorageKey(user, at)) ?? {}
  const merged: Record<string, unknown> = { ...local }
  for (const k of PROFILE_KEYS) {
    const v = server[k]
    if (typeof v === 'string' && v !== '') merged[k] = k === 'statusEmoji' ? decodeEmoji(v) : v
  }
  const before = JSON.stringify(local)
  const after = JSON.stringify(merged)
  if (after !== before) {
    storeItem(profileStorageKey(user, at), after)
    window.dispatchEvent(new Event('profile-updated'))
  }
  return merged
}

// ---- the choices ------------------------------------------------------------

/** what a stored `prefs` object is allowed to carry: anything else is dropped */
export function cleanPrefs(raw: unknown): Partial<Prefs> {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const out: Partial<Prefs> = {}
  if (o.theme === 'dark' || o.theme === 'light' || o.theme === 'system') out.theme = o.theme
  if (typeof o.themeName === 'string' && (o.themeName === '' || /^[a-z0-9][a-z0-9-]{0,39}$/.test(o.themeName))) out.themeName = o.themeName
  if (typeof o.reduceMotion === 'boolean') out.reduceMotion = o.reduceMotion
  if (typeof o.use24hClock === 'boolean') out.use24hClock = o.use24hClock
  if (typeof o.defaultPage === 'string' && o.defaultPage !== 'setup' && o.defaultPage !== 'login' && Object.prototype.hasOwnProperty.call(pageMeta, o.defaultPage)) out.defaultPage = o.defaultPage as PageId
  if (typeof o.customCSS === 'string' && o.customCSS.length <= 65536) out.customCSS = o.customCSS
  return out
}

export function currentPrefs(): Prefs {
  const s = useSettingsStore.getState()
  return { theme: s.theme, themeName: s.themeName, reduceMotion: s.reduceMotion, use24hClock: s.use24hClock, defaultPage: s.defaultPage, customCSS: s.customCSS }
}

function differsFromDefaults(): boolean {
  const cur = currentPrefs()
  return SYNCED_PREFS.some((k) => cur[k] !== DEFAULT_SETTINGS[k])
}

const getLocalAt = (user: string, server?: string): number => Number(localStorage.getItem(prefsAtKey(user, server))) || 0
const setLocalAt = (user: string, at: number, server?: string): void => storeItem(prefsAtKey(user, server), String(at))

/** true while the server's choices are being taken in: those changes are not written back */
let applying = false
/** the person whose server copy this device has taken in: only their choices are written back */
let activeUser = ''
let pushTimer: ReturnType<typeof setTimeout> | null = null

function applyPrefs(prefs: Partial<Prefs>): void {
  const store = useSettingsStore.getState()
  applying = true
  try {
    for (const k of SYNCED_PREFS) {
      const v = prefs[k]
      if (v === undefined || v === store[k]) continue
      // a personal theme this device cannot find (made on another device, or deleted) would drop the look to the stock one: keep what is here
      if (k === 'themeName' && v !== '' && !resolveTheme(v as string)) continue
      store.updateSetting(k, v as never)
    }
  } finally {
    applying = false
  }
}

// ---- writing back -----------------------------------------------------------

let writeChain: Promise<unknown> = Promise.resolve()

/**
 * Merge `patch` into the person's document on the server. The whole document is
 * replaced by a POST, so it is read first: a profile save never drops the
 * choices stored beside it and a choice never drops the profile.
 */
export function patchServerProfile(patch: Record<string, unknown>): Promise<boolean> {
  // written to the server in use when it was asked for, never to the one the dashboard switched to meanwhile
  const server = apiClient.getBaseUrl()
  const run = async (): Promise<boolean> => {
    try {
      if (apiClient.getBaseUrl() !== server) return false
      const current = (await fetchProfile()).profile ?? {}
      if (apiClient.getBaseUrl() !== server) return false
      await saveProfileToServer({ ...current, ...patch })
      return true
    } catch {
      return false
    }
  }
  const next = writeChain.then(run, run)
  writeChain = next
  return next
}

async function pushPrefs(): Promise<void> {
  const user = activeUser
  if (!user) return
  const at = getLocalAt(user) || Date.now()
  await patchServerProfile({ prefs: currentPrefs(), prefsAt: at })
}

function schedulePush(): void {
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    void pushPrefs()
  }, PUSH_DELAY_MS)
}

// A choice made on this device: remember when, write it to the person's document a moment later
useSettingsStore.subscribe((state, prev) => {
  if (applying || !activeUser) return
  if (!SYNCED_PREFS.some((k) => state[k] !== prev[k])) return
  setLocalAt(activeUser, Date.now())
  storeItem(OWNER_KEY, identity(activeUser))
  schedulePush()
})

// ---- reading ----------------------------------------------------------------

/**
 * Take in the person's server document: the profile fields, then the choices.
 * `themesLoaded` says the theme list is already here (a personal theme is only
 * taken over when this device can resolve it).
 */
function takeInDocument(user: string, server: Record<string, unknown> | null, at = apiClient.getBaseUrl()): void {
  let pushNow = false
  // the settings on this device are this person's choices (nobody else's, not the same name's on another server)
  const owner = localStorage.getItem(OWNER_KEY)
  let mine = !owner || owner === identity(user, at)
  if (server) {
    mergeServerProfile(user, server, at)
    const prefs = cleanPrefs(server.prefs)
    const serverAt = typeof server.prefsAt === 'number' ? server.prefsAt : 0
    const localAt = getLocalAt(user, at)
    if (Object.keys(prefs).length > 0) {
      if (serverAt >= localAt) {
        applyPrefs(prefs)
        setLocalAt(user, serverAt, at)
        mine = true
      } else if (mine) {
        pushNow = true // this device changed them after the server last heard
      }
    }
  }
  const noChoicesStored = !server || Object.keys(cleanPrefs(server.prefs)).length === 0
  if (noChoicesStored && mine && differsFromDefaults()) {
    // first time the server hears of this person's choices: the settings on this device are theirs
    setLocalAt(user, Date.now(), at)
    pushNow = true
  }
  // the device's settings become this person's when they took theirs in (or were theirs already); a choice they make
  // here makes them theirs too (below, the settings subscription)
  if (mine) storeItem(OWNER_KEY, identity(user, at))
  activeUser = user
  // only what this device keeps for the person ON THIS SERVER seeds this server's empty document
  const seedProfile = !server && hasLocalProfile(user, at)
  if (seedProfile) {
    const local = readObject(profileStorageKey(user, at)) ?? {}
    const fields: Record<string, unknown> = {}
    for (const k of PROFILE_KEYS) if (typeof local[k] === 'string') fields[k] = local[k]
    void patchServerProfile({ ...fields, ...(pushNow ? { prefs: currentPrefs(), prefsAt: getLocalAt(user, at) } : {}) })
  } else if (pushNow) {
    schedulePush()
  }
}

/** for the Settings page: read the server copy again; true when it answered */
export async function syncProfileFromServer(user: string): Promise<boolean> {
  try {
    const res = await fetchProfile()
    takeInDocument(user, res.profile && typeof res.profile === 'object' ? (res.profile as Record<string, unknown>) : null)
    return true
  } catch {
    return false
  }
}

let doneKey = ''
let running: { key: string; promise: Promise<void> } | null = null

/** the person signed out: the next sign-in reads everything again */
export function resetUserSync(): void {
  doneKey = ''
  running = null
  activeUser = ''
  if (pushTimer) {
    clearTimeout(pushTimer)
    pushTimer = null
  }
}

/**
 * Dress this dashboard for the person who just signed in. Safe to call as often
 * as convenient: it works once per person, server and token. `timeoutMs` only
 * limits how long the CALLER waits; a slow server finishes the job afterwards.
 */
export function hydrateUser(opts: { user?: string; timeoutMs?: number } = {}): Promise<void> {
  const auth = useAuthStore.getState()
  const user = opts.user || auth.currentUser || ''
  if (!user) return Promise.resolve()
  const key = `${useSettingsStore.getState().serverUrl}|${user}|${(auth.apiToken ?? '').slice(-10)}`
  if (doneKey === key) return Promise.resolve()
  if (!running || running.key !== key) {
    const server = apiClient.getBaseUrl()
    migrateLegacyKeys(server)
    const promise = (async () => {
      const [profile, layout, themes] = await Promise.allSettled([fetchProfile(), fetchDashboardLayout(), useThemeStore.getState().refresh()])
      void themes // a failed theme list leaves the cached one in place; the shell retries on its own schedule
      if (apiClient.getBaseUrl() !== server) return // another server meanwhile: its own sign-in reads its own document
      if (profile.status === 'fulfilled') {
        const doc = profile.value.profile && typeof profile.value.profile === 'object' ? (profile.value.profile as Record<string, unknown>) : null
        try {
          takeInDocument(user, doc, server)
          doneKey = key
        } catch {
          // an unreadable document leaves the look as it is; the next sign-in tries again
        }
      }
      if (layout.status === 'fulfilled' && layout.value.layout) {
        try {
          const { primeDashboardLayout } = await import('../hooks/useDashboardLayout')
          primeDashboardLayout(user, layout.value.layout)
        } catch {
          // the Dashboard fetches its layout itself when it opens
        }
      }
    })()
    running = { key, promise }
    void promise.finally(() => {
      if (running && running.promise === promise) running = null
    })
  }
  const work = running.promise
  const wait = opts.timeoutMs
  if (!wait || wait <= 0) return work
  return Promise.race([work, new Promise<void>((resolve) => setTimeout(resolve, wait))])
}
