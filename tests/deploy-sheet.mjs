#!/usr/bin/env node
// =============================================================================
// deploy-sheet — the template deploy sheet for a stack that runs in a fleet VM, against the lab (tests/lab/lab.sh):
// romm-streaming deployed into entertainment-personal, which the intercepted GET /stacks places in the VM media-vm.
// The VM's own /status (through the hub, intercepted) has one NVIDIA card: the picker shows it, picked by default, and the
// deploy sends its slot as gpu. The template's route_override is one route row, <STREAM_SUBDOMAIN>.<the VM's domain> →
// port <PORT_ROMM_STREAM>, that follows the variables, with its Authelia chip (on: the template's name is in
// authelia_services). Nothing is deployed: the dry run and the deploy are answered here.
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep UI=http://localhost:3021 API=http://127.0.0.1:41921 node tests/deploy-sheet.mjs
// Exit status: 0 when every check passed.
// =============================================================================

import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(process.env.PUPPETEER_DIR ? path.join(path.resolve(process.env.PUPPETEER_DIR), 'package.json') : import.meta.url)
const puppeteer = require('puppeteer-core')
const UI = process.env.UI || 'http://localhost:3021'
const API = process.env.API || 'http://127.0.0.1:41921'
const USER = process.env.LAB_USER || 'lab'
const PASS = process.env.LAB_PASS || 'Lab-Only-Pass-123'

