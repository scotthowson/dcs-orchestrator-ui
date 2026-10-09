// When the server fails a request, the page says so the kit's way (ErrorState: the failure in rose, the server's
// message, Try again) and Try again brings the data back once the server answers; when a VM of the fleet stops
// answering, the pages scoped to it say that VM cannot be reached and the rest of the dashboard keeps working.
// The failures are made in this tab only (the DevTools protocol answers the chosen requests 500 / 502), so the
// shared lab is untouched.

// page, the request its list comes from (with any query: a hub's Everywhere asks ?fleet=1), what shows once it answers
// again (Bookmarks is kept in the browser: nothing to fail)
const CASES = [
  ['stacks', /\/stacks(\?|$)/, 'networking-security'],
  ['containers', /\/containers(\?|$)/, 'traefik'],
  ['images', /\/images(\?|$)/, 'traefik'],
  ['volumes', /\/volumes(\?|$)/, 'redis-data'],
  ['networks', /\/networks(\?|$)/, 'proxy'],
  ['health', /\/health(\?|$)/, 'traefik'],
  ['automations', /\/automations(\?|$)/, 'Timed'],
  ['users', /\/auth\/users(\?|$)/, 'austin'],
  ['secrets', /\/secrets(\?|$)/, 'Add'],
]

export default async function errorStates(k) {
  const { check } = k
  const t = await k.open(k.ADMIN)
  const p = t.page
  const cdp = await p.createCDPSession()
  let failing = null   // { re, status }
  await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${k.API}/*`, requestStage: 'Request' }] })
  cdp.on('Fetch.requestPaused', (e) => {
    const u = new URL(e.request.url)
    if (failing && e.request.method === 'GET' && failing.re.test(u.pathname + u.search)) {
      return cdp.send('Fetch.fulfillRequest', {
        requestId: e.requestId, responseCode: failing.status,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Access-Control-Allow-Origin', value: new URL(k.UI).origin }],
        body: Buffer.from(JSON.stringify({ error: true, code: failing.status, message: failing.message })).toString('base64'),
      }).catch(() => {})
    }
    return cdp.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
  })
  // the failures this journey makes are expected: not the page's console errors
  t.expectFailures = /./
  const errorsBefore = () => t.errors.length

  for (const [pageId, re, back] of CASES) {
    failing = { re, status: 500, message: `Lab failure for ${pageId}` }
    await t.go(pageId)
    await t.reload()
    const shown = await t.until(() => [...document.querySelectorAll('main [data-state="error"], main [role="alert"]')].some((e) => e.getClientRects().length), null, 45000)
    const text = await t.page.evaluate(() => [...document.querySelectorAll('main [data-state="error"], main [role="alert"]')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')).join(' | '))
    check(`${pageId}: a failed list shows the failure`, !!shown, text || (await t.text('main')).slice(0, 200))
    check(`${pageId}: …with the server's message`, text.includes(`Lab failure for ${pageId}`), text.slice(0, 200))
    const retry = await t.exists('Try again', { within: 'main' })
    check(`${pageId}: …and Try again`, retry, text.slice(0, 120))
    await t.shot(`error-${pageId}`)
    failing = null
    if (retry) {
      await t.click('Try again', { within: 'main' })
      check(`${pageId}: Try again brings the data back`, await t.until(() => ![...document.querySelectorAll('main [data-state="error"]')].some((e) => e.getClientRects().length), null, 45000) && await t.waitText(back, { within: 'main', ms: 30000 }))
    } else {
      await t.reload()
    }
  }
  void errorsBefore

  // a VM of the fleet stops answering: its pages say so, the hub's keep working
  failing = { re: /^\/fleet\/members\/media-vm\/api\//, status: 502, message: 'media-vm did not answer' }
  await t.go('containers')
  await t.click('media-vm', { within: 'main', ms: 10000 })
  const vmErr = await t.until(() => [...document.querySelectorAll('main [data-state="error"], main [role="alert"]')].some((e) => e.getClientRects().length) || /can.t be reached|did not answer|not answering|unreachable/i.test(document.querySelector('main')?.innerText || ''), null, 45000)
  check('a VM that does not answer: its scope says so', !!vmErr, (await t.text('main')).slice(0, 300))
  await t.shot('error-containers-vm-down')
  await t.click('Hub', { within: 'main', ms: 10000 })
  check('…the hub\'s own scope still lists its containers', await t.waitText('traefik', { within: 'main', ms: 30000 }))
  check('…and the dashboard is still signed in and connected', !!(await p.$('main')) && !(await p.$('#signin-username')))
  failing = null
  await t.click('Everywhere', { within: 'main', ms: 10000 }).catch(() => {})
}
