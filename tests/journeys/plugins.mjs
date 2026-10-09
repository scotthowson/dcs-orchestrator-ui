// Plugins: the catalogue, a plugin's details, the guide, Refresh, Card Studio (open, Cancel, Escape), Install from
// Git (validation, a clone that fails on this machine's own closed port → its error, Cancel), switching the installed
// compose-linter off and on again, installing one catalogue plugin into the lab and removing it again (asks first);
// a viewer never reaches the page; the phone (bottom sheets) and the light look.

const THROWAWAY = 'stack-analytics' // a catalogue plugin that only writes its own state directory (and only on a deploy)

export default async function plugins(k) {
  const { check } = k
  const api = await k.apiAs(k.ADMIN)
  const before = (await api.get('/plugins')).data?.plugins?.map((p) => p.name) || []
  const preInstalled = before.includes(THROWAWAY)

  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('plugins') && (await a.h1()) === 'Plugins', await a.h1())
  check('the catalogue lists its plugins by group', await a.waitText(/Safety and validation/i, { within: 'main', ms: 15000 }) && await a.hasText(THROWAWAY, 'main'))
  const named = await a.page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => b.getAttribute('aria-label') || '').filter((n) => /details/i.test(n)))
  check('every "details" button names its plugin (regression: 20 buttons were all "Plugin details")', named.length > 3 && named.every((n) => /^Details of \S+/.test(n)) && new Set(named).size >= named.length - 1, JSON.stringify(named.slice(0, 4)))
  const det = await a.find(`Details of ${THROWAWAY}`, { within: 'main' })
  if (det) { await det.hover(); await det.dispose() }
  check('pointing at a plugin\'s details shows them', await a.until((n) => [...document.querySelectorAll('[role="tooltip"], .mantine-Tooltip-tooltip')].some((t) => t.innerText.includes(n)), THROWAWAY, 5000))
  await a.page.mouse.move(5, 5)

  // ---- guide, refresh ----------------------------------------------------------
  check('Plugin guide opens the guide', await a.click('Plugin guide', { within: 'main' }) && await a.waitText('Create your own plugin', { within: 'main', ms: 5000 }))
  const g = await a.find(/^Directory structure/, { within: 'main', kind: 'button' })
  if (g) { await g.click(); await g.dispose() }
  check('a guide topic unfolds', !!g && await a.until(() => /plugin\.json/.test(document.querySelector('main').innerText), null, 4000))
  check('the guide\'s ✕ closes it', await a.click('Close the guide', { within: 'main' }) && await a.until(() => !document.querySelector('main').innerText.includes('Create your own plugin'), null, 4000))
  const r0 = a.requests.length
  await a.click('Refresh', { within: 'main' }); await k.sleep(1200)
  check('Refresh reads the plugins again', a.requests.slice(r0).some((r) => r.path === '/plugins'), JSON.stringify(a.requests.slice(r0).map((r) => r.path)))

  // ---- Card Studio ----------------------------------------------------------------
  check('Card Studio opens', await a.click('Card Studio', { within: 'main' }) && await a.waitDialog(/Card Studio/, 8000))
  check('its footer says Cancel (a form is left with Cancel, regression)', await a.exists('Cancel', { kind: 'button' }) && !(await a.exists('Close', { kind: 'button', within: '[role="dialog"] .border-t' })))
  check('Cancel closes it', await a.click('Cancel', { kind: 'button' }) && await a.waitNoDialog(5000))
  await a.click('Card Studio', { within: 'main' }); await a.waitDialog(/Card Studio/, 8000)
  await a.key('Escape')
  check('Escape closes it too', await a.waitNoDialog(5000))

  // ---- Install from Git -------------------------------------------------------------
  check('Install from Git opens its dialog', await a.click('Install from Git', { within: 'main' }) && await a.waitDialog(/Install from Git/, 8000))
  const instOff = () => a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => /Install plugin/.test(b.textContent))?.disabled)
  check('Install plugin is off while the address is empty', await instOff() === true)
  await a.type('Repository URL', 'not a repository')
  check('an address git cannot clone is refused with a message (regression)', await a.waitText(/https:\/\/…, ssh:\/\/… or git@/, { within: '[role="dialog"]', ms: 3000 }) && await instOff() === true)
  await a.type('Repository URL', 'https://127.0.0.1:9/e2e-nothing.git')
  check('a cloneable address turns it on', await instOff() === false)
  const n0 = a.errors.length
  a.expectFailures = /\/plugins\/install/
  await a.click('Install plugin', { kind: 'button' })
  const failed = await a.waitToast(/./, 60000)
  check('a clone that fails shows the error (regression: it ended in silence)', failed && !/installed$/i.test(failed), JSON.stringify(await a.toasts()))
  a.errors.splice(n0)
  check('…and the dialog stays open to correct it', !!(await a.waitDialog(/Install from Git/, 3000)))
  await a.click('Cancel', { kind: 'button' })
  check('Cancel closes it', await a.waitNoDialog(5000))
  const after = (await api.get('/plugins')).data?.plugins?.map((p) => p.name) || []
  check('nothing was installed by the failed clone', after.length === before.length, JSON.stringify(after))

  // ---- the built-in compose-linter (the dashboard's own, kept in this browser): off and on again ----------
  const SEL = 'main input[aria-label="compose-linter enabled"]'
  const states = () => a.page.evaluate((sel) => [...document.querySelectorAll(sel)].map((e) => e.checked), SEL)
  const on0 = (await states())[0]
  check('compose-linter (built in) has its switch in its catalogue card', (await states()).length >= 1, JSON.stringify(await states()))
  await a.page.evaluate((sel) => document.querySelector(sel).click(), SEL)
  check('its switch turns it off, everywhere it is listed', await a.until(({ sel, was }) => [...document.querySelectorAll(sel)].every((e) => e.checked === !was), { sel: SEL, was: on0 }, 8000), JSON.stringify(await states()))
  await a.reload()
  check('…and it stays off after a reload (this browser)', (await states()).every((x) => x === !on0), JSON.stringify(await states()))
  await a.page.evaluate((sel) => document.querySelector(sel).click(), SEL)
  check('…and on again, as it was', await a.until(({ sel, was }) => [...document.querySelectorAll(sel)].every((e) => e.checked === was), { sel: SEL, was: on0 }, 8000))
  check('a built-in is not offered Remove (the server has nothing to remove; regression: it failed in silence)', !(await a.exists('Remove compose-linter', { within: 'main' })))
  check('a built-in is not listed under Installed (regression: the list was never empty)', await a.page.evaluate(() => {
    const h = [...document.querySelectorAll('main h2')].find((x) => /^Installed/i.test(x.textContent.trim()))
    const sec = h?.closest('div')?.parentElement
    return !!sec && ![...sec.querySelectorAll('h3')].some((t) => t.textContent.trim() === 'compose-linter')
  }))
  if (!before.length) check('with nothing installed on the server, Installed says so the kit\'s way', await a.page.evaluate(() => [...document.querySelectorAll('main [data-state="empty"]')].some((e) => /No plugins installed yet/.test(e.innerText))))

  // ---- install a catalogue plugin, remove it ----------------------------------------------
  if (!preInstalled) {
    const card = await a.page.evaluateHandle((n) => [...document.querySelectorAll('main h3')].find((h) => h.textContent.trim() === n)?.closest('div.surface, div[class*="surface"], div[class*="glass"]') || null, THROWAWAY)
    const inst = card.asElement() ? await card.asElement().$('button:not([aria-label])') : null
    await card.dispose()
    if (inst) { await inst.evaluate((b) => b.scrollIntoView({ block: 'center' })); await inst.click(); await inst.dispose() }
    check(`installing ${THROWAWAY} from the catalogue`, !!inst && await a.waitToast(`${THROWAWAY} installed`, 60000), JSON.stringify(await a.toasts()))
    check('…it appears under Installed with its own switch and Remove', await a.until((n) => !!document.querySelector(`main [aria-label="Remove ${n}"]`), THROWAWAY, 15000))
    await a.click(`Remove ${THROWAWAY}`, { within: 'main' })
    const c = await a.confirmInfo()
    check('Remove asks first (a question, the verb, rose)', c && /\?$/.test(c.title) && c.buttons.includes('Remove plugin') && c.danger, JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('Cancel keeps it', await a.waitNoDialog(4000) && await a.exists(`Remove ${THROWAWAY}`, { within: 'main' }))
    await a.click(`Remove ${THROWAWAY}`, { within: 'main' }); await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000)
    await a.click('Remove plugin', { within: '[role="alertdialog"]' })
    check('confirming removes it', await a.waitToast(`${THROWAWAY} removed`, 30000) && await a.until((n) => !document.querySelector(`main [aria-label="Remove ${n}"]`), THROWAWAY, 10000))
    const end = (await api.get('/plugins')).data?.plugins?.map((p) => p.name) || []
    if (end.includes(THROWAWAY)) await api.del(`/plugins/${THROWAWAY}`)
    check('the lab has the plugins it had before', !end.includes(THROWAWAY))
  } else k.j.note(`${THROWAWAY} was already installed: the install/remove pass was skipped`)

  // ---- a viewer never reaches it -------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/plugins' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(600)
  check('a viewer\'s link to #/plugins lands on the dashboard', (await v.h1()) === 'Dashboard', await v.h1())
  await v.go('bookmarks')
  const strip = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('a viewer\'s Tools strip has no Plugins', !strip.some((n) => /^Plugins/.test(n)), JSON.stringify(strip))

  // ---- phone + light ------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('plugins')
  await p.waitText(THROWAWAY, { within: 'main', ms: 15000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Install from Git', { within: 'main' }); await p.waitDialog(/Install from Git/, 8000)
  const geo = (re) => p.page.evaluate((re) => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop()
    const panel = d?.firstElementChild
    const r = panel?.getBoundingClientRect()
    const btns = [...(d?.querySelectorAll('button') || [])].filter((b) => new RegExp(re).test(b.textContent.trim())).map((b) => Math.round(b.getBoundingClientRect().height))
    return { bottom: r ? Math.round(window.innerHeight - r.bottom) : null, width: r ? Math.round(r.width) : null, btns }
  }, re)
  const gi = await geo('^(Cancel|Install plugin)$')
  check('phone: Install from Git is a bottom sheet with ≥ 40 px buttons (regression)', gi.bottom <= 1 && gi.width >= 388 && gi.btns.length === 2 && gi.btns.every((h) => h >= 40), JSON.stringify(gi))
  await k.sleep(700); await p.shot('plugins-phone-light-install')
  await p.key('Escape'); await p.waitNoDialog(4000)
  await p.click('Card Studio', { within: 'main' }); await p.waitDialog(/Card Studio/, 8000)
  const gs = await geo('^(Cancel|Save card)$')
  check('phone: Card Studio is a bottom sheet with ≥ 40 px buttons (regression)', gs.bottom <= 1 && gs.width >= 388 && gs.btns.every((h) => h >= 40), JSON.stringify(gs))
  await k.sleep(700); await p.shot('plugins-phone-light-studio')
  await p.key('Escape'); await p.waitNoDialog(4000)
  check('phone + light (screenshot)', !!(await p.shot('plugins-phone-light')))
}
