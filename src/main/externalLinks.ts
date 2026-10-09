// A link the dashboard opens outside the app (target=_blank, window.open) goes to the system browser only when it is a
// web address: the addresses come from servers too (a container's port link, a template's docs, a VM's console), and
// shell.openExternal would hand any scheme (file:, smb:, a custom protocol handler) to the operating system.
const ALLOWED = new Set(['http:', 'https:'])

export function isSafeExternalUrl(url: string): boolean {
  try {
    return ALLOWED.has(new URL(url).protocol)
  } catch {
    return false
  }
}
