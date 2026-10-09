// =============================================================================
// Web terminal — Settings: a real terminal on the server in a browser tab (the
// web-terminal template: ttyd over ssh with a key DCS makes). It publishes no
// port and its route is always behind Authelia, so port 22 need not be open on
// the router. This card switches it on and off, says what it needs, and gives
// it the look of the dashboard's theme.
// =============================================================================

import React, { useCallback, useEffect, useState } from 'react'
import { TerminalSquare, ExternalLink, Loader2, Power, Palette, ShieldCheck, ShieldAlert, Check, X, AppWindow } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { fetchWebTerminalStatus, setWebTerminalTheme, setWebTerminalEmbed, deployTemplate, undeployTemplate } from '../../api/endpoints'
import type { WebTerminalStatus } from '../../../shared/types'
import { BTN_CARD, BTN_CARD_QUIET, TONE_OK, TONE_DANGER } from '../../lib/ui'
import { appliedThemePalette } from '../../lib/themeEngine'
import { mixHex, normalizeHex, stockPalette } from '../../../shared/themes'

/** the sixteen colours of a terminal, taken from the palette the dashboard wears */
export function terminalThemeFromPalette(): Record<string, string> {
  const p = appliedThemePalette() ?? stockPalette('dark')
  const hex = (v: string, fallback: string) => { const n = normalizeHex(v); return /^#[0-9a-f]{6}$/i.test(n) ? n : fallback }
  const bg = hex(p.bg, '#0b0d12'), text = hex(p.text, '#e6e9ef'), accent = hex(p.accent, '#7aa2f7')
  const red = hex(p.danger, '#f7768e'), green = hex(p.success, '#9ece6a'), yellow = hex(p.warning, '#e0af68')
  const blue = hex(p.info, '#7aa2f7'), magenta = hex(p.accentSecondary, '#bb9af7'), cyan = mixHex(blue, green, 0.5)
  const bright = (c: string) => mixHex(c, text, 0.3)
  return {
    background: bg, foreground: text, cursor: accent, cursorAccent: bg, selectionBackground: mixHex(bg, accent, 0.35),
    black: hex(p.surface, '#1b1e27'), red, green, yellow, blue, magenta, cyan, white: mixHex(text, bg, 0.2),
    brightBlack: hex(p.textMuted, '#565f89'), brightRed: bright(red), brightGreen: bright(green), brightYellow: bright(yellow),
    brightBlue: bright(blue), brightMagenta: bright(magenta), brightCyan: bright(cyan), brightWhite: text,
  }
}

function Need({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      {ok ? <Check size={12} className="text-emerald-400 shrink-0" /> : <X size={12} className="text-rose-400 shrink-0" />}
      <span className={ok ? 'text-slate-400' : 'text-slate-200'}>{children}</span>
    </li>
  )
}

export default function WebTerminalCard() {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const [status, setStatus] = useState<WebTerminalStatus | null>(null)
  const [missing, setMissing] = useState(false)   // a server from before the web terminal existed
  const [busy, setBusy] = useState('')
  const [size, setSize] = useState(15)
  const [origin, setOrigin] = useState('')

  const load = useCallback(() => {
    fetchWebTerminalStatus().then((s) => { setStatus(s); setSize(s.font_size || 15); setMissing(false) }).catch(() => setMissing(true))
  }, [])
  useEffect(() => { load() }, [load])
  if (missing) return <p className="text-xs text-slate-500">This server does not have the web terminal yet: update DCS (Updates) to 4.0.15 or later.</p>
  if (!status) return <p className="text-xs text-slate-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Reading…</p>

  const fail = (e: unknown, fallback: string) => addToast({ type: 'error', message: e instanceof Error ? e.message : fallback })
  const on = async () => {
    if (!(await confirm({
      title: 'Switch the web terminal on?',
      message: `A terminal on this server opens at terminal.<your domain>, behind Authelia's sign-in. Whoever signs in there has a shell as ${status.user}, so give Authelia a second factor. DCS makes the terminal a key of its own; switching it off removes the key.`,
      confirmLabel: 'Switch on',
    }))) return
    setBusy('on')
    try {
      await deployTemplate('web-terminal', { target_stack: status.default_stack, auto_start: true })
      addToast({ type: 'success', message: 'The web terminal is starting: its first start adds the ssh client and takes a moment' })
      load(); setTimeout(load, 8000)
    } catch (e) { fail(e, 'Could not switch the web terminal on') } finally { setBusy('') }
  }
  const off = async () => {
    if (!(await confirm({ title: 'Switch the web terminal off?', message: 'The container, its route and its key are removed. ssh on your own network keeps working.', confirmLabel: 'Switch off', danger: true }))) return
    setBusy('off')
    try { await undeployTemplate('web-terminal', { target_stack: status.stack, services: [status.service || 'terminal'] }); load() }
    catch (e) { fail(e, 'Could not switch the web terminal off') } finally { setBusy('') }
  }
  const look = async () => {
    setBusy('look')
    try { const r = await setWebTerminalTheme(terminalThemeFromPalette(), size); addToast({ type: 'success', message: r.message }); load() }
    catch (e) { fail(e, 'Could not change the look') } finally { setBusy('') }
  }

  const embeds = status.embed_origins ?? []
  const embed = async (next: string[]) => {
    setBusy('embed')
    try { const r = await setWebTerminalEmbed(next); addToast({ type: 'success', message: r.message }); setOrigin(''); load() }
    catch (e) { fail(e, 'Could not change which pages may show the terminal') } finally { setBusy('') }
  }
  const addOrigin = () => {
    // an address as people paste it (with a path, a trailing slash) becomes its origin
    let o = origin.trim()
    try { o = new URL(/^https?:\/\//i.test(o) ? o : `https://${o}`).origin } catch { addToast({ type: 'error', message: 'That is not an address (https://dash.example.com)' }); return }
    if (!embeds.includes(o)) void embed([...embeds, o])
  }

  const t = status.theme || {}
  const swatches = ['background', 'foreground', 'cursor', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan'].map((k) => t[k]).filter(Boolean)
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-slate-400">
            A real terminal on this server in a browser tab: the same shell as ssh, with full-screen programs, colours and copy and paste.
            It publishes no port and is reached through its HTTPS route only, always behind Authelia, so port 22 need not be open on your router.
          </p>
          <p className="text-xs mt-1.5 flex items-center gap-2 flex-wrap">
            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${status.running ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-300' : status.deployed ? 'border-amber-500/25 bg-amber-500/10 text-amber-300' : 'border-white/10 bg-white/5 text-slate-400'}`}>
              {status.running ? 'on' : status.deployed ? (status.state || 'stopped') : 'off'}
            </span>
            {status.deployed && (status.protected
              ? <span className="text-emerald-300 flex items-center gap-1"><ShieldCheck size={12} /> behind Authelia</span>
              : <span className="text-rose-300 flex items-center gap-1"><ShieldAlert size={12} /> its route is not behind Authelia: switch it off and on again</span>)}
            {status.deployed && <span className="text-slate-500">signs in as <span className="font-mono text-slate-300">{status.user}</span></span>}
          </p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {status.deployed && status.url && (
            <a href={status.url} target="_blank" rel="noreferrer" className={`${BTN_CARD} ${TONE_OK}`}><ExternalLink size={12} /> Open</a>
          )}
          {!status.deployed && (
            <button type="button" onClick={on} disabled={!!busy || !status.ready} className={`${BTN_CARD} ${TONE_OK}`}>
              {busy === 'on' ? <Loader2 size={12} className="animate-spin" /> : <TerminalSquare size={12} />} Switch on
            </button>
          )}
          {status.deployed && (
            <button type="button" onClick={off} disabled={!!busy} className={`${BTN_CARD} ${TONE_DANGER}`}>
              {busy === 'off' ? <Loader2 size={12} className="animate-spin" /> : <Power size={12} />} Switch off
            </button>
          )}
        </div>
      </div>

      {!status.deployed && (
        <ul className="space-y-1" aria-label="What the web terminal needs">
          <Need ok={status.requirements.traefik_domain}>Traefik with a domain of your own (its route is the only way in)</Need>
          <Need ok={status.requirements.authelia}>Authelia (the sign-in in front of it; deploy its template first)</Need>
          <Need ok={status.requirements.ssh_keygen}>ssh-keygen on the server (the openssh client package)</Need>
        </ul>
      )}

      {status.deployed && (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1" aria-label="The terminal's colours">
            {swatches.map((c, i) => <span key={i} className="h-4 w-4 rounded-sm border border-white/10" style={{ backgroundColor: c }} />)}
          </div>
          <label className="text-xs text-slate-400 flex items-center gap-2">Text size
            <input type="number" min={10} max={28} value={size} onChange={(e) => setSize(Math.max(10, Math.min(28, Number(e.target.value) || 15)))}
              className="w-16 rounded-md bg-black/20 border border-white/10 px-2 py-1 text-xs text-slate-200" />
          </label>
          <button type="button" onClick={look} disabled={!!busy} className={BTN_CARD_QUIET}>
            {busy === 'look' ? <Loader2 size={12} className="animate-spin" /> : <Palette size={12} />} Match this dashboard's theme
          </button>
          {status.url && <code className="text-[11px] font-mono text-slate-400 truncate min-w-0">{status.url}</code>}
        </div>
      )}

      {status.deployed && status.embed_origins !== undefined && (
        <div className="rounded-lg border border-white/5 bg-white/[0.02] p-3 space-y-2">
          <p className="text-xs text-slate-300 flex items-center gap-2"><AppWindow size={12} className="accent-text" /> Show it inside another page</p>
          <p className="text-[11px] text-slate-500">
            A card on a Homarr board shows the terminal in a frame, and browsers only allow that for the pages named here. Authelia stays in front:
            the card shows the terminal to a browser that is signed in, and stays empty for one that is not (open the terminal once in a tab to sign in).
          </p>
          {embeds.length > 0 && (
            <ul className="space-y-1">
              {embeds.map((o) => (
                <li key={o} className="flex items-center gap-2 text-xs">
                  <code className="font-mono text-slate-300 truncate min-w-0 flex-1">{o}</code>
                  <button type="button" aria-label={`Stop ${o} showing the terminal`} disabled={!!busy} className={BTN_CARD_QUIET} onClick={() => void embed(embeds.filter((x) => x !== o))}><X size={12} /> Remove</button>
                </li>
              ))}
            </ul>
          )}
          <form className="flex items-center gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); addOrigin() }}>
            <input type="text" value={origin} onChange={(e) => setOrigin(e.target.value)} placeholder="https://dash.example.com" aria-label="The page that may show the terminal"
              className="flex-1 min-w-[14rem] rounded-md bg-black/20 border border-white/10 px-2 py-1 text-xs text-slate-200 font-mono" />
            <button type="submit" disabled={!!busy || !origin.trim() || embeds.length >= 4} className={`${BTN_CARD} ${TONE_OK}`}>
              {busy === 'embed' ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Allow this page
            </button>
          </form>
        </div>
      )}
    </div>
  )
}
