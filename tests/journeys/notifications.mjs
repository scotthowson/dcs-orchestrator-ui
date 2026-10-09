// Notifications: the guide, the presets, a throwaway rule (add, switch off and on, delete), the cooldown's
// validation, the history, a throwaway webhook to an address nothing answers (test → its error, delete), the
// links to Config (an admin's buttons, a viewer's plain words), a viewer's read-only page, the phone and the
// light look.

const DEAD_HOOK = 'http://127.0.0.1:9/'

export default async function notifications(k) {
  const { check } = k
  const stamp = Date.now().toString(36)
  const ruleName = `e2e-rule-${stamp}`
  const api = await k.apiAs(k.ADMIN)
  // leftovers of an earlier run that crashed half-way
  const leftover = await api.get('/notifications/rules')
  for (const r of leftover.data?.rules || []) if (/^e2e-rule-/.test(r.name)) await api.del(`/notifications/rules/${encodeURIComponent(r.id)}`)
  const lw = await api.get('/webhooks')
  for (const w of lw.data?.webhooks || []) if (w.url === DEAD_HOOK) await api.del(`/webhooks/${encodeURIComponent(w.id)}`)

  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('notifications') && (await a.h1()) === 'Notifications', await a.h1())

  // ---- the guide --------------------------------------------------------
  check('Guide opens the notification guide', await a.click('Guide', { within: 'main' }) && await a.waitText('Template variables', { within: 'main', ms: 8000 }))
  check('the guide\'s ✕ closes it', await a.click('Close the guide', { within: 'main' }) && await a.until(() => !document.querySelector('main')?.innerText.includes('Template variables'), null, 5000))

  // ---- Send test: ntfy is not set up in the lab ---------------------------
  const sendTest = await a.find('Send test', { within: 'main', kind: 'button' })
  const sendDisabled = sendTest ? await sendTest.evaluate((b) => b.disabled) : null
  check('Send test is off while ntfy is not set up (with the reason next to it)', sendDisabled === true && await a.hasText('ntfy is not configured', 'main'), `disabled ${sendDisabled}`)
  if (sendTest) await sendTest.dispose()

  // ---- a preset fills the form -------------------------------------------
  check('a preset opens the new-rule form', await a.click(/^Backup finished/, { within: 'main' }) && await a.waitDialog(/New notification rule/, 8000))
  check('…filled with the preset\'s name and tags', (await a.value('Rule name')) === 'Backup finished' && (await a.value('Tags')) === 'backup')
  await a.key('Escape')
  check('Escape closes the form', await a.waitNoDialog(5000))

  // ---- a throwaway rule ----------------------------------------------------
  check('Add rule opens an empty form', await a.click('Add rule', { within: 'main' }) && await a.waitDialog(/New notification rule/, 8000) && (await a.value('Rule name')) === '')
  const createBtn = () => a.find('Create rule', { kind: 'button' })
  let cb = await createBtn()
  check('Create rule is off while the name is empty', cb && await cb.evaluate((b) => b.disabled))
  await cb?.dispose()
  await a.type('Rule name', ruleName)
  await a.type('Target', 'e2e-target')
  await a.click('high', { kind: 'button' })
  check('a priority is picked as a radio', await a.until(() => [...document.querySelectorAll('[role="dialog"] [role="radio"]')].some((r) => r.getAttribute('aria-checked') === 'true' && /high/i.test(r.textContent)), null, 3000))
  await a.type('Tags', 'e2e, throwaway')
  // a cooldown the server cannot use is said, not dropped
  await a.type('Repeat at most every', '-5')
  const cdMsg = await a.waitText(/whole number of minutes/i, { within: '[role="dialog"]', ms: 3000 })
  cb = await createBtn()
  const offOnBad = cb && await cb.evaluate((b) => b.disabled)
  await cb?.dispose()
  check('a negative cooldown is refused with a message (regression: it was dropped silently)', cdMsg && offOnBad, `message ${cdMsg}, Create off ${offOnBad}`)
  await a.type('Repeat at most every', '15')
  check('…and a whole number is accepted', await a.until(() => ![...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.includes('Create rule'))?.disabled, null, 3000))
  await a.type('Title', 'e2e {container}')
  // the variable chips insert into the message body
  const chip = await a.find(/^\{container\}$/, { kind: 'button' })
  if (chip) { await chip.click(); await chip.dispose() }
  const body = await a.page.evaluate(() => document.querySelector('[role="dialog"] textarea')?.value || '')
  check('a variable chip inserts into the message body', body.includes('{container}'), body)
  check('Create rule creates it', await a.click('Create rule', { kind: 'button' }) && await a.waitToast(`Rule "${ruleName}" created`, 15000) && await a.waitNoDialog(8000))
  check('the new rule is listed with its target and tags', await a.waitText(ruleName, { within: 'main', ms: 15000 }) && await a.hasText('e2e-target', 'main') && await a.hasText('throwaway', 'main'))
  const saved = (await api.get('/notifications/rules')).data?.rules?.find((r) => r.name === ruleName)
  check('the server keeps what was typed (priority, target, tags, cooldown)', saved && saved.priority === 'high' && saved.target === 'e2e-target' && saved.cooldown_minutes === 15 && saved.tags?.includes('throwaway'), JSON.stringify(saved))

  // switch it off and on
  const sw = await a.find(`Rule ${ruleName} enabled`, { kind: 'switch' })
  check('the rule has its own switch', !!sw)
  if (sw) {
    await sw.click(); await sw.dispose()
    check('switching it off says so and keeps it', await a.waitToast(`Rule "${ruleName}" disabled`, 15000))
    const off = (await api.get('/notifications/rules')).data?.rules?.find((r) => r.name === ruleName)
    check('…the server has it off', off && off.enabled === false, JSON.stringify(off?.enabled))
    const sw2 = await a.find(`Rule ${ruleName} enabled`, { kind: 'switch' })
    if (sw2) { await sw2.click(); await sw2.dispose() }
    check('switching it on again', await a.waitToast(`Rule "${ruleName}" enabled`, 15000))
  }
  await a.reload()
  check('the rule is still there after a reload', await a.waitText(ruleName, { within: 'main', ms: 15000 }))

  // delete: asks first, Cancel keeps it
  await a.click(`Delete rule ${ruleName}`, { within: 'main' })
  const conf = await a.confirmInfo()
  check('Delete rule asks first (a question, the verb, rose)', conf && /\?$/.test(conf.title) && conf.buttons.includes('Delete rule') && conf.danger, JSON.stringify(conf))
  await a.click('Cancel', { within: '[role="alertdialog"]' })
  check('Cancel keeps the rule', await a.waitNoDialog(5000) && await a.hasText(ruleName, 'main'))
  await a.click(`Delete rule ${ruleName}`, { within: 'main' })
  await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000)
  await a.click('Delete rule', { within: '[role="alertdialog"]' })
  check('confirming deletes the rule', await a.waitToast('Notification rule deleted', 15000) && await a.until((n) => !document.querySelector('main').innerText.includes(n), ruleName, 10000))

  // ---- the history ---------------------------------------------------------
  const hist = await a.find(/^Notification history/i, { within: 'main', kind: 'button' })
  const histOpen0 = hist ? await hist.evaluate((b) => b.getAttribute('aria-expanded')) : null
  if (hist) { await hist.click(); await hist.dispose() }
  check('the history section folds and unfolds', await a.until((was) => {
    const b = [...document.querySelectorAll('main button')].find((x) => /notification history/i.test(x.textContent))
    return b && b.getAttribute('aria-expanded') !== was
  }, histOpen0, 5000))
  await a.click(/^Notification history/i, { within: 'main', kind: 'button' })

  // ---- a throwaway webhook ---------------------------------------------------
  const whBtn = await a.find(/^Webhooks/i, { within: 'main', kind: 'button' })
  if (whBtn && await whBtn.evaluate((b) => b.getAttribute('aria-expanded') !== 'true')) await whBtn.click()
  await whBtn?.dispose()
  check('Add webhook opens the form', await a.click('Add webhook', { within: 'main' }) && !!(await a.field('Webhook URL', 'main')))
  let cw = await a.find('Create webhook', { within: 'main', kind: 'button' })
  check('Create webhook is off while the address is empty', cw && await cw.evaluate((b) => b.disabled))
  await cw?.dispose()
  await a.type('Webhook URL', 'not a url', 'main')
  const badMsg = await a.waitText(/http:\/\/ or https:\/\//i, { within: 'main', ms: 3000 })
  cw = await a.find('Create webhook', { within: 'main', kind: 'button' })
  const cwOff = cw && await cw.evaluate((b) => b.disabled)
  await cw?.dispose()
  check('an address that is not a web address is refused with a message (regression)', badMsg && cwOff, `message ${badMsg}, Create off ${cwOff}`)
  await a.type('Webhook URL', DEAD_HOOK, 'main')
  check('the event presets: None selects nothing', await a.click('None', { within: 'main' }) && await a.waitText('0 selected', { within: 'main', ms: 3000 }))
  check('All selects every event', await a.click('All', { within: 'main' }) && await a.until(() => !/· 0 selected/.test(document.querySelector('main').innerText), null, 3000))
  check('Essentials goes back to the default set', await a.click('Essentials', { within: 'main' }))
  // the server refuses an address on this machine (and one it cannot resolve), so the lab cannot keep a webhook: the
  // refusal must reach the person with its reason (regression: it was a bare "Failed to create webhook")
  await a.click('Create webhook', { within: 'main' })
  const refused = await a.waitToast(/Webhook not created: .*(blocked|private|internal)/i, 15000)
  check('Create webhook to 127.0.0.1:9 shows the server\'s refusal and its reason (regression)', refused, JSON.stringify(await a.toasts()))
  const kept = (await api.get('/webhooks')).data?.webhooks?.some((w) => w.url === DEAD_HOOK)
  check('…and nothing was kept', !kept)
  check('the form stays open with the address, to correct it', (await a.value('Webhook URL', 'main')) === DEAD_HOOK)
  check('Cancel closes the webhook form', await a.click('Cancel', { within: 'main' }) && await a.until(() => !document.querySelector('#webhook-url'), null, 5000))
  k.j.note('webhook Test and Delete: not reachable in the lab (the server refuses every private or unresolvable address, the only kind a test may use)')

  // ---- the link to Config, for an admin --------------------------------------
  check('an admin\'s "Config → Notifications" opens Config', await a.click('Config → Notifications', { within: 'main' }) && await a.until(() => document.querySelector('main h1')?.textContent === 'Config', null, 15000), await a.h1())

  // ---- a viewer -------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('the page opens for a viewer', await v.go('notifications') && (await v.h1()) === 'Notifications', await v.h1())
  const vControls = await v.page.evaluate(() => [...document.querySelectorAll('main button, main [role="switch"]')].filter((e) => e.getClientRects().length).map((e) => (e.getAttribute('aria-label') || e.innerText).trim()))
  const offered = vControls.filter((n) => /^(Add rule|Send test|Create first rule|Add webhook|Delete|Test$)|^Rule .* enabled$/.test(n))
  check('a viewer is offered no admin action (add rule, send test, add/test/delete webhook)', !offered.length, JSON.stringify(offered))
  check('a viewer is not offered the presets as buttons', !vControls.some((n) => /^Container health alert/.test(n)), JSON.stringify(vControls.slice(0, 12)))
  const linkKind = await v.page.evaluate(() => [...document.querySelectorAll('main *')].filter((e) => e.children.length === 0 && e.textContent.trim() === 'Config → Notifications').map((e) => e.tagName))
  check('a viewer\'s "Config → Notifications" is plain text, not a link (regression)', linkKind.length > 0 && !linkKind.includes('BUTTON'), JSON.stringify(linkKind))
  check('a viewer can fold the history open', await v.click(/^Notification history/i, { within: 'main', kind: 'button' }))
  check('a viewer can open the webhooks list (read-only)', await v.click(/^Webhooks/i, { within: 'main', kind: 'button' }))

  // ---- phone + light ---------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('notifications')
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.click('Add rule', { within: 'main' })
  await p.waitDialog(/New notification rule/, 8000)
  const sheet = await p.page.evaluate(() => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop()
    const panel = d?.firstElementChild
    const r = panel?.getBoundingClientRect()
    const btns = [...(d?.querySelectorAll('button') || [])].filter((b) => /^(Cancel|Create rule)$/.test(b.textContent.trim())).map((b) => b.getBoundingClientRect().height)
    return { bottom: r ? Math.round(window.innerHeight - r.bottom) : null, width: r ? Math.round(r.width) : null, btns }
  })
  check('phone: the new-rule form is a bottom sheet with ≥ 40 px buttons', sheet.bottom !== null && sheet.bottom <= 1 && sheet.width >= 388 && sheet.btns.length === 2 && sheet.btns.every((h) => h >= 40), JSON.stringify(sheet))
  await k.sleep(700)
  check('phone: the light look of the sheet (screenshot)', !!(await p.shot('notifications-phone-light-rule-sheet')))
  await p.click('Cancel', { kind: 'button' })
  check('phone: Cancel closes the sheet', await p.waitNoDialog(5000))
  check('light: the page (screenshot)', !!(await p.shot('notifications-phone-light')))
}
