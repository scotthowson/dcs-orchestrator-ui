// Bookmarks (kept in this browser): add a page bookmark and a custom one, the form's validation and Cancel, pin and
// unpin, the filters, the search and its empty state, a bookmark opening its page, delete (asks first), a reload
// keeping them; a viewer's page works the same; the phone and the light look.

async function addBookmark(t, { type, label, target, notes, color }) {
  await t.click('Add bookmark', { within: 'main header, main', kind: 'button' })
  await t.until(() => !!document.querySelector('main form'), null, 5000)
  if (type) await t.click(type, { within: 'main form' })
  await t.type('Label', label, 'main form')
  if (target && type && type !== 'Page') await t.type(type === 'Stack' ? 'Stack name' : type === 'Container' ? 'Container name' : 'Reference', target, 'main form')
  if (target && (!type || type === 'Page')) {
    const sel = await t.page.$('main form select')
    await sel.select(target); await sel.dispose()
  }
  if (notes) await t.type('Notes', notes, 'main form')
  if (color) await t.click(color, { within: 'main form' })
  await t.click('Add bookmark', { within: 'main form', kind: 'button' })
  return t.until(() => !document.querySelector('main form'), null, 5000)
}

const cards = (t) => t.page.evaluate(() => [...document.querySelectorAll('main .grid > div')].map((c) => c.querySelector('h3')?.innerText.trim()))

