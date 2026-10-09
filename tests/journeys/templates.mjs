// Templates: My templates (search, the category chips, a filter with no match, a template's deploy sheet: its form,
// the container-name validation, Preview (the dry run, a viewer's too), Deploy → the confirm step → Back, never
// deployed), Export, History, Refresh, URL import's validation, a throwaway template created, edited (read back after a
// reload), its editor's ✕ asking about unsaved changes, and deleted again; the Gallery (search, categories, its empty
// state). A viewer (View + Preview, nothing an admin's), a phone and the light look.

const dlg = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
  return d.length ? d[d.length - 1].innerText : ''
})
const dlgButton = (t, name) => t.page.evaluate((name) => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && !e.closest('[inert]'))
  const b = d.length ? [...d[d.length - 1].querySelectorAll('button')].find((x) => x.innerText.trim() === name) : null
  return b ? { disabled: b.disabled, title: b.title || '' } : null
}, name)

const COMPOSE = 'services:\n  hello:\n    image: traefik/whoami:latest\n    container_name: e2e-hello\n'

export default async function templates(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  const writes = (t, from) => t.requests.slice(from).filter((r) => r.method !== 'GET' && !/^\/(auth|settings\/profile|chat)/.test(r.path)).map((r) => `${r.method} ${r.path}`)
  const cardTitles = (t) => t.page.evaluate(() => [...document.querySelectorAll('main [aria-label^="Export "]')].map((b) => b.getAttribute('aria-label').slice(7)))
  const api = await k.apiAs(k.ADMIN)
  const tpl = `e2e-sf-${Date.now().toString(36)}`
  const title = `E2E SF ${tpl.slice(7)}`

  try {
    check('Templates opens', await a.go('templates') && (await a.h1()) === 'Templates')
    await a.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 30000)
    const sub = await a.text('main')
    check('the header counts the templates (no NaN / undefined)', /\d+ templates? available/.test(sub) && !/NaN|undefined/.test(sub.slice(0, 400)), sub.slice(0, 200))
    check('the search field has one ✕ at most (none while empty)', (await a.page.$$('main [aria-label="Clear the search"]')).length === 0)

    // ---- search and categories ---------------------------------------------------------------------------
    await a.type('Search the templates', 'redis')
    check('search narrows the cards', await a.until(() => { const n = document.querySelectorAll('main [aria-label^="Export "]').length; return n > 0 && n < 10 }, null, 5000), JSON.stringify(await cardTitles(a)))
    check('the search field shows a single ✕ once something is typed', (await a.page.$$('main [aria-label="Clear the search"]')).length === 1, String((await a.page.$$('main [aria-label="Clear the search"]')).length))
    check('…the ✕ empties it', await a.click('Clear the search', { within: 'main' }) && (await a.value('Search the templates')) === '')
    await a.type('Search the templates', 'zzz-nothing-like-this')
    check('a search with no match says so, with a hint', await a.waitText('No templates match your filter', { within: 'main', ms: 5000 }) && await a.hasText('Try another name or category.', 'main'))
    check('"Clear the filters" brings every template back', await a.click('Clear the filters', { within: 'main' }) && await a.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 50, null, 8000))
    const chips = await a.page.evaluate(() => [...document.querySelectorAll('main [role="group"][aria-label="Category"] button')].map((b) => ({ t: b.innerText.replace(/\s+/g, ' ').trim(), on: b.getAttribute('aria-pressed') })))
    check('the category chips carry their counts, "All" pressed', chips.length > 3 && chips[0].on === 'true' && chips.every((c) => /\d+$/.test(c.t)), JSON.stringify(chips.slice(0, 4)))
    const media = chips.find((c) => /^Media \d+$/.test(c.t))
    if (media) {
      await a.click(media.t, { within: 'main [role="group"][aria-label="Category"]' })
      const n = Number(media.t.split(' ')[1])
      check(`the chip "${media.t}" shows its ${n} templates`, await a.until((n) => document.querySelectorAll('main [aria-label^="Export "]').length === n, n, 5000), String((await cardTitles(a)).length))
      check('…and is pressed', await a.page.evaluate((t) => [...document.querySelectorAll('main [role="group"][aria-label="Category"] button')].find((b) => b.innerText.replace(/\s+/g, ' ').trim() === t)?.getAttribute('aria-pressed') === 'true', media.t))
      await a.click(chips[0].t, { within: 'main [role="group"][aria-label="Category"]' })
    }

    // ---- a template's deploy sheet (never deployed) ---------------------------------------------------------
    await a.type('Search the templates', 'redis')
    await a.click('Deploy Redis 7', { within: 'main' })
    check('Deploy opens the template\'s deploy sheet', await a.waitDialog(/^Deploy /, 15000), await a.dialogTitle())
    await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Container names/i.test(d.innerText)), null, 15000)
    const form = await dlg(a)
    check('the sheet shows the target stack, the variables and the container names', /Target stack/i.test(form) && /Variables/i.test(form) && /Container names/i.test(form), form.slice(0, 300))
    await a.type('Container name of redis', 'bad name!')
    check('an invalid container name is refused in place', await a.waitText('Letters, digits, dot, dash and underscore only', { within: '[role="dialog"]', ms: 3000 }))
    const blocked = await dlgButton(a, 'Deploy stack')
    check('…and Deploy is disabled with the reason', blocked?.disabled && /container names/.test(blocked.title), JSON.stringify(blocked))
    await a.type('Container name of redis', '')
    let w0 = a.requests.length
    check('Preview runs the dry run', await a.click('Preview', { within: '[role="dialog"]', kind: 'button' }) && await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /lines of compose|Preview failed/.test(d.innerText)), null, 30000))
    check('…as a POST to the dry-run route', writes(a, w0).some((x) => /\/templates\/redis\/dry-run$/.test(x)), writes(a, w0).join())
    check('…and shows its result, not an error', !/Preview failed/.test(await dlg(a)), (await dlg(a)).slice(-300))
    w0 = a.requests.length
    await a.click('Deploy stack', { within: '[role="dialog"]' })
    check('Deploy stack asks for a second step (Confirm and deploy)', !!(await dlgButton(a, 'Confirm and deploy')) && /This will modify the compose file/.test(await dlg(a)))
    await a.click('Back', { within: '[role="dialog"]' })
    check('Back returns to the form (nothing deployed)', !!(await dlgButton(a, 'Deploy stack')) && !writes(a, w0).some((x) => /deploy$/.test(x)), writes(a, w0).join())
    await a.click('Cancel', { within: '[role="dialog"]' })
    check('Cancel closes the deploy sheet', await a.waitNoDialog(5000))
    await a.click('Deploy Redis 7', { within: 'main' }); await a.waitDialog(/^Deploy /, 15000)
    await a.key('Escape')
    check('Escape closes the deploy sheet', await a.waitNoDialog(5000))

    // ---- export, history, refresh --------------------------------------------------------------------------
    const e0 = a.errors.length
    await a.click('Export Redis 7', { within: 'main' })
    check('Export saves the template (a toast, no error)', await a.waitToast('Template "redis" exported', 10000) && a.errors.length === e0, JSON.stringify(await a.toasts()))
    await a.type('Search the templates', '')
    await a.click('History', { within: 'main' })
    check('History opens the deploy history', await a.waitText(/deploy history/i, { within: 'main', ms: 8000 }))
    check('…and its ✕ closes it', await a.click('Close the history', { within: 'main' }) && await a.until(() => !/deploy history/i.test(document.querySelector('main')?.innerText || ''), null, 5000))
    w0 = a.requests.length
    await a.click('Refresh', { within: 'main' }); await k.sleep(1500)
    check('Refresh reads the templates again', a.requests.slice(w0).some((r) => r.path === '/templates'), a.requests.slice(w0).map((r) => r.path).join())

    // ---- URL import (validation only) ----------------------------------------------------------------------
    await a.click('URL import', { within: 'main' })
    check('URL import opens its dialog', await a.waitDialog(/Import from URL/, 8000))
    check('…Preview and Import are disabled without an address', (await dlgButton(a, 'Preview'))?.disabled && (await dlgButton(a, 'Import template'))?.disabled)
    await a.key('Escape'); await a.waitNoDialog(5000)
    check('File import is offered', await a.exists('File import', { within: 'main' }))

    // ---- a throwaway template: create, edit, read back, delete ----------------------------------------------
    await a.click('Create', { within: 'main', kind: 'button' })
    check('Create opens the template editor', await a.waitDialog('Create template', 8000))
    check('Create template is disabled while the form is empty', (await dlgButton(a, 'Create template'))?.disabled === true)
    await a.type('Template name *', 'Bad Name!')
    check('the name is made valid as it is typed', (await a.value('Template name *')) === 'bad-name-', await a.value('Template name *'))
    await a.type('Template name *', tpl)
    await a.type('Display title', title)
    await a.type('Description', 'made by the e2e journey')
    // the editor starts with an example compose file: replace it
    check('the compose editor starts with an example', /services:/.test(await a.value('docker-compose.yml')))
    await a.type('docker-compose.yml', COMPOSE)
    w0 = a.requests.length
    await a.click('Validate', { within: '[role="dialog"]', kind: 'button' })
    await k.sleep(1500)
    check('Validate checks the compose file on the server', writes(a, w0).some((x) => /validate/.test(x)), writes(a, w0).join())
    await a.click('Create template', { within: '[role="dialog"]', kind: 'button' })
    check('Create template saves it (a toast, the editor closes)', await a.waitToast(`Template "${tpl}" created`, 15000) && await a.waitNoDialog(8000))
    await a.type('Search the templates', tpl.slice(7))
    check('…and its card appears', await a.until((t) => [...document.querySelectorAll('main [aria-label^="Export "]')].some((b) => b.getAttribute('aria-label') === `Export ${t}`), title, 15000), JSON.stringify(await cardTitles(a)))
    await a.click(`Edit ${title}`, { within: 'main' })
    check('Edit opens the editor with its name locked', await a.waitDialog(`Edit ${tpl}`, 10000) && await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] input')].find((i) => i.placeholder === 'my-template')?.disabled === true))
    await a.type('Description', 'edited by the e2e journey')
    const saves = await a.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && b.innerText.trim() === 'Save').length)
    const footer = await a.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => b.getClientRects().length && /^(Save|Discard|Close)$/.test(b.innerText.trim())).map((b) => b.innerText.trim() + (b.disabled ? ' (disabled)' : '')))
    check('with unsaved changes the editor shows one Save (no second save bar over its footer)', saves === 1, JSON.stringify(footer))
    check('Discard puts the saved description back', await a.click('Discard', { within: '[role="dialog"]', kind: 'button', dom: true }) && (await a.value('Description')) === 'made by the e2e journey', await a.value('Description'))
    await a.type('Description', 'edited by the e2e journey')
    // the ✕ with unsaved changes asks first
    await a.click('Close', { within: '[role="dialog"]', kind: 'button', index: 0 })
    let c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await a.confirmInfo()
    check('the editor\'s ✕ with unsaved changes asks first', c && /\?$/.test(c.title) && c.danger, JSON.stringify(c))
    if (c) await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('…Cancel keeps the editor and the edit', (await a.waitDialog(`Edit ${tpl}`, 3000)) && (await a.value('Description')) === 'edited by the e2e journey')
    // (a toast can sit over the editor's footer: press the button itself)
    await a.click('Save', { within: '[role="dialog"]', kind: 'button', dom: true })
    check('Save keeps the change (a toast)', await a.waitToast(`Template "${tpl}" saved`, 15000))
    await a.key('Escape')
    check('Escape closes the saved editor without asking', await a.waitNoDialog(6000))
    await a.reload()
    await a.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 30000)
    await a.type('Search the templates', tpl.slice(7))
    check('after a reload the card shows the new description', await a.waitText('edited by the e2e journey', { within: 'main', ms: 15000 }))
    await a.click(`Delete ${title}`, { within: 'main' })
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('Delete asks "Delete this template?" (danger)', c && c.title === 'Delete this template?' && c.danger, JSON.stringify(c))
    await a.click('Delete', { within: '[role="alertdialog"]' })
    check('…and deletes it (a toast, the card goes)', await a.waitToast(`Template "${tpl}" deleted`, 15000) && await a.until((t) => ![...document.querySelectorAll('main [aria-label^="Export "]')].some((b) => b.getAttribute('aria-label') === `Export ${t}`), title, 10000))
    await a.type('Search the templates', '')

    // ---- the gallery -------------------------------------------------------------------------------------
    await a.click('Gallery', { within: 'main' })
    check('Gallery lists the gallery\'s templates', await a.until(() => document.querySelectorAll('main [aria-label^="Import "]').length > 5, null, 20000))
    const gchips = await a.page.evaluate(() => [...document.querySelectorAll('main [role="group"][aria-label="Category"] button')].map((b) => b.innerText.trim()))
    const cat = gchips.find((g) => g !== 'All' && g.toLowerCase() !== 'all')
    if (cat) {
      const before = (await a.page.$$('main [aria-label^="Import "]')).length
      await a.click(cat, { within: 'main [role="group"][aria-label="Category"]' })
      check(`the gallery chip "${cat}" narrows the list`, await a.until((b) => { const n = document.querySelectorAll('main [aria-label^="Import "]').length; return n > 0 && n < b }, before, 5000))
      await a.click(gchips[0], { within: 'main [role="group"][aria-label="Category"]' })
    }
    await a.type('Search the gallery', 'zzz-nothing-like-this')
    check('a gallery search with no match says so, with a hint', await a.waitText('No templates match your search', { within: 'main', ms: 5000 }) && await a.hasText('Try another name or category.', 'main'))
    check('…and "Clear the filters" brings them back', await a.click('Clear the filters', { within: 'main' }) && await a.until(() => document.querySelectorAll('main [aria-label^="Import "]').length > 5, null, 5000))
    await a.click('My templates', { within: 'main' })
    check('My templates comes back', await a.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 10000))
  } finally {
    await api.del(`/templates/${tpl}`).catch(() => {})
    await api.logout().catch(() => {})
  }

  // ---- a viewer -----------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Templates', await v.go('templates') && (await v.h1()) === 'Templates')
  await v.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 30000)
  const vb = await v.page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => (b.getAttribute('aria-label') || b.innerText).trim()))
  const vAdm = vb.filter((n) => /^(Create|URL import|File import|History|Edit |Delete |Deploy |Redeploy |Import )/.test(n))
  check('a viewer is offered no admin action (create, import, history, edit, delete, deploy)', !vAdm.length, JSON.stringify(vAdm.slice(0, 6)))
  await v.type('Search the templates', 'redis')
  await v.click('View Redis 7', { within: 'main' })
  check('View opens the template for a viewer (titled by its name, not "Deploy")', await v.waitDialog('redis', 15000))
  check('…with Close and no Deploy button', !!(await dlgButton(v, 'Close')) && !(await dlgButton(v, 'Deploy stack')) && /Admins deploy templates/.test(await dlg(v)))
  check('a viewer\'s Preview runs the dry run', await v.click('Preview', { within: '[role="dialog"]', kind: 'button' }) && await v.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /lines of compose|Preview failed/.test(d.innerText)), null, 30000) && !/Preview failed/.test(await dlg(v)))
  check('a viewer\'s Close closes it', await v.click('Close', { within: '[role="dialog"]', kind: 'button', index: 1 }) && await v.waitNoDialog(5000))
  const ve = v.errors.length
  await v.click('Export Redis 7', { within: 'main' })
  check('a viewer can export a template', await v.waitToast('exported', 10000) && v.errors.length === ve)
  await v.click('Gallery', { within: 'main' })
  check('a viewer sees the gallery without Import buttons', await v.until(() => document.querySelectorAll('main h3').length > 5, null, 20000) && !(await v.page.$('main [aria-label^="Import "]')))

  // ---- a phone ------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('templates')
  await p.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 30000)
  check('no sideways scroll on a phone (Templates)', !(await p.overflow()), await p.overflow())
  await p.type('Search the templates', 'redis')
  await p.click('Deploy Redis 7', { within: 'main' }); await p.waitDialog(/^Deploy /, 15000)
  const pb = await p.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop()
    return [...d.querySelectorAll('button')].filter((b) => /^(Cancel|Preview|Deploy stack)$/.test(b.innerText.trim())).map((b) => Math.round(b.getBoundingClientRect().height))
  })
  check('the deploy sheet\'s buttons are thumb-sized on a phone (≥ 40 px)', pb.length === 3 && pb.every((h) => h >= 40), JSON.stringify(pb))
  check('no sideways scroll with the deploy sheet open', !(await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
  await p.shot('templates-phone-deploy')
  await p.key('Escape')

  // ---- the light look --------------------------------------------------------------------------------------
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('templates')
  await l.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 30000)
  check('Templates in the light look (screenshot)', await l.page.evaluate(() => document.documentElement.classList.contains('light')), await l.shot('templates-light'))
}
