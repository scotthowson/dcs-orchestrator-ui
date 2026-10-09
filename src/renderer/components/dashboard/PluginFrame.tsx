// =============================================================================
// PluginFrame — sandboxed plugin card frames with the API message bridge
// =============================================================================

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, RefreshCw } from 'lucide-react'
import { apiClient } from '../../api/client'
import { fetchPluginCard } from '../../api/endpoints'
import { usePolling } from '../../hooks/usePolling'
import { BTN_CARD_QUIET } from '../../lib/ui'

// Injected ahead of every plugin card. The card runs sandboxed at a null
// origin, so it can neither reach the API nor hold a session; instead any
// fetch("/path") (or window.dcs.fetch) is relayed to the dashboard, which
// performs the GET with the signed-in session and posts the JSON back.
const PLUGIN_BRIDGE = `<script>(function(){var n=0,p={};window.addEventListener('message',function(e){var m=e.data;if(!m||m.type!=='dcs-api-response'||!p[m.id])return;var r=p[m.id];delete p[m.id];r({ok:!!m.ok,status:m.status||0,json:function(){return Promise.resolve(m.data)},text:function(){return Promise.resolve(JSON.stringify(m.data))}})});function bridge(path){return new Promise(function(res){var id=++n;p[id]=res;parent.postMessage({type:'dcs-api-request',id:id,path:path},'*')})}window.dcs={fetch:bridge};window.__DCS_TOKEN='';var f=window.fetch;window.fetch=function(u,o){var s=typeof u==='string'?u:(u&&u.url)||'';if(/^\\/(?!\\/)/.test(s))return bridge(s);return f.apply(this,arguments)};})();</script>`

// The palette of the look in use, handed to every card as CSS variables (--dcs-text, --dcs-surface, --dcs-accent …): a card that
// writes color: var(--dcs-text, #e2e8f0) follows the theme, dark or light; a card that hard-codes its colours stays as it was made.
const THEME_VARS = ['--dcs-accent', '--dcs-accent-secondary', '--dcs-bg', '--dcs-surface', '--dcs-surface-raised', '--dcs-border', '--dcs-text', '--dcs-text-muted', '--dcs-success', '--dcs-warning', '--dcs-danger', '--dcs-info']
const SAFE_COLOR = /^(#[0-9a-fA-F]{3,8}|rgba?\([\d\s.,%/]+\))$/

/** a <style> for the card's document: the look's variables and its colour scheme */
function themeStyle(): string {
  const root = document.documentElement
  const cs = getComputedStyle(root)
  const decl = THEME_VARS.map((v) => {
    const val = cs.getPropertyValue(v).trim()
    return SAFE_COLOR.test(val) ? `${v}:${val}` : ''
  }).filter(Boolean)
  decl.push(`color-scheme:${root.classList.contains('light') ? 'light' : 'dark'}`)
  return `<style>:root{${decl.join(';')}}</style>`
}

// The page a card lives in is exactly as tall as its frame (html and body are 100 %): a card that wants to follow its box when someone resizes it gives its root height: 100% and lets a
// list take the rest (flex: 1; min-height: 0; overflow-y: auto) instead of a fixed max-height. Ahead of the card's own styles, so a card that sets its own body is unaffected.
const BASE_STYLE = '<style>html,body{height:100%}</style>'

/** counts up whenever the look changes (dark ↔ light, another theme), so a card is drawn again in the new palette */
function useThemeKey(): number {
  const [key, setKey] = useState(0)
  useEffect(() => {
    const observer = new MutationObserver(() => setKey((k) => k + 1))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] })
    return () => observer.disconnect()
  }, [])
  return key
}

/** a card that declares no refresh is read once (and on Try again) */
const NO_REFRESH_MS = 24 * 3600 * 1000

