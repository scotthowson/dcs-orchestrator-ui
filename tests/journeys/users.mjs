// Users (admin only): the accounts list (your own row guarded), Create user (validation, a throwaway account), its role
// (changed and read back), a session of it (revoked — asked first), Sign out everywhere, invite codes (generate, copy,
// revoke), Revoke access (the throwaway account is removed), the Authelia second-step choice (picked, never applied),
// Refresh. The accounts lab, viewer and austin are never touched.

const MAIN = 'main'
const PASS = 'E2e-Throwaway-Pass-1'

async function grantClipboard(k, t) { await t.ctx.overridePermissions(k.UI, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {}) }
const waitConfirm = (t) => t.until(() => !!document.querySelector('[role="alertdialog"]'), null, 6000)

export default async function users(k) {
  const { check } = k
  const stamp = Date.now().toString(36)
  const NAME = `e2e-u-${stamp}`
  const api = await k.apiAs(k.ADMIN)
  const invites0 = new Set(((await api.get('/auth/invites')).data?.invites || []).map((i) => i.code))
  const roleOf = async (u) => ((await api.get('/auth/users')).data?.users || []).find((x) => x.username === u)?.role

  const a = await k.open(k.ADMIN)
  await grantClipboard(k, a)
  try {
    // a session ended by someone else lands on the sign-in page: nothing below may type into it
    if (!check('admin: the page opens', await a.go('users') && (await a.h1()) === 'Users', await a.h1())) return
    check('admin: the accounts are listed (lab, austin, viewer)', await a.until(() => ['lab', 'austin', 'viewer'].every((u) => [...document.querySelectorAll('main li')].some((li) => li.innerText.split('\n').some((l) => l.trim() === u))), null, 20000))
    check('admin: your own account cannot be revoked, nor its role changed', await a.page.evaluate(() => {
      const b = document.querySelector('main button[aria-label="Revoke (not available for your own account)"]')
      return !!b && b.disabled && !document.querySelector('main select[aria-label="Role of lab"]')
    }))
    check('admin: the tiles count the users and admins', await a.until(() => /REGISTERED USERS\s*\d+/i.test(document.querySelector('main').innerText) && /ADMIN USERS\s*\d+/i.test(document.querySelector('main').innerText), null, 5000))

    // ---- Create user: validation, then a throwaway account ----------------
    check('admin: Create waits for a username and a password', await a.page.evaluate(() => [...document.querySelectorAll('main form button[type="submit"]')].find((b) => b.innerText.trim() === 'Create')?.disabled))
    await a.type('Username', 'ab', 'main'); await a.type('Password', 'long-enough-1', 'main')
    await a.click('Create', { within: MAIN })
    check('admin: a too-short username is refused with the rule', await a.waitToast(/Username: 3–32 letters/, 6000))
    await a.type('Username', NAME, 'main'); await a.type('Password', 'short', 'main')
    await a.click('Create', { within: MAIN })
    check('admin: a short password is refused with the rule', await a.waitToast(/Password: at least 8 characters/, 6000))
    await a.type('Password', PASS, 'main')
    await a.page.select('#new-user-role', 'user')
    await a.click('Create', { within: MAIN })
    check('admin: Create makes the account', await a.waitToast(new RegExp(NAME), 15000) && await a.until((n) => !!document.querySelector(`main select[aria-label="Role of ${n}"]`), NAME, 10000))
    check('admin: …the form is emptied', (await a.value('Username', 'main')) === '' && (await a.value('Password', 'main')) === '')
    check('admin: the server has it, as a user', (await roleOf(NAME)) === 'user')

    // ---- its role -----------------------------------------------------------
    await a.page.select(`main select[aria-label="Role of ${NAME}"]`, 'bot')
    check('admin: changing the role says so', await a.waitToast(/bot/i, 10000))
    check('admin: …and the server reads it back (bot)', await (async () => { for (let i = 0; i < 20; i++) { if ((await roleOf(NAME)) === 'bot') return true; await k.sleep(300) } return false })())
    await a.reload()
    check('admin: after a reload the list shows bot', await a.until((n) => document.querySelector(`main select[aria-label="Role of ${n}"]`)?.value === 'bot', NAME, 15000))
    await a.page.select(`main select[aria-label="Role of ${NAME}"]`, 'user')
    await a.waitToast(/user/i, 10000)
    check('admin: and back to user', await (async () => { for (let i = 0; i < 20; i++) { if ((await roleOf(NAME)) === 'user') return true; await k.sleep(300) } return false })())

    // ---- one of its sessions: revoked, asked first (regression) -------------
    const t1 = await k.apiAs({ user: NAME, pass: PASS })
    check('setup: the throwaway account can sign in', !!t1.token)
    await a.click('Refresh', { within: MAIN })
    const sessBtn = () => a.page.evaluate((n) => [...document.querySelectorAll('main button')].map((b) => b.getAttribute('aria-label') || '').find((l) => l.startsWith('Revoke the session ') && l.endsWith(` of ${n}`)) || null, NAME)
    const sb = await a.until((n) => [...document.querySelectorAll('main button')].some((b) => (b.getAttribute('aria-label') || '').endsWith(` of ${n}`) && (b.getAttribute('aria-label') || '').startsWith('Revoke the session ')), NAME, 15000) && await sessBtn()
    check('admin: its session is listed', !!sb, String(sb))
    if (sb) {
      await a.click(sb, { within: MAIN })
      const c = await waitConfirm(a) && await a.confirmInfo()
      check('admin: Revoke on a session asks first (a question, rose, Cancel focused)', c && c.title === 'Revoke this session?' && c.danger && c.focused === 'Cancel' && c.buttons.includes('Revoke session'), JSON.stringify(c))
      await a.click('Cancel', { within: '[role="alertdialog"]' })
      check('admin: Cancel keeps the session', (await t1.get('/system')).status !== 401 && !!(await sessBtn()))
      await a.click(sb, { within: MAIN }); await waitConfirm(a)
      await a.click('Revoke session', { within: '[role="alertdialog"]' })
      check('admin: Revoke session ends it', await a.waitToast(/Session revoked/, 10000) && (await t1.get('/system')).status === 401)
    }

    // ---- Sign out everywhere ----------------------------------------------
    const t2 = await k.apiAs({ user: NAME, pass: PASS })
    await a.click(`Sign out ${NAME} everywhere`, { within: MAIN })
    const c2 = await waitConfirm(a) && await a.confirmInfo()
    check('admin: Sign out everywhere asks first', c2 && c2.title === 'Sign out everywhere?' && c2.danger, JSON.stringify(c2))
    await a.click('Sign out everywhere', { within: '[role="alertdialog"]' })
    check('admin: …and signs every session of it out', await a.waitToast(`${NAME} is signed out everywhere`, 10000) && (await t2.get('/system')).status === 401)

    // ---- invite codes ------------------------------------------------------
    await a.page.select('#invite-role', 'user')
    await a.click('Generate', { within: MAIN })
    check('admin: Generate makes an invite', await a.waitToast('Invite code created (user)', 10000))
    let code = null
    for (let i = 0; i < 20 && !code; i++) { code = ((await api.get('/auth/invites')).data?.invites || []).map((x) => x.code).find((c) => !invites0.has(c)) || null; if (!code) await k.sleep(300) }
    check('admin: the new code is listed under Active', !!code && await a.waitText(code, { within: MAIN, ms: 10000 }), String(code))
    if (code) {
      await a.click(`Copy the invite code ${code}`, { within: MAIN })
      check('admin: Copy puts the code on the clipboard and says so', await a.waitToast('Invite code copied', 6000) && await a.until((c) => navigator.clipboard.readText().then((t) => t === c).catch(() => false), code, 4000))
      await a.click(`Revoke the invite code ${code}`, { within: MAIN })
      const c3 = await waitConfirm(a) && await a.confirmInfo()
      check('admin: Revoke on an invite asks first', c3 && c3.title === 'Revoke this invite?' && c3.danger && c3.buttons.includes('Revoke invite'), JSON.stringify(c3))
      await a.click('Revoke invite', { within: '[role="alertdialog"]' })
      check('admin: …and the code is gone', await a.waitToast('Invite revoked', 10000) && !((await api.get('/auth/invites')).data?.invites || []).some((x) => x.code === code))
    }

    // ---- Revoke access: the throwaway account goes -------------------------
    await a.click(`Revoke access for ${NAME}`, { within: MAIN })
    const c4 = await waitConfirm(a) && await a.confirmInfo()
    check('admin: Revoke access asks first (rose, Cancel focused)', c4 && c4.title === 'Revoke access?' && c4.danger && c4.focused === 'Cancel', JSON.stringify(c4))
    await a.click('Revoke access', { within: '[role="alertdialog"]' })
    check('admin: Revoke access removes the account', await a.waitToast(`User "${NAME}" has been revoked.`, 10000) && await a.until((n) => !document.querySelector(`main select[aria-label="Role of ${n}"]`), NAME, 10000))
    check('admin: the server no longer lists it', !(await roleOf(NAME)))

    // ---- Authelia's second step: chosen, never applied ----------------------
    const radios = await a.page.evaluate(() => [...document.querySelectorAll('main [role="radiogroup"] [role="radio"]')].map((r) => ({ n: r.innerText.trim(), on: r.getAttribute('aria-checked') === 'true' })))
    if (radios.length === 3) {
      const cur = radios.find((r) => r.on)?.n
      const other = radios.find((r) => !r.on && r.n !== 'Chosen apps')?.n || radios.find((r) => !r.on).n
      await a.click(other, { within: 'main [role="radiogroup"]', dom: true })
      check('admin: a second-step choice can be picked', await a.until((o) => [...document.querySelectorAll('main [role="radiogroup"] [role="radio"]')].some((r) => r.innerText.trim() === o && r.getAttribute('aria-checked') === 'true'), other, 3000))
      const applyOn = await a.page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Apply')?.disabled === false)
      check('admin: …which arms Apply (not pressed)', applyOn || await a.hasText('Install an authenticator app', MAIN))
      await a.click('Chosen apps', { within: 'main [role="radiogroup"]', dom: true })
      check('admin: Chosen apps lists the apps behind Authelia', await a.waitText(/Add to the list/, { within: 'main section[aria-labelledby="app-sign-in-title"]', ms: 4000 }))
      if (cur) await a.click(cur, { within: 'main [role="radiogroup"]', dom: true })
      check('admin: back to the setting in force, Apply is idle again', await a.until(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Apply')?.disabled !== false, null, 3000))
    } else k.j.note(`users: the Authelia card shows no choice here (${JSON.stringify(radios)})`)

    const n0 = a.requests.length
    await a.click('Refresh', { within: MAIN })
    check('admin: Refresh reads the users again', await (async () => { for (let i = 0; i < 30; i++) { if (a.requests.slice(n0).some((r) => r.path === '/auth/users')) return true; await k.sleep(200) } return false })())
    await a.shot('users-admin')
  } finally {
    if (await roleOf(NAME)) await api.post('/auth/revoke', { username: NAME })
    for (const inv of ((await api.get('/auth/invites')).data?.invites || []).filter((x) => !invites0.has(x.code) && !x.used)) await api.del(`/auth/invite/${encodeURIComponent(inv.code)}`)
  }

  // ---- a viewer: the page is an admin's -----------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/users' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('viewer: a link to #/users lands on the dashboard', (await v.currentPage()) !== 'users' && (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)

  // ---- phone and light ---------------------------------------------------
  const NAME2 = `e2e-p-${stamp}`
  await api.post('/auth/users', { username: NAME2, password: PASS, role: 'user' })
  const p = await k.open(k.ADMIN, { width: 'phone' })
  try {
    await p.go('users'); await p.waitText(NAME2, { within: MAIN, ms: 20000 })
    check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
    await p.click(`Revoke access for ${NAME2}`, { within: MAIN })
    if (await waitConfirm(p)) {
      const hs = await p.page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].map((b) => Math.round(b.getBoundingClientRect().height)))
      check('phone: a confirmation\'s buttons are thumb-sized (≥ 40 px)', hs.length >= 2 && hs.every((h) => h >= 40), JSON.stringify(hs))
      await p.shot('users-phone-confirm')
      await p.click('Revoke access', { within: '[role="alertdialog"]' })
      check('phone: Revoke access works from the phone', await p.waitToast(`User "${NAME2}" has been revoked.`, 10000))
    } else check('phone: Revoke access asks first', false)
  } finally {
    if (await roleOf(NAME2)) await api.post('/auth/revoke', { username: NAME2 })
  }
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('users'); await l.waitText('austin', { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('users-light')
}
