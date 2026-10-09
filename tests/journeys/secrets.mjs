// Secrets (admin only): the guide, the search and its empty state, the scope chips, the Add secret dialog (validation,
// the name rule, Generate, show / hide the value, Escape, Save, the replace warning), a card's three buttons (copy the
// placeholder, where it is used, delete — asked first), deleting from the Everywhere view (the row's own server), the
// API keys card (make a throwaway key, copy it, remove it) and the dashboard feed (switched on and off again only when it
// was off). Everything made here has a unique name and is gone at the end.

const MAIN = 'main'
const SCOPE = 'main [role="group"][aria-label="Show"]'

async function grantClipboard(k, t) { await t.ctx.overridePermissions(k.UI, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {}) }
const clip = (t) => t.page.evaluate(() => navigator.clipboard.readText().catch(() => ''))

export default async function secrets(k) {
  const { check } = k
  const stamp = Date.now().toString(36).toUpperCase()
  const NAME = `E2E_SECRET_${stamp}`
  const NAME2 = `E2E_FLEETVIEW_${stamp}`
  const KEYNAME = `e2e-key-${stamp.toLowerCase()}`
  const api = await k.apiAs(k.ADMIN)
  const feed0 = await api.get('/feed/status')

  const a = await k.open(k.ADMIN)
  await grantClipboard(k, a)
  try {
    check('admin: the page opens', await a.go('secrets') && (await a.h1()) === 'Secrets', await a.h1())
    check('admin: the subtitle counts the encrypted values', await a.waitText(/\d+ encrypted values? · injected into stacks at start/, { within: MAIN, ms: 20000 }))

    // ---- the guide ---------------------------------------------------------
    await a.click('Guide', { within: MAIN })
    check('admin: Guide opens the guide', await a.waitText('Secrets guide', { within: MAIN, ms: 5000 }) && (await a.page.evaluate(() => document.querySelector('main button[aria-label="Guide"]')?.getAttribute('aria-expanded'))) === 'true')
    await a.click('How it works', { within: 'main section[aria-label="Secrets guide"]' })
    check('admin: a guide section unfolds', await a.waitText('AES-256-CBC', { within: MAIN, ms: 4000 }))
    await a.click('Close the guide', { within: MAIN })
    check('admin: the guide\'s ✕ closes it', await a.until(() => !document.querySelector('main section[aria-label="Secrets guide"]'), null, 4000))

    // ---- search ------------------------------------------------------------
    await a.type('Search the secrets', 'zz-nothing-like-this')
    check('admin: a search with no match says so', await a.waitText('No secrets match your search', { within: MAIN, ms: 5000 }))
    await a.type('Search the secrets', '')

    // ---- Everywhere is a view: Add asks for a server before anything is typed (regression) ----
    const hasScope = !!(await a.until((s) => !!document.querySelector(`${s} button`), SCOPE, 10000))
    if (hasScope) {
      await a.click('Everywhere', { within: SCOPE })
      await a.click('Add secret', { within: MAIN })
      check('admin: in Everywhere, Add secret says to pick a server first (no form to lose)', await a.waitToast(/pick the hub or one VM/, 8000) && !(await a.dialogs()).length, JSON.stringify(await a.dialogs()))
      await a.click('Hub', { within: SCOPE })
      check('admin: the Hub chip is chosen', await a.until((s) => document.querySelector(`${s} button[aria-pressed="true"]`)?.innerText.trim() === 'Hub', SCOPE, 5000))
    }

    // ---- the Add secret dialog -----------------------------------------------
    await a.click('Add secret', { within: MAIN })
    check('admin: Add secret opens its dialog', await a.waitDialog('Add secret', 8000))
    check('admin: Save waits for a name and a value', await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[type="submit"]')].every((b) => b.disabled)))
    await a.type('#secret-name', '1bad')
    check('admin: a name that starts with a digit is flagged', await a.waitText('Letters, digits and underscores only, starting with a letter', { within: '[role="dialog"]', ms: 3000 }))
    await a.type('#secret-name', 'e2e-with dash')
    check('admin: spaces and dashes become underscores', (await a.value('#secret-name')) === 'e2e_with_dash', await a.value('#secret-name'))
    await a.click(/^Generate \d+-character value$/, { within: '[role="dialog"]' })
    const gen = await a.value('#secret-value')
    check('admin: Generate fills a 32-character value', /^[A-Za-z0-9]{32}$/.test(gen || ''), gen?.length)
    check('admin: …and shows it', (await a.page.evaluate(() => document.querySelector('[role="dialog"] button[aria-label="Hide the value"]')?.getAttribute('aria-pressed'))) === 'true')
    await a.click('Hide the value', { within: '[role="dialog"]' })
    check('admin: the eye hides the value again', await a.until(() => document.querySelector('[role="dialog"] button[aria-label="Show the value"]')?.getAttribute('aria-pressed') === 'false', null, 3000))
    await a.key('Escape')
    check('admin: Escape closes the dialog', await a.waitNoDialog(5000))
    await a.click('Add secret', { within: MAIN }); await a.waitDialog('Add secret', 8000)
    check('admin: reopened, the form is empty', (await a.value('#secret-name')) === '' && (await a.value('#secret-value')) === '')
    await a.type('#secret-name', NAME)
    check('admin: the reference to use is shown while typing', await a.waitText(`Reference: \${SECRETS_${NAME}}`, { within: '[role="dialog"]', ms: 3000 }))
    await a.type('#secret-value', 'e2e-throwaway-value')
    await a.click('Save', { within: '[role="dialog"]' })
    check('admin: Save stores it and says how to reference it', await a.waitToast(new RegExp(`Stored ${NAME}`), 15000))
    check('admin: …the dialog closes and the card appears', await a.waitNoDialog(8000) && await a.waitText(NAME, { within: MAIN, ms: 10000 }))
    const listed = await api.get('/secrets')
    check('admin: the server has it (read back)', JSON.stringify(listed.data).includes(NAME))

    // same name again: the replace warning
    await a.click('Add secret', { within: MAIN }); await a.waitDialog('Add secret', 8000)
    await a.type('#secret-name', NAME)
    check('admin: an existing name says saving replaces it', await a.waitText('A secret with this name exists', { within: '[role="dialog"]', ms: 3000 }))
    await a.type('#secret-value', 'x')
    await a.click('Save', { within: '[role="dialog"]' })
    check('admin: Save first asks to replace (rose Replace)', await a.waitText(/Replace the existing value of/, { within: '[role="dialog"]', ms: 3000 }) && await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[type="submit"]')].some((b) => b.innerText.trim() === 'Replace' && /rose/.test(b.className))))
    await a.click('Cancel', { within: '[role="dialog"]' })
    check('admin: Cancel leaves it as it was', await a.waitNoDialog(5000))

    // ---- the card's buttons --------------------------------------------------
    await a.type('Search the secrets', NAME)
    await a.click(`Copy the placeholder of ${NAME}`, { within: MAIN })
    check('admin: Copy puts the placeholder on the clipboard', await a.until((n) => navigator.clipboard.readText().then((t) => t === `\${SECRETS_${n}}`).catch(() => false), NAME, 5000), await clip(a))
    await a.click(`Show where ${NAME} is used`, { within: MAIN })
    check('admin: "where is it used" answers (not referenced yet)', await a.waitText('Not referenced yet', { within: MAIN, ms: 8000 }))
    await a.click(`Hide where ${NAME} is used`, { within: MAIN })
    check('admin: …and folds again', await a.until(() => !/Not referenced yet/.test(document.querySelector('main').innerText), null, 4000))
    await a.click(`Delete ${NAME}`, { within: MAIN })
    const c1 = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('admin: Delete asks first: a question, rose, Cancel focused, "Delete secret"', c1 && c1.title === 'Delete this secret?' && c1.danger && c1.focused === 'Cancel' && c1.buttons.includes('Delete secret'), JSON.stringify(c1))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('admin: Cancel keeps the secret', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && await a.hasText(NAME, MAIN))
    await a.click(`Delete ${NAME}`, { within: MAIN })
    await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000)
    await a.click('Delete secret', { within: '[role="alertdialog"]' })
    check('admin: Delete secret removes it', await a.waitToast(`Deleted ${NAME}`, 15000) && await a.until((n) => !document.querySelector('main').innerText.includes(n), NAME, 8000))
    check('admin: the server no longer has it', !JSON.stringify((await api.get('/secrets')).data).includes(NAME))
    await a.type('Search the secrets', '')

    // ---- deleting from Everywhere works on the row's own server (regression) ----
    if (hasScope) {
      await api.post(`/secrets/${NAME2}`, { value: 'e2e-throwaway' })
      await a.click('Everywhere', { within: SCOPE })
      await a.type('Search the secrets', NAME2)
      check('admin: Everywhere lists the hub\'s new secret', await a.waitText(NAME2, { within: MAIN, ms: 15000 }))
      await a.click(`Delete ${NAME2}`, { within: MAIN })
      await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000)
      await a.click('Delete secret', { within: '[role="alertdialog"]' })
      check('admin: in Everywhere, Delete removes it from its own server', await a.waitToast(`Deleted ${NAME2}`, 15000) && !JSON.stringify((await api.get('/secrets')).data).includes(NAME2))
      await a.type('Search the secrets', '')
      await a.click('Hub', { within: SCOPE })
    }

    // ---- API keys ------------------------------------------------------------
    check('admin: "Make a key" waits for a name', await a.page.evaluate(() => [...document.querySelectorAll('main section[aria-label="API keys"] button[type="submit"]')].every((b) => b.disabled)))
    await a.type('Homarr', KEYNAME, 'main')
    await a.click('Make a key', { within: 'main section[aria-label="API keys"]', dom: true })
    check('admin: Make a key shows the key once', await a.waitText(`The key for "${KEYNAME}" is shown once`, { within: MAIN, ms: 15000 }))
    check('admin: …and lists it', await a.until((n) => [...document.querySelectorAll('main section[aria-label="API keys"] li')].some((li) => li.innerText.includes(n)), KEYNAME, 8000))
    await a.click('Copy the key', { within: MAIN, dom: true })
    check('admin: Copy the key copies it', await a.until(() => navigator.clipboard.readText().then((t) => t.length > 20).catch(() => false), null, 5000))
    await a.click(`Remove the key ${KEYNAME}`, { within: MAIN, dom: true })
    const c2 = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('admin: Remove asks first (a question, rose)', c2 && /\?$/.test(c2.title) && c2.danger, JSON.stringify(c2))
    await a.click('Remove', { within: '[role="alertdialog"]' })
    check('admin: Remove takes the key off', await a.until((n) => ![...document.querySelectorAll('main section[aria-label="API keys"] li')].some((li) => li.innerText.includes(n)), KEYNAME, 10000))

    // ---- the dashboard feed (only when it was off: never replaces a token in use) ----
    if (feed0.data && feed0.data.enabled === false) {
      await a.click('Switch on', { within: 'main section[aria-label="Dashboard feed"]' })
      check('admin: Switch on makes the feed token, shown once', await a.waitText('This token is shown once', { within: MAIN, ms: 15000 }))
      await a.click('Copy the token', { within: 'main section[aria-label="Dashboard feed"]' })
      check('admin: the token copies (the icon turns to Copied)', await a.until(() => !!document.querySelector('main section[aria-label="Dashboard feed"] button[aria-label="Copied"]'), null, 4000))
      check('admin: the feed lists its two addresses with copy buttons', await a.until(() => !!document.querySelector('main button[aria-label="Copy the server"]') && !!document.querySelector('main button[aria-label="Copy the crowdsec"]'), null, 8000))
      await a.click('Switch off', { within: 'main section[aria-label="Dashboard feed"]' })
      const c3 = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
      check('admin: Switch off asks first', c3 && c3.title === 'Switch the dashboard feed off?' && c3.danger, JSON.stringify(c3))
      await a.click('Switch off', { within: '[role="alertdialog"]' })
      check('admin: …and the feed is off again', await a.until(() => /Dashboard feed\s*off/.test(document.querySelector('main section[aria-label="Dashboard feed"]')?.innerText || ''), null, 10000) && (await api.get('/feed/status')).data?.enabled === false)
    } else k.j.note('secrets: the dashboard feed was on: not touched')

    const n0 = a.requests.length
    await a.click('Refresh', { within: MAIN })
    check('admin: Refresh reads the secrets again', await a.until(() => true, null, 50) && await (async () => { for (let i = 0; i < 30; i++) { if (a.requests.slice(n0).some((r) => r.path === '/secrets')) return true; await k.sleep(200) } return false })())
    await a.shot('secrets-admin')
  } finally {
    // whatever happened above: nothing of this run stays
    await api.del(`/secrets/${NAME}`).catch(() => {})
    await api.del(`/secrets/${NAME2}`).catch(() => {})
    const keys = (await api.get('/auth/keys')).data?.keys || []
    for (const key of keys.filter((x) => x.name === KEYNAME)) await api.del(`/auth/keys/${encodeURIComponent(key.id)}`)
    if (feed0.data && feed0.data.enabled === false && (await api.get('/feed/status')).data?.enabled) await api.del('/feed/token')
  }

  // ---- a viewer: the page is an admin's -----------------------------------
  const v = await k.open(k.VIEWER)
  await v.page.evaluate(() => { window.location.hash = '#/secrets' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('viewer: a link to #/secrets lands on the dashboard', (await v.currentPage()) !== 'secrets' && (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('secrets'); await p.waitText(/encrypted value/, { within: MAIN, ms: 20000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  // the chips come with the fleet's list: wait for them before choosing the hub (Everywhere would refuse the add)
  if (await p.until((s) => !!document.querySelector(`${s} button`), SCOPE, 10000)) await p.click('Hub', { within: SCOPE })
  await p.click('Add secret', { within: MAIN })
  if (await p.waitDialog('Add secret', 8000)) {
    const hs = await p.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] form > div:last-child button')].map((b) => Math.round(b.getBoundingClientRect().height)))
    check('phone: the dialog\'s Cancel and Save are thumb-sized (≥ 40 px)', hs.length === 2 && hs.every((h) => h >= 40), JSON.stringify(hs))
    await p.shot('secrets-phone-add')
    await p.key('Escape')
  } else check('phone: Add secret opens', false)
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('secrets'); await l.waitText(/encrypted value/, { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('secrets-light')
}
