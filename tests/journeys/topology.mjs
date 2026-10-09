// Topology: the map of the hub, of everything (Everywhere) and of one VM (the scope chips, with the heading's
// subtitle and badge following them), Refresh, Zoom in / out (the percentage follows), Fit to view, Save as PNG,
// Copy image (refused in a headless browser: an error toast, never an uncaught error), Fullscreen (refused for an
// untrusted press: a toast, no console error), a container on the map opening its details (Escape and ✕ close them,
// the keyboard opens them too). A viewer, a phone and the light look.

const nodes = (t) => t.page.evaluate(() => [...document.querySelectorAll('main [aria-label^="Container "][aria-label$="Open its details"]')].map((e) => e.getAttribute('aria-label')))
const zoomPct = (t) => t.page.evaluate(() => Number((document.querySelector('main [aria-label^="Zoom "][aria-label$=" percent"]')?.getAttribute('aria-label') || '').replace(/\D/g, '')))

export default async function topology(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Topology opens', await a.go('topology') && (await a.h1()) === 'Topology')
  check('the map draws the containers', await a.until(() => document.querySelectorAll('main [aria-label$="Open its details"]').length > 3, null, 30000), JSON.stringify((await nodes(a)).slice(0, 3)))
  const stats = await a.text('main')
  check('the counts read as numbers (no NaN / undefined)', !/NaN|undefined/.test(stats), stats.slice(0, 300))

  // ---- the scope: Everywhere, Hub, a VM ------------------------------------------------------------
  await a.click('Everywhere', { within: 'main' })
  check('Everywhere maps the VMs\' containers too', await a.until(() => [...document.querySelectorAll('main [aria-label$="Open its details"]')].some((e) => /media-vm\//.test(e.getAttribute('aria-label'))), null, 45000))
  let head = await a.text('main')
  check('…its subtitle says the map holds every VM (not "the hub\'s own map")', /every VM that answers, on one map/.test(head) && !/The hub's own map/.test(head), head.slice(0, 300))
  check('…and no "Hub" badge sits beside the heading', !(await a.page.evaluate(() => [...(document.querySelector('main h1')?.parentElement?.querySelectorAll('.mantine-Badge-root') || [])].some((b) => /^Hub$/.test(b.innerText.trim())))))
  await a.click('Hub', { within: 'main' })
  check('Hub maps the hub alone', await a.until(() => { const n = [...document.querySelectorAll('main [aria-label$="Open its details"]')]; return n.length > 0 && !n.some((e) => /media-vm\//.test(e.getAttribute('aria-label'))) }, null, 20000), JSON.stringify(await nodes(a)))
  head = await a.text('main')
  check('…its subtitle says it is the hub\'s own map', /The hub's own map/.test(head), head.slice(0, 200))
  await a.click('media-vm', { within: 'main' })
  check('media-vm maps that VM', await a.waitText('inside the VM media-vm', { within: 'main', ms: 30000 }) && await a.until(() => document.querySelectorAll('main [aria-label$="Open its details"]').length > 0, null, 45000))
  await a.click('Everywhere', { within: 'main' })
  await a.until(() => [...document.querySelectorAll('main [aria-label$="Open its details"]')].some((e) => /media-vm\//.test(e.getAttribute('aria-label'))), null, 45000)
  await a.until(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Refresh')?.disabled === false, null, 20000)
  let w0 = a.requests.length
  await a.click('Refresh', { within: 'main', kind: 'button' }); await k.sleep(2000)
  check('Refresh reads the map again', a.requests.slice(w0).some((r) => r.path === '/topology'), a.requests.slice(w0).map((r) => r.path).join())

  // ---- zoom, fit -----------------------------------------------------------------------------------
  const z0 = await zoomPct(a)
  await a.click('Zoom in', { within: 'main' }); await k.sleep(300)
  const z1 = await zoomPct(a)
  check('Zoom in enlarges the map (the percentage follows)', z1 > z0, `${z0} → ${z1}`)
  await a.click('Zoom out', { within: 'main' }); await a.click('Zoom out', { within: 'main' }); await k.sleep(300)
  const z2 = await zoomPct(a)
  check('Zoom out shrinks it', z2 < z1, `${z1} → ${z2}`)
  await a.click('Fit to view', { within: 'main' }); await k.sleep(300)
  const z3 = await zoomPct(a)
  check('Fit to view fits the whole map (a sensible zoom)', z3 > 5 && z3 <= 120, String(z3))

  // ---- export, copy, fullscreen --------------------------------------------------------------------
  let e0 = a.errors.length
  await a.until(() => document.querySelector('main button[aria-label="Save as PNG"]')?.disabled === false, null, 20000)
  await a.click('Save as PNG', { within: 'main' })
  check('Save as PNG saves the map (a toast, no error)', await a.waitToast('Topology saved as PNG', 20000) && a.errors.length === e0, JSON.stringify(await a.toasts()) + a.errors.slice(e0).join())
  e0 = a.errors.length
  await a.click('Copy image to clipboard', { within: 'main' })
  const copied = await a.waitToast(/copied to the clipboard|clipboard|Export failed|denied|not allowed/i, 20000)
  check('Copy image says how it went (a toast), never an uncaught error', copied && !a.errors.slice(e0).some((x) => /uncaught/.test(x)), `${copied} ${a.errors.slice(e0).join()}`)
  e0 = a.errors.length
  // the browser refuses fullscreen (no permission, a frame without allowfullscreen, an untrusted press): stand in for it
  await a.page.evaluate(() => { window.__rf = Element.prototype.requestFullscreen; Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')) } })
  await a.click('Fullscreen', { within: 'main', dom: true })
  check('Fullscreen refused by the browser says so (a toast), no uncaught error', await a.waitToast(/Fullscreen is not available/, 8000) && !a.errors.slice(e0).length, a.errors.slice(e0).join() || JSON.stringify(await a.toasts()))
  await a.page.evaluate(() => { Element.prototype.requestFullscreen = window.__rf })
  // a real press: the whole card fills the screen, with its tools and the details it opens
  await a.click('Fullscreen', { within: 'main' })
  if (await a.until(() => !!document.fullscreenElement, null, 5000)) {
    check('in fullscreen the map keeps its tools (Leave fullscreen, zoom) on screen', await a.until(() => !!document.fullscreenElement?.querySelector('button[aria-label="Leave fullscreen"]') && !!document.fullscreenElement.querySelector('button[aria-label="Zoom in"]'), null, 5000))
    await a.page.evaluate(() => document.fullscreenElement.querySelector('[aria-label^="Container redis,"]')?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    check('…and a container\'s details open inside the fullscreen view', await a.until(() => !!document.fullscreenElement?.querySelector('[role="dialog"]') && /Container details/.test(document.fullscreenElement.querySelector('[role="dialog"]').innerText), null, 5000))
    await a.page.evaluate(() => document.fullscreenElement?.querySelector('[role="dialog"] button[aria-label="Close"]')?.click())
    await a.page.evaluate(() => document.fullscreenElement?.querySelector('button[aria-label="Leave fullscreen"]')?.click())
    check('Leave fullscreen goes back', await a.until(() => !document.fullscreenElement, null, 5000))
  } else k.j.note('headless Chrome refused a trusted fullscreen too; the refusal path is checked above')
  await a.page.evaluate(() => document.fullscreenElement && document.exitFullscreen()).catch(() => {})

  // ---- a container's details ----------------------------------------------------------------------
  const redis = (await nodes(a)).find((n) => /^Container redis,/.test(n))
  await a.click(redis, { within: 'main' })
  check('a container on the map opens its details', await a.waitDialog('redis', 8000))
  const det = await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length).pop()?.innerText || '')
  check('…with its state, image, stack and addresses (no NaN / undefined)', /Running/i.test(det) && /redis:alpine/.test(det) && /monitoring-management/.test(det) && !/NaN|undefined/.test(det), det.slice(0, 300))
  await a.key('Escape')
  check('Escape closes the details', await a.waitNoDialog(5000))
  await a.click(redis, { within: 'main' }); await a.waitDialog('redis', 8000)
  const closed = await a.page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].find((x) => /Container details/.test(x.innerText)); const b = d?.querySelector('button[aria-label="Close"]'); b?.click(); return !!b })
  check('the details\' ✕ closes them', closed && await a.waitNoDialog(5000))
  const el = await a.find(redis, { within: 'main' })
  await el.evaluate((e) => e.focus()); await el.dispose()
  await a.key('Enter')
  check('Enter on a focused container opens its details', await a.waitDialog('redis', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)

  // ---- a viewer ------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Topology', await v.go('topology') && await v.until(() => document.querySelectorAll('main [aria-label$="Open its details"]').length > 3, null, 30000))
  await v.click('media-vm', { within: 'main' })
  check('a viewer can map a VM', await v.waitText('inside the VM media-vm', { within: 'main', ms: 20000 }))
  await v.click('Everywhere', { within: 'main' }); await v.settle()
  await v.until(() => document.querySelectorAll('main [aria-label$="Open its details"]').length > 3 && document.querySelector('main button[aria-label="Save as PNG"]')?.disabled === false, null, 30000)
  const ve = v.errors.length
  await v.click('Save as PNG', { within: 'main' })
  check('a viewer can save the map as PNG', await v.waitToast('Topology saved as PNG', 20000) && v.errors.length === ve)
  await v.page.evaluate(() => { Element.prototype.requestFullscreen = function () { return Promise.reject(new TypeError('Permissions check failed')) } })
  await v.click('Fullscreen', { within: 'main', dom: true })
  check('a viewer\'s refused Fullscreen raises no error', await v.waitToast(/Fullscreen is not available/, 8000) && v.errors.length === ve, v.errors.slice(ve).join())
  const n1 = (await nodes(v))[0]
  await v.click(n1, { within: 'main' })
  check('a viewer can open a container\'s details', await v.waitDialog(null, 8000))
  await v.key('Escape')

  // ---- a phone, the light look --------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('topology')
  await p.until(() => document.querySelectorAll('main [aria-label$="Open its details"]').length > 3, null, 30000)
  check('no sideways scroll on a phone (Topology)', !(await p.overflow()), await p.overflow())
  const tb = await p.page.evaluate(() => ['Zoom in', 'Zoom out', 'Fit to view', 'Save as PNG'].map((n) => Math.round(document.querySelector(`main button[aria-label="${n}"]`)?.getBoundingClientRect().height || 0)))
  check('the map\'s tool buttons are touch-sized on a phone (≥ 32 px)', tb.every((h) => h >= 32), JSON.stringify(tb))
  await p.shot('topology-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('topology')
  await l.until(() => document.querySelectorAll('main [aria-label$="Open its details"]').length > 3, null, 30000)
  check('Topology in the light look (screenshot)', await l.page.evaluate(() => document.documentElement.classList.contains('light')), await l.shot('topology-light'))
}
