// Trends: the scope (the hub's, a VM's through the hub), the time ranges (each asks for its range at once), Auto-refresh
// (on, paused, on), Refresh, the tiles (no NaN), Capture a snapshot, the charts or the empty state, the alert thresholds
// sheet (validation: a warning at or above its critical level; Save, read back on the next opening, put back as it
// was; Cancel, Escape), a viewer (no Capture, no Alerts), the phone (a bottom sheet) and the light look.

const SCOPE = '[role="group"][aria-label="Trends of"]'
const RANGE = '[aria-label="Time range"]'
const RANGES = [['1 hour', '1h'], ['6 hours', '6h'], ['24 hours', '24h'], ['7 days', '7d'], ['30 days', '30d'], ['90 days', '90d'], ['1 year', '1y'], ['All', 'all']]
/** set a range input the way a drag does (React sees the input event) */
const setSlider = (t, label, value) => t.page.evaluate((l, v) => {
  const el = document.querySelector(`[role="dialog"] input[type="range"][aria-label="${l}"]`)
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v))
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, label, value)
const slider = (t, label) => t.page.evaluate((l) => Number(document.querySelector(`[role="dialog"] input[type="range"][aria-label="${l}"]`)?.value), label)
const saveDisabled = (t) => t.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Save thresholds/.test(b.innerText))?.disabled)

