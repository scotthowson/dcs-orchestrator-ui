// Automation. Rules: the guide, Refresh, the scope (Everywhere is a view: New rule asks for a server first), the New
// rule chooser, a throwaway timed rule (validation, create, the kind filters, edit and read back, run, pause, its runs,
// delete — asked first), the condition rule dialog (validation, cancelled). Server crontab (#/cronjobs): in this lab it
// is the real user crontab of the machine the lab runs on, so nothing is ever saved there: the views, the filter, the
// add form (validation, presets, Cancel), the raw editor (opened and closed), a row's copy and remove question
// (cancelled). A viewer reads the rules, filters them, switches the scope and is offered neither a change nor the crontab.

const MAIN = 'main'
const SCOPE = 'main [role="group"][aria-label="Show"]'
async function grantClipboard(k, t) { await t.ctx.overridePermissions(k.UI, ['clipboard-read', 'clipboard-write', 'clipboard-sanitized-write']).catch(() => {}) }
const conf = (t) => t.until(() => !!document.querySelector('[role="alertdialog"]'), null, 6000)
const submitDisabled = (t) => t.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button[type="submit"]')].pop()?.disabled)
const chip = (t, re) => t.page.evaluate((src) => [...document.querySelectorAll('main [role="group"][aria-label="Show the rules"] button')].find((b) => new RegExp(src).test(b.innerText.trim()))?.innerText.trim() || '', re.source)

