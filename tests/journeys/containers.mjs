// Containers: the fleet scope (Everywhere / Hub / media-vm), the filters and their counts, the search and its empty
// state, the sort headers, favourites, the copy of a name, batch select (open, select, Select all of what is on screen,
// the Stop and Remove confirmations — never confirmed — Clear, Exit), a row's quick actions (admins only; Stop asks
// first), the detail (actions that ask first, logs, processes, environment, run command, files, copy, Back, Escape), a
// viewer (nothing an admin does is offered), the phone and the light look.

const SCOPE = '[role="group"][aria-label="Show"]'

/** the names of the rows of the desktop table, in order */
const rows = (t) => t.page.evaluate(() => [...document.querySelectorAll('main table tbody tr.group button[aria-label^="Favorite "]')]
  .filter((b) => b.getClientRects().length).map((b) => b.getAttribute('aria-label').slice('Favorite '.length)))
/** the filter strip: { All: 12, Running: 8, … } */
const filterCounts = (t) => t.page.evaluate(() => {
  const out = {}
  const strip = [...document.querySelectorAll('main .surface')].find((s) => /^All\s*\d+/.test((s.innerText || '').trim()))
  for (const b of strip ? strip.querySelectorAll('button') : []) {
    const m = (b.innerText || '').trim().match(/^(\w+)\s*(\d+)$/)
    if (m) out[m[1]] = Number(m[2])
  }
  return out
})
const pressed = (t, name) => t.page.evaluate((n) => [...document.querySelectorAll('[role="group"][aria-label="Show"] button')].find((b) => b.innerText.trim() === n)?.getAttribute('aria-pressed') === 'true', name)
const sortOf = (t, label) => t.page.evaluate((l) => [...document.querySelectorAll('main th[aria-sort]')].find((th) => th.innerText.trim().toLowerCase() === l.toLowerCase())?.getAttribute('aria-sort'), label)

