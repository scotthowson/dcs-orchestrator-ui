#!/usr/bin/env node
// =============================================================================
// vpn — the VPN page against the lab (tests/lab/lab.sh), with every /vpn/* answer, PUT /containers/{name}/vpn and the
// vpn-gluetun deploy intercepted and served from a fake kept here (no Gluetun, no PIA): off in Config (the page says
// so), Set up (the template deployed, not started), Connect (the account and the fastest region; PIA's regions,
// Canada's first), the status (exit address, country, forwarded port, uptime), a container added from the picker
// (the lab's own containers) and its VPN pill on the Containers page, the leak test, Pause (it asks, says the
// containers are offline) and Resume, the WireGuard clients' switch (it asks, says the speed), a tunnel-down alert in
// "Needs your attention" and on the page, a viewer (read-only). Screenshots land in OUT.
//
// 4.0.55: the traffic (rates now, 24 hours, today and this month, each container's share), the server and its speed
// (Test speed, Change server, Fastest now), the per-container policy (stop when down, start when back), the history
// (uptime, the session, drops with their reason, the forwarded port), Verify (the leak test for all), the exit address
// copied, the picker without core stacks.
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep UI=http://localhost:3021 API=http://127.0.0.1:41921 node tests/vpn.mjs
// Exit status: 0 when every check passed.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021'
const API = process.env.API || 'http://127.0.0.1:41921'
const OUT = path.resolve(process.env.OUT || 'docs/ui-polish/vpn')
const ADMIN = { user: process.env.LAB_USER || 'lab', pass: process.env.LAB_PASS || 'Lab-Only-Pass-123' }
const VIEWER = { user: process.env.VIEWER_USER, pass: process.env.VIEWER_PASS }
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const NOW = () => Math.round(Date.now() / 1000)

