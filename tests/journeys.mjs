#!/usr/bin/env node
// =============================================================================
// journeys — a scripted walk through every page of the dashboard, the way a
// person uses it, as an admin and as a viewer, against the lab (tests/lab/lab.sh,
// never a real server). Each file in tests/journeys/ (except lib.mjs) is one
// journey: it opens tabs, presses the page's buttons, tabs, filters, sorts,
// dialogs and forms, and records each control with its evidence. Every tab it
// opened is also held to: no console error, no token in an address, and for a
// viewer no 403 (the page asked for, or offered, an admin's thing).
//
//   tests/lab/lab.sh start
//   PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/journeys.mjs                 # every journey
//   JOURNEYS=stacks,users node tests/journeys.mjs                            # some
// Env: UI, API (the hub), MEMBER_API (a second server), DEAD_API (nothing answers), WIZARD_API (a fresh API),
// LAB_USER/LAB_PASS (an admin), VIEWER_USER/VIEWER_PASS (a viewer: role "user" on the hub and on MEMBER_API),
// CONCURRENCY (3), OUT (docs/ui-polish/journeys). Exit status 0 when every check passed.
// =============================================================================

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import * as lib from './journeys/lib.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const DIR = path.join(HERE, 'journeys')
const only = (process.env.JOURNEYS || '').split(',').map((s) => s.trim()).filter(Boolean)
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.mjs') && f !== 'lib.mjs').sort()
  .filter((f) => !only.length || only.includes(f.replace(/\.mjs$/, '')))
const CONCURRENCY = Number(process.env.CONCURRENCY || 3)

fs.mkdirSync(lib.OUT, { recursive: true })
const results = []
const t0 = Date.now()

async function runOne(file) {
  const mod = await import(pathToFileURL(path.join(DIR, file)).href)
  const name = file.replace(/\.mjs$/, '')
  const j = new lib.Journey(name)
  const tabs = []
  const kit = {
    ...lib,
    j,
    check: j.check.bind(j),
    /** a tab of this journey: closed and held to the global checks at its end */
    open: async (who, opts = {}) => { const t = await lib.open(who, opts); t.label = `${who ? (who === lib.VIEWER || who.user === lib.VIEWER.user ? 'viewer' : who.user) : 'nobody'} ${opts.width || 'desktop'} ${opts.theme || 'dark'}`; tabs.push(t); return t },
  }
  const started = Date.now()
  console.log(`▶ ${name}`)
  try {
    await mod.default(kit)
  } catch (e) {
    j.check('the journey ran to its end', false, e?.stack?.split('\n').slice(0, 3).join(' | ') || String(e))
    for (const t of tabs) await t.shot(`${name}-crash-${tabs.indexOf(t)}`).catch(() => {})
  }
  for (const t of tabs) {
    if (!t.skipGlobal) {
      j.check(`no console errors (${t.label})`, t.errors.length === 0, t.errors.slice(0, 4).join(' || '))
      j.check(`no token in any address (${t.label})`, t.tokenUrls.length === 0, t.tokenUrls.slice(0, 3).join(' || '))
      if (t.who && t.who.user === lib.VIEWER.user) j.check(`no 403 for the viewer (${t.label})`, t.forbidden.length === 0, [...new Set(t.forbidden)].slice(0, 6).join(', '))
    }
    await t.close()
  }
  const ms = Date.now() - started
  results.push({ name, ms, controls: j.controls, notes: j.notes })
  console.log(`■ ${name}: ${j.passed}/${j.controls.length} passed in ${Math.round(ms / 1000)} s${j.failed.length ? ` — ${j.failed.length} FAILED` : ''}`)
}

// a small pool: the lab is one machine, and the journeys of one page do not share state with another's
const queue = [...files]
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
  while (queue.length) await runOne(queue.shift())
}))
await lib.closeBrowser()

results.sort((a, b) => a.name.localeCompare(b.name))
const total = results.reduce((n, r) => n + r.controls.length, 0)
const failed = results.flatMap((r) => r.controls.filter((c) => !c.ok).map((c) => ({ journey: r.name, ...c })))
fs.writeFileSync(path.join(lib.OUT, 'report.json'), JSON.stringify({ at: new Date().toISOString(), ui: lib.UI, api: lib.API, results }, null, 1))
const md = ['| journey | controls tested | passed | failed |', '|---|---:|---:|---:|',
  ...results.map((r) => `| ${r.name} | ${r.controls.length} | ${r.controls.filter((c) => c.ok).length} | ${r.controls.filter((c) => !c.ok).length} |`)]
fs.writeFileSync(path.join(lib.OUT, 'report.md'), md.join('\n') + '\n')
console.log('\n' + '='.repeat(78))
console.log(md.join('\n'))
console.log(`\n${results.length} journeys · ${total} checks · ${failed.length} failed · ${Math.round((Date.now() - t0) / 1000)} s`)
for (const f of failed) console.log(`  FAIL [${f.journey}] ${f.control}${f.evidence ? ` — ${f.evidence}` : ''}`)
console.log(`report: ${path.relative(lib.ROOT, path.join(lib.OUT, 'report.json'))}`)
process.exit(failed.length ? 1 : 0)
