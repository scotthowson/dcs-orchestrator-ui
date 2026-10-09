// Images: the fleet scope, the freshness filter and its counts, the search (results count, ✕, empty state), the sort
// headers, Table / Cards, batch mode (select, Select all of what the filter shows, Delete asks first — never
// confirmed — Clear, Exit), Prune (Everywhere explains itself; the hub asks first), the Docker Hub search (empty, a
// search, Pull in Everywhere explains itself), a viewer (no Check registry, batch, prune, pull or automatic updates),
// the phone and the light look.

const SCOPE = '[role="group"][aria-label="Images on"]'
const rowCount = (t) => t.page.evaluate(() => [...document.querySelectorAll('main table tbody tr.group')].length)
const repos = (t) => t.page.evaluate(() => [...document.querySelectorAll('main table tbody tr.group td:not(:has([role="checkbox"])) span[title]')].map((s) => s.getAttribute('title')).filter(Boolean))
/** the freshness filter's options: { All: 16, … } */
const freshCounts = (t) => t.page.evaluate(() => {
  const out = {}
  for (const l of document.querySelectorAll('[aria-label="Show images that are"] label')) { const m = l.innerText.trim().match(/^(\w+)\s*(\d+)$/); if (m) out[m[1]] = Number(m[2]) }
  return out
})
const sortOf = (t, label) => t.page.evaluate((l) => [...document.querySelectorAll('main th[aria-sort]')].find((th) => th.innerText.trim().toLowerCase() === l.toLowerCase())?.getAttribute('aria-sort'), label)
const pressed = (t, name) => t.page.evaluate((n) => [...document.querySelectorAll('[role="group"][aria-label="Images on"] button')].find((b) => b.innerText.trim() === n)?.getAttribute('aria-pressed') === 'true', name)

