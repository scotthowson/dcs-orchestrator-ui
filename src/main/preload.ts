import { contextBridge, ipcRenderer } from 'electron'

export interface ElectronAPI {
  getSettings: () => Promise<Record<string, unknown>>
  getSetting: (key: string) => Promise<unknown>
  setSetting: (key: string, value: unknown) => Promise<boolean>
  getVersion: () => Promise<string>
  /** Combined server check: connectivity + setup status in one call (Node.js http, no CORS) */
  checkServer: (serverUrl: string) => Promise<{ reachable: boolean; initialized: boolean; error?: string }>
  /** Generic JSON fetch via Node.js http (bypasses all browser security) */
  netFetchJson: (url: string) => Promise<{ ok: boolean; status: number; data: unknown; error?: string }>
  /** Discord Rich Presence: push the latest facts (details/state lines, images, buttons) */
  presenceUpdate: (payload: Record<string, unknown>) => Promise<boolean>
  /** Discord Rich Presence: connection state for the Settings page */
  presenceStatus: () => Promise<{ enabled: boolean; connected: boolean; clientId: string; error: string; lastSentAt: number; user: string }>
  /** Re-read the discord* settings and reconnect */
  presenceConfigure: () => Promise<{ enabled: boolean; connected: boolean; clientId: string; error: string; lastSentAt: number; user: string }>
  /** passwords remembered per server, encrypted by safeStorage in the main process (see main/credentialVault.ts) */
  credentials: {
    available: () => Promise<boolean>
    save: (serverId: string, url: string, username: string, password: string) => Promise<boolean>
    get: (serverId: string, url: string) => Promise<{ username: string; password: string } | null>
    list: () => Promise<string[]>
    forget: (serverId: string) => Promise<boolean>
  }
}

contextBridge.exposeInMainWorld('electronAPI', {
  getSettings: () => ipcRenderer.invoke('get-settings'),
  getSetting: (key: string) => ipcRenderer.invoke('get-setting', key),
  setSetting: (key: string, value: unknown) => ipcRenderer.invoke('set-setting', key, value),
  getVersion: () => ipcRenderer.invoke('get-version'),
  checkServer: (serverUrl: string) => ipcRenderer.invoke('check-server', serverUrl),
  netFetchJson: (url: string) => ipcRenderer.invoke('net-fetch-json', url),
  presenceUpdate: (payload: Record<string, unknown>) => ipcRenderer.invoke('presence-update', payload),
  presenceStatus: () => ipcRenderer.invoke('presence-status'),
  presenceConfigure: () => ipcRenderer.invoke('presence-configure'),
  credentials: {
    available: () => ipcRenderer.invoke('credentials-available'),
    save: (serverId: string, url: string, username: string, password: string) => ipcRenderer.invoke('credentials-save', serverId, url, username, password),
    get: (serverId: string, url: string) => ipcRenderer.invoke('credentials-get', serverId, url),
    list: () => ipcRenderer.invoke('credentials-list'),
    forget: (serverId: string) => ipcRenderer.invoke('credentials-forget', serverId),
  },
} satisfies ElectronAPI)
