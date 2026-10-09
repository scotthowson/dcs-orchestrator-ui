// Cleanup (admin only): the scope (Everywhere, the hub, the VM), the guide, Refresh, the report tiles, the orphans and
// the disk usage, and the four actions — only up to their question, then Cancel or Escape (on Everywhere every action
// asks; the deep prune always asks in its own dialog). Nothing is pruned or rotated here.

const MAIN = 'main'
const SCOPE = 'main [role="group"][aria-label="Show"]'
const conf = (t) => t.until(() => !!document.querySelector('[role="alertdialog"]'), null, 6000)
const deepInfo = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length && /prune/i.test(e.innerText)).pop()
  if (!d) return null
  const btns = [...d.querySelectorAll('button')]
  return { title: d.querySelector('h2')?.textContent?.trim(), buttons: btns.map((b) => b.innerText.trim()), focused: document.activeElement?.innerText?.trim() || '', danger: btns.some((b) => /^Delete/.test(b.innerText.trim()) && /rose/.test(b.className)), heights: btns.map((b) => Math.round(b.getBoundingClientRect().height)) }
})

export default async function maintenance(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('admin: the page opens', await a.go('maintenance') && (await a.h1()) === 'Cleanup', await a.h1())
  const hasScope = !!(await a.until((s) => !!document.querySelector(`${s} button`), SCOPE, 10000))
  if (hasScope) {
    await a.click('Everywhere', { within: SCOPE })
    check('admin: Everywhere says how many servers answered', await a.waitText(/\d+ of \d+ servers answered/, { within: MAIN, ms: 20000 }))
  }
  check('admin: the report tiles have numbers (no NaN / undefined)', await a.until(() => /CONTAINERS\s*\d+/i.test(document.querySelector('main').innerText), null, 20000) && !/NaN|undefined/.test(await a.text(MAIN)))
  check('admin: orphaned containers are listed', await a.waitText(/Orphaned containers \(\d+\)/, { within: MAIN, ms: 20000 }) && await a.hasText('uptime-kuma', MAIN))
  check('admin: dangling images and volumes are listed', await a.hasText('Dangling images', MAIN) && await a.hasText('old-hub-cache', MAIN))
  check('admin: the disk usage table is shown', await a.waitText(/Docker disk usage/i, { within: MAIN, ms: 15000 }) && /Local Volumes/.test(await a.text(MAIN)))

  // guide
  await a.click('Guide', { within: MAIN })
  check('admin: Guide opens the guide', await a.waitText('Cleanup guide', { within: MAIN, ms: 5000 }))
  await a.click('Deep prune', { within: 'main section[aria-label="Cleanup guide"]' })
  check('admin: a guide section unfolds', await a.waitText('docker system prune -af --volumes', { within: MAIN, ms: 4000 }))
  await a.click('Close the guide', { within: MAIN })
  check('admin: the guide closes', await a.until(() => !document.querySelector('main section[aria-label="Cleanup guide"]'), null, 4000))

  // Refresh
  let n0 = a.requests.length
  await a.click('Refresh', { within: MAIN })
  check('admin: Refresh reads the report again', await (async () => { for (let i = 0; i < 40; i++) { if (a.requests.slice(n0).some((r) => /\/maintenance\/report$/.test(r.path))) return true; await k.sleep(200) } return false })())

  // ---- the actions on Everywhere: each asks first (regression: the title is a question) ----
  if (hasScope) {
    for (const [btn, verb, danger] of [['Safe prune', 'safe prune', false], ['Image prune', 'image prune', false], ['Rotate logs', 'log rotation', false]]) {
      n0 = a.requests.length
      await a.click(btn, { within: 'main section[aria-labelledby="maint-actions-title"]' })
      const c = await conf(a) && await a.confirmInfo()
      check(`admin: ${btn} on Everywhere asks first ("Run ${verb} everywhere?")`, c && c.title === `Run ${verb} everywhere?` && c.buttons.includes('Run everywhere') && c.danger === danger, JSON.stringify(c))
      await a.click('Cancel', { within: '[role="alertdialog"]' })
      await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000)
      check(`admin: Cancel sends nothing (${btn})`, !a.requests.slice(n0).some((r) => r.method === 'POST'), JSON.stringify(a.requests.slice(n0).filter((r) => r.method === 'POST')))
    }
    await a.click('Deep prune', { within: 'main section[aria-labelledby="maint-actions-title"]' })
    await a.waitDialog(/prune/i, 6000)
    const d = await deepInfo(a)
    check('admin: Deep prune asks in its own dialog, as a question', d && d.title === 'Deep prune everywhere?', JSON.stringify(d))
    check('admin: …rose "Delete everywhere", Cancel focused', d && d.buttons.includes('Delete everywhere') && d.danger && d.focused === 'Cancel', JSON.stringify(d))
    await a.click('Cancel', { within: '[role="dialog"]' })
    check('admin: Cancel closes the deep prune', await a.until(() => ![...document.querySelectorAll('[role="dialog"]')].some((e) => /Deep prune everywhere/.test(e.innerText)), null, 4000))
  }

  // ---- the hub, then the VM ------------------------------------------------
  if (hasScope) {
    await a.click('Hub', { within: SCOPE })
    check('admin: the Hub chip says the actions run on the hub', await a.waitText(/Actions\s*on the hub/, { within: MAIN, ms: 10000 }))
    await a.click('Deep prune', { within: 'main section[aria-labelledby="maint-actions-title"]' })
    await a.waitDialog(/prune/i, 6000)
    const d = await deepInfo(a)
    check('admin: on one server Deep prune asks "Run a deep prune?" (Delete everything)', d && d.title === 'Run a deep prune?' && d.buttons.includes('Delete everything'), JSON.stringify(d))
    await a.key('Escape')
    check('admin: Escape closes it', await a.until(() => ![...document.querySelectorAll('[role="dialog"]')].some((e) => /Run a deep prune/.test(e.innerText)), null, 4000))
    await a.click('media-vm', { within: SCOPE })
    check('admin: the VM chip works on the VM', await a.waitText(/Actions\s*on VM media-vm/, { within: MAIN, ms: 10000 }) && await a.waitText(/CONTAINERS\s*\d+/i, { within: MAIN, ms: 15000 }))
    check('admin: …its orphans are its own (no hub rows)', await a.until(() => !/uptime-kuma/.test(document.querySelector('main').innerText), null, 15000))
    await a.click('Everywhere', { within: SCOPE })
  }
  await a.shot('maintenance-admin')

  // ---- a viewer: the page is an admin's -----------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/maintenance' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('viewer: a link to #/maintenance lands on the dashboard', (await v.currentPage()) !== 'maintenance' && (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('maintenance'); await p.waitText(/CONTAINERS\s*\d+/i, { within: MAIN, ms: 20000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Deep prune', { within: 'main section[aria-labelledby="maint-actions-title"]' })
  await p.waitDialog(/prune/i, 6000)
  const pd = await deepInfo(p)
  check('phone: the deep prune\'s buttons are thumb-sized (≥ 40 px)', pd && pd.heights.every((h) => h >= 40), JSON.stringify(pd))
  await p.shot('maintenance-phone-deep')
  await p.click('Cancel', { within: '[role="dialog"]' })
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('maintenance'); await l.waitText(/CONTAINERS\s*\d+/i, { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('maintenance-light')
}
