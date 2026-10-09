// Accounts per server against the lab (tests/lab/lab.sh: 127.0.0.1 only, never a real server). A is the hub API, B the
// member API used as an independent server with an admin of its own (created here: austin), C an address where nothing
// answers. It switches between them and checks that the dashboard never shows without a session the active server
// confirmed: B without a session → its sign-in with nothing of A in the page, Cancel → A at once, B's token ended on the
// server mid-use → B's sign-in pre-filled, an unreachable server → its own screen, the app's start → Checking your
// sign-in, then the dashboard (or the sign-in for a stale token). Nothing A issued ever reaches B: no request to B carries
// A's session token or A's terminal token (the Linux sign-in of the Terminal page, answered here by a stand-in for A), the
// terminal session ends on A when A is left and on sign-out, and B's /settings/profile is never written from A's profile.
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/server-accounts.mjs      (UI, API, MEMBER_API, DEAD_API to point elsewhere)
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021'
const A = process.env.API || 'http://127.0.0.1:41921'
const B = process.env.MEMBER_API || 'http://127.0.0.1:41922'
const C = process.env.DEAD_API || 'http://127.0.0.1:41929'
const OUT = process.env.OUT || fs.mkdtempSync(path.join(os.tmpdir(), 'dcs-accounts-'))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
fs.mkdirSync(OUT, { recursive: true })

// B's own admin (a throwaway account of the lab's throwaway install)
{
  const login = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'lab', password: 'Lab-Only-Pass-123' }) }).then((r) => r.json())
  await fetch(`${B}/auth/users`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${login.token}` }, body: JSON.stringify({ username: 'austin', password: 'Austin-Lab-Pass-456', role: 'admin' }) })
}
// B's profile documents as B holds them (read with a session of the person's own, outside the dashboard)
const bProfile = async (user, pass) => {
  const login = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: user, password: pass }) }).then((r) => r.json())
  const doc = await fetch(`${B}/settings/profile`, { headers: { Authorization: `Bearer ${login.token}` } }).then((r) => r.json())
  await fetch(`${B}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${login.token}` } })
  return JSON.stringify(doc.profile ?? null)
}
const bProfilesBefore = { lab: await bProfile('lab', 'Lab-Only-Pass-123'), austin: await bProfile('austin', 'Austin-Lab-Pass-456') }
// the profile this person keeps for server A (an older build's key, without a server: what an upgraded device holds)
const A_PROFILE = { displayName: 'Scott on hub A', email: 'scott@example.invalid', bio: 'private note on A' }

const results = []
const check = (name, ok, detail = '') => { results.push({ name, ok: !!ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--hide-scrollbars'] })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|ERR_CONNECTION_REFUSED|net::ERR/.test(m.text())) errors.push(m.text()) })

// every request to B, and the terminal sign-outs sent to A: what A issued must never travel to B
const toB = []
const terminalLogouts = []
const aIssued = new Set()
page.on('request', (r) => {
  const u = new URL(r.url())
  if (u.origin === B) toB.push({ what: `${r.method()} ${u.pathname}`, carried: `${r.url()} ${JSON.stringify(r.headers())} ${r.postData() || ''}` })
  if (u.origin === A && u.pathname === '/terminal/auth/logout' && r.method() === 'POST') terminalLogouts.push(r.postData() || '')
})
// what A answered to them: 200 means the session really ended there, not only in this tab
const terminalLogoutAnswers = []
page.on('response', (r) => { const u = new URL(r.url()); if (u.origin === A && u.pathname === '/terminal/auth/logout' && r.request().method() === 'POST') terminalLogoutAnswers.push(r.status()) })
const noteASession = async () => { const t = (await profiles()).servers?.find((x) => x.url === A)?.session?.token; if (t) aIssued.add(t) }

// A's Linux sign-in for the Terminal page: the lab has no Linux account to check, so a stand-in answers for A (only A)
const TERMINAL_TOKEN = 'terminal-token-issued-by-A-' + Math.random().toString(36).slice(2, 10)
aIssued.add(TERMINAL_TOKEN)
const cdp = await page.createCDPSession()
await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${A}/terminal/*`, requestStage: 'Request' }] })
cdp.on('Fetch.requestPaused', (e) => {
  const u = new URL(e.request.url)
  const answer = (obj) => cdp.send('Fetch.fulfillRequest', {
    requestId: e.requestId, responseCode: 200,
    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: new URL(UI).origin }, { name: 'Access-Control-Allow-Credentials', value: 'true' }],
    body: Buffer.from(JSON.stringify(obj)).toString('base64'),
  }).catch(() => {})
  let body = {}
  try { body = JSON.parse(e.request.postData || '{}') } catch { /* not JSON */ }
  if (e.request.method === 'POST' && u.pathname === '/terminal/auth') return answer({ success: true, token: TERMINAL_TOKEN, username: 'scott', expires_in: 3600, auth_method: 'pam' })
  if (e.request.method === 'POST' && u.pathname === '/terminal/auth/verify') return answer(body.token === TERMINAL_TOKEN ? { valid: true, username: 'scott', expires_at: 0 } : { valid: false, username: '', expires_at: 0 })
  if (e.request.method === 'POST' && u.pathname === '/terminal/exec') return answer({ command: body.command, cwd: '/home/scott', exit_code: 0, output: '/home/scott\n', success: true, timestamp: new Date().toISOString() })
  return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
})
const openPage = (id) => page.evaluate(async (id) => { (await import('/src/renderer/stores/settingsStore.ts')).useSettingsStore.getState().setCurrentPage(id) }, id)
const terminalSignIn = async () => {
  await openPage('terminal')
  await page.waitForSelector('#terminal-username', { timeout: 30000 })
  await typeInto('#terminal-username', 'scott'); await typeInto('#terminal-password', 'Linux-Pass-Of-A'); await page.keyboard.press('Enter')
  await page.waitForSelector('input[aria-label="Command"]', { timeout: 30000 })
}
const storedAnywhere = (needle) => page.evaluate((n) => [localStorage, sessionStorage].flatMap((st) => Object.keys(st).filter((k) => (st.getItem(k) || '').includes(n))), needle)

