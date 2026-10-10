#!/usr/bin/env node
// =============================================================================
// technitium — the Technitium page against the lab (tests/lab/lab.sh), with every /dns/technitium/* answer
// intercepted and served from a fake kept here (no Technitium needed): the overview, Allow on a blocked name,
// the pause and its countdown, a kids' group added, put in bedtime, paused, edited and deleted, SafeSearch, a
// device's queries and their filter, the connect sheet (also when nothing is connected), the device directory (scan an
// empty one, the icon picker, a nickname edited in place, search and filters, the drawer with a block until a time and
// a group, pin an address), the DHCP move (the scope made off with every known device kept, the router's DHCP off,
// on here, a renewed device's DNS), Config → Integrations turning it off (the tab and the card go, the page says so),
// and a viewer, who sees it all read-only and never asks for a device's queries. GET /config comes from the lab with
// technitium_enabled from the fake (the lab's own .env keeps Technitium off). Screenshots land in OUT.
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
const NOW = () => Math.round(Date.now() / 1000)
const dev = (id, ip, mac, o = {}) => ({ id, ip, mac, mac_random: false, vendor: null, hostname: null, nickname: null, icon: 'unknown', icon_guessed: true, notes: null, static: false,
  reserved_ip: null, blocked_until: null, blocked: false, hub: false, first_seen: NOW() - 10 * 86400, last_seen: NOW() - 60, queries_today: 0, blocked_today: 0,
  sources: { arp: NOW() - 60 }, group_id: null, group_name: null, ...o })
