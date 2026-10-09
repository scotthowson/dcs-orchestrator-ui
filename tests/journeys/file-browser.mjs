// File Browser (read-only: it lists and reads files inside a running container): the scope chips (hub, the VM),
// the container picker, the path bar, the failure state the lab's docker gives (it refuses `docker exec`) with Try
// again and Refresh; a viewer never reaches the page; the phone and the light look.

export default async function fileBrowser(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('file-browser') && (await a.h1()) === 'File Browser', await a.h1())
  check('before a container is picked: the empty state says what to do', await a.waitText('Select a running container above', { within: 'main', ms: 15000 }))
  const refresh = await a.find('Refresh', { within: 'main', kind: 'button' })
  check('Refresh is off until a container is picked', refresh && await refresh.evaluate((b) => b.disabled))
  await refresh?.dispose()
  const options = await a.page.evaluate(() => [...document.querySelectorAll('main select option')].map((o) => o.value).filter(Boolean))
  check('the picker lists the hub\'s running containers', options.length >= 3 && options.includes('traefik'), JSON.stringify(options))
  const sel = await a.page.$('main select')
  await sel.select('traefik'); await sel.dispose()
  check('picking a container shows the path bar at /', await a.until(() => !!document.querySelector('main nav[aria-label="Path"]'), null, 8000))
  check('the lab refuses `docker exec`: the failure state says so, with Try again', await a.waitText('Failed to browse files', { within: 'main', ms: 20000 }) && await a.exists('Try again', { within: 'main' }), await a.text('main'))
  const leaked = await a.page.evaluate(() => /undefined|NaN|\[object Object\]/.test(document.querySelector('main').innerText))
  check('no undefined / NaN / [object Object] in the page', !leaked)
  const req0 = a.requests.length
  await a.click('Try again', { within: 'main' })
  await k.sleep(1500)
  check('Try again asks again', a.requests.slice(req0).some((r) => /files/.test(r.path)), JSON.stringify(a.requests.slice(req0).map((r) => r.path)))
  const req1 = a.requests.length
  await a.click('Refresh', { within: 'main', kind: 'button' }); await k.sleep(1500)
  check('Refresh (on once a container is picked) asks again', a.requests.slice(req1).some((r) => /files/.test(r.path)))
  check('the path bar\'s / goes to the root', await a.click('/', { within: 'main nav[aria-label="Path"]' }))
  // the other server of the fleet
  const hasVm = await a.exists('media-vm', { within: 'main' })
  if (hasVm) {
    await a.click('media-vm', { within: 'main' })
    check('the media-vm chip shows that VM\'s containers', await a.until(() => /on (VM )?media-vm/i.test(document.querySelector('main')?.innerText || '') && [...document.querySelectorAll('main select option')].filter((o) => o.value).length > 0, null, 20000), await a.text('main label'))
    check('switching server clears the picked container', await a.until(() => document.querySelector('main select')?.value === '', null, 5000))
    await a.click('Hub', { within: 'main' })
    check('the Hub chip goes back to the hub\'s containers', await a.until(() => /on the hub/i.test(document.querySelector('main')?.innerText || ''), null, 20000))
  } else k.j.note('no media-vm chip: the fleet scope was not offered')

  // ---- a viewer never reaches it ---------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/file-browser' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(600)
  check('a viewer\'s link to #/file-browser lands on the dashboard', (await v.h1()) === 'Dashboard', await v.h1())
  await v.go('bookmarks')
  const strip = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('a viewer\'s Tools strip has no File Browser', !strip.some((n) => /^File Browser/.test(n)), JSON.stringify(strip))

  // ---- phone + light -------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('file-browser')
  const ps = await p.page.$('main select')
  await ps.select('traefik'); await ps.dispose()
  await p.waitText('Failed to browse files', { within: 'main', ms: 20000 })
  check('phone: no sideways scroll (with the failure shown)', !(await p.overflow()), await p.overflow())
  check('phone + light (screenshot)', !!(await p.shot('file-browser-phone-light')))
}
