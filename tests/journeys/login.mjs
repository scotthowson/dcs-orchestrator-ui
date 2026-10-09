// The sign-in page: Sign in stays off until both fields are filled, the password's eye, the "keep me signed in"
// box, ONE wrong password (the server's words; the lab's lockout counts per address and a right sign-in follows at
// once), signing in as the admin and as a viewer, signing out, the username remembered (and not, when Settings →
// Remember username is off), the phone and the light look.

const signInBtn = (t) => t.page.evaluate(() => [...document.querySelectorAll('form button[type="submit"]')].find((b) => /Sign in/.test(b.textContent))?.disabled)

async function signOut(t, user) {
  await t.click(`Account: ${user}`, { within: 'header' })
  await t.click('Sign out', { ms: 5000 })
  // a confirmation, when there is one
  const c = await t.confirmInfo()
  if (c) await t.click(c.buttons.find((b) => /sign out/i.test(b)) || c.buttons[c.buttons.length - 1], { within: '[role="alertdialog"]' })
  return t.until(() => !!document.querySelector('#signin-username'), null, 20000)
}

export default async function login(k) {
  const { check } = k
  const t = await k.open(null, { signIn: false })
  check('the sign-in page opens', !!(await t.until(() => !!document.querySelector('#signin-username'), null, 30000)))
  check('the username field has the focus', await t.page.evaluate(() => document.activeElement?.id === 'signin-username'))
  check('Sign in is off with both fields empty', await signInBtn(t) === true)
  await t.type('#signin-username', k.ADMIN.user)
  check('…and with only the username', await signInBtn(t) === true)
  await t.type('#signin-username', '   ')
  await t.type('#signin-password', 'something')
  check('…and with a username of spaces', await signInBtn(t) === true)
  await t.type('#signin-password', '')
  await t.type('#signin-username', k.ADMIN.user)
  await t.type('#signin-password', 'wrong-password-e2e')
  check('both filled: Sign in is on', await signInBtn(t) === false)
  check('the eye shows the password (named like every other eye: "Show the password", regression)', await t.click('Show the password') && await t.until(() => document.querySelector('#signin-password')?.type === 'text', null, 3000))
  check('…and hides it (its name follows)', await t.click('Hide the password') && await t.until(() => document.querySelector('#signin-password')?.type === 'password', null, 3000))
  const keep = await t.page.$('form button[role="checkbox"]')
  const keep0 = keep ? await keep.evaluate((b) => b.getAttribute('aria-checked')) : null
  if (keep) { await keep.click(); await keep.dispose() }
  check('the "keep me signed in" box flips', keep0 !== null && await t.until((w) => document.querySelector('form button[role="checkbox"]')?.getAttribute('aria-checked') !== w, keep0, 3000))
  await t.page.evaluate(() => document.querySelector('form button[role="checkbox"]').click())
  // one wrong password, then the right one at once (the lockout counter is per address and a success resets it)
  await t.page.focus('#signin-password')
  await t.key('Enter')
  const said = await t.waitText(/incorrect|invalid|wrong|not accepted|failed/i, { within: 'form [role="alert"]', ms: 20000 })
  check('a wrong password is refused with words, not a crash', said, await t.text('form'))
  await t.type('#signin-password', k.ADMIN.pass)
  check('typing again clears the message', await t.until(() => !document.querySelector('form [role="alert"]'), null, 3000))
  await t.key('Enter')
  check('the admin signs in (the dashboard opens)', !!(await t.until(() => !!document.querySelector('main h1'), null, 60000)) && (await t.h1()) === 'Dashboard', await t.h1())
  check('the admin sees the admin pages (Users in the Security strip)', await t.go('crowdsec') && await t.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].some((b) => /^Users/.test(b.innerText.trim()))))

  // ---- sign out: the username is remembered ---------------------------------------------
  check('Sign out returns to the sign-in page', await signOut(t, k.ADMIN.user))
  check('the username is remembered', (await t.value('#signin-username')) === k.ADMIN.user, await t.value('#signin-username'))
  check('the password is not', (await t.value('#signin-password')) === '')

  // ---- the viewer ------------------------------------------------------------------------------
  await t.type('#signin-username', k.VIEWER.user)
  await t.type('#signin-password', k.VIEWER.pass)
  await t.key('Enter')
  check('a viewer signs in', !!(await t.until(() => !!document.querySelector('main h1'), null, 60000)))
  check('a viewer\'s Security strip has no Users or Secrets', await t.go('crowdsec') && await t.page.evaluate(() => ![...document.querySelectorAll('nav[aria-label$=" pages"] button')].some((b) => /^(Users|Secrets)/.test(b.innerText.trim()))))
  // Remember username off: the next sign-in page starts empty (regression: the server's remembered name filled it anyway)
  await t.go('settings')
  const sw = await t.page.$('[id="settings-card-lock-&-session-body"] input[aria-label="Remember username"]')
  const was = sw ? await sw.evaluate((e) => e.checked) : null
  if (sw && was) await sw.evaluate((e) => e.click())
  await sw?.dispose()
  check('Settings → Remember username can be switched off', was !== null && await t.until(() => JSON.parse(localStorage.getItem('app-settings') || '{}').rememberUsername === false, null, 4000))
  await signOut(t, k.VIEWER.user)
  check('with Remember username off, the sign-in page starts empty (regression)', (await t.value('#signin-username')) === '', await t.value('#signin-username'))
  await t.type('#signin-username', k.VIEWER.user); await t.type('#signin-password', k.VIEWER.pass); await t.key('Enter')
  await t.until(() => !!document.querySelector('main h1'), null, 60000)
  await t.go('settings')
  await t.page.evaluate(() => document.querySelector('[id="settings-card-lock-&-session-body"] input[aria-label="Remember username"]')?.click())
  check('…and back on', await t.until(() => JSON.parse(localStorage.getItem('app-settings') || '{}').rememberUsername === true, null, 4000))
  t.who = k.VIEWER // the runner holds this tab to a viewer's rules from here (no 403)

  // ---- phone + light ----------------------------------------------------------------------------
  const p = await k.open(null, { signIn: false, width: 'phone', theme: 'light' })
  await p.until(() => !!document.querySelector('#signin-username'), null, 30000)
  check('phone: no sideways scroll on the sign-in page', !(await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth > 1)))
  const h = await p.page.evaluate(() => ['#signin-username', '#signin-password', 'form button[type="submit"]'].map((s) => Math.round(document.querySelector(s)?.getBoundingClientRect().height || 0)))
  check('phone: fields and Sign in are ≥ 40 px', h.every((x) => x >= 40), JSON.stringify(h))
  check('light: the sign-in page is light', await p.page.evaluate(() => document.documentElement.classList.contains('light')))
  await p.shot('login-phone-light')
  await p.type('#signin-username', k.ADMIN.user); await p.type('#signin-password', k.ADMIN.pass); await p.key('Enter')
  check('phone: the admin signs in', !!(await p.until(() => !!document.querySelector('main h1'), null, 60000)))
}
