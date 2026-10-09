// =============================================================================
// The journeys' toolkit: a signed-in browser tab on the lab (tests/lab/lab.sh),
// the person's way around it (open a page, click a control by its name, type
// into a field by its label, wait for words) and a record of every control a
// journey tried, with its evidence (a DOM assertion or a screenshot).
//
// Every tab watches, for the whole journey:
//   console   errors and warnings, uncaught exceptions, failed requests
//   tokens    no request carries a session or token in its address
//   403s      a viewer's tab is never answered 403 (the page asked for or
//             offered an admin's thing)
//   requests  every API request with its time, for the polling budget
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
export const ROOT = path.resolve(HERE, '..', '..')
const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')

export const UI = process.env.UI || 'http://localhost:3021'
export const API = process.env.API || 'http://127.0.0.1:41921'
export const MEMBER_API = process.env.MEMBER_API || 'http://127.0.0.1:41922'
export const DEAD_API = process.env.DEAD_API || 'http://127.0.0.1:41929'
export const OUT = path.resolve(process.env.OUT || path.join(ROOT, 'docs', 'ui-polish', 'journeys'))
export const ADMIN = { user: process.env.LAB_USER || 'lab', pass: process.env.LAB_PASS || 'Lab-Only-Pass-123' }
export const VIEWER = { user: process.env.VIEWER_USER || 'viewer', pass: process.env.VIEWER_PASS || 'Viewer-Lab-Pass-123' }

export const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// console lines that are the environment's, not the dashboard's (the same list as tests/ui-sweep.mjs)
// (+ the Vite dev server's own hot-reload socket, which drops when the machine is loaded: not the dashboard's)
const IGNORE = [/net::ERR_NETWORK_CHANGED/, /\[vite\]/, /Download the React DevTools/, /WebSocket connection to .*\(\/@vite\/client\)/]

