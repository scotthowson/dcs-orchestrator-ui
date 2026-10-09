// Diagnostics: the panels (score, gauges, container matrix, image freshness, ports, events, networks, alerts — no NaN),
// Refresh all (every request asked again), the port checks (each opens its address; captured, nothing is opened),
// Stop all / Restart all (ask first — never confirmed), Reset app and Full reset (their confirmation forms: the
// keyword alone keeps them off; Cancel — no password is ever typed), a viewer (no server control, no reset), the phone
// and the light look.

const loaded = (t, ms = 30000) => t.until(() => /Port allocation map/i.test(document.querySelector('main')?.innerText || '') && !!document.querySelector('main [role="img"][aria-label^="Health score"]'), null, ms)
const stubOpen = (t) => t.page.evaluate(() => { window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null } })

export default async function diagnostics(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Diagnostics opens', await a.go('diagnostics') && (await a.h1()) === 'Diagnostics', await a.h1())
  check('the panels load: score, gauges, matrix, image freshness, ports, events, networks, alerts', await loaded(a) && await a.until(() => ['System health score', 'Resource gauges', 'Container health matrix', 'Image freshness', 'Port allocation map', 'Event frequency', 'Networks', 'Active alerts'].every((h) => (document.querySelector('main')?.innerText || '').toLowerCase().includes(h.toLowerCase())), null, 20000))
  check('nothing reads NaN or undefined', !(await a.hasText(/\bNaN\b|undefined/, 'main')), (await a.text('main')).match(/.{0,40}(NaN|undefined).{0,40}/)?.[0])
  check('the container matrix names each square', await a.page.evaluate(() => { const s = [...document.querySelectorAll('main [aria-label="Containers by health"] [role="listitem"]')]; return s.length > 0 && s.every((e) => /: /.test(e.getAttribute('aria-label') || '')) }))

  // ---- Refresh all ------------------------------------------------------------------------------------
  const n0 = a.requests.length
  check('Refresh all asks every panel again', await a.click('Refresh all', { within: 'main' }) && await a.until(() => true, null, 10) && await (async () => {
    const end = Date.now() + 10000
    while (Date.now() < end) {
      const paths = new Set(a.requests.slice(n0).map((r) => r.path))
      if (['/status', '/containers', '/networks'].every((p) => [...paths].some((x) => x === p || x.endsWith(p)))) return true
      await k.sleep(250)
    }
    return [...new Set(a.requests.slice(n0).map((r) => r.path))].join(' ')
  })() === true)

  // ---- the port checks ------------------------------------------------------------------------------------
  await stubOpen(a)
  const ports = await a.page.evaluate(() => [...document.querySelectorAll('main button')].filter((b) => /^:\d+$/.test(b.innerText.trim())).map((b) => ({ p: b.innerText.trim(), title: b.title, disabled: b.disabled })))
  check('the port map lists the published ports, sorted', ports.length > 0 && ports.map((x) => Number(x.p.slice(1))).every((n, i, arr) => i === 0 || arr[i - 1] <= n), JSON.stringify(ports.map((x) => x.p)))
  const first = ports.find((x) => !x.disabled)
  if (first) {
    await a.click(first.p, { within: 'main' })
    const opened = await a.until(() => window.__opened?.[0], null, 3000)
    check(`a port (${first.p}) opens its own address in a new tab`, !!opened && opened.endsWith(first.p) && first.title === `Open ${opened}`, `${opened} / ${first.title}`)
  }
  const vmPort = await a.page.evaluate(() => [...document.querySelectorAll('main tr')].find((tr) => /· media-vm/.test(tr.innerText))?.querySelector('button')?.title)
  check('a VM\'s port opens the VM\'s address (or says it is not known yet)', !vmPort || /^Open http:\/\/(?!localhost)/.test(vmPort) || /not known yet/.test(vmPort), vmPort)

  // ---- server control (never confirmed) ------------------------------------------------------------------------
  for (const [btn, title, verb] of [[/^Stop all/, 'Stop all stacks?', 'Stop all stacks'], [/^Restart all/, 'Restart all stacks?', 'Restart all stacks']]) {
    await a.click(btn, { within: 'main' })
    const ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check(`${title.replace('?', '')} asks first (danger, the verb, Cancel focused)`, ci && ci.title === title && ci.danger && ci.buttons.includes(verb) && ci.focused === 'Cancel', JSON.stringify(ci))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check(`…Cancel runs nothing (${title})`, await a.waitNoDialog(5000) && !(await a.hasText(/stacks succeeded|Failed to (stop|restart)/, 'main')))
  }

  // ---- factory reset forms (Cancel only; no password is typed) ---------------------------------------------------
  await a.click('Reset app', { within: 'main' })
  check('Reset app opens its confirmation (password + RESET)', await a.waitText('Confirm app reset', { within: 'main', ms: 5000 }) && !!(await a.field('Type RESET to confirm', 'main')))
  const confirmBtn = () => a.page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => /^Confirm (app|full) reset$/.test(b.innerText.trim()))?.disabled)
  await a.type('Type RESET to confirm', 'RESET', 'main')
  check('the keyword alone (no password) keeps Confirm app reset off', await confirmBtn() === true)
  await a.click('Cancel', { within: 'main' })
  check('Cancel goes back to the two choices', await a.until(() => /Reset app settings/.test(document.querySelector('main')?.innerText || '') && !/Confirm app reset/.test(document.querySelector('main')?.innerText || ''), null, 5000))
  await a.click('Full reset', { within: 'main' })
  check('Full reset opens its confirmation (password + WIPE, the stacks switch off)', await a.waitText('Confirm full server reset', { within: 'main', ms: 5000 }) && await a.page.evaluate(() => document.querySelector('main [aria-label="Also wipe the stacks and their data"]')?.checked === false))
  await a.type('Type WIPE to confirm', 'WIPE', 'main')
  check('the keyword alone keeps Confirm full reset off', await confirmBtn() === true)
  await a.click('Cancel', { within: 'main' })
  check('Cancel leaves the full reset', await a.until(() => !/Confirm full server reset/.test(document.querySelector('main')?.innerText || ''), null, 5000))
  await a.shot('diagnostics-admin')

  // ---- a viewer -----------------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Diagnostics', await v.go('diagnostics') && (await v.h1()) === 'Diagnostics' && await loaded(v))
  check('a viewer is offered no server control and no factory reset', !(await v.exists(/^(Start all|Stop all|Restart all)/, { within: 'main' })) && !(await v.exists('Reset app', { within: 'main' })) && !(await v.exists('Full reset', { within: 'main' })))
  await stubOpen(v)
  const vp = await v.find(/^:\d+$/, { within: 'main', kind: 'button' })
  if (vp) { await vp.click(); await vp.dispose() }
  check('a viewer opens a port', !vp || !!(await v.until(() => window.__opened?.length, null, 3000)))

  // ---- phone, light -------------------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('diagnostics'); await loaded(p); await p.settle(800)
  check('phone: no sideways scroll on Diagnostics', !(await p.overflow()), await p.overflow())
  await p.shot('diagnostics-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('diagnostics'); await loaded(l)
  check('light: Diagnostics draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('diagnostics-light')
}
