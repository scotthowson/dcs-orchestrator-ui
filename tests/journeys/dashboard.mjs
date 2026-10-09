// Dashboard: Edit dashboard (move, resize and hide a card, then cancel; add a card, save, take it off again), the
// resource chart's Gauges/Trending and the top consumers' CPU/MEM, the quick actions (customize: add one, take it off;
// a confirmation asks a question), the container spotlight (pin one, unpin), the note card (write, save, read back after
// a reload, clear), "Needs your attention" (Hide, Show hidden), the chat (send as lab, seen by austin, edit, delete),
// the palette's health check toast (a live region, Dismiss); a viewer's cards never lead to an admin's page; the phone
// and the light look. The person's layout on the server is put back as it was.

const AUSTIN = { user: 'austin', pass: 'Austin-Lab-Pass-456' }
const ADMIN_LABELS = ['Secrets', 'File Browser', 'Plugins', 'Terminal', 'Environment', 'Config', 'Cleanup', 'Backups', 'Users', 'Export', 'DNS & Routes']

const cardsPos = (t) => t.page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.dashboard-grid > div[style]')]
  .map((d) => [(d.querySelector('h2, h3')?.textContent || '').trim(), `${d.style.gridColumn} / ${d.style.gridRow}`]).filter(([n]) => n)))

/** the card (grid cell) whose heading is `title` */
function cardSel(t, title) {
  return t.page.evaluateHandle((title) => [...document.querySelectorAll('.dashboard-grid > div[style]')].find((d) => (d.querySelector('h2, h3')?.textContent || '').trim() === title) || null, title)
}