/** Plugin card iframe — fetches HTML from API and renders it from a blob URL */
export function PluginCardFrame({ pluginName, cardName, title, refreshInterval = 0 }: { pluginName: string; cardName: string; title: string; refreshInterval?: number }) {
  const [src, setSrc] = useState<string>('')
  const themeKey = useThemeKey()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  // the card's HTML: once, and again on the cadence a card declares (10 s at the least)
  const cardKey = `plugin-card:${pluginName}/${cardName}`
  const refreshes = refreshInterval > 0
  const card = usePolling(() => fetchPluginCard(pluginName, cardName), refreshes ? Math.max(10, refreshInterval) * 1000 : NO_REFRESH_MS, {
    key: cardKey,
    // a card without a cadence is not read again when the tab shows either
    whenHidden: refreshes ? 'pause' : 'run',
  })
  const html = card.dataKey === cardKey ? card.data?.html ?? null : null
  const error = !!card.error && !card.fetching
  // drawn again with every answer and whenever the look changes (dark ↔ light, another theme)
  useEffect(() => {
    if (html === null) return
    // Blob URL has null origin — CSP of parent page does NOT apply
    // Scripts execute freely inside blob URL iframes
    const blob = new Blob([PLUGIN_BRIDGE + themeStyle() + BASE_STYLE + html], { type: 'text/html' })
    setSrc((prev) => { if (prev) URL.revokeObjectURL(prev); return URL.createObjectURL(blob) })
  }, [html, card.updatedAt, themeKey])

  // Answer the card's data requests with the dashboard's own session (GET only)
  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = iframeRef.current?.contentWindow
      if (!win || e.source !== win) return
      const msg = e.data as { type?: string; id?: number; path?: string } | null
      if (!msg || msg.type !== 'dcs-api-request' || typeof msg.path !== 'string') return
      const path = msg.path.replace(/^\/api(?=\/)/, '')
      if (!path.startsWith('/') || path.includes('..')) {
        win.postMessage({ type: 'dcs-api-response', id: msg.id, ok: false, status: 400, data: { error: 'Only API paths like /routes are allowed' } }, '*')
        return
      }
      try {
        const data = await apiClient.get<unknown>(path)
        win.postMessage({ type: 'dcs-api-response', id: msg.id, ok: true, status: 200, data }, '*')
      } catch (err) {
        const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500
        win.postMessage({ type: 'dcs-api-response', id: msg.id, ok: false, status, data: { error: err instanceof Error ? err.message : 'request failed' } }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-2 p-4 text-center" role="alert">
        <AlertCircle size={18} className="text-rose-400" aria-hidden />
        <p className="text-sm text-slate-400">This card did not load</p>
        <button type="button" onClick={() => { void card.refresh() }} className={BTN_CARD_QUIET}><RefreshCw size={12} /> Try again</button>
      </div>
    )
  }

  if (!src) {
    return (
      <div className="h-full p-4" role="status">
        <span className="sr-only">Loading {title}…</span>
        <div className="skeleton h-full w-full" aria-hidden />
      </div>
    )
  }

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      // SECURITY: Sandbox plugin iframes — allow scripts (for dynamic cards) but block
      // top-navigation, forms, popups, and same-origin access to parent window.
      // This prevents malicious plugins from accessing the parent app's DOM, cookies, or auth tokens.
      sandbox="allow-scripts"
      // @ts-ignore — allowtransparency is a valid HTML attribute but not in React types
      allowtransparency="true"
      style={{ width: '100%', height: '100%', border: 'none', borderRadius: '12px', display: 'block', background: 'transparent' }}
    />
  )
}

/**
 * Renders card HTML (with the bridge prepended) from a blob URL in a sandboxed
 * frame and answers the card's data requests with the dashboard's session.
 */
export function HtmlCardFrame({ html, title }: { html: string; title: string }) {
  const [src, setSrc] = useState<string>('')
  const themeKey = useThemeKey()
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    const blob = new Blob([PLUGIN_BRIDGE + themeStyle() + html], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    setSrc(url)
    return () => URL.revokeObjectURL(url)
  }, [html, themeKey])

  useEffect(() => {
    const onMessage = async (e: MessageEvent) => {
      const win = iframeRef.current?.contentWindow
      if (!win || e.source !== win) return
      const msg = e.data as { type?: string; id?: number; path?: string } | null
      if (!msg || msg.type !== 'dcs-api-request' || typeof msg.path !== 'string') return
      const path = msg.path.replace(/^\/api(?=\/)/, '')
      if (!path.startsWith('/') || path.includes('..')) {
        win.postMessage({ type: 'dcs-api-response', id: msg.id, ok: false, status: 400, data: { error: 'Only API paths like /routes are allowed' } }, '*')
        return
      }
      try {
        const data = await apiClient.get<unknown>(path)
        win.postMessage({ type: 'dcs-api-response', id: msg.id, ok: true, status: 200, data }, '*')
      } catch (err) {
        const status = typeof (err as { status?: unknown })?.status === 'number' ? (err as { status: number }).status : 500
        win.postMessage({ type: 'dcs-api-response', id: msg.id, ok: false, status, data: { error: err instanceof Error ? err.message : 'request failed' } }, '*')
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  if (!src) return null
  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      sandbox="allow-scripts"
      // @ts-ignore — allowtransparency is a valid HTML attribute but not in React types
      allowtransparency="true"
      style={{ width: '100%', height: '100%', border: 'none', borderRadius: '12px', display: 'block', background: 'transparent' }}
    />
  )
}
