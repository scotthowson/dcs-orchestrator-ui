// Updates. Admin: Check for updates (the release check), the auto-check choice (changed, read back after a reload, put
// back), Restart API (asked, cancelled — never confirmed), the Docker Engine card (its command copied, Check), the VMs
// card (Update all VMs asks first — cancelled, never confirmed), the Docker images per scope (Everywhere, the hub, the
// VM), Update all stale and Update everything (asked, cancelled), one image's Update (the fake docker refuses the pull:
// the error is said). "Check registry for updates" is never pressed: it asks the real registries. A viewer reads the
// page, copies the command, checks the engine and switches the scope, and is offered none of the admin's buttons.

const MAIN = 'main'
const SCOPE = 'main [role="group"][aria-label="Images on"]'
async function grantClipboard(k, t) { await t.ctx.overridePermissions(k.UI, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {}) }
const conf = (t) => t.until(() => !!document.querySelector('[role="alertdialog"]'), null, 6000)
async function asked(k, t, from, re, ms = 10000) {
  for (const end = Date.now() + ms; Date.now() < end; await k.sleep(200)) if (t.requests.slice(from).some((r) => re.test(`${r.method} ${r.path}`))) return true
  return false
}

export default async function updates(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  await grantClipboard(k, a)
  a.expectFailures = /\/images\/[^?]*update/   // the fake docker refuses a pull: the API answers 500, the page says so
  check('admin: the page opens', await a.go('updates') && (await a.h1()) === 'Updates', await a.h1())
  check('admin: the framework card shows the installed version', await a.waitText(/INSTALLED\s*\d+\.\d+\.\d+/, { within: MAIN, ms: 20000 }))
  check('admin: no NaN / undefined on the page', !/\bNaN\b|undefined/.test(await a.text(MAIN)))

  // the release check
  let n0 = a.requests.length
  await a.click('Check for updates', { within: MAIN })
  check('admin: Check for updates asks the server', await asked(k, a, n0, /GET \/system\/update\/check/) && await a.waitText(/Last checked/, { within: MAIN, ms: 15000 }))

  // the auto-check choice: changed, read back after a reload, put back
  const auto0 = await a.value('#auto-check-updates')
  const auto1 = auto0 === '3600000' ? '86400000' : '3600000'
  await a.page.select('#auto-check-updates', auto1)
  await a.reload()
  check('admin: the auto-check choice is kept after a reload', await a.until((v) => document.querySelector('#auto-check-updates')?.value === v, auto1, 15000), await a.value('#auto-check-updates'))
  await a.page.select('#auto-check-updates', auto0)
  check('admin: …and put back', (await a.value('#auto-check-updates')) === auto0)

  // Restart API: asked, cancelled
  n0 = a.requests.length
  await a.click('Restart API', { within: MAIN })
  const c1 = await conf(a) && await a.confirmInfo()
  check('admin: Restart API asks first ("Restart the API now?")', c1 && c1.title === 'Restart the API now?' && c1.buttons.includes('Restart API'), JSON.stringify(c1))
  await a.click('Cancel', { within: '[role="alertdialog"]' })
  check('admin: Cancel restarts nothing', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && !a.requests.slice(n0).some((r) => r.method === 'POST'))

  // the Docker Engine card
  await a.click('Copy', { within: MAIN, kind: 'button' })
  check('admin: the engine card copies its install command', await a.until(() => navigator.clipboard.readText().then((t) => /get\.docker\.com/.test(t)).catch(() => false), null, 5000) && await a.waitText('Copied', { within: MAIN, ms: 3000 }))
  n0 = a.requests.length
  await a.click('Check', { within: MAIN, kind: 'button' })
  check('admin: the engine card\'s Check reads its state again', await asked(k, a, n0, /GET \/system\/docker-engine/))

  // the VMs card: Update all VMs asks first (regression), never confirmed
  if (await a.exists(/^Update (all VMs|\d+ VMs?)$/, { within: MAIN })) {
    n0 = a.requests.length
    await a.click(/^Update (all VMs|\d+ VMs?)$/, { within: MAIN })
    const c2 = await conf(a) && await a.confirmInfo()
    check('admin: Update all VMs asks first (a DCS update of every VM)', c2 && /^Update the (VM|\d+ VMs) now\?$/.test(c2.title) && c2.buttons.some((b) => /^Update the VMs?$/.test(b)), JSON.stringify(c2))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('admin: Cancel updates no VM', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && !a.requests.slice(n0).some((r) => r.method === 'POST'))
  } else k.j.note('updates: no VMs card')

  // ---- Docker images, per scope ---------------------------------------------
  check('admin: the image tiles count the images', await a.waitText(/TOTAL IMAGES\s*\d+/, { within: MAIN, ms: 20000 }))
  const hasScope = !!(await a.until((s) => !!document.querySelector(`${s} button`), SCOPE, 10000))
  if (hasScope) {
    await a.click('Everywhere', { within: SCOPE })
    check('admin: Everywhere lists the hub\'s and the VM\'s images', await a.until(() => /VM #100/.test(document.querySelector('main section[aria-label="Docker images"]')?.innerText || ''), null, 20000))
    await a.click('Hub', { within: SCOPE })
    check('admin: the Hub chip lists the hub\'s alone', await a.until(() => !/VM #100 · media-vm/.test(document.querySelector('main section[aria-label="Docker images"] table')?.innerText || '') && /TOTAL IMAGES\s*\d+/.test(document.querySelector('main').innerText), null, 20000))
    await a.click('media-vm', { within: SCOPE })
    check('admin: the VM chip lists the VM\'s', await a.until(() => /media-vm/.test(document.querySelector('main section[aria-label="Docker images"]')?.innerText || ''), null, 20000))
    await a.click('Everywhere', { within: SCOPE })
    await a.until(() => /VM #100/.test(document.querySelector('main section[aria-label="Docker images"]')?.innerText || ''), null, 20000)
    // a row's server capsule picks that server
    await a.click('VM #100 · media-vm', { within: 'main section[aria-label="Docker images"] table' })
    check('admin: a row\'s VM capsule switches the scope to that VM', await a.until((s) => document.querySelector(`${s} button[aria-pressed="true"]`)?.innerText.trim().includes('media-vm'), SCOPE, 8000))
    await a.click('Everywhere', { within: SCOPE })
  }

  // Update all stale: asked first (regression), cancelled
  if (await a.exists(/^Update all stale/, { within: MAIN })) {
    n0 = a.requests.length
    await a.click(/^Update all stale/, { within: MAIN })
    const c3 = await conf(a) && await a.confirmInfo()
    check('admin: Update all stale asks first', c3 && /^Update \d+ images? now\?$/.test(c3.title) && c3.buttons.some((b) => /^Update the images?$/.test(b)), JSON.stringify(c3))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('admin: Cancel pulls nothing', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && !a.requests.slice(n0).some((r) => r.method === 'POST'))
  }
  // Update everything (automatic image updates card): asked, cancelled
  if (await a.exists('Update everything', { within: MAIN })) {
    await a.click('Update everything', { within: MAIN })
    const c4 = await conf(a) && await a.confirmInfo()
    check('admin: Update everything asks first', c4 && c4.title === 'Update every image now?', JSON.stringify(c4))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000)
  }
  check('admin: the "Recreate the containers after pulling" switch has a name', await a.page.evaluate(() => [...document.querySelectorAll('main [role="switch"]')].some((s) => (s.labels?.[0]?.textContent || s.getAttribute('aria-label') || '').includes('Recreate the containers'))))

  // one image's Update: the fake docker refuses the pull, and the page says so
  await a.click('Hub', { within: SCOPE })
  await a.until(() => [...document.querySelectorAll('main section[aria-label="Docker images"] table button')].some((b) => b.innerText.trim() === 'Update'), null, 20000)
  n0 = a.requests.length
  await a.click('Update', { within: 'main section[aria-label="Docker images"] table', kind: 'button' })
  check('admin: an image\'s Update sends the pull', await asked(k, a, n0, /POST \/images\/.*update/))
  check('admin: …and a refused pull is said in a toast', await a.waitToast(/pull|Could not update|Failed/i, 30000), JSON.stringify(await a.toasts()))
  await a.click('Everywhere', { within: SCOPE })
  await a.shot('updates-admin')

  // ---- a viewer -------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  await grantClipboard(k, v)
  check('viewer: the page opens', await v.go('updates') && (await v.h1()) === 'Updates', await v.h1())
  check('viewer: the installed version is shown', await v.waitText(/INSTALLED\s*\d+\.\d+\.\d+/, { within: MAIN, ms: 20000 }), (await v.text(MAIN)).slice(0, 400))
  const offered = await v.page.evaluate(() => [...document.querySelectorAll('main button, main [role="switch"], main select')].map((b) => (b.getAttribute('aria-label') || b.innerText || b.id || '').trim()).filter((n) => /Check for updates|Restart API|Roll back|Update all VMs|Update all stale|Check registry|^Update$|Update everything|auto-check-updates|Run now/.test(n)))
  check('viewer: no admin action is offered (check, restart, VM / image updates, the auto-update)', offered.length === 0 && !(await v.page.$('main [role="switch"]')), JSON.stringify(offered))
  await v.click('Copy', { within: MAIN, kind: 'button' })
  check('viewer: Copy works for a viewer', await v.until(() => navigator.clipboard.readText().then((t) => /get\.docker\.com/.test(t)).catch(() => false), null, 5000))
  let m0 = v.forbidden.length
  await v.click('Check', { within: MAIN, kind: 'button' }); await k.sleep(1500)
  check('viewer: the engine card\'s Check is a viewer\'s (no 403)', v.forbidden.length === m0, v.forbidden.slice(m0).join(', '))
  if (await v.exists('media-vm', { within: SCOPE })) {
    await v.click('media-vm', { within: SCOPE })
    check('viewer: the scope chips work', await v.until(() => /media-vm/.test(document.querySelector('main section[aria-label="Docker images"]')?.innerText || ''), null, 20000))
    await v.click('Everywhere', { within: SCOPE })
  }

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('updates'); await p.waitText(/TOTAL IMAGES\s*\d+/, { within: MAIN, ms: 20000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Restart API', { within: MAIN })
  if (await conf(p)) {
    const hs = await p.page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].map((b) => Math.round(b.getBoundingClientRect().height)))
    check('phone: the question\'s buttons are thumb-sized (≥ 40 px)', hs.every((h) => h >= 40), JSON.stringify(hs))
    await p.shot('updates-phone-confirm')
    await p.click('Cancel', { within: '[role="alertdialog"]' })
  }
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('updates'); await l.waitText(/TOTAL IMAGES\s*\d+/, { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('updates-light')
}
