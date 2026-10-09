// Environment (admin only): the root .env (table with masked values and their eye buttons, the editor, Validate with
// errors, Discard, a throwaway key saved, read back after a reload and taken out again, an unsaved edit that survives
// the minute's re-read, Refresh asking before it drops an edit), the server switch (hub / a VM, asking first with
// edits), a stack's .env (the picker, the empty file's editor, switching stacks asking first). A viewer is sent to
// the dashboard and is never offered the page. A phone and the light look.

const KEY = 'E2E_SF_PROBE'

/** set a React textarea's value the way a paste does */
const setArea = (t, value) => t.page.evaluate((v) => {
  const ta = document.querySelector('main textarea[aria-label="Contents of the .env file"]')
  Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(ta, v)
  ta.dispatchEvent(new Event('input', { bubbles: true }))
}, value)
const area = (t) => t.page.evaluate(() => document.querySelector('main textarea[aria-label="Contents of the .env file"]')?.value ?? null)
const btn = (t, name) => t.page.evaluate((n) => { const b = [...document.querySelectorAll('main button')].find((x) => x.innerText.trim() === n); return b ? { disabled: b.disabled } : null }, name)

export default async function environment(k) {
  const { check } = k
  const api = await k.apiAs(k.ADMIN)
  const stripKey = async () => {
    // take the throwaway key out of the file as it is now (never write back an older copy: others may save it too)
    const r = await api.get('/env')
    const raw = r.data?.raw ?? ''
    if (!raw.includes(KEY)) return
    await api.post('/env', { content: raw.split('\n').filter((l) => !l.startsWith(`${KEY}=`)).join('\n') })
  }
  const a = await k.open(k.ADMIN)
  try {
    check('Environment opens for an admin', await a.go('environment') && (await a.h1()) === 'Environment')
    await a.until(() => document.querySelectorAll('main tbody tr').length > 10, null, 30000)
    const foot = await a.text('main')
    check('the footer counts the variables (no NaN / undefined)', /\d+ variables · root \.env on the hub/.test(foot) && !/NaN|undefined/.test(foot), foot.slice(-300))

    // ---- the table: masked values and their eye buttons ------------------------------------------------
    const eye = await a.page.evaluate(() => document.querySelector('main button[aria-label^="Show the value of "]')?.getAttribute('aria-label'))
    check('a secret-looking value is masked with an eye button', !!eye, eye)
    if (eye) {
      const key = eye.replace('Show the value of ', '')
      await a.click(eye, { within: 'main' })
      check('the eye shows the value (and becomes "Hide")', await a.until((k) => document.querySelector(`main button[aria-label="Hide the value of ${k}"]`)?.getAttribute('aria-pressed') === 'true', key, 3000))
      await a.click(`Hide the value of ${key}`, { within: 'main' })
      check('…and hides it again', await a.until((k) => !!document.querySelector(`main button[aria-label="Show the value of ${k}"]`), key, 3000))
    }
    check('Save is disabled while nothing changed', (await btn(a, 'Save'))?.disabled === true)

    // ---- the editor, Validate, Discard -------------------------------------------------------------------
    await a.click('Editor', { within: 'main' })
    check('Editor shows the file in a text area', await a.until(() => !!document.querySelector('main textarea[aria-label="Contents of the .env file"]'), null, 5000))
    const original = await area(a)
    await setArea(a, `${original}\nthis is not a setting`)
    check('an edit marks the file unsaved', await a.waitText('Unsaved changes', { within: 'main', ms: 3000 }) && (await btn(a, 'Save'))?.disabled === false)
    check('…and shows the save bar with Discard', await a.exists('Discard'))
    let w0 = a.requests.length
    await a.click('Validate', { within: 'main', kind: 'button' })
    check('Validate finds the bad line', await a.waitText(/Invalid syntax|not KEY=value/, { within: 'main', ms: 10000 }))
    check('…through the validate route', a.requests.slice(w0).some((r) => r.method === 'POST' && r.path === '/env/validate'))
    await a.click('Discard')
    check('Discard puts the file back', await a.until((o) => document.querySelector('main textarea[aria-label="Contents of the .env file"]')?.value === o, original, 5000) && !(await a.hasText('Unsaved changes', 'main')))
    await a.click('Validate', { within: 'main', kind: 'button' })
    check('Validate on the saved file answers (valid, or its warnings)', await a.waitText(/Configuration is valid|Line \d+|warning/i, { within: 'main', ms: 10000 }) || await a.until(() => !!document.querySelector('main .animate-fade-in'), null, 3000))

    // ---- an unsaved edit survives the minute's re-read; Refresh asks first --------------------------
    await setArea(a, `${original}\n${KEY}=1`)
    w0 = a.requests.length
    let reread = false
    for (const end = Date.now() + 80000; !reread && Date.now() < end; await k.sleep(1000)) reread = a.requests.slice(w0).some((r) => r.method === 'GET' && r.path === '/env')
    await k.sleep(800)
    check('the file is read again within the minute', reread)
    check('…and the unsaved edit is still in the editor', (await area(a))?.endsWith(`${KEY}=1`), (await area(a))?.slice(-60))
    await a.click('Refresh', { within: 'main' })
    let c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await a.confirmInfo()
    check('Refresh with an unsaved edit asks first (danger)', c && c.title === 'Discard unsaved changes?' && c.danger, JSON.stringify(c))
    if (c) await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('…Cancel keeps the edit', (await area(a))?.endsWith(`${KEY}=1`))

    // ---- the server switch asks first with an edit -----------------------------------------------------
    await a.click('media-vm', { within: 'main' })
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await a.confirmInfo()
    check('switching to a VM with an unsaved edit asks first', c && c.title === 'Discard unsaved changes?' && c.danger, JSON.stringify(c))
    if (c) await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('…Cancel stays on the hub with the edit', (await area(a))?.endsWith(`${KEY}=1`) && /root \.env on the hub/.test(await a.text('main')))

    // ---- save a throwaway key, read it back, take it out again ------------------------------------------
    await a.click('Save', { within: 'main', kind: 'button' })
    check('Save writes the root .env (a toast)', await a.waitToast(/Root \.env saved on the hub/, 15000), JSON.stringify(await a.toasts()))
    check('…and the file is saved (Save disabled again)', await a.until(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Save')?.disabled === true, null, 5000))
    await a.reload()
    await a.until(() => document.querySelectorAll('main tbody tr').length > 10, null, 30000)
    check('after a reload the table shows the new key', await a.waitText(KEY, { within: 'main', ms: 10000 }))
    await a.click('Editor', { within: 'main' })
    await a.until(() => !!document.querySelector('main textarea[aria-label="Contents of the .env file"]'), null, 5000)
    const now = await area(a)
    await setArea(a, now.split('\n').filter((l) => !l.startsWith(`${KEY}=`)).join('\n'))
    await a.click('Save', { within: 'main', kind: 'button' })
    check('the key is taken out again and saved', await a.waitToast(/Root \.env saved/, 15000) && await a.until(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Save')?.disabled === true, null, 5000))
    check('…the server\'s file no longer has it', !((await api.get('/env')).data?.raw ?? '').includes(KEY))

    // ---- a VM's root .env through the hub ----------------------------------------------------------
    await a.click('media-vm', { within: 'main' })
    check('the media-vm chip reads that VM\'s root .env', await a.waitText(/root \.env on VM media-vm/, { within: 'main', ms: 20000 }))
    await a.click('Table', { within: 'main' })
    check('…in the table', await a.until(() => document.querySelectorAll('main tbody tr').length > 0, null, 15000))
    await a.click('Hub', { within: 'main' })
    check('the Hub chip goes back to the hub\'s file', await a.waitText(/root \.env on the hub/, { within: 'main', ms: 20000 }))

    // ---- a stack's .env ------------------------------------------------------------------------------
    await a.click('Stack .env', { within: 'main' })
    check('Stack .env asks which stack', await a.waitText('Select a stack from the list', { within: 'main', ms: 8000 }))
    const opts = await a.until(() => { const o = [...document.querySelectorAll('main select[aria-label="Stack"] option')].map((o) => o.value).filter(Boolean); return o.length ? o : false }, null, 15000) || []
    check('the picker lists the hub\'s stacks', opts.includes('monitoring-management') && opts.includes('media-services'), JSON.stringify(opts))
    await a.page.select('main select[aria-label="Stack"]', 'media-services')
    check('a stack without a .env says so and offers the editor', await a.waitText('No .env file', { within: 'main', ms: 10000 }) && await a.exists('Open the editor', { within: 'main' }))
    await a.click('Open the editor', { within: 'main' })
    check('"Open the editor" shows an empty editor', (await area(a)) === '')
    await setArea(a, 'E2E_UNSAVED=1')
    await a.page.select('main select[aria-label="Stack"]', 'monitoring-management')
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await a.confirmInfo()
    check('opening another stack with an unsaved edit asks first', c && c.title === 'Discard unsaved changes?' && c.danger, JSON.stringify(c))
    if (c) await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('…Cancel stays on that stack with the edit', (await a.page.$eval('main select[aria-label="Stack"]', (s) => s.value)) === 'media-services' && (await area(a)) === 'E2E_UNSAVED=1')
    await a.click('Discard'); await k.sleep(300)
    await a.page.select('main select[aria-label="Stack"]', 'monitoring-management')
    check('without edits another stack opens straight away', await a.until(() => !document.querySelector('[role="alertdialog"]') && /monitoring-management/.test(document.querySelector('main')?.innerText || ''), null, 8000) && !(await a.confirmInfo()))
    await a.until(() => !document.querySelector('main [role="status"]') && document.querySelector('main button[aria-label="Refresh"]')?.disabled === false, null, 15000)
    w0 = a.requests.length
    await a.click('Refresh', { within: 'main' }); await k.sleep(1500)
    check('Refresh reads the stack\'s .env again', a.requests.slice(w0).some((r) => /\/stacks\/monitoring-management\/env/.test(r.path)), a.requests.slice(w0).map((r) => r.path).join())
  } finally {
    await stripKey().catch(() => {})
    await api.logout().catch(() => {})
  }

  // ---- a viewer: never offered, sent away ------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.go('stacks')
  const strip = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('a viewer\'s Stacks strip has no Environment', !strip.some((s) => s.startsWith('Environment')), JSON.stringify(strip))
  await v.page.evaluate(() => { window.location.hash = '#/environment' })
  await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('a viewer\'s link to #/environment lands on the dashboard', (await v.currentPage()) !== 'environment' && (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)
  await v.chord('Control', 'k'); await v.waitDialog('Search', 8000)
  await v.page.keyboard.type('environment')
  await k.sleep(600)
  const pal = await v.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.innerText.split('\n')[0].trim()))
  check('the palette does not offer a viewer Environment', !pal.some((p) => /^(Go to )?Environment$/.test(p)), JSON.stringify(pal.slice(0, 6)))
  await v.key('Escape')

  // ---- a phone, the light look ---------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('environment')
  await p.until(() => document.querySelectorAll('main tbody tr').length > 10, null, 30000)
  check('no sideways scroll on a phone (Environment, the table scrolls in its card)', !(await p.overflow()), await p.overflow())
  await p.click('Editor', { within: 'main' }); await k.sleep(400)
  check('no sideways scroll on a phone (the editor)', !(await p.overflow()), await p.overflow())
  await p.shot('environment-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('environment')
  await l.until(() => document.querySelectorAll('main tbody tr').length > 10, null, 30000)
  check('Environment in the light look (screenshot)', await l.page.evaluate(() => document.documentElement.classList.contains('light')), await l.shot('environment-light'))
}