// ---- the fake VPN (DCS's answers) ----
const fake = {
  enabled: false, deployed: false, configured: false, account: false, paused: false, connected: true, attached: [], wg: false, alerts: [], calls: [], speed: null, region: 'CA Montreal', server: 'montreal424',
  status() {
    return {
      enabled: true, deployed: this.deployed, account_set: this.account, configured: this.configured, running: !this.paused, paused: this.paused,
      container: 'Gluetun', stack: 'networking-security', started_at: new Date(Date.now() - 7200e3).toISOString(), uptime_s: this.paused ? null : 7200,
      region_name: this.configured ? this.region : null, server_name: this.configured ? this.server : null, port_forwarding: true,
      session_s: this.paused || !this.connected ? null : 5400, server_latency_ms: 23, last_speed_test: this.speed, last_leak_test: null,
      qbittorrent_port: this.attached.some((a) => a.qbittorrent) ? 41234 : null, qbittorrent_error: null,
      attached: this.attached, last_change: NOW(), down_since: null, alerts: this.alerts,
      wireguard_clients: this.wg ? { on: true, container: 'WireGuard', subnet: '10.8.0.0/24' } : { on: false },
      vpn_status: this.paused ? 'stopped' : 'running', connected: this.connected && !this.paused,
      public_ip: this.paused ? null : '198.51.100.7', country: 'Canada', region: 'Quebec', city: 'Montreal', forwarded_port: this.paused ? null : 41234,
    }
  },
  answer(method, url, body) {
    const p = new URL(url).pathname
    this.calls.push({ method, p, body })
    if (p === '/vpn/status') return this.status()
    if (p === '/vpn/regions') return { regions: [{ id: 'ca', name: 'CA Montreal', country: 'CA', geo: false, latency_ms: 23 }, { id: 'ca_toronto', name: 'CA Toronto', country: 'CA', geo: false, latency_ms: 31 }, { id: 'swiss', name: 'Switzerland', country: 'CH', geo: false, latency_ms: null }] }
    if (p === '/vpn/traffic') {
      const t0 = Math.floor(NOW() / 300) * 300
      const per = Array.from({ length: 288 }, (_, i) => [t0 - (287 - i) * 300, Math.round(3e7 + 2.5e7 * Math.sin(i / 20) ** 2), Math.round(2e6 + 1e6 * Math.cos(i / 15) ** 2)])
      const c = this.attached.map((a, i) => ({ container: a.container, today: { rx: 4.1e9 / (i + 1), tx: 3.2e8 / (i + 1) }, month: { rx: 61e9 / (i + 1), tx: 5.4e9 / (i + 1) }, last_24h: { rx: 4.1e9, tx: 3.2e8 }, share: i ? 0.21 : 0.74, measured: true }))
      return { measured: true, interface: 'tun0', updated_at: NOW(), live: { rx_bps: 5.2e6, tx_bps: 3.1e5, window_s: 10 }, totals: { today: { rx: 5.6e9, tx: 4.4e8 }, month: { rx: 88e9, tx: 7.2e9 }, last_24h: { rx: 5.6e9, tx: 4.4e8 } },
        per_5min: per, hourly: [], daily: [], uptime: { last_24h: 99.3, last_30d: 99.8 }, containers: c, wireguard_clients: this.wg ? { today: { rx: 2e8, tx: 5e7 }, month: { rx: 3e9, tx: 6e8 }, last_24h: { rx: 2e8, tx: 5e7 } } : null, counting_error: null }
    }
    if (p === '/vpn/history') return {
      events: [
        { t: NOW() - 300, kind: 'speed_test', message: 'Speed check: 94.2 Mbps down, 18 ms to speed.cloudflare.com', mbps: 94.2 },
        { t: NOW() - 5400, kind: 'reconnect', message: 'The tunnel is back after 2 min down (198.51.100.7)', down_s: 120 },
        { t: NOW() - 5520, kind: 'disconnect', message: 'The tunnel went down: [vpn] restarting VPN because it failed to pass the healthcheck', reason: '[vpn] restarting VPN because it failed to pass the healthcheck' },
        { t: NOW() - 86000, kind: 'port', message: 'PIA forwards port 41234', port: 41234 },
        { t: NOW() - 86100, kind: 'server_change', message: 'Connected to CA Montreal (montreal424) by lab' },
      ],
      uptime: { last_24h: 99.3, last_30d: 99.8 }, session: { up: true, since: NOW() - 5400, length_s: 5400 }, reconnects_24h: 1,
      ports: [{ port: 41234, from: NOW() - 86000, to: null }], last_leak_test: { at: NOW() - 600, by: 'auto', tested: 1, leaks: 0, results: [] }, speed_tests: [],
    }
    if (p === '/vpn/speed-test') { this.speed = { at: NOW(), bytes: 20000000, seconds: 1.7, mbps: 94.2, latency_ms: 18, host: 'speed.cloudflare.com' }; return { success: true, ...this.speed, message: '94.2 Mbps through the tunnel, 18 ms to speed.cloudflare.com' } }
    if (p === '/vpn/server') { const r = body.region === 'fastest' ? { id: 'ca_toronto', name: 'CA Toronto', server: 'toronto421' } : { id: body.region, name: 'Switzerland', server: 'zurich401' }; this.region = r.name; this.server = r.server; return { success: true, region: { ...r, country: 'CA' }, latency_ms: 31, message: `Moving to ${r.name} (${r.server}), 31 ms away: the tunnel is back in a few seconds` } }
    const pm = p.match(/^\/vpn\/containers\/([^/]+)$/)
    if (pm) { const a = this.attached.find((x) => x.container === decodeURIComponent(pm[1])); if (!a) return { status: 404, body: { error: true, code: 404, message: 'not behind' } }; Object.assign(a, body); return { success: true, container: a.container, stop_when_down: !!a.stop_when_down, restart_when_up: !!a.restart_when_up } }
    if (p === '/vpn/connect') { if (!this.account && !body.username) return { status: 502, body: { error: true, code: 502, message: 'Your PIA account is not stored' } }; this.account = true; this.configured = true; return { success: true, region: { id: 'ca', name: 'CA Montreal', country: 'CA', server: 'montreal424' }, message: 'Connecting to CA Montreal (montreal424): the tunnel is up in a few seconds' } }
    if (p === '/vpn/pause') { this.paused = true; return { success: true, paused: true, message: 'The VPN is paused: the containers behind it are offline until you resume it' } }
    if (p === '/vpn/resume') { this.paused = false; return { success: true, paused: false, message: 'The VPN is running again' } }
    if (p === '/vpn/leak-test') return { success: true, exit_ip: '198.51.100.7', results: this.attached.map((a) => ({ container: a.container, ip: '198.51.100.7', verdict: 'tunnel' })), leaks: 0 }
    if (p === '/vpn/wireguard-clients') { this.wg = !!body.on; return { success: true, on: this.wg, message: this.wg ? 'The WireGuard clients reach the internet through the VPN' : 'The WireGuard clients use the home connection again' } }
    const m = p.match(/^\/containers\/([^/]+)\/vpn$/)
    if (m) {
      const c = decodeURIComponent(m[1])
      if (body.on) this.attached.push({ stack: 'media-services', service: c.toLowerCase(), container: c, image: `lscr.io/linuxserver/${c.toLowerCase()}`, targets: [8080], since: NOW(), running: true, qbittorrent: /qbit/i.test(c), leak_test: null })
      else this.attached = this.attached.filter((a) => a.container !== c)
      return { success: true, container: c, on: !!body.on, message: body.on ? `${c} goes through the VPN` : `${c} uses the normal connection again` }
    }
    if (p === '/templates/vpn-gluetun/deploy') { this.deployed = true; return { success: true, message: 'Deployed', template: 'vpn-gluetun', target_stack: 'networking-security', services: ['gluetun'] } }
    return null
  },
}

