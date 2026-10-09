// Logs: the scope (the hub's log, a VM's through the hub), the views (Logs / Live / Archives), the search and its empty
// state, the line count, the level filters (Filters, a level, Clear), Auto-scroll, Copy the lines ("Copied", no error)
// and Export the lines (the file and its lines), Log statistics, the live tail (pause, filter, export, clear), the
// archives, a failed read (the output says so, Try again), a viewer, the phone and the light look.

const SCOPE = '[role="group"][aria-label="Log of"]'
const VIEW = '[aria-label="Log view"]'
const lineCount = (t) => t.page.evaluate(() => { const m = (document.querySelector('main [role="status"]')?.innerText || '').match(/^(\d+)(?: \/ (\d+))? lines/); return m ? { shown: Number(m[1]), all: Number(m[2] ?? m[1]) } : null })
const loaded = (t, ms = 30000) => t.until(() => document.querySelectorAll('main [role="log"][aria-label="Log output"] > div:not(.font-sans)').length > 0, null, ms)
async function captureDownloads(t) {
  await t.page.evaluate(() => {
    window.__downloads = []
    const make = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (b) => { const u = make(b); window.__blobOf = window.__blobOf || {}; window.__blobOf[u] = b; return u }
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { window.__downloads.push({ name: this.download, blob: window.__blobOf?.[this.href] }); return }
      return click.call(this)
    }
  })
}
const lastDownload = (t) => t.page.evaluate(async () => { const d = window.__downloads?.at(-1); return d ? { name: d.name, text: d.blob ? await d.blob.text() : '' } : null })

/**
 * The lab's framework log is empty: this tab's GET /logs is answered with 300 made-up lines of every level (honouring
 * lines=, level= and search=), through the DevTools protocol, so the shared lab is untouched. state.fail answers 500.
 */
