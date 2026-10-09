import { create } from 'zustand'
import type { Plugin, PluginCatalogEntry } from '../../shared/types'
import { resetsWithServer } from '../lib/serverScope'
import * as api from '../api/endpoints'

// Built-in features that act as plugins (togglable without backend installation)
const BUILT_IN_PLUGINS: Plugin[] = [
  {
    name: 'compose-linter',
    version: '1.2.0',
    description: 'Real-time compose validation with 24 rules',
    author: 'DCS Community',
    enabled: true,
    templates: [],
    hooks: ['pre-deploy'],
  },
]

/** Read built-in plugin enabled state from localStorage */
function getBuiltInEnabled(name: string): boolean {
  try {
    const stored = localStorage.getItem(`plugin-enabled-${name}`)
    if (stored !== null) return stored === 'true'
  } catch {}
  return true
}

/** Merge API plugins with built-in plugins. localStorage is the source of truth
 *  for built-in plugin enabled state (survives API refetch, page navigation, refresh). */
function mergeWithBuiltIns(apiPlugins: Plugin[]): Plugin[] {
  const builtInNames = new Set(BUILT_IN_PLUGINS.map(bp => bp.name))
  const apiNames = new Set(apiPlugins.map(p => p.name))

  // For API plugins that are also built-ins, override enabled from localStorage
  const merged = apiPlugins.map(p => {
    if (builtInNames.has(p.name)) {
      return { ...p, enabled: getBuiltInEnabled(p.name) }
    }
    return p
  })

  // Add built-ins not returned by the API
  const extras = BUILT_IN_PLUGINS
    .filter(bp => !apiNames.has(bp.name))
    .map(bp => ({ ...bp, enabled: getBuiltInEnabled(bp.name) }))

  return [...merged, ...extras]
}

interface PluginState {
  plugins: Plugin[]
  catalog: PluginCatalogEntry[]
  catalogLoading: boolean
  loading: boolean
  installing: boolean
  error: string | null
  fetchCatalog: () => Promise<void>
  installFromCatalog: (name: string) => Promise<boolean>
  fetchPlugins: () => Promise<void>
  installPlugin: (source: string) => Promise<boolean>
  scaffoldPlugin: (def: Parameters<typeof api.scaffoldPlugin>[0]) => Promise<boolean>
  removePlugin: (name: string) => Promise<boolean>
  togglePlugin: (name: string) => Promise<boolean>
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: mergeWithBuiltIns([]),
  catalog: [],
  catalogLoading: false,
  loading: false,
  installing: false,
  error: null,

  fetchPlugins: async () => {
    set({ loading: true, error: null })
    try {
      const res = await api.fetchPlugins()
      set({ plugins: mergeWithBuiltIns(res.plugins), loading: false })
    } catch (err) {
      // Even on error, keep built-in plugins available
      set({ plugins: mergeWithBuiltIns([]), loading: false, error: err instanceof Error ? err.message : 'Failed to fetch plugins' })
    }
  },

  installPlugin: async (source) => {
    set({ installing: true, error: null })
    try {
      await api.installPlugin(source)
      set({ installing: false })
      get().fetchPlugins()
      return true
    } catch (err) {
      set({ installing: false, error: err instanceof Error ? err.message : 'Failed to install plugin' })
      return false
    }
  },

  fetchCatalog: async () => {
    set({ catalogLoading: true })
    try {
      const res = await api.fetchPluginCatalog()
      set({ catalog: res.plugins ?? [], catalogLoading: false })
    } catch {
      // Older servers have no catalogue; the page falls back to its built-ins
      set({ catalog: [], catalogLoading: false })
    }
  },

  installFromCatalog: async (name) => {
    set({ installing: true, error: null })
    try {
      await api.installCatalogPlugin(name)
      set({ installing: false })
      await get().fetchPlugins()
      get().fetchCatalog()
      return true
    } catch (err) {
      set({ installing: false, error: err instanceof Error ? err.message : `Failed to install ${name}` })
      return false
    }
  },

  scaffoldPlugin: async (def) => {
    set({ installing: true, error: null })
    try {
      await api.scaffoldPlugin(def)
      set({ installing: false })
      get().fetchPlugins()
      return true
    } catch (err) {
      set({ installing: false, error: err instanceof Error ? err.message : 'Failed to scaffold plugin' })
      return false
    }
  },

  removePlugin: async (name) => {
    try {
      await api.removePlugin(name)
      set(prev => ({ plugins: prev.plugins.filter(p => p.name !== name) }))
      return true
    } catch { return false }
  },

  togglePlugin: async (name) => {
    // Check if this is a built-in plugin (not on backend)
    const isBuiltIn = BUILT_IN_PLUGINS.some(bp => bp.name === name)
    const current = get().plugins.find(p => p.name === name)

    if (isBuiltIn && current) {
      // Toggle locally — no API call needed
      const newEnabled = !current.enabled
      set(prev => ({ plugins: prev.plugins.map(p => p.name === name ? { ...p, enabled: newEnabled } : p) }))
      try { localStorage.setItem(`plugin-enabled-${name}`, String(newEnabled)) } catch {}
      return true
    }

    // Backend plugin — the server answers {success, name, enabled}; merge the flag
    try {
      const res = await api.togglePlugin(name) as unknown as { enabled?: boolean }
      set(prev => ({ plugins: prev.plugins.map(p => p.name === name ? { ...p, enabled: typeof res.enabled === 'boolean' ? res.enabled : !p.enabled } : p) }))
      return true
    } catch (err) {
      set({ error: err instanceof Error ? err.message : `Failed to toggle ${name}` })
      return false
    }
  },
}))

resetsWithServer(usePluginStore)
