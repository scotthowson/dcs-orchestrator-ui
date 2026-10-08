// The desktop app's "Remember the password on this device", driven in the web build with window.electronAPI stubbed in
// the page (lab API only). What the renderer does is checked: the box is offered, the password goes to the bridge and
// nowhere else, an ended session signs in again by itself, a refused password brings the sign-in back pre-filled, an
// unticked box forgets it. Not exercised: Electron's safeStorage and the main process (tests/credential-vault.mjs).
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/remember-password.mjs        (UI, API to point elsewhere)
import { createRequire } from 'node:module'
import path from 'node:path'
const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021', A = process.env.API || 'http://127.0.0.1:41921'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, ok, detail = '') => { results.push({ ok: !!ok }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`) }

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true })
const page = await browser.newPage()
await page.setViewport({ width: 1440, height: 950 })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
await page.evaluateOnNewDocument((api) => {
  const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d } catch { return d } }
  const write = (k, v) => localStorage.setItem(k, JSON.stringify(v))
  if (!localStorage.getItem('__stub_settings')) write('__stub_settings', { serverUrl: api, theme: 'dark', lastPage: 'dashboard' })
  window.electronAPI = {
    getSettings: async () => read('__stub_settings', {}),
    getSetting: async (k) => read('__stub_settings', {})[k],
    setSetting: async (k, v) => { const s = read('__stub_settings', {}); if (v === undefined || v === null) delete s[k]; else s[k] = v; write('__stub_settings', s); return true },
    getVersion: async () => '0.0.0-stub',
    checkServer: async (url) => { try { const r = await fetch(`${url}/setup/status`); const d = await r.json(); return { reachable: true, initialized: !!d.initialized } } catch { return { reachable: false, initialized: true } } },
    netFetchJson: async (url) => { try { const r = await fetch(url); return { ok: r.ok, status: r.status, data: await r.json() } } catch (e) { return { ok: false, status: 0, data: null, error: String(e) } } },
    credentials: {
      available: async () => true,
      save: async (id, url, username, password) => { const v = read('__stub_vault', {}); v[id] = { url, username, password }; write('__stub_vault', v); return true },
      get: async (id, url) => { const e = read('__stub_vault', {})[id]; return e && e.url === url ? { username: e.username, password: e.password } : null },
      list: async () => Object.keys(read('__stub_vault', {})),
      forget: async (id) => { const v = read('__stub_vault', {}); if (id === '*') write('__stub_vault', {}); else { delete v[id]; write('__stub_vault', v) } return true },
    },
  }
}, A)
const state = () => page.evaluate(() => ({
  main: !!document.querySelector('main'),
  signin: !!document.querySelector('#signin-username'),
  username: document.querySelector('#signin-username')?.value ?? null,
  text: document.body.innerText,
}))
const waitFor = async (pred, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const s = await state(); if (pred(s)) return s; await sleep(150) } return state() }
const ls = () => page.evaluate(() => ({ servers: JSON.parse(localStorage.getItem('dcs-servers') || '{}'), vault: JSON.parse(localStorage.getItem('__stub_vault') || '{}'), all: Object.entries(localStorage).filter(([k]) => k !== '__stub_vault').map(([k, v]) => `${k}=${v}`).join('\n') }))

await page.goto(UI, { waitUntil: 'domcontentloaded' })
await page.evaluate(() => { for (const k of Object.keys(localStorage)) if (k !== '__stub_settings') localStorage.removeItem(k); localStorage.setItem('onboarding_complete', 'true'); localStorage.setItem('dcs-prefs-at-lab', String(Date.now() + 86400000)) })
await page.goto(UI, { waitUntil: 'domcontentloaded' })
let s = await waitFor((x) => x.signin)
check('desktop: the remember-the-password box is offered', s.text.includes('Remember the password on this device'))
await page.type('#signin-username', 'lab'); await page.type('#signin-password', 'Lab-Only-Pass-123')
await page.evaluate(() => [...document.querySelectorAll('button[role="checkbox"]')].find((b) => b.textContent.includes('Remember the password'))?.click())
await page.keyboard.press('Enter')
s = await waitFor((x) => x.main)
check('signed in', s.main)
let st = await ls()
const id = st.servers.activeServerId
check('password handed to the vault for this server', st.vault[id]?.password === 'Lab-Only-Pass-123' && st.vault[id]?.url === A)
check('…and nowhere in localStorage', !st.all.includes('Lab-Only-Pass-123'))
check('profile marked remember', st.servers.servers.find((x) => x.id === id)?.remember === true)

// the token ends on the server: a silent sign-in, the sign-in form never shows
const tok1 = st.servers.servers.find((x) => x.id === id).session.token
await fetch(`${A}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${tok1}` } })
let sawSignin = false
const end = Date.now() + 60000
while (Date.now() < end) { const x = await state(); if (x.signin) sawSignin = true; const t = (await ls()).servers.servers.find((y) => y.id === id)?.session?.token; if (x.main && t && t !== tok1) break; await sleep(100) }
st = await ls(); s = await state()
const tok2 = st.servers.servers.find((x) => x.id === id)?.session?.token
check('expired session + remembered password: signed in again by itself', s.main && tok2 && tok2 !== tok1 && !sawSignin, `new token ${!!tok2 && tok2 !== tok1}, sign-in seen ${sawSignin}`)

// the saved password is no longer right: the sign-in, pre-filled, with a note
await page.evaluate((id) => { const v = JSON.parse(localStorage.getItem('__stub_vault')); v[id].password = 'Not-The-Password-1'; localStorage.setItem('__stub_vault', JSON.stringify(v)) }, id)
await fetch(`${A}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${tok2}` } })
s = await waitFor((x) => x.signin, 60000)
check('remembered password refused: the sign-in, pre-filled', s.signin && !s.main && s.username === 'lab', s.username)
check('…says why', s.text.includes('The saved password was not accepted'))

// sign in again without remembering: the vault forgets it
await page.type('#signin-password', 'Lab-Only-Pass-123')
const boxOn = await page.evaluate(() => [...document.querySelectorAll('button[role="checkbox"]')].find((b) => b.textContent.includes('Remember the password'))?.getAttribute('aria-checked'))
check('…the box stays ticked for a server that remembers', boxOn === 'true')
await page.evaluate(() => [...document.querySelectorAll('button[role="checkbox"]')].find((b) => b.textContent.includes('Remember the password'))?.click())
await page.keyboard.press('Enter')
s = await waitFor((x) => x.main)
st = await ls()
check('unticked: the password is forgotten', s.main && !st.vault[id] && st.servers.servers.find((x) => x.id === id)?.remember === false)

await page.evaluate((id, a) => { const v = JSON.parse(localStorage.getItem('__stub_vault') || '{}'); v[id] = { url: a, username: 'lab', password: 'Lab-Only-Pass-123' }; localStorage.setItem('__stub_vault', JSON.stringify(v)) }, id, A)
await page.reload({ waitUntil: 'domcontentloaded' })
s = await waitFor((x) => x.main)
check('reload: back in (session confirmed)', s.main)
check('no page errors', errors.length === 0, errors.slice(0, 2).join(' | '))
await browser.close()
const failed = results.filter((x) => !x.ok).length
console.log(`\n${results.length - failed}/${results.length} checks passed`)
process.exit(failed ? 1 : 0)
