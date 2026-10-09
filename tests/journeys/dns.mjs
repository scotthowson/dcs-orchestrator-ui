// DNS & Routes (admin only). The lab has one hand-written route (tools.lab.test → it-tools) under a server whose domain
// is example.com, Traefik active, and no Cloudflare token: the routes list, its search and empty state, the inline
// rename (opened, checked, cancelled — never saved), the delete-route question (Cancel, Escape — never confirmed), the
// proxy-health Recheck, the Records view (Cloudflare not connected), "Open Secrets", Refresh. No call reaches Cloudflare.

const MAIN = 'main'
async function asked(k, t, from, path, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await k.sleep(200)) if (t.requests.slice(from).some((r) => r.path === path || r.path.startsWith(path))) return true
  return false
}
/** the open dialog: its title, buttons, the focused button, whether its confirm is rose */
const dialogInfo = async (t) => { await t.until(() => [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop()?.getAttribute('aria-labelledby'), null, 4000); return dialogInfo0(t) }
const dialogInfo0 = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop()
  if (!d) return null
  const lb = d.getAttribute('aria-labelledby')
  const btns = [...d.querySelectorAll('button')]
  return {
    title: (d.getAttribute('aria-label') || (lb && document.getElementById(lb)?.textContent) || '').trim(),
    buttons: btns.map((b) => b.innerText.trim()),
    heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)),
    focused: document.activeElement?.innerText?.trim() || '',
    dangerConfirm: btns.some((b) => /^Delete/.test(b.innerText.trim()) && /rose/.test(b.className)),
  }
})

