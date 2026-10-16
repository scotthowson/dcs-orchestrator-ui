#!/usr/bin/env node
// =============================================================================
// engine-update — the Updates page against the lab (tests/lab/lab.sh), the engine answers and the update POSTs served
// from a fake kept here (no package manager, no Docker restart):
//
// Docker Engine card on a hub: the VMs' list is there at once (before 4.0.50 the first answer was the hub's own, and the
// VMs and their "Update 1 VM" button came with the next poll, two minutes later); "Update 1 VM" sends
// POST /fleet/docker-engine/update with that VM, shows it updating, follows it and says how it ended (the new version, or
// the VM's reason it did not start); a VM whose package index could not be refreshed says "Index stale", not "Current".
// DCS framework card: an install that cannot fast-forward offers Align (POST /system/update/apply {align: true}) instead
// of a shell command with "git reset --hard".
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep UI=http://localhost:3021 API=http://127.0.0.1:41921 node tests/engine-update.mjs
// Exit status: 0 when every check passed.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021'
const API = process.env.API || 'http://127.0.0.1:41921'
const OUT = path.resolve(process.env.OUT || 'docs/ui-polish/engine-update')
const ADMIN = { user: process.env.LAB_USER || 'lab', pass: process.env.LAB_PASS || 'Lab-Only-Pass-123' }
fs.mkdirSync(OUT, { recursive: true })

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cors = { 'Access-Control-Allow-Origin': '*' }

