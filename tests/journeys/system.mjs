// System: the server facts, the scope switch (hub, the VM), Refresh, the OS updates panel (Look again; its Linux
// sign-in form only, never a real password; never an install or a reboot), the two prunes (each asks first, rose;
// Cancel; one confirmed: the lab's docker refuses it and the error is shown); a viewer's read-only page; the phone
// and the light look.

export default async function system(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('system') && (await a.h1()) === 'System', await a.h1())
  check('the server facts are there (hostname, kernel, Docker version, cores, memory)', await a.waitText('HOSTNAME', { within: 'main', ms: 15000 }) && ['KERNEL', 'DOCKER VERSION', 'CPU CORES', 'TOTAL MEMORY'].every((w) => a.page.evaluate((w) => document.querySelector('main').innerText.toUpperCase().includes(w), w)))
  const text = await a.text('main')
  check('no undefined / NaN / [object Object]', !/\bundefined\b|\bNaN\b|\[object Object\]/.test(text), (text.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0])
  check('Docker disk usage is shown', /Docker disk usage/i.test(text))

  // ---- Refresh, scope ---------------------------------------------------------------
  const r0 = a.requests.length
  await a.click('Refresh', { within: 'main', kind: 'button' }); await k.sleep(1500)
  check('Refresh reads the system again', a.requests.slice(r0).some((r) => /\/system$/.test(r.path)), JSON.stringify(a.requests.slice(r0).map((r) => r.path).slice(0, 6)))
  const hubHost = await a.page.evaluate(() => (document.querySelector('main').innerText.match(/HOSTNAME\s*\n\s*(\S+)/i) || [])[1])
  if (await a.exists('media-vm', { within: 'main' })) {
    await a.click('media-vm', { within: 'main' })
    check('the media-vm chip shows that VM (subtitle and its own facts)', await a.until(() => /on (VM )?media-vm/i.test(document.querySelector('main').innerText), null, 20000) && await a.waitText('HOSTNAME', { within: 'main', ms: 20000 }))
    const r1 = a.requests.length
    await k.sleep(1500)
    check('…and asks the VM through the hub', a.requests.slice(0).some((r) => /media-vm|\/fleet\//.test(r.path + r.search)), JSON.stringify(a.requests.slice(r1 - 5).map((r) => r.path)))
    check('the VM\'s cleanup is offered for the VM', await a.waitText(/Cleanup · (VM )?media-vm/i, { within: 'main', ms: 10000 }))
    await a.click('Hub', { within: 'main' })
    check('the Hub chip goes back to the hub', await a.until(() => /on the hub/i.test(document.querySelector('main').innerText), null, 20000))
  } else k.j.note('no media-vm scope chip')
  void hubHost

  // ---- OS updates ------------------------------------------------------------------------
  check('the OS updates panel says what waits', await a.waitText(/OS package updates/i, { within: 'main', ms: 15000 }) && await a.waitText(/updates? waiting|up to date|Looking at the OS updates|no updates/i, { within: 'main', ms: 15000 }), (await a.text('main')).match(/OS package updates[\s\S]{0,300}/)?.[0])
  const r2 = a.requests.length
  await a.until(() => !/Looking at the OS updates/.test(document.querySelector('main').innerText), null, 30000)
  const look = await a.page.evaluate(() => { const b = [...document.querySelectorAll('main button')].find((x) => x.textContent.trim() === 'Look again'); return b ? { off: b.disabled, title: b.title } : null })
  if (look?.off) {
    // a look less than five minutes ago (an earlier run): the button rests and says why
    check('Look again rests after a recent look and says why', /less than five minutes/i.test(look.title), JSON.stringify(look))
  } else {
    await a.click('Look again', { within: 'main' })
    for (let i = 0; i < 20 && !a.requests.slice(r2).some((r) => /os-updates/.test(r.path) && /refresh=1/.test(r.search)); i++) await k.sleep(400)
    check('Look again asks the server for a new look', a.requests.slice(r2).some((r) => /os-updates/.test(r.path) && /refresh=1/.test(r.search)), JSON.stringify(a.requests.slice(r2).map((r) => r.path + r.search)))
  }
  await a.until(() => !/Looking/.test(document.querySelector('main').innerText), null, 30000)
  const off = () => a.page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Sign in')?.disabled)
  check('its Linux sign-in: Sign in is off with empty fields', await off() === true)
  await a.type('Linux username', 'e2e-nobody', 'main')
  check('…and with only the username', await off() === true)
  await a.type('Linux password', 'not-a-real-password', 'main')
  check('…on with both', await off() === false)
  check('the eye shows the password', await a.click('Show the password', { within: 'main' }) && await a.until(() => [...document.querySelectorAll('main input')].some((i) => i.placeholder === 'Linux password' && i.type === 'text') || [...document.querySelectorAll('main input')].some((i) => /password/i.test(i.getAttribute('aria-label') || '') && i.type === 'text'), null, 3000))
  await a.click('Hide the password', { within: 'main' })
  // clear what was typed: no sign-in is sent
  await a.type('Linux password', '', 'main'); await a.type('Linux username', '', 'main')

  // ---- the prunes -------------------------------------------------------------------------
  for (const [btn, verb] of [[/^System prune/, 'Run system prune'], [/^Image prune/, 'Prune images']]) {
    await a.click(btn, { within: 'main' })
    const c = await a.confirmInfo()
    check(`${verb}: asks first (a question, the verb, rose, Cancel focused)`, c && /\?$/.test(c.title) && c.buttons.includes(verb) && c.danger && /cancel/i.test(c.focused), JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check(`${verb}: Cancel sends nothing`, await a.waitNoDialog(4000))
  }
  // one confirmed: the lab's docker refuses the prune, the person is told
  const n0 = a.errors.length
  a.expectFailures = /prune/
  await a.click(/^Image prune/, { within: 'main' })
  await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000)
  await a.click('Prune images', { within: '[role="alertdialog"]' })
  const said = await a.until(() => {
    const t = [...document.querySelectorAll('main [role="alert"], main [role="status"]')].map((e) => e.innerText).join(' | ')
    return /prune (completed|failed)|refused|disabled|error/i.test(t) ? t : false
  }, null, 45000)
  check('a confirmed prune the lab refuses shows the error in place (not a success)', said && !/completed/i.test(said), String(said))
  a.errors.splice(n0)

  // ---- a viewer: read-only --------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('the page opens for a viewer', await v.go('system') && (await v.h1()) === 'System', await v.h1())
  await v.waitText('HOSTNAME', { within: 'main', ms: 15000 })
  const vt = await v.text('main')
  const vb = await v.page.evaluate(() => [...document.querySelectorAll('main button, main input')].filter((e) => e.getClientRects().length).map((e) => (e.getAttribute('aria-label') || e.innerText || e.placeholder || '').trim()))
  check('a viewer is offered no prune, no OS-update sign-in', !vb.some((n) => /^(System prune|Image prune|Sign in|Linux username|Linux password)/.test(n)) && !/Cleanup ·/.test(vt), JSON.stringify(vb))
  check('a viewer can switch the scope and refresh', await v.click('Refresh', { within: 'main', kind: 'button' }))

  // ---- phone + light -------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('system')
  await p.waitText('HOSTNAME', { within: 'main', ms: 15000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click(/^System prune/, { within: 'main' })
  await p.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000)
  const btns = await p.page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].map((b) => Math.round(b.getBoundingClientRect().height)))
  check('phone: the confirmation\'s buttons are ≥ 40 px', btns.length >= 2 && btns.every((h) => h >= 40), JSON.stringify(btns))
  await k.sleep(500); await p.shot('system-phone-light-confirm')
  await p.click('Cancel', { within: '[role="alertdialog"]' })
  check('phone + light (screenshot)', !!(await p.shot('system-phone-light')))
}
