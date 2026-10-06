#!/usr/bin/env node
// =============================================================================
// ui-sweep — every page of the dashboard, in both themes and at two widths
// (1440 × 900 and a 390 × 844 phone), signed in to a lab API, with the checks a
// person would otherwise do by eye:
//
//   console   no console error or warning, no uncaught exception (IGNORE lists
//             the few that are the environment's, each with its reason)
//   overflow  no horizontal scroll of the page at 390 px
//   text      no visible "undefined", "NaN" or "[object Object]"; no empty
//             heading, paragraph, label, list item or pill
//   names     every visible button, link, tab, switch and radio has an
//             accessible name
//   focus     every focusable element shows a change when focused by keyboard
//             (outline, ring, border or background — its own or its wrapper's)
//   clicks    the safe controls (tabs, filters, view switches, refresh, the
//             sheets that only open) are clicked; the page still renders, the
//             console stays clean, a sheet that opened closes again. Anything
//             that stops, deletes, restarts, resets, updates … is never clicked.
//
// The sign-in page (nobody signed in) and, with WIZARD_API, the setup wizard's first screen get the same
// checks but no clicks. One screenshot per page, theme and width lands in docs/ui-polish/sweep/.
//
// Run it against the lab (tests/lab/lab.sh start), never against a real server:
//   npm i --no-save --prefix /tmp/dcs-ui-sweep puppeteer-core@24
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/ui-sweep.mjs
// Env: UI (http://localhost:3021), API (http://127.0.0.1:41921), WIZARD_API (a
// fresh, not yet set up API for the setup wizard; optional), LAB_USER, LAB_PASS,
// CHROME (/usr/bin/google-chrome), PAGES / THEMES / VIEWPORTS (comma lists to
// narrow a run), CLICKS=0 (skip the clicks), OUT (the screenshot folder).
// Exit status: 0 when every check of every run passed.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')

const UI = process.env.UI || 'http://localhost:3021'
const API = process.env.API || 'http://127.0.0.1:41921'
const WIZARD_API = process.env.WIZARD_API || ''
const USER = process.env.LAB_USER || 'lab'
const PASS = process.env.LAB_PASS || 'Lab-Only-Pass-123'
const OUT = path.resolve(ROOT, process.env.OUT || 'docs/ui-polish/sweep')
const CLICKS = process.env.CLICKS !== '0'

const ALL_PAGES = [
  'dashboard', 'stacks', 'containers', 'images', 'health', 'uptime', 'networks', 'volumes', 'logs', 'system', 'diagnostics',
  'config', 'settings', 'bookmarks', 'activity', 'users', 'maintenance', 'environment', 'backup', 'terminal', 'cronjobs',
  'trends', 'updates', 'notifications', 'snapshots', 'templates', 'automations', 'topology', 'file-browser', 'disk-analysis',
  'secrets', 'schedules', 'plugins', 'event-feed', 'export', 'dns', 'proxmox', 'crowdsec',
]
const list = (v, all) => (v ? v.split(',').map((s) => s.trim()).filter(Boolean) : all)
const PAGES = list(process.env.PAGES, ALL_PAGES)
const THEMES = list(process.env.THEMES, ['dark', 'light'])
const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1 },
  phone: { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true },
}
const WIDTHS = list(process.env.VIEWPORTS, Object.keys(VIEWPORTS))

// console messages that are the environment's, not the dashboard's
const IGNORE = [
  { re: /net::ERR_NETWORK_CHANGED/, why: 'the host switched networks during a request (a laptop or VPN hop) — no request of the app failed on its own' },
  { re: /\[vite\]/, why: 'the Vite dev server talking about hot reload' },
  { re: /Download the React DevTools/, why: 'React\'s development-build hint' },
]

