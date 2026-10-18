#!/usr/bin/env node
// =============================================================================
// policy-consent — consent for what the compose policy refuses (4.0.60), against the lab (tests/lab/lab.sh):
//   - the pelican deploy sheet shows "This template needs" (its policy_needs, from the lab's real catalogue)
//     before the deploy, every box unticked; the first deploy carries no allow_policy and no allow_privileged
//   - that deploy is answered 422 with policy_refusals: the sheet lists them, each with its box; ticked, the
//     button says Allow and deploy, and the second deploy carries allow_policy [{rule, service, scope: image}]
//     and succeeds
//   - the Config page lists this server's exceptions (who, when, why) and Remove sends the list back without it
// The stack list, the dry run, the deploys and the compose policy are answered here: nothing is deployed or changed.
//
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep UI=http://localhost:3021 API=http://127.0.0.1:41921 node tests/policy-consent.mjs
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

const deploys = []
const puts = []
const saves = []
const REFUSALS = [
  { rule: 'docker-socket:rw', service: 'pelican-wings', line: 60, image: 'ghcr.io/pelican-dev/wings:latest', message: 'the Docker socket (/run/docker.sock) gives the container the Docker API, and with it the whole host', scope_suggestion: { kind: 'image', value: 'ghcr.io/pelican-dev/wings' } },
  { rule: 'privileged', service: 'pelican-wings', line: 50, image: 'ghcr.io/pelican-dev/wings:latest', message: 'privileged: true gives the container every device and capability of the host, with no isolation', scope_suggestion: { kind: 'image', value: 'ghcr.io/pelican-dev/wings' } },
]
let local = { version: 1, allow: [
  { image: 'ghcr.io/pelican-dev/wings', rules: ['privileged'], reason: 'Wings mounts the server filesystems and applies resource limits', added_by: 'lab', added_at: '2026-10-18T12:00:00Z', source: 'template deploy (pelican)' },
  { image: 'busybox', rules: ['cap:SYS_ADMIN'], reason: 'by hand' },
], devices: { warn: [], ignore: [] } }
const json = (req, body, status = 200) => req.respond({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': UI }, body: JSON.stringify(body) })

const browser = await puppeteer.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: 'new', args: ['--no-sandbox', '--window-size=1440,1000'] })
try {
  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 1000 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  await page.setRequestInterception(true)
  page.on('request', async (req) => {
    const url = req.url()
    if (!url.startsWith(API)) return req.continue()
    const p = new URL(url).pathname, m = req.method()
    if (m === 'OPTIONS') return req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': UI, 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS' } })
    if (m === 'GET' && p === '/stacks') {
      try {
        const r = await (await fetch(url, { headers: { Authorization: req.headers().authorization ?? '' } })).json()
        const st = { name: 'entertainment-personal', status: 'running', running_containers: 1, total_containers: 1, placement: 'hub' }
        r.stacks = [...(r.stacks ?? []).filter((s) => s.name !== st.name), st]
        return json(req, r)
      } catch { return req.continue() }
    }
    if (m === 'POST' && /\/templates\/pelican\/dry-run$/.test(p)) {
      return json(req, { success: true, template: 'pelican', target_stack: 'entertainment-personal', services: ['pelican-panel', 'pelican-wings'], service_conflicts: '', has_service_conflicts: false,
        port_conflicts: '', has_port_conflicts: false, env_additions: [], lines_added: 2, compose_preview: '' })
    }
    if (m === 'POST' && /\/templates\/pelican\/deploy$/.test(p)) {
      const body = JSON.parse(req.postData() || '{}')
      deploys.push(body)
      if (!body.allow_policy) return json(req, { error: true, code: 422, message: 'Compose policy: template deploy (pelican) was refused\nrefused: line 60: services.pelican-wings: the Docker socket … [docker-socket:rw]', policy: { refused: [] }, policy_refusals: REFUSALS }, 422)
      return json(req, { success: true, target_stack: 'entertainment-personal', services_added: ['pelican-panel', 'pelican-wings'], started: false, message: 'Deployed (test)' })
    }
    if (m === 'POST' && p === '/stacks/monitoring-management/compose/validate') {
      return json(req, { valid: false, stack: 'monitoring-management', output: 'refused: line 3: services.dashdot: privileged: true gives the container every device and capability of the host, with no isolation [privileged]',
        policy_refusals: [{ rule: 'privileged', service: 'dashdot', line: 3, image: 'mauricenino/dashdot:latest', message: 'privileged: true gives the container every device and capability of the host, with no isolation', scope_suggestion: { kind: 'image', value: 'mauricenino/dashdot' } }] })
    }
    if (m === 'POST' && p === '/stacks/monitoring-management/compose') {
      saves.push(JSON.parse(req.postData() || '{}'))
      return json(req, { success: true, stack: 'monitoring-management', message: 'Compose file saved successfully', validated: true })
    }
    if (p === '/config/compose-policy') {
      if (m === 'PUT') { const b = JSON.parse(req.postData() || '{}'); puts.push(b); local = { ...local, ...b }; return json(req, { success: true, local }) }
      return json(req, { shipped: { allow: [{ image: 'portainer/portainer-ce', rules: ['docker-socket:rw'], reason: 'x' }] }, local, engine: 'compose', cached_verdicts: 0 })
    }
    return req.continue()
  })

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
  const opened = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('main button')].find((x) => /^Deploy Pelican/.test(x.getAttribute('aria-label') || ''))
    if (b) { b.click(); return true }
    const s = document.querySelector('main input[type="search"], main input[placeholder*="earch"]')
    if (s && s.value !== 'pelican') { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(s, 'pelican'); s.dispatchEvent(new Event('input', { bubbles: true })) }
    return false
  }, { timeout: 30000, polling: 500 }).then(() => true).catch(() => false)
  check('the deploy sheet of pelican opens', opened && !!(await page.waitForSelector('[role="dialog"]', { timeout: 15000 }).catch(() => null)))

  const block = (title) => page.evaluate((t) => {
    const el = document.querySelector(`[role="dialog"] [data-policy-consent="${t}"]`)
    if (!el) return null
    return { text: el.innerText, boxes: [...el.querySelectorAll('input[type="checkbox"]')].map((c) => c.checked) }
  }, title)
  await page.waitForSelector('[role="dialog"] [data-policy-consent="This template needs"]', { timeout: 15000 }).catch(() => null)
  const needs = await block('This template needs')
  check('"This template needs" is shown before the deploy', !!needs, 'no block')
  check('…both of pelican\'s needs, with their reasons', /docker-socket:rw/.test(needs?.text ?? '') && /privileged/.test(needs?.text ?? '') && /game-server containers through the Docker API/.test(needs?.text ?? ''), needs?.text)
  check('…every box unticked', needs?.boxes.length === 2 && needs.boxes.every((b) => !b), JSON.stringify(needs?.boxes))

  // choose the target stack if the sheet did not (pelican's own is entertainment-personal)
  const btn = (re) => page.evaluate((src) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => new RegExp(src).test(b.innerText.trim()))?.innerText.trim() ?? null, re.source)
  const press = (re) => page.evaluate((src) => { const b = [...document.querySelectorAll('[role="dialog"] button')].find((x) => new RegExp(src).test(x.innerText.trim()) && !x.disabled); b?.click(); return !!b }, re.source)
  for (let i = 0; i < 20 && !(await press(/^Deploy$/)); i++) await sleep(500)
  for (let i = 0; i < 40 && deploys.length < 1; i++) {
    await sleep(500)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Confirm and deploy$/.test(b.innerText.trim()))?.click())
  }
  check('the first deploy goes out', deploys.length === 1)
  check('…without consent: no allow_policy, no silent allow_privileged', deploys[0] && !('allow_policy' in deploys[0]) && !deploys[0].allow_privileged, JSON.stringify(deploys[0]))

  await page.waitForSelector('[role="dialog"] [data-policy-consent="The compose policy refused the deploy"]', { timeout: 15000 }).catch(() => null)
  const ref = await block('The compose policy refused the deploy')
  check('the 422\'s refusals are listed, each with its box', ref?.boxes.length === 2 && /line 60/.test(ref.text) && /ghcr\.io\/pelican-dev\/wings/.test(ref.text), ref?.text)
  check('…and the bar says the policy refused it', await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /The compose policy refused it/.test(d.innerText)), { timeout: 10000 }).then(() => true).catch(() => false))
  check('…the button still says Deploy while nothing is ticked', (await btn(/^(Allow and deploy|Deploy)$/)) === 'Deploy')
  await page.evaluate(() => document.querySelectorAll('[role="dialog"] [data-policy-consent="The compose policy refused the deploy"] input[type="checkbox"]').forEach((c) => c.click()))
  await sleep(200)
  check('…ticked: the button says Allow and deploy', (await btn(/^(Allow and deploy|Deploy)$/)) === 'Allow and deploy')
  await press(/^Allow and deploy$/)
  for (let i = 0; i < 40 && deploys.length < 2; i++) {
    await sleep(500)
    await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => /^Confirm and deploy$/.test(b.innerText.trim()))?.click())
  }
  const ap = deploys[1]?.allow_policy ?? []
  check('the second deploy carries the consent', ap.length === 2 && ap.every((a) => a.service === 'pelican-wings' && a.scope === 'image') && ap.some((a) => a.rule === 'privileged') && ap.some((a) => a.rule === 'docker-socket:rw'), JSON.stringify(deploys[1]))
  await sleep(1000)
  const after = await page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].map((d) => d.innerText).join('\n'))
  check('…and the sheet leaves the refusals behind', !/The compose policy refused the deploy/.test(after), after.slice(0, 300))

  // the Config page: this server's exceptions
  await page.keyboard.press('Escape')
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('app-settings') || '{}'); s.lastPage = 'config'; localStorage.setItem('app-settings', JSON.stringify(s)) })
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  const list = await page.waitForSelector('[data-compose-policy-exceptions]', { timeout: 30000 }).catch(() => null)
  const ltxt = list ? await page.evaluate((e) => e.innerText, list) : ''
  check('Config lists this server\'s exceptions', /ghcr\.io\/pelican-dev\/wings/.test(ltxt) && /busybox/.test(ltxt) && /added by lab/.test(ltxt) && /template deploy \(pelican\)/.test(ltxt), ltxt.slice(0, 300))
  check('…and counts the shipped ones', /ships 1 exceptions/.test(ltxt), ltxt.slice(0, 200))
  await page.evaluate(() => document.querySelector('[data-compose-policy-exceptions] button[aria-label^="Remove the exception cap:SYS_ADMIN"]')?.click())
  await sleep(500)
  await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === 'Remove' && b.closest('[role="dialog"], [role="alertdialog"]'))?.click())
  for (let i = 0; i < 20 && !puts.length; i++) await sleep(250)
  check('Remove sends the list back without it, keeping who added the other', puts.length === 1 && puts[0].allow?.length === 1 && puts[0].allow[0].added_by === 'lab', JSON.stringify(puts[0]))

  // the stack editor: the check's refusals with their boxes, Allow and save carries the consent
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('app-settings') || '{}'); s.lastPage = 'stacks'; localStorage.setItem('app-settings', JSON.stringify(s)) })
  await page.goto(UI, { waitUntil: 'domcontentloaded' })
  const edit = await page.waitForFunction(() => {
    const b = [...document.querySelectorAll('main button')].find((x) => (x.getAttribute('aria-label') || x.innerText || '').trim() === 'Edit monitoring-management')
    if (b) { b.click(); return true }
    return false
  }, { timeout: 30000, polling: 500 }).then(() => true).catch(() => false)
  const ta = edit ? await page.waitForSelector('[role="dialog"] textarea.code-input', { timeout: 15000 }).catch(() => null) : null
  check('the stack editor opens', !!ta)
  if (ta) {
    await ta.evaluate((e) => { e.focus(); e.setSelectionRange(e.value.length, e.value.length) })
    await page.keyboard.type('\n# consent test\n', { delay: 3 })
    await sleep(300)
    await press(/^Save$/)
    const shown = await page.waitForSelector('[role="dialog"] [data-policy-consent="The compose policy refuses this file"]', { timeout: 15000 }).catch(() => null)
    check('the check\'s refusal is offered for consent', !!shown && saves.length === 0)
    await page.evaluate(() => document.querySelector('[data-policy-consent="The compose policy refuses this file"] input[type="checkbox"]')?.click())
    await sleep(200)
    check('…ticked: the button says Allow and save', (await btn(/^(Allow and save|Save)$/)) === 'Allow and save')
    await press(/^Allow and save$/)
    for (let i = 0; i < 20 && !saves.length; i++) await sleep(250)
    const al = saves[0]?.allow_policy ?? []
    check('…the save carries allow_policy for the image', al.length === 1 && al[0].rule === 'privileged' && al[0].service === 'dashdot' && al[0].scope === 'image', JSON.stringify(saves[0]?.allow_policy))
  }
  check('no uncaught error on the page', errors.length === 0, errors.join(' | '))
} finally {
  await browser.close()
}
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