// what is on screen, sampled often: the shell (main/aside) must never be there while the active server is not confirmed
const state = () => page.evaluate(() => ({
  main: !!document.querySelector('main'),
  aside: !!document.querySelector('aside'),
  signin: !!document.querySelector('#signin-username'),
  signinServer: document.querySelector('[data-testid="signin-server"]')?.textContent || '',
  username: document.querySelector('#signin-username')?.value ?? null,
  text: document.body.innerText,
  html: document.body.innerHTML,
  brand: (document.querySelector('aside')?.innerText || '').split('\n').slice(0, 4).join(' '),
}))
const waitFor = async (pred, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const s = await state(); if (pred(s)) return s; await sleep(150) } return state() }
const clickText = async (t, { exact = false, within = 'body' } = {}) => {
  const ok = await page.evaluate((t, exact, within) => {
    const b = [...document.querySelectorAll(`${within} button`)].find((e) => (exact ? e.textContent.trim() === t : e.textContent.includes(t)) && e.getClientRects().length)
    if (b) { b.click(); return true } return false
  }, t, exact, within)
  if (!ok) throw new Error(`no button "${t}" in ${within}`)
}
const typeInto = async (sel, v) => { await page.click(sel, { clickCount: 3 }); await page.keyboard.press('Backspace'); await page.type(sel, v) }
const openSwitcher = async () => { await page.evaluate(() => document.querySelector('aside .relative > button')?.click()); await sleep(300) }
const profiles = () => page.evaluate(() => JSON.parse(localStorage.getItem('dcs-servers') || '{}'))
// data that only server A has (its stacks and containers) and only B has
const A_DATA = ['networking-security', 'monitoring-management']
const B_DATA = ['media-services', 'jellyfin']
const hasAny = (html, list) => list.filter((x) => html.includes(x))