const SEED = () => [
  dev('daa119000050', '192.168.2.50', 'da:a1:19:00:00:50', { mac_random: true, vendor: 'Private address', hostname: 'tablet-9.home', icon: 'tablet', queries_today: 600, blocked_today: 40, sources: { arp: NOW(), querylog: NOW(), rdns: NOW() } }),
  dev('0009bf000060', '192.168.2.60', '00:09:bf:00:00:60', { vendor: 'Nintendo', icon: 'console', queries_today: 300, blocked_today: 2 }),
  dev('001122334455', '192.168.2.233', '00:11:22:33:44:55', { vendor: null, hostname: 'howson-server', icon: 'server', hub: true, queries_today: 120 }),
  dev('000e59aabb01', '192.168.2.1', '00:0e:59:aa:bb:01', { vendor: 'Sagemcom', icon: 'router', queries_today: 40 }),
  dev('083a8d000061', '192.168.2.61', '08:3a:8d:00:00:61', { vendor: 'Espressif', hostname: 'esp-kitchen.local', icon: 'iot', first_seen: NOW() - 3600 }),
  dev('28cdc1000070', '192.168.2.70', '28:cd:c1:00:00:70', { vendor: 'Raspberry Pi', hostname: 'pi-hole.home', icon: 'server', last_seen: NOW() - 12 * 86400 }),
]
const fake = {
  configured: true, paused: 0, house: { safe_search: false, youtube: 'off' }, groups: [], inBedtime: false, pausedBed: null, calls: [],
  enabled: true, devices: [], scope: null, leases: [],
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
      top_clients: [{ ip: '192.168.2.50', count: 600, name: this.devices.find((d) => d.ip === '192.168.2.50')?.nickname ?? 'tablet-9.home', icon: this.devices.length ? 'tablet' : null }, { ip: '192.168.2.51', count: 300, name: null }],
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
  withGroups(d) {
    const g = this.groups.find((x) => x.devices.some((y) => y.id === d.id || y.ip === d.ip))
    return { ...d, group_id: g?.id ?? null, group_name: g?.name ?? null, blocked: (d.blocked_until ?? 0) > NOW() }
  },
  dhcpAnswer() {
    const sc = this.scope ? [{ name: 'LAN', enabled: this.scope.enabled, start: this.scope.start, end: this.scope.end, mask: '255.255.255.0', network: '192.168.2.0', broadcast: '192.168.2.255',
      router: this.scope.router, dns: this.scope.dns, domain: this.scope.domain, lease_hours: this.scope.lease_hours, exclusions: [], ping_check: this.scope.ping_check,
      reservations: this.scope.reserved.map((d) => ({ mac: d.mac, ip: d.ip, hostname: null, comments: 'DCS', device_id: d.id, nickname: d.nickname })) }]
      : [{ name: 'Default', enabled: false, start: '192.168.1.1', end: '192.168.1.254', mask: '255.255.255.0', network: '192.168.1.0', broadcast: '192.168.1.255', router: '192.168.1.1', dns: ['this server'], domain: 'home', lease_hours: 24, exclusions: [], ping_check: false, reservations: [] }]
    const seen = this.devices.filter((d) => NOW() - d.last_seen < 86400)
    return { enabled: !!this.scope?.enabled, scopes: sc, leases: this.leases,
      hub: { ip: '192.168.2.233', prefix: 24, gateway: '192.168.2.1', interface: 'enp5s0' },
      suggested: { name: 'LAN', start: '192.168.2.100', end: '192.168.2.199', mask: '255.255.255.0', router: '192.168.2.1', dns: ['192.168.2.53', '192.168.2.207'], domain: 'home', lease_hours: 24, exclusions: [], ping_check: true, reserve_known: true },
      resolvers: { primary: '192.168.2.53', secondary: '192.168.2.207' },
      devices: { seen: seen.length, asking: seen.filter((d) => d.queries_today > 0).length, silent: seen.filter((d) => !d.queries_today).map(({ id, ip, nickname, hostname, icon }) => ({ id, ip, nickname, hostname, icon })) } }
  },
  answer(method, url, body) {
    const u = new URL(url), p = u.pathname.replace(/^.*\/dns\/technitium/, '')
    this.calls.push({ method, p, body })
    if (!this.enabled) return { status: 404, body: { error: true, code: 'feature_off', reason: 'feature_off', message: 'Technitium is off. Turn it on in Config → Integrations.' } }
    const sync = { ok: true, message: 'The secondary has what the primary has' }
    if (method === 'GET' && p === '/devices') return { devices: this.devices.map((d) => this.withGroups(d)), forgotten: 0, last_scan: this.devices.length ? { at: NOW() - 120, found: 6, new: 0, devices: 6, swept: true, named_by_dhcp: 2, sources: { arp: 6 }, errors: [] } : null, dhcp: { serving: !!this.scope?.enabled, at: NOW() }, icons: [], now: NOW() }
    if (method === 'POST' && p === '/devices/scan') { if (!this.devices.length) this.devices = SEED(); return { success: true, found: 6, new: 6, named_by_dhcp: 2, message: '6 devices found, 2 named by DHCP' } }
    if (method === 'PUT' && p.startsWith('/devices/')) {
      const id = p.slice('/devices/'.length), d = this.devices.find((x) => x.id === id)
      if (!d) return null
      if ('nickname' in body) d.nickname = body.nickname
      if ('icon' in body) { d.icon = body.icon; d.icon_guessed = false }
      if ('notes' in body) d.notes = body.notes
      if ('static' in body) { if (!this.scope) return { status: 409, body: { error: true, code: 409, reason: 'no_dhcp_scope', message: `Technitium has no DHCP scope for ${d.ip}: the router still hands out addresses. Move DHCP here first (the DHCP tab), then pin it.` } }; d.static = body.static; d.reserved_ip = body.static ? d.ip : null }
      if ('blocked_until' in body) d.blocked_until = body.blocked_until
      if ('group_id' in body) {
        for (const g of this.groups) g.devices = g.devices.filter((y) => y.id !== d.id && y.ip !== d.ip)
        const g = this.groups.find((x) => x.id === body.group_id); if (g) g.devices.push({ ip: d.ip, label: d.nickname ?? '', mac: d.mac, id: d.id })
      }
      return { success: true, device: this.withGroups(d), sync: null, warning: null }
    }
    if (method === 'DELETE' && p.startsWith('/devices/')) { this.devices = this.devices.filter((x) => `/devices/${x.id}` !== p); return { success: true } }
    if (method === 'GET' && p === '/dhcp') return this.dhcpAnswer()
    if (method === 'POST' && p === '/dhcp/scope') { const reserved = body.reserve_known ? this.devices.filter((d) => d.mac) : []; this.scope = { ...body, enabled: false, reserved }; reserved.forEach((d) => { d.static = true; d.reserved_ip = d.ip }); return { success: true, scope: 'LAN', created: true, enabled: false, reserved: reserved.length, skipped: [], message: `The scope LAN is made, off until you turn it on; ${reserved.length} devices keep their address` } }
    if (method === 'POST' && (p === '/dhcp/enable' || p === '/dhcp/disable')) {
      this.scope.enabled = p.endsWith('enable')
      if (this.scope.enabled) this.leases = [{ scope: 'LAN', type: 'Reserved', mac: 'da:a1:19:00:00:50', ip: '192.168.2.50', hostname: 'tablet-9.home', obtained: new Date().toISOString(), expires: new Date(Date.now() + 86400e3).toISOString(), dns: this.scope.dns, device_id: 'daa119000050', nickname: this.devices.find((d) => d.id === 'daa119000050')?.nickname ?? null, icon: 'tablet' }]
      return { success: true, scope: 'LAN', enabled: this.scope.enabled, message: this.scope.enabled ? 'Technitium hands out addresses now: devices move over as their leases renew' : 'Technitium no longer hands out addresses' }
    }
    if (method === 'DELETE' && p.startsWith('/dhcp/leases/')) { this.leases = []; return { success: true } }
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
  page.on('request', async (req) => {
    const url = req.url()
    const cors = { 'Access-Control-Allow-Origin': UI }
    const isConfig = new URL(url).pathname.endsWith('/config') && url.startsWith(API)
    if (!url.includes('/dns/technitium/') && !isConfig) return req.continue()
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } })
    let body = {}
    try { body = JSON.parse(req.postData() || '{}') } catch { /* none */ }
    if (isConfig) {
      // the lab's own config, with the switch from the fake (the lab's .env keeps Technitium off: no scan of a real network)
      if (req.method() === 'POST' && Object.keys(body).length === 1 && 'TECHNITIUM_ENABLED' in body) {
        fake.enabled = String(body.TECHNITIUM_ENABLED) === 'true'; fake.calls.push({ method: 'POST', p: '/config', body })
        return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, updated: 1, message: 'Configuration updated.' }) })
      }
      if (req.method() !== 'GET') return req.continue()
      try {
        const r = await fetch(url, { headers: { Authorization: req.headers().authorization ?? '' } })
        const cfg = await r.json()
        return req.respond({ status: r.status, contentType: 'application/json', headers: cors, body: JSON.stringify({ ...cfg, technitium_enabled: fake.enabled }) })
      } catch { return req.continue() }
    }
    const a = fake.answer(req.method(), url, body)
    log?.push(`${req.method()} ${new URL(url).pathname}${new URL(url).search}`)
    const status = a?.status && a.body ? a.status : a ? 200 : 404
    req.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(a?.status && a.body ? a.body : a ?? { error: true, code: 404, message: 'not in the fake' }) })
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
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(200) } return false }
async function until(page, fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await sleep(200) } return false }
// the app scrolls inside <main>: the shot grows the window to the whole of it for a moment
async function shot(page, name) {
  const vp = page.viewport()
  const h = await page.evaluate(() => { const m = document.querySelector('main'); return m ? m.scrollHeight + (window.innerHeight - m.clientHeight) : 0 })
  if (h > vp.height) { await page.setViewport({ ...vp, height: Math.min(h, 4000) }); await sleep(400) }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  if (h > vp.height) await page.setViewport(vp)
}
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

  // the device directory: empty, scanned, named, an icon picked, searched, the drawer
  await clickText(page, 'Devices')
  check('devices: empty, says how to fill it', await until(page, () => /No devices yet/.test(document.querySelector('main')?.innerText ?? '')))
  await shot(page, 'devices-empty')
  await clickText(page, 'Scan the network', 'main')
  check('devices: the scan says what it found', await until(page, () => /6 devices found, 2 named by DHCP/.test(document.body.innerText)))
  check('devices: the table: icon, name, address, MAC and vendor, group, last seen, 24 hours', await until(page, () => document.querySelectorAll('main tbody tr').length === 6) && await page.evaluate(() => {
    const t = document.querySelector('main table')?.innerText ?? ''; return /tablet-9/.test(t) && /192\.168\.2\.60/.test(t) && /00:09:bf:00:00:60/.test(t) && /Nintendo/.test(t) && /600/.test(t) && /40 blocked/.test(t) && /hub/.test(t)
  }))
  check('devices: busiest first', await page.evaluate(() => /tablet-9/.test(document.querySelector('main tbody tr')?.innerText ?? '')))
  await clickText(page, 'Icon of Nintendo: Console (a guess). Change it')
  check('devices: the icon picker, every icon a radio', await until(page, () => document.querySelectorAll('[role="radiogroup"] [role="radio"]').length === 17))
  await shot(page, 'icon-picker')
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowLeft')
  await clickText(page, 'Console', '[role="radiogroup"]')
  check('devices: an icon picked', fake.calls.some((c) => c.method === 'PUT' && c.p === '/devices/0009bf000060' && c.body.icon === 'console'))
  await clickText(page, 'Rename tablet-9')
  await page.keyboard.type("Tom's tablet"); await page.keyboard.press('Enter')
  check('devices: a nickname edited in place', await until(page, () => /Tom's tablet/.test(document.querySelector('main tbody')?.innerText ?? '')) && fake.calls.some((c) => c.method === 'PUT' && c.body.nickname === "Tom's tablet"))
  await page.type('input[aria-label="Search the devices"]', 'nintendo')
  check('devices: search by vendor', await until(page, () => document.querySelectorAll('main tbody tr').length === 1))
  await page.click('input[aria-label="Search the devices"]', { clickCount: 3 }); await page.keyboard.press('Backspace')
  await clickText(page, 'Away 7 days+')
  check('devices: the ones away a week', await until(page, () => document.querySelectorAll('main tbody tr').length === 1 && /pi-hole/.test(document.querySelector('main tbody')?.innerText ?? '')))
  await clickText(page, 'All')
  await shot(page, 'devices-dark')
  await clickText(page, 'Actions for Nintendo')
  await clickText(page, 'Pin address')
  check('devices: pin while the router does DHCP says so', await until(page, () => /the router still hands out addresses/.test(document.body.innerText)))
  await clickText(page, "Tom's tablet", 'main tbody')
  check('devices: the drawer with every field', await until(page, () => /Its name on the network/.test(document.body.innerText) && !!document.querySelector('#td-nick') && /Latest queries/i.test(document.body.innerText)))
  await clickText(page, 'Block this device entirely', '[role="dialog"]')
  await clickText(page, '30 min', '[role="dialog"]')
  await page.type('#td-notes', 'The blue case')
  await shot(page, 'device-drawer')
  await clickText(page, 'Save', '[role="dialog"]')
  const blk = fake.calls.filter((c) => c.method === 'PUT' && c.p === '/devices/daa119000050').pop()
  check('devices: blocked for 30 minutes, with a note', blk && Math.abs(blk.body.blocked_until - (NOW() + 1800)) < 120 && blk.body.notes === 'The blue case', JSON.stringify(blk?.body))
  check('devices: …the row says blocked', await until(page, () => /blocked/.test(document.querySelector('main tbody')?.innerText ?? '')))
  check('overview: the top clients carry the nickname and icon', (fake.stats().top_clients[0].name === "Tom's tablet"))

  // DHCP: the move, step by step
  await clickText(page, 'DHCP')
  check('dhcp: the router hands out addresses, the flow opens at step 2', await until(page, () => /The router/.test(document.querySelector('main')?.innerText ?? '') && !!document.querySelector('#ts-start')))
  check('dhcp: the scope from the hub\'s network (.100–.199, DNS primary then secondary)', await page.evaluate(() => document.querySelector('#ts-start').value === '192.168.2.100' && document.querySelector('#ts-end').value === '192.168.2.199' && document.querySelector('#ts-dns1').value === '192.168.2.53' && document.querySelector('#ts-dns2').value === '192.168.2.207'))
  check('dhcp: both resolvers must stay up', /Both resolvers must stay up/.test(await text(page)))
  await shot(page, 'dhcp-flow')
  await clickText(page, 'Create the scope (off)')
  const sc = fake.calls.find((c) => c.p === '/dhcp/scope')
  check('dhcp: made off, every known device kept, ping check on', sc && sc.body.reserve_known === true && sc.body.ping_check === true && sc.body.lease_hours === 24 && sc.body.domain === 'home', JSON.stringify(sc?.body))
  check('dhcp: …step 3, the router\'s DHCP (Bell Home Hub 4000)', await until(page, () => /Advanced tools and settings → DHCP/.test(document.querySelector('main')?.innerText ?? '')))
  await clickText(page, "I turned the router's DHCP off")
  await clickText(page, 'Turn DHCP on here', 'main')
  check('dhcp: turning it on asks first', await until(page, () => /Hand out addresses from Technitium\?/.test(document.body.innerText)))
  await clickText(page, 'Turn DHCP on here', '[role="dialog"], [role="alertdialog"]')
  check('dhcp: on', await waitFor(() => fake.calls.some((c) => c.p === '/dhcp/enable')))
  check('dhcp: step 5: the renewed device got Technitium as its DNS (green)', await until(page, () => /uses Technitium/.test(document.querySelector('main')?.innerText ?? '') && /DNS 192\.168\.2\.53, 192\.168\.2\.207/.test(document.querySelector('main')?.innerText ?? '')))
  await shot(page, 'dhcp-on')

  // kids: add, bedtime, pause, edit, delete
  await clickText(page, 'Kids')
  check('kids: none yet', await until(page, () => /No groups yet/.test(document.querySelector('main')?.innerText ?? '')))
  check('kids: SafeSearch says it is the whole house', /SafeSearch for the whole house/.test(await text(page)))
  await clickText(page, 'Force SafeSearch')
  check('kids: SafeSearch on', fake.calls.some((c) => c.p === '/safesearch' && c.body.safe_search === true))
  await clickText(page, 'Add group', 'main')
  check('kids: the sheet opens', await until(page, () => !!document.querySelector('[role="dialog"]')))
  check('kids: a new group starts at 21:00–07:00 every night', await page.$eval('#tg-from', (e) => e.value) === '21:00' && /21:00 → 07:00, every night/.test(await bodyText(page)))
  check('kids: …and offers SafeSearch and YouTube strict for the house', /Also for the whole house: SafeSearch on, YouTube strict/.test(await bodyText(page)))
  await page.type('#tg-name', 'Boys')
  await clickText(page, "Add Tom's tablet (192.168.2.50)", '[role="dialog"]')
  await page.type('[aria-label="Device address"]', '192.168.2.60'); await page.type('[aria-label="Device label"]', 'Switch')
  await clickText(page, 'Add', '[role="dialog"]')
  await clickText(page, 'School nights (Sun–Thu)', '[role="dialog"]')
  await clickText(page, 'Sat', '[role="dialog"]')
  await shot(page, 'group-sheet')
  await clickText(page, 'Save', '[role="dialog"]')
  const saved = fake.calls.find((c) => c.p === '/groups' && c.method === 'POST')
  check('kids: saved with its devices (the directory\'s id), lists and nights', saved && saved.body.name === 'Boys' && saved.body.devices.map((d) => d.ip).join() === '192.168.2.50,192.168.2.60'
    && saved.body.devices[0].label === "Tom's tablet" && saved.body.devices[0].id === 'daa119000050' && saved.body.lists.includes('adult') && saved.body.bedtime.days.join() === '1,2,3,4,7,6'
    && saved.body.bedtime.from === '21:00', JSON.stringify(saved?.body))
  check('kids: …SafeSearch and YouTube strict for the house with it', fake.calls.some((c) => c.p === '/safesearch' && c.body.safe_search === true && c.body.youtube === 'strict'))
  check('kids: the card names the devices', await until(page, () => /Boys/.test(document.querySelector('main')?.innerText ?? '') && /Switch/.test(document.querySelector('main')?.innerText ?? '') && /Tom's tablet/.test(document.querySelector('main')?.innerText ?? '')))
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
  await clickText(page, 'Activity')
  await page.select('#tt-client', '192.168.2.50')
  check('activity: the picker names devices from the directory', await page.$$eval('#tt-client option', (o) => o.some((x) => /Tom's tablet/.test(x.textContent))))
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

  // Config → Integrations: off hides the tab and the DNS & routes card; the page says so
  fake.configured = true
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('app-settings') || '{}'); s.lastPage = 'config'; localStorage.setItem('app-settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'domcontentloaded' })
  check('config: Integrations has the Technitium switch, on', await until(page, () => [...document.querySelectorAll('[role="switch"]')].some((e) => /Technitium DNS/.test(document.querySelector(`label[for="${e.id}"]`)?.innerText ?? '') && e.checked), 20000))
  await page.evaluate(() => [...document.querySelectorAll('[role="switch"]')].find((e) => /Technitium DNS/.test(document.querySelector(`label[for="${e.id}"]`)?.innerText ?? ''))?.scrollIntoView({ block: 'center' }))
  await shot(page, 'config-integrations')
  await page.evaluate(() => [...document.querySelectorAll('[role="switch"]')].find((e) => /Technitium DNS/.test(document.querySelector(`label[for="${e.id}"]`)?.innerText ?? ''))?.click())
  await sleep(400)
  await clickText(page, 'Save')
  check('config: saved off', await waitFor(() => fake.calls.some((c) => c.p === '/config' && String(c.body.TECHNITIUM_ENABLED) === 'false')))
  check('config: …the Security strip has no Technitium tab', await until(page, () => ![...document.querySelectorAll('[role="tab"], nav a, nav button')].some((e) => /^Technitium$/.test((e.innerText || '').trim())), 10000))
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('app-settings') || '{}'); s.lastPage = 'dns'; localStorage.setItem('app-settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await until(page, () => /DNS/.test(document.querySelector('main')?.innerText ?? ''), 20000); await sleep(1500)
  check('config: …no Technitium card on DNS & routes', !/Open Technitium/.test(await text(page)))
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('app-settings') || '{}'); s.lastPage = 'technitium'; localStorage.setItem('app-settings', JSON.stringify(s)) })
  await page.reload({ waitUntil: 'domcontentloaded' })
  check('config: …the page says it is off and where to turn it on', await until(page, () => /Technitium is off/.test(document.querySelector('main')?.innerText ?? '') && /Open Config/.test(document.querySelector('main')?.innerText ?? ''), 20000))
  await shot(page, 'off')
  fake.enabled = true

  // the light look of the devices (Ctrl+D switches the look)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await until(page, () => /Primary/.test(document.querySelector('main')?.innerText ?? ''), 20000)
  await page.keyboard.down('Control'); await page.keyboard.press('d'); await page.keyboard.up('Control')
  check('the light look', await until(page, () => document.documentElement.classList.contains('light')))
  await clickText(page, 'Devices')
  await until(page, () => document.querySelectorAll('main tbody tr').length === 6)
  await shot(page, 'devices-light')
  await clickText(page, 'DHCP')
  await until(page, () => /Leases/.test(document.querySelector('main')?.innerText ?? ''))
  await shot(page, 'dhcp-light')
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
    check('viewer: no Activity tab', !/Activity/.test(await page.evaluate(() => [...document.querySelectorAll('main [role="radiogroup"], main .mantine-SegmentedControl-root')].map((e) => e.innerText).join(' '))))
    check('viewer: no Allow on a blocked name', !(await page.$('[aria-label="Allow ads.example.net for everyone"]')))
    check('viewer: no sideways scroll on a phone', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await shot(page, 'overview-viewer-phone')
    await clickText(page, 'Kids')
    check('viewer: the groups, read-only', await until(page, () => /Girls/.test(document.querySelector('main')?.innerText ?? '')) && !/Add group/.test(await text(page)) && !(await page.$('[aria-label="Edit Girls"]')))
    check('viewer: the switches are off limits', await page.evaluate(() => [...document.querySelectorAll('main input[role="switch"], main [role="switch"]')].every((e) => e.disabled || e.getAttribute('aria-disabled') === 'true' || e.closest('[data-disabled]'))))
    await shot(page, 'kids-viewer-phone')
    await clickText(page, 'Devices')
    check('viewer: the devices as cards on a phone, read-only', await until(page, () => document.querySelectorAll('main ul.md\\:hidden > li').length === 6) && !/Scan the network/.test(await text(page)) && !(await page.$('[aria-label^="Rename"]')) && !(await page.$('[aria-label$="Change it"]')))
    check('viewer: no sideways scroll on the devices', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
    await shot(page, 'devices-viewer-phone')
    await clickText(page, 'DHCP')
    check('viewer: DHCP read-only', await until(page, () => /Move DHCP here/.test(document.querySelector('main')?.innerText ?? '')) && !/Turn DHCP on here|Create the scope/.test((await page.$$eval('main button', (b) => b.map((x) => x.innerText).join(' ')))))
    await shot(page, 'dhcp-viewer-phone')
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