/** an address that carries a credential: a query parameter named like one, or a long opaque value under one */
const TOKEN_IN_URL = /[?&#](token|access_token|auth|authorization|session|sid|api_key|apikey|key|password|pass|jwt|bearer)=/i

// ----------------------------------------------------------------------------
// Results
// ----------------------------------------------------------------------------

export class Journey {
  constructor(name) {
    this.name = name
    this.controls = []
    this.notes = []
  }
  /** one control (or behaviour) tried: ok, and what shows it */
  check(control, ok, evidence = '') {
    this.controls.push({ control, ok: !!ok, evidence: String(evidence).slice(0, 400) })
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'} [${this.name}] ${control}${evidence && !ok ? ` — ${String(evidence).slice(0, 240)}` : ''}\n`)
    return !!ok
  }
  note(text) { this.notes.push(text) }
  get passed() { return this.controls.filter((c) => c.ok).length }
  get failed() { return this.controls.filter((c) => !c.ok) }
}

// ----------------------------------------------------------------------------
// The browser and a person's tab
// ----------------------------------------------------------------------------

let browserP = null
export function browser() {
  browserP ??= puppeteer.launch({
    executablePath: process.env.CHROME || '/usr/bin/google-chrome',
    headless: true,
    // journeys run side by side in one browser: no tab may be treated as a background tab (its polls would pause)
    args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-features=Translate', '--disable-background-timer-throttling', '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding'],
    protocolTimeout: 240000,
  })
  return browserP
}
export async function closeBrowser() { if (browserP) { const b = await browserP; browserP = null; await b.close() } }

/**
 * A tab signed in as `who` on `api` (or not signed in with signIn: false), in a browser context of its own.
 * opts: { api, theme: 'dark'|'light', width: 'desktop'|'phone', signIn: true, page: the page to land on, settings: {…} }
 */
export async function open(who, opts = {}) {
  const api = opts.api || API
  const b = await browser()
  const ctx = await b.createBrowserContext()
  const page = await ctx.newPage()
  page.setDefaultTimeout(45000)
  await page.setViewport(VIEWPORTS[opts.width || 'desktop'])
  // each tab behaves as the focused, visible one (the person's), whichever tab of the run was opened last
  const cdp = await page.createCDPSession()
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {})
  const t = new Tab(ctx, page, who, api, opts)
  // seed the settings on the dashboard's origin without starting the app (it would ask its default server first)
  await page.goto(`${UI}/favicon.svg`, { waitUntil: 'domcontentloaded' })
  await page.evaluate((p, user, keep) => {
    if (!keep) localStorage.clear()
    const s = JSON.parse(localStorage.getItem('app-settings') || '{}')
    Object.assign(s, p)
    localStorage.setItem('app-settings', JSON.stringify(s))
    localStorage.setItem('onboarding_complete', 'true')
    // a device that has made its choices (lib/userSync): the theme of the run, not one an earlier run saved for the person
    if (user) localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, { serverUrl: api, theme: opts.theme || 'dark', lastPage: opts.page || 'dashboard', sidebarCollapsed: false, ...(opts.settings || {}) }, who?.user || '', !!opts.keepStorage)
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  if (opts.signIn === false || !who) return t
  await t.signIn(who)
  return t
}

export class Tab {
  constructor(ctx, page, who, api, opts) {
    Object.assign(this, { ctx, page, who, api, opts })
    this.errors = []
    this.requests = []
    this.forbidden = []
    this.tokenUrls = []
    this.width = opts.width || 'desktop'
    page.on('console', (m) => {
      const type = m.type()
      if (type !== 'error' && type !== 'warn' && type !== 'warning') return
      const text = `${type}: ${m.text()}${m.location()?.url ? ` (${m.location().url.replace(UI, '')})` : ''}`
      if (IGNORE.some((re) => re.test(text))) return
      // a request the browser reports as failed is checked below, with its status, where it is known to be expected
      if (/Failed to load resource/.test(text)) return
      this.errors.push(text)
    })
    page.on('pageerror', (e) => this.errors.push(`uncaught: ${e.message}`))
    page.on('requestfailed', (r) => {
      const why = r.failure()?.errorText || ''
      if (why === 'net::ERR_ABORTED') return
      if (IGNORE.some((re) => re.test(why))) return
      if (this.expectFailures && this.expectFailures.test(r.url())) return
      this.errors.push(`request failed: ${r.method()} ${r.url()} — ${why}`)
    })
    page.on('request', (r) => {
      const url = r.url()
      if (TOKEN_IN_URL.test(url) && !url.startsWith(UI + '/src') && !url.startsWith(UI + '/node_modules')) this.tokenUrls.push(`${r.method()} ${url}`)
      if (!url.startsWith('http://127.0.0.1') && !url.startsWith('http://localhost:4')) return
      const u = new URL(url)
      if (r.method() === 'OPTIONS') return
      this.requests.push({ at: Date.now(), method: r.method(), origin: u.origin, path: u.pathname, search: u.search })
    })
    page.on('response', (r) => {
      const status = r.status()
      const u = r.url()
      if (status === 403 && !u.startsWith(UI)) this.forbidden.push(`${r.request().method()} ${new URL(u).pathname}`)
      if (status >= 500 && !u.startsWith(UI) && !(this.expectFailures && this.expectFailures.test(u))) this.errors.push(`HTTP ${status}: ${r.request().method()} ${u}`)
    })
  }

  async close() { await this.ctx.close().catch(() => {}) }

  async signIn(who = this.who, { expectMain = true } = {}) {
    const p = this.page
    await p.waitForSelector('main, #signin-username, input[placeholder="Enter password"]', { timeout: 60000 })
    if (await p.$('#signin-password, input[placeholder="Enter password"]')) {
      const user = await p.$('#signin-username') || await p.$('input[placeholder="Enter username"]')
      await user.click({ clickCount: 3 })
      await user.type(who.user)
      await p.type('#signin-password, input[placeholder="Enter password"]', who.pass)
      await p.keyboard.press('Enter')
    }
    if (expectMain) await p.waitForSelector('main', { timeout: 60000 })
  }

  // ---- reading the page --------------------------------------------------

  /** the text of the page (or of a selector) */
  text(sel = 'body') { return this.page.evaluate((s) => document.querySelector(s)?.innerText || '', sel) }

  /** wait until fn(arg) is truthy in the page; resolves to its value or false */
  async until(fn, arg, ms = 30000, step = 200) {
    const end = Date.now() + ms
    for (;;) {
      let v
      try { v = await this.page.evaluate(fn, arg) } catch { v = false }
      if (v) return v
      if (Date.now() > end) return false
      await sleep(step)
    }
  }

  /** wait for words (a string or a RegExp source) in the page or a selector */
  waitText(what, { within = 'body', ms = 30000 } = {}) {
    const spec = what instanceof RegExp ? { re: what.source, flags: what.flags } : { s: what }
    return this.until(({ spec, within }) => {
      const t = [...document.querySelectorAll(within)].map((e) => e.innerText || '').join('\n')
      return spec.re ? new RegExp(spec.re, spec.flags).test(t) : t.includes(spec.s)
    }, { spec, within }, ms)
  }

  async hasText(what, within = 'body') {
    const t = await this.text(within)
    return what instanceof RegExp ? what.test(t) : t.includes(what)
  }

  /** the page on screen, by its <h1> (PageHeader) and the store */
  currentPage() {
    return this.page.evaluate(() => JSON.parse(localStorage.getItem('app-settings') || '{}').lastPage)
  }
  h1() { return this.page.evaluate(() => document.querySelector('main h1')?.textContent?.trim() || '') }

  // ---- finding and pressing controls -------------------------------------

  /**
   * The visible controls named `name` (exact string, case-insensitive; or a RegExp) inside `within` (a selector; the
   * top dialog when one is open and within is 'auto'). kind: 'button' (buttons, role=button/menuitem/option/link, links),
   * 'tab', 'switch', 'any'.
   */
  async find(name, { within = 'auto', kind = 'any', index = 0 } = {}) {
    const spec = name instanceof RegExp ? { re: name.source, flags: name.flags } : { s: String(name) }
    const handle = await this.page.evaluateHandle(({ spec, within, kind, index }) => {
      const visible = (el) => {
        if (!el.getClientRects().length) return false
        const cs = getComputedStyle(el)
        return cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[aria-hidden="true"], [inert]')
      }
      const nameOf = (el) => (el.getAttribute('aria-label') || el.innerText || el.textContent || el.getAttribute('title') || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ')
      const matches = (n) => (spec.re ? new RegExp(spec.re, spec.flags).test(n) : n.toLowerCase() === spec.s.toLowerCase())
      let roots = [document.body]
      if (within === 'auto') {
        const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible)
        if (dialogs.length) roots = [dialogs[dialogs.length - 1]]
      } else roots = [...document.querySelectorAll(within)]
      const sel = {
        button: 'button, [role="button"], [role="menuitem"], [role="option"], a[href], [role="link"], summary',
        tab: '[role="tab"]',
        switch: '[role="switch"], input[type="checkbox"]',
        any: 'button, [role="button"], [role="menuitem"], [role="option"], a[href], [role="link"], [role="tab"], [role="switch"], [role="radio"], [role="checkbox"], summary, .mantine-SegmentedControl-label, label',
      }[kind]
      const found = []
      for (const r of roots) for (const el of r.querySelectorAll(sel)) if (visible(el) && matches(nameOf(el))) found.push(el)
      return found[index] || null
    }, { spec, within, kind, index })
    const el = handle.asElement()
    if (!el) { await handle.dispose(); return null }
    return el
  }

  /** wait for a control and press it; resolves false (never throws) when it is not there in `ms` */
  async click(name, opts = {}) {
    const end = Date.now() + (opts.ms ?? 15000)
    for (;;) {
      const el = await this.find(name, opts)
      if (el) {
        try {
          await el.evaluate((e) => e.scrollIntoView({ block: 'center', inline: 'nearest' }))
          if (opts.dom) await el.evaluate((e) => e.click())
          else await el.click()
          await el.dispose()
          return true
        } catch {
          await el.evaluate((e) => e.click()).catch(() => {})
          await el.dispose()
          return true
        }
      }
      if (Date.now() > end) return false
      await sleep(250)
    }
  }

  async exists(name, opts = {}) { const el = await this.find(name, opts); if (el) await el.dispose(); return !!el }

  /** a field by its label, aria-label, placeholder or id (CSS selector when it starts with # or [) */
  async field(label, within = 'auto') {
    if (/^[#[.]/.test(label)) return this.page.$(label)
    const h = await this.page.evaluateHandle(({ label, within }) => {
      const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[inert]')
      let root = document.body
      if (within === 'auto') {
        const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter(visible)
        if (d.length) root = d[d.length - 1]
      } else root = document.querySelector(within) || document.body
      const want = label.toLowerCase()
      const fields = [...root.querySelectorAll('input, textarea, select, [contenteditable="true"]')].filter(visible)
      const nameOf = (el) => {
        const n = []
        if (el.getAttribute('aria-label')) n.push(el.getAttribute('aria-label'))
        for (const l of el.labels || []) n.push(l.textContent)
        const lb = el.getAttribute('aria-labelledby'); if (lb) n.push(lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '))
        if (el.getAttribute('placeholder')) n.push(el.getAttribute('placeholder'))
        if (el.getAttribute('name')) n.push(el.getAttribute('name'))
        if (el.id) n.push(el.id)
        // a label right before it, in the same wrapper (a <label> without for=)
        const prev = el.parentElement?.querySelector('label'); if (prev && !prev.htmlFor) n.push(prev.textContent)
        return n.map((x) => (x || '').trim().toLowerCase())
      }
      return fields.find((f) => nameOf(f).some((n) => n === want)) || fields.find((f) => nameOf(f).some((n) => n.startsWith(want) || n.includes(want))) || null
    }, { label, within })
    const el = h.asElement()
    if (!el) { await h.dispose(); return null }
    return el
  }

  /** clear a field and type into it */
  async type(label, value, within = 'auto') {
    const el = await this.field(label, within)
    if (!el) return false
    await el.evaluate((e) => e.scrollIntoView({ block: 'center' }))
    await el.click({ clickCount: 3 })
    await this.page.keyboard.down('Control'); await this.page.keyboard.press('A'); await this.page.keyboard.up('Control')
    await this.page.keyboard.press('Backspace')
    if (value) await el.type(String(value), { delay: 4 })
    await el.dispose()
    return true
  }

  async value(label, within = 'auto') {
    const el = await this.field(label, within)
    if (!el) return null
    const v = await el.evaluate((e) => ('value' in e ? e.value : e.textContent))
    await el.dispose()
    return v
  }

  key(k) { return this.page.keyboard.press(k) }
  async chord(...keys) {
    for (const k of keys.slice(0, -1)) await this.page.keyboard.down(k)
    await this.page.keyboard.press(keys[keys.length - 1])
    for (const k of keys.slice(0, -1).reverse()) await this.page.keyboard.up(k)
  }

  // ---- dialogs, sheets, toasts --------------------------------------------

  /** the open dialogs (sheets, confirmations, overlays): their titles */
  dialogs() {
    return this.page.evaluate(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')]
      .filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
      .map((e) => {
        const lb = e.getAttribute('aria-labelledby')
        const title = (e.getAttribute('aria-label') || (lb && document.getElementById(lb)?.textContent) || e.querySelector('h1, h2, h3')?.textContent || '').trim()
        return { role: e.getAttribute('role'), title, text: (e.innerText || '').slice(0, 600) }
      }))
  }
  async dialogTitle() { const d = await this.dialogs(); return d.length ? d[d.length - 1].title : null }
  waitDialog(title, ms = 15000) {
    const spec = title instanceof RegExp ? { re: title.source, flags: title.flags } : title ? { s: title } : null
    return this.until((spec) => {
      const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
      if (!d.length) return false
      const e = d[d.length - 1]
      const lb = e.getAttribute('aria-labelledby')
      const t = (e.getAttribute('aria-label') || (lb && document.getElementById(lb)?.textContent) || e.querySelector('h1, h2, h3')?.textContent || '').trim()
      if (!spec) return t || true
      return (spec.re ? new RegExp(spec.re, spec.flags).test(t) : t.includes(spec.s)) ? t : false
    }, spec, ms)
  }
  waitNoDialog(ms = 10000) {
    return this.until(() => ![...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]')), null, ms)
  }
  /** the confirmation on screen: { title, message, confirm, danger } */
  confirmInfo() {
    return this.page.evaluate(() => {
      const d = document.querySelector('[role="alertdialog"]')
      if (!d) return null
      const btns = [...d.querySelectorAll('button')]
      return {
        title: d.querySelector('#confirm-dialog-title')?.textContent?.trim() || d.querySelector('h1, h2, h3')?.textContent?.trim() || '',
        message: d.querySelector('#confirm-dialog-message')?.textContent?.trim() || '',
        buttons: btns.map((b) => b.textContent.trim()),
        danger: /rose/.test(d.className),
        focused: document.activeElement?.textContent?.trim() || '',
      }
    })
  }

  /** the toasts on screen (their text) */
  toasts() {
    return this.page.evaluate(() => [...document.querySelectorAll('[data-toast-region] [data-toast]')].map((t) => (t.innerText || '').trim()))
  }
  waitToast(what, ms = 30000) {
    const spec = what instanceof RegExp ? { re: what.source, flags: what.flags } : { s: what || '' }
    return this.until((spec) => {
      const all = [...document.querySelectorAll('[data-toast-region] [data-toast]')].map((t) => (t.innerText || '').trim())
      const hit = all.find((t) => (spec.re ? new RegExp(spec.re, spec.flags).test(t) : t.includes(spec.s)))
      return hit || false
    }, spec, ms)
  }

  // ---- navigation ---------------------------------------------------------

  /** open a page the way a link does (#/page) and wait for its heading */
  async go(pageId, { ms = 45000 } = {}) {
    await this.page.evaluate((p) => { window.location.hash = `#/${p}` }, pageId)
    const ok = await this.until(() => !window.location.hash && !!document.querySelector('main h1'), null, ms)
    await this.settle()
    return !!ok
  }

  /** the network of the app goes quiet for a moment and the first-load spinners are gone */
  async settle(extra = 300) {
    try { await this.page.waitForNetworkIdle({ idleTime: 500, timeout: 6000 }) } catch { /* polls never go fully idle */ }
    await this.until(() => ![...document.querySelectorAll('main .animate-spin, main [aria-busy="true"]')].some((e) => e.getClientRects().length), null, 12000, 250)
    await sleep(extra)
  }

  async reload() {
    await this.page.reload({ waitUntil: 'domcontentloaded' })
    await this.page.waitForSelector('main', { timeout: 60000 })
    await this.settle()
  }

  async shot(name) {
    fs.mkdirSync(path.join(OUT, 'shots'), { recursive: true })
    const f = path.join(OUT, 'shots', `${name.replace(/[^a-z0-9._-]+/gi, '-')}.webp`)
    await this.page.screenshot({ path: f, type: 'webp', quality: 60 }).catch(() => {})
    return path.relative(ROOT, f)
  }

  /** the page is no wider than the window (a phone must never scroll sideways) */
  overflow() {
    return this.page.evaluate(() => {
      const main = document.querySelector('main')
      const over = Math.max(document.documentElement.scrollWidth - window.innerWidth, main ? main.scrollWidth - main.clientWidth : 0)
      if (over <= 1) return 0
      const wide = [...document.querySelectorAll('main *')].filter((e) => e.getClientRects().length && e.getBoundingClientRect().right > window.innerWidth + 1 && !e.closest('.overflow-x-auto, .overflow-auto, .overflow-x-scroll, [data-sweep-scroll]'))
        .slice(0, 3).map((e) => `<${e.tagName.toLowerCase()} class="${(e.getAttribute('class') || '').slice(0, 60)}">`)
      return `${over}px ${wide.join(' ')}`
    })
  }

  /** the console errors since `from` (an index into this.errors) */
  errorsSince(from = 0) { return this.errors.slice(from) }
}

// ----------------------------------------------------------------------------
// Lab helpers (the lab's own API, outside the dashboard)
// ----------------------------------------------------------------------------

export async function apiAs(who, api = API) {
  const r = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: who.user, password: who.pass }) })
  const j = await r.json()
  const tok = j.token
  const call = async (method, p, body) => {
    const res = await fetch(`${api}${p}`, { method, headers: { Authorization: `Bearer ${tok}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
    let data = null
    try { data = await res.json() } catch { /* not JSON */ }
    return { status: res.status, data }
  }
  return { token: tok, get: (p) => call('GET', p), post: (p, b) => call('POST', p, b ?? {}), put: (p, b) => call('PUT', p, b ?? {}), del: (p) => call('DELETE', p), logout: () => call('POST', '/auth/logout') }
}

/** the pages of the sidebar (navSections order) and the ones a viewer may not open (shared/types ADMIN_ONLY_PAGES) */
export const PAGES = [
  'dashboard', 'stacks', 'templates', 'environment', 'proxmox', 'topology', 'containers', 'images', 'volumes', 'networks',
  'disk-analysis', 'health', 'trends', 'diagnostics', 'activity', 'logs', 'crowdsec', 'dns', 'secrets', 'users', 'updates',
  'backup', 'export', 'maintenance', 'automations', 'terminal', 'file-browser', 'bookmarks', 'plugins', 'settings',
  'notifications', 'config', 'system',
]
export const ADMIN_ONLY = new Set(['secrets', 'file-browser', 'plugins', 'terminal', 'environment', 'config', 'maintenance', 'backup', 'cronjobs', 'users', 'snapshots', 'export', 'dns'])
export const ALIASES = { uptime: 'health', 'event-feed': 'activity', schedules: 'automations', cronjobs: 'automations', snapshots: 'backup' }
