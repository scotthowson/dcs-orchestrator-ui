// Health: the fleet scope and the per-server chips (no old report under a new label), the verdict and the score, the
// views (Table / Last 30 min), the filters, the search and its empty state, the sort header, Export the report (the
// file and what is in it), Refresh, a failed report (the kit's failed state, Try again), a viewer, the phone and the
// light look.

const SCOPE = '[role="group"][aria-label="Show"]'
const VIEW = '[aria-label="How to show the containers"]'
const FILTER = '[aria-label="Filter the containers"]'
/** the names in the health table */
const rows = (t) => t.page.evaluate(() => [...document.querySelectorAll('main table tbody tr td[title]:first-child')].filter((td) => td.getClientRects().length).map((td) => td.getAttribute('title')))
const loaded = (t, ms = 30000) => t.until(() => document.querySelectorAll('main table tbody tr td[title]:first-child').length > 0, null, ms)
/** a download the page starts: its file name and its text, without saving anything */
async function captureDownloads(t) {
  await t.page.evaluate(() => {
    window.__downloads = []
    const make = URL.createObjectURL.bind(URL)
    URL.createObjectURL = (b) => { const u = make(b); window.__blobOf = window.__blobOf || {}; window.__blobOf[u] = b; return u }
    const click = HTMLAnchorElement.prototype.click
    HTMLAnchorElement.prototype.click = function () {
      if (this.download) { const b = window.__blobOf?.[this.href]; window.__downloads.push({ name: this.download, blob: b }); return }
      return click.call(this)
    }
  })
}
const lastDownload = (t) => t.page.evaluate(async () => { const d = window.__downloads?.at(-1); return d ? { name: d.name, text: d.blob ? await d.blob.text() : '' } : null })

