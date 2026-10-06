// =============================================================================
// The Backups page's small helpers: dates, ages, and how a VM is named
// =============================================================================

const DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }

/** a date from epoch seconds */
export function formatTimestamp(ts: number): string {
  return new Date(ts * 1000).toLocaleString(undefined, DATE)
}

/** a date the server wrote as text (the text itself when it is not one) */
export function formatDateString(dateStr: string): string {
  const d = new Date(dateStr)
  return isNaN(d.getTime()) ? dateStr : d.toLocaleString(undefined, DATE)
}

/** a snapshot's date: its epoch when the list has one, else its text */
export function formatSnapshotDate(ts: string, epoch?: number): string {
  const d = epoch ? new Date(epoch * 1000) : new Date(ts)
  return isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, DATE)
}

/** "just now", "5m ago", "3h ago", "2d ago", "4mo ago" ('' on a date it cannot read) */
export function relativeTime(ts: string, epoch?: number): string {
  const d = epoch ? new Date(epoch * 1000) : new Date(ts)
  if (isNaN(d.getTime())) return ''
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.floor(hr / 24)
  if (days < 30) return `${days}d ago`
  return `${Math.floor(days / 30)}mo ago`
}

export const vmLabel = (name: string, vmid: number | null | undefined) => `VM${vmid ? ` #${vmid}` : ''} · ${name}`

/** a row key: the file on its DCS (the hub's rows have no member) */
export const rowKey = (r: { member?: string | null; filename: string }) => `${r.member ?? ''}|${r.filename}`
