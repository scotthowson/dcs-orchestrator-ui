// Terminal: only its Linux sign-in form (never a real password): Sign in stays off until both fields are filled,
// the password's eye, the "remember" switch, a made-up account refused with the words for it (and the dashboard
// session kept); a viewer never reaches the page (link, keyboard, the Tools strip); the phone and the light look.

export default async function terminal(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('terminal') && (await a.h1()) === 'Terminal', await a.h1())
  check('it asks for a Linux account first', await a.waitText('Sign in with a Linux account', { within: 'main', ms: 15000 }))
  const user = await a.field('#terminal-username')
  check('the username field has the focus', user && await user.evaluate((e) => e === document.activeElement))
  await user?.dispose()
  const signInOff = () => a.page.evaluate(() => [...document.querySelectorAll('main form button[type="submit"]')][0]?.disabled)
  check('Sign in is off with both fields empty', await signInOff() === true)
  await a.type('#terminal-username', 'e2e-nobody')
  check('…and with only the username', await signInOff() === true)
  await a.type('#terminal-username', '   ')
  await a.type('#terminal-password', 'not-a-real-password-e2e')
  check('…and with a username of only spaces', await signInOff() === true)
  await a.type('#terminal-username', 'e2e-nobody')
  check('both filled: Sign in is on', await signInOff() === false)
  const pwType = () => a.page.evaluate(() => document.querySelector('#terminal-password')?.type)
  check('the eye shows the password', await a.click('Show the password', { within: 'main' }) && await a.until(() => document.querySelector('#terminal-password')?.type === 'text', null, 3000))
  check('…and hides it again (its name follows)', await a.click('Hide the password', { within: 'main' }) && (await pwType()) === 'password')
  const sw = await a.page.$('main form input[aria-labelledby="terminal-remember"]')
  const sw0 = sw ? await sw.evaluate((e) => e.checked) : null
  if (sw) { await sw.click(); await sw.dispose() }
  check('the "remember" switch flips', sw0 === true && await a.until(() => document.querySelector('main [role="switch"], main input[type="checkbox"]')?.checked === false, null, 3000), String(sw0))
  // a made-up account: the server says no
  await a.click('Sign in', { within: 'main form', kind: 'button' })
  const err = await a.waitText(/Wrong Linux username or password|requires the credentials|Too many failed attempts/, { within: 'main [role="alert"]', ms: 30000 })
  check('a made-up account is refused with the words for it', err, await a.text('main form'))
  await k.sleep(800)
  check('…and the dashboard session is kept (still on Terminal, signed in)', (await a.h1()) === 'Terminal' && !(await a.page.$('#signin-password')))
  check('the fields stay filled to correct them', (await a.value('#terminal-username')) === 'e2e-nobody')
  check('the session hint is there', await a.hasText('Terminal sessions expire after 4 hours', 'main'))

  // ---- a viewer never reaches it -------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/terminal' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(600)
  check('a viewer\'s link to #/terminal lands on the dashboard', (await v.h1()) === 'Dashboard' && !(await v.page.$('#terminal-username')), await v.h1())
  await v.chord('Control', 't'); await k.sleep(800)
  check('Ctrl+T keeps a viewer off the Terminal', (await v.h1()) !== 'Terminal', await v.h1())
  await v.go('bookmarks')
  const strip = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('a viewer\'s Tools strip has no Terminal', !strip.some((n) => /^Terminal/.test(n)), JSON.stringify(strip))
  const side = await v.text('aside')
  check('a viewer\'s sidebar does not offer Terminal', !/\bTerminal\b/.test(side), side.slice(0, 200))
  await v.chord('Control', 'k'); await v.waitDialog('Search', 8000)
  await v.page.keyboard.type('terminal')
  await k.sleep(500)
  const pal = await v.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.innerText.split('\n')[0].trim()))
  check('the palette does not offer a viewer the Terminal', !pal.some((n) => /^(Go to )?Terminal$/.test(n)), JSON.stringify(pal.slice(0, 6)))
  await v.key('Escape')

  // ---- phone + light ----------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('terminal')
  await p.waitText('Sign in with a Linux account', { within: 'main', ms: 15000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  const btnH = await p.page.evaluate(() => document.querySelector('main form button[type="submit"]')?.getBoundingClientRect().height)
  check('phone: Sign in is thumb-sized (≥ 40 px)', btnH >= 40, String(btnH))
  check('phone + light (screenshot)', !!(await p.shot('terminal-phone-light')))
}