// 0. sign in to A
await page.goto(UI, { waitUntil: 'domcontentloaded' })
await page.evaluate((api, profile) => {
  localStorage.clear(); sessionStorage.clear()
  localStorage.setItem('app-settings', JSON.stringify({ serverUrl: api, theme: 'dark', lastPage: 'dashboard' }))
  localStorage.setItem('onboarding_complete', 'true'); localStorage.setItem('dcs-prefs-at-lab', String(Date.now() + 86400000))
  localStorage.setItem('dcs-prefs-at-austin', String(Date.now() + 86400000))
  localStorage.setItem('user-profile-lab', JSON.stringify(profile))
}, A, A_PROFILE)
await page.goto(UI, { waitUntil: 'domcontentloaded' })
let s = await waitFor((x) => x.signin)
check('start without a session: the sign-in, no shell', s.signin && !s.main && !s.aside)
await typeInto('#signin-username', 'lab'); await typeInto('#signin-password', 'Lab-Only-Pass-123'); await page.keyboard.press('Enter')
s = await waitFor((x) => x.main)
check('signed in to A: the shell', s.main)
await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('dcs-servers')); p.servers[0].name = 'Local Server'; localStorage.setItem('dcs-servers', JSON.stringify(p)) })
s = await waitFor((x) => hasAny(x.html, A_DATA).length > 0, 60000)
check('A data on screen', hasAny(s.html, A_DATA).length > 0, hasAny(s.html, A_DATA).join(','))
await noteASession()
await terminalSignIn()
check('Terminal on A: signed in to A\'s shell', (await storedAnywhere(TERMINAL_TOKEN)).length > 0)
await openPage('dashboard')
s = await waitFor((x) => hasAny(x.html, A_DATA).length > 0, 60000)

// 1. add B (no session) → its sign-in, with no shell and nothing of A behind it, sampled while it happens
await openSwitcher()
await clickText('Add Server', { within: 'aside' })
await page.type('aside input[placeholder="Server name"]', 'Austin hub')
await page.type('aside input[placeholder="http://192.168.1.100:9876"]', B)
let leaked = []
const sampler = setInterval(async () => { try { const x = await state(); if (!x.main && hasAny(x.html, A_DATA).length) leaked.push(hasAny(x.html, A_DATA)) ; if (x.signin && x.main) leaked.push('shell behind sign-in') } catch { /* navigating */ } }, 40)
await clickText('Add & Connect', { within: 'aside' })
s = await waitFor((x) => x.signin)
clearInterval(sampler)
await page.screenshot({ path: `${OUT}/1-signin-B.png` })
check('switch to B without a session: the sign-in', s.signin)
check('…no shell behind it', !s.main && !s.aside)
check('…no data of A in the DOM', hasAny(s.html, A_DATA).length === 0 && leaked.length === 0, JSON.stringify(leaked.slice(0, 3)))
check('…names B and its address', s.signinServer.includes('Austin hub') && s.signinServer.includes(B), s.signinServer)
check('…offers Cancel back to A', s.text.includes('Cancel — back to'), '')
await sleep(500)
check('…A\'s terminal session ended on A when A was left', terminalLogouts.some((b) => b.includes(TERMINAL_TOKEN)) && terminalLogoutAnswers.includes(200), `${terminalLogouts.length} logout(s), A answered ${terminalLogoutAnswers.join(',')}`)
check('…and gone from this tab', (await storedAnywhere(TERMINAL_TOKEN)).length === 0, (await storedAnywhere(TERMINAL_TOKEN)).join(','))

// 2. cancel → A, still signed in, at once
let t0 = Date.now()
await clickText('Cancel — back to')
s = await waitFor((x) => x.main)
check('Cancel: back on A, signed in (no sign-in asked)', s.main && !s.signin, `${Date.now() - t0} ms`)
let p = await profiles()
check('…A still has its session, B none', !!p.servers.find((x) => x.url === A)?.session?.token && !p.servers.find((x) => x.url === B)?.session)

// 3. B again → wrong password shows the server's message → sign in → B's shell
await openSwitcher()
await clickText('Austin hub', { within: 'aside' })
s = await waitFor((x) => x.signin)
await typeInto('#signin-username', 'austin'); await typeInto('#signin-password', 'wrong-password'); await page.keyboard.press('Enter')
s = await waitFor((x) => x.text.includes('Invalid username or password'), 15000)
check('wrong password: the server’s message', s.text.includes('Invalid username or password') && !s.main)
await typeInto('#signin-password', 'Austin-Lab-Pass-456'); await page.keyboard.press('Enter')
s = await waitFor((x) => x.main)
check('signed in to B: the shell', s.main)
s = await waitFor((x) => x.brand.includes('lab-member'))
check('…the shell is B’s (its name)', s.brand.includes('lab-member') && !s.brand.includes('lab-hub'), s.brand)
s = await waitFor((x) => hasAny(x.html, B_DATA).length > 0, 30000)
check('…B data, none of A', hasAny(s.html, B_DATA).length > 0 && hasAny(s.html, A_DATA).length === 0, `B:${hasAny(s.html, B_DATA)} A:${hasAny(s.html, A_DATA)}`)
await page.screenshot({ path: `${OUT}/2-B-shell.png` })
await openPage('terminal')
await page.waitForSelector('#terminal-username, input[aria-label="Command"]', { timeout: 30000 })
await sleep(1500)
check('Terminal on B: B\'s own Linux sign-in, not A\'s session', !!(await page.$('#terminal-username')) && !(await page.$('input[aria-label="Command"]')))
await openPage('dashboard')
await openSwitcher()
const menuText = await page.evaluate(() => document.querySelector('aside').innerText)
check('server menu: account lines', menuText.includes('signed in as austin · admin') && menuText.includes('signed in as lab · admin'), menuText.replace(/\n/g, ' | ').slice(0, 300))
await page.screenshot({ path: `${OUT}/3-menu.png` })

