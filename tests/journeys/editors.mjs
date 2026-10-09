// The editors (components/editor): the stack's compose editor, the way into it from a container, the template editor
// and the deploy sheet's bar. One press of Save checks and then saves: a file Docker refuses is listed above the bar
// with its line (a press away), nothing is saved; a good file is saved by the same press (and by Ctrl+S). Check only
// checks without saving; Discard and closing with something unsaved ask first; Escape closes a clean editor; Find;
// the diff; the history's Compare. A viewer reads; a phone gets the bar at full width with thumb-sized buttons, and a
// page's bar (Settings) sits above the tab bar, clear of the chat button. The lab's file is put back at the end.

const STACK = 'monitoring-management'

/** the text of the dialog on top */
const dlg = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
  return d.length ? d[d.length - 1].innerText : ''
})
/** the save bar of the editor on screen: its words and buttons */
const bar = (t) => t.page.evaluate(() => {
  const r = [...document.querySelectorAll('[role="region"]')].filter((e) => e.getClientRects().length && /unsaved|template|deploy/i.test(e.getAttribute('aria-label') || '')).pop()
  if (!r) return null
  const b = r.getBoundingClientRect()
  return {
    label: r.getAttribute('aria-label'),
    text: r.innerText,
    buttons: [...r.querySelectorAll('button')].filter((x) => x.getClientRects().length).map((x) => ({ t: x.innerText.trim(), h: Math.round(x.getBoundingClientRect().height), disabled: x.disabled })),
    rect: { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width) },
    result: r.querySelector('[data-save-result]')?.getAttribute('data-save-result') || null,
  }
})
/** put the caret at the end of the editor's text area (on a line of its own) and type */
async function typeAtEnd(t, text) {
  await t.until(() => !!document.querySelector('[role="dialog"] textarea.code-input'), null, 15000)
  const ta = await t.page.$('[role="dialog"] textarea.code-input')
  const lineEnd = await ta.evaluate((e) => { e.focus(); e.setSelectionRange(e.value.length, e.value.length); return e.value === '' || e.value.endsWith('\n') })
  await t.page.keyboard.type(`${lineEnd ? '' : '\n'}${text}`, { delay: 3 })
  await ta.dispose()
}
const same = (x, y) => (x ?? '').replace(/\s+$/, '') === (y ?? '').replace(/\s+$/, '')
const codeValue = (t) => t.page.evaluate(() => document.querySelector('[role="dialog"] textarea.code-input')?.value ?? null)
const caretLine = (t) => t.page.evaluate(() => { const m = /Ln (\d+), Col (\d+)/.exec([...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length).pop()?.innerText || ''); return m ? Number(m[1]) : null })

