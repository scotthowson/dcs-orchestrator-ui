#!/usr/bin/env node
// =============================================================================
// backup-excludes — the stack page's "Excluded from backups" card against the lab (tests/lab/lab.sh, server 4.0.59+):
// a folder of the stack's App-Data (a ROM library) is offered by Suggest with its size, added with one click, a
// pattern with a .. is refused before it is sent, Save writes the stack's .dcs-backup-exclude through
// PUT /stacks/{name}/backup-excludes and the card then says what it leaves out; after a reload it is still there. The
// Backups page shows what an archive left out (excluded_bytes, the list served from a fake here).
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep UI=http://localhost:3021 API=http://127.0.0.1:41921 LAB=/tmp/dcs-ui-lab node tests/backup-excludes.mjs
// Exit status: 0 when every check passed.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021'
const API = process.env.API || 'http://127.0.0.1:41921'
const LAB = process.env.LAB || '/tmp/dcs-ui-lab'
const OUT = path.resolve(process.env.OUT || 'docs/ui-polish/backup-excludes')
const ADMIN = { user: process.env.LAB_USER || 'lab', pass: process.env.LAB_PASS || 'Lab-Only-Pass-123' }
const STACK = 'development-tools'
const DIR = path.join(LAB, 'hub', 'Stacks', STACK)
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cors = { 'Access-Control-Allow-Origin': '*' }

// the stack's App-Data: a 3 MiB "ROM library" and a small config beside it
fs.rmSync(path.join(DIR, 'App-Data', 'RomM'), { recursive: true, force: true })
fs.rmSync(path.join(DIR, '.dcs-backup-exclude'), { force: true })
fs.mkdirSync(path.join(DIR, 'App-Data', 'RomM', 'library', 'snes'), { recursive: true })
fs.writeFileSync(path.join(DIR, 'App-Data', 'RomM', 'library', 'snes', 'game.sfc'), Buffer.alloc(3 * 1024 * 1024))
fs.writeFileSync(path.join(DIR, 'App-Data', 'RomM', 'config.yml'), 'x: 1\n')