// 4. back to A: instant, no sign-in; while it happens the shell never shows B's name with A's data or the other way round
t0 = Date.now()
leaked = []
const sampler2 = setInterval(async () => { try { const x = await state(); if (x.signin) leaked.push('sign-in asked'); if (x.main && x.brand.includes('lab-member') && hasAny(x.html, A_DATA).length) leaked.push('B shell with A data') } catch { /* */ } }, 40)
await clickText('Local Server', { within: 'aside' })
s = await waitFor((x) => x.main)
const tMain = Date.now() - t0
s = await waitFor((x) => x.main && hasAny(x.html, A_DATA).length > 0)
clearInterval(sampler2)
check('switch back to A: no sign-in, A data', s.main && leaked.length === 0 && s.brand.includes('lab-hub'), `shell after ${tMain} ms, A data after ${Date.now() - t0} ms ${JSON.stringify(leaked.slice(0, 2))} ${s.brand}`)
await noteASession()

// 5. B again, then its token is ended on the server mid-use → B's sign-in, pre-filled; A keeps its session
await openSwitcher()
await clickText('Austin hub', { within: 'aside' })
s = await waitFor((x) => x.main && hasAny(x.html, B_DATA).length > 0)
check('switch to B with its session: no sign-in', s.main && !s.signin)
p = await profiles()
const bTok = p.servers.find((x) => x.url === B).session.token
const r = await fetch(`${B}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${bTok}` } })
check('B token ended on the server (lab)', r.ok, String(r.status))
s = await waitFor((x) => x.signin, 60000)
await page.screenshot({ path: `${OUT}/4-B-expired.png` })
check('expired mid-use: B’s sign-in, no shell', s.signin && !s.main && !s.aside)
check('…pre-filled with austin, names B', s.username === 'austin' && s.signinServer.includes('Austin hub'), `${s.username} / ${s.signinServer}`)
check('…no data of B left on screen', hasAny(s.html, B_DATA).length === 0)
const prompts = await page.evaluate(() => document.querySelectorAll('input[placeholder="Enter password"]').length)
check('…one prompt only', prompts === 1)
p = await profiles()
check('…A’s session untouched', !!p.servers.find((x) => x.url === A)?.session?.token)
// another server from the sign-in's list: A, at once
await clickText('Local Server')
s = await waitFor((x) => x.main && hasAny(x.html, A_DATA).length > 0)
check('from B’s sign-in to A: straight in', s.main && !s.signin)

// 6. unreachable server → its own screen (Retry, other servers), never the shell
await openSwitcher()
await clickText('Add Server', { within: 'aside' })
await page.type('aside input[placeholder="Server name"]', 'Gone box')
await page.type('aside input[placeholder="http://192.168.1.100:9876"]', C)
await clickText('Add & Connect', { within: 'aside' })
s = await waitFor((x) => x.text.includes('can’t be reached') && x.text.includes('Retry'), 40000)
await page.screenshot({ path: `${OUT}/5-unreachable.png` })
check('unreachable server: its screen with Retry', s.text.includes('Gone box can’t be reached') && s.text.includes('Retry'))
check('…no shell, no data', !s.main && !s.aside && hasAny(s.html, A_DATA).length === 0)
await clickText('Local Server')
s = await waitFor((x) => x.main)
check('…switch server from it: A', s.main)

