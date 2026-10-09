// Stacks: the list (search, the status filter, the sort, the More menu with Stop all / Batch mode / Lint all, the
// batch bar, each card's actions, the delete dialog, New stack on the hub and on its own VM, a throwaway stack created
// and deleted again) and a stack's detail (Start / Stop / Restart / Update asking first, the compose viewer, Clone,
// Rename, the Containers / Services / Logs views, a container row's own actions, Back and Escape). The lab's docker
// refuses every change, so a confirmed action shows its error path. A viewer, a phone and the light look.

const STACK = 'monitoring-management'      // running, 2 of its 3 containers up: "Partly down"
const STOPPED = 'media-services'
const ASLEEP = 'development-tools'

/** the text of the dialog on top (the notification drawer is a dialog too, kept in the page) */
const dlg = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]'))
  return d.length ? d[d.length - 1].innerText : ''
})

export default async function stacks(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  const writes = (from) => a.requests.slice(from).filter((r) => r.method !== 'GET' && !/^\/(auth|settings\/profile|chat)/.test(r.path)).map((r) => `${r.method} ${r.path}`)
  const cards = () => a.page.evaluate(() => [...document.querySelectorAll('main [data-stack-open]')].map((b) => b.getAttribute('data-stack-open')))
  const name = `e2e-sf-${Date.now().toString(36)}`
  const api = await k.apiAs(k.ADMIN)

  try {
    check('Stacks opens', await a.go('stacks') && (await a.h1()) === 'Stacks', await a.h1())
    await a.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
    const head = await a.text('main header, main')
    check('the header counts the stacks (no NaN / undefined)', /\d+ running/.test(head) && /\d+ total/.test(head) && !/NaN|undefined/.test(head), head.slice(0, 200))
    const all = await cards()
    check('every stack of the server has a card', [STACK, STOPPED, ASLEEP, 'networking-security'].every((s) => all.includes(s)), JSON.stringify(all))

    // ---- a partly-down stack reads the same on its card and in its detail ------------------------------------
    const chip = await a.page.evaluate((s) => document.querySelector(`main [data-stack-open="${s}"]`)?.closest('.surface')?.innerText || '', STACK)
    check('a running stack with a stopped container reads "Partly down" on its card (as in its detail)', /Partly down/.test(chip), chip.slice(0, 160))

    // ---- search ------------------------------------------------------------------------------------------------
    await a.type('Search stacks', 'monitoring')
    check('search by name narrows the cards', await a.until((s) => { const c = [...document.querySelectorAll('main [data-stack-open]')].map((b) => b.getAttribute('data-stack-open')); return c.length === 1 && c[0] === s }, STACK, 5000), JSON.stringify(await cards()))
    await a.type('Search stacks', 'dashdot')
    check('search by a container\'s name finds its stack', await a.until((s) => [...document.querySelectorAll('main [data-stack-open]')].map((b) => b.getAttribute('data-stack-open')).includes(s), STACK, 5000), JSON.stringify(await cards()))
    await a.type('Search stacks', 'zzz-no-such-stack')
    check('a search with no match shows the empty state', await a.waitText('No stacks match your filters', { within: 'main', ms: 5000 }))
    check('the empty state offers "Clear the filters"', await a.click('Clear the filters', { within: 'main', ms: 3000 }) && await a.until(() => document.querySelectorAll('main [data-stack-open]').length >= 4, null, 5000))
    check('…which empties the search field', (await a.value('Search stacks')) === '')
    await a.type('Search stacks', 'zzz')
    check('the search field\'s ✕ clears it', await a.click('Clear the search', { within: 'main', ms: 3000 }) && (await a.value('Search stacks')) === '')

    // ---- the status filter --------------------------------------------------------------------------------------
    for (const [seg, want, not] of [['Running', STACK, STOPPED], ['Stopped', STOPPED, STACK], ['Asleep', ASLEEP, STACK]]) {
      await a.click(seg, { within: 'main [aria-label="Show"], main' })
      const ok = await a.until(({ want, not }) => { const c = [...document.querySelectorAll('main [data-stack-open]')].map((b) => b.getAttribute('data-stack-open')); return c.includes(want) && !c.includes(not) }, { want, not }, 5000)
      check(`the filter "${seg}" shows ${want} and not ${not}`, ok, JSON.stringify(await cards()))
    }
    await a.click('All', { within: 'main' })
    check('the filter "All" shows every stack again', await a.until(() => document.querySelectorAll('main [data-stack-open]').length >= 4, null, 5000))

    // ---- the sort -----------------------------------------------------------------------------------------------
    await a.click('Name', { within: 'main' })
    const byName = await a.until(() => { const c = [...document.querySelectorAll('main [data-stack-open]')].map((b) => b.getAttribute('data-stack-open')); return c.length >= 4 && c.join() === [...c].sort().join() ? c : false }, null, 5000)
    check('sort by Name orders the cards alphabetically', !!byName, JSON.stringify(await cards()))
    await a.click('Containers', { within: 'main' }); await k.sleep(400)
    const byCount = await cards()
    check('sort by Containers puts the busiest stack first', byCount[0] === 'networking-security', JSON.stringify(byCount))
    await a.click('Status', { within: 'main' }); await k.sleep(400)
    const byStatus = await cards()
    check('sort by Status puts the stopped stack last', byStatus[byStatus.length - 1] === STOPPED, JSON.stringify(byStatus))
    await a.click('Priority', { within: 'main' })

    // ---- the More menu ------------------------------------------------------------------------------------------
    check('More opens its menu', await a.click('More actions', { within: 'main' }) && await a.until(() => !!document.querySelector('[role="menu"]'), null, 5000))
    const items = await a.page.evaluate(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.innerText.trim()))
    check('the menu offers Start all, Stop all, Batch mode and Lint all', ['Start all', 'Stop all', 'Batch mode', 'Lint all'].every((w) => items.some((i) => i.startsWith(w))), JSON.stringify(items))
    await a.key('Escape')
    check('Escape closes the menu', await a.until(() => !document.querySelector('[role="menu"]'), null, 3000))
    let w0 = a.requests.length
    await a.click('More actions', { within: 'main' }); await a.click(/^Stop all/, { within: '[role="menu"]' })
    let c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('Stop all asks first, as a danger question', c && /\?$/.test(c.title) && c.danger && c.buttons.includes('Stop all'), JSON.stringify(c))
    check('…with the focus on Cancel', c && c.focused === 'Cancel', c?.focused)
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('Cancel leaves every stack running (nothing sent)', await a.waitNoDialog(5000) && !writes(w0).length, writes(w0).join())

    await a.click('More actions', { within: 'main' }); await a.click(/^Lint all/, { within: '[role="menu"]' })
    check('Lint all opens the lint results', await a.waitDialog('Compose lint results', 20000))
    const lint = await dlg(a)
    check('…with a line for every stack', all.every((s) => lint.includes(s)) && !/NaN|undefined/.test(lint), lint.slice(0, 300))
    await a.key('Escape')
    check('Escape closes the lint results', await a.waitNoDialog(5000))

    // ---- batch mode --------------------------------------------------------------------------------------------
    await a.click('More actions', { within: 'main' }); await a.click('Batch mode', { within: '[role="menu"]' })
    check('Batch mode turns on (its notice shows)', await a.waitText('Batch mode is on', { within: 'main', ms: 5000 }))
    check('a card in batch mode is a checkbox', await a.click(`Select ${STACK}`, { within: 'main' }) && await a.until((s) => document.querySelector(`main [aria-label="Select ${s}"]`)?.getAttribute('aria-checked') === 'true', STACK, 3000))
    check('the batch bar appears with the count', await a.waitText('1 stack selected', { ms: 5000 }))
    w0 = a.requests.length
    await a.click('Stop selected', { within: '[role="toolbar"]' })
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('Stop selected asks first, as a danger question', c && /\?$/.test(c.title) && c.danger && c.buttons.some((b) => /^Stop stack/.test(b)), JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' }); await a.waitNoDialog(5000)
    check('…and Cancel sends nothing', !writes(w0).length, writes(w0).join())
    await a.click('Select all', { within: '[role="toolbar"]' })
    check('Select all selects every stack', await a.waitText(`${all.length} stacks selected`, { ms: 5000 }))
    await a.click('Clear', { within: '[role="toolbar"]' })
    check('Clear empties the selection (the bar goes)', await a.until(() => !document.querySelector('[role="toolbar"][aria-label="Batch actions"]'), null, 5000))
    // a batch the server refuses: the progress dialog shows the failure and Done closes it
    await a.click(`Select ${STOPPED}`, { within: 'main' })
    await a.click('Start selected', { within: '[role="toolbar"]' })
    check('Start selected shows the batch progress', await a.waitDialog('Batch operation', 10000))
    const done = await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /succeeded, \d+ failed/.test(d.innerText)), null, 90000)
    const prog = await dlg(a)
    check('…which ends with a result per stack (no NaN / undefined, no "stoped")', done && prog.includes(STOPPED) && !/NaN|undefined|stoped/.test(prog), prog.slice(0, 300))
    await a.click('Done', { within: '[role="dialog"]' })
    check('Done closes it and leaves batch mode', await a.waitNoDialog(5000) && !(await a.hasText('Batch mode is on', 'main')))

    // ---- a card's own actions --------------------------------------------------------------------------------
    w0 = a.requests.length
    await a.click(`Stop ${STACK}`, { within: 'main' })
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('a card\'s Stop asks first, as a danger question', c && c.title === `Stop ${STACK}?` && c.danger && c.buttons.includes('Stop stack'), JSON.stringify(c))
    await a.key('Escape')
    check('Escape cancels it (nothing sent)', await a.waitNoDialog(5000) && !writes(w0).length, writes(w0).join())
    await a.click(`Restart ${STACK}`, { within: 'main' })
    check('a card\'s Restart reaches the server and says how it ended (the lab refuses it)', await a.waitToast(/restart/i, 60000), JSON.stringify(await a.toasts()))
    check('the copy button beside a stack\'s name copies it (feedback, no error)', await a.click('Copy the stack name', { within: 'main', dom: true }) && await a.until(() => !!document.querySelector('main [aria-label="Copied"]'), null, 3000))

    // ---- Edit, the delete dialog, Move into a VM ------------------------------------------------------------
    await a.click(`Edit ${STACK}`, { within: 'main' })
    check('Edit opens the stack\'s editor', await a.waitDialog('Monitoring Management', 15000) && await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /services:/.test(d.innerText)), null, 15000), JSON.stringify(await a.dialogs()).slice(0, 200))
    await a.key('Escape')
    check('Escape closes the editor', await a.waitNoDialog(8000))
    await a.click(`Delete ${STOPPED}`, { within: 'main' })
    const delTitle = await a.waitDialog(null, 8000)
    check('Delete opens a dialog whose title asks the question', delTitle === `Delete ${STOPPED}?`, delTitle)
    const delBtns = await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => ({ t: b.innerText.trim(), rose: /rose/.test(b.className) })))
    check('…its confirm button says the verb, in rose', delBtns.some((b) => b.t === 'Delete stack' && b.rose), JSON.stringify(delBtns))
    await a.click('Cancel', { within: '[role="dialog"]' })
    check('Cancel closes it and keeps the stack', await a.waitNoDialog(5000) && (await cards()).includes(STOPPED))
    await a.click(`Move ${STACK} into a VM`, { within: 'main' })
    check('"To a VM" opens the sheet that moves that stack into a VM', await a.waitDialog(`Move ${STACK} into its own VM`, 10000))
    await a.key('Escape'); await a.waitNoDialog(5000)

    // ---- New stack: in its own VM, on the hub (validation, a throwaway one created and deleted) --------------
    await a.click('New stack', { within: 'main header, main', kind: 'button' })
    const newItems = await a.until(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.innerText.split('\n')[0].trim()), null, 5000)
    check('New stack offers "In its own VM" and "On the hub"', newItems && newItems.includes('In its own VM') && newItems.includes('On the hub'), JSON.stringify(newItems))
    await a.click(/^In its own VM/, { within: '[role="menu"]' })
    check('"In its own VM" opens the New VM sheet', await a.waitDialog('A stack in its own VM', 10000))
    await a.key('Escape'); await a.waitNoDialog(5000)
    await a.click('New stack', { within: 'main header, main', kind: 'button' }); await a.click(/^On the hub/, { within: '[role="menu"]' })
    check('"On the hub" opens Create stack', await a.waitDialog('Create stack', 10000))
    const createBtn = () => a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.innerText.trim() === 'Create stack')?.disabled)
    check('Create stack is disabled without a name', await createBtn() === true)
    await a.type('Stack name', 'My Stack!')
    check('a name is turned into a valid one and shown ("Created as my-stack")', await a.waitText('Created as my-stack', { within: '[role="dialog"]', ms: 3000 }))
    await a.type('Stack name', STACK)
    await a.click('Create stack', { within: '[role="dialog"]', kind: 'button' })
    check('a name that is taken is refused, in the dialog', await a.until(() => !!document.querySelector('[role="dialog"] [role="alert"]'), null, 15000), await a.text('[role="dialog"]'))
    await a.type('Stack name', name)
    w0 = a.requests.length
    await a.click('Create stack', { within: '[role="dialog"]', kind: 'button' })
    check('a new name creates the stack and closes the dialog', await a.waitNoDialog(20000) && writes(w0).some((x) => x === 'POST /stacks'), writes(w0).join())
    check('…and its card appears', await a.until((n) => !!document.querySelector(`main [data-stack-open="${n}"]`), name, 20000))
    await a.click(`Delete ${name}`, { within: 'main' }); await a.waitDialog(`Delete ${name}?`, 8000)
    await a.click('Delete stack', { within: '[role="dialog"]' })
    check('Delete stack removes it (dialog closes, card gone)', await a.waitNoDialog(20000) && await a.until((n) => !document.querySelector(`main [data-stack-open="${n}"]`), name, 20000))
    check('…and the server no longer lists it', !(await api.get('/stacks')).data.stacks.some((s) => s.name === name))

    // ---- a stack's detail ---------------------------------------------------------------------------------
    await a.click(`Open Monitoring Management`, { within: 'main' })
    check('a card opens the stack\'s detail', await a.until(() => document.querySelector('main h1:not(.sr-only)')?.textContent === 'Monitoring Management' || [...document.querySelectorAll('main h1')].some((h) => h.textContent === 'Monitoring Management'), null, 15000))
    await a.waitText('dashdot', { within: 'main', ms: 15000 })
    const det = await a.text('main')
    check('the detail says "Partly down" and counts the containers', /Partly down/.test(det) && /2 running · 1 stopped/.test(det), det.slice(0, 300))
    for (const [btn, title, label, danger] of [['Stop', `Stop ${STACK}?`, 'Stop stack', true], ['Restart', `Restart ${STACK}?`, 'Restart stack', false], ['Update', `Update ${STACK}?`, 'Update stack', false]]) {
      w0 = a.requests.length
      await a.click(btn, { within: 'main', kind: 'button' })
      const ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
      check(`${btn} asks "${title}" (a question, confirm "${label}"${danger ? ', danger' : ''})`, ci && ci.title === title && ci.buttons.includes(label) && ci.danger === danger, JSON.stringify(ci))
      await a.click('Cancel', { within: '[role="alertdialog"]' })
      check(`…Cancel sends nothing (${btn})`, await a.waitNoDialog(5000) && !writes(w0).length, writes(w0).join())
    }
    check('Start is disabled on a running stack', await a.page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Start')?.disabled === true))
    // a container row
    w0 = a.requests.length
    await a.click('Stop dashdot', { within: 'main' })
    c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('a container row\'s Stop asks first, as a danger question', c && c.title === 'Stop dashdot?' && c.danger, JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' }); await a.waitNoDialog(5000)
    check('…Cancel sends nothing', !writes(w0).length, writes(w0).join())
    await a.click('Restart redis', { within: 'main' })
    check('a container row\'s Restart that the server refuses says so (a toast)', await a.waitToast(/Could not restart redis/, 30000), JSON.stringify(await a.toasts()))
    // the views
    await a.click('Services', { within: 'main' })
    check('the Services view lists the compose services', await a.waitText('uptime-kuma', { within: 'main', ms: 8000 }))
    await a.click('Logs', { within: 'main' })
    check('the Logs view reads the stack\'s logs', await a.waitText('Stack logs', { within: 'main', ms: 8000 }) && await a.until(() => !document.querySelector('main [aria-label="Stack logs"] .animate-spin'), null, 15000))
    check('the logs\' Refresh reads them again', await a.click('Refresh', { within: 'main' }))
    await a.click('Containers', { within: 'main' })
    // the compose viewer
    await a.click('Compose', { within: 'main', kind: 'button' })
    check('Compose opens the compose file', await a.waitDialog('Monitoring Management', 15000) && /docker-compose\.yml/.test(await dlg(a)))
    await a.key('Escape'); await a.waitNoDialog(5000)
    // Clone
    await a.click('Clone', { within: 'main', kind: 'button' })
    check('Clone opens its dialog', await a.waitDialog('Clone stack', 8000))
    check('Clone is disabled without a name', await a.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].filter((b) => /Clone/.test(b.innerText)).every((b) => b.disabled)))
    await a.click('Cancel', { within: '[role="dialog"]' })
    check('Cancel closes the clone dialog', await a.waitNoDialog(5000))
    // Rename
    await a.click('Rename the stack', { within: 'main' })
    check('Rename shows the name field', !!(await a.field('New name of the stack', 'main')))
    await a.click('Cancel the rename', { within: 'main' })
    check('Cancel the rename puts the title back', await a.until(() => !document.querySelector('main [aria-label="New name of the stack"]'), null, 3000))
    // a container's row opens the Containers page
    await a.click('dashdot', { within: 'main table', kind: 'button' })
    check('a container\'s name opens it on the Containers page', await a.until(() => JSON.parse(localStorage.getItem('app-settings') || '{}').lastPage === 'containers' && document.querySelector('main h1')?.textContent === 'dashdot', null, 15000), await a.h1())
    await a.go('stacks')
    await a.click('Open Monitoring Management', { within: 'main' }); await a.waitText('dashdot', { within: 'main', ms: 15000 })
    await a.page.evaluate(() => document.activeElement?.blur?.())
    await a.key('Escape')
    check('Escape goes back to the list', await a.until(() => document.querySelectorAll('main [data-stack-open]').length >= 4, null, 8000))
    await a.click('Open Media Services', { within: 'main' })
    await a.waitText('Stopped', { within: 'main', ms: 15000 })
    check('Back goes back to the list', await a.click('Back', { within: 'main' }) && await a.until(() => document.querySelectorAll('main [data-stack-open]').length >= 4, null, 8000))
  } finally {
    await api.post(`/stacks/${name}/delete`).catch(() => {})
    await api.logout().catch(() => {})
  }

  // ---- a viewer -----------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Stacks', await v.go('stacks') && (await v.h1()) === 'Stacks')
  await v.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
  const vNames = await v.page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => (b.getAttribute('aria-label') || b.innerText).trim()))
  const adminish = vNames.filter((n) => /^(New stack|Stop |Start |Restart |Update |Reload |Wake now |Edit |Delete |Move )/.test(n))
  check('a viewer is offered no stack action (start, stop, edit, delete, new)', !adminish.length, JSON.stringify(adminish))
  await v.click('More actions', { within: 'main' })
  const vItems = await v.until(() => [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((b) => b.innerText.trim()), null, 5000)
  check('a viewer\'s More menu has Lint all only', vItems && vItems.length === 1 && /^Lint all/.test(vItems[0]), JSON.stringify(vItems))
  await v.click(/^Lint all/, { within: '[role="menu"]' })
  check('a viewer can lint every stack', await v.waitDialog('Compose lint results', 20000))
  await v.key('Escape'); await v.waitNoDialog(5000)
  await v.click('Open Monitoring Management', { within: 'main' })
  await v.waitText('dashdot', { within: 'main', ms: 15000 })
  const vDet = await v.page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => (b.getAttribute('aria-label') || b.innerText).trim()))
  const vAdm = vDet.filter((n) => /^(Start|Stop|Restart|Update|Clone|Rename the stack|Stop dashdot|Restart dashdot)$/.test(n))
  check('a viewer\'s stack detail offers no action', !vAdm.length, JSON.stringify(vAdm))
  await v.click('Compose', { within: 'main', kind: 'button' })
  check('a viewer can read the compose file', await v.waitDialog('Monitoring Management', 15000) && /docker-compose\.yml/.test(await dlg(v)))
  const e0 = v.requests.length
  await v.key('Escape'); await v.waitNoDialog(5000); await v.settle()
  const detailKept = await v.exists('Logs', { within: 'main' })
  if (!detailKept) { await v.shot('stacks-viewer-escape'); k.j.note(`after Escape: ${v.requests.slice(e0).map((r) => r.path).join(', ')}; errors ${v.errors.join(' | ')}`) }
  check('Escape closes the compose viewer and leaves the stack\'s detail open', detailKept, `${await v.h1()} · ${(await v.text('main')).slice(0, 160)}`)
  if (!detailKept) { await v.click('Open Monitoring Management', { within: 'main' }); await v.waitText('dashdot', { within: 'main', ms: 30000 }) }
  const r0 = v.requests.length
  const pressedLogs = await v.click('Logs', { within: 'main' })
  const logsShown = await v.waitText('Stack logs', { within: 'main', ms: 45000 })
  if (!logsShown) await v.shot('stacks-viewer-logs-failed')
  check('a viewer can read the stack\'s logs', logsShown, `pressed ${pressedLogs}; asked ${v.requests.slice(r0).map((r) => r.path).join(', ')}; ${(await v.text('main')).slice(0, 200)}`)

  // ---- a phone ---------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('stacks')
  await p.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
  check('no sideways scroll on a phone (the list)', !(await p.overflow()), await p.overflow())
  await p.shot('stacks-phone-list')
  await p.click('New stack', { within: 'main header, main', kind: 'button' }); await p.click(/^On the hub/, { within: '[role="menu"]' })
  await p.waitDialog('Create stack', 10000)
  const pBtns = await p.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].filter((b) => /^(Cancel|Create stack)$/.test(b.innerText.trim())).map((b) => Math.round(b.getBoundingClientRect().height)))
  check('Create stack\'s buttons are thumb-sized on a phone (≥ 40 px)', pBtns.length === 2 && pBtns.every((h) => h >= 40), JSON.stringify(pBtns))
  await p.key('Escape'); await p.waitNoDialog(5000)
  await p.click('Open Monitoring Management', { within: 'main' })
  await p.waitText('dashdot', { within: 'main', ms: 15000 })
  check('no sideways scroll on a phone (a stack\'s detail)', !(await p.overflow()), await p.overflow())
  await p.shot('stacks-phone-detail')

  // ---- the light look --------------------------------------------------------------------------------------
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('stacks')
  await l.until(() => document.querySelectorAll('main [data-stack-open]').length > 0, null, 20000)
  check('Stacks in the light look (screenshot)', await l.page.evaluate(() => document.documentElement.classList.contains('light')), await l.shot('stacks-light'))
}
