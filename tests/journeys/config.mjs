// Config: every card is there and folds; the validation of the number fields (empty, out of range → a message,
// Save refused); ONE harmless value (the notifications' repeat cooldown) changed, saved, read back after a reload
// and put back; Reset; Refresh; the Proxmox card's Test connection (the lab's mock); a viewer never reaches the
// page; the phone and the light look. Never touched: API_*, auth, port, bind, session, rate limits, PROXMOX_*, FLEET_*.

const CARDS = ['Environment', 'Paths', 'Feature flags', 'Display & colors', 'Log formatting', 'API server', 'Notifications', 'Security',
  'Traefik & DNS', 'Proxmox', 'Docker', 'Health & monitoring', 'Metrics & features', 'Backup', 'Recovery bundle', 'Power (UPS)', 'Unattended updates']

export default async function config(k) {
  const { check } = k
  const api = await k.apiAs(k.ADMIN)
  const orig = (await api.get('/config')).data
  const cd0 = orig?.notify_cooldown_minutes ?? 60
  const cd1 = cd0 === 61 ? 62 : 61

  const a = await k.open(k.ADMIN)
  // what Save sends: only the key that was changed (never an API_*/PROXMOX_* key riding along)
  const posted = []
  a.page.on('request', (r) => { if (r.method() === 'POST' && /\/config$/.test(new URL(r.url()).pathname)) posted.push(r.postData() || '') })
  check('the page opens for an admin', await a.go('config') && (await a.h1()) === 'Config', await a.h1())
  await a.until(() => !!document.querySelector('main h2 button[aria-expanded]'), null, 20000)
  const cards = await a.page.evaluate(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].map((b) => ({ t: document.getElementById(b.getAttribute('aria-labelledby'))?.textContent.trim(), open: b.getAttribute('aria-expanded') === 'true' })))
  const missing = CARDS.filter((c) => !cards.some((x) => x.t === c))
  check(`all ${CARDS.length} cards are there`, !missing.length, `missing ${JSON.stringify(missing)}; got ${JSON.stringify(cards.map((c) => c.t))}`)
  // open every folded card (a person reads them all), remember which were folded to put them back
  const folded = cards.filter((c) => !c.open).map((c) => c.t)
  for (const t of folded) await a.page.evaluate((t) => [...document.querySelectorAll('main h2 button[aria-expanded]')].find((b) => document.getElementById(b.getAttribute('aria-labelledby'))?.textContent.trim() === t)?.click(), t)
  check('every card unfolds', await a.until(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].every((b) => b.getAttribute('aria-expanded') === 'true'), null, 5000))
  const text = await a.text('main')
  check('no undefined / NaN / [object Object] in any card', !/\bundefined\b|\bNaN\b|\[object Object\]/.test(text), (text.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0])
  const redOnLoad = await a.page.evaluate(() => [...document.querySelectorAll('main [aria-invalid="true"]')].map((e) => e.id))
  check('no field is marked wrong as loaded', !redOnLoad.length, JSON.stringify(redOnLoad))
  // fold one and back
  const fold = () => a.page.evaluate(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].find((b) => document.getElementById(b.getAttribute('aria-labelledby'))?.textContent.trim() === 'Paths')?.click())
  await fold()
  check('a card folds (Paths), its fields leave the tab order', await a.until(() => {
    const b = [...document.querySelectorAll('main h2 button[aria-expanded]')].find((x) => document.getElementById(x.getAttribute('aria-labelledby'))?.textContent.trim() === 'Paths')
    return b?.getAttribute('aria-expanded') === 'false' && getComputedStyle(document.getElementById(b.getAttribute('aria-controls'))).visibility === 'hidden'
  }, null, 4000))
  await fold()

  // ---- Refresh with nothing changed ------------------------------------------------
  const r0 = a.requests.length
  await a.click('Refresh', { within: 'main', kind: 'button' }); await k.sleep(1200)
  check('Refresh (nothing changed) reads the settings again', a.requests.slice(r0).some((r) => r.path === '/config' && r.method === 'GET'))

  // ---- validation of the number fields ----------------------------------------------
  await a.type('Repeat cooldown', '', 'main')
  check('an empty number field says what it needs (regression: it was sent as KEY=)', await a.waitText(/A whole number from 0 to 999999/, { within: 'main', ms: 3000 }))
  check('…and the header button turns into Save changes', await a.exists('Save changes', { within: 'main', kind: 'button' }))
  await a.click('Save changes', { within: 'main', kind: 'button' })
  check('Save refuses while a value is wrong, and says so', await a.waitText(/Nothing was saved: correct the value marked in red/, { within: 'main [role="alert"]', ms: 4000 }))
  const after = (await api.get('/config')).data
  check('…the server still has the old cooldown', (after?.notify_cooldown_minutes ?? 60) === cd0, String(after?.notify_cooldown_minutes))
  await a.type('Log backup count', '500', 'main')
  check('a number above its range says the range', await a.waitText(/A whole number from 1 to 100/, { within: 'main', ms: 3000 }))
  check('Reset puts every field back and clears the messages', await a.click('Reset', { within: 'main', kind: 'button' }) && await a.until(() => !document.querySelector('main [aria-invalid="true"]'), null, 4000) && (await a.value('Repeat cooldown', 'main')) === String(cd0), await a.value('Repeat cooldown', 'main'))
  check('…and Save changes is gone again', await a.until(() => ![...document.querySelectorAll('main button')].some((b) => b.textContent.includes('Save changes')), null, 4000))

  // ---- change one harmless value, save, read back, put back ---------------------------
  await a.type('Repeat cooldown', String(cd1), 'main')
  check('Save changes saves the cooldown', await a.click('Save changes', { within: 'main', kind: 'button' }) && await a.until(() => !!document.querySelector('main [role="status"]') && !/Saving/.test(document.querySelector('main').innerText), null, 20000), await a.text('main [role="status"], main [role="alert"]'))
  const saved = (await api.get('/config')).data
  check('Save sent only the changed key', posted.length === 1 && JSON.stringify(Object.keys(JSON.parse(posted[0]))) === '["NOTIFY_COOLDOWN_MINUTES"]', JSON.stringify(posted))
  check('the server has the new cooldown', saved?.notify_cooldown_minutes === cd1, String(saved?.notify_cooldown_minutes))
  await a.reload()
  await a.until(() => !!document.querySelector('main h2 button[aria-expanded]'), null, 20000)
  check('after a reload the field reads the saved value', await a.until((v) => [...document.querySelectorAll('main label')].find((l) => l.textContent.trim() === 'Repeat cooldown')?.control?.value === v, String(cd1), 15000), await a.value('Repeat cooldown', 'main'))
  await a.type('Repeat cooldown', String(cd0), 'main')
  await a.click('Save changes', { within: 'main', kind: 'button' })
  await a.until(() => ![...document.querySelectorAll('main button')].some((b) => b.textContent.includes('Saving')), null, 20000)
  const back = (await api.get('/config')).data
  check('…and it is put back as it was', (back?.notify_cooldown_minutes ?? 60) === cd0, String(back?.notify_cooldown_minutes))
  if ((back?.notify_cooldown_minutes ?? 60) !== cd0) await api.post('/config', { NOTIFY_COOLDOWN_MINUTES: cd0 })

  // ---- Proxmox: Test connection (the lab's mock Proxmox) --------------------------------
  const n0 = a.errors.length
  if (await a.click('Test connection', { within: 'main', ms: 4000 })) {
    check('Proxmox Test connection answers, announced (role status/alert)', await a.until(() => [...document.querySelectorAll('main [role="status"], main [role="alert"]')].some((e) => /Connected: Proxmox VE|Not reachable|refused|timed out/i.test(e.innerText)), null, 30000), await a.text('main'))
  } else check('the Proxmox card has Test connection', false)
  a.errors.splice(n0)

  // put the folded cards back as the person had them
  for (const t of folded) await a.page.evaluate((t) => [...document.querySelectorAll('main h2 button[aria-expanded]')].find((b) => document.getElementById(b.getAttribute('aria-labelledby'))?.textContent.trim() === t)?.click(), t)

  // ---- a viewer never reaches it -------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/config' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(600)
  check('a viewer\'s link to #/config lands on the dashboard', (await v.h1()) === 'Dashboard', await v.h1())
  await v.go('settings')
  const strip = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('a viewer\'s Settings strip has no Config', !strip.some((n) => /^Config/.test(n)), JSON.stringify(strip))

  // ---- phone + light --------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('config')
  await p.until(() => !!document.querySelector('main h2 button[aria-expanded]'), null, 20000)
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.type('Log backup count', '0', 'main')
  await k.sleep(300)
  check('phone: a field\'s message fits (no sideways scroll)', !(await p.overflow()), await p.overflow())
  await p.shot('config-phone-light-invalid')
  await p.click('Reset', { within: 'main', kind: 'button' })
  check('phone + light (screenshot)', !!(await p.shot('config-phone-light')))
}