async function intercept(page) {
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = req.url()
    if (!url.startsWith(API)) return req.continue()
    const p = new URL(url).pathname
    const cors = { 'Access-Control-Allow-Origin': UI }
    const isConfig = p.endsWith('/config')
    const mine = p.startsWith('/vpn/') || /^\/containers\/[^/]+\/vpn$/.test(p) || p === '/templates/vpn-gluetun/deploy'
    if (!mine && !isConfig) return req.continue()
    if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { ...cors, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } })
    let body = {}
    try { body = JSON.parse(req.postData() || '{}') } catch { /* none */ }
    if (isConfig) {
      if (req.method() === 'POST' && 'VPN_ENABLED' in body) {
        fake.enabled = String(body.VPN_ENABLED) === 'true'; fake.calls.push({ method: 'POST', p: '/config', body })
        return req.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, updated: 1, message: 'Configuration updated.' }) })
      }
      if (req.method() !== 'GET') return req.continue()
      try {
        const r = await fetch(url, { headers: { Authorization: req.headers().authorization ?? '' } })
        const cfg = await r.json()
        return req.respond({ status: r.status, contentType: 'application/json', headers: cors, body: JSON.stringify({ ...cfg, vpn_enabled: fake.enabled }) })
      } catch { return req.continue() }
    }
    if (!fake.enabled) return req.respond({ status: 404, contentType: 'application/json', headers: cors, body: JSON.stringify({ error: true, code: 'feature_off', message: 'The VPN is off. Turn it on in Config → Integrations.' }) })
    const a = fake.answer(req.method(), url, body)
    const status = a?.status && a.body ? a.status : a ? 200 : 404
    req.respond({ status, contentType: 'application/json', headers: cors, body: JSON.stringify(a?.status && a.body ? a.body : a ?? { error: true, code: 404, message: 'not in the fake' }) })
  })
}

