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
  enabled: false, deployed: false, configured: false, account: false, paused: false, connected: true, attached: [], wg: false, alerts: [], calls: [],
  status() {
    return {
      enabled: true, deployed: this.deployed, account_set: this.account, configured: this.configured, running: !this.paused, paused: this.paused,
      container: 'Gluetun', stack: 'networking-security', started_at: new Date(Date.now() - 7200e3).toISOString(), uptime_s: this.paused ? null : 7200,
      region_name: this.configured ? 'CA Montreal' : null, server_name: this.configured ? 'montreal424' : null, port_forwarding: true,
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
    if (p === '/vpn/regions') return { regions: [{ id: 'ca', name: 'CA Montreal', country: 'CA', geo: false }, { id: 'ca_toronto', name: 'CA Toronto', country: 'CA', geo: false }, { id: 'swiss', name: 'Switzerland', country: 'CH', geo: false }] }
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
  await page.setViewport({ width: 1440, height: 900 })
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
  await clickText(page, 'Test for leaks')
  check('leak test: the tunnel\'s address', await has(page, 'Tunnel · 198.51.100.7'))
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
  await has(page, 'Behind the VPN'); await shot(page, '08-light')
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true })
  await openPage(page, ADMIN, { lastPage: 'vpn', theme: 'dark' })
  await has(page, 'Behind the VPN')
  check('phone: no sideways scroll', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1))
  await shot(page, '09-phone')
  await page.setViewport({ width: 1440, height: 900 })

  // a viewer: read-only
  if (VIEWER.user) {
    const v = await browser.newPage(); await v.setViewport({ width: 1440, height: 900 })
    await intercept(v)
    await signIn(v, VIEWER, 'vpn')
    check('viewer: sees the status', await has(v, '198.51.100.7'))
    check('viewer: no switches, no Pause, no Account', await v.evaluate(() => !document.querySelector('[role="switch"]') && ![...document.querySelectorAll('button')].some((b) => ['Pause', 'Account & region', 'Test for leaks'].includes(b.innerText.trim()))))
    await v.close()
  }
  check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