async function signIn(page, lastPage) {
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.evaluate((api, user, lastPage) => {
    localStorage.clear()
    localStorage.setItem('app-settings', JSON.stringify({ serverUrl: api, theme: 'dark', lastPage }))
    localStorage.setItem('onboarding_complete', 'true')
    localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, API, ADMIN.user, lastPage)
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main, input[placeholder="Enter password"]', { timeout: 30000 })
  if (await page.$('input[placeholder="Enter password"]')) {
    await page.click('input[placeholder="Enter username"]', { clickCount: 3 }); await page.keyboard.press('Backspace')
    await page.type('input[placeholder="Enter username"]', ADMIN.user)
    await page.type('input[placeholder="Enter password"]', ADMIN.pass)
    await page.keyboard.press('Enter')
    await page.waitForSelector('main', { timeout: 30000 })
  }
}
async function waitFor(fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250) } return false }
const card = (page) => page.evaluate(() => document.querySelector('[data-backup-excludes]')?.innerText ?? '')
const rowValues = (page) => page.evaluate(() => [...document.querySelectorAll('[data-exclude-row] input')].map((i) => i.value))
async function openStack(page) {
  await signIn(page, 'stacks')
  const opened = await waitFor(() => page.evaluate((name) => {
    const el = [...document.querySelectorAll('main *')].filter((x) => x.textContent?.trim() === name).pop()
    const c = el?.closest('.cursor-pointer'); if (!c) return false; c.click(); return true
  }, STACK), 20000)
  return opened && waitFor(async () => /Excluded from backups/i.test(await card(page)), 20000)
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] })
const errors = []
const puts = []
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', (r) => {
    const u = r.url(); const p = u.startsWith(API) ? u.slice(API.length) : null
    if (p === null || r.method() === 'OPTIONS') return r.continue()
    if (p.startsWith(`/stacks/${STACK}/backup-excludes`) && r.method() === 'PUT') puts.push(r.postData())
    if (/^\/backups(\?|$)/.test(p) && r.method() === 'GET') {
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ total: 1, backups: [
        { filename: `Docker-Compose-Backup-2026-10-17_030000-${STACK}.tar.gz`, size: '1.2G', timestamp: Math.floor(Date.now() / 1000) - 3600, verified: true, kind: 'stack', stack: STACK, complete: true, excluded_bytes: 76 * 1024 ** 3 },
      ] }) })
    }
    r.continue()
  })

  console.log('The card on the stack page')
  check('the stack page has an "Excluded from backups" card', await openStack(page), (await card(page)).slice(0, 200))
  check('…saying nothing is left out yet, once measured', await waitFor(async () => /Nothing is left out/.test(await card(page)), 30000))
  await page.click('[data-exclude-suggest]')
  check('Suggest offers RomM/library with its size', await waitFor(() => page.evaluate(() => /RomM\/library[\s\S]*3\.\d MB/.test(document.querySelector('[data-exclude-suggestion="RomM/library"]')?.innerText ?? '')), 5000),
    await page.evaluate(() => document.querySelector('[data-exclude-suggestions]')?.innerText ?? 'no list'))
  await page.screenshot({ path: path.join(OUT, 'suggest.png') })
  await page.click('[data-exclude-suggestion="RomM/library"]')
  check('…one click adds it as a row', JSON.stringify(await rowValues(page)) === '["RomM/library"]', JSON.stringify(await rowValues(page)))
  check('…and it is no longer suggested', !(await page.$('[data-exclude-suggestion="RomM/library"]')))

  console.log('A pattern the server would refuse is stopped here')
  await page.evaluate(() => [...document.querySelectorAll('[data-backup-excludes] button')].find((b) => b.innerText.trim() === 'Add')?.click())
  await page.type('[data-exclude-row]:last-child input', '../x')
  check('"../x" says no .. and Save is disabled', /no \.\./.test(await card(page)) && await page.$eval('[data-exclude-save]', (b) => b.disabled))
  await page.click('[data-exclude-row]:last-child button')
  check('…removing that row enables Save', await waitFor(() => page.$eval('[data-exclude-save]', (b) => !b.disabled), 3000))

  console.log('Save')
  await page.click('[data-exclude-save]')
  check('Save sends PUT /stacks/{name}/backup-excludes with the pattern', await waitFor(async () => puts.some((b) => b === '{"patterns":["RomM/library"]}'), 8000), puts.join(' | '))
  check('…the stack folder holds .dcs-backup-exclude', await waitFor(async () => /^RomM\/library$/m.test(fs.existsSync(path.join(DIR, '.dcs-backup-exclude')) ? fs.readFileSync(path.join(DIR, '.dcs-backup-exclude'), 'utf8') : ''), 8000))
  check('…and the card says what it leaves out now', await waitFor(async () => /3\.\d MB · 1 file\b/.test(await card(page)) && /3\.\d MB left out/.test(await card(page)), 15000), (await card(page)).slice(0, 300))
  await page.screenshot({ path: path.join(OUT, 'saved.png') })
  await openStack(page)
  check('after a reload the pattern is still there', await waitFor(async () => JSON.stringify(await rowValues(page)) === '["RomM/library"]', 15000), JSON.stringify(await rowValues(page)))

  console.log('On a phone')
  await page.setViewport({ width: 390, height: 844 })
  await page.evaluate(() => document.querySelector('[data-backup-excludes]')?.scrollIntoView())
  await sleep(500)
  check('the card fits a 390 px phone (no sideways scroll)', await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), String(await page.evaluate(() => document.documentElement.scrollWidth)))
  await page.screenshot({ path: path.join(OUT, 'phone.png') })
  await page.setViewport({ width: 1440, height: 900 })

  console.log('The Backups page')
  await signIn(page, 'backup')
  check('an archive says what its exclusions left out', await waitFor(() => page.evaluate(() => /76\.0 GB left out/.test(document.querySelector('[data-excluded-bytes]')?.innerText ?? '')), 20000))
  await page.screenshot({ path: path.join(OUT, 'backups-list.png') })
  check('no console error or page error', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
  fs.rmSync(path.join(DIR, 'App-Data', 'RomM'), { recursive: true, force: true })
  fs.rmSync(path.join(DIR, '.dcs-backup-exclude'), { force: true })
}
console.log(`\nbackup-excludes: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
