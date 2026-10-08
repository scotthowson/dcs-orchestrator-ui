// =============================================================================
// The passwords the desktop app remembers, one per server. Pure logic, so it is tested without Electron
// (tests/credential-vault.mjs): main/index.ts hands it Electron's safeStorage and an electron-store file of its own.
//
// - a password is stored only encrypted (safeStorage: the macOS Keychain, Windows DPAPI, the Secret Service or
//   KWallet on Linux), never when encryption is unavailable or only Chromium's built-in key would be used;
// - each entry carries the address of the server it was saved for: a profile whose address was changed afterwards
//   gets nothing back, so a password is never sent to a host it was not typed for;
// - the file holds no plain text and the settings calls (get-settings / get-setting) never return it.
// =============================================================================

export interface CipherBox {
  /** true when encryptString is backed by the system keychain */
  available: () => boolean
  encrypt: (plain: string) => Buffer
  decrypt: (cipher: Buffer) => string
}

export interface VaultFile {
  get: () => Record<string, VaultEntry>
  set: (entries: Record<string, VaultEntry>) => void
}

export interface VaultEntry {
  url: string
  username: string
  /** base64 of safeStorage.encryptString(password) */
  secret: string
  savedAt: number
}

const ID = /^[A-Za-z0-9_-]{1,64}$/

function sameUrl(a: string, b: string): boolean {
  return a.trim().replace(/\/+$/, '').toLowerCase() === b.trim().replace(/\/+$/, '').toLowerCase()
}

export function createVault(box: CipherBox, file: VaultFile) {
  return {
    available(): boolean {
      try { return box.available() } catch { return false }
    },

    save(serverId: unknown, url: unknown, username: unknown, password: unknown): boolean {
      if (typeof serverId !== 'string' || !ID.test(serverId)) return false
      if (typeof url !== 'string' || !url.trim() || typeof username !== 'string' || !username.trim()) return false
      if (typeof password !== 'string' || !password) return false
      if (!this.available()) return false
      let secret: string
      try { secret = box.encrypt(password).toString('base64') } catch { return false }
      const entries = { ...file.get() }
      entries[serverId] = { url: url.trim(), username: username.trim(), secret, savedAt: Date.now() }
      file.set(entries)
      return true
    },

    get(serverId: unknown, url: unknown): { username: string; password: string } | null {
      if (typeof serverId !== 'string' || !ID.test(serverId) || typeof url !== 'string') return null
      const entry = file.get()[serverId]
      if (!entry || !sameUrl(entry.url, url)) return null
      if (!this.available()) return null
      try {
        return { username: entry.username, password: box.decrypt(Buffer.from(entry.secret, 'base64')) }
      } catch {
        return null
      }
    },

    list(): string[] {
      return Object.keys(file.get())
    },

    forget(serverId: unknown): boolean {
      if (serverId === '*') { file.set({}); return true }
      if (typeof serverId !== 'string' || !ID.test(serverId)) return false
      const entries = { ...file.get() }
      if (!(serverId in entries)) return true
      delete entries[serverId]
      file.set(entries)
      return true
    },
  }
}