export default async function bookmarks(k) {
  const { check } = k
  const s = Date.now().toString(36)
  const pageBm = `e2e health ${s}`
  const customBm = `e2e note ${s}`

  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('bookmarks') && (await a.h1()) === 'Bookmarks')
  check('with none, the empty state offers the first one', await a.hasText('No bookmarks yet', 'main') && await a.exists('Add your first bookmark', { within: 'main' }))

  // ---- the form: validation, Cancel --------------------------------------
  check('Add your first bookmark opens the form', await a.click('Add your first bookmark', { within: 'main' }) && await a.until(() => !!document.querySelector('main form'), null, 5000))
  const submit = await a.find('Add bookmark', { within: 'main form', kind: 'button' })
  check('Add bookmark (in the form) is off while the label is empty', submit && await submit.evaluate((b) => b.disabled))
  await submit?.dispose()
  await a.type('Label', '   ', 'main form')
  const sub2 = await a.find('Add bookmark', { within: 'main form', kind: 'button' })
  check('…and while it is only spaces', sub2 && await sub2.evaluate((b) => b.disabled))
  await sub2?.dispose()
  check('the colour picker is a radio group (one chosen)', await a.click('Violet', { within: 'main form' }) && await a.until(() => document.querySelector('main form [role="radio"][aria-label="Violet"]')?.getAttribute('aria-checked') === 'true', null, 3000))
  for (const [type, lbl] of [['Stack', 'Stack name'], ['Container', 'Container name'], ['Custom', 'Reference'], ['Page', 'Page']]) {
    await a.click(type, { within: 'main form' })
    check(`type ${type} asks for its ${lbl}`, type === 'Page' ? !!(await a.page.$('main form select')) : !!(await a.field(lbl, 'main form')))
  }
  check('Cancel (in the form) closes it', await a.click('Cancel', { within: 'main form', kind: 'button' }) && await a.until(() => !document.querySelector('main form'), null, 4000))
  check('the header button opens it, and turns into Cancel', await a.click('Add bookmark', { within: 'main', kind: 'button' }) && await a.until(() => !!document.querySelector('main form') && document.querySelector('main button[aria-expanded="true"]')?.textContent.trim() === 'Cancel', null, 4000))
  await a.page.evaluate(() => document.querySelector('main button[aria-expanded="true"]').click())
  check('…which closes it again', await a.until(() => !document.querySelector('main form'), null, 4000))

  // ---- add two ------------------------------------------------------------
  check('a page bookmark is added', await addBookmark(a, { type: 'Page', label: pageBm, target: 'health', notes: 'e2e notes', color: 'Cyan' }) && await a.waitText(pageBm, { within: 'main', ms: 5000 }))
  check('…with its target and notes', await a.hasText('health', 'main') && await a.hasText('e2e notes', 'main'))
  check('a custom bookmark is added', await addBookmark(a, { type: 'Custom', label: customBm, target: 'ticket-42' }) && await a.waitText(customBm, { within: 'main', ms: 5000 }))
  check('the count says 2 bookmarks', await a.waitText(/\b2\s*bookmarks/, { within: 'main', ms: 3000 }))
  const customIsButton = await a.page.evaluate((n) => [...document.querySelectorAll('main .grid > div')].find((c) => c.innerText.includes(n))?.querySelector('h3 button') !== null, customBm)
  check('a custom bookmark (it leads nowhere) is not drawn as a button (regression)', customIsButton === false)

  // ---- pin ------------------------------------------------------------------
  check(`Pin ${pageBm}`, await a.click(`Pin ${pageBm}`, { within: 'main' }) && await a.until((n) => document.querySelector(`main [aria-label="Unpin ${n}"]`)?.getAttribute('aria-pressed') === 'true', pageBm, 4000))
  const order = await cards(a)
  check('a pinned bookmark goes first', order[0] === pageBm, JSON.stringify(order))
  check('the count says 1 pinned', await a.waitText(/\b1\s*pinned/, { within: 'main', ms: 3000 }))

  // ---- filters and search ------------------------------------------------------
  for (const [f, want] of [['Pinned', [pageBm]], ['Page', [pageBm]], ['Custom', [customBm]], ['Stack', []], ['Container', []], ['All', [pageBm, customBm]]]) {
    await a.click(f, { within: 'main [aria-label="Show"]' })
    await k.sleep(300)
    const shown = await cards(a)
    const ok = want.length ? want.every((w) => shown.includes(w)) && shown.length === want.length : await a.hasText('No matches', 'main')
    check(`filter ${f} shows ${want.length ? want.length : 'none (No matches)'}`, ok, JSON.stringify(shown))
  }
  await a.type('Search bookmarks', 'ticket-42', 'main')
  await k.sleep(300)
  check('the search finds by target', JSON.stringify(await cards(a)) === JSON.stringify([customBm]), JSON.stringify(await cards(a)))
  await a.type('Search bookmarks', 'zzz-nothing-like-this', 'main')
  check('a search with no match: the empty state in the kit\'s words', await a.waitText('No matches', { within: 'main', ms: 3000 }) && await a.hasText('Try another search or filter.', 'main'))
  check('its action is named "Clear the filters" (kit wording, regression) and clears them', await a.click('Clear the filters', { within: 'main' }) && await a.until(() => document.querySelectorAll('main .grid > div').length === 2, null, 3000) && (await a.value('Search bookmarks', 'main')) === '')
  await a.type('Search bookmarks', 'zzz', 'main')
  check('the search\'s ✕ clears it', await a.click(/^Clear/, { within: 'main .relative' }) && await a.until(() => document.querySelectorAll('main .grid > div').length === 2, null, 3000))

  // ---- a reload keeps them; a bookmark opens its page ----------------------
  await a.reload()
  check('a reload keeps both (this browser)', (await cards(a)).length === 2)
  check('the page bookmark opens its page', await a.click(pageBm, { within: 'main' }) && await a.until(() => document.querySelector('main h1')?.textContent === 'Health', null, 15000), await a.h1())
  await a.go('bookmarks')

  // ---- unpin, delete ---------------------------------------------------------
  check(`Unpin ${pageBm}`, await a.click(`Unpin ${pageBm}`, { within: 'main' }) && await a.until((n) => !!document.querySelector(`main [aria-label="Pin ${n}"]`), pageBm, 4000))
  for (const n of [pageBm, customBm]) {
    await a.click(`Delete ${n}`, { within: 'main' })
    const c = await a.confirmInfo()
    check(`Delete ${n.split(' ')[1]} asks first (question, verb, rose)`, c && /\?$/.test(c.title) && c.buttons.includes('Delete bookmark') && c.danger, JSON.stringify(c))
    if (n === pageBm) {
      await a.key('Escape')
      check('Escape keeps it', await a.waitNoDialog(4000) && await a.hasText(n, 'main'))
      await a.click(`Delete ${n}`, { within: 'main' })
      await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000)
    }
    await a.click('Delete bookmark', { within: '[role="alertdialog"]' })
    check(`confirming deletes ${n.split(' ')[1]}`, await a.until((n) => !document.querySelector('main').innerText.includes(n), n, 5000))
  }
  check('with none left, the empty state is back', await a.waitText('No bookmarks yet', { within: 'main', ms: 3000 }))
  k.j.note('there is no "edit" for a bookmark: the page offers add, pin, delete only')

  // ---- a viewer: the page is theirs (this browser) ----------------------------
  const v = await k.open(k.VIEWER)
  check('the page opens for a viewer', await v.go('bookmarks') && (await v.h1()) === 'Bookmarks')
  check('a viewer adds a bookmark', await addBookmark(v, { type: 'Page', label: pageBm, target: 'stacks' }) && await v.waitText(pageBm, { within: 'main', ms: 5000 }))
  await v.click(`Delete ${pageBm}`, { within: 'main' }); await v.until(() => !!document.querySelector('[role="alertdialog"]'), null, 4000)
  await v.click('Delete bookmark', { within: '[role="alertdialog"]' })
  check('…and deletes it', await v.until((n) => !document.querySelector('main').innerText.includes(n), pageBm, 5000))

  // ---- phone + light -----------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('bookmarks')
  await addBookmark(p, { type: 'Custom', label: customBm, target: 'phone' })
  await p.click('Add bookmark', { within: 'main', kind: 'button' })
  check('phone: no sideways scroll (form open, a card listed)', !(await p.overflow()), await p.overflow())
  const actions = await p.page.evaluate((n) => [...document.querySelectorAll(`main [aria-label="Pin ${n}"], main [aria-label="Delete ${n}"]`)].map((b) => ({ vis: getComputedStyle(b).opacity, h: b.getBoundingClientRect().height })), customBm)
  check('phone: a card\'s pin and delete are there without hover', actions.length === 2 && actions.every((x) => Number(x.vis) > 0.5), JSON.stringify(actions))
  check('phone + light (screenshot)', !!(await p.shot('bookmarks-phone-light')))
}