// a control whose name matches this is never clicked, whatever else it matches
const DESTRUCTIVE = /\b(stop|delete|remove|restart|reboot|reset|nuke|wipe|destroy|kill|prune|uninstall|unban|ban|update|upgrade|deploy|install|apply|save|pull|recreate|start|suspend|resume|shut|forget|leave|revoke|disable|enable|import|upload|restore|rollback|clear|purge|log ?out|sign ?out|lock|run|execute|send|test|rename|create|build|bake|generate|rotate|reveal|download|export|approve|accept|confirm|submit|join|retry|reconnect|rescan|scan|check|sync|push|commit|discard|revert|trigger|mark|dismiss|snooze|mute|pause)\b/i
// the generic safe ones: switching views and filters, refreshing, showing more
const SAFE = /^(refresh|reload|cards|table|grid|list|compact|comfortable|details|info|overview|show (more|less|all|details)|expand|collapse|more|less|filters?|all|running|stopped|paused|exited|created|healthy|unhealthy|errors?|warnings?|critical|today|1h|6h|12h|24h|7d|30d|90d|week|month|year|hub|everywhere|vms?|lxc|dcs|gauges|trending)\b/i
// per page, the controls read as safe by hand: tabs and filters without a tab role, sort headers, guides, and the
// sheets and forms that only open (their own submit is never clicked). A string is an exact name, a RegExp a pattern.
const OPENERS = {
  dashboard: ['CPU', 'MEM'],
  stacks: ['New stack', 'Priority', 'Name', 'Status', 'Containers'],
  containers: ['Batch Select'],
  images: ['Batch mode', 'Image Library', 'Docker Hub Search', /^(All|Current|Aging|Stale)\d+$/],
  health: ['OK', 'Bad', 'Off', 'On demand'],
  networks: ['New network', /^Name\b/, 'Driver', 'Containers', /^Inspect /],
  volumes: ['Batch select', 'Name', 'Size'],
  logs: ['Log statistics', 'Auto-scroll'],
  settings: ['User Profile', 'Server Connection', 'Appearance', 'Application Preferences', 'Keyboard Shortcuts', 'Disk Configuration', 'Notification Preferences', 'Alert Thresholds'],
  activity: ['Auto-scroll'],
  bookmarks: ['Add bookmark'],
  maintenance: ['Guide'],
  environment: ['Root .env', 'Stack .env', 'Editor'],
  backup: ['Guide'],
  cronjobs: ['Add Entry', 'Raw Editor', 'Guide', 'User Crontab', 'System Cron'],
  trends: ['Alerts', 'Auto'],
  notifications: ['Guide', 'Add Rule', /^NOTIFICATION HISTORY/, /^WEBHOOKS/, 'Add Webhook'],
  snapshots: ['Guide'],
  templates: ['My Templates', 'Gallery', 'File', 'History', /^(Media|Monitoring|Web|Databases|Development|Tools|Productivity|Automation|Security|Network|Storage|Entertainment) \d+$/],
  automations: ['New rule', 'Guide', /^Timed \d+$/, /^When something happens \d+$/],
  topology: ['Zoom in', 'Zoom out', 'Fit to view'],
  secrets: ['Usage Guide', 'Add Secret', 'Where is this secret used?'],
  schedules: ['New rule'],
  plugins: ['Plugin details', 'Card Studio'],
  'event-feed': ['Auto-scroll'],
  export: ['SELECT ALL'],
  dns: [/^Routes \(\d+\)$/, 'DNS records'],
  proxmox: ['New VM stack', 'Link VMs', 'Join code', 'Add member', 'media-vm', 'networking-security', 'dns', 'Manage media-vm', /^\d+ containers · \d+ running$/, 'Link…'],
}
// the ones among them that switch something on that a later run would inherit: clicked a second time
const TWICE = /^(Batch Select|Batch select|Batch Mode|Guide|Usage Guide|Live|Auto|User Profile|Server Connection|Appearance|Application Preferences|Keyboard Shortcuts|Disk Configuration|Notification Preferences|Alert Thresholds|NOTIFICATION HISTORY.*|WEBHOOKS.*|\d+ containers · \d+ running)$/i
const MAX_CLICKS = 24

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const ignored = (text) => IGNORE.some((i) => i.re.test(text))

async function settle(page, extra = 500) {
  try { await page.waitForNetworkIdle({ idleTime: 500, timeout: 4500 }) } catch { /* polling pages never go fully idle */ }
  // spinners of a first load
  for (let i = 0; i < 14; i++) {
    const busy = await page.evaluate(() => [...document.querySelectorAll('main .animate-spin')].filter((e) => e.getClientRects().length).length)
    if (!busy) break
    await sleep(250)
  }
  await sleep(extra)
}

