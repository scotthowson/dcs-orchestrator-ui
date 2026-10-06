import { create } from 'zustand'
import { AppSettings, PageId, ADMIN_ONLY_PAGES } from '../../shared/types'
// Circular import with authStore is safe — both stores only reference each other
// inside function bodies (never at module evaluation time).
import { useAuthStore } from './authStore'
import { getDefaultServerUrl } from '../lib/env'
import { rememberTab } from '../constants/navSections'

/** the theme choice, persisted with the other settings */
export interface ThemeSettings {
  /** this person's theme: a built-in or server theme name; '' = follow the server's active theme */
  themeName: string
  /** cache of GET /themes → active, so the server's theme applies before the first fetch answers */
  serverThemeActive: string
  /** set once the mode was carried over from a dashboard where the theme decided it (before 4.0) */
  themeModeMigrated: boolean
}

export type PersistedSettings = AppSettings & ThemeSettings

export const DEFAULT_SETTINGS: PersistedSettings = {
  serverUrl: getDefaultServerUrl(),
  pollingInterval: 10000,
  containerPollingInterval: 5000,
  imagePollingInterval: 60000,
  logPollingInterval: 3000,
  // until the person picks one, the look follows the device (prefers-color-scheme)
  theme: 'system',
  sidebarCollapsed: false,
  hiddenPages: [],
  diskLabels: {},
  pinnedDisks: [],
  customDisks: [],
  stackAnnotations: {},
  backgroundImage: '',
  autoLockMinutes: 0,
  autoCheckUpdates: 0, // 0 = off, or interval in ms (3600000 = hourly, 86400000 = daily)
  updatesAvailable: 0, // number of available DCS framework updates
  notificationsEnabled: true,
  projectName: 'DCS Orchestrator',
  // '' = the server's name (useBrand)
  projectSubtitle: '',
  connectionProfiles: [],
  customCSS: '',
  rememberUsername: true,
  lastUsername: '',
  sessionDurationMinutes: 240,
  defaultPage: 'dashboard',
  use24hClock: true,
  reduceMotion: false,
  themeName: '',
  serverThemeActive: '',
  themeModeMigrated: false,
}

interface SettingsState extends PersistedSettings {
  /** true once the saved settings were read (not persisted): the look waits for it */
  settingsLoaded: boolean
  currentPage: PageId
  navigationPayload: Record<string, unknown> | null
  setCurrentPage: (page: PageId, payload?: Record<string, unknown>) => void
  consumeNavigationPayload: () => Record<string, unknown> | null
  toggleSidebar: () => void
  updateSetting: <K extends keyof PersistedSettings>(key: K, value: PersistedSettings[K]) => void
  loadSettings: () => Promise<void>
}

/** Persist a single setting via electron-store IPC or localStorage fallback. */
async function persistSetting(key: string, value: unknown): Promise<void> {
  if (window.electronAPI) {
    await window.electronAPI.setSetting(key, value)
  } else {
    try {
      const raw = localStorage.getItem('app-settings')
      const obj = raw ? JSON.parse(raw) : {}
      obj[key] = value
      localStorage.setItem('app-settings', JSON.stringify(obj))
    } catch {
      // localStorage may be unavailable in some environments
    }
  }
}

/** Load all settings from electron-store IPC or localStorage fallback. */
async function loadPersistedSettings(): Promise<Partial<PersistedSettings>> {
  if (window.electronAPI) {
    const stored = await window.electronAPI.getSettings()
    return stored as Partial<PersistedSettings>
  }
  try {
    const raw = localStorage.getItem('app-settings')
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

/** the app name and subtitle earlier versions shipped as defaults (a saved one of these is not a choice) */
export const OLD_DEFAULT_NAMES = ['', 'DCS Manager', 'Docker Compose Skeleton', 'Docker Compose Skeleton UI']
export const OLD_DEFAULT_SUBTITLES = ['', 'DCS Orchestrator', 'Docker Compose Skeleton']

/** pages a refresh never returns to */
const TRANSIENT_PAGES: ReadonlySet<string> = new Set(['setup', 'login'])

export const useSettingsStore = create<SettingsState>((set, get) => ({
  ...DEFAULT_SETTINGS,
  settingsLoaded: false,
  currentPage: 'dashboard',
  navigationPayload: null,

  setCurrentPage: (page, payload) => {
    // Navigation guard: block non-admin users from admin-only pages
    if (ADMIN_ONLY_PAGES.has(page)) {
      const role = useAuthStore.getState().userRole
      if (role !== 'admin') {
        set({ currentPage: 'dashboard', navigationPayload: null })
        return
      }
    }
    set({ currentPage: page, navigationPayload: payload ?? null })
    rememberTab(page)
    // Persist last page so F5/refresh restores it (skip transient pages)
    if (!TRANSIENT_PAGES.has(page)) {
      persistSetting('lastPage', page)
    }
  },

  consumeNavigationPayload: (): Record<string, unknown> | null => {
    const { navigationPayload } = get()
    if (navigationPayload) set({ navigationPayload: null })
    return navigationPayload
  },

  toggleSidebar: () =>
    set((state) => {
      const collapsed = !state.sidebarCollapsed
      persistSetting('sidebarCollapsed', collapsed)
      return { sidebarCollapsed: collapsed }
    }),

  updateSetting: (key, value) => {
    set({ [key]: value } as Partial<SettingsState>)
    persistSetting(key, value)
  },

  loadSettings: async () => {
    const stored = await loadPersistedSettings()
    const lastPage = (stored as Record<string, unknown>).lastPage as PageId | undefined
    // Don't restore admin-only pages for non-admin users
    let restoredPage: PageId | undefined
    if (lastPage && !TRANSIENT_PAGES.has(lastPage)) {
      if (ADMIN_ONLY_PAGES.has(lastPage)) {
        try {
          const role = useAuthStore.getState().userRole
          restoredPage = role === 'admin' ? lastPage : undefined
        } catch {
          restoredPage = undefined
        }
      } else {
        restoredPage = lastPage
      }
    }
    // a mode this build does not know (a hand-edited file, an old build's typo) means "follow the device"
    const mode = (stored as Record<string, unknown>).theme
    const theme = mode === 'dark' || mode === 'light' || mode === 'system' ? mode : DEFAULT_SETTINGS.theme
    // the name and subtitle earlier versions saved as their defaults are today's defaults: the app is called
    // DCS Orchestrator, and the line under it is the server's name unless someone wrote their own
    const savedName = (stored as Record<string, unknown>).projectName
    const projectName = typeof savedName === 'string' && !OLD_DEFAULT_NAMES.includes(savedName) ? savedName : DEFAULT_SETTINGS.projectName
    const savedSubtitle = (stored as Record<string, unknown>).projectSubtitle
    const projectSubtitle = typeof savedSubtitle === 'string' && !OLD_DEFAULT_SUBTITLES.includes(savedSubtitle) ? savedSubtitle : DEFAULT_SETTINGS.projectSubtitle
    set({
      ...DEFAULT_SETTINGS,
      ...stored,
      projectName,
      projectSubtitle,
      theme,
      settingsLoaded: true,
      ...(restoredPage ? { currentPage: restoredPage } : {}),
    })
    if (restoredPage) rememberTab(restoredPage)
  },
}))