export default async function editors(k) {
  const { check } = k
  const api = await k.apiAs(k.ADMIN)
  const orig = (await api.get(`/stacks/${STACK}/compose`)).data.content
  const tpl = `e2e-ed-${Date.now().toString(36)}`
  const a = await k.open(k.ADMIN)
  let b
  let c
  const writes = (from) => a.requests.slice(from).filter((r) => r.method !== 'GET' && !/^\/(auth|settings\/profile|chat)/.test(r.path)).map((r) => `${r.method} ${r.path}`)

  try {
    // ---- the stack editor --------------------------------------------------------------------------------
    await a.go('stacks')
    await a.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
    await a.click(`Edit ${STACK}`, { within: 'main' })
    check('Edit opens the stack editor on its compose file', await a.waitDialog('Monitoring Management', 15000) && await a.until((o) => document.querySelector('[role="dialog"] textarea.code-input')?.value === o, orig, 15000))
    check('a clean file shows no save bar', !(await bar(a)))
    check('the code area is editable for an admin (no Edit mode to switch on)', await a.page.evaluate(() => document.querySelector('[role="dialog"] textarea.code-input')?.readOnly === false))

    // a service Docker refuses (no image): one press of Save checks, lists it with its line, saves nothing
    const brokenAt = orig.replace(/\n*$/, '\n').split('\n').length // the line the new service starts on
    await typeAtEnd(a, '  e2e-broken:\n    restart: always\n')
    b = await bar(a)
    check('typing brings up the save bar: what changed, then Discard · Check only · Save', b && /lines? changed/.test(b.text) && b.buttons.map((x) => x.t).join() === 'Discard,Check only,Save', JSON.stringify(b))
    check('…it says what saving changes (the service, and when it takes effect)', b && /e2e-broken/.test(b.text) && /takes effect when the stack/.test(b.text), b?.text)
    check('the Compose tab shows the unsaved mark', await a.page.evaluate(() => !!document.querySelector('[role="dialog"] [aria-label="unsaved"]')))
    check('the gutter marks the changed lines', await a.page.evaluate(() => document.querySelectorAll('[role="dialog"] .sticky .bg-emerald-400').length >= 2))
    let w0 = a.requests.length
    await a.click('Save', { within: '[role="dialog"]', kind: 'button' })
    const problem = await a.until(() => document.querySelector('[role="dialog"] [data-save-result="problem"]')?.innerText || false, null, 20000)
    check('ONE press of Save checks the file and lists what Docker refused (nothing saved)', problem && /nothing was saved/.test(problem) && /e2e-broken/.test(problem), problem)
    check('…the problem carries its line, as a button', problem && new RegExp(`Line ${brokenAt}\\b`).test(problem), problem)
    check('…the press asked the check only: no save request', writes(w0).some((x) => x === `POST /stacks/${STACK}/compose/validate`) && !writes(w0).some((x) => x === `POST /stacks/${STACK}/compose`), writes(w0).join())
    check('…and the server\'s file is unchanged', (await api.get(`/stacks/${STACK}/compose`)).data.content === orig)
    await a.click(new RegExp(`^Line ${brokenAt}:`), { within: '[role="dialog"]' })
    check('pressing the problem puts the caret on its line', await a.until((n) => { const m = /Ln (\d+),/.exec([...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length).pop()?.innerText || ''); return m && Number(m[1]) === n }, brokenAt, 4000), String(await caretLine(a)))

    // the fixed file: the old result says it is from before the edit; Check only checks without saving
    await typeAtEnd(a, '    image: traefik/whoami:latest\n')
    check('an edit after the check marks its result as older than the text', /from before your last edit/.test((await bar(a))?.text || ''), (await bar(a))?.text)
    w0 = a.requests.length
    await a.click('Check only', { within: '[role="dialog"]', kind: 'button' })
    const passed = await a.until(() => { const r = document.querySelector('[role="dialog"] [data-save-result]'); return r && r.getAttribute('data-save-result') !== 'problem' ? r.innerText : false }, null, 20000)
    check('Check only checks and says so in a quiet line (no save)', passed && /Docker reads the file/.test(passed) && !writes(w0).some((x) => x === `POST /stacks/${STACK}/compose`), `${passed} · ${writes(w0).join()}`)

    // Ctrl+S: the same one press — checked, then saved
    const edited = await codeValue(a)
    w0 = a.requests.length
    await a.chord('Control', 's')
    check('Ctrl+S checks and saves in one press (a toast)', await a.waitToast(`Compose file saved for ${STACK}`, 20000), JSON.stringify(await a.toasts()))
    const ws = writes(w0)
    check('…the check first, then the save', ws.indexOf(`POST /stacks/${STACK}/compose/validate`) >= 0 && ws.indexOf(`POST /stacks/${STACK}/compose`) > ws.indexOf(`POST /stacks/${STACK}/compose/validate`), ws.join())
    check('…the server has the edited file', same((await api.get(`/stacks/${STACK}/compose`)).data.content, edited))
    check('…and the bar goes once it is saved', await a.until(() => ![...document.querySelectorAll('[role="dialog"] [role="region"]')].some((r) => r.getClientRects().length), null, 6000))

    // Diff and History
    await typeAtEnd(a, '# e2e note\n')
    await a.click('Diff', { within: '[role="dialog"]' })
    check('Diff shows the edit next to the saved file', await a.waitText(/your edit/i, { within: '[role="dialog"]', ms: 4000 }) && /e2e note/.test(await dlg(a)), (await dlg(a)).slice(0, 300))
    await a.key('Escape')
    check('Escape leaves the diff first (the editor stays)', await a.until(() => !!document.querySelector('[role="dialog"] textarea.code-input'), null, 4000))
    await a.click('History', { within: '[role="dialog"]' })
    check('History lists the saved versions', await a.until(() => [...document.querySelectorAll('[role="dialog"] button')].some((x) => /^Compare/.test(x.getAttribute('aria-label') || '')), null, 15000))
    await a.click(/^Compare /, { within: '[role="dialog"]' })
    check('Compare shows a version next to the saved file', await a.waitText(/saved now/i, { within: '[role="dialog"]', ms: 10000 }), (await dlg(a)).slice(0, 300))
    await a.click('All versions', { within: '[role="dialog"]' })
    await a.click(/^Compose\b/, { within: '[role="dialog"]' })
    check('the unsaved edit survives a trip through the tabs', /e2e note/.test(await codeValue(a) || ''))

    // closing with something unsaved asks; Discard asks
    await a.key('Escape')
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await a.confirmInfo()
    check('Escape with unsaved changes asks first (Close without saving?)', c && c.title === 'Close without saving?' && c.danger && c.buttons.includes('Keep editing'), JSON.stringify(c))
    await a.click('Keep editing', { within: '[role="alertdialog"]' })
    check('…Keep editing keeps the editor and the edit', await a.until(() => /e2e note/.test(document.querySelector('[role="dialog"] textarea.code-input')?.value || ''), null, 4000))
    await a.click('Discard', { within: '[role="dialog"]', kind: 'button' })
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await a.confirmInfo()
    check('Discard asks first', c && c.title === 'Discard your changes?' && c.buttons.includes('Discard changes'), JSON.stringify(c))
    await a.click('Discard changes', { within: '[role="alertdialog"]' })
    check('…and puts the saved file back (the bar goes)', await a.until((e) => document.querySelector('[role="dialog"] textarea.code-input')?.value === e, edited, 4000) && !(await bar(a)))

    // Find
    await a.chord('Control', 'f')
    check('Ctrl+F opens Find with the focus in it', await a.until(() => document.activeElement?.getAttribute('aria-label') === 'Find', null, 3000))
    await a.page.keyboard.type('image', { delay: 5 })
    check('…it counts the matches', await a.waitText(/1 of [3-9]/, { within: '[role="dialog"]', ms: 3000 }), await dlg(a))
    await a.key('Escape')
    check('Escape closes Find, then the editor stays', await a.until(() => !document.querySelector('[role="dialog"] input[aria-label="Find"]') && !!document.querySelector('[role="dialog"] textarea.code-input'), null, 3000))

    // the .env: the same bar (Discard here: a save would leave a .env in the lab's stack)
    await a.click(/^\.env/, { within: '[role="dialog"]' })
    await a.until(() => !!document.querySelector('[role="dialog"] textarea[aria-label=".env file"]'), null, 15000)
    await typeAtEnd(a, 'E2E_EDITOR=1\n')
    b = await bar(a)
    check('the .env gets the same bar', b && b.buttons.map((x) => x.t).join() === 'Discard,Check only,Save' && /\.env/.test(b.label || ''), JSON.stringify(b))
    await a.click('Check only', { within: '[role="dialog"]', kind: 'button' })
    check('…its Check only checks the lines (KEY=value)', await a.until(() => /every line is a comment or KEY=value|linter/.test(document.querySelector('[role="dialog"] [data-save-result]')?.innerText || ''), null, 5000))
    await a.click('Discard', { within: '[role="dialog"]', kind: 'button' })
    await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000)
    await a.click('Discard changes', { within: '[role="alertdialog"]' })
    check('…and Discard empties it again', await a.until(() => !document.querySelector('[role="dialog"] [role="region"]'), null, 5000))
    await a.key('Escape')
    check('Escape closes a clean editor without asking', await a.waitNoDialog(6000))

    // ---- the way in from a container ------------------------------------------------------------------------
    await a.go('containers')
    await a.click('dashdot', { within: 'main table' })
    await a.waitText('Edit compose', { within: 'main', ms: 15000 })
    await a.click('Edit compose', { within: 'main', kind: 'button' })
    check('a container\'s Edit compose opens the stack editor', await a.waitDialog('Monitoring Management', 15000))
    check('…at the container\'s service (the caret on its line, said under the title)', await a.until(() => /Ln 2,/.test([...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length).pop()?.innerText || '') && /opened at dashdot/.test([...document.querySelectorAll('[role="dialog"]')].filter((d) => d.getClientRects().length).pop()?.innerText || ''), null, 8000), (await dlg(a)).slice(0, 200))
    check('…with nothing selected (a key pressed next does not replace the line)', await a.page.evaluate(() => { const t = document.querySelector('[role="dialog"] textarea.code-input'); return t && document.activeElement === t && t.selectionStart === t.selectionEnd }))
    check('…and a button back to the service', await a.exists('dashdot', { within: '[role="dialog"]', kind: 'button' }))
    await a.key('Escape')
    check('Escape closes it', await a.waitNoDialog(6000))

    // ---- the template editor: one press of Create template, refused and then created -------------------------
    await a.go('templates')
    await a.until(() => document.querySelectorAll('main [aria-label^="Export "]').length > 10, null, 30000)
    await a.click('Create', { within: 'main', kind: 'button' })
    check('Create opens the template editor on its Details', await a.waitDialog('Create template', 8000) && !!(await a.field('Template name *')))
    b = await bar(a)
    check('…Create template waits for a name, and says so', b && b.buttons.find((x) => x.t === 'Create template')?.disabled && /Name the template/.test(b.text), JSON.stringify(b))
    await a.type('Template name *', tpl)
    await a.click(/^Compose\b/, { within: '[role="dialog"]' })
    await a.type('docker-compose.yml', 'services:\n  hello:\n    container_name: e2e-hello\n')
    w0 = a.requests.length
    await a.click('Create template', { within: '[role="dialog"]', kind: 'button' })
    const tp = await a.until(() => document.querySelector('[role="dialog"] [data-save-result="problem"]')?.innerText || false, null, 20000)
    check('ONE press of Create template checks the file: a service without an image is listed, at its line', tp && /nothing was created/.test(tp) && /Line 2\b/.test(tp), tp)
    check('…and nothing is created', !writes(w0).some((x) => /\/templates\/import$/.test(x)) && writes(w0).some((x) => /\/compose\/validate$/.test(x)), writes(w0).join())
    await a.type('docker-compose.yml', 'services:\n  hello:\n    image: traefik/whoami:latest\n    container_name: e2e-hello\n')
    w0 = a.requests.length
    await a.click('Create template', { within: '[role="dialog"]', kind: 'button' })
    check('the fixed file is checked and created by one press (a toast, the editor closes)', await a.waitToast(`Template "${tpl}" created`, 20000) && await a.waitNoDialog(8000), writes(w0).join())
    await a.type('Search the templates', tpl.slice(7))
    await a.click(new RegExp(`^Edit `), { within: 'main' })
    await a.waitDialog(`Edit ${tpl}`, 10000)
    await typeAtEnd(a, '    restart: unless-stopped\n')
    w0 = a.requests.length
    await a.chord('Control', 's')
    check('Ctrl+S in the template editor checks and saves', await a.waitToast(`Template "${tpl}" saved`, 15000) && writes(w0).some((x) => /\/compose\/validate$/.test(x)) && writes(w0).some((x) => /\/update$/.test(x)), writes(w0).join())
    check('…the saved template has the line', /restart: unless-stopped/.test((await api.get(`/templates/${tpl}`)).data?.compose || ''))
    await a.key('Escape'); await a.waitNoDialog(6000)
    await a.type('Search the templates', '')
  } finally {
    // the lab's files as they were
    if ((await api.get(`/stacks/${STACK}/compose`)).data.content !== orig) await api.post(`/stacks/${STACK}/compose`, { content: orig })
    await api.del(`/templates/${tpl}`).catch(() => {})
  }
  check('the lab\'s compose file is put back', (await api.get(`/stacks/${STACK}/compose`)).data.content === orig)

  // ---- a viewer reads ------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.go('stacks')
  await v.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
  await v.click('Open Monitoring Management', { within: 'main' })
  await v.waitText('dashdot', { within: 'main', ms: 15000 })
  await v.click('Compose', { within: 'main', kind: 'button' })
  check('a viewer opens the compose file read-only', await v.waitDialog('Monitoring Management', 15000) && await v.page.evaluate(() => document.querySelector('[role="dialog"] textarea.code-input')?.readOnly === true))
  const vt = await v.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] [role="radio"], [role="dialog"] .mantine-SegmentedControl-label')].map((e) => e.innerText.trim()))
  check('…with Compose and History, no .env', vt.some((x) => /^Compose/.test(x)) && vt.some((x) => /^History/.test(x)) && !vt.some((x) => /^\.env/.test(x)), JSON.stringify(vt))
  await typeAtEnd(v, 'x')
  check('…typing changes nothing and brings no save bar', !(await bar(v)) && !(await v.exists('Save', { within: '[role="dialog"]', kind: 'button' })))
  await v.key('Escape')
  check('…and Escape closes it', await v.waitNoDialog(6000))

  // ---- a phone ----------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('stacks')
  await p.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
  await p.click(`Edit ${STACK}`, { within: 'main' })
  await p.waitDialog('Monitoring Management', 15000)
  await k.sleep(500) // the entrance (a scale from 97 %) is over
  const fill = await p.page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].filter((x) => x.getClientRects().length).pop().getBoundingClientRect(); return { w: Math.round(d.width), h: Math.round(d.height), vw: window.innerWidth, vh: window.innerHeight } })
  check('the editor fills a phone\'s screen', fill.w >= fill.vw - 1 && fill.h >= fill.vh - 1, JSON.stringify(fill))
  await typeAtEnd(p, '# phone edit\n')
  await k.sleep(500)
  b = await bar(p)
  const vw = await p.page.evaluate(() => ({ w: window.innerWidth, h: window.innerHeight }))
  check('on a phone the bar is as wide as the screen', b && b.rect.width >= vw.w - 2, JSON.stringify(b?.rect))
  const widest = await p.page.evaluate(() => { const bs = [...document.querySelectorAll('[role="dialog"] [role="region"] button')]; const w = (t) => bs.find((x) => x.innerText.trim() === t)?.getBoundingClientRect().width || 0; return w('Save') > w('Discard') && w('Save') > w('Check only') })
  check('…its buttons are thumb-sized (≥ 44 px), Save the widest', b && b.buttons.length === 3 && b.buttons.every((x) => x.h >= 44) && widest, JSON.stringify(b?.buttons))
  const statusTop = await p.page.evaluate(() => { const s = [...document.querySelectorAll('[role="dialog"] span')].find((e) => /^\d+ lines?$/.test(e.textContent || '')); return s ? Math.round(s.getBoundingClientRect().top) : null })
  check('…on screen, above the status line', b && b.rect.bottom <= vw.h && (statusTop === null || statusTop >= b.rect.bottom - 1), JSON.stringify({ bar: b?.rect, statusTop }))
  check('no sideways scroll with the editor open', !(await p.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)))
  await p.shot('editors-phone-bar')
  await p.key('Escape')
  c = await p.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000) && await p.confirmInfo()
  if (c) await p.click('Close without saving', { within: '[role="alertdialog"]' })
  check('closing on a phone with an edit asks, and closes on "Close without saving"', !!c && await p.waitNoDialog(6000))
  // a page's bar (Settings): above the tab bar, clear of the chat button
  await p.go('settings')
  await p.settle(800)
  const typed = await p.page.evaluate(() => {
    const i = [...document.querySelectorAll('main input')].find((x) => x.getClientRects().length && !x.disabled && (x.type === 'text' || !x.type) && !x.readOnly)
    if (!i) return false
    i.scrollIntoView({ block: 'center' }); i.focus(); return true
  })
  if (typed) await p.page.keyboard.type('x')
  // the bar rises (an entrance of 250 ms) and the chat button moves up after it
  await p.until(() => [...document.querySelectorAll('[role="region"]')].some((e) => e.getClientRects().length && /unsaved/i.test(e.getAttribute('aria-label') || '')), null, 8000)
  await k.sleep(700)
  const pageBar = await p.until(() => {
    const r = [...document.querySelectorAll('[role="region"]')].find((e) => e.getClientRects().length && /unsaved/i.test(e.getAttribute('aria-label') || ''))
    if (!r) return false
    const b = r.getBoundingClientRect()
    const nav = [...document.querySelectorAll('nav, [aria-label]')].map((e) => e.getBoundingClientRect()).filter((x) => x.bottom >= window.innerHeight - 1 && x.height >= 50 && x.height <= 80 && x.width >= window.innerWidth - 2)[0]
    const chat = document.querySelector('[data-chat-bubble]')?.getBoundingClientRect()
    const overlap = (x, y) => !!x && !!y && x.left < y.right && y.left < x.right && x.top < y.bottom && y.top < x.bottom
    return { bottom: Math.round(b.bottom), navTop: nav ? Math.round(nav.top) : null, chatOverlap: overlap(b, chat), hasChat: !!chat }
  }, null, 8000)
  check('a page\'s save bar on a phone sits above the tab bar', pageBar && (pageBar.navTop === null || pageBar.bottom <= pageBar.navTop), JSON.stringify(pageBar))
  check('…and the chat button moves clear of it', pageBar && !pageBar.chatOverlap, JSON.stringify(pageBar))
  await p.shot('editors-phone-page-bar')
  if (pageBar) await p.click('Discard', { within: 'body', kind: 'button' })

  // ---- the light look --------------------------------------------------------------------------------------
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('stacks')
  await l.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
  await l.click(`Edit ${STACK}`, { within: 'main' })
  await l.waitDialog('Monitoring Management', 15000)
  await typeAtEnd(l, '# light\n')
  check('the editor and its bar in the light look (screenshot)', await l.page.evaluate(() => document.documentElement.classList.contains('light')) && !!(await bar(l)), await l.shot('editors-light'))
  await l.key('Escape')
  if (await l.until(() => !!document.querySelector('[role="alertdialog"]'), null, 3000)) await l.click('Close without saving', { within: '[role="alertdialog"]' })
}