async function signIn(page, who, lastPage = 'vpn') {
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.evaluate((api, user, lastPage) => {
    localStorage.clear()
    localStorage.setItem('app-settings', JSON.stringify({ serverUrl: api, theme: 'dark', lastPage }))
    localStorage.setItem('onboarding_complete', 'true')
    localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, API, who.user, lastPage)
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main, input[placeholder="Enter password"]', { timeout: 30000 })
  if (await page.$('input[placeholder="Enter password"]')) {
    // a remembered user name may be filled in already
    await page.click('input[placeholder="Enter username"]', { clickCount: 3 }); await page.keyboard.press('Backspace')
    await page.type('input[placeholder="Enter username"]', who.user)
    await page.type('input[placeholder="Enter password"]', who.pass)
    await page.keyboard.press('Enter')
    await page.waitForSelector('main', { timeout: 30000 })
  }
}
async function openPage(page, who, patch) {
  await page.evaluate((p, user) => {
    const s = JSON.parse(localStorage.getItem('app-settings') || '{}'); Object.assign(s, p); localStorage.setItem('app-settings', JSON.stringify(s))
    localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, patch, who.user)
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
}
const text = (page) => page.evaluate(() => document.querySelector('main')?.innerText ?? '')
const bodyText = (page) => page.evaluate(() => document.body.innerText)
async function clickText(page, label) {
  const ok = await page.evaluate((label) => {
    const els = [...document.querySelectorAll('button, [role="tab"], [role="menuitem"], [role="switch"], label')]
    const el = els.reverse().find((e) => e.getClientRects().length && ((e.getAttribute('aria-label') || '') === label || (e.innerText || '').trim() === label || (e.innerText || '').trim().startsWith(label)))
    if (el) { el.click(); return true }
    return false
  }, label)
  if (!ok) throw new Error(`no control "${label}"`)
  await sleep(500)
}
async function waitFor(fn, ms = 8000) { const t = Date.now(); while (Date.now() - t < ms) { if (fn()) return true; await sleep(200) } return false }
async function until(page, fn, ms = 10000) { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await sleep(200) } return false }
const has = (page, t, ms = 10000) => until(page, new Function(`return document.body.innerText.includes(${JSON.stringify(t)})`), ms)
async function shot(page, name) {
  const vp = page.viewport()
  const h = await page.evaluate(() => { const m = document.querySelector('main'); return m ? m.scrollHeight + (window.innerHeight - m.clientHeight) : 0 })
  if (h > vp.height) { await page.setViewport({ ...vp, height: Math.min(h, 4000) }); await sleep(400) }
  await page.screenshot({ path: path.join(OUT, `${name}.png`) })
  if (h > vp.height) await page.setViewport(vp)
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--hide-scrollbars'] })
const errors = []
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1280, height: 900 })
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push(String(e)))
  await intercept(page)
  console.log('VPN page')
  await signIn(page, ADMIN, 'vpn')
  check('off: the page says so and leads to Config', await has(page, 'The VPN is off'))
  await shot(page, '01-off')

  // Config → Integrations: the switch
  await openPage(page, ADMIN, { lastPage: 'config' })
  check('config: the VPN switch in Integrations', await has(page, 'the containers you choose (qBittorrent)', 20000))
  fake.enabled = true
  await openPage(page, ADMIN, { lastPage: 'vpn' })
  check('on: not set up yet, Set up the VPN', await has(page, 'Set up the VPN'))
  await shot(page, '02-setup')
  await clickText(page, 'Set up the VPN'); await clickText(page, 'Set up')
  check('set up: the template deployed into networking-security, not started', await waitFor(() => fake.calls.some((c) => c.p === '/templates/vpn-gluetun/deploy' && c.body.target_stack === 'networking-security' && c.body.auto_start === false)))
  check('set up: the connect sheet opens', await has(page, 'PIA user name'))
  check('connect: the regions, the fastest first and Canada\'s before', await until(page, () => [...document.querySelectorAll('#vpn-region option')].map((o) => o.textContent).join('|') === 'Fastest that forwards a port|CA Montreal|CA Toronto|Switzerland'))
  check('connect: no account, the button waits for one', await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Connect').pop()?.disabled === true))
  await page.type('#vpn-user', 'p1234567'); await page.type('#vpn-pass', 'not-a-real-pass')
  await shot(page, '03-connect')
  await clickText(page, 'Connect')
  check('connect: account and fastest region sent', await waitFor(() => fake.calls.some((c) => c.p === '/vpn/connect' && c.body.username === 'p1234567' && c.body.region === 'auto')))
  check('connect: the answer is shown', await has(page, 'Connecting to CA Montreal'))
  await page.keyboard.press('Escape'); await sleep(400)
  await openPage(page, ADMIN, { lastPage: 'vpn' })
  check('status: connected, the exit address, the country, the forwarded port, the region', await has(page, '198.51.100.7') && await has(page, 'Montreal, Canada') && await has(page, '41234') && await has(page, 'CA Montreal · montreal424') && await has(page, 'Connected'))
  check('status: nothing behind it yet', await has(page, 'No container goes through the VPN yet'))

  // a container from the picker (the lab's own containers)
  const opts = await page.evaluate(() => [...document.querySelectorAll('#vpn-add option')].map((o) => o.value).filter(Boolean))
  check('picker: the lab\'s running containers', opts.length > 0, JSON.stringify(opts))
  const pick = opts[0]
  await page.select('#vpn-add', pick)
  await clickText(page, 'Through the VPN'); await sleep(300)
  await clickText(page, 'Through the VPN')   // the confirm dialog's button
  check('add: PUT /containers/{name}/vpn {on: true}', await waitFor(() => fake.calls.some((c) => c.p === `/containers/${encodeURIComponent(pick)}/vpn` && c.body.on === true)))
  check('add: it is listed with its switch', await has(page, `${pick} through the VPN`) || await until(page, new Function(`return !!document.querySelector('[aria-label="${pick} through the VPN"]')`)))
  await clickText(page, 'Verify')
  check('verify: every container\'s address, the tunnel\'s', await has(page, 'Tunnel · 198.51.100.7') && await has(page, 'Verified 1 container'))

  // traffic, server, speed, history
  check('traffic: the rates now, today and this month', await has(page, '42 Mbps') && await has(page, '2.5 Mbps') && await has(page, '88.7 GB'))
  check('traffic: the 24-hour chart', await until(page, () => !!document.querySelector('[aria-label^="Traffic over the last 24 hours"] svg path')))
  check('traffic: the container\'s share of the month', await has(page, '74 %'))
  check('history: uptime, the session, the drop with its reason, the forwarded port', await has(page, '99.3 %') && await has(page, '90 min') && await has(page, 'failed to pass the healthcheck') && await has(page, '41234 · since'))
  check('server: the region and its latency', await has(page, 'montreal424 · 23 ms'))
  await clickText(page, 'Test speed')
  check('speed: POST /vpn/speed-test, the result on the page', await waitFor(() => fake.calls.some((c) => c.p === '/vpn/speed-test')) && await has(page, '94.2 Mbps'))
  check('speed: one every 5 minutes (the button waits)', await until(page, () => [...document.querySelectorAll('button')].find((b) => b.innerText.includes('Test speed'))?.disabled === true))
  check('server: the picker shows each region\'s latency, not the current one', await until(page, () => [...document.querySelectorAll('#vpn-move option')].map((o) => o.textContent).join('|') === 'Choose a region…|CA Toronto · 31 ms|Switzerland'))
  await clickText(page, 'Fastest now'); await clickText(page, 'Move')
  check('server: Fastest now asks, then POST /vpn/server {region: fastest}', await waitFor(() => fake.calls.some((c) => c.p === '/vpn/server' && c.body.region === 'fastest')) && await has(page, 'Moving to CA Toronto'))
  // the policy
  await page.click(`#vpn-stop-${pick}`); await sleep(500)
  check('policy: stop when down (and start when back) for that container', await waitFor(() => fake.calls.some((c) => c.p === `/vpn/containers/${encodeURIComponent(pick)}` && c.body.stop_when_down === true && c.body.restart_when_up === true)))
  check('policy: the second switch appears', await until(page, new Function(`return !!document.getElementById('vpn-restart-${pick}')`)))
  // the exit address, copied
  check('exit address: a copy button', await until(page, () => !!document.querySelector('[aria-label="Copy the exit address"]')))
  // the picker: no core stack, not Gluetun, not already behind
  const after = await page.evaluate(() => [...document.querySelectorAll('#vpn-add option')].map((o) => o.value).filter(Boolean))
  check('picker: not the one already behind, nothing from the core stacks', !after.includes(pick) && !after.some((n) => /^(dcs-|Traefik|Gluetun|CrowdSec)/i.test(n)), JSON.stringify(after))
  await shot(page, '04-connected')

  // pause and resume
  await clickText(page, 'Pause')
  check('pause: it asks, and names the container cut off', await has(page, `${pick} has no network at all`))
  await clickText(page, 'Pause'); await sleep(300)
  check('pause: sent, the page says paused', await waitFor(() => fake.calls.some((c) => c.p === '/vpn/pause')) && await has(page, 'The VPN is paused'))
  await shot(page, '05-paused')
  await clickText(page, 'Resume')
  check('resume: sent', await waitFor(() => fake.calls.some((c) => c.p === '/vpn/resume')) && await has(page, 'Connected'))

  // the WireGuard clients
  await clickText(page, 'Route my WireGuard clients through the VPN')
  check('wireguard: it asks, with the speed caveat', await has(page, 'limited by your home\'s upload'))
  await clickText(page, 'Route them through the VPN')
  check('wireguard: PUT {on: true}', await waitFor(() => fake.calls.some((c) => c.p === '/vpn/wireguard-clients' && c.body.on === true)) && await has(page, 'Clients 10.8.0.0/24 leave through the tunnel'))

  // the alert on the page and in "Needs your attention"
  fake.connected = false
  fake.alerts = [{ key: 'vpn_down', event: 'vpn_down', headline: 'The VPN is down', message: `The tunnel has been down for 3 minutes: ${pick} are cut off from the internet by the kill switch until it is back.`, since: NOW() }]
  await openPage(page, ADMIN, { lastPage: 'vpn' })
  check('alert: on the page, the tunnel Down', await has(page, 'The VPN is down') && await has(page, 'Down'))
  await shot(page, '06-down')
  await openPage(page, ADMIN, { lastPage: 'dashboard' })
  check('alert: in Needs your attention', await has(page, 'The VPN is down', 30000))
  fake.connected = true; fake.alerts = []

  // the pill on the Containers page
  await openPage(page, ADMIN, { lastPage: 'containers' })
  check('containers: the VPN pill on its row', await until(page, new Function(`return [...document.querySelectorAll('main *')].some((e) => e.children.length === 0 && e.textContent === 'VPN' && e.closest('tr, li, [role="row"], div')?.innerText.includes(${JSON.stringify(pick)}))`), 20000))
  await shot(page, '07-containers')

  // light theme and a phone
  await openPage(page, ADMIN, { lastPage: 'vpn', theme: 'light' })
  await has(page, 'Behind the VPN')
  // the synced preferences may bring the dark look back: flip it with the header's shortcut when it did
  if (await page.evaluate(() => document.documentElement.classList.contains('dark') || document.documentElement.dataset.mode === 'dark')) { await page.keyboard.down('Control'); await page.keyboard.press('d'); await page.keyboard.up('Control'); await sleep(800) }
  await shot(page, '08-light')
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await openPage(page, ADMIN, { lastPage: 'vpn', theme: 'dark' })
  await has(page, 'Behind the VPN')
  check('phone: no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await shot(page, '09-phone')
  await page.setViewport({ width: 1280, height: 900 })

  // a viewer: read-only
  if (VIEWER.user) {
    const v = await browser.newPage(); await v.setViewport({ width: 1280, height: 900 })
    await intercept(v)
    try { await signIn(v, VIEWER, 'vpn') } catch (e) { await v.screenshot({ path: path.join(OUT, 'viewer-fail.png') }); console.log(await v.evaluate(() => document.body.innerText.slice(0, 400))); throw e }
    check('viewer: sees the status', await has(v, '198.51.100.7'))
    check('viewer: no switches, no Pause, no Account, no Verify, no Test speed, no Move', await v.evaluate(() => !document.querySelector('[role="switch"]') && !document.getElementById('vpn-move') && ![...document.querySelectorAll('button')].some((b) => ['Pause', 'Account & region', 'Verify', 'Test speed', 'Fastest now'].includes(b.innerText.trim()))))
    check('viewer: sees the traffic and the history', await has(v, '88.7 GB') && await has(v, 'Forwarded port'))
    await v.close()
  }
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