export default async function automations(k) {
  const { check } = k
  const stamp = Date.now().toString(36)
  const NAME = `e2e-rule-${stamp}`
  const api = await k.apiAs(k.ADMIN)
  const mine = async () => ((await api.get('/schedules')).data?.schedules || []).filter((s) => s.name === NAME)

  const a = await k.open(k.ADMIN)
  await grantClipboard(k, a)
  try {
    check('admin: the page opens', await a.go('automations') && (await a.h1()) === 'Automation', await a.h1())
    await a.click('Rules', { within: MAIN, kind: 'tab' })
    check('admin: the Rules and Server crontab tabs are offered', await a.exists(/^Rules/, { within: MAIN, kind: 'tab' }) && await a.exists('Server crontab', { within: MAIN, kind: 'tab' }))
    check('admin: the tiles count the rules (no NaN)', await a.waitText(/RULES\s*\d+/, { within: MAIN, ms: 20000 }) && !/NaN|undefined/.test(await a.text(MAIN)))

    // guide, Refresh
    await a.click('Guide', { within: MAIN })
    check('admin: Guide opens the guide', await a.waitText('Automation guide', { within: MAIN, ms: 5000 }))
    await a.click('Close the guide', { within: MAIN })
    check('admin: the guide closes', await a.until(() => !document.querySelector('main section[aria-label="Automation guide"]'), null, 4000))
    let n0 = a.requests.length
    await a.click('Refresh', { within: MAIN })
    check('admin: Refresh reads the rules again', await (async () => { for (let i = 0; i < 40; i++) { if (a.requests.slice(n0).some((r) => /^\/(schedules|automations)$/.test(r.path))) return true; await k.sleep(200) } return false })())

    // Everywhere is a view
    const hasScope = !!(await a.until((s) => !!document.querySelector(`${s} button`), SCOPE, 10000))
    if (hasScope) {
      await a.click('Everywhere', { within: SCOPE })
      await a.click('New rule', { within: 'main header, main', kind: 'button' })
      check('admin: in Everywhere, New rule asks to pick a server first', await a.waitToast(/pick the hub or one VM/, 6000) && !(await a.dialogs()).some((d) => d.title === 'New rule'))
      await a.click('Hub', { within: SCOPE })
    }

    // the chooser
    await a.click('New rule', { within: MAIN, kind: 'button' })
    check('admin: New rule opens the chooser', await a.waitDialog('New rule', 6000))
    check('admin: …with At a time, When something happens and the cron variant', await a.exists(/^At a time/, { kind: 'button' }) && await a.exists(/^When something happens/, { kind: 'button' }) && await a.exists(/cron expression/, { kind: 'button' }))
    await a.key('Escape')
    check('admin: Escape closes the chooser', await a.waitNoDialog(4000))

    // the condition dialog: validation, Cancel
    await a.click('New rule', { within: MAIN, kind: 'button' }); await a.waitDialog('New rule', 6000)
    await a.click(/^When something happens/, { kind: 'button' })
    check('admin: "When something happens" opens the rule dialog', await a.waitDialog(/\S/, 6000) && !!(await a.field('Rule name')))
    check('admin: …its Create waits for a name', (await submitDisabled(a)) === true)
    await a.click('Cancel', { within: '[role="dialog"]' })
    check('admin: Cancel closes it', await a.waitNoDialog(4000))

    // ---- a throwaway timed rule ------------------------------------------------
    await a.click('New rule', { within: MAIN, kind: 'button' }); await a.waitDialog('New rule', 6000)
    await a.click(/^At a time/, { kind: 'button' })
    check('admin: "At a time" opens "New timed rule"', await a.waitDialog('New timed rule', 6000))
    check('admin: Create waits for a name', (await submitDisabled(a)) === true)
    await a.type('Name', NAME)
    const actionSel = await a.page.evaluate(() => document.querySelector('[role="dialog"] select[id$="-action"]')?.id)
    const whenSel = await a.page.evaluate(() => document.querySelector('[role="dialog"] select[id$="-schedule"]')?.id)
    await a.page.select(`[id="${actionSel}"]`, 'restart')
    // regression: a stack action without its stack used to be accepted (it fails at its first run)
    check('admin: a stack action asks for its stack before Create', (await submitDisabled(a)) === true && await a.waitText('Name the stack this runs on.', { within: '[role="dialog"]', ms: 2000 }))
    await a.page.select(`[id="${actionSel}"]`, 'health-check')
    await a.page.select(`[id="${whenSel}"]`, '@weekly')
    check('admin: a health check needs no target: Create is ready', (await submitDisabled(a)) === false)
    await a.click('Create', { within: '[role="dialog"]' })
    check('admin: Create makes the rule', await a.waitToast('Rule created', 15000) && await a.waitNoDialog(6000))
    check('admin: …and lists it', await a.waitText(NAME, { within: MAIN, ms: 10000 }))
    check('admin: the server has it (weekly health check)', (await mine())[0]?.schedule === '@weekly' && (await mine())[0]?.action === 'health-check', JSON.stringify(await mine()))

    // the kind filters
    await a.click(/^Timed/, { within: 'main [role="group"][aria-label="Show the rules"]' })
    check('admin: Timed shows it', await a.until((n) => document.querySelector('main').innerText.includes(n), NAME, 5000) && /^Timed\s*\d+$/.test(await chip(a, /^Timed/)))
    await a.click(/^When something happens/, { within: 'main [role="group"][aria-label="Show the rules"]' })
    check('admin: "When something happens" hides it (or says none wait)', await a.until((n) => !document.querySelector('main').innerText.includes(n), NAME, 5000))
    await a.click(/^All/, { within: 'main [role="group"][aria-label="Show the rules"]' })

    // edit, read back
    await a.click(`Edit ${NAME}`, { within: MAIN })
    check('admin: Edit opens "Edit timed rule" with its values', await a.waitDialog('Edit timed rule', 6000) && (await a.value('Name')) === NAME)
    const whenSel2 = await a.page.evaluate(() => document.querySelector('[role="dialog"] select[id$="-schedule"]')?.id)
    await a.page.select(`[id="${whenSel2}"]`, '@monthly')
    await a.click('Save', { within: '[role="dialog"]' })
    check('admin: Save keeps the change', await a.waitToast('Rule updated', 15000) && (await mine())[0]?.schedule === '@monthly', JSON.stringify(await mine()))
    await a.reload()
    check('admin: after a reload the rule reads "Every month"', await a.until((n) => { const li = [...document.querySelectorAll('main li')].find((x) => x.innerText.includes(n)); return li && /Every month/i.test(li.innerText) }, NAME, 15000))

    // run, its runs
    await a.click(`Run ${NAME} now`, { within: MAIN })
    check('admin: Run runs it now and says how it went', await a.waitToast(new RegExp(`${NAME}`), 30000), JSON.stringify(await a.toasts()))
    await a.click(`Show the runs of ${NAME}`, { within: MAIN })
    check('admin: its runs unfold', await a.until((n) => document.querySelector(`main button[aria-label="Hide the runs of ${n}"]`)?.getAttribute('aria-expanded') === 'true', NAME, 5000))
    await a.click(`Hide the runs of ${NAME}`, { within: MAIN })

    // pause (disable)
    await a.click(`Pause ${NAME}`, { within: MAIN })
    check('admin: Pause switches it off', await a.waitToast(`${NAME} paused`, 10000) && (await mine())[0]?.enabled === false)
    check('admin: …and the button turns into Resume', await a.until((n) => !!document.querySelector(`main button[aria-label="Resume ${n}"]`), NAME, 5000))

    // delete: asked first
    await a.click(`Delete ${NAME}`, { within: MAIN })
    const c = await conf(a) && await a.confirmInfo()
    check('admin: Delete asks first ("Delete this rule?", rose, Cancel focused)', c && c.title === 'Delete this rule?' && c.danger && c.focused === 'Cancel' && c.buttons.includes('Delete rule'), JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check('admin: Cancel keeps the rule', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && (await mine()).length === 1)
    await a.click(`Delete ${NAME}`, { within: MAIN }); await conf(a)
    await a.click('Delete rule', { within: '[role="alertdialog"]' })
    check('admin: Delete rule removes it', await a.waitToast('Rule deleted', 10000) && (await mine()).length === 0 && await a.until((n) => !document.querySelector('main').innerText.includes(n), NAME, 8000))

    // ---- the server crontab (#/cronjobs): never saved here --------------------
    await a.go('cronjobs')
    check('admin: #/cronjobs opens Automation on the Server crontab tab', (await a.h1()) === 'Automation' && await a.until(() => [...document.querySelectorAll('main [role="tab"][aria-selected="true"]')].some((e) => /crontab/i.test(e.textContent)), null, 20000),
      `${await a.h1()} / ${await a.page.evaluate(() => [...document.querySelectorAll('main [role="tab"][aria-selected="true"]')].map((e) => e.textContent).join())}`)
    check('admin: the subtitle says what the tab is', await a.waitText("The commands this server's crontab runs", { within: MAIN, ms: 5000 }))
    check('admin: the scope chips are not offered for the crontab (it is this server\'s)', !(await a.exists('Everywhere', { within: SCOPE })))
    await a.click(/^System cron/, { within: MAIN })
    check('admin: System cron shows the system\'s entries (or says there are none)', await a.until(() => [...document.querySelectorAll('main input[type="radio"]')].some((i) => i.checked && i.value === 'system'), null, 5000) && await a.waitText(/No cron entries found|SCHEDULE|Schedule/i, { within: MAIN, ms: 15000 }))
    await a.click(/^User crontab/, { within: MAIN })
    await a.type('Filter the entries', 'zz-nothing-like-this', 'main')
    check('admin: a filter with no match says so', await a.waitText('No entries match your filter', { within: MAIN, ms: 5000 }))
    await a.type('Filter the entries', '', 'main')

    // the add form: validation and presets, then Cancel (nothing is written to the machine's crontab)
    await a.click('Add entry', { within: MAIN, index: 0 })
    check('admin: Add entry opens the form', await a.waitText('New cron entry', { within: MAIN, ms: 4000 }))
    const addBtn = () => a.page.evaluate(() => [...document.querySelectorAll('main form button[type="submit"]')].find((b) => /Add entry/.test(b.innerText))?.disabled)
    check('admin: Add entry waits for a command', (await addBtn()) === true)
    await a.type('Command', '/bin/true # e2e, never saved', 'main')
    await a.type('Schedule', 'every day', 'main')
    // regression: a schedule crontab refuses used to be sent as it was
    check('admin: a malformed schedule is flagged and blocks Add entry', await a.waitText(/Five fields \(minute hour day month weekday\)/, { within: MAIN, ms: 3000 }) && (await addBtn()) === true)
    const preset = await a.page.evaluate(() => [...document.querySelectorAll('main form button[aria-pressed]')].map((b) => b.innerText.trim())[0])
    if (preset) {
      await a.click(preset, { within: 'main form' })
      check('admin: a preset fills a valid schedule', await a.until(() => [...document.querySelectorAll('main form button[aria-pressed="true"]')].length === 1, null, 3000) && (await addBtn()) === false)
    }
    await a.click('Cancel', { within: 'main form' })
    check('admin: Cancel closes the form without saving', await a.until(() => !/New cron entry/.test(document.querySelector('main').innerText), null, 4000) && !a.requests.some((r) => r.method === 'POST' && r.path === '/system/crontab'))

    // the raw editor: opened, closed
    await a.click('Raw editor', { within: MAIN })
    check('admin: Raw editor opens with the crontab', await a.waitDialog('Raw crontab editor', 6000) && !!(await a.field('Contents of the user crontab')))
    await a.key('Escape')
    check('admin: Escape closes the raw editor (nothing saved)', await a.waitNoDialog(4000) && !a.requests.some((r) => r.method === 'POST' && r.path === '/system/crontab'))

    // a row: copy, remove question (cancelled)
    const removeBtn = await a.page.evaluate(() => document.querySelector('main button[aria-label^="Remove the entry "]')?.getAttribute('aria-label'))
    if (removeBtn) {
      const copyBtn = await a.page.evaluate(() => document.querySelector('main button[aria-label^="Copy the schedule "]')?.getAttribute('aria-label'))
      if (copyBtn) {
        await a.click(copyBtn, { within: MAIN })
        check('admin: a row\'s schedule copies', await a.until((s) => navigator.clipboard.readText().then((t) => t === s).catch(() => false), copyBtn.replace('Copy the schedule ', ''), 4000))
      }
      await a.click(removeBtn, { within: MAIN })
      const c2 = await conf(a) && await a.confirmInfo()
      check('admin: removing an entry asks first ("Remove this cron entry?")', c2 && c2.title === 'Remove this cron entry?', JSON.stringify(c2))
      await a.click('Cancel', { within: '[role="alertdialog"]' })
      check('admin: Cancel keeps the machine\'s crontab as it is', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && !a.requests.some((r) => r.method === 'POST' && r.path === '/system/crontab'))
    } else {
      check('admin: an empty crontab offers Add entry in its empty state', await a.hasText('No cron entries found', MAIN))
    }
    await a.click(/^Rules/, { within: MAIN, kind: 'tab' })
    await a.shot('automations-admin')
  } finally {
    for (const s of await mine()) await api.del(`/schedules/${encodeURIComponent(s.id)}`)
  }

  // ---- a viewer -------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('viewer: the page opens', await v.go('automations') && (await v.h1()) === 'Automation', await v.h1())
  check('viewer: no New rule, no crontab tab', !(await v.exists('New rule', { within: MAIN })) && !(await v.exists(/crontab/i, { within: MAIN, kind: 'tab' })))
  await v.click(/^Timed/, { within: 'main [role="group"][aria-label="Show the rules"]' })
  check('viewer: the kind filters work', await v.until(() => [...document.querySelectorAll('main [role="group"][aria-label="Show the rules"] button')].some((b) => /^Timed/.test(b.innerText.trim()) && b.getAttribute('aria-pressed') === 'true'), null, 4000))
  await v.click(/^All/, { within: 'main [role="group"][aria-label="Show the rules"]' })
  await v.click('Guide', { within: MAIN })
  check('viewer: the guide opens', await v.waitText('Automation guide', { within: MAIN, ms: 4000 }))
  await v.click('Close the guide', { within: MAIN })
  if (await v.exists('media-vm', { within: SCOPE })) {
    await v.click('media-vm', { within: SCOPE })
    check('viewer: the scope chips work', await v.until((s) => document.querySelector(`${s} button[aria-pressed="true"]`)?.innerText.includes('media-vm'), SCOPE, 5000))
    await v.click('Everywhere', { within: SCOPE })
  }
  await v.page.evaluate(() => { window.location.hash = '#/cronjobs' }); await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('viewer: #/cronjobs opens Automation without the crontab', (await v.h1()) === 'Automation' && !(await v.exists(/crontab/i, { within: MAIN, kind: 'tab' })) && !(await v.hasText("crontab runs", MAIN)))

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('automations'); await p.waitText(/RULES\s*\d+/, { within: MAIN, ms: 20000 })
  await p.click(/^Rules/, { within: MAIN, kind: 'tab' })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  if (await p.exists('Hub', { within: SCOPE })) await p.click('Hub', { within: SCOPE })
  await p.click('New rule', { within: MAIN, kind: 'button' })
  if (await p.waitDialog('New rule', 6000)) {
    await p.click(/^At a time/, { kind: 'button' })
    await p.waitDialog('New timed rule', 6000)
    const hs = await p.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] form button')].filter((b) => /Cancel|Create/.test(b.innerText)).map((b) => Math.round(b.getBoundingClientRect().height)))
    check('phone: the rule dialog\'s Cancel and Create are thumb-sized (≥ 40 px)', hs.length === 2 && hs.every((h) => h >= 40), JSON.stringify(hs))
    await p.shot('automations-phone-new')
    await p.key('Escape')
  } else check('phone: New rule opens', false)
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('automations'); await l.waitText(/RULES\s*\d+/, { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('automations-light')
}