// 7. app start: the shell waits for the check; a stale token on start → sign-in
const seen = []
await page.reload({ waitUntil: 'domcontentloaded' })
for (let i = 0; i < 300; i++) { const x = await state(); seen.push(x.main ? 'shell' : x.text.includes('Checking your sign-in') ? 'checking' : x.signin ? 'signin' : 'other'); if (x.main) break; await sleep(50) }
check('start with a good session: checking, then the shell', seen.includes('shell') && !seen.includes('signin'), [...new Set(seen)].join('>'))
await page.evaluate((a) => { const p = JSON.parse(localStorage.getItem('dcs-servers')); p.servers.find((x) => x.url === a).session.token = 'deadbeef'.repeat(8); localStorage.setItem('dcs-servers', JSON.stringify(p)) }, A)
await page.reload({ waitUntil: 'domcontentloaded' })
let sawShell = false
for (let i = 0; i < 100; i++) { const x = await state(); if (x.main) sawShell = true; if (x.signin) break; await sleep(50) }
s = await state()
check('start with a stale token: the sign-in, the shell never shown', s.signin && !sawShell, s.username)

await typeInto('#signin-password', 'Lab-Only-Pass-123'); await page.keyboard.press('Enter')
s = await waitFor((x) => x.main)
check('signed in to A again', s.main)
await noteASession()

// 8. the same person (lab) on B, where they never saved a profile: B's document stays B's, nothing of A's profile is sent
await openSwitcher()
await clickText('Austin hub', { within: 'aside' })
s = await waitFor((x) => x.signin)
await typeInto('#signin-username', 'lab'); await typeInto('#signin-password', 'Lab-Only-Pass-123'); await page.keyboard.press('Enter')
s = await waitFor((x) => x.main)
check('signed in to B as lab', s.main)
await openPage('terminal')
await page.waitForSelector('#terminal-username, input[aria-label="Command"]', { timeout: 30000 })
await sleep(6000) // the profile and the choices are read (and once were seeded) right after the sign-in
const profilePostsToB = toB.filter((x) => x.what === 'POST /settings/profile')
check('B as lab: no profile written to B', profilePostsToB.length === 0, profilePostsToB.map((x) => x.carried.slice(-200)).join(' | '))
const bProfilesAfter = { lab: await bProfile('lab', 'Lab-Only-Pass-123'), austin: await bProfile('austin', 'Austin-Lab-Pass-456') }
check('…B\'s /settings/profile unchanged', JSON.stringify(bProfilesAfter) === JSON.stringify(bProfilesBefore), `${JSON.stringify(bProfilesBefore)} -> ${JSON.stringify(bProfilesAfter)}`)

// 9. sign out of the dashboard after using the Terminal on A: the terminal session ends on A, nothing of it stays
await openSwitcher()
await clickText('Local Server', { within: 'aside' })
s = await waitFor((x) => x.main && hasAny(x.html, A_DATA).length > 0)
await noteASession()
await terminalSignIn()
await page.type('input[aria-label="Command"]', 'echo history-marker-of-A'); await page.keyboard.press('Enter')
await sleep(800)
const logoutsBefore = terminalLogouts.length
const answersBefore = terminalLogoutAnswers.length
await page.evaluate(async () => { await (await import('/src/renderer/stores/authStore.ts')).useAuthStore.getState().logout() })
await sleep(1500)
check('sign-out: the terminal session ended on A', terminalLogouts.slice(logoutsBefore).some((b) => b.includes(TERMINAL_TOKEN)) && terminalLogoutAnswers.slice(answersBefore).includes(200), `${terminalLogouts.length - logoutsBefore} logout(s), A answered ${terminalLogoutAnswers.slice(answersBefore).join(',')}`)
check('…no terminal token left in this tab', (await storedAnywhere(TERMINAL_TOKEN)).length === 0, (await storedAnywhere(TERMINAL_TOKEN)).join(','))
check('…no terminal history left', (await storedAnywhere('history-marker-of-A')).length === 0, (await storedAnywhere('history-marker-of-A')).join(','))

// nothing A issued ever went to B
const carriedToB = toB.filter((x) => [...aIssued].some((v) => x.carried.includes(v)))
check(`no request to B carried a value A issued (${toB.length} requests, ${aIssued.size} values)`, carriedToB.length === 0, carriedToB.slice(0, 3).map((x) => x.what).join(', '))

check('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '))
await browser.close()
const failed = results.filter((x) => !x.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
process.exit(failed.length ? 1 : 0)
