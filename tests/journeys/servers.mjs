// Two servers, two accounts: an admin on A (the hub) and a viewer on B (the member API, a server of its own here).
// The server menu adds B and signs in to it as the viewer; each server keeps its own session and role (B shows no
// admin page, A all of them, and switching back asks nothing); a session B ends mid-use asks for B's sign-in only;
// a server that does not answer has its own screen; and a 401 to a request that went out without the token (a
// session being checked again, a server being left) never ends the session that is still good.

export default async function servers(k) {
  const { check } = k
  const A = k.API, B = k.MEMBER_API, C = k.DEAD_API
  const t = await k.open(k.ADMIN)
  t.expectFailures = new RegExp(C.replace(/[.:/]/g, (c) => `\\${c}`))
  const p = t.page
  const profiles = () => p.evaluate(() => JSON.parse(localStorage.getItem('dcs-servers') || '{}'))
  const openMenu = async () => { await p.evaluate(() => document.querySelector('aside .relative > button')?.click()); await k.sleep(400) }
  const strip = (sel = 'nav[aria-label$=" pages"] button') => p.evaluate((s) => [...document.querySelectorAll(s)].map((b) => b.innerText.trim()), sel)
  const signinShown = () => t.until(() => !!document.querySelector('#signin-username') && !document.querySelector('main'), null, 30000)
  const mainShown = () => t.until(() => !!document.querySelector('main h1') && !document.querySelector('#signin-username'), null, 45000)

  // name A, so the menu reads well
  await p.evaluate(() => { const s = JSON.parse(localStorage.getItem('dcs-servers')); s.servers[0].name = 'Hub A'; localStorage.setItem('dcs-servers', JSON.stringify(s)) })
  await t.reload()

  // ---- the 401 to a request sent without the token -------------------------
  // the app's own client (the module Vite serves to the page): a request that leaves while no token is set, as one does
  // while the session is checked again; the server refuses it 401, and the session must stay
  const without = await p.evaluate(async () => {
    // the very module the app loaded (after a hot update Vite serves it as client.ts?t=…, a second instance otherwise)
    const url = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\/src\/renderer\/api\/client\.ts(\?|$)/.test(n)).pop() || '/src/renderer/api/client.ts'
    const { apiClient } = await import(url)
    let expired = 0
    const onExpired = () => { expired++ }
    window.addEventListener('api-auth-expired', onExpired)
    const tok = apiClient.getAuthToken()
    apiClient.setAuthToken(null)
    const req = apiClient.get('/stacks').then(() => 'answered', (e) => `${e?.status} withoutToken=${e?.withoutToken}`)
    apiClient.setAuthToken(tok)
    const outcome = await req
    await new Promise((r) => setTimeout(r, 1500))
    window.removeEventListener('api-auth-expired', onExpired)
    return { outcome, expired, tokenKept: apiClient.getAuthToken() === tok && !!tok }
  })
  check('a 401 to a request sent without the token is that request\'s error alone', /^401 withoutToken=true$/.test(without.outcome), JSON.stringify(without))
  check('…it does not end the session (no auth-expired, the token kept)', without.expired === 0 && without.tokenKept, JSON.stringify(without))
  await k.sleep(1500)
  check('…and the person stays signed in', !!(await p.$('main')) && !(await p.$('#signin-username')))
  // the same with the token: the server refusing the session itself still ends it (checked below with B's session ended)

  // ---- add B and sign in to it as the viewer ------------------------------
  await openMenu()
  check('the server menu offers "Add a server"', await t.click('Add a server', { within: 'aside', ms: 5000 }))
  await p.type('aside input[placeholder="Server name"]', 'Member B')
  await p.type('aside input[placeholder="http://192.168.1.100:9876"]', B)
  await t.click(/^Add & Connect/, { within: 'aside' })
  check('a new server without a session asks for its sign-in', await signinShown())
  check('…naming the server', (await t.text('[data-testid="signin-server"]')).includes('Member B'))
  await t.type('#signin-username', k.VIEWER.user); await t.type('#signin-password', k.VIEWER.pass); await t.key('Enter')
  check('signed in to B as the viewer', await mainShown())
  await t.go('crowdsec')
  const bSecurity = await strip()
  check('on B the viewer has no admin pages (Security strip without Secrets/Users/Domains)', !bSecurity.some((n) => /^(Secrets|Users|Domains)/.test(n)), JSON.stringify(bSecurity))
  check('…and no 403 so far on B', !t.forbidden.length, t.forbidden.join(', '))
  await openMenu()
  const menu = await t.text('aside')
  check('the menu says who is signed in where', /signed in as viewer · (user|viewer)/i.test(menu) && /signed in as lab · admin/i.test(menu), menu.replace(/\n/g, ' | ').slice(0, 300))

  // ---- back to A: no sign-in, the admin's pages ----------------------------
  const t0 = Date.now()
  await t.click(/^Hub A/, { within: 'aside' })
  check('switching back to A asks nothing', await mainShown() && !(await p.$('#signin-username')), `${Date.now() - t0} ms`)
  await t.go('users')
  check('on A the admin opens Users', (await t.h1()) === 'Users', await t.h1())
  const aSecurity = await strip()
  check('…and sees the admin pages in the strip', aSecurity.some((n) => n.startsWith('Users')) && aSecurity.some((n) => n.startsWith('Secrets')), JSON.stringify(aSecurity))
  await t.go('dashboard')

  // ---- B's session ends on the server while the person is on B -------------
  await openMenu(); await t.click(/^Member B/, { within: 'aside' })
  await mainShown()
  const bTok = (await profiles()).servers?.find((s) => s.url === B)?.session?.token
  check('B keeps a session of its own', !!bTok)
  await fetch(`${B}/auth/logout`, { method: 'POST', headers: { Authorization: `Bearer ${bTok}` } })
  await t.go('containers').catch(() => {})
  check('a session B ended mid-use: B\'s sign-in, pre-filled', await signinShown() && (await t.value('#signin-username')) === k.VIEWER.user, await t.value('#signin-username'))
  const after = await profiles()
  check('…A\'s session is untouched', !!after.servers.find((s) => s.url === A)?.session?.token)
  await t.type('#signin-password', k.VIEWER.pass); await t.key('Enter')
  check('signing in again returns to B', await mainShown())

  // ---- a server that does not answer --------------------------------------
  await openMenu()
  await t.click('Add a server', { within: 'aside', ms: 5000 })
  await p.type('aside input[placeholder="Server name"]', 'Dead C')
  await p.type('aside input[placeholder="http://192.168.1.100:9876"]', C)
  await t.click(/^Add & Connect/, { within: 'aside' })
  const unreachable = await t.waitText(/can.t be reached/i, { ms: 45000 })
  check('a server that does not answer shows its own screen', !!unreachable && !(await p.$('main')))
  await t.shot('servers-unreachable')
  check('…with Try again', await t.exists('Try again'))
  // leave it for A from that screen
  const back = await t.click(/Hub A|another server|Switch server/i, { ms: 8000 })
  if (back) check('…and a way to another server', await mainShown())
  else {
    check('…and a way to another server', false, await t.text())
    await p.evaluate((a) => { const s = JSON.parse(localStorage.getItem('dcs-servers')); s.activeId = s.servers.find((x) => x.url === a)?.id; localStorage.setItem('dcs-servers', JSON.stringify(s)) }, A)
    await t.reload()
  }

  // ---- no address carried a session, no request to B carried A's token ----
  const aTok = (await profiles()).servers?.find((s) => s.url === A)?.session?.token
  const leaked = t.requests.filter((r) => r.origin === B && aTok && (r.search || '').includes(aTok))
  check('no request to B carried A\'s token in its address', !leaked.length)

  // clean up: forget B and C from this device
  await p.evaluate((list) => { const s = JSON.parse(localStorage.getItem('dcs-servers')); s.servers = s.servers.filter((x) => !list.includes(x.url)); localStorage.setItem('dcs-servers', JSON.stringify(s)) }, [B, C])
}
