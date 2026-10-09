// Export (admin only): the full system report, each of the nine exports (JSON), the batch (select one, select all,
// clear the selection, export selected), the history (opened, cleared — asked first). Downloads land in a folder of
// this run under OUT and are checked (a JSON file each), then exactly those files and that folder are removed.

import fs from 'node:fs'
import path from 'node:path'

const MAIN = 'main'
const CARDS = [
  ['stacks', 'Stack configurations'], ['health', 'Health report'], ['containers', 'Container inventory'], ['system', 'System & resources'],
  ['images', 'Image inventory'], ['networks', 'Network map'], ['config', 'Server settings'], ['events', 'Event log'], ['audit', 'Audit trail'],
]

async function allowDownloads(t, dir) {
  const cdp = await t.page.createCDPSession()
  try { await cdp.send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }) }
  catch { await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir }) }
}
/** wait for a finished download whose name matches; resolves to its name or null */
async function downloaded(k, dir, re, ms = 20000) {
  for (const end = Date.now() + ms; Date.now() < end; await k.sleep(250)) {
    const f = fs.readdirSync(dir).find((n) => re.test(n) && !n.endsWith('.crdownload'))
    if (f) return f
  }
  return null
}
const isJson = (dir, f) => { try { JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); return true } catch { return false } }

