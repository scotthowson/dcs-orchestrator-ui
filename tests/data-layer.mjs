// The data layer's link to the server, against the lab (tests/lab/lab.sh; 127.0.0.1 only):
//  A  two tabs share the saved server list: a server added in tab 1 survives tab 2 re-validating and saving
//  B  a heartbeat ping that waits behind the dashboard's own requests is no "Connection Lost"
//  C  the live stream carries the session in the Authorization header, never in the address
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/data-layer.mjs     (UI, API, LAB_USER, LAB_PASS as for ui-sweep.mjs)
//
// It reads the app's own store modules through the Vite dev server (the lab's dashboard).
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021', API = process.env.API || 'http://127.0.0.1:41921'
const USER = process.env.LAB_USER || 'lab', PASS = process.env.LAB_PASS || 'Lab-Only-Pass-123'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push(!!ok); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true })
const ctx = await browser.createBrowserContext()
const errors = []

async function signIn(page) {
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('#signin-username, main', { timeout: 60000 })
  if (await page.$('#signin-username')) {
    await page.type('#signin-username', USER); await page.type('#signin-password', PASS); await page.keyboard.press('Enter')
  }
  await page.waitForSelector('main', { timeout: 60000 })
}

// ---- C: the stream request ----
const t1 = await ctx.newPage()
await t1.setViewport({ width: 1440, height: 900 })
t1.on('pageerror', (e) => errors.push(`${e}`))
// the headers as sent (Chrome reports a cross-origin request's own headers in the ExtraInfo event)
const streams = []
const sentHeaders = new Map()
const cdp = await t1.createCDPSession()
await cdp.send('Network.enable')
cdp.on('Network.requestWillBeSent', (e) => { if (e.request.method === 'GET' && e.request.url.startsWith(`${API}/stream`)) streams.push({ id: e.requestId, url: e.request.url }) })
cdp.on('Network.requestWillBeSentExtraInfo', (e) => sentHeaders.set(e.requestId, e.headers))
const authOf = (s) => { const h = sentHeaders.get(s.id) || {}; return h.Authorization || h.authorization || '' }
await t1.goto(UI, { waitUntil: 'domcontentloaded', timeout: 120000 })
await t1.evaluate((api, user) => {
  localStorage.clear()
  localStorage.setItem('app-settings', JSON.stringify({ serverUrl: api, theme: 'dark', lastPage: 'dashboard' }))
  localStorage.setItem('onboarding_complete', 'true'); localStorage.setItem(`dcs-prefs-at-${user}`, String(Date.now() + 86400000))
}, API, USER)
await signIn(t1)
const until = Date.now() + 20000
while (!streams.length && Date.now() < until) await sleep(250)
check('C: the live stream is opened', streams.length > 0, streams[0]?.url)
check('C: no token in the stream address', streams.length > 0 && streams.every((s) => !/[?&]token=/.test(s.url)))
// the lab answers slowly: the stream may wait for a free connection behind the first page's requests
const sseLive = () => t1.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/lib/sse.ts')))).sseClient.isConnected())
for (let end = Date.now() + 90000; Date.now() < end && !(await sseLive());) await sleep(1000)
check('C: the session rides in the Authorization header', streams.length > 0 && streams.every((s) => /^Bearer \S+/.test(authOf(s))))
check('C: …and the server let it in (the stream is open)', await sseLive())

// ---- A: two tabs ----
const t2 = await ctx.newPage()
await t2.setViewport({ width: 1440, height: 900 })
t2.on('pageerror', (e) => errors.push(`${e}`))
await signIn(t2)
const added = await t1.evaluate(async () => {
  const mod = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))
  const s = mod.useServerStore.getState().addServer({ name: 'Audit added', url: 'http://127.0.0.1:42082', isDefault: false })
  return s.id
})
await sleep(500)
const seenIn2 = await t2.evaluate(async (id) => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState().servers.some((s) => s.id === id), added)
check('A: tab 2 follows the server tab 1 added', seenIn2)
// tab 2, which read the list before tab 1 added the server, saves a change of its own (what re-validating a session does)
await t2.evaluate(async () => {
  const st = (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState()
  st.updateServer(st.activeServerId, { lastConnected: Date.now() })
})
await sleep(500)
const stored = await t1.evaluate(() => JSON.parse(localStorage.getItem('dcs-servers') || '{}').servers?.map((s) => s.name) ?? [])
check('A: the added server is still saved after tab 2 saved', stored.includes('Audit added'), JSON.stringify(stored))
const inMemory1 = await t1.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState().servers.map((s) => s.name))
check('A: …and tab 1 still lists it', inMemory1.includes('Audit added'))
const active1 = await t1.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState().activeServerId)
const active2 = await t2.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState().activeServerId)
check('A: each tab keeps its own active server', !!active1 && active1 === active2 && active1 !== added)
await t1.evaluate(async (id) => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState().removeServer(id), added)
await t2.close()

// ---- B: the ping waits behind the dashboard's own requests ----
// every /ping is held 9 s (past the 8 s limit) while the rest of the API answers: before, three such beats were "Connection Lost"
await t1.setRequestInterception(true)
t1.on('request', (r) => {
  if (r.isInterceptResolutionHandled()) return
  if (r.url() === `${API}/ping` || r.url() === `${API}/`) setTimeout(() => { r.continue().catch(() => {}) }, 9000)
  else r.continue().catch(() => {})
})
const notes = []
await t1.exposeFunction('noteStatus', (s) => notes.push(s))
await t1.evaluate(async () => {
  const { useConnectionStore } = await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/connectionStore.ts')))
  useConnectionStore.subscribe((s, p) => { if (s.status !== p.status) window.noteStatus(s.status) })
})
await sleep(50000)
const gate = await t1.evaluate(async () => (await import(performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('/src/renderer/stores/serverStore.ts')))).useServerStore.getState().gate)
check('B: 50 s of slow pings while the API answers: still connected', !notes.includes('error'), JSON.stringify(notes))
check('B: …no "can\'t be reached" screen', gate === 'open', gate)
check('B: …the dashboard still shows', !!(await t1.$('main')))
check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`)
await browser.close()
process.exit(results.every(Boolean) ? 0 : 1)