let pass = 0, fail = 0
const check = (name, ok, detail = '') => { if (ok) { pass++; console.log(`  ok   ${name}`) } else { fail++; console.log(`  FAIL ${name}${detail ? ` (${detail})` : ''}`) } }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const GPU = { slot: '0000:01:00.0', vendor: 'nvidia', name: 'NVIDIA GeForce GTX 970', render: null, memory_total_mb: 4096 }
const sent = []
const json = (req, body, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': UI }, body: JSON.stringify(body) })

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1440,1000'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = req.url()
    if (!url.startsWith(API)) return req.continue()
    const p = new URL(url).pathname, m = req.method()
    if (m === 'OPTIONS') return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': UI, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } })
    if (m === 'GET' && p === '/stacks') {
      try {
        const r = await (await fetch(url, { headers: { Authorization: req.headers().authorization ?? '' } })).json()
        const vm = { name: 'entertainment-personal', status: 'running', running_containers: 1, total_containers: 1, placement: 'vm', member: 'media-vm', member_name: 'media-vm' }
        r.stacks = [...(r.stacks ?? []).filter((s) => s.name !== vm.name), vm]
        return json(req, r)
      } catch { return req.continue() }
    }
    if (m === 'GET' && p === '/fleet/members/media-vm/api/status') return json(req, { system: { gpus: [GPU] } })
    if (m === 'GET' && p === '/traefik/status') return json(req, { active: true, domain: 'lab.test', authelia_middleware: 'authelia-forwardauth', sablier: false })
    if (m === 'GET' && p === '/domains') {
      return json(req, { primary: 'lab.test', cloudflare: false, authelia: true, wildcard: false, vm_default: null, domains: [
        { domain: 'lab.test', primary: true, certificate: null, sign_in: true, vms: [] },
        { domain: 'vm.test', primary: false, certificate: null, sign_in: true, vms: [{ id: 'media-vm', name: 'media-vm', vmid: 100 }] }] })
    }
    if (m === 'POST' && /\/templates\/romm-streaming\/dry-run$/.test(p)) {
      return json(req, { success: true, template: 'romm-streaming', target_stack: 'entertainment-personal', services: ['romm-webstation'], service_conflicts: '', has_service_conflicts: false,
        port_conflicts: '', has_port_conflicts: false, env_additions: [], lines_added: 1, compose_preview: '' })
    }
    if (m === 'POST' && /\/templates\/romm-streaming\/deploy$/.test(p)) {
      sent.push({ p, body: JSON.parse(req.postData() || '{}') })
      return json(req, { success: true, target_stack: 'entertainment-personal', services_added: ['romm-webstation'], started: false, message: 'Deployed (test)' })
    }
    return req.continue()
  })

  // sign in on the Templates page
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.evaluate((api, user) => {
    localStorage.clear()
    localStorage.setItem('app-settings', JSON.stringify({ serverUrl: api, theme: 'dark', lastPage: 'templates' }))
    localStorage.setItem('onboarding_complete', 'true')
    localStorage.setItem('dcs-prefs-at-' + user, String(Date.now() + 86400000))
  }, API, USER)
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('main, input[placeholder="Enter password"]', { timeout: 30000 })
  if (await page.$('input[placeholder="Enter password"]')) {
    await page.type('input[placeholder="Enter username"]', USER)
    await page.type('input[placeholder="Enter password"]', PASS)
    await page.keyboard.press('Enter')
    await page.waitForSelector('main', { timeout: 30000 })
  }
  // open romm-streaming's deploy sheet
  const opened = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('main button')].find((x) => /^Deploy RomM Emulator Streaming/.test(x.getAttribute('aria-label') || x.innerText || ''))
    if (b) { b.click(); return true }
    const s = document.querySelector('main input[type="search"], main input[placeholder*="earch"]')
    if (s && s.value !== 'romm') { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(s, 'romm'); s.dispatchEvent(new Event('input', { bubbles: true })) }
    return false
  }, { timeout: 30000, polling: 500 }).then(() => true).catch(() => false)
  check('the deploy sheet of romm-streaming opens', opened && !!(await page.waitForSelector('[role="dialog"]', { timeout: 15000 }).catch(() => null)))
  const dlg = () => page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'))

  // the VM's graphics card
  const picker = await page.waitForSelector('[role="dialog"] select[aria-label="The graphics card its services use"]', { timeout: 15000 }).catch(() => null)
  check('the VM\'s graphics card picker is shown', !!picker)
  const pick = picker ? await page.evaluate((s) => ({ value: s.value, options: [...s.options].map((o) => o.textContent) }), picker) : null
  check('…its one card picked by default', pick?.value === GPU.slot && /GTX 970/.test(pick?.options[0] ?? ''), JSON.stringify(pick))
  const txt = await dlg()
  check('…said to be the VM\'s, with the graphics capability', /the VM's/.test(txt) && /renders and encodes on this card/.test(txt) && /graphics and video capabilities/.test(txt), txt.slice(0, 300))

  // the template's own route, bound to its variables
  const row = () => page.evaluate(() => document.querySelector('[data-testid="route-override"]')?.innerText ?? '')
  if (!(await row())) {
    await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /HTTPS routing/.test(b.innerText))?.click())
  }
  // the VM's domain once GET /domains has answered
  await page.waitForFunction(() => /vm\.test/.test(document.querySelector('[data-testid="route-override"]')?.innerText ?? ''), { timeout: 10000 }).catch(() => {})
  const r0 = await row()
  check('the route row: stream.<the VM\'s domain> → port 3010 (DCS makes it)', /stream\.vm\.test/.test(r0) && /port 3010/.test(r0) && /DCS makes this route; HTTPS/.test(r0), r0)
  check('…no empty "services with ports" text', !/Each service with ports gets an HTTPS route/.test(await dlg()))
  const setVar = async (label, value) => {
    const el = await page.$(`[role="dialog"] input[aria-label="${label}"]`)
    if (!el) return false
    await el.click({ clickCount: 3 }); await page.keyboard.press('Backspace'); await el.type(value); return true
  }
  const typed = (await setVar('Subdomain', 'games')) && (await setVar('Stream port', '3020'))
  await sleep(300)
  const r1 = await row()
  check('…follows STREAM_SUBDOMAIN and PORT_ROMM_STREAM', typed && /games\.vm\.test/.test(r1) && /port 3020/.test(r1), r1)
  const auth = await page.evaluate(() => document.querySelector('[data-testid="route-override"] button[aria-pressed]')?.getAttribute('aria-pressed'))
  check('…its Authelia chip is on by default', auth === 'true', String(auth))

  // deploy (the dry run and the deploy answered here)
  await page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim() === 'Deploy')?.click())
  for (let i = 0; i < 40 && !sent.length; i++) {
    await sleep(500)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Confirm and deploy$/.test(b.innerText.trim()))?.click())
  }
  const body = sent[0]?.body ?? {}
  check('the deploy goes out', sent.length === 1, (await dlg()).slice(-300))
  check('…with the VM\'s card as gpu', body.gpu === GPU.slot, JSON.stringify(body.gpu))
  check('…the template\'s name in authelia_services (its own route behind Authelia)', (body.authelia_services ?? []).includes('romm-streaming'), JSON.stringify(body.authelia_services))
  check('…the variables the route follows', body.variables?.STREAM_SUBDOMAIN === 'games' && body.variables?.PORT_ROMM_STREAM === '3020', JSON.stringify(body.variables))
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
