// =============================================================================
// hosts — the machine a link to a published port or a VM should open
// =============================================================================
import { apiClient } from '../api/client'

/**
 * Host for links to a container's published ports. The desktop and Android
 * apps run from file:// or localhost, so the page's own host means nothing
 * there: the configured API server is the machine that publishes the port.
 */
export function serverHostname(): string {
  try {
    const base = apiClient.getBaseUrl()
    if (base && !base.startsWith('/')) {
      const h = new URL(base).hostname
      if (h && h !== 'localhost' && h !== '127.0.0.1') return h
    }
  } catch { /* relative or malformed base URL: use the page host */ }
  const host = window.location.hostname
  return host && host !== 'localhost' ? host : (host || '127.0.0.1')
}

/** a VM's address from its API URL (`http://192.168.2.40:9876` → `192.168.2.40`); '' when there is none */
export function memberHost(url?: string | null): string {
  if (!url) return ''
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1')
}

/** a link to a published port on HOST: https for the usual TLS ports, http for the rest */
export function portUrl(host: string, port: number | string): string {
  const proto = ['443', '8443', '9443'].includes(String(port)) ? 'https' : 'http'
  return `${proto}://${host.includes(':') ? `[${host}]` : host}:${port}`
}