export default async function containers(k) {
  const { check, sleep } = k
  const a = await k.open(k.ADMIN)
  check('Containers opens', await a.go('containers') && (await a.h1()) === 'Containers', await a.h1())
  await a.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 30000)
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 30000)

  // ---- the fleet scope ------------------------------------------------------
  check('the scope chips offer Everywhere, Hub and media-vm', await a.exists('Everywhere', { within: SCOPE }) && await a.exists('Hub', { within: SCOPE }) && await a.exists('media-vm', { within: SCOPE }))
  await a.click('Everywhere', { within: SCOPE })
  check('Everywhere is pressed and groups the rows by server', await a.until(() => /VM #100 · media-vm/i.test(document.querySelector('main table')?.innerText || '') && /On the hub/i.test(document.querySelector('main table')?.innerText || ''), null, 20000) && await pressed(a, 'Everywhere'))
  const allRows = await rows(a)
  await a.click('Hub', { within: SCOPE })
  check('Hub shows the hub alone (no VM group)', await a.until(() => !/VM #100/.test(document.querySelector('main table')?.innerText || '') && document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000) && await pressed(a, 'Hub'))
  const hubRows = await rows(a)
  check('…and fewer rows than everywhere', hubRows.length > 0 && hubRows.length < allRows.length, `${hubRows.length} of ${allRows.length}`)
  await a.click('media-vm', { within: SCOPE })
  check('media-vm shows the VM\'s containers and says so', await a.waitText('The containers inside the VM media-vm', { within: 'main', ms: 20000 }) && await pressed(a, 'media-vm'))
  await a.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000)
  const vmRows = await rows(a)
  check('…the hub and the VM add up to everywhere', vmRows.length + hubRows.length === allRows.length, `${vmRows.length} + ${hubRows.length} vs ${allRows.length}`)
  await a.click('Everywhere', { within: SCOPE })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, allRows.length, 20000)

  // ---- the filters and their counts -----------------------------------------
  const counts = await filterCounts(a)
  check('the filters carry counts (All, Running, Stopped, Paused)', ['All', 'Running', 'Stopped', 'Paused'].every((f) => Number.isFinite(counts[f])) && counts.All === allRows.length, JSON.stringify(counts))
  for (const f of Object.keys(counts)) {
    await a.click(new RegExp(`^${f}\\s*\\d+$`), { within: 'main' })
    const ok = await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n || (n === 0 && /No \w+ containers right now/.test(document.querySelector('main')?.innerText || '')), counts[f], 10000)
    check(`the ${f} filter shows its ${counts[f]} rows`, ok, `${(await rows(a)).length} rows`)
  }
  if (counts.Paused === 0) check('an empty filter says so and what to do', await a.hasText('No paused containers right now', 'main'))

  // ---- batch select (Select all = what is on screen; Stop and Remove ask first; never confirmed) ----
  await a.click(/^Running\s*\d+$/, { within: 'main' })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, counts.Running, 10000)
  check('Batch select opens the batch bar', await a.click('Batch select', { within: 'main' }) && await a.waitText('0 selected', { within: 'main', ms: 5000 }) && await a.exists('Exit batch', { within: 'main' }))
  check('each row gets a checkbox', await a.until(() => document.querySelectorAll('main table tbody [role="checkbox"]').length > 0, null, 5000))
  const first = (await rows(a))[0]
  await a.click(`Select ${first}`, { within: 'main' })
  check('a row\'s checkbox selects it', await a.waitText('1 selected', { within: 'main', ms: 5000 }) && await a.page.evaluate((n) => document.querySelector(`main [aria-label="Select ${n}"]`)?.getAttribute('aria-checked') === 'true', first))
  await a.click('Select all', { within: 'main' })
  check('Select all takes only the rows on screen (the Running filter)', await a.waitText(`${counts.Running} selected`, { within: 'main', ms: 5000 }), `${counts.Running} running of ${counts.All}: ${(await a.text('main')).match(/\d+ selected/)?.[0]}`)
  await a.click(/^Stop$/, { within: 'main' })
  let ci = await a.waitDialog(null, 5000) && await a.confirmInfo()
  check('batch Stop asks first (a question, danger, the verb)', ci && ci.title === 'Stop these containers?' && ci.danger && ci.buttons.includes('Stop'), JSON.stringify(ci))
  await a.click('Cancel'); await a.waitNoDialog(5000)
  await a.click(/^Remove$/, { within: 'main' })
  ci = await a.waitDialog(null, 5000) && await a.confirmInfo()
  check('batch Remove asks first (a question, danger, the verb)', ci && ci.title === 'Remove these containers?' && ci.danger && ci.buttons.includes('Remove'), JSON.stringify(ci))
  await a.key('Escape')
  check('Escape cancels the confirmation and nothing ran', await a.waitNoDialog(5000) && !(await a.hasText('Batch results', 'main')))
  await a.click('Clear', { within: 'main' })
  check('Clear empties the selection', await a.waitText('0 selected', { within: 'main', ms: 5000 }))
  await a.click('Exit batch', { within: 'main' })
  check('Exit batch closes the bar and the checkboxes', await a.until(() => !document.querySelector('main table tbody [role="checkbox"]'), null, 5000) && await a.exists('Batch select', { within: 'main' }))
  await a.click(/^All\s*\d+$/, { within: 'main' })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, counts.All, 10000)

  // ---- the search -----------------------------------------------------------
  await a.type('Search containers, stacks and VMs', 'radarr')
  check('the search narrows the rows and counts the results', await a.until(() => { const r = [...document.querySelectorAll('main table tbody tr.group')]; return r.length > 0 && r.every((tr) => /radarr/i.test(tr.innerText)) }, null, 8000) && await a.waitText(/\d+ results?/, { within: 'main', ms: 3000 }))
  await a.type('Search containers, stacks and VMs', 'zzz-nothing-like-this')
  check('a search with no match shows the empty state with a hint', await a.waitText('No containers match your search.', { within: 'main', ms: 5000 }) && await a.hasText('Try another name, image, stack or VM.', 'main'))
  check('the ✕ clears the search', await a.click('Clear the search', { within: 'main' }) && await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, counts.All, 8000))

  // ---- the sort headers ------------------------------------------------------
  await a.click('Hub', { within: SCOPE })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, hubRows.length, 20000)
  const asc = await rows(a)
  check('the table opens sorted by name, ascending', (await sortOf(a, 'Name')) === 'ascending' && asc.join() === [...asc].sort((x, y) => x.toLowerCase().localeCompare(y.toLowerCase())).join(), asc.join())
  await a.click('Name', { within: 'main thead' })
  const desc = await rows(a)
  check('Name again sorts descending', (await sortOf(a, 'Name')) === 'descending' && desc.join() === [...asc].reverse().join(), desc.join())
  await a.click('State', { within: 'main thead' })
  check('State sorts by state (aria-sort on its header)', (await sortOf(a, 'State')) === 'ascending' && (await sortOf(a, 'Name')) === 'none')
  await a.click('Uptime', { within: 'main thead' })
  check('Uptime sorts too', (await sortOf(a, 'Uptime')) === 'ascending')
  await a.click('Name', { within: 'main thead' })

  // ---- favourites --------------------------------------------------------------
  const last = (await rows(a)).at(-1)
  await a.click(`Favorite ${last}`, { within: 'main' })
  check('a star makes a favourite and puts it first', await a.until((n) => document.querySelector('main table tbody tr.group button[aria-label^="Favorite "]')?.getAttribute('aria-label') === `Favorite ${n}`, last, 5000) && await a.page.evaluate((n) => document.querySelector(`main [aria-label="Favorite ${n}"]`)?.getAttribute('aria-pressed') === 'true', last))
  await a.click(`Favorite ${last}`, { within: 'main' })
  check('the star again takes it off (back in its place)', await a.until((n) => document.querySelector(`main [aria-label="Favorite ${n}"]`)?.getAttribute('aria-pressed') === 'false', last, 5000) && (await rows(a)).at(-1) === last)

  // ---- copy a name -------------------------------------------------------------
  const whoRow = await a.page.$('main table tbody tr.group')
  await whoRow.hover()
  const copyBefore = a.errors.length
  check('the row\'s copy button copies the name ("Copied", no error)', await a.click('Copy the container name', { within: 'main' }) && await a.until(() => !!document.querySelector('main [aria-label="Copied"]'), null, 3000) && a.errors.length === copyBefore)
  await whoRow.dispose()

  // ---- a row's quick actions (admins only; Stop asks first) -------------------
  // the last row's actions sit at the bottom of a page that cannot scroll further: nothing may cover them
  const covered = await a.page.evaluate(() => {
    const bs = [...([...document.querySelectorAll('main table tbody tr.group')].at(-1)?.querySelectorAll('button[aria-label^="Stop "], button[aria-label^="Restart "], button[aria-label^="Start "], button[aria-label^="Wake "]') || [])]
    if (!bs.length) return 'no action button'
    bs[0].scrollIntoView({ block: 'center' })
    const hit = bs.map((b) => { const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return b.contains(top) ? '' : `${b.getAttribute('aria-label')} covered by <${top?.tagName.toLowerCase()} aria-label="${top?.closest('[aria-label]')?.getAttribute('aria-label')}">` })
    return hit.filter(Boolean).join('; ')
  })
  check('the last row\'s quick actions are not covered (the chat bubble)', !covered, covered)
  check('a running row offers Restart and Stop', await a.exists('Restart redis', { within: 'main' }) && await a.exists('Stop redis', { within: 'main' }))
  await a.click('Stop redis', { within: 'main' })
  ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('a row\'s Stop asks "Stop redis?" (danger, the verb)', ci && ci.title === 'Stop redis?' && ci.danger && ci.buttons.includes('Stop'), JSON.stringify(ci))
  await a.click('Cancel')
  check('Cancel leaves it running', await a.waitNoDialog(5000) && await a.exists('Stop redis', { within: 'main' }))
  // the lab's docker refuses every change: Restart shows the error path, not a silent nothing
  await a.click('Restart redis', { within: 'main' })
  check('a refused Restart says so in a toast', await a.waitToast(/restart redis/i, 20000), JSON.stringify(await a.toasts()))

  // ---- the detail ----------------------------------------------------------------
  await a.click('whoami', { within: 'main table' })
  check('a row opens the container\'s detail', await a.until(() => document.querySelector('main h1')?.textContent === 'whoami', null, 15000) && await a.exists('Back', { within: 'main' }))
  await a.until(() => /Container info/i.test(document.querySelector('main')?.innerText || ''), null, 15000)
  for (const [btn, title, danger] of [['Stop', 'Stop whoami?', true], ['Restart', 'Restart whoami?', false], ['Recreate', 'Recreate whoami?', true], ['Remove', 'Remove this container?', true]]) {
    await a.click(btn, { within: 'main', kind: 'button' })
    const info = await a.waitDialog(null, 5000) && await a.confirmInfo()
    check(`the detail's ${btn} asks first ("${title}"${danger ? ', danger' : ''})`, info && info.title === title && info.danger === danger && info.buttons.includes(btn), JSON.stringify(info))
    await a.click('Cancel'); await a.waitNoDialog(5000)
  }
  check('…and none of them ran (no toast of a stop, restart, recreate or remove)', !(await a.toasts()).some((x) => /(Stopping|Recreating|Removing|Restarting) "whoami"/.test(x)), JSON.stringify(await a.toasts()))
  check('the detail shows the resource stats and the container info', await a.waitText(/Resource stats/i, { within: 'main', ms: 10000 }) && await a.hasText(/Container info/i, 'main'))
  const copyErr = a.errors.length
  check('Copy the image copies ("Copied", no error)', await a.click('Copy the image', { within: 'main' }) && await a.until(() => !!document.querySelector('main [aria-label="Copied"]'), null, 3000) && a.errors.length === copyErr)
  await a.click('Logs', { within: 'main', kind: 'button' })
  check('Logs opens the container\'s logs (snapshot)', await a.waitText(/Container logs/i, { within: 'main', ms: 15000 }) && await a.until(() => !!document.querySelector('main pre[aria-label="Container logs"]'), null, 15000))
  check('the logs offer Snapshot / Live, Download, Refresh, Close', await a.exists('Live', { within: 'main' }) && await a.exists('Download', { within: 'main' }) && await a.exists('Close', { within: 'main' }))
  await a.click('Live', { within: '[aria-label="Log mode"]' })
  check('Live switches to the live stream', await a.until(() => !document.querySelector('main pre[aria-label="Container logs"]') && document.querySelector('[aria-label="Log mode"] input:checked')?.value === 'live', null, 8000))
  await a.click('Snapshot', { within: '[aria-label="Log mode"]' })
  check('Snapshot switches back', await a.until(() => !!document.querySelector('main pre[aria-label="Container logs"]'), null, 8000))
  await a.click('Close', { within: 'main', kind: 'button' })
  check('Close hides the logs', await a.until(() => ![...document.querySelectorAll('main h2')].some((h) => /Container logs/i.test(h.textContent)), null, 5000))
  await a.click('Processes', { within: 'main' })
  check('Processes shows the processes (or says there are none)', await a.until(() => document.querySelector('main [aria-pressed="true"]')?.innerText.includes('Processes') && /PID|No process information available/i.test(document.querySelector('main')?.innerText || ''), null, 15000))
  await a.click('Processes', { within: 'main' })
  const env = await a.find(/Environment variables/i, { within: 'main', kind: 'button' })
  if (env) {
    const before = await env.evaluate((e) => e.getAttribute('aria-expanded'))
    await env.click(); await sleep(300)
    const after = await env.evaluate((e) => e.getAttribute('aria-expanded'))
    check('the environment variables fold and unfold', before !== after, `${before} → ${after}`)
    await env.click(); await env.dispose()
  } else check('the environment variables fold and unfold', false, 'no Environment variables header')
  check('Run command unfolds its field (not run)', await a.click(/Run command/i, { within: 'main' }) && await a.until(() => !!document.querySelector('main [aria-label="Command to run"]'), null, 5000))
  await a.click(/Run command/i, { within: 'main' })
  check('the file browser is there for an admin (open, with its path)', await a.until(() => !!document.querySelector('main nav[aria-label="Path"]'), null, 15000))
  await a.click(/File browser/i, { within: 'main' })
  check('its header folds it', await a.until(() => !document.querySelector('main nav[aria-label="Path"]'), null, 5000))
  await a.click(/File browser/i, { within: 'main' })
  await a.shot('containers-detail-admin')
  await a.page.evaluate(() => document.activeElement?.blur?.())
  await a.key('Escape')
  check('Escape goes back to the list', await a.until(() => document.querySelector('main h1')?.textContent === 'Containers', null, 8000))
  await a.click('whoami', { within: 'main table' })
  await a.until(() => document.querySelector('main h1')?.textContent === 'whoami', null, 15000)
  check('Back goes back to the list', await a.click('Back', { within: 'main' }) && await a.until(() => document.querySelector('main h1')?.textContent === 'Containers', null, 8000))
  check('Refresh reads the list again', await a.click('Refresh', { within: 'main' }) && await a.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 15000))

  // ---- a viewer -----------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Containers', await v.go('containers') && (await v.h1()) === 'Containers')
  await v.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 30000)
  check('a viewer is offered no Batch select', !(await v.exists('Batch select', { within: 'main' })))
  check('a viewer is offered no row Start / Wake / Restart / Stop', !(await v.exists(/^(Start|Wake|Restart|Stop) /, { within: 'main table' })), await v.page.evaluate(() => [...document.querySelectorAll('main table button[aria-label]')].map((b) => b.getAttribute('aria-label')).filter((n) => /^(Start|Wake|Restart|Stop) /.test(n)).join(', ')))
  await v.click('Hub', { within: SCOPE })
  await v.until(() => !/VM #100/.test(document.querySelector('main table')?.innerText || ''), null, 15000)
  await v.click('whoami', { within: 'main table' })
  check('a viewer opens a container\'s detail', await v.until(() => document.querySelector('main h1')?.textContent === 'whoami', null, 15000))
  await v.waitText(/Container info/i, { within: 'main', ms: 15000 })
  const offered = await v.page.evaluate(() => [...document.querySelectorAll('main button')].filter((b) => b.getClientRects().length).map((b) => (b.getAttribute('aria-label') || b.innerText || '').trim()))
  const adminOnly = offered.filter((n) => /^(Start|Wake now|Restart|Recreate|Stop|Remove|Nuke & reinstall|Start on demand|On demand: on|Edit compose|Rename the container)$/.test(n) || /Run command|File browser/i.test(n))
  check('a viewer\'s detail offers none of an admin\'s actions (start, stop, restart, recreate, remove, rename, run, files)', adminOnly.length === 0, adminOnly.join(', '))
  await v.click('Logs', { within: 'main', kind: 'button' })
  check('a viewer reads the logs (snapshot only)', await v.until(() => !!document.querySelector('main pre[aria-label="Container logs"]'), null, 15000) && !(await v.exists('Live', { within: 'main' })))
  await v.click('Back', { within: 'main' })

  // ---- the phone and the light look ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('containers')
  await p.until(() => /\d+ running/.test(document.querySelector('main')?.innerText || ''), null, 20000)
  await p.settle(800)
  check('phone: no sideways scroll on Containers', !(await p.overflow()), await p.overflow())
  check('phone: the rows are cards (no table)', await p.until(() => !document.querySelector('main table')?.getClientRects().length, null, 5000))
  await p.shot('containers-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('containers')
  await l.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000)
  check('light: Containers draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('containers-light')

  // ---- a failed list --------------------------------------------------------------------------------
  await checkFailedList(k, 'containers', /\/containers(\?.*)?$/, () => document.querySelectorAll('main table tbody tr.group').length > 0)
}

/** the list request of this tab answers 500 with `message` while on (DevTools protocol: the shared lab is untouched) */
async function failList(k, t, re, message) {
  const cdp = await t.page.createCDPSession()
  const state = { on: true }
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${k.API}/*`, requestStage: 'Request' }] })
  cdp.on('Fetch.requestPaused', (e) => {
    const u = new URL(e.request.url)
    if (state.on && e.request.method === 'GET' && re.test(u.pathname + u.search)) {
      return cdp.send('Fetch.fulfillRequest', {
        requestId: e.requestId, responseCode: 500,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: new URL(k.UI).origin }],
        body: Buffer.from(JSON.stringify({ error: true, code: 500, message })).toString('base64'),
      }).catch(() => {})
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  t.expectFailures = re
  return { off: () => { state.on = false } }
}

/** a failed list: the kit's failed state with the server's message and Try again, which brings the rows back */
async function checkFailedList(k, page, re, rowsBack) {
  const t = await k.open(k.ADMIN)
  const message = `Lab failure for ${page}`
  const f = await failList(k, t, re, message)
  await t.go(page)
  await t.reload()
  const shown = await t.until((m) => [...document.querySelectorAll('main [data-state="error"]')].some((e) => e.getClientRects().length && e.innerText.includes(m)), message, 45000)
  k.check(`a failed list shows the kit's failed state with the server's message`, !!shown, (await t.text('main')).slice(0, 300))
  k.check('…with Try again, and no zeros or endless shimmer beside it', await t.exists('Try again', { within: 'main' }) && !(await t.page.evaluate(() => [...document.querySelectorAll('main .animate-pulse, main [aria-busy="true"]')].some((e) => e.getClientRects().length))))
  await t.shot(`${page}-failed`)
  f.off()
  await t.click('Try again', { within: 'main' })
  k.check('Try again brings the rows back once the server answers', await t.until(rowsBack, null, 45000))
  t.expectFailures = null
  // the 500s above were made on purpose
  t.errors = t.errors.filter((e) => !/HTTP 500/.test(e))
}