export default async function images(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Images opens', await a.go('images') && (await a.h1()) === 'Images', await a.h1())
  await a.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 30000)
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 30000)

  // ---- the scope ---------------------------------------------------------------------
  await a.click('Everywhere', { within: SCOPE })
  check('Everywhere lists every image and says where each lives', await a.waitText(/Every image on the hub and its \d+ VM/, { within: 'main', ms: 15000 }) && await pressed(a, 'Everywhere') && await a.waitText('media-vm', { within: 'main table', ms: 15000 }))
  const all = await a.until(() => document.querySelectorAll('main table tbody tr.group').length, null, 15000)
  await a.click('Hub', { within: SCOPE })
  // a switch never shows the old scope's rows under the new label (they go, the new ones come)
  const stale = await a.page.evaluate(() => /media-vm/.test(document.querySelector('main table')?.innerText || ''))
  check('a scope switch never shows the old rows under the new label', !stale)
  check('Hub shows the hub\'s own images', await a.until(() => !/media-vm/.test(document.querySelector('main table')?.innerText || '') && document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000) && await pressed(a, 'Hub'))
  const hub = await rowCount(a)
  await a.click('media-vm', { within: SCOPE })
  check('media-vm shows the VM\'s images and says so', await a.waitText('The images inside the VM media-vm', { within: 'main', ms: 20000 }) && await pressed(a, 'media-vm'))
  await a.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000)
  const vm = await rowCount(a)
  check('…the hub and the VM add up to everywhere', hub + vm === all, `${hub} + ${vm} vs ${all}`)
  await a.click('Everywhere', { within: SCOPE })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, all, 20000)

  // ---- the freshness filter ----------------------------------------------------------------
  const fc = await freshCounts(a)
  check('the freshness filter counts All, Current, Aging, Stale', ['All', 'Current', 'Aging', 'Stale'].every((f) => Number.isFinite(fc[f])) && fc.All === all, JSON.stringify(fc))
  for (const f of ['Current', 'Aging', 'Stale', 'All']) {
    await a.click(new RegExp(`^${f}\\s*\\d+$`), { within: '[aria-label="Show images that are"]' })
    const ok = await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n || (n === 0 && /No \w+ images found/.test(document.querySelector('main')?.innerText || '')), fc[f], 8000)
    check(`the ${f} filter shows its ${fc[f]} rows`, ok, `${await rowCount(a)} rows`)
    if (fc[f] === 0) {
      check(`an empty ${f} filter says so and offers "Show all images"`, await a.hasText(`No ${f.toLowerCase()} images found.`, 'main') && await a.exists('Show all images', { within: 'main' }))
    }
  }

  // ---- the sort headers ---------------------------------------------------------------------
  check('the table opens sorted by repository, ascending', (await sortOf(a, 'Repository')) === 'ascending')
  await a.click('Repository', { within: 'main thead' })
  check('Repository again sorts descending', (await sortOf(a, 'Repository')) === 'descending')
  for (const h of ['Tag', 'Created', 'Size', 'Age (days)', 'Staleness']) {
    await a.click(h, { within: 'main thead' })
    check(`${h} sorts the table`, (await sortOf(a, h)) === 'ascending')
  }
  await a.click('Staleness', { within: 'main thead' })
  check('Staleness again sorts descending', (await sortOf(a, 'Staleness')) === 'descending')
  await a.click('Repository', { within: 'main thead' })

  // ---- the search --------------------------------------------------------------------------
  await a.type('Search images', 'traefik')
  check('the search narrows the rows and counts them', await a.until(() => { const r = [...document.querySelectorAll('main table tbody tr.group')]; return r.length > 0 && r.every((tr) => /traefik/i.test(tr.innerText)) }, null, 8000) && await a.waitText(/\d+ results?/, { within: 'main', ms: 3000 }))
  await a.type('Search images', 'zzz-nothing-like-this')
  check('a search with no match: empty state with a hint and "Clear the search"', await a.waitText('No images match your search.', { within: 'main', ms: 5000 }) && await a.hasText('Try another name, tag or ID.', 'main'))
  check('the empty state\'s "Clear the search" clears it', await a.click('Clear the search', { within: 'main table' }) && await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, all, 8000))
  await a.type('Search images', 'redis')
  check('the ✕ in the box clears the search too', await a.click('Clear the search', { within: 'main', kind: 'button' }) && await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, all, 8000) && (await a.value('Search images')) === '')

  // ---- Table / Cards ----------------------------------------------------------------------------
  await a.click('Cards', { within: '[aria-label="View"]' })
  check('Cards shows the images as cards', await a.until(() => !document.querySelector('main table'), null, 5000) && await a.waitText(/traefik/i, { within: 'main', ms: 5000 }))
  await a.shot('images-cards')
  await a.type('Search images', 'zzz-nothing-like-this')
  check('cards: a search with no match says so', await a.waitText('No images match your search.', { within: 'main', ms: 5000 }))
  await a.click('Clear the search', { within: 'main', kind: 'button' })
  await a.click('Table', { within: '[aria-label="View"]' })
  check('Table brings the table back', await a.until(() => !!document.querySelector('main table'), null, 5000))

  // ---- batch mode (never confirmed) ---------------------------------------------------------------
  await a.click('Hub', { within: SCOPE })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, hub, 20000)
  const hubFc = await freshCounts(a)
  check('Batch mode opens the selection bar', await a.click('Batch mode', { within: 'main' }) && await a.waitText('0 selected', { within: 'main', ms: 5000 }) && await a.page.evaluate(() => document.querySelector('main [aria-label="Exit batch mode"]')?.getAttribute('aria-pressed') === 'true'))
  const firstBox = await a.page.evaluate(() => document.querySelector('main table tbody [role="checkbox"]')?.getAttribute('aria-label'))
  await a.click(firstBox, { within: 'main' })
  check('a row\'s checkbox selects it', await a.waitText('1 selected', { within: 'main', ms: 5000 }))
  const pick = hubFc.Stale > 0 ? 'Stale' : 'Aging'
  await a.click(new RegExp(`^${pick}\\s*\\d+$`), { within: '[aria-label="Show images that are"]' })
  await a.until((n) => document.querySelectorAll('main table tbody tr.group').length === n, hubFc[pick], 8000)
  await a.click('Select all', { within: 'main' })
  check(`Select all takes only the rows the filter shows (${pick})`, await a.waitText(`${hubFc[pick]} selected`, { within: 'main', ms: 5000 }), `${hubFc[pick]} ${pick.toLowerCase()} of ${hubFc.All}: ${(await a.text('main')).match(/\d+ selected/)?.[0]}`)
  await a.click('Delete selected', { within: 'main' })
  const ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('Delete selected asks first (a question, danger, the verb)', ci && ci.title === 'Delete these images?' && ci.danger && ci.buttons.includes('Delete'), JSON.stringify(ci))
  await a.click('Cancel')
  check('Cancel deletes nothing', await a.waitNoDialog(5000) && !(await a.toasts()).some((x) => /Deleted \d+ image/.test(x)))
  await a.click('Clear', { within: 'main' })
  check('Clear empties the selection', await a.waitText('0 selected', { within: 'main', ms: 5000 }))
  await a.click('Exit batch mode', { within: 'main' })
  check('Exit batch mode closes the bar', await a.until(() => !document.querySelector('main table tbody [role="checkbox"]'), null, 5000) && await a.exists('Batch mode', { within: 'main' }))
  await a.click(/^All\s*\d+$/, { within: '[aria-label="Show images that are"]' })

  // ---- prune ------------------------------------------------------------------------------------------
  await a.click('Prune dangling images', { within: 'main' })
  const pi = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('Prune (the hub) asks first (a question, danger, the verb)', pi && pi.title === 'Prune the dangling images?' && pi.danger && pi.buttons.includes('Prune') && /on the hub/.test(pi.message), JSON.stringify(pi))
  await a.key('Escape')
  check('Escape cancels it', await a.waitNoDialog(5000))
  await a.click('Everywhere', { within: SCOPE })
  await a.click('Prune dangling images', { within: 'main' })
  check('Prune in Everywhere explains to pick a server (no call)', await a.waitToast(/Everywhere is a view/, 5000) && !(await a.page.$('[role="alertdialog"]')))
  check('the admin has Check registry and the automatic image updates', await a.exists('Check registry', { within: 'main' }) && await a.waitText(/Automatic image updates/i, { within: 'main', ms: 5000 }))

  // ---- Docker Hub search -------------------------------------------------------------------------------
  await a.click(/Docker Hub search/, { within: '[aria-label="Section"]' })
  check('Docker Hub search opens on its first-step empty state', await a.waitText('Search Docker Hub for container images', { within: 'main', ms: 5000 }))
  check('Search is disabled until something is typed', await a.page.evaluate(() => [...document.querySelectorAll('main form button[type="submit"]')].every((b) => b.disabled)))
  await a.type('Search Docker Hub', 'nginx')
  await a.click('Search', { within: 'main form', kind: 'button' })
  check('a search lists results with stars and an Official badge', await a.waitText(/\d+ results? for “nginx”/, { within: 'main', ms: 20000 }) && await a.hasText('Official', 'main'))
  check('each result offers Pull to an admin', await a.exists('Pull nginx', { within: 'main' }))
  await a.click('Pull nginx', { within: 'main' })
  check('Pull in Everywhere explains to pick a server (nothing pulled)', await a.waitToast(/Everywhere is a view/, 5000))
  check('the ✕ clears the Docker Hub search and its results', await a.click('Clear the search', { within: 'main form' }) && await a.waitText('Search Docker Hub for container images', { within: 'main', ms: 5000 }))
  await a.click(/Image library/, { within: '[aria-label="Section"]' })
  check('Image library brings the table back', await a.until(() => !!document.querySelector('main table'), null, 5000))
  check('Refresh reads the images again', await a.click('Refresh', { within: 'main' }) && await a.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 15000))

  // ---- a viewer -------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Images', await v.go('images') && (await v.h1()) === 'Images')
  await v.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 30000)
  check('a viewer is offered no Check registry (an admin POST)', !(await v.exists('Check registry', { within: 'main' })))
  check('a viewer is offered no Batch mode, Prune or automatic updates', !(await v.exists('Batch mode', { within: 'main' })) && !(await v.exists('Prune dangling images', { within: 'main' })) && !(await v.hasText(/Automatic image updates/i, 'main')))
  await v.click(/Docker Hub search/, { within: '[aria-label="Section"]' })
  await v.type('Search Docker Hub', 'nginx')
  await v.click('Search', { within: 'main form', kind: 'button' })
  check('a viewer searches Docker Hub, without Pull', await v.waitText(/results? for “nginx”/, { within: 'main', ms: 20000 }) && !(await v.exists(/^Pull /, { within: 'main' })))

  // ---- phone, light ----------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('images')
  await p.until(() => /total/.test(document.querySelector('main h1')?.parentElement?.innerText || '') || document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000)
  await p.settle(800)
  check('phone: no sideways scroll on Images', !(await p.overflow()), await p.overflow())
  await p.shot('images-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('images')
  await l.until(() => document.querySelectorAll('main table tbody tr.group').length > 0, null, 20000)
  check('light: Images draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('images-light')
  void repos

  // ---- a failed list ---------------------------------------------------------------------------------
  await checkFailedList(k, 'images', /\/images(\?fleet=1)?$/, () => document.querySelectorAll('main table tbody tr.group').length > 0)
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
