// Volumes: the fleet scope (no old rows under a new label), the tiles, the search and its empty state, the sort
// headers, a row's Delete (asks first; Everywhere explains itself), batch select (select, Select all, the header box,
// Clear, Delete selected's typed confirmation — never confirmed —, a scope switch drops the selection, Everywhere says
// to pick a server first), a viewer (no batch, no delete), the phone and the light look.

const SCOPE = '[role="group"][aria-label="Show"]'
const names = (t) => t.page.evaluate(() => [...document.querySelectorAll('main table tbody tr td span.font-mono[title]')].filter((s) => s.getClientRects().length).map((s) => s.getAttribute('title')))
const sortOf = (t, label) => t.page.evaluate((l) => [...document.querySelectorAll('main th[aria-sort]')].find((th) => th.innerText.trim().toLowerCase() === l.toLowerCase())?.getAttribute('aria-sort'), label)
const loaded = (t, ms = 20000) => t.until(() => document.querySelectorAll('main table tbody tr td span.font-mono[title]').length > 0, null, ms)

export default async function volumes(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Volumes opens', await a.go('volumes') && (await a.h1()) === 'Volumes', await a.h1())
  await loaded(a, 30000)
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 30000)

  // ---- scope --------------------------------------------------------------------------------
  await a.click('Everywhere', { within: SCOPE })
  await a.until(() => /media-vm/.test(document.querySelector('main table')?.innerText || ''), null, 20000)
  const all = (await names(a)).length
  await a.click('Hub', { within: SCOPE })
  check('a scope switch never shows the old rows under the new label', !(await a.page.evaluate(() => /media-vm/.test(document.querySelector('main table')?.innerText || ''))))
  check('Hub lists the hub\'s volumes', await a.until(() => !/media-vm/.test(document.querySelector('main table')?.innerText || '') && document.querySelectorAll('main table tbody tr td span.font-mono[title]').length > 0, null, 20000))
  const hub = (await names(a)).length
  await a.click('media-vm', { within: SCOPE })
  check('media-vm lists the VM\'s volumes', await a.until(() => document.querySelectorAll('main table tbody tr td span.font-mono[title]').length > 0, null, 20000))
  const vm = (await names(a)).length
  check('…the hub and the VM add up to everywhere', hub + vm === all, `${hub} + ${vm} vs ${all}`)
  check('the tiles count the volumes and their storage', await a.page.evaluate((n) => { const t = document.querySelector('main')?.innerText || ''; return new RegExp(`Total volumes\\s*${n}`, 'i').test(t) && /Total storage\s*[\d.]+\s*[KMGT]?i?B/i.test(t) }, vm), (await a.text('main')).slice(0, 300))
  await a.click('Hub', { within: SCOPE })
  await a.until((n) => document.querySelectorAll('main table tbody tr td span.font-mono[title]').length === n, hub, 20000)

  // ---- sort ---------------------------------------------------------------------------------
  const asc = await names(a)
  check('the table opens sorted by name, ascending', (await sortOf(a, 'Name')) === 'ascending' && asc.join() === [...asc].sort((x, y) => x.localeCompare(y)).join(), asc.join())
  await a.click('Name', { within: 'main thead' })
  check('Name again sorts descending', (await sortOf(a, 'Name')) === 'descending' && (await names(a)).join() === [...asc].reverse().join())
  await a.click('Size', { within: 'main thead' })
  check('Size sorts by size (aria-sort on its header)', (await sortOf(a, 'Size')) === 'ascending' && (await sortOf(a, 'Name')) === 'none')
  await a.click('Size', { within: 'main thead' })
  check('Size again sorts descending', (await sortOf(a, 'Size')) === 'descending')
  await a.click('Name', { within: 'main thead' })

  // ---- search -------------------------------------------------------------------------------
  const term = asc[0]
  await a.type('Search volumes', term)
  check('the search narrows the rows', await a.until((q) => { const r = [...document.querySelectorAll('main table tbody tr td span.font-mono[title]')].filter((s) => s.getClientRects().length); return r.length > 0 && r.length < document.querySelectorAll('main table tbody tr').length + 1 && r.every((s) => s.closest('tr').innerText.toLowerCase().includes(q.toLowerCase())) }, term, 8000), term)
  await a.type('Search volumes', 'zzz-nothing-like-this')
  check('a search with no match: empty state with a hint', await a.waitText('No volumes match your search', { within: 'main', ms: 5000 }) && await a.hasText('Try another name, driver or mountpoint.', 'main'))
  check('the empty state\'s "Clear the search" clears it', await a.click('Clear the search', { within: 'main [data-state="empty"]' }) && await a.until((n) => document.querySelectorAll('main table tbody tr td span.font-mono[title]').length === n, hub, 8000))
  await a.type('Search volumes', 'redis')
  check('the ✕ in the box clears the search', await a.click('Clear the search', { within: 'main', kind: 'button' }) && await a.until((n) => document.querySelectorAll('main table tbody tr td span.font-mono[title]').length === n, hub, 8000))

  // ---- a row's Delete (never confirmed) ---------------------------------------------------------
  const first = (await names(a))[0]
  await a.click(`Delete the volume ${first}`, { within: 'main' })
  let ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('a row\'s Delete asks first ("Delete this volume?", danger, "Delete volume")', ci && ci.title === 'Delete this volume?' && ci.danger && ci.buttons.includes('Delete volume'), JSON.stringify(ci))
  check('…Cancel has the focus (danger)', ci && ci.focused === 'Cancel', ci && ci.focused)
  await a.click('Cancel')
  check('Cancel deletes nothing', await a.waitNoDialog(5000) && (await names(a)).includes(first))

  // ---- batch select ---------------------------------------------------------------------------
  check('Batch select opens the bar', await a.click('Batch select', { within: 'main' }) && await a.waitText('0 selected', { within: 'main', ms: 5000 }))
  await a.click(`Select ${first}`, { within: 'main table' })
  check('a row\'s checkbox selects it', await a.waitText('1 selected', { within: 'main', ms: 5000 }))
  await a.click(/^Select all \(\d+\)$/, { within: 'main' })
  check('Select all (n) selects every row shown', await a.waitText(`${hub} selected`, { within: 'main', ms: 5000 }))
  check('the header box then clears the selection', await a.click('Clear the selection', { within: 'main thead' }) && await a.waitText('0 selected', { within: 'main', ms: 5000 }))
  await a.click('Select all', { within: 'main thead' })
  check('…and the header box selects all again', await a.waitText(`${hub} selected`, { within: 'main', ms: 5000 }))
  await a.click('Delete selected', { within: 'main' })
  check('Delete selected opens a typed confirmation that asks a question', await a.waitDialog(new RegExp(`^Delete these ${hub} volumes\\?$`), 5000), JSON.stringify(await a.dialogs()))
  const delBtn = () => a.page.evaluate((n) => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim() === `Delete ${n} volumes`)?.disabled, hub)
  check('its Delete stays disabled until the number is typed', await delBtn() === true)
  await a.page.keyboard.type('1')
  check('a wrong number keeps it disabled', hub === 1 || await delBtn() === true)
  await a.click('Cancel')
  check('Cancel closes it and deletes nothing', await a.waitNoDialog(5000) && (await names(a)).length === hub)
  await a.click('Delete selected', { within: 'main' }); await a.waitDialog(null, 5000)
  await a.key('Escape')
  check('Escape closes it too', await a.waitNoDialog(5000))
  await a.click('media-vm', { within: SCOPE })
  check('a scope switch drops the selection (a delete never goes to the server left behind)', await a.waitText('0 selected', { within: 'main', ms: 8000 }))
  await a.click('Everywhere', { within: SCOPE })
  await a.until(() => /media-vm/.test(document.querySelector('main table')?.innerText || ''), null, 20000)
  await a.click(/^Select all \(\d+\)$/, { within: 'main' })
  await a.click('Delete selected', { within: 'main' })
  check('Delete selected in Everywhere says to pick a server first (no typed confirmation)', await a.waitToast(/Everywhere is a view/, 5000) && !(await a.dialogs()).length)
  await a.click('Exit batch', { within: 'main' })
  check('Exit batch closes the bar', await a.until(() => !document.querySelector('main table [role="checkbox"]'), null, 5000))
  await a.click(`Delete the volume ${first}`, { within: 'main' })
  check('a row\'s Delete in Everywhere says to pick a server first', await a.waitToast(/pick the hub or one VM above, then delete the volume there/, 5000) && !(await a.page.$('[role="alertdialog"]')))
  check('Refresh reads the volumes again', await a.click('Refresh', { within: 'main' }) && await loaded(a))

  // ---- a viewer -------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Volumes', await v.go('volumes') && (await v.h1()) === 'Volumes')
  await loaded(v, 30000)
  check('a viewer is offered no Batch select and no Delete', !(await v.exists('Batch select', { within: 'main' })) && !(await v.exists(/^Delete the volume /, { within: 'main' })))
  await v.type('Search volumes', 'config')
  check('a viewer searches the volumes', await v.until(() => [...document.querySelectorAll('main table tbody tr td span.font-mono[title]')].every((s) => /config/i.test(s.title)), null, 8000))

  // ---- phone, light ---------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('volumes'); await loaded(p); await p.settle(600)
  check('phone: no sideways scroll on Volumes', !(await p.overflow()), await p.overflow())
  check('phone: a row\'s Delete is there without a pointer (thumb-sized)', await p.page.evaluate(() => { const b = document.querySelector('main [aria-label^="Delete the volume "]'); if (!b) return false; const r = b.getBoundingClientRect(); return getComputedStyle(b).opacity !== '0' && r.height >= 28 }))
  await p.shot('volumes-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('volumes'); await loaded(l)
  check('light: Volumes draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('volumes-light')

  // ---- a server with no volumes, on a phone in the light look: the empty state, no sideways scroll ------------
  const e = await k.open(k.ADMIN, { api: process.env.EMPTY_API || 'http://127.0.0.1:41924', width: 'phone', theme: 'light' })
  await e.go('volumes')
  check('an empty server: "No named volumes here" with its hint', await e.waitText('No named volumes here', { within: 'main', ms: 30000 }))
  await e.settle(600)
  check('an empty server, phone: no sideways scroll (the hint does not widen the table)', !(await e.overflow()), await e.overflow())
  await e.shot('volumes-empty-phone-light')

  // ---- a failed list -----------------------------------------------------------------------------
  await checkFailedList(k, 'volumes', /\/volumes(\?fleet=1)?$/, () => document.querySelectorAll('main table tbody tr td span.font-mono[title]').length > 0)
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
