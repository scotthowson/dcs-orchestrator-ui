// =============================================================================
// Remembered passwords, from the renderer's side. Only the desktop app keeps them (main/credentialVault.ts:
// encrypted by safeStorage, the system keychain); the browser and the Android app keep none, so every call
// here answers "nothing kept" there. A password read back lives only in memory, for the one sign-in it is for.
// =============================================================================

function api() {
  return typeof window !== 'undefined' ? window.electronAPI?.credentials : undefined
}

let availableOnce: Promise<boolean> | null = null

/** whether "Remember the password on this device" can be offered (desktop app with a working keychain) */
export function canRememberPasswords(): Promise<boolean> {
  const c = api()
  if (!c) return Promise.resolve(false)
  if (!availableOnce) availableOnce = c.available().then((v) => v === true).catch(() => false)
  return availableOnce
}

export async function rememberPassword(serverId: string, url: string, username: string, password: string): Promise<boolean> {
  const c = api()
  if (!c || !(await canRememberPasswords())) return false
  try { return (await c.save(serverId, url, username, password)) === true } catch { return false }
}

export async function rememberedPassword(serverId: string, url: string): Promise<{ username: string; password: string } | null> {
  const c = api()
  if (!c) return null
  try {
    const r = await c.get(serverId, url)
    return r && typeof r.username === 'string' && typeof r.password === 'string' && r.password ? r : null
  } catch {
    return null
  }
}

export async function forgetPassword(serverId: string): Promise<void> {
  const c = api()
  if (!c) return
  try { await c.forget(serverId) } catch { /* the keychain file is gone already */ }
}

/** the servers with a password kept on this device */
export async function rememberedServers(): Promise<string[]> {
  const c = api()
  if (!c) return []
  try { const l = await c.list(); return Array.isArray(l) ? l.filter((x) => typeof x === 'string') : [] } catch { return [] }
}