export default async function trends(k) {
  const { check } = k
  const api = await k.apiAs(k.ADMIN)
  const before = (await api.get('/alerts/config')).data?.thresholds
  const a = await k.open(k.ADMIN)
  check('Trends opens', await a.go('trends') && (await a.h1()) === 'Trends', await a.h1())
  check('the page shows its charts or says there is no data yet', await a.until(() => /CPU load|No trend data yet/.test(document.querySelector('main')?.innerText || ''), null, 30000))
  check('the tiles say something (no NaN or undefined)', await a.page.evaluate(() => /Current CPU/i.test(document.querySelector('main')?.innerText || '') && !/NaN|undefined/.test(document.querySelector('main')?.innerText || '')))

  // ---- ranges ----------------------------------------------------------------------------------------
  for (const [label, id] of RANGES.slice(1).concat([RANGES[0]])) {
    const n0 = a.requests.length
    await a.click(label, { within: RANGE })
    const asked = await a.until(() => true, null, 10).then(async () => {
      const end = Date.now() + 10000
      while (Date.now() < end) { if (a.requests.slice(n0).some((r) => /\/metrics\/trends$/.test(r.path) && r.search === `?range=${id}`)) return true; await k.sleep(200) }
      return false
    })
    check(`${label} asks for its range at once`, asked && await a.page.evaluate((v) => document.querySelector('[aria-label="Time range"] input:checked')?.value === v, id))
  }

  // ---- scope ------------------------------------------------------------------------------------------
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 20000)
  await a.click('media-vm', { within: SCOPE })
  check('media-vm shows the VM\'s trends, read through the hub', await a.waitText("The VM media-vm's trends, read through the hub.", { within: 'main', ms: 10000 }) && await a.until(() => /CPU load|No trend data yet|Could not load/.test(document.querySelector('main')?.innerText || ''), null, 20000))
  await a.click('Everywhere', { within: SCOPE })
  check('Everywhere says trends are kept per server (the hub\'s shown)', await a.waitText("Trends are kept per server: this is the hub's.", { within: 'main', ms: 10000 }))
  await a.click('Hub', { within: SCOPE })

  // ---- auto-refresh, refresh ----------------------------------------------------------------------------
  const pressed = () => a.page.evaluate(() => document.querySelector('main [aria-label="Auto-refresh"]')?.getAttribute('aria-pressed'))
  check('Auto-refresh starts on, with the Live mark', (await pressed()) === 'true' && await a.hasText('Live', 'main'))
  await a.click('Auto-refresh', { within: 'main' })
  check('Auto-refresh off: Paused, no Live mark', (await pressed()) === 'false' && await a.waitText('Paused', { within: 'main', ms: 3000 }) && !(await a.page.evaluate(() => [...document.querySelectorAll('main div')].some((d) => d.innerText.trim() === 'Live'))))
  const n1 = a.requests.length
  await a.click('Refresh', { within: 'main' })
  check('Refresh asks once more while paused', await a.until((n) => true, null, 10) && await (async () => { const end = Date.now() + 30000; while (Date.now() < end) { if (a.requests.slice(n1).some((r) => /\/metrics\/trends$/.test(r.path))) return true; await k.sleep(200) } return false })())
  await a.click('Auto-refresh', { within: 'main' })
  check('Auto-refresh on again', (await pressed()) === 'true')
  // paused, a new range still shows its own data at once
  await a.click('Auto-refresh', { within: 'main' })
  const n2 = a.requests.length
  await a.click('6 hours', { within: RANGE })
  check('paused, a new range still asks for its data', await (async () => { const end = Date.now() + 8000; while (Date.now() < end) { if (a.requests.slice(n2).some((r) => r.search === '?range=6h')) return true; await k.sleep(200) } return false })())
  await a.click('1 hour', { within: RANGE })
  await a.click('Auto-refresh', { within: 'main' })

  // ---- capture a snapshot --------------------------------------------------------------------------------
  await a.click('Capture a snapshot', { within: 'main' })
  check('Capture a snapshot says what happened', await a.waitToast(/Snapshot captured|Could not capture a snapshot/, 20000), JSON.stringify(await a.toasts()))
  if (await a.until(() => /CPU load/.test(document.querySelector('main')?.innerText || ''), null, 15000)) {
    check('the charts describe themselves (average and peak)', await a.page.evaluate(() => [...document.querySelectorAll('main [role="img"]')].some((e) => /average .* peak /.test(e.getAttribute('aria-label') || ''))))
  }
  await a.shot('trends-admin')

  // ---- the alert thresholds ------------------------------------------------------------------------------------
  await a.click('Alerts', { within: 'main' })
  check('Alerts opens the thresholds sheet with today\'s levels', await a.waitDialog('Alert thresholds', 8000) && (!before || (await slider(a, 'CPU warning')) === before.cpu_warning), `${await slider(a, 'CPU warning')} vs ${before?.cpu_warning}`)
  const crit = await slider(a, 'CPU critical')
  await setSlider(a, 'CPU warning', Math.min(100, crit + 5))
  check('a warning above its critical level is refused, with the reason', await a.waitText(/CPU: the warning \(\d+%\) must be below the critical level/, { within: '[role="dialog"]', ms: 3000 }) && await saveDisabled(a) === true)
  await setSlider(a, 'CPU warning', crit)
  check('…an equal one too', await saveDisabled(a) === true)
  const want = Math.max(10, crit - 7)
  await setSlider(a, 'CPU warning', want)
  check('a good level turns Save on again', await saveDisabled(a) === false && !(await a.hasText(/must be below/, '[role="dialog"]')))
  await a.click('Save thresholds', { within: '[role="dialog"]' })
  check('Save thresholds saves and closes', await a.waitToast('Alert thresholds updated', 15000) && await a.waitNoDialog(5000))
  await a.click('Alerts', { within: 'main' }); await a.waitDialog('Alert thresholds', 8000)
  check('the next opening reads the saved level back', await a.until((w) => Number(document.querySelector('[role="dialog"] input[aria-label="CPU warning"]')?.value) === w, want, 10000), `${await slider(a, 'CPU warning')} vs ${want}`)
  check('…and so does the server', (await api.get('/alerts/config')).data?.thresholds?.cpu_warning === want)
  // put it back as it was
  if (before) await setSlider(a, 'CPU warning', before.cpu_warning)
  await a.click('Save thresholds', { within: '[role="dialog"]' })
  await a.waitToast('Alert thresholds updated', 15000); await a.waitNoDialog(5000)
  check('the level is put back as it was', !before || (await api.get('/alerts/config')).data?.thresholds?.cpu_warning === before.cpu_warning)
  await a.click('Alerts', { within: 'main' }); await a.waitDialog('Alert thresholds', 8000)
  await a.click('Cancel', { within: '[role="dialog"]' })
  check('Cancel closes the sheet', await a.waitNoDialog(5000))
  await a.click('Alerts', { within: 'main' }); await a.waitDialog('Alert thresholds', 8000)
  await a.key('Escape')
  check('Escape closes it', await a.waitNoDialog(5000))

  // ---- a viewer ------------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Trends', await v.go('trends') && (await v.h1()) === 'Trends' && await v.until(() => /CPU load|No trend data yet/.test(document.querySelector('main')?.innerText || ''), null, 30000))
  check('a viewer is offered no Capture a snapshot and no Alerts', !(await v.exists('Capture a snapshot', { within: 'main' })) && !(await v.exists('Alerts', { within: 'main' })) && !(await v.exists('Capture the first snapshot', { within: 'main' })))
  await v.click('7 days', { within: RANGE })
  check('a viewer changes the range', await v.until(() => document.querySelector('[aria-label="Time range"] input:checked')?.value === '7d', null, 5000))

  // ---- phone, light -------------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('trends'); await p.until(() => /CPU load|No trend data yet/.test(document.querySelector('main')?.innerText || ''), null, 30000); await p.settle(600)
  check('phone: no sideways scroll on Trends', !(await p.overflow()), await p.overflow())
  await p.click('Alerts', { within: 'main' }); await p.waitDialog('Alert thresholds', 8000)
  // (the sheet slides up: wait until it rests on the bottom edge)
  await p.until(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); return d && Math.abs(d.getBoundingClientRect().bottom - innerHeight) <= 2 }, null, 3000)
  const sheet = await p.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop(); const r = d.getBoundingClientRect()
    return { bottom: Math.round(r.bottom), h: innerHeight, btns: [...d.querySelectorAll('button')].filter((b) => /^(Cancel|Save thresholds)$/.test(b.innerText.trim())).map((b) => Math.round(b.getBoundingClientRect().height)) }
  })
  check('phone: the thresholds are a bottom sheet with thumb-sized buttons', Math.abs(sheet.bottom - sheet.h) <= 2 && sheet.btns.length === 2 && sheet.btns.every((h) => h >= 40), JSON.stringify(sheet))
  await p.shot('trends-phone-alerts')
  await p.key('Escape')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('trends'); await l.until(() => /CPU load|No trend data yet/.test(document.querySelector('main')?.innerText || ''), null, 30000)
  check('light: Trends draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('trends-light')
}
