// Networks: the fleet scope (no old cards under a new label), the tiles, the search and its empty state, the sort
// buttons, the inspect sheet (details, copy an address, Disconnect asks first — never confirmed —, Connect waits for a
// choice, Edit opens the rebuild sheet), the New network sheet (validation of name, subnet, gateway, labels; the
// driver and option toggles; Advanced; Cancel, Escape; Everywhere refuses to create; the hub's refusal shows in the
// sheet), Delete (asks first; Everywhere explains itself), a viewer, the phone (a bottom sheet) and the light look.

const SCOPE = '[role="group"][aria-label="Show"]'
const SORT = '[role="group"][aria-label="Sort the networks"]'
const cards = (t) => t.page.evaluate(() => [...document.querySelectorAll('main [aria-label^="Inspect "]')].map((b) => b.getAttribute('aria-label').slice('Inspect '.length)))
const loaded = (t, ms = 20000) => t.until(() => document.querySelectorAll('main [aria-label^="Inspect "]').length > 0, null, ms)
const problems = (t) => t.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] ul li')].map((li) => li.innerText.trim()))
const createDisabled = (t) => t.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /^Create network$/.test(b.innerText.trim()))?.disabled)

export default async function networks(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Networks opens', await a.go('networks') && (await a.h1()) === 'Networks', await a.h1())
  await loaded(a, 30000)
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 30000)

  // ---- scope ------------------------------------------------------------------------------------
  await a.click('Everywhere', { within: SCOPE })
  await a.until(() => /media-vm/.test(document.querySelector('main')?.innerText || '') && document.querySelectorAll('main [aria-label^="Inspect "]').length > 0, null, 20000)
  const all = (await cards(a)).length
  await a.click('media-vm', { within: SCOPE })
  check('a scope switch never shows the old cards under the new label', (await cards(a)).length !== all, `${(await cards(a)).length} cards right after the switch, ${all} everywhere`)
  await loaded(a)
  const vm = (await cards(a)).length
  await a.click('Hub', { within: SCOPE })
  await a.until(() => document.querySelectorAll('main [aria-label^="Inspect "]').length > 0, null, 20000)
  await a.settle(400)
  const hub = (await cards(a)).length
  check('Everywhere, the hub and the VM: the hub and the VM add up', hub + vm === all, `${hub} + ${vm} vs ${all}`)
  check('the tiles count the networks, the custom ones and the links', await a.page.evaluate((n) => new RegExp(`Total networks\\s*${n}`, 'i').test(document.querySelector('main')?.innerText || ''), hub) && await a.hasText(/Custom networks\s*\d+/i, 'main') && await a.hasText(/Connections\s*\d+/i, 'main'))

  // ---- sort ---------------------------------------------------------------------------------------
  const asc = await cards(a)
  check('the cards open sorted by name, ascending (the button says so)', await a.exists('Name, ascending', { within: SORT }) && asc.join() === [...asc].sort((x, y) => x.localeCompare(y)).join(), asc.join())
  await a.click('Name, ascending', { within: SORT })
  check('Name again sorts descending', await a.exists('Name, descending', { within: SORT }) && (await cards(a)).join() === [...asc].reverse().join())
  await a.click('Driver', { within: SORT })
  check('Driver sorts by driver', await a.exists('Driver, ascending', { within: SORT }))
  await a.click('Containers', { within: SORT })
  check('Containers sorts by the number connected', await a.exists('Containers, ascending', { within: SORT }))
  await a.click('Name', { within: SORT })

  // ---- search --------------------------------------------------------------------------------------
  await a.type('Search networks', 'proxy')
  check('the search narrows the cards', await a.until(() => { const c = [...document.querySelectorAll('main [aria-label^="Inspect "]')]; return c.length > 0 && c.length < 7 }, null, 8000), (await cards(a)).join())
  await a.type('Search networks', 'zzz-nothing-like-this')
  check('a search with no match: the kit\'s empty state with a hint', await a.waitText('No networks match your search.', { within: 'main', ms: 5000 }) && await a.page.evaluate(() => !!document.querySelector('main [data-state="empty"]')))
  check('the empty state\'s "Clear the search" clears it', await a.click('Clear the search', { within: 'main [data-state="empty"]' }) && await a.until((n) => document.querySelectorAll('main [aria-label^="Inspect "]').length === n, hub, 8000))

  // ---- inspect --------------------------------------------------------------------------------------
  const target = asc.includes('proxy') ? 'proxy' : asc.find((n) => !['bridge', 'host', 'none'].includes(n))
  await a.click(`Inspect ${target}`, { within: 'main' })
  check(`Inspect opens the ${target} sheet with its details`, await a.waitDialog(target, 8000) && await a.waitText(/Subnet/i, { within: '[role="dialog"]', ms: 15000 }))
  const connected = await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] [aria-label^="Disconnect "]')].map((b) => b.getAttribute('aria-label')))
  if (connected.length) {
    const copyErr = a.errors.length
    const copy = await a.find('Copy the address', { within: '[role="dialog"]' })
    if (copy) { await copy.click(); await copy.dispose() }
    check('Copy the address copies ("Copied", no error)', !copy || (await a.until(() => !!document.querySelector('[role="dialog"] [aria-label="Copied"]'), null, 3000) && a.errors.length === copyErr))
    await a.click(connected[0], { within: '[role="dialog"]' })
    const ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('Disconnect asks first (a question, danger, the verb)', ci && /^Disconnect .+\?$/.test(ci.title) && ci.danger && ci.buttons.includes('Disconnect'), JSON.stringify(ci))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('Cancel keeps it connected (the sheet stays open)', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 5000) && await a.exists(connected[0], { within: '[role="dialog"]' }))
  } else check('the inspected network lists its containers (or says none)', await a.hasText('No containers connected', '[role="dialog"]'))
  check('Connect waits for a container to be chosen', await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim() === 'Connect')?.disabled === true))
  await a.click('Edit', { within: '[role="dialog"]', kind: 'button' })
  check('Edit opens the rebuild sheet in front (the name fixed)', await a.waitDialog('Edit network', 8000) && await a.page.evaluate(() => document.querySelector('[role="dialog"] input[placeholder="my-network"]')?.disabled === true))
  check('Rebuild network waits for a change', await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Rebuild network/.test(b.innerText))?.disabled === true))
  await a.click('Cancel', { within: '[role="dialog"]' })
  check('Cancel closes the rebuild sheet', await a.waitNoDialog(5000))
  await a.click(`Inspect ${target}`, { within: 'main' }); await a.waitDialog(target, 8000)
  await a.key('Escape')
  check('Escape closes the inspect sheet', await a.waitNoDialog(5000))
  await a.click('Inspect bridge', { within: 'main' })
  check('a built-in network (bridge) has no Edit', await a.waitDialog('bridge', 8000) && await a.waitText(/Subnet/i, { within: '[role="dialog"]', ms: 15000 }) && !(await a.exists('Edit', { within: '[role="dialog"]', kind: 'button' })))
  await a.click('Close', { within: '[role="dialog"]' })
  check('the ✕ closes it', await a.waitNoDialog(5000))

  // ---- New network: validation, then Cancel --------------------------------------------------------
  await a.click('New network', { within: 'main' })
  check('New network opens its sheet with the name field focused', await a.waitDialog('Create Docker network', 8000) && await a.page.evaluate(() => document.activeElement?.getAttribute('placeholder') === 'my-network'))
  check('Create network waits for a name', await createDisabled(a) === true)
  await a.type('Network name', 'bad name!')
  check('a bad name says what is allowed (and Create stays off)', (await problems(a)).some((p) => /letters, digits, dot, dash and underscore/.test(p)) && await createDisabled(a) === true, JSON.stringify(await problems(a)))
  const name = `e2e-dm-net-${Date.now().toString(36)}`
  await a.type('Network name', name)
  check('a good name clears the message and turns Create on', !(await problems(a)).length && await createDisabled(a) === false)
  await a.type('Subnet', 'not-a-subnet')
  check('a bad subnet asks for CIDR notation', (await problems(a)).some((p) => /Subnet must be CIDR notation/.test(p)) && await createDisabled(a) === true)
  await a.type('Subnet', '')
  await a.type('Gateway', '10.99.0.1')
  check('a gateway without a subnet is refused', (await problems(a)).some((p) => /needs a subnet/.test(p)))
  await a.type('Gateway', 'nope')
  check('a bad gateway asks for an IP address', (await problems(a)).some((p) => /Gateway must be an IP address/.test(p)))
  await a.type('Gateway', '')
  await a.click('overlay', { within: '[role="dialog"]' })
  check('a driver button picks the driver', await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[aria-pressed]')].find((b) => b.innerText.trim() === 'overlay')?.getAttribute('aria-pressed') === 'true'))
  await a.click('bridge', { within: '[role="dialog"]' })
  await a.click(/^Internal network/, { within: '[role="dialog"]' })
  check('Internal network ticks on', await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] [role="checkbox"]')].find((b) => /Internal network/.test(b.innerText))?.getAttribute('aria-checked') === 'true'))
  await a.click(/^Internal network/, { within: '[role="dialog"]' })
  await a.click('Advanced', { within: '[role="dialog"]' })
  check('Advanced unfolds the IP range, Attachable, IPv6 and labels', await a.until(() => { const t = [...document.querySelectorAll('[role="dialog"]')].pop()?.innerText || ''; return /IP range/i.test(t) && /Attachable/.test(t) && /IPv6/.test(t) && /Labels/i.test(t) }, null, 3000))
  await a.type('IP range', 'x/y')
  check('a bad IP range asks for CIDR notation', (await problems(a)).some((p) => /IP range must be CIDR notation/.test(p)))
  await a.type('IP range', '')
  await a.click('Add label', { within: '[role="dialog"]' })
  await a.type('Label 1 key', '-bad key')
  check('a bad label key is named', (await problems(a)).some((p) => /Label key "-bad key" is not valid/.test(p)))
  check('Remove label takes the row away (and the message)', await a.click('Remove label 1', { within: '[role="dialog"]' }) && !(await problems(a)).length)
  await a.click('Cancel', { within: '[role="dialog"]' })
  check('Cancel closes the sheet without creating', await a.waitNoDialog(5000) && !(await cards(a)).includes(name))
  await a.click('New network', { within: 'main' }); await a.waitDialog('Create Docker network', 8000)
  await a.key('Escape')
  check('Escape closes it too', await a.waitNoDialog(5000))

  // ---- create: Everywhere refuses in the sheet; the hub's refusal (the lab's docker) shows there too ----
  await a.click('Everywhere', { within: SCOPE }); await loaded(a)
  await a.click('New network', { within: 'main' }); await a.waitDialog('Create Docker network', 8000)
  await a.type('Network name', name)
  await a.click('Create network', { within: '[role="dialog"]' })
  check('Create in Everywhere says to pick a server (no call)', await a.waitText('Everywhere is a view', { within: '[role="dialog"]', ms: 5000 }))
  await a.click('Cancel', { within: '[role="dialog"]' }); await a.waitNoDialog(5000)
  await a.click('Hub', { within: SCOPE }); await loaded(a)
  a.expectFailures = /\/networks$/ // the lab's docker refuses the create: its 500 is the expected answer here
  await a.click('New network', { within: 'main' }); await a.waitDialog('Create Docker network', 8000)
  await a.type('Network name', name)
  await a.click('Create network', { within: '[role="dialog"]' })
  const outcome = await a.until(() => (document.querySelector('[role="dialog"] [role="alert"]')?.innerText) || (![...document.querySelectorAll('[role="dialog"]')].some((d) => d.getClientRects().length) && 'closed'), null, 20000)
  check('Create on the hub ends in a clear outcome (a message in the sheet, or the sheet closes)', !!outcome, String(outcome))
  a.expectFailures = null
  if (outcome === 'closed') {
    // the lab let it through: put it back as it was
    const api = await k.apiAs(k.ADMIN)
    await api.del(`/networks/${name}`)
    k.j.note(`the lab created ${name}; deleted again`)
  } else {
    await a.click('Cancel', { within: '[role="dialog"]' }); await a.waitNoDialog(5000)
  }

  // ---- delete (never confirmed) ------------------------------------------------------------------------
  await a.click(`Delete the network ${target}`, { within: 'main' })
  const di = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('Delete asks first ("Delete this network?", danger, "Delete network")', di && di.title === 'Delete this network?' && di.danger && di.buttons.includes('Delete network'), JSON.stringify(di))
  await a.click('Cancel', { within: '[role="alertdialog"]' })
  check('Cancel deletes nothing', await a.waitNoDialog(5000) && (await cards(a)).includes(target))
  check('built-in networks offer no Delete', !(await a.exists('Delete the network bridge', { within: 'main' })))
  await a.click('Everywhere', { within: SCOPE }); await loaded(a)
  await a.click(`Delete the network ${target}`, { within: 'main' })
  check('Delete in Everywhere says to pick a server first', await a.waitToast(/pick the hub or one VM above, then delete the network there/, 5000) && !(await a.page.$('[role="alertdialog"]')))
  check('Refresh reads the networks again', await a.click('Refresh', { within: 'main' }) && await loaded(a))

  // ---- a viewer ---------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Networks', await v.go('networks') && (await v.h1()) === 'Networks')
  await loaded(v, 30000)
  check('a viewer is offered no New network and no Delete', !(await v.exists('New network', { within: 'main' })) && !(await v.exists(/^Delete the network /, { within: 'main' })))
  await v.click('Hub', { within: SCOPE }); await loaded(v)
  await v.click(`Inspect ${target}`, { within: 'main' })
  check('a viewer inspects a network, without Edit, Disconnect or Connect', await v.waitDialog(target, 8000) && await v.waitText(/Subnet/i, { within: '[role="dialog"]', ms: 15000 }) && !(await v.exists('Edit', { within: '[role="dialog"]', kind: 'button' })) && !(await v.exists(/^Disconnect /, { within: '[role="dialog"]' })) && !(await v.exists('Connect', { within: '[role="dialog"]', kind: 'button' })))
  await v.key('Escape')

  // ---- phone, light --------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('networks'); await loaded(p); await p.settle(600)
  check('phone: no sideways scroll on Networks', !(await p.overflow()), await p.overflow())
  await p.click('New network', { within: 'main' })
  await p.waitDialog('Create Docker network', 8000); await k.sleep(400)
  const sheet = await p.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop(); const r = d.getBoundingClientRect()
    const btns = [...d.querySelectorAll('button')].filter((b) => /^(Cancel|Create network)$/.test(b.innerText.trim())).map((b) => Math.round(b.getBoundingClientRect().height))
    return { bottom: Math.round(r.bottom), h: innerHeight, btns }
  })
  check('phone: New network is a bottom sheet with thumb-sized buttons (≥ 40 px)', Math.abs(sheet.bottom - sheet.h) <= 2 && sheet.btns.length === 2 && sheet.btns.every((h) => h >= 40), JSON.stringify(sheet))
  await p.shot('networks-phone-new')
  await p.key('Escape')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('networks'); await loaded(l)
  check('light: Networks draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('networks-light')

  // ---- a failed list ----------------------------------------------------------------------------------
  await checkFailedList(k, 'networks', /\/networks(\?fleet=1)?$/, () => document.querySelectorAll('main [aria-label^="Inspect "]').length > 0)
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