export default async function dashboard(k) {
  const { check } = k
  const stamp = Date.now().toString(36)
  const api = await k.apiAs(k.ADMIN)
  const layout0 = (await api.get('/settings/dashboard')).data?.layout ?? null

  const a = await k.open(k.ADMIN)
  check('the dashboard opens for an admin', await a.go('dashboard') && (await a.h1()) === 'Dashboard')
  await a.until(() => document.querySelectorAll('.dashboard-grid > div[style]').length > 10, null, 30000)
  const text = await a.text('main')
  check('no undefined / NaN / [object Object] on the cards', !/\bundefined\b|\bNaN\b|\[object Object\]/.test(text), (text.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0])

  // ---- the segments -----------------------------------------------------------------------------
  for (const [seg, other] of [['Trending', 'Gauges'], ['MEM', 'CPU']]) {
    const ok = await a.click(seg, { within: 'main' })
    const on = await a.until((s) => [...document.querySelectorAll('main .mantine-SegmentedControl-root label')].some((l) => l.textContent.trim() === s && (l.hasAttribute('data-active') || l.closest('[data-active]'))), seg, 4000)
    check(`the ${seg} segment switches the card`, ok && on)
    await a.click(other, { within: 'main' })
  }

  // ---- Edit dashboard: move, resize, hide, then cancel --------------------------------------------
  const before = await cardsPos(a)
  check('Edit dashboard enters edit mode (the toolbar)', await a.click('Edit dashboard', { within: 'main' }) && await a.waitText('Save layout', { within: 'main', ms: 5000 }))
  const discardCls = await a.page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.textContent.trim() === 'Discard')?.className || '')
  check('Discard (it only throws away the edit) is a quiet button, not rose (regression)', discardCls && !/rose/.test(discardCls), discardCls)
  // shrink the "Notes" card with its corner (smaller never runs into a neighbour), then move it down into the free rows
  const notes = await cardSel(a, 'Notes')
  await notes.asElement()?.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await k.sleep(300)
  const corner = notes.asElement() && await notes.asElement().$('.cursor-nwse-resize')
  if (corner) {
    const b = await corner.boundingBox()
    await a.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await a.page.mouse.down()
    await a.page.mouse.move(b.x - 110, b.y - 70, { steps: 12 }); await a.page.mouse.up()
    await corner.dispose()
  }
  await k.sleep(400)
  const resized = await cardsPos(a)
  check('a card resizes with its corner', !!corner && resized.Notes !== before.Notes, `${before.Notes} → ${resized.Notes}`)
  await notes.asElement()?.evaluate((e) => e.scrollIntoView({ block: 'center' }))
  await k.sleep(300)
  const handle = notes.asElement() && await notes.asElement().$('.cursor-move')
  if (handle) {
    const b = await handle.boundingBox()
    await a.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await a.page.mouse.down()
    await a.page.mouse.move(b.x + b.width / 2, b.y + 700, { steps: 14 }); await a.page.mouse.up()
    await handle.dispose()
  }
  await k.sleep(400)
  const moved = await cardsPos(a)
  check('a card moves with its handle', !!handle && moved.Notes !== resized.Notes, `${resized.Notes} → ${moved.Notes}`)
  await notes.dispose()
  check('a card is taken off with its ✕', await a.click('Remove Bookmarks', { within: 'main' }) && await a.until(() => ![...document.querySelectorAll('.dashboard-grid h2, .dashboard-grid h3')].some((h) => h.textContent.trim() === 'Bookmarks'), null, 4000))
  await a.key('Escape')
  check('Escape cancels the edit: every card back where it was', await a.until(() => ![...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Save layout'), null, 5000) && JSON.stringify(await cardsPos(a)) === JSON.stringify(before), JSON.stringify(await cardsPos(a)).slice(0, 200))
  check('…and nothing was saved', JSON.stringify((await api.get('/settings/dashboard')).data?.layout ?? null) === JSON.stringify(layout0))
  // the same through Discard
  await a.click('Edit dashboard', { within: 'main' }); await a.waitText('Save layout', { within: 'main', ms: 5000 })
  await a.click('Remove Bookmarks', { within: 'main' })
  await a.click('Discard', { within: 'main' })
  check('Discard brings the card back', await a.waitText('Bookmarks', { within: '.dashboard-grid', ms: 5000 }) && !(await a.exists('Save layout', { within: 'main' })))

  // ---- add a card (from the picker), save, take it off again -----------------------------------------
  await a.click('Edit dashboard', { within: 'main' }); await a.waitText('Save layout', { within: 'main', ms: 5000 })
  await a.click('Remove Bookmarks', { within: 'main' })
  await a.click('Add card', { within: 'main' })
  check('Add card opens the picker', await a.waitDialog(/Add cards/, 5000))
  check('the picker offers the card taken off', await a.click(/^Bookmarks/, { within: '[role="dialog"]' }))
  await a.waitNoDialog(4000).then(async (gone) => { if (!gone) await a.key('Escape') })
  check('…and it is back on the grid', await a.waitText('Bookmarks', { within: '.dashboard-grid', ms: 5000 }))
  await a.click('Save layout', { within: 'main' })
  check('Save layout saves it on the server', await a.until(() => ![...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Save layout'), null, 8000) && !!(await (async () => { for (let i = 0; i < 20; i++) { const l = (await api.get('/settings/dashboard')).data?.layout; if (l) return l; await k.sleep(300) } return null })()))

  // ---- the quick actions -----------------------------------------------------------------------------
  const qaCount = () => a.page.evaluate(() => { const c = [...document.querySelectorAll('.dashboard-grid > div[style]')].find((d) => (d.querySelector('h2, h3')?.textContent || '').trim() === 'Quick actions'); return c ? c.querySelectorAll('button:not([aria-label])').length : -1 })
  const n0 = await qaCount()
  check('Customize the actions opens the editor', await a.click('Customize the actions', { within: 'main' }) && await a.waitDialog(null, 5000))
  await a.click('Add action', { kind: 'button' })
  const kinds = await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.textContent.trim()).filter((x) => /page/i.test(x)))
  check('Add action offers the kinds (a page among them)', kinds.length > 0, JSON.stringify(kinds))
  if (kinds[0]) await a.click(kinds[0], { kind: 'button' })
  const labels = await a.page.$$('[role="dialog"] input[aria-label="Label"]')
  const last = labels[labels.length - 1]
  if (last) { await last.click({ clickCount: 3 }); await last.type(`e2e ${stamp}`) }
  for (const l of labels) await l.dispose()
  await a.click('Save', { kind: 'button', within: '[role="dialog"]' })
  check('the new action is on the card', await a.waitNoDialog(8000) && await a.waitText(`e2e ${stamp}`, { within: '.dashboard-grid', ms: 8000 }))
  await a.click('Customize the actions', { within: 'main' }); await a.waitDialog(null, 5000)
  await a.click(`Remove e2e ${stamp}`, { kind: 'button' })
  await a.click('Save', { kind: 'button', within: '[role="dialog"]' })
  check('…and taken off again (the card as it was)', await a.waitNoDialog(8000) && await a.until((n) => !document.querySelector('.dashboard-grid').innerText.includes(n), `e2e ${stamp}`, 8000) && (await qaCount()) === n0, `${n0} → ${await qaCount()}`)
  // a quick action that changes something asks first, with a question
  if (await a.click('Prune images', { within: '.dashboard-grid', ms: 3000 })) {
    const c = await a.confirmInfo()
    check('a quick action that changes something asks a question, its verb on the button, rose for a prune (regression)', c && /\?$/.test(c.title) && c.buttons.includes('Prune images') && c.danger, JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' }); await a.waitNoDialog(4000)
  } else k.j.note('no "Prune images" quick action on the card')

  // ---- the container spotlight -----------------------------------------------------------------------------
  check('Choose containers opens the picker', await a.click('Choose containers', { within: 'main' }) && await a.waitDialog(null, 5000))
  const boxes = () => a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[role="checkbox"]')].map((b) => ({ n: b.querySelector('.font-mono')?.textContent.trim(), on: b.getAttribute('aria-checked') === 'true', label: b.textContent.trim() })))
  const pick = (await boxes()).find((b) => b.n === 'traefik') || (await boxes())[0]
  const wasOn = !!pick?.on
  await a.page.evaluate((n) => [...document.querySelectorAll('[role="dialog"] button[role="checkbox"]')].find((b) => b.querySelector('.font-mono')?.textContent.trim() === n)?.click(), pick?.n)
  await a.click('Save', { kind: 'button', within: '[role="dialog"]' })
  const spotText = () => a.page.evaluate(() => { const c = [...document.querySelectorAll('.dashboard-grid > div[style]')].find((d) => (d.querySelector('h2, h3')?.textContent || '').trim() === 'Container spotlight'); return c?.innerText || '' })
  const cname = pick?.n || 'no-container'
  await a.waitNoDialog(6000)
  const spotHas = (n, want) => a.until(({ n, want }) => { const c = [...document.querySelectorAll('.dashboard-grid > div[style]')].find((d) => (d.querySelector('h2, h3')?.textContent || '').trim() === 'Container spotlight'); return !!c && c.innerText.includes(n) === want }, { n, want }, 10000)
  check(`${wasOn ? 'unpinning' : 'pinning'} ${cname} changes the spotlight`, await spotHas(cname, !wasOn), (await spotText()).slice(0, 200))
  await a.click('Choose containers', { within: 'main' }); await a.waitDialog(null, 5000)
  await a.page.evaluate((n) => [...document.querySelectorAll('[role="dialog"] button[role="checkbox"]')].find((b) => b.querySelector('.font-mono')?.textContent.trim() === n)?.click(), pick?.n)
  await a.click('Save', { kind: 'button', within: '[role="dialog"]' })
  await a.waitNoDialog(6000)
  check('…and pressing it again puts the spotlight back as it was', await spotHas(cname, wasOn), (await spotText()).slice(0, 200))

  // ---- the note card -----------------------------------------------------------------------------------------
  const noteText = `e2e note ${stamp}`
  check('Edit the note opens the editor', await a.click('Edit the note', { within: 'main' }) && !!(await a.field('Note', 'main')))
  const note0 = await a.value('Note', 'main')
  await a.type('Note', noteText, 'main')
  await a.click('Save the note', { within: 'main' })
  check('Save the note shows it on the card', await a.waitText(noteText, { within: '.dashboard-grid', ms: 8000 }))
  await a.reload()
  check('after a reload the note reads back', await a.waitText(noteText, { within: '.dashboard-grid', ms: 20000 }))
  await a.click('Edit the note', { within: 'main' })
  await a.type('Note', 'not kept', 'main')
  await a.click('Discard the changes', { within: 'main' })
  check('Discard keeps the saved note', await a.waitText(noteText, { within: '.dashboard-grid', ms: 4000 }) && !(await a.hasText('not kept', '.dashboard-grid')))
  await a.click('Edit the note', { within: 'main' })
  await a.type('Note', note0 || '', 'main')
  await a.click('Save the note', { within: 'main' })
  check('clearing the note (put back as it was)', await a.until((n) => !document.querySelector('.dashboard-grid').innerText.includes(n), noteText, 8000))

  // ---- Needs your attention: Hide, Show hidden --------------------------------------------------------------
  const hideBtn = await a.find(/^Hide “.*” until it changes$/, { within: 'main' })
  if (hideBtn) {
    const name = await hideBtn.evaluate((b) => b.getAttribute('aria-label'))
    await hideBtn.click(); await hideBtn.dispose()
    check('Hide puts a Needs-you item away', await a.until((n) => !document.querySelector(`main [aria-label="${n}"]`), name, 5000), name)
    check('"Show hidden" brings it back', await a.click(/^(Show \d+ hidden item|\d+ hidden)/, { within: 'main' }) && await a.until((n) => !!document.querySelector(`main [aria-label="${n}"]`), name, 5000))
  } else k.j.note('Needs your attention had nothing to hide')

  // ---- the palette's health check: a toast in the live region, Dismiss --------------------------------------
  await a.chord('Control', 'k'); await a.waitDialog('Search', 8000)
  await a.page.keyboard.type('health check'); await k.sleep(400)
  await a.key('Enter')
  const toast = await a.until(() => {
    const t = document.querySelector('[data-toast-region][aria-live] [data-toast]')
    return t && /status|alert/.test(t.getAttribute('role') || t.querySelector('[role]')?.getAttribute('role') || '') ? t.innerText.trim() : false
  }, null, 30000)
  check('the palette\'s health check answers with a toast in the live region (role status/alert)', !!toast, JSON.stringify(await a.toasts()))
  check('its Dismiss removes it', await a.click('Dismiss', { within: '[data-toast-region]' }) && await a.until(() => !document.querySelector('[data-toast-region] [data-toast]'), null, 5000))

  // ---- the chat: lab sends, austin sees, lab edits and deletes ------------------------------------------------
  const msg = `e2e chat ${stamp}`
  check('the chat bubble opens the chat', await a.click('Open the chat') && await a.waitDialog(/Chat/, 6000))
  await a.type('Message', msg)
  await a.click('Send', { kind: 'button' })
  check('a message is sent', await a.waitText(msg, { within: '[role="log"]', ms: 15000 }))
  const au = await k.open(AUSTIN)
  await au.click('Open the chat'); await au.waitDialog(/Chat/, 6000)
  check('austin sees it in a second tab', await au.waitText(msg, { within: '[role="log"]', ms: 30000 }))
  // edit (the actions show on hover)
  const row = await a.page.evaluateHandle((m) => [...document.querySelectorAll('[role="log"] *')].filter((e) => e.children.length < 6 && e.textContent.includes(m)).pop()?.closest('[onmouseenter], li, div[class*="group"]') || null, msg)
  if (row.asElement()) await row.asElement().hover()
  await row.dispose()
  const edited = `${msg} (edited by e2e)`
  if (await a.click('Edit message', { ms: 5000, dom: true })) {
    await a.type('Edit your message', edited)
    await a.key('Enter')
    check('lab edits the message', await a.waitText(edited, { within: '[role="log"]', ms: 10000 }))
    check('…austin sees the edit', await au.waitText(edited, { within: '[role="log"]', ms: 30000 }))
  } else check('the message offers Edit', false)
  await a.click('Delete message', { ms: 5000, dom: true })
  const dc = await a.confirmInfo()
  check('Delete asks first (a question, the verb, rose)', dc && /\?$/.test(dc.title) && dc.buttons.includes('Delete message') && dc.danger, JSON.stringify(dc))
  await a.click('Delete message', { within: '[role="alertdialog"]' })
  check('lab deletes it', await a.until((m) => !document.querySelector('[role="log"]').innerText.includes(m), msg, 10000))
  check('…gone for austin too', await au.until((m) => !document.querySelector('[role="log"]')?.innerText.includes(m), msg, 30000))
  await a.key('Escape')

  // ---- a viewer: no card leads to an admin's page (regressions) ----------------------------------------------
  const v = await k.open(k.VIEWER)
  await v.go('dashboard')
  await v.until(() => document.querySelectorAll('.dashboard-grid > div[style]').length > 5, null, 30000)
  await k.sleep(1500)
  const vb = await v.page.evaluate(() => [...document.querySelectorAll('main button, main a[href]')].filter((e) => e.getClientRects().length).map((e) => (e.getAttribute('aria-label') || e.innerText || '').trim().replace(/\s+/g, ' ')))
  const toAdmin = vb.filter((n) => ADMIN_LABELS.some((l) => n === `Open ${l}` || n === l))
  check('a viewer\'s cards offer no link to an admin\'s page (cardShared useReachable)', !toAdmin.length, JSON.stringify(toAdmin))
  check('a viewer is not offered the Power or Proxmox cards\' Config button', !vb.some((n) => /in Config$|^Config$|Set it up/.test(n)), JSON.stringify(vb.filter((n) => /Config|Set it up/.test(n))))
  const needs = await v.page.evaluate(() => { const c = [...document.querySelectorAll('.dashboard-grid > div[style]')].find((d) => /Needs your attention/i.test(d.querySelector('h2, h3')?.textContent || '')); return c ? [...c.querySelectorAll('button')].map((b) => (b.getAttribute('aria-label') || b.innerText).trim()) : null })
  check('a viewer\'s Needs-you items lead to Disk Analysis, never Cleanup', !needs || !needs.some((n) => /^Cleanup$|Open Cleanup/.test(n)), JSON.stringify(needs))

  // ---- phone + light -----------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('dashboard')
  await p.until(() => document.querySelectorAll('.dashboard-grid > div[style]').length > 5, null, 30000)
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Choose containers', { within: 'main' }); await p.waitDialog(null, 5000)
  const g = await p.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop(); const panel = d?.firstElementChild; const r = panel?.getBoundingClientRect()
    return { bottom: r ? Math.round(window.innerHeight - r.bottom) : null, width: r ? Math.round(r.width) : null, btns: [...d.querySelectorAll('button')].filter((b) => /^(Cancel|Save)$/.test(b.textContent.trim())).map((b) => Math.round(b.getBoundingClientRect().height)) }
  })
  check('phone: the spotlight picker is a bottom sheet with ≥ 40 px buttons (regression)', g.bottom <= 1 && g.width >= 388 && g.btns.length === 2 && g.btns.every((h) => h >= 40), JSON.stringify(g))
  await k.sleep(500); await p.shot('dashboard-phone-light-spotlight')
  await p.click('Cancel', { kind: 'button', within: '[role="dialog"]' })
  await p.click('Customize the actions', { within: 'main' }); await p.waitDialog(null, 5000)
  const g2 = await p.page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].pop(); const r = d?.firstElementChild?.getBoundingClientRect(); return { bottom: r ? Math.round(window.innerHeight - r.bottom) : null, width: r ? Math.round(r.width) : null } })
  check('phone: the quick-actions editor is a bottom sheet (regression)', g2.bottom <= 1 && g2.width >= 388, JSON.stringify(g2))
  await p.click('Cancel', { kind: 'button', within: '[role="dialog"]' })
  check('phone + light (screenshot)', !!(await p.shot('dashboard-phone-light')))

  // ---- the person's layout as it was -------------------------------------------------------------------------
  // the server keeps a layout once one is saved (it has no "forget it": a null layout is refused), so the default the
  // person had is put back through Reset layout + Save layout; a stored one goes back as it was
  if (layout0) await api.post('/settings/dashboard', { layout: layout0 })
  else {
    await a.go('dashboard')
    await a.click('Edit dashboard', { within: 'main' }); await a.waitText('Save layout', { within: 'main', ms: 5000 })
    await a.click('Reset layout', { within: 'main' })
    const rc = await a.confirmInfo()
    if (rc) await a.click(rc.buttons.find((b) => !/^cancel$/i.test(b)), { within: '[role="alertdialog"]' })
    await a.click('Save layout', { within: 'main' })
    await a.until(() => ![...document.querySelectorAll('main button')].some((b) => b.textContent.trim() === 'Save layout'), null, 8000)
  }
  await a.reload()
  await a.until(() => document.querySelectorAll('.dashboard-grid > div[style]').length > 10, null, 30000)
  const after = await cardsPos(a)
  check('the dashboard is put back as it was (every card where it was)', JSON.stringify(after) === JSON.stringify(before), JSON.stringify(Object.entries(after).filter(([kk, vv]) => before[kk] !== vv)).slice(0, 300))
}
