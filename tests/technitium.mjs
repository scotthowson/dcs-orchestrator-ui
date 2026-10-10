#!/usr/bin/env node
// =============================================================================
// technitium — the Technitium page against the lab (tests/lab/lab.sh), with every /dns/technitium/* answer
// intercepted and served from a fake kept here (no Technitium needed): the overview, Allow on a blocked name,
// the pause and its countdown, a kids' group added, put in bedtime, paused, edited and deleted, SafeSearch, a
// device's queries and their filter, the connect sheet (also when nothing is connected), and a viewer, who sees
// it all read-only and never asks for a device's queries. Screenshots land in OUT.
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep UI=http://localhost:3021 API=http://127.0.0.1:41921 \
//     VIEWER_USER=… VIEWER_PASS=… node tests/technitium.mjs
// Exit status: 0 when every check passed.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021'
const API = process.env.API || 'http://127.0.0.1:41921'
const OUT = path.resolve(process.env.OUT || 'docs/ui-polish/technitium')
const ADMIN = { user: process.env.LAB_USER || 'lab', pass: process.env.LAB_PASS || 'Lab-Only-Pass-123' }
const VIEWER = { user: process.env.VIEWER_USER, pass: process.env.VIEWER_PASS }
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- the fake Technitium API (DCS's answers) ----
const inst = (role, url, domain) => ({ role, url, configured: true, reachable: true, error: null, version: '15.6', domain, up_since: new Date(Date.now() - 3 * 86400e3).toISOString(),
  blocking: true, paused_until: null, forwarders: ['dns.quad9.net:853 (9.9.9.9)', 'dns.quad9.net:853 (149.112.112.112)', 'dns.mullvad.net:853 (194.242.2.2)'], forwarder_protocol: 'Tls', dnssec: true,
  block_lists: 3, list_update_hours: 24, lists_last_update: new Date(Date.now() - 5 * 3600e3).toISOString(), zones: 2, allowed: 1, blocked: 2, apps: { advanced_blocking: true, query_logs: true }, hash: 'abc' })
const CATS = [{ id: 'adult', name: 'Adult content' }, { id: 'gambling', name: 'Gambling' }, { id: 'social', name: 'Social networks' }, { id: 'proxy-vpn', name: 'VPNs, proxies and other DNS' }, { id: 'nosafesearch', name: 'Search engines without SafeSearch' }]
const fake = {
  configured: true, paused: 0, house: { safe_search: false, youtube: 'off' }, groups: [], inBedtime: false, pausedBed: null, calls: [],
  status() {
    if (!this.configured) return { configured: false, primary: { role: 'primary', url: null, configured: false, reachable: false }, secondary: null, in_sync: null, last_sync: null, house: this.house, groups: 0, bedtime_active: [] }
    const p = inst('primary', 'http://192.168.2.53:5380', 'dns1'), s = inst('secondary', 'http://192.168.2.207:5380', 'dns2')
    if (this.paused > Date.now()) for (const i of [p, s]) { i.blocking = false; i.paused_until = new Date(this.paused).toISOString() }
    return { configured: true, primary: p, secondary: s, in_sync: true, last_sync: { at: Date.now() / 1000, ok: true, message: 'The secondary has what the primary has' }, house: this.house, groups: this.groups.length, bedtime_active: this.inBedtime ? this.groups.map((g) => g.id) : [] }
  },
  stats() {
    const labels = [...Array(12)].map((_, i) => new Date(Date.now() - (11 - i) * 300e3).toISOString())
    return { range: 'lastHour', instances: ['primary', 'secondary'], unreachable: [], totals: { queries: 1234, blocked: 87, clients: 6, cached: 400, nxdomain: 12 },
      series: { labels, queries: labels.map((_, i) => 80 + i * 5), blocked: labels.map((_, i) => 5 + (i % 3)) },
      top_clients: [{ ip: '192.168.2.50', count: 600, name: 'tablet-9.home' }, { ip: '192.168.2.51', count: 300, name: null }],
      top_domains: [{ domain: 'www.youtube.com', count: 300 }, { domain: 'example.com', count: 120 }],
      top_blocked: [{ domain: 'ads.example.net', count: 40 }], query_types: [{ type: 'A', count: 900 }] }
  },
  groupsAnswer() {
    return { house: this.house, groups: this.groups.map((g) => ({ ...g, in_bedtime: this.inBedtime && !this.pausedBed, bedtime_paused_until: this.pausedBed })), categories: CATS,
      forced_names: { safe_search: ['duckduckgo.com', 'www.bing.com', 'www.duckduckgo.com', 'www.google.com'], youtube: ['www.youtube.com'] }, safe_search_scope: 'house', now: new Date().toISOString() }
  },
  activity(q) {
    const e = [
      { time: new Date(Date.now() - 60e3).toISOString(), client: q.get('client'), name: 'ads.example.net', type: 'A', response: 'Blocked', rcode: 'NxDomain', answer: '', blocked: true, instance: 'primary' },
      { time: new Date(Date.now() - 120e3).toISOString(), client: q.get('client'), name: 'www.youtube.com', type: 'A', response: 'Recursive', rcode: 'NoError', answer: '216.239.38.120', blocked: false, instance: 'secondary' },
      { time: new Date(Date.now() - 180e3).toISOString(), client: q.get('client'), name: 'example.com', type: 'AAAA', response: 'Cached', rcode: 'NoError', answer: '', blocked: false, instance: 'primary' },
    ]
    return { entries: q.get('blocked') === '1' ? e.filter((x) => x.blocked) : e, unavailable: [] }
  },
  answer(method, url, body) {
    const u = new URL(url), p = u.pathname.replace(/^.*\/dns\/technitium/, '')
    this.calls.push({ method, p, body })
    const sync = { ok: true, message: 'The secondary has what the primary has' }
    if (method === 'GET' && p === '/status') return this.status()
    if (method === 'GET' && p === '/stats') return this.stats()
    if (method === 'GET' && p === '/groups') return this.groupsAnswer()
    if (method === 'GET' && p === '/activity') return this.activity(u.searchParams)
    if (method === 'GET' && p === '/lists') return { blocklists: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt'], allowed: ['example.com'], blocked: ['ads.example.com'], categories: CATS, baseline_lists: ['https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/pro-onlydomains.txt'] }
    if (p === '/pause') { this.paused = Date.now() + body.minutes * 60e3; return { success: true, paused_until: new Date(this.paused).toISOString(), minutes: body.minutes, warning: null } }
    if (p === '/resume') { this.paused = 0; return { success: true, blocking: true, warning: null } }
    if (p === '/allow' || p === '/block') return { success: true, domain: body.domain, sync, message: `${body.domain} is on the ${p === '/allow' ? 'allowed' : 'blocked'} list` }
    if (p === '/safesearch') { Object.assign(this.house, body); return { success: true, house: this.house, sync } }
    if (p === '/sync') return { success: true, message: sync.message }
    if (p === '/connect') { this.configured = true; return { success: true, role: body.role, url: body.url, connected: true, reachable: true, version: '15.6', domain: 'dns1', message: 'Connected to Technitium 15.6 (dns1)' } }
    if (method === 'POST' && p === '/groups') {
      const g = { ...body, id: body.id || 'g1a2b3c4d' }
      this.groups = this.groups.some((x) => x.id === g.id) ? this.groups.map((x) => (x.id === g.id ? g : x)) : [...this.groups, g]
      return { success: true, group: g, sync, warning: null }
    }
    if (method === 'POST' && p.endsWith('/pause-bedtime')) { this.pausedBed = body.minutes ? new Date(Date.now() + body.minutes * 60e3).toISOString() : null; return { success: true, paused_until: this.pausedBed, sync } }
    if (method === 'DELETE' && p.startsWith('/groups/')) { this.groups = this.groups.filter((g) => `/groups/${g.id}` !== p); return { success: true, sync } }
    return null
  },
}

async function intercept(page, log) {
  await page.setRequestInterception(true)
  page.on('request', (req) => {
    const url = req.url()
    if (!url.includes('/dns/technitium/')) return req.continue()
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': UI, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS' } })
    let body = {}
    try { body = JSON.parse(req.postData() || '{}') } catch { /* none */ }
    const a = fake.answer(req.method(), url, body)
    log?.push(`${req.method()} ${new URL(url).pathname}${new URL(url).search}`)
    req.respond({ status: a ? 200 : 404, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': UI }, body: JSON.stringify(a ?? { error: true, code: 404, message: 'not in the fake' }) })
  })
}

async function signIn(page, who) {
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.evaluate((api, user) => {
    localStorage.clear()
    localStorage.setItem('app-settings', JSON.stringify({ serverUrl: api, theme: 'dark', lastPage: 'technitium' }))
    localStorage.setItem('onboarding_complete', 'true')
    localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, API, who.user)
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main, input[placeholder="Enter password"]', { timeout: 30000 })
  if (await page.$('input[placeholder="Enter password"]')) {
    await page.type('input[placeholder="Enter username"]', who.user)
    await page.type('input[placeholder="Enter password"]', who.pass)
    await page.keyboard.press('Enter')
    await page.waitForSelector('main', { timeout: 30000 })
  }
}

const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '')
const bodyText = (page) => page.evaluate(() => document.body.innerText)
async function clickText(page, label, scope = 'body') {
  const ok = await page.evaluate((label, scope) => {
    const els = [...document.querySelectorAll(`${scope} button, ${scope} [role="tab"], ${scope} [role="menuitem"], ${scope} label`)]
    const el = els.find((e) => e.getClientRects().length && ((e.getAttribute('aria-label') || '') === label || (e.innerText || '').trim() === label || (e.innerText || '').trim().startsWith(label)))
    if (el) { el.click(); return true }
    return false
  }, label, scope)
  if (!ok) throw new Error(`no control "${label}"`)
  await sleep(500)
}
async function until(page, fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await sleep(200) } return false }
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: true })
async function typeInto(page, sel, value) { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, value) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1440,1000'] })
const errors = []
try {
  // ---------------- admin ----------------
  console.log('Admin')
  let page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  const log = []
  await intercept(page, log)
  await signIn(page, ADMIN)
  check('the page opens with both servers', await until(page, () => /Primary/.test(document.querySelector('main')?.innerText ?? '') && /Secondary/.test(document.querySelector('main')?.innerText ?? '') && /1,234/.test(document.querySelector('main')?.innerText ?? '')))
  let t = await text(page)
  check('…in sync, both blocking, Technitium 15.6', /In sync/.test(t) && (t.match(/Blocking\b/g) || []).length >= 2 && /Technitium 15\.6/.test(t))
  check('…the top clients by name, the top blocked', /tablet-9\.home/.test(t) && /ads\.example\.net/.test(t))
  check('…the tab is in the Security strip', await page.evaluate(() => [...document.querySelectorAll('[role="tab"], a, button')].some((e) => /^Technitium$/.test((e.innerText || '').trim()))))
  await shot(page, 'overview-admin')
  await clickText(page, 'Allow ads.example.net for everyone')
  check('Allow on a blocked name', fake.calls.some((c) => c.p === '/allow' && c.body.domain === 'ads.example.net'))

  // pause and its countdown
  await clickText(page, 'Pause 5 min')
  check('pause 5 minutes', fake.calls.some((c) => c.p === '/pause' && c.body.minutes === 5))
  check('…the button counts down', await until(page, () => /Paused\s*·\s*4:5\d/.test(document.querySelector('main')?.innerText ?? '')))
  const c1 = (await text(page)).match(/Paused\s*·\s*(\d+:\d+)/)?.[1]; await sleep(2200)
  const c2 = (await text(page)).match(/Paused\s*·\s*(\d+:\d+)/)?.[1]
  check('…second by second', c1 && c2 && c1 !== c2, `${c1} → ${c2}`)
  await shot(page, 'paused')
  await clickText(page, 'Paused', 'main')
  check('…Resume', fake.calls.some((c) => c.p === '/resume') && await until(page, () => /Pause 5 min/.test(document.querySelector('main')?.innerText ?? '')))
  // the longer pauses from the menu
  await clickText(page, 'Pause for longer')
  check('…15 minutes and 1 hour in its menu', /Pause 15 minutes/.test(await bodyText(page)) && /Pause 1 hour/.test(await bodyText(page)))
  await page.keyboard.press('Escape'); await sleep(300)

  // kids: add, bedtime, pause, edit, delete
  await clickText(page, 'Kids')
  check('kids: none yet', await until(page, () => /No groups yet/.test(document.querySelector('main')?.innerText ?? '')))
  check('kids: SafeSearch says it is the whole house', /SafeSearch for the whole house/.test(await text(page)))
  await clickText(page, 'Force SafeSearch')
  check('kids: SafeSearch on', fake.calls.some((c) => c.p === '/safesearch' && c.body.safe_search === true))
  await clickText(page, 'Add group', 'main')
  check('kids: the sheet opens', await until(page, () => !!document.querySelector('[role="dialog"]')))
  await page.type('#tg-name', 'Boys')
  await clickText(page, 'tablet-9.home', '[role="dialog"]')
  await page.type('[aria-label="Device address"]', '192.168.2.60'); await page.type('[aria-label="Device label"]', 'Switch')
  await clickText(page, 'Add', '[role="dialog"]')
  await clickText(page, 'Sat', '[role="dialog"]')
  await shot(page, 'group-sheet')
  await clickText(page, 'Save', '[role="dialog"]')
  const saved = fake.calls.find((c) => c.p === '/groups' && c.method === 'POST')
  check('kids: saved with its devices, lists and nights', saved && saved.body.name === 'Boys' && saved.body.devices.map((d) => d.ip).join() === '192.168.2.50,192.168.2.60'
    && saved.body.devices[0].label === 'tablet-9' && saved.body.lists.includes('adult') && saved.body.bedtime.days.join() === '1,2,3,4,7,6', JSON.stringify(saved?.body))
  check('kids: the card', await until(page, () => /Boys/.test(document.querySelector('main')?.innerText ?? '') && /Switch/.test(document.querySelector('main')?.innerText ?? '')))
  fake.inBedtime = true
  await clickText(page, 'Refresh')
  check('kids: "In bedtime now"', await until(page, () => /In bedtime now/.test(document.querySelector('main')?.innerText ?? ''), 35000))
  await shot(page, 'kids-bedtime')
  await clickText(page, 'Pause bedtime 30 min')
  check('kids: bedtime paused 30 minutes', fake.calls.some((c) => c.p.endsWith('/pause-bedtime') && c.body.minutes === 30) && await until(page, () => /Bedtime paused until/.test(document.querySelector('main')?.innerText ?? '')))
  await clickText(page, 'Edit Boys')
  await typeInto(page, '#tg-name', 'The boys')
  await clickText(page, 'Save', '[role="dialog"]')
  const edited = fake.calls.filter((c) => c.p === '/groups' && c.method === 'POST').pop()
  check('kids: edited (same id)', edited?.body.id === 'g1a2b3c4d' && edited.body.name === 'The boys')
  await clickText(page, 'Delete The boys')
  check('kids: delete asks first', await until(page, () => /Delete the group The boys\?/.test(document.body.innerText)))
  await clickText(page, 'Delete group')
  check('kids: deleted', fake.calls.some((c) => c.method === 'DELETE' && c.p === '/groups/g1a2b3c4d') && await until(page, () => /No groups yet/.test(document.querySelector('main')?.innerText ?? '')))

  // a device's queries
  await clickText(page, 'Devices')
  await page.select('#tt-client', '192.168.2.50')
  check('devices: the queries of the one picked', await until(page, () => /www\.youtube\.com/.test(document.querySelector('main')?.innerText ?? '')) && fake.calls.some((c) => c.p === '/activity'))
  check('devices: the blocked row is marked', await page.evaluate(() => [...document.querySelectorAll('main tr')].some((r) => /ads\.example\.net/.test(r.innerText) && /bg-rose/.test(r.className) && /Blocked/.test(r.innerText))))
  await page.type('input[aria-label="Filter the queries by name"]', 'youtube')
  check('devices: the filter', await until(page, () => document.querySelectorAll('main tbody tr').length === 1))
  await shot(page, 'devices')
  await clickText(page, 'Block www.youtube.com for everyone')
  check('devices: Block on a row', fake.calls.some((c) => c.p === '/block' && c.body.domain === 'www.youtube.com'))

  // lists
  await clickText(page, 'Lists')
  check('lists: the baseline list tagged', await until(page, () => /pro-onlydomains\.txt/.test(document.querySelector('main')?.innerText ?? '') && /baseline/.test(document.querySelector('main')?.innerText ?? '')))

  // connect sheet
  await clickText(page, 'Servers')
  check('connect: the sheet with both roles', await until(page, () => /Technitium servers/.test(document.body.innerText) && [...document.querySelectorAll('[role="dialog"]')].some((d) => /Secondary/.test(d.innerText))))
  check('connect: a stored token is not shown', await page.$eval('#tt-token', (e) => e.value === '' && /Stored/.test(e.placeholder)))
  await shot(page, 'connect-sheet')
  await page.keyboard.press('Escape'); await sleep(300)

  // nothing connected
  fake.configured = false
  await page.reload({ waitUntil: 'domcontentloaded' })
  check('not connected: says so, offers Connect', await until(page, () => /No Technitium is connected/.test(document.querySelector('main')?.innerText ?? ''), 20000))
  await clickText(page, 'Connect Technitium')
  await page.type('#tt-url', 'http://192.168.2.53:5380'); await page.type('#tt-token', 'f'.repeat(64))
  await clickText(page, 'Save and test', '[role="dialog"]')
  const con = fake.calls.find((c) => c.p === '/connect')
  check('not connected: Save and test sends the role, the address and the token', con && con.body.role === 'primary' && con.body.url === 'http://192.168.2.53:5380' && con.body.token.length === 64)
  check('not connected: the result shows', await until(page, () => /Connected to Technitium 15\.6/.test(document.body.innerText)))
  check('no token in any address the page asked', !log.some((l) => /f{64}/.test(l)))
  await page.close()

  // ---------------- viewer ----------------
  if (VIEWER.user) {
    console.log('Viewer')
    fake.calls = []; fake.groups = [{ id: 'g9', name: 'Girls', devices: [{ ip: '192.168.2.70', label: 'Tablet' }], lists: ['adult'], bedtime: { enabled: true, from: '20:00', to: '07:00', days: [1, 2, 3, 4, 5, 6, 7] } }]
    page = await browser.newPage()
    await page.setViewport({ width: 390, height: 844, isMobile: true })
    const statuses = []
    page.on('response', (r) => { if (r.url().startsWith(API)) statuses.push(r.status()) })
    page.on('pageerror', (e) => errors.push(String(e)))
    await intercept(page)
    await signIn(page, VIEWER)
    check('viewer: the page opens', await until(page, () => /Primary/.test(document.querySelector('main')?.innerText ?? ''), 20000))
    t = await text(page)
    check('viewer: no Pause, no Sync, no Servers, no Apply baseline', !/Pause 5 min|Sync now|Servers|Apply baseline/.test(t))
    check('viewer: no Devices tab', !/Devices/.test(await page.evaluate(() => [...document.querySelectorAll('main [role="radiogroup"], main .mantine-SegmentedControl-root')].map((e) => e.innerText).join(' '))))
    check('viewer: no Allow on a blocked name', !(await page.$('[aria-label="Allow ads.example.net for everyone"]')))
    check('viewer: no sideways scroll on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await shot(page, 'overview-viewer-phone')
    await clickText(page, 'Kids')
    check('viewer: the groups, read-only', await until(page, () => /Girls/.test(document.querySelector('main')?.innerText ?? '')) && !/Add group/.test(await text(page)) && !(await page.$('[aria-label="Edit Girls"]')))
    check('viewer: the switches are off limits', await page.evaluate(() => [...document.querySelectorAll('main input[role="switch"], main [role="switch"]')].every((e) => e.disabled || e.getAttribute('aria-disabled') === 'true' || e.closest('[data-disabled]'))))
    await shot(page, 'kids-viewer-phone')
    check('viewer: never asked for a device\'s queries', !fake.calls.some((c) => c.p === '/activity'))
    check('viewer: no 403 from the API', !statuses.includes(403), statuses.filter((s) => s >= 400).join(','))
    await page.close()
  }
  const errs = errors.filter((e) => !/Failed to load resource|favicon|ResizeObserver/.test(e))
  check('no console error or exception', errs.length === 0, errs.slice(0, 3).join(' | '))
} catch (e) {
  fail++; console.log(`  FAIL ${e.message}`)
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed · screenshots in ${OUT}`)
process.exit(fail ? 1 : 0)