export default async function health(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Health opens', await a.go('health') && (await a.h1()) === 'Health', await a.h1())
  await loaded(a)
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 30000)

  // ---- scope -------------------------------------------------------------------------------------
  await a.click('Everywhere', { within: SCOPE })
  check('Everywhere: every container, live, with a chip per server', await a.waitText(/Every container on the hub and its \d+ VM/, { within: 'main', ms: 15000 }) && await a.until(() => [...document.querySelectorAll('main button')].some((b) => /^Hub\b.*healthy/.test(b.innerText.replace(/\s+/g, ' '))) && [...document.querySelectorAll('main button')].some((b) => /VM #\d+ · media-vm/.test(b.innerText)), null, 15000))
  await loaded(a)
  const all = (await rows(a)).length
  check('the verdict and the score say something (no NaN or undefined)', await a.until(() => { const t = document.querySelector('main')?.innerText || ''; return /Health score/i.test(t) && !/NaN|undefined/.test(t) && !!document.querySelector('main [role="img"][aria-label^="Health score"]') }, null, 15000))
  // a server's chip narrows the page to it
  const vmChip = await a.find(/VM #\d+ · media-vm/, { within: 'main', kind: 'button' })
  await vmChip.click(); await vmChip.dispose()
  check('a server\'s chip opens its scope (media-vm)', await a.waitText('The containers inside the VM media-vm, live', { within: 'main', ms: 10000 }))
  const stale = await a.page.evaluate((n) => [...document.querySelectorAll('main table tbody tr td[title]:first-child')].length === n, all)
  check('a scope switch never shows the old report\'s rows under the new label', !stale)
  await loaded(a)
  const vm = (await rows(a)).length
  await a.click('Hub', { within: SCOPE })
  await a.until(() => !/inside the VM/.test(document.querySelector('main')?.innerText || ''), null, 10000)
  await loaded(a); await a.settle(500)
  const hub = (await rows(a)).length
  check('…the hub and the VM add up to everywhere', hub + vm === all, `${hub} + ${vm} vs ${all}`)

  // ---- filters, search, sort -----------------------------------------------------------------------------
  for (const [f, test] of [['Healthy', /healthy/i], ['Unhealthy', /unhealthy/i], ['Stopped', /exited|stopped|created/i], ['On demand', /on demand|asleep/i]]) {
    await a.click(f, { within: FILTER })
    const ok = await a.until((src) => {
      const re = new RegExp(src, 'i')
      const trs = [...document.querySelectorAll('main table tbody tr')].filter((tr) => tr.querySelector('td[title]'))
      return (trs.length > 0 && trs.every((tr) => re.test(tr.innerText))) || /No container matches/.test(document.querySelector('main table')?.innerText || '')
    }, test.source, 8000)
    check(`the ${f} filter shows only its containers (or says none match)`, ok, (await rows(a)).join())
  }
  await a.click('All', { within: FILTER })
  await a.until((n) => document.querySelectorAll('main table tbody tr td[title]:first-child').length === n, hub, 8000)
  await a.type('Search the containers', 'traefik')
  // (a row matches by its name, state, health or image: traefik/whoami runs the traefik image)
  check('the search narrows the rows', await a.until(() => { const r = [...document.querySelectorAll('main table tbody tr td[title]:first-child')]; return r.length > 0 && r.every((td) => /traefik/i.test(td.closest('tr').innerText + [...td.closest('tr').querySelectorAll('[title]')].map((e) => e.title).join(' '))) }, null, 8000) && (await rows(a)).length < hub, (await rows(a)).join())
  await a.type('Search the containers', 'zzz-nothing-like-this')
  check('a search with no match says so, with a hint', await a.waitText('No container matches', { within: 'main', ms: 5000 }) && await a.hasText('Try another search or filter.', 'main'))
  check('the ✕ clears the search', await a.click('Clear the search', { within: 'main' }) && await a.until((n) => document.querySelectorAll('main table tbody tr td[title]:first-child').length === n, hub, 8000))
  const asc = await rows(a)
  await a.click('Container', { within: 'main thead' })
  check('the Container header sorts descending', (await rows(a)).join() === [...asc].reverse().join() && await a.page.evaluate(() => document.querySelector('main th[aria-sort]')?.getAttribute('aria-sort') === 'descending'))
  await a.click('Container', { within: 'main thead' })

  // ---- views ----------------------------------------------------------------------------------------------
  await a.click('Last 30 min', { within: VIEW })
  check('Last 30 min shows each container\'s uptime bar', await a.until(() => document.querySelectorAll('main .uptime-bar[role="img"]').length > 0, null, 15000) && await a.waitText(/Container uptime/i, { within: 'main', ms: 3000 }))
  await a.shot('health-timeline')
  await a.click('Table', { within: VIEW })
  check('Table brings the table back', await loaded(a, 8000))

  // ---- export -------------------------------------------------------------------------------------------------
  await captureDownloads(a)
  await a.click('Export the report', { within: 'main' })
  const dl = await a.until(() => (window.__downloads || []).length > 0, null, 5000) && await lastDownload(a)
  let parsed = null
  try { parsed = JSON.parse(dl?.text || '') } catch { /* not JSON */ }
  check('Export the report saves health-report-<date>.json', !!dl && /^health-report-\d{4}-\d{2}-\d{2}\.json$/.test(dl.name), JSON.stringify(dl?.name))
  check('…with the status, the containers and the time', !!parsed && !!parsed.status && Array.isArray(parsed.containers) && parsed.containers.length === hub && !!parsed.exportedAt, dl?.text?.slice(0, 200))
  check('Refresh reads the report again', await a.click('Refresh', { within: 'main' }) && await loaded(a))

  // ---- a viewer -------------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Health and reads the report', await v.go('health') && (await v.h1()) === 'Health' && await loaded(v))
  await captureDownloads(v)
  await v.click('Export the report', { within: 'main' })
  check('a viewer exports the report', !!(await v.until(() => (window.__downloads || []).length > 0, null, 5000)))

  // ---- phone, light ------------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('health'); await p.until(() => /Health score/i.test(document.querySelector('main')?.innerText || ''), null, 30000); await p.settle(800)
  check('phone: no sideways scroll on Health', !(await p.overflow()), await p.overflow())
  await p.shot('health-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('health'); await loaded(l)
  check('light: Health draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('health-light')

  // ---- a failed report -------------------------------------------------------------------------------------------------
  await checkFailedList(k, 'health', /\/health(\?.*)?$/, () => document.querySelectorAll('main table tbody tr td[title]:first-child').length > 0)
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