const LEVELS = ['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'DEBUG', 'STEP']
const FAKE = Array.from({ length: 300 }, (_, i) => `[2026-10-09 05:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}] [${LEVELS[i % LEVELS.length]}] e2e line ${i + 1} ${i % 7 === 0 ? 'stack media-services started' : 'container whoami checked'}`)
async function mockLogs(k, t) {
  const state = { fail: false }
  const cdp = await t.page.createCDPSession()
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${k.API}/*`, requestStage: 'Request' }] })
  cdp.on('Fetch.requestPaused', (e) => {
    const u = new URL(e.request.url)
    if (e.request.method === 'GET' && u.pathname === '/logs') {
      const head = [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: new URL(k.UI).origin }]
      if (state.fail) return cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 500, responseHeaders: head, body: Buffer.from(JSON.stringify({ error: true, code: 500, message: 'Lab failure for logs' })).toString('base64') }).catch(() => {})
      const n = Number(u.searchParams.get('lines') || 500)
      const level = u.searchParams.get('level'); const q = u.searchParams.get('search')
      const lines = FAKE.filter((l) => (!level || l.includes(`[${level}]`)) && (!q || l.toLowerCase().includes(q.toLowerCase()))).slice(-n)
      return cdp.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200, responseHeaders: head, body: Buffer.from(JSON.stringify({ log_file: '/var/log/dcs/e2e.log', lines: lines.length, logs: lines.join('\n') + '\n' })).toString('base64') }).catch(() => {})
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  return state
}

export default async function logs(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  await mockLogs(k, a)
  check('Logs opens on its log', await a.go('logs') && (await a.h1()) === 'Logs' && await loaded(a))
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 20000)
  const c0 = await lineCount(a)
  check('the line count matches the lines shown', !!c0 && c0.shown === await a.page.evaluate(() => document.querySelectorAll('main [role="log"][aria-label="Log output"] > div:not(.font-sans)').length), JSON.stringify(c0))

  // ---- scope ---------------------------------------------------------------------------------------------
  await a.click('Everywhere', { within: SCOPE })
  check('Everywhere says it is the hub\'s own log', await a.waitText("The hub's own framework log", { within: 'main', ms: 8000 }))
  await a.click('media-vm', { within: SCOPE })
  check('media-vm reads the VM\'s log through the hub', await a.waitText('The framework log inside the VM media-vm, polled through the hub', { within: 'main', ms: 8000 }) && await a.until(() => /lines/.test(document.querySelector('main [role="status"]')?.innerText || '') || !!document.querySelector('main [data-state]'), null, 20000))
  await a.click('Hub', { within: SCOPE }); await loaded(a)

  // ---- search, line count ------------------------------------------------------------------------------------
  const someWord = await a.page.evaluate(() => (document.querySelector('main [role="log"] > div:not(.font-sans)')?.innerText.match(/[A-Za-z]{5,}/) || [])[0])
  await a.type('Search the logs', someWord)
  check(`the search narrows the lines ("${someWord}")`, await a.until((w) => { const r = [...document.querySelectorAll('main [role="log"][aria-label="Log output"] > div:not(.font-sans)')]; return r.length > 0 && r.every((d) => d.innerText.toLowerCase().includes(w.toLowerCase())) }, someWord, 8000) && /\d+ \/ \d+ lines/.test(await a.text('main [role="status"]')))
  await a.type('Search the logs', 'zzz-nothing-like-this')
  check('a search with no match: "No lines match your filters"', await a.waitText('No lines match your filters', { within: 'main', ms: 5000 }))
  check('Copy and Export are off with no lines', await a.page.evaluate(() => ['Copy the lines', 'Export the lines'].every((n) => document.querySelector(`main [aria-label="${n}"]`)?.disabled)))
  await a.click('Clear the search', { within: 'main' })
  await loaded(a)
  const n0 = a.requests.length
  await a.page.select('main select[aria-label="Lines"]', '100')
  check('Lines (100) asks for 100 lines and shows no more', await (async () => { const end = Date.now() + 8000; while (Date.now() < end) { if (a.requests.slice(n0).some((r) => /lines=100/.test(r.search))) return true; await k.sleep(200) } return false })() && await a.until(() => document.querySelectorAll('main [role="log"][aria-label="Log output"] > div:not(.font-sans)').length <= 100, null, 8000))
  await a.page.select('main select[aria-label="Lines"]', '500')

  // ---- level filters -----------------------------------------------------------------------------------------
  await a.click('Filters', { within: 'main', kind: 'button' })
  check('Filters opens the level chips with their counts', await a.waitText(/Filter by level/i, { within: 'main', ms: 3000 }))
  const level = await a.page.evaluate(() => [...document.querySelectorAll('main button[aria-pressed]')].map((b) => b.innerText.trim().split(/\s+/)).find(([l, n]) => /^[A-Z]+$/.test(l) && Number(n) > 0)?.[0])
  if (level) {
    await a.click(new RegExp(`^${level}\\s*\\d+$`), { within: 'main' })
    check(`a level chip (${level}) keeps only its lines`, await a.until(() => /\d+ \/ \d+ lines/.test(document.querySelector('main [role="status"]')?.innerText || ''), null, 8000) && await a.page.evaluate((l) => [...document.querySelectorAll('main button[aria-pressed="true"]')].some((b) => b.innerText.startsWith(l)), level))
    check('the Filters button counts the active levels', await a.page.evaluate(() => /Filters\s*1/.test([...document.querySelectorAll('main button[aria-expanded]')].find((b) => /Filters/.test(b.innerText))?.innerText || '')))
    await a.click('Clear', { within: 'main', kind: 'button' })
    check('Clear takes the level filter off', await a.until(() => !/\d+ \/ \d+ lines/.test(document.querySelector('main [role="status"]')?.innerText || ''), null, 8000))
  } else check('the level chips say there is nothing to filter yet', await a.hasText('No log lines to filter yet', 'main'))
  await a.click('Filters', { within: 'main', kind: 'button' })

  // ---- auto-scroll, copy, export --------------------------------------------------------------------------------
  const auto = () => a.page.evaluate(() => [...document.querySelectorAll('main button[aria-pressed]')].find((b) => /Auto-scroll/.test(b.innerText))?.getAttribute('aria-pressed'))
  check('Auto-scroll starts on (the log at its end)', (await auto()) === 'true' && await a.page.evaluate(() => { const l = document.querySelector('main [role="log"][aria-label="Log output"]'); return l.scrollHeight - l.scrollTop - l.clientHeight < 40 }))
  await a.click('Auto-scroll', { within: 'main' })
  check('Auto-scroll turns off', (await auto()) === 'false')
  await a.page.evaluate(() => { const l = document.querySelector('main [role="log"][aria-label="Log output"]'); l.scrollTop = 0 })
  await a.click('Auto-scroll', { within: 'main' })
  check('…and on again, back at the end', (await auto()) === 'true' && await a.until(() => { const l = document.querySelector('main [role="log"][aria-label="Log output"]'); return l.scrollHeight - l.scrollTop - l.clientHeight < 40 }, null, 3000))
  const e0 = a.errors.length
  await a.click('Copy the lines', { within: 'main' })
  check('Copy the lines says "Copied" (no error)', await a.until(() => !!document.querySelector('main [aria-label="Copied"]'), null, 3000) && a.errors.length === e0)
  await captureDownloads(a)
  await a.click('Export the lines', { within: 'main' })
  const dl = await a.until(() => (window.__downloads || []).length > 0, null, 5000) && await lastDownload(a)
  const shown = (await lineCount(a))?.shown
  check('Export the lines saves docker-services-<date>.log with the lines shown', !!dl && /^docker-services-\d{4}-\d{2}-\d{2}\.log$/.test(dl.name) && Math.abs(dl.text.split('\n').filter(Boolean).length - shown) <= 5, `${dl?.name} ${dl?.text?.split('\n').length} vs ${shown}`)

  // ---- statistics ---------------------------------------------------------------------------------------------------
  await a.click('Log statistics', { within: 'main' })
  check('Log statistics opens with the numbers (lines, file size, sessions)', await a.waitText(/[\d,]+ lines/, { within: 'main', ms: 10000 }) && await a.waitText(/file size/, { within: 'main', ms: 5000 }) && !(await a.hasText(/\bNaN\b|undefined/, 'main')))
  const s0 = a.requests.length
  const statsRefresh = await a.page.evaluateHandle(() => [...document.querySelectorAll('main h2')].find((h) => h.innerText === 'Log statistics')?.parentElement?.querySelector('button'))
  if (statsRefresh.asElement()) await statsRefresh.asElement().click()
  await statsRefresh.dispose()
  check('the statistics read again on their Refresh', await (async () => { const end = Date.now() + 8000; while (Date.now() < end) { if (a.requests.slice(s0).some((r) => /\/logs\/stats/.test(r.path))) return true; await k.sleep(200) } return false })())
  await a.click('Log statistics', { within: 'main' })
  check('the button closes them again', await a.until(() => !/Log statistics/.test([...document.querySelectorAll('main h2')].map((h) => h.innerText).join(' ')), null, 3000))

  // ---- Live ------------------------------------------------------------------------------------------------------------
  await a.click('Live', { within: VIEW })
  check('the Live view offers one Export (its own), no Copy of the other view\'s lines', await a.until(() => document.querySelectorAll('main [aria-label="Export the lines"]').length === 1 && !document.querySelector('main [aria-label="Copy the lines"]'), null, 8000))
  check('Live shows the live tail', await a.until(() => !!document.querySelector('main [aria-label="Export the lines"]') && !document.querySelector('main select[aria-label="Lines"]'), null, 10000) && await a.until(() => !/Reading the log/.test(document.querySelector('main')?.innerText || ''), null, 20000))
  const liveBtn = () => a.page.evaluate(() => [...document.querySelectorAll('main button[aria-pressed]')].find((b) => /^(Live|Paused)/.test(b.innerText.trim())))
  void liveBtn
  await a.type('Filter the lines', 'zzz-nothing-like-this')
  check('the live filter with no match says so', await a.waitText('No lines match your filter', { within: 'main', ms: 5000 }))
  await a.click('Clear the search', { within: 'main' })
  await a.click('Level filter', { within: 'main' })
  check('Level filter offers All, ERROR, WARN, INFO, DEBUG', await a.until(() => ['All', 'ERROR', 'WARN', 'INFO', 'DEBUG'].every((l) => [...document.querySelectorAll('main button[aria-pressed]')].some((b) => b.innerText.trim() === l)), null, 3000))
  await a.click('INFO', { within: 'main' })
  check('a level (INFO) is chosen and the menu closes', await a.until(() => !document.querySelector('main button[title="Only info lines"]'), null, 3000))
  await a.click('Level filter', { within: 'main' })
  check('…the menu marks the level chosen', await a.page.evaluate(() => document.querySelector('main button[title="Only info lines"]')?.getAttribute('aria-pressed') === 'true'))
  await a.click('All', { within: 'main', kind: 'button' })
  await captureDownloads(a)
  await a.click('Export the lines', { within: 'main' })
  const ld = await a.until(() => (window.__downloads || []).length > 0, null, 5000) && await lastDownload(a)
  check('the live export saves logs-app-<time>.txt (no colons in the name)', !!ld && /^logs-app-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.txt$/.test(ld.name), ld?.name)
  await a.click('Clear the buffer', { within: 'main' })
  check('Clear the buffer empties the tail', await a.waitText('Waiting for log output…', { within: 'main', ms: 3000 }))
  await k.sleep(5000)
  check('…and the old lines do not come straight back (the tail goes on from where it was)', await a.hasText('Waiting for log output…', 'main') || await a.page.evaluate(() => document.querySelectorAll('main .font-mono > div').length < 20))

  // ---- Archives -----------------------------------------------------------------------------------------------------------
  await a.click('Archives', { within: VIEW })
  check('Archives lists the rotated files (or says there are none)', await a.until(() => /files, .* total|No archived log files found/.test(document.querySelector('main')?.innerText || ''), null, 15000))
  await a.click('Logs', { within: VIEW })
  check('Logs brings the log back', await loaded(a))
  await a.shot('logs-admin')

  // ---- a failed read --------------------------------------------------------------------------------------------------------
  const f = await k.open(k.ADMIN)
  const fs = await mockLogs(k, f)
  fs.fail = true
  f.expectFailures = /\/logs(\?|$)/
  await f.go('logs'); await f.reload()
  check('a failed read: the output says so with the server\'s message (not "Loading" for ever)', await f.until(() => [...document.querySelectorAll('main [data-state="error"]')].some((e) => /Lab failure for logs/.test(e.innerText)), null, 30000) && !(await f.hasText('Loading the logs…', 'main')))
  fs.fail = false
  await f.click('Try again', { within: 'main' })
  check('Try again brings the lines back', await loaded(f))
  f.errors = f.errors.filter((x) => !/HTTP 500/.test(x))

  // ---- a viewer ---------------------------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  await mockLogs(k, v)
  check('a viewer reads the logs', await v.go('logs') && (await v.h1()) === 'Logs' && await loaded(v))
  await v.click('Archives', { within: VIEW })
  check('a viewer opens the archives', await v.until(() => /files, .* total|No archived log files found|Failed to load archived logs/.test(document.querySelector('main')?.innerText || ''), null, 15000))
  await v.click('Logs', { within: VIEW })

  // ---- phone, light -----------------------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await mockLogs(k, p)
  await p.go('logs'); await loaded(p); await p.settle(600)
  check('phone: no sideways scroll on Logs', !(await p.overflow()), await p.overflow())
  await p.shot('logs-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await mockLogs(k, l)
  await l.go('logs'); await loaded(l)
  check('light: Logs draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('logs-light')
}
