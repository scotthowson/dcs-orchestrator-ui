import { create } from 'zustand'
import { resetsWithServer } from '../lib/serverScope'
import * as api from '../api/endpoints'
import type { SecretEntry } from '../../shared/types'

interface SecretsState {
  /** Names only — values are write-only on the server */
  keys: string[]
  entries: SecretEntry[]
  loading: boolean
  saving: boolean
  error: string | null
  fetchSecrets: (scope?: string | null) => Promise<void>
  /** Returns the placeholder to reference the secret with, or null on failure */
  setSecret: (key: string, value: string, member?: string | null) => Promise<{ reference: string; replaced: boolean } | null>
  deleteSecret: (key: string, member?: string | null) => Promise<boolean>
}

function normalize(secrets: unknown): SecretEntry[] {
  if (!Array.isArray(secrets)) return []
  return secrets
    .map((s: unknown) => (typeof s === 'string' ? { key: s, modified: '', size: 0 } : (s as SecretEntry)))
    .filter((s) => s && typeof s.key === 'string')
}

export const useSecretsStore = create<SecretsState>((set) => ({
  keys: [],
  entries: [],
  loading: false,
  saving: false,
  error: null,

  fetchSecrets: async (scope) => {
    set({ loading: true, error: null })
    try {
      const res = await api.fetchSecrets(scope)
      const entries = normalize(res.secrets)
      set({ entries, keys: entries.map((e) => e.key), loading: false })
    } catch (err) {
      set({ loading: false, error: err instanceof Error ? err.message : 'Failed to fetch secrets' })
    }
  },

  setSecret: async (key, value, member) => {
    set({ saving: true, error: null })
    try {
      const res = await api.setSecret(key, value, member)
      const list = await api.fetchSecrets(member ?? undefined)
      const entries = normalize(list.secrets)
      set({ entries, keys: entries.map((e) => e.key), saving: false })
      return { reference: res.reference ?? `\${SECRETS_${key}}`, replaced: !!res.replaced }
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to set secret' })
      return null
    }
  },

  deleteSecret: async (key, member) => {
    set({ saving: true, error: null })
    try {
      await api.deleteSecret(key, member)
      set((prev) => ({
        keys: prev.keys.filter((k) => k !== key),
        entries: prev.entries.filter((e) => e.key !== key),
        saving: false,
      }))
      return true
    } catch (err) {
      set({ saving: false, error: err instanceof Error ? err.message : 'Failed to delete secret' })
      return false
    }
  },
}))

resetsWithServer(useSecretsStore)