export default async function dns(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('admin: the page opens', await a.go('dns') && (await a.h1()) === 'DNS & Routes', await a.h1())
  check('admin: the token pill says Cloudflare is not configured', await a.waitText('Cloudflare not configured', { within: 'main', ms: 20000 }))
  check('admin: the subtitle names the domain and the routes', await a.waitText(/\*\.example\.com — 1 route/, { within: MAIN, ms: 15000 }))
  check('admin: the tiles show Routes 1, DNS records — (no token)', await a.until(() => {
    const t = document.querySelector('main').innerText
    return /ROUTES\s*1/i.test(t) && /DNS RECORDS\s*—/i.test(t)
  }, null, 15000))
  check('admin: the "Connect Cloudflare" notice explains the token', await a.hasText('Connect Cloudflare to manage DNS from here', MAIN) && await a.hasText('CF_DNS_API_TOKEN', MAIN))

  // the routes list
  check('admin: the route is listed under its stack', await a.waitText(/custom_routes/i, { within: MAIN, ms: 15000 }) && await a.hasText('it-tools', MAIN))
  // regression: a route under another domain than the server's used to read "tools.example.com" (its first label + the domain)
  check('admin: a route outside the domain is shown by its own name (tools.lab.test)', await a.until(() => {
    const e = [...document.querySelectorAll('main span[title="tools.lab.test"]')][0]
    return e && e.textContent === 'tools.lab.test' && !/tools\s*\.example\.com/.test(document.querySelector('main').innerText)
  }, null, 8000))
  check('admin: its open link goes to https://tools.lab.test in a new tab', await a.page.evaluate(() => { const l = document.querySelector('main a[aria-label="Open https://tools.lab.test"]'); return l && l.target === '_blank' && /noopener/.test(l.rel) }))

  // search, empty state, clear
  await a.type('Search the routes', 'it-tools')
  check('admin: searching keeps the matching route', await a.until(() => /it-tools/.test(document.querySelector('main').innerText), null, 5000))
  await a.type('Search the routes', 'zz-nothing-like-this')
  check('admin: a search with no match says so', await a.waitText('No routes match "zz-nothing-like-this"', { within: MAIN, ms: 5000 }))
  await a.type('Search the routes', '')
  check('admin: clearing the search brings the route back', await a.until(() => /it-tools/.test(document.querySelector('main').innerText), null, 5000))

  // the inline rename: opened, the availability check, cancelled
  await a.click('Rename the subdomain of it-tools', { within: MAIN })
  const renameField = await a.field('New subdomain for it-tools', 'main')
  check('admin: Rename opens the subdomain field', !!renameField)
  if (renameField) {
    await a.type('New subdomain for it-tools', 'Zz E2E!', 'main')
    check('admin: the field keeps only what a subdomain may hold', (await a.value('New subdomain for it-tools', 'main')) === 'zze2e', await a.value('New subdomain for it-tools', 'main'))
    const n0 = a.requests.length
    await a.key('Tab')
    check('admin: Tab checks whether the name is free', await asked(k, a, n0, '/routes/check'))
    await a.key('Escape')
    check('admin: Escape cancels the rename', await a.until(() => !document.querySelector('main input[aria-label="New subdomain for it-tools"]'), null, 5000))
    await a.click('Rename the subdomain of it-tools', { within: MAIN })
    check('admin: the Cancel button cancels it too', await a.click('Cancel', { within: MAIN }) && await a.until(() => !document.querySelector('main input[aria-label="New subdomain for it-tools"]'), null, 5000))
    await renameField.dispose().catch(() => {})
  }

  // the delete question: never confirmed
  await a.click('Delete the route of it-tools', { within: MAIN })
  await a.waitDialog(/^Delete/, 8000)
  const di = await dialogInfo(a)
  check('admin: Delete asks first, as a question', di && /\?$/.test(di.title), JSON.stringify(di))
  check('admin: …Cancel has the focus and the confirm says the verb in rose', di && di.focused === 'Cancel' && di.buttons.includes('Delete route') && di.dangerConfirm, JSON.stringify(di))
  check('admin: …it says what goes (the service keeps running)', await a.waitText('the service keeps running', { within: '[role="dialog"]', ms: 3000 }))
  await a.click('Cancel', { within: '[role="dialog"]' })
  check('admin: Cancel closes it and the route stays', await a.waitNoDialog(5000) && await a.hasText('it-tools', MAIN))
  await a.click('Delete the route of it-tools', { within: MAIN }); await a.waitDialog(/^Delete/, 8000)
  await a.key('Escape')
  check('admin: Escape closes it', await a.waitNoDialog(5000))

  // proxy health
  let n0 = a.requests.length
  check('admin: Recheck asks Traefik again', await a.click('Recheck', { within: MAIN, dom: true }) && await asked(k, a, n0, '/routes/certificates', 20000))
  check('admin: the proxy health says why there is no certificate', await a.hasText('Traefik holds no certificate yet', MAIN))

  // the records view
  await a.click(/^DNS records/, { within: MAIN })
  check('admin: the DNS records view says Cloudflare is needed', await a.waitText('DNS records appear here once Cloudflare is connected', { within: MAIN, ms: 8000 }))
  check('admin: the search follows the view', !!(await a.field('Search the records', 'main')))
  check('admin: no Add record without a token', !(await a.exists('Add record', { within: MAIN })))
  await a.click(/^Routes \(1\)/, { within: MAIN })
  check('admin: back on Routes', await a.waitText('it-tools', { within: MAIN, ms: 5000 }))

  // Refresh, Open Secrets
  n0 = a.requests.length
  check('admin: Refresh reads the routes again', await a.click('Refresh', { within: MAIN }) && await asked(k, a, n0, '/routes'))
  await a.click('Open Secrets', { within: MAIN })
  check('admin: "Open Secrets" opens Secrets', await a.until(() => document.querySelector('main h1')?.textContent === 'Secrets', null, 15000), await a.h1())
  await a.go('dns')
  await a.shot('dns-admin')

  // ---- a viewer: the page is an admin's -----------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/dns' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('viewer: a link to #/dns lands on the dashboard', (await v.currentPage()) !== 'dns' && (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)
  await v.go('crowdsec')
  const vs = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('viewer: DNS & Routes is not offered in the strip', !vs.some((n) => /^DNS/.test(n)), JSON.stringify(vs))

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('dns'); await p.waitText('it-tools', { within: MAIN, ms: 20000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Delete the route of it-tools', { within: MAIN }); await p.waitDialog(/^Delete/, 8000)
  const pd = await dialogInfo(p)
  check('phone: the delete question\'s buttons are thumb-sized (≥ 40 px)', pd && pd.heights.every((h) => h >= 40), JSON.stringify(pd?.heights))
  await p.shot('dns-phone-delete')
  await p.click('Cancel', { within: '[role="dialog"]' }); await p.waitNoDialog(5000)
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('dns'); await l.waitText('it-tools', { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('dns-light')
}