async function setSettings(page, patch) {
  await page.evaluate((p, user) => {
    const s = JSON.parse(localStorage.getItem('app-settings') || '{}')
    Object.assign(s, p)
    localStorage.setItem('app-settings', JSON.stringify(s))
    localStorage.setItem('onboarding_complete', 'true')
    // a device that has made its choices: since 4.0.1 a device that has not changed anything takes the person's stored choices at sign-in
    // (lib/userSync), and every fresh browser of a sweep would otherwise take the theme an earlier run of it saved
    localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, patch, USER)
}

async function signIn(page, api) {
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await setSettings(page, { serverUrl: api, theme: 'dark', lastPage: 'dashboard' })
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main, input[placeholder="Enter password"]', { timeout: 30000 })
  if (await page.$('input[placeholder="Enter password"]')) {
    await page.type('input[placeholder="Enter username"]', USER)
    await page.type('input[placeholder="Enter password"]', PASS)
    await page.keyboard.press('Enter')
    await page.waitForSelector('main', { timeout: 30000 })
  }
}

// ----------------------------------------------------------------------------
// The checks that run inside the page
// ----------------------------------------------------------------------------

function inPageChecks() {
  const visible = (el) => {
    if (!el.getClientRects().length) return false
    const cs = getComputedStyle(el)
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false
    return !el.closest('[aria-hidden="true"], [hidden]')
  }
  const describe = (el) => {
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 4).join('.')
    return `<${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${cls ? `.${cls}` : ''}>${t ? ` "${t}"` : ''}`
  }
  const accName = (el) => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
    const lb = el.getAttribute('aria-labelledby')
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t }
    const txt = (el.innerText || el.textContent || '').trim(); if (txt) return txt
    if (el.id) { const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`); if (l && l.textContent.trim()) return l.textContent.trim() }
    const wrap = el.closest('label'); if (wrap && wrap.textContent.trim()) return wrap.textContent.trim()
    const title = el.getAttribute('title'); if (title && title.trim()) return title.trim()
    const img = el.querySelector('img[alt]'); if (img && img.getAttribute('alt').trim()) return img.getAttribute('alt').trim()
    const st = el.querySelector('svg title'); if (st && st.textContent.trim()) return st.textContent.trim()
    return ''
  }
  const out = { overflow: null, badText: [], empty: [], unnamed: [] }

  // overflow: the page (or its scrolling main) wider than the window
  const main = document.querySelector('main')
  const docW = document.documentElement.scrollWidth, winW = window.innerWidth
  const mainOver = main ? main.scrollWidth - main.clientWidth : 0
  if (docW > winW + 1 || mainOver > 1) {
    // name the widest culprits
    const wide = [...document.querySelectorAll('main *')].filter((e) => visible(e) && e.getBoundingClientRect().right > winW + 1 && !e.closest('.overflow-x-auto, .overflow-auto, .overflow-x-scroll, [data-sweep-scroll]'))
      .sort((a, b) => b.getBoundingClientRect().right - a.getBoundingClientRect().right).slice(0, 3).map((e) => `${describe(e)} ends at ${Math.round(e.getBoundingClientRect().right)} px`)
    out.overflow = { document: docW, window: winW, main: mainOver, culprits: wide }
  }

  // text that leaked a JavaScript value
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement
    if (!el || el.closest('pre, code, textarea, script, style, [data-sweep-ignore]')) continue
    if (/\bundefined\b|\bNaN\b|\[object Object\]/.test(n.textContent) && visible(el)) out.badText.push(`${describe(el)}: "${n.textContent.trim().slice(0, 80)}"`)
  }

  // text containers with nothing in them
  for (const el of document.querySelectorAll('h1, h2, h3, h4, h5, h6, p, li, dt, dd, label, summary, legend, caption, figcaption, th, .mantine-Badge-root')) {
    if (!visible(el) || el.closest('[data-sweep-ignore]')) continue
    if ((el.textContent || '').trim()) continue
    if (el.querySelector('img, svg, canvas, input, select, textarea, button, video, iframe') || el.getAttribute('aria-label')) continue
    const r = el.getBoundingClientRect()
    if (r.width < 2 || r.height < 2) continue
    out.empty.push(describe(el))
  }

  // controls without a name
  for (const el of document.querySelectorAll('button, a[href], [role="button"], [role="link"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"], [role="menuitem"], input[type="checkbox"], input[type="radio"]')) {
    const target = (el.tagName === 'INPUT' && !visible(el)) ? (document.querySelector(`label[for="${CSS.escape(el.id || '_')}"]`) || el.parentElement) : el
    if (!target || !visible(target)) continue
    if (!accName(el)) out.unnamed.push(describe(el))
  }
  // form fields without a name: a label (for= or around it), aria-label(ledby), a title, or — as browsers do,
  // though it is the weakest — a placeholder. A select's option text is not its name.
  const fieldName = (el) => {
    const al = el.getAttribute('aria-label'); if (al && al.trim()) return al.trim()
    const lb = el.getAttribute('aria-labelledby')
    if (lb) { const t = lb.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim(); if (t) return t }
    for (const l of el.labels || []) if (l.textContent.trim()) return l.textContent.trim()
    const title = el.getAttribute('title'); if (title && title.trim()) return title.trim()
    const ph = el.getAttribute('placeholder'); if (ph && ph.trim()) return ph.trim()
    return ''
  }
  for (const el of document.querySelectorAll('select, textarea, input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])')) {
    if (!visible(el) || el.closest('[data-sweep-ignore]')) continue
    if (!fieldName(el)) out.unnamed.push(`field ${describe(el)}`)
  }
  return out
}

// every focusable element must change when it gets keyboard focus (its own box or a wrapper's)
function focusCheck() {
  const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert]')
  const sig = (el) => {
    if (!el) return ''
    const cs = getComputedStyle(el)
    return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderTopColor, cs.borderBottomColor, cs.backgroundColor, cs.color, cs.textDecorationLine].join('|')
  }
  const describe = (el) => {
    const t = (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ').slice(0, 40)
    const cls = (el.getAttribute('class') || '').split(/\s+/).slice(0, 4).join('.')
    return `<${el.tagName.toLowerCase()}${cls ? `.${cls}` : ''}>${t ? ` "${t}"` : ''}`
  }
  const failures = []
  let checked = 0
  const els = [...document.querySelectorAll('a[href], button:not(:disabled), input:not([type="hidden"]):not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])')]
  for (const el of els) {
    // a visually hidden input (a Mantine switch or radio) shows its focus on the label or track beside it
    const hidden = el.tagName === 'INPUT' && (Number(getComputedStyle(el).opacity) === 0 || el.getBoundingClientRect().width < 2)
    const shown = hidden ? (document.querySelector(`label[for="${CSS.escape(el.id || '_')}"]`) || el.nextElementSibling || el.parentElement) : el
    if (!shown || !visible(shown)) continue
    const watch = [shown, shown.parentElement, shown.parentElement?.parentElement, el.nextElementSibling].filter(Boolean)
    const before = watch.map(sig)
    try { el.focus({ focusVisible: true, preventScroll: true }) } catch { el.focus() }
    if (document.activeElement !== el) continue
    checked++
    const after = watch.map(sig)
    if (before.every((b, i) => b === after[i])) failures.push(describe(el))
    el.blur()
  }
  return { checked, failures }
}

// ----------------------------------------------------------------------------
// Clicks
// ----------------------------------------------------------------------------

async function safeTargets(page, pageId) {
  const openerSpec = (OPENERS[pageId] ?? []).map((o) => (o instanceof RegExp ? { re: o.source } : { exact: o }))
  return page.evaluate((spec, safeSrc, destructiveSrc) => {
    const SAFE = new RegExp(safeSrc, 'i'), DESTRUCTIVE = new RegExp(destructiveSrc, 'i')
    const openers = { includes: (n) => spec.some((s) => (s.exact !== undefined ? s.exact.toLowerCase() === n.toLowerCase() : new RegExp(s.re).test(n))) }
    const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"]')
    const name = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ')
    const found = []
    const seen = new Set()
    const add = (kind, el, n) => { const key = `${kind}:${n}`; if (!seen.has(key)) { seen.add(key); found.push({ kind, name: n }) } }
    const root = document.querySelector('main') || document.body
    for (const el of root.querySelectorAll('[role="tab"]')) if (visible(el) && name(el) && !DESTRUCTIVE.test(name(el))) add('tab', el, name(el))
    for (const el of root.querySelectorAll('.mantine-SegmentedControl-label')) if (visible(el) && name(el)) add('segment', el, name(el))
    const skipped = []
    for (const el of root.querySelectorAll('button, [role="button"]')) {
      if (!visible(el) || el.disabled) continue
      const n = name(el)
      if (!n) continue
      if (openers.includes(n)) add('opener', el, n)
      else if (SAFE.test(n) && !DESTRUCTIVE.test(n)) add('button', el, n)
      else skipped.push(`${DESTRUCTIVE.test(n) ? '!' : '?'}${n.slice(0, 40)}`)
    }
    // what is chosen now (a segment, a pressed chip): clicked again at the end, so the next run starts the same
    const chosen = [
      ...[...root.querySelectorAll('.mantine-SegmentedControl-label[data-active]')].filter(visible).map((el) => ({ kind: 'segment', name: name(el) })),
      ...[...root.querySelectorAll('button[aria-pressed="true"]')].filter(visible).map((el) => ({ kind: 'button', name: name(el) })),
    ].filter((c) => c.name)
    return { found, chosen, skipped: [...new Set(skipped)] }
  }, openerSpec, SAFE.source, DESTRUCTIVE.source)
}

async function clickByName(page, t) {
  return page.evaluate(({ kind, name }) => {
    const nameOf = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ')
    const root = document.querySelector('main') || document.body
    const sel = kind === 'tab' ? '[role="tab"]' : kind === 'segment' ? '.mantine-SegmentedControl-label' : 'button, [role="button"]'
    const el = [...root.querySelectorAll(sel)].find((e) => e.getClientRects().length && nameOf(e) === name)
    if (!el) return false
    el.scrollIntoView({ block: 'center' })
    el.click()
    return true
  }, t)
}

// an open overlay: a dialog, or a full-screen layer that is shown and takes the pointer (a closed drawer's
// backdrop stays in the page, transparent and click-through)
function openOverlays() {
  return [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .fixed.inset-0')].filter((e) => {
    if (!e.getClientRects().length || e.closest('main')) return false
    const cs = getComputedStyle(e)
    return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.05
  }).length
}

async function closeOverlays(page) {
  for (let i = 0; i < 3; i++) {
    const open = await page.evaluate(openOverlays)
    if (!open) return true
    await page.keyboard.press('Escape')
    await sleep(250)
    const closed = await page.evaluate(() => {
      const dialogs = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], .fixed.inset-0')].filter((e) => {
        if (!e.getClientRects().length || e.closest('main')) return false
        const cs = getComputedStyle(e)
        return cs.visibility !== 'hidden' && cs.pointerEvents !== 'none' && Number(cs.opacity) > 0.05
      })
      if (!dialogs.length) return true
      const top = dialogs[dialogs.length - 1]
      const btn = [...top.querySelectorAll('button')].find((b) => /^(close|cancel|done|back)$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()))
      if (btn) { btn.click(); return false }
      top.click()   // a backdrop closes its sheet
      return false
    })
    if (closed) return true
    await sleep(300)
  }
  return false
}

// ----------------------------------------------------------------------------
// One page at one width and theme
// ----------------------------------------------------------------------------

async function sweepOne(page, messages, pageId, theme, width) {
  const res = { page: pageId, theme, width, checks: 0, failures: [], clicks: [], shot: '' }
  const fail = (check, detail) => res.failures.push({ check, detail })
  messages.length = 0
  await setSettings(page, { serverUrl: API, theme, lastPage: pageId, ...(width === 'phone' ? {} : { sidebarCollapsed: false }) })
  // what a page that did not render shows instead: its text, what the console said, the requests still open
  const stall = async () => {
    const seen = await page.evaluate(() => (document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160)).catch(() => '')
    const said = messages.filter((m) => m.level !== 'info').slice(0, 3).map((m) => m.text).join(' | ')
    const open = [...(page.inflight || new Map()).entries()].filter(([, t]) => Date.now() - t > 5000)
      .map(([r]) => r.url().replace(UI, '').replace(API, 'API')).slice(0, 4).join(', ')
    return `the page shows "${seen}"${said ? `; console: ${said}` : ''}${open ? `; still waiting on ${open}` : ''}`
  }
  const load = async () => {
    await page.reload({ waitUntil: 'domcontentloaded' })
    return page.waitForSelector('main', { timeout: 30000 }).then(() => true, () => false)
  }
  if (!(await load())) {
    // a first load that stays blank gets one more try — and is reported (res.retried), never hidden
    res.retried = await stall()
    if (!(await load())) {
      res.shot = path.join(OUT, `${pageId}-${theme}-${width}-failed.webp`)
      await page.screenshot({ path: res.shot, type: 'webp', quality: 62 }).catch(() => {})
      fail('render', `no <main> within 30 s, twice; ${await stall()}`)
      return res
    }
  }
  await settle(page)
  const current = await page.evaluate(() => document.title)
  res.title = current

  // the screenshot, before anything is focused or clicked
  res.shot = path.join(OUT, `${pageId}-${theme}-${width}.webp`)
  await page.screenshot({ path: res.shot, type: 'webp', quality: 62 })

  const c = await page.evaluate(inPageChecks)
  res.checks += 4
  if (width === 'phone' && c.overflow) fail('overflow', `page ${c.overflow.document} px / main +${c.overflow.main} px wide at ${c.overflow.window} px${c.overflow.culprits.length ? ` — ${c.overflow.culprits.join('; ')}` : ''}`)
  for (const t of c.badText) fail('text', t)
  for (const e of c.empty) fail('empty', e)
  for (const u of c.unnamed) fail('names', u)

  // keyboard focus: mark the last interaction as a key so :focus-visible applies
  await page.keyboard.press('Shift')
  const f = await page.evaluate(focusCheck)
  res.checks += 1
  res.focusChecked = f.checked
  for (const x of f.failures) fail('focus', x)
  await page.evaluate(() => { document.activeElement?.blur?.(); document.querySelector('main')?.scrollTo(0, 0) })

  if (CLICKS) {
    const { found, chosen, skipped } = await safeTargets(page, pageId)
    res.skipped = skipped   // the report lists what was not clicked: ! = destructive, ? = not known to be safe
    const known = new Set([...c.unnamed, ...c.badText, ...c.empty])
    for (const t of found.slice(0, MAX_CLICKS)) {
      const before = messages.length
      const ok = await clickByName(page, t)
      if (!ok) continue
      await sleep(650)
      const alive = await page.evaluate(() => (document.querySelector('main')?.innerText || '').trim().length > 0)
      const errs = messages.slice(before).filter((m) => m.level !== 'info' && !m.seen)
      // what the click opened (a sheet, a panel, a tab) gets the same text and name checks as the page
      if (await page.evaluate(openOverlays) || t.kind === 'tab' || t.kind === 'opener') {
        const again = await page.evaluate(inPageChecks)
        res.checks += 1
        for (const x of again.unnamed) if (!known.has(x)) { known.add(x); fail('names', `${x} (after ${t.kind} "${t.name}")`) }
        for (const x of again.badText) if (!known.has(x)) { known.add(x); fail('text', `${x} (after ${t.kind} "${t.name}")`) }
        for (const x of again.empty) if (!known.has(x)) { known.add(x); fail('empty', `${x} (after ${t.kind} "${t.name}")`) }
        if (width === 'phone' && again.overflow && !c.overflow) fail('overflow', `after ${t.kind} "${t.name}": ${again.overflow.culprits.join('; ')}`)
      }
      const closed = await closeOverlays(page)
      if (TWICE.test(t.name)) { await clickByName(page, t); await sleep(400); await closeOverlays(page) }
      res.checks += 1
      res.clicks.push(`${t.kind}: ${t.name}`)
      if (!alive) fail('click', `${t.kind} "${t.name}" left the page empty`)
      if (!closed) fail('click', `${t.kind} "${t.name}" opened something that does not close (Escape, Close/Cancel, backdrop)`)
      for (const e of errs) { e.seen = true; fail('click', `${t.kind} "${t.name}" → ${e.text}`) }
      await sleep(150)
    }
    // the choices the page started with (a remembered view, a fleet scope) — the next run begins the same way
    for (const c of chosen) { await clickByName(page, c); await sleep(300) }
    await closeOverlays(page)
  }

  res.checks += 1
  for (const m of messages) if (m.level !== 'info' && !m.seen) fail('console', m.text)
  return res
}

// one width and one theme, in a browser context of its own (its own storage and sign-in). The contexts sign in
// one after the other (the API writes its session list per request: simultaneous sign-ins can lose one), then
// the four run side by side.
async function prepareCombo(browser, width, theme) {
  const ctx = await browser.createBrowserContext()
  const page = await ctx.newPage()
  await page.setViewport(VIEWPORTS[width])
  const messages = []
  page.on('console', (m) => {
    const type = m.type()
    if (type !== 'error' && type !== 'warn' && type !== 'warning') return
    const loc = m.location()?.url ? ` (${m.location().url.replace(UI, '').replace(API, 'API')})` : ''
    const text = `${type}: ${m.text()}${loc}`
    messages.push({ level: ignored(text) ? 'info' : type, text })
  })
  page.on('pageerror', (e) => messages.push({ level: 'error', text: `uncaught: ${e.message}` }))
  page.on('requestfailed', (r) => {
    const why = r.failure()?.errorText || ''
    if (why === 'net::ERR_ABORTED') return   // a request the app cancelled itself (a page left, a poll replaced)
    const text = `request failed: ${r.method()} ${r.url().replace(API, 'API')} — ${why}`
    messages.push({ level: ignored(text) ? 'info' : 'error', text })
  })
  // the requests still open, for a page that does not render (sweepOne names the ones older than 5 s)
  page.inflight = new Map()
  page.on('request', (r) => page.inflight.set(r, Date.now()))
  page.on('requestfinished', (r) => page.inflight.delete(r))
  page.on('requestfailed', (r) => page.inflight.delete(r))
  await signIn(page, API)
  return { ctx, page, messages, width, theme }
}

async function runCombo({ ctx, page, messages, width, theme }, results) {
  for (const p of PAGES.filter((x) => x !== 'login' && x !== 'setup')) {
    const t0 = Date.now()
    let r
    try { r = await sweepOne(page, messages, p, theme, width) } catch (e) { r = { page: p, theme, width, checks: 1, failures: [{ check: 'run', detail: String(e?.message || e) }], clicks: [] } }
    r.ms = Date.now() - t0
    results.push(r)
    process.stdout.write(`${r.failures.length ? '✗' : '✓'} ${width.padEnd(7)} ${theme.padEnd(5)} ${p.padEnd(14)} ${String(r.checks).padStart(3)} checks · ${r.clicks.length} clicks · ${r.focusChecked ?? 0} focusables${r.failures.length ? ` · ${r.failures.length} failure(s)` : ''}\n`)
  }
  await ctx.close()
}

// the screens before the dashboard, each in a browser context of its own: the sign-in page (the lab API, nobody
// signed in) and the setup wizard (a server that is not set up yet: its first screens)
async function sweepEntry(browser, results, pageId, api) {
  if (pageId === 'setup') {
    let fresh = false
    try { fresh = (await (await fetch(`${api}/setup/status`)).json()).initialized === false } catch { /* not running */ }
    if (!fresh) { console.log(`- setup wizard skipped: ${api} is not a fresh API`); return }
  }
  for (const width of WIDTHS) {
    for (const theme of THEMES) {
      const ctx = await browser.createBrowserContext()
      const page = await ctx.newPage()
      await page.setViewport(VIEWPORTS[width])
      const messages = []
      page.on('console', (m) => { if (['error', 'warn', 'warning'].includes(m.type())) { const text = `${m.type()}: ${m.text()}`; messages.push({ level: ignored(text) ? 'info' : m.type(), text }) } })
      page.on('pageerror', (e) => messages.push({ level: 'error', text: `uncaught: ${e.message}` }))
      const res = { page: pageId, theme, width, checks: 0, failures: [], clicks: [] }
      await page.goto(UI, { waitUntil: 'domcontentloaded' })
      await setSettings(page, { serverUrl: api, theme })
      await page.goto(UI, { waitUntil: 'domcontentloaded' })
      if (pageId === 'login') { try { await page.waitForSelector('input[placeholder="Enter password"]', { timeout: 20000 }) } catch { res.failures.push({ check: 'render', detail: 'no sign-in form within 20 s' }) } }
      await settle(page, 1200)
      res.shot = path.join(OUT, `${pageId}-${theme}-${width}.webp`)
      await page.screenshot({ path: res.shot, type: 'webp', quality: 62 })
      const c = await page.evaluate(inPageChecks)
      res.checks += 4
      if (width === 'phone' && c.overflow) res.failures.push({ check: 'overflow', detail: JSON.stringify(c.overflow) })
      for (const t of c.badText) res.failures.push({ check: 'text', detail: t })
      for (const e of c.empty) res.failures.push({ check: 'empty', detail: e })
      for (const u of c.unnamed) res.failures.push({ check: 'names', detail: u })
      await page.keyboard.press('Shift')
      const f = await page.evaluate(focusCheck)
      res.checks += 2
      res.focusChecked = f.checked
      for (const x of f.failures) res.failures.push({ check: 'focus', detail: x })
      for (const m of messages) if (m.level !== 'info') res.failures.push({ check: 'console', detail: m.text })
      results.push(res)
      process.stdout.write(`${res.failures.length ? '✗' : '✓'} ${width.padEnd(7)} ${theme.padEnd(5)} ${pageId.padEnd(14)} ${String(res.checks).padStart(3)} checks · ${f.checked} focusables${res.failures.length ? ` · ${res.failures.length} failure(s)` : ''}\n`)
      await ctx.close()
    }
  }
}

fs.mkdirSync(OUT, { recursive: true })
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--hide-scrollbars', '--force-color-profile=srgb', '--disable-features=Translate'] })
const results = []
const t0 = Date.now()
try {
  const combos = []
  for (const w of WIDTHS) for (const t of THEMES) combos.push(await prepareCombo(browser, w, t))
  await Promise.all(combos.map((c) => runCombo(c, results)))
  if (!process.env.PAGES || PAGES.includes('login')) await sweepEntry(browser, results, 'login', API)
  if (WIZARD_API) await sweepEntry(browser, results, 'setup', WIZARD_API)
} finally {
  await browser.close()
}

const failures = results.flatMap((r) => r.failures.map((f) => ({ ...f, page: r.page, theme: r.theme, width: r.width })))
const checks = results.reduce((n, r) => n + r.checks, 0)
const clicks = results.reduce((n, r) => n + r.clicks.length, 0)
const focusables = results.reduce((n, r) => n + (r.focusChecked || 0), 0)
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), ui: UI, api: API, results }, null, 1))
const byCheck = failures.reduce((m, f) => ({ ...m, [f.check]: (m[f.check] || 0) + 1 }), {})
console.log('\n' + '='.repeat(78))
console.log(`${new Set(results.map((r) => r.page)).size} pages × ${THEMES.length} themes × ${WIDTHS.length} widths = ${results.length} runs · ${checks} checks · ${clicks} clicks · ${focusables} focus checks · ${Math.round((Date.now() - t0) / 1000)} s`)
console.log(`failures: ${failures.length}${failures.length ? ` (${Object.entries(byCheck).map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`)
const retried = results.filter((r) => r.retried)
if (retried.length) {
  console.log(`blank first loads that rendered on the second try: ${retried.length}`)
  for (const r of retried) console.log(`  ${r.page}/${r.theme}/${r.width}: ${r.retried}`)
}
if (failures.length) {
  const grouped = new Map()
  for (const f of failures) {
    const key = `${f.check}: ${f.detail}`
    grouped.set(key, [...(grouped.get(key) || []), `${f.page}/${f.theme}/${f.width}`])
  }
  for (const [k, where] of [...grouped.entries()].slice(0, 120)) console.log(`  ${k}\n      at ${where.slice(0, 6).join(', ')}${where.length > 6 ? ` +${where.length - 6}` : ''}`)
}
console.log(`report: ${path.relative(ROOT, path.join(OUT, 'report.json'))} · screenshots: ${path.relative(ROOT, OUT)}/`)
process.exit(failures.length ? 1 : 0)