// ---- the fake: what the VMs' engines say, and what the POSTs did
const fake = {
  started: null, finishWith: null, refuse: null, calls: [], stale: false, diverged: true,
  member(m) {
    if (!m.id) return m
    const x = { ...m, version: '29.8.2', candidate: '29.9.1', upgradable: true, sudo_ready: true, index_stale: false, index_refreshed_at: Math.floor(Date.now() / 1000) }
    if (this.stale) Object.assign(x, { upgradable: false, candidate: '29.8.2', index_stale: true, index_refreshed_at: Math.floor(Date.now() / 1000) - 9 * 86400 })
    if (this.started && this.finishWith) {
      Object.assign(x, { version: this.finishWith === 'done' ? '29.9.1' : '29.8.2', upgradable: this.finishWith !== 'done',
        last_update: { status: this.finishWith, version: this.finishWith === 'done' ? '29.9.1' : '29.8.2', exit_code: this.finishWith === 'done' ? 0 : 100, output: this.finishWith === 'done' ? 'ok' : 'E: Unable to locate package docker-ce', finished_at: new Date().toISOString() } })
    } else if (this.started) {
      x.last_update = { status: 'running', started_at: new Date(this.started).toISOString() }
    }
    return x
  },
}

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
const engineCard = (page) => page.evaluate(() => [...document.querySelectorAll('h3')].find((h) => h.innerText === 'Docker Engine')?.closest('div.rounded-xl')?.innerText ?? '')
async function waitFor(page, fn, ms = 20000) { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await sleep(250) } return false }
async function clickButton(page, re) {
  return page.evaluate((src) => { const re = new RegExp(src); const b = [...document.querySelectorAll('button')].find((x) => re.test(x.innerText) && !x.disabled); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true }, re.source)
}

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox'] })
const errors = []
try {
  const page = await browser.newPage(); await page.setViewport({ width: 1440, height: 900 })
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => { if (m.type() === 'error' && !/ERR_CONNECTION_REFUSED|Failed to load resource/.test(m.text())) errors.push(m.text()) })
  await page.setRequestInterception(true)
  page.on('request', async (r) => {
    const u = r.url(); const p = u.startsWith(API) ? u.slice(API.length) : null
    if (p === null || r.method() === 'OPTIONS') return r.continue()
    if (p.startsWith('/system/docker-engine')) fake.calls.push(`${r.method()} ${p}`)
    if (p.startsWith('/fleet/docker-engine/update') && r.method() === 'POST') {
      fake.calls.push(`POST ${p} ${r.postData()}`)
      const ids = JSON.parse(r.postData() || '{}').members || []
      fake.started = Date.now()
      const results = ids.map((id) => (fake.refuse ? { id, success: false, message: fake.refuse } : { id, success: true, message: 'started' }))
      if (fake.refuse) fake.started = null
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ success: true, results, started: results.filter((x) => x.success).length, failed: results.filter((x) => !x.success).length }) })
    }
    if (p.startsWith('/system/docker-engine?fleet=1') && r.method() === 'GET') {
      const real = await (await fetch(u, { headers: r.headers() })).json()
      real.members = real.members.map((m) => fake.member(m))
      real.upgradable_count = real.members.filter((m) => m.upgradable).length
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(real) })
    }
    if (p.startsWith('/system/update/check') && fake.diverged) {
      const real = await (await fetch(u, { headers: r.headers() })).json()
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ ...real, available: false, checked: true, state: 'diverged', can_align: true, latest_name: 'v4.0.58', latest_version: '4.0.58', latest_commit: 'abc1234' }) })
    }
    if (p.startsWith('/system/update/apply') && r.method() === 'POST') {
      fake.calls.push(`POST ${p} ${r.postData()}`)
      fake.diverged = false
      return r.respond({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify({ updated: true, aligned: true, state: 'updated', previous_version: '4.0.57', new_version: '4.0.58', backup_tag: 'dcs-backup-20261016-120000-abc1234', changelog: [], kept_local: [], replaced_local: [], stack_files_restored: ['Stacks/media-services/.env'], restart_scheduled: false, restart: { method: 'manual', eta_seconds: 0, hint: '' } }) })
    }
    r.continue()
  })

  console.log('Docker Engine card on a hub')
  await signIn(page, 'updates')
  check('the VMs and their Update button are there at once (no two-minute wait)', await waitFor(page, async () => /Update 1 VM/.test(await engineCard(page)), 20000), (await engineCard(page)).slice(0, 200))
  check('the card asked for the fleet (?fleet=1) on its first poll', fake.calls.some((c) => c === 'GET /system/docker-engine?fleet=1'), fake.calls.join(' | '))
  await page.screenshot({ path: path.join(OUT, 'engine-before.png') })
  await clickButton(page, /^\s*Update 1 VM\s*$/)
  check('Update 1 VM sends POST /fleet/docker-engine/update with that VM', await waitFor(page, async () => fake.calls.some((c) => c.startsWith('POST /fleet/docker-engine/update') && c.includes('"media-vm"')), 8000), fake.calls.join(' | '))
  check('…and shows it updating', await waitFor(page, async () => /Updating/.test(await engineCard(page)), 8000), (await engineCard(page)).slice(-300))
  await page.screenshot({ path: path.join(OUT, 'engine-updating.png') })
  fake.finishWith = 'done'
  check('…follows it and says how it ended', await waitFor(page, async () => /Updated[\s\S]*now 29\.9\.1/.test(await engineCard(page)), 20000), (await engineCard(page)).slice(-300))
  await page.screenshot({ path: path.join(OUT, 'engine-done.png') })

  console.log('A VM that refuses: its reason, beside it')
  fake.started = null; fake.finishWith = null; fake.refuse = 'This API has no passwordless sudo here'
  await signIn(page, 'updates')
  await waitFor(page, async () => /Update 1 VM/.test(await engineCard(page)), 20000)
  await clickButton(page, /^\s*Update 1 VM\s*$/)
  check('the VM\'s reason is shown beside it', await waitFor(page, async () => /Update failed[\s\S]*no passwordless sudo/.test(await engineCard(page)), 8000), (await engineCard(page)).slice(-300))
  await page.screenshot({ path: path.join(OUT, 'engine-refused.png') })

  console.log('A VM whose package index could not be refreshed')
  fake.refuse = null; fake.stale = true
  await signIn(page, 'updates')
  check('it says "Index stale", not "Current"', await waitFor(page, async () => /Index stale[\s\S]*last refreshed 9d ago/.test(await engineCard(page)), 20000), (await engineCard(page)).slice(-300))
  check('…and no Update button for it', !/Update 1 VM/.test(await engineCard(page)))
  await page.screenshot({ path: path.join(OUT, 'engine-stale.png') })

  console.log('DCS framework card: cannot fast-forward')
  const main = () => page.evaluate(() => document.querySelector('main')?.innerText ?? '')
  check('Align is offered', await waitFor(page, async () => /Align with v4\.0\.58/.test(await main()), 20000))
  check('no shell command with git reset is shown', !/git reset|reset --hard/i.test(await main()))
  await clickButton(page, /Align with v4\.0\.58/)
  await waitFor(page, async () => /Align with v4\.0\.58\?/.test(await page.evaluate(() => document.body.innerText)), 5000)
  await page.screenshot({ path: path.join(OUT, 'align-confirm.png') })
  await page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.innerText.trim() === 'Align').pop()?.click())
  check('Align sends POST /system/update/apply {align: true}', await waitFor(page, async () => fake.calls.some((c) => c.startsWith('POST /system/update/apply') && /"align":true/.test(c)), 8000), fake.calls.filter((c) => c.includes('apply')).join(' | '))
  check('the report names the stack files put back', await waitFor(page, async () => /put back as they were: Stacks\/media-services\/\.env/.test(await main()), 8000))
  await page.screenshot({ path: path.join(OUT, 'align-done.png') })
  check('no console error or page error', errors.length === 0, errors.slice(0, 3).join(' | '))
} finally {
  await browser.close()
}
console.log(`\nengine-update: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