export default async function exportPage(k) {
  const { check } = k
  const dir = path.join(k.OUT, `downloads-export-${Date.now().toString(36)}`)
  fs.mkdirSync(dir, { recursive: true })
  const made = new Set()
  const a = await k.open(k.ADMIN)
  try {
    await allowDownloads(a, dir)
    check('admin: the page opens', await a.go('export') && (await a.h1()) === 'Export', await a.h1())
    check('admin: nine exports are offered, each JSON', await a.until(() => document.querySelectorAll('main button[aria-label^="Export "]').length === 9, null, 15000))
    check('admin: no history button before anything was exported (fresh device)', !(await a.exists(/^History \(/, { within: MAIN })))

    // the full report
    await a.click('Generate report', { within: MAIN })
    const full = await downloaded(k, dir, /^dcs-full-report-\d{4}-\d{2}-\d{2}-\d{4}\.json$/, 30000)
    if (full) made.add(full)
    check('admin: Generate report downloads the full report', !!full && await a.waitToast('Full system report exported', 10000), String(full))
    check('admin: …a JSON file with every part', !!full && isJson(dir, full) && ['status', 'health', 'stacks', 'containers', 'system', 'images', 'networks', 'volumes'].every((p) => p in JSON.parse(fs.readFileSync(path.join(dir, full), 'utf8'))))

    // every export on its own
    for (const [id, title] of CARDS) {
      await a.click(`Export ${title}`, { within: MAIN, dom: true })
      const toastP = a.waitToast(`${title} exported`, 25000)
      const f = await downloaded(k, dir, new RegExp(`^dcs-${id}-\\d{4}-\\d{2}-\\d{2}\\.json$`), 25000)
      if (f) made.add(f)
      const toast = await toastP
      check(`admin: Export ${title} downloads a JSON file`, !!f && toast && isJson(dir, f), `${f} ${toast}`)
      if (f) { fs.rmSync(path.join(dir, f)); made.delete(f) }
    }
    const conf = fs.readdirSync(dir).length ? null : true
    void conf

    // the batch
    await a.click('Select Health report for the batch export', { within: MAIN, dom: true })
    check('admin: a card can be selected (pressed)', await a.until(() => document.querySelector('main button[aria-label="Select Health report for the batch export"]')?.getAttribute('aria-pressed') === 'true', null, 3000))
    check('admin: the batch bar counts it', await a.waitText(/1\s*export selected/, { within: MAIN, ms: 3000 }))
    await a.click('Clear the selection', { within: MAIN, dom: true })
    check('admin: Clear the selection unpresses it', await a.until(() => !document.querySelector('main [aria-pressed="true"][aria-label$="for the batch export"]'), null, 3000))
    await a.click('Select all', { within: MAIN, dom: true })
    check('admin: Select all selects the nine', await a.until(() => document.querySelectorAll('main [aria-pressed="true"][aria-label$="for the batch export"]').length === 9, null, 3000) && await a.waitText(/9\s*exports selected/, { within: MAIN, ms: 3000 }))
    check('admin: …and turns into "Clear the selection"', await a.exists('Clear the selection', { within: 'main section[aria-labelledby="export-individual-title"]', dom: true }))
    await a.click('Clear the selection', { within: 'main section[aria-labelledby="export-individual-title"]', dom: true })
    check('admin: which clears it', await a.until(() => !document.querySelector('main [aria-pressed="true"][aria-label$="for the batch export"]'), null, 3000))
    await a.click('Select System & resources for the batch export', { within: MAIN, dom: true })
    await a.click('Select Network map for the batch export', { within: MAIN, dom: true })
    // a headless browser lets one automatic download through per press (a person's browser asks to allow the rest):
    // the files the page hands to the browser are counted at the link it clicks, the first one is checked on disk
    await a.page.evaluate(() => {
      window.__dl = []
      const click = HTMLAnchorElement.prototype.click
      HTMLAnchorElement.prototype.click = function () { if (this.download) window.__dl.push(this.download); return click.call(this) }
    })
    await a.click('Export selected', { within: MAIN, dom: true })
    const b1 = await downloaded(k, dir, /^dcs-system-/, 25000)
    if (b1) made.add(b1)
    const handed = await a.until(() => (window.__dl || []).length >= 2 && window.__dl, null, 25000)
    check('admin: Export selected hands each selected export to the browser', !!b1 && Array.isArray(handed) && handed.some((n) => /^dcs-system-/.test(n)) && handed.some((n) => /^dcs-networks-/.test(n)) && await a.waitToast('2 exports completed', 15000), `${b1} ${JSON.stringify(handed)}`)
    check('admin: …and empties the selection', await a.until(() => !document.querySelector('main [aria-pressed="true"][aria-label$="for the batch export"]'), null, 5000))

    // the history
    check('admin: the History button counts the exports', await a.until(() => /History \(1[0-3]\)/.test(document.querySelector('main')?.innerText || ''), null, 5000), await a.text('main header'))
    await a.click(/^History \(/, { within: MAIN })
    check('admin: History opens the list', await a.waitText('Export history', { within: MAIN, ms: 4000 }) && await a.hasText('Full system report', 'main section[aria-labelledby="export-history-title"]'))
    check('admin: each entry shows a size (no NaN / undefined)', !/NaN|undefined/.test(await a.text('main section[aria-labelledby="export-history-title"]')))
    await a.reload()
    check('admin: the history is kept after a reload', await a.until(() => /History \(\d+\)/.test(document.querySelector('main')?.innerText || ''), null, 8000))
    await a.click(/^History \(/, { within: MAIN })
    await a.click('Clear the history', { within: MAIN })
    const c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    // regression: the rose "Clear the history" used to empty the list without asking
    check('admin: Clear the history asks first (a question, rose, Cancel focused)', c && /\?$/.test(c.title) && c.danger && c.focused === 'Cancel', JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('admin: Cancel keeps the history', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 3000) && await a.hasText('Export history', MAIN))
    await a.click('Clear the history', { within: MAIN })
    await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000)
    await a.click('Clear the history', { within: '[role="alertdialog"]' })
    check('admin: Clear the history empties it', await a.waitToast('Export history cleared', 6000) && await a.until(() => !/History \(/.test(document.querySelector('main')?.innerText || ''), null, 5000))
    await a.shot('export-admin')
  } finally {
    for (const f of made) fs.rmSync(path.join(dir, f), { force: true })
    // only the files of this run are in it: anything else (a partial download) is ours too, then the folder
    for (const f of fs.readdirSync(dir)) if (/^dcs-.*\.json(\.crdownload)?$|\.crdownload$/.test(f)) fs.rmSync(path.join(dir, f), { force: true })
    fs.rmdirSync(dir)
  }

  // ---- a viewer: the page is an admin's -----------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/export' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('viewer: a link to #/export lands on the dashboard', (await v.currentPage()) !== 'export' && (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)
  await v.go('updates')
  const vs = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('viewer: the Maintenance strip offers no Export, Backups or Cleanup', !vs.some((n) => /^(Export|Backups|Cleanup)/.test(n)), JSON.stringify(vs))

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('export'); await p.waitText('Individual exports', { within: MAIN, ms: 20000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Select all', { within: MAIN })
  check('phone: the batch bar fits (no sideways scroll)', await p.waitText(/9\s*exports selected/, { within: MAIN, ms: 3000 }) && !(await p.overflow()), await p.overflow())
  await p.shot('export-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('export'); await l.waitText('Individual exports', { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('export-light')
}
