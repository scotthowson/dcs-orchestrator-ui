// Disk Analysis: the tiles and the storage meter, the mounted drives (rename: Cancel, Escape, Save, Enter, read back
// after a reload, then the name taken off again), Deep prune (asks first — never confirmed), Refresh, a viewer (no
// Deep prune; renaming a drive is a personal label), the phone and the light look.

const MOUNT = '/mnt/linux_drive'
const driveNames = (t) => t.page.evaluate(() => [...document.querySelectorAll('main [aria-label^="Rename the drive "]')].map((b) => b.getAttribute('aria-label').slice('Rename the drive '.length)))
const loaded = (t, ms = 30000) => t.until(() => document.querySelectorAll('main [aria-label^="Rename the drive "]').length > 0, null, ms)

export default async function diskAnalysis(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Disk Analysis opens', await a.go('disk-analysis') && (await a.h1()) === 'Disk Analysis', await a.h1())
  check('the drives load', await loaded(a))
  check('the tiles show App data, Total storage, Used and Available (no NaN or undefined)', await a.until(() => { const t = document.querySelector('main')?.innerText || ''; return /App data/i.test(t) && /Total storage/i.test(t) && /Available/i.test(t) && !/NaN|undefined/.test(t) }, null, 10000), (await a.text('main')).slice(0, 400))
  check('the storage meters say how full they are', await a.page.evaluate(() => [...document.querySelectorAll('main [role="meter"]')].every((m) => /\d+ percent used/.test(m.getAttribute('aria-valuetext') || ''))))
  const drives = await driveNames(a)
  const mount = drives.includes(MOUNT) ? MOUNT : drives[0]

  // ---- rename a drive: Cancel and Escape change nothing ---------------------------------------
  const name = `E2E drive ${Date.now().toString(36)}`
  await a.click(`Rename the drive ${mount}`, { within: 'main' })
  check('Rename opens a field with the mount as its hint', await a.until((m) => document.activeElement?.getAttribute('aria-label') === `Name for ${m}`, mount, 5000))
  await a.page.keyboard.type('not kept')
  await a.click('Cancel', { within: 'main' })
  check('Cancel keeps the old name', (await driveNames(a)).includes(mount))
  await a.click(`Rename the drive ${mount}`, { within: 'main' })
  await a.page.keyboard.type('not kept either')
  await a.key('Escape')
  check('Escape keeps the old name', await a.until((m) => !document.querySelector(`main [aria-label="Name for ${m}"]`), mount, 3000) && (await driveNames(a)).includes(mount))

  // ---- Save, read back after a reload, then take it off again ----------------------------------------
  await a.click(`Rename the drive ${mount}`, { within: 'main' })
  await a.type(`Name for ${mount}`, name)
  await a.click('Save', { within: 'main' })
  check('Save names the drive', await a.until((n) => [...document.querySelectorAll('main [aria-label^="Rename the drive "]')].some((b) => b.getAttribute('aria-label') === `Rename the drive ${n}`), name, 5000))
  check('the meter takes the new name', await a.page.evaluate((n) => !!document.querySelector(`main [role="meter"][aria-label="${n} used"]`), name))
  await a.reload(); await loaded(a)
  check('the name is read back after a reload', (await driveNames(a)).includes(name), JSON.stringify(await driveNames(a)))
  await a.click(`Rename the drive ${name}`, { within: 'main' })
  check('the field opens with the current name', await a.until((n) => document.activeElement?.value === n, name, 5000))
  await a.type(`Name for ${mount}`, '')
  await a.key('Enter')
  check('an empty name (Enter) gives the drive its mount back', await a.until((m) => [...document.querySelectorAll('main [aria-label^="Rename the drive "]')].some((b) => b.getAttribute('aria-label') === `Rename the drive ${m}`), mount, 5000))
  await a.reload(); await loaded(a)
  check('…and that is kept too (put back as it was)', (await driveNames(a)).includes(mount) && !(await driveNames(a)).includes(name))

  // ---- Deep prune: asks first (never confirmed) ---------------------------------------------------------
  await a.click('Deep prune', { within: 'main' })
  const ci = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('Deep prune asks first (a question, danger, the verb, Cancel focused)', ci && ci.title === 'Delete everything unused?' && ci.danger && ci.buttons.includes('Delete everything unused') && ci.focused === 'Cancel', JSON.stringify(ci))
  await a.click('Cancel', { within: '[role="alertdialog"]' })
  check('Cancel prunes nothing', await a.waitNoDialog(5000) && !(await a.toasts()).some((x) => /Deep prune/.test(x)))
  check('Refresh reads the analysis again', await a.click('Refresh', { within: 'main' }) && await loaded(a))
  await a.shot('disk-analysis-admin')

  // ---- a viewer --------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Disk Analysis', await v.go('disk-analysis') && (await v.h1()) === 'Disk Analysis' && await loaded(v))
  check('a viewer is offered no Deep prune', !(await v.exists('Deep prune', { within: 'main' })))

  // ---- phone, light -----------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('disk-analysis'); await loaded(p); await p.settle(800)
  check('phone: no sideways scroll on Disk Analysis', !(await p.overflow()), await p.overflow())
  check('phone: Rename is there without a pointer', await p.page.evaluate(() => { const b = document.querySelector('main [aria-label^="Rename the drive "]'); return !!b && getComputedStyle(b).opacity !== '0' }))
  await p.shot('disk-analysis-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('disk-analysis'); await loaded(l)
  check('light: Disk Analysis draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('disk-analysis-light')
}
