// Backups (admin only). In the lab the hub has no BACKUP_DEST_DIR, so backups are "not configured" there: the page
// says so, the backup settings panel shows what is in force (read-only: they live in .env, on the Environment page),
// Back up everything asks first (cancelled). A config snapshot is taken on the hub with a unique label, its restore is
// opened (a typed RESTORE, never confirmed) and it is deleted again (asked first). A recovery bundle is made into the
// lab's own folder (the passphrase not stored as a secret), its restore opened and cancelled, and the file this run
// made is removed. The Snapshots view (#/snapshots), the guide, Refresh, the scope and "follow the progress of".

import fs from 'node:fs'
import path from 'node:path'

const MAIN = 'main'
const SCOPE = 'main [role="group"][aria-label="Show"]'
const conf = (t) => t.until(() => !!document.querySelector('[role="alertdialog"]'), null, 6000)
const typedDialog = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && /RESTORE/.test(e.innerText)).pop()
  if (!d) return null
  const btns = [...d.querySelectorAll('button')]
  return { title: d.querySelector('h1, h2, h3')?.textContent?.trim(), buttons: btns.map((b) => ({ n: b.innerText.trim(), dis: b.disabled, h: Math.round(b.getBoundingClientRect().height) })) }
})

export default async function backup(k) {
  const { check } = k
  const stamp = Date.now().toString(36)
  const LABEL = `e2e-${stamp}`
  const api = await k.apiAs(k.ADMIN)
  const rec0 = (await api.get('/recovery')).data
  const bundles0 = new Set((rec0?.bundles || []).map((b) => b.file))

  const a = await k.open(k.ADMIN)
  try {
    check('admin: the page opens', await a.go('backup') && (await a.h1()) === 'Backups', await a.h1())
    check('admin: an unconfigured hub says how to enable backups', await a.waitText(/Backup not configured/, { within: MAIN, ms: 20000 }) && await a.hasText('BACKUP_DEST_DIR', MAIN))
    check('admin: the status says nothing has run yet', await a.waitText(/No backups recorded yet|Idle/, { within: MAIN, ms: 10000 }))
    check('admin: no NaN / undefined on the page', !/\bNaN\b|undefined/.test(await a.text(MAIN)))

    // guide, Refresh
    await a.click('Guide', { within: MAIN })
    check('admin: Guide opens the guide', await a.until(() => (document.querySelector('main button[aria-label="Guide"]')?.getAttribute('aria-expanded')) === 'true', null, 4000) && await a.waitText(/guide/i, { within: MAIN, ms: 3000 }))
    await a.click(/^(Close the guide|Hide the guide)$/, { within: MAIN })
    check('admin: the guide closes', await a.until(() => document.querySelector('main button[aria-label="Guide"]')?.getAttribute('aria-expanded') === 'false', null, 4000))
    let n0 = a.requests.length
    await a.click('Refresh', { within: MAIN })
    check('admin: Refresh reads the backups again', await (async () => { for (let i = 0; i < 40; i++) { if (a.requests.slice(n0).some((r) => /^\/backups/.test(r.path))) return true; await k.sleep(200) } return false })())

    // follow the progress of: hub / VM
    const follow = await a.page.evaluate(() => [...document.querySelectorAll('main select[aria-label="Follow the progress of"] option')].map((o) => o.value))
    if (follow.length > 1) {
      await a.page.select('main select[aria-label="Follow the progress of"]', follow[1])
      check('admin: "Follow the progress of" switches to the VM', (await a.value('Follow the progress of', 'main')) === follow[1])
      await a.page.select('main select[aria-label="Follow the progress of"]', follow[0])
    }

    // Everywhere: Back up everything asks first
    const hasScope = !!(await a.until((s) => !!document.querySelector(`${s} button`), SCOPE, 10000))
    if (hasScope) {
      await a.click('Everywhere', { within: SCOPE })
      n0 = a.requests.length
      await a.click('Back up everything', { within: 'main section', kind: 'button' })
      const c = await conf(a) && await a.confirmInfo()
      check('admin: Back up everything asks first ("Back up everything?")', c && c.title === 'Back up everything?' && c.buttons.includes('Start everywhere'), JSON.stringify(c))
      await a.click('Cancel', { within: '[role="alertdialog"]' })
      check('admin: Cancel starts no backup', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && !a.requests.slice(n0).some((r) => r.method === 'POST'))
    }

    // the backup settings panel (read-only)
    await a.click('Backup settings', { within: MAIN })
    check('admin: Backup settings opens the settings in force', await a.until(() => document.querySelector('main button[aria-controls="backup-settings-panel"]')?.getAttribute('aria-expanded') === 'true', null, 4000) && await a.waitText(/DESTINATION\s*not set/i, { within: '#backup-settings-panel', ms: 8000 }))
    check('admin: …and says where they are set (the .env, on the Environment page)', await a.hasText('BACKUP_RETENTION_COUNT', '#backup-settings-panel'))
    await a.click('Backup settings', { within: MAIN })
    check('admin: pressed again, it folds', await a.until(() => !document.querySelector('#backup-settings-panel'), null, 4000))

    // one stack: the list, the button waits for a choice
    check('admin: "Back up stack" waits for a stack', await a.page.evaluate(() => [...document.querySelectorAll('main button')].find((b) => b.innerText.trim() === 'Back up stack')?.disabled === true))
    const stacks = await a.page.evaluate(() => [...document.querySelectorAll('main select[aria-label="Stack to back up"] option')].map((o) => o.value).filter(Boolean))
    check('admin: the stacks of every server are offered', stacks.length >= 2, JSON.stringify(stacks))

    // ---- a config snapshot on the hub ---------------------------------------
    if (hasScope) await a.click('Hub', { within: SCOPE })
    await a.type('Label of the snapshot (optional)', LABEL, 'main')
    await a.click('Take a snapshot', { within: MAIN })
    check('admin: Take a snapshot takes it', await a.waitToast(/Snapshot ".*" taken/, 30000), JSON.stringify(await a.toasts()))
    check('admin: …and shows the Snapshots view with it', await a.until((l) => [...document.querySelectorAll('main [aria-label="Kind of saved copy"] input, main .mantine-SegmentedControl-root input')].some((i) => i.checked && i.value === 'snapshots') && document.querySelector('main').innerText.includes(l), LABEL, 15000))
    const snapName = await a.page.evaluate((l) => { const li = [...document.querySelectorAll('main li')].find((x) => x.innerText.includes(l)); return li?.querySelector('button[aria-label^="Delete "]')?.getAttribute('aria-label').slice(7) || null }, LABEL)
    check('admin: the snapshot is listed by its file', !!snapName, String(snapName))
    if (snapName) {
      // its restore: the typed RESTORE, never confirmed
      await a.click(`Restore ${snapName}`, { within: MAIN })
      await a.until(() => [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some((e) => /RESTORE/.test(e.innerText)), null, 6000)
      const td = await typedDialog(a)
      check('admin: Restore asks as a question and waits for RESTORE to be typed', td && td.title === 'Restore this snapshot?' && td.buttons.find((b) => b.n === 'Restore snapshot')?.dis === true, JSON.stringify(td))
      await a.click('Cancel', { within: '[role="dialog"], [role="alertdialog"]' })
      check('admin: Cancel closes it', await a.until(() => ![...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].some((e) => e.getClientRects().length && /RESTORE/.test(e.innerText)), null, 4000))
      // delete: asked first
      await a.click(`Delete ${snapName}`, { within: MAIN })
      const c = await conf(a) && await a.confirmInfo()
      check('admin: Delete asks first ("Delete this snapshot?", rose)', c && c.title === 'Delete this snapshot?' && c.danger && c.buttons.includes('Delete snapshot'), JSON.stringify(c))
      await a.click('Delete snapshot', { within: '[role="alertdialog"]' })
      check('admin: Delete snapshot removes it', await a.waitToast(/deleted/, 15000) && !JSON.stringify((await api.get('/snapshots')).data).includes(LABEL))
    }

    // the Backups view and its empty state
    await a.click(/^Backups/, { within: 'main [aria-label="Kind of saved copy"]' })
    check('admin: the Backups view says there is none yet, and how to make one', await a.waitText('No backup archives found', { within: MAIN, ms: 8000 }))
    check('admin: an upload is offered on the Backups view', await a.exists(/^Upload a backup/, { within: MAIN }))

    // ---- a recovery bundle (into the lab's own folder) ----------------------
    await a.click('Make a bundle', { within: MAIN })
    check('admin: Make a bundle opens the recovery bundle panel', await a.waitText('Recovery bundle', { within: '#recovery-bundle-panel', ms: 8000 }))
    const createBtn = () => a.page.evaluate(() => [...document.querySelectorAll('#recovery-bundle-panel button')].find((b) => /Create bundle now/.test(b.innerText))?.disabled)
    if (!rec0?.passphrase_set) {
      check('admin: "Create bundle now" waits for an 8-character passphrase', (await createBtn()) === true)
      await a.type('Passphrase for the bundle', 'short', 'main')
      check('admin: …a short one is not enough', (await createBtn()) === true)
      await a.type('Passphrase for the bundle', `e2e-pass-${stamp}`, 'main')
      // the passphrase is not stored as a secret by this run
      await a.page.evaluate(() => { const c = document.querySelector('#recovery-bundle-panel input[type="checkbox"]'); if (c && c.checked) c.click() })
      check('admin: "store it as a secret" can be left off', await a.page.evaluate(() => document.querySelector('#recovery-bundle-panel input[type="checkbox"]')?.checked === false))
    }
    check('admin: …then Create bundle now is ready', (await createBtn()) === false)
    await a.click(/Create bundle now/, { within: '#recovery-bundle-panel', dom: true })
    check('admin: Create bundle now writes the bundle', await a.waitToast(/Bundle written/, 120000), JSON.stringify(await a.toasts()))
    const rec1 = (await api.get('/recovery')).data
    const mine = (rec1?.bundles || []).map((b) => b.file).filter((f) => !bundles0.has(f))
    check('admin: …and lists it', mine.length === 1 && await a.waitText(mine[0], { within: '#recovery-bundle-panel', ms: 10000 }), JSON.stringify(mine))
    check('admin: no RECOVERY_PASSPHRASE secret was stored', rec0?.passphrase_set || !JSON.stringify((await api.get('/secrets')).data).includes('RECOVERY_PASSPHRASE'))
    if (mine[0]) {
      await a.click(`Restore ${mine[0]} here`, { within: MAIN })
      check('admin: a bundle\'s restore asks for its passphrase first', await a.waitText(/Restore .* on this server/, { within: '#recovery-bundle-panel', ms: 4000 }) && !!(await a.field('Passphrase of this bundle', 'main')))
      await a.click('Cancel', { within: '#recovery-bundle-panel' })
      check('admin: Cancel closes the restore', await a.until(() => !document.querySelector('#recovery-bundle-panel input[aria-label="Passphrase of this bundle"]'), null, 4000))
    }
    n0 = a.requests.length
    await a.click('Refresh the list of bundles', { within: MAIN })
    check('admin: the bundle list refreshes', await (async () => { for (let i = 0; i < 30; i++) { if (a.requests.slice(n0).some((r) => r.path === '/recovery')) return true; await k.sleep(200) } return false })())

    // ---- #/snapshots opens the Snapshots view -------------------------------
    await a.go('snapshots')
    check('admin: #/snapshots opens Backups on its Snapshots view', (await a.h1()) === 'Backups' && await a.until(() => [...document.querySelectorAll('main input[type="radio"]')].some((i) => i.checked && i.value === 'snapshots'), null, 8000))
    check('admin: …with its empty state', await a.waitText(/No snapshots yet/, { within: MAIN, ms: 8000 }))
    await a.shot('backup-admin')

    // ---- cleanup of what this run made -------------------------------------
  } finally {
    for (const s of ((await api.get('/snapshots')).data?.snapshots || []).filter((x) => JSON.stringify(x).includes(LABEL))) await api.del(`/snapshots/${encodeURIComponent(s.filename)}`)
    const rec = (await api.get('/recovery')).data
    for (const f of (rec?.bundles || []).map((b) => b.file).filter((f) => !bundles0.has(f))) {
      // the bundle (and its checksum) this run wrote into the lab's recovery folder, by exact name
      for (const p of [path.join(rec.dest_dir, f), path.join(rec.dest_dir, `${f}.sha256`)]) if (fs.existsSync(p)) fs.rmSync(p)
    }
  }

  // ---- a viewer: the page is an admin's -----------------------------------
  const v = await k.open(k.VIEWER)
  for (const p of ['backup', 'snapshots']) {
    await v.page.evaluate((p) => { window.location.hash = `#/${p}` }, p)
    await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
    check(`viewer: a link to #/${p} lands on the dashboard`, (await v.h1()) === 'Dashboard', `${await v.currentPage()} / ${await v.h1()}`)
  }

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('backup'); await p.waitText(/Backup not configured/, { within: MAIN, ms: 20000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  if (await p.exists('Everywhere', { within: SCOPE })) {
    await p.click('Everywhere', { within: SCOPE })
    await p.click('Back up everything', { within: 'main section', kind: 'button' })
    if (await conf(p)) {
      const hs = await p.page.evaluate(() => [...document.querySelectorAll('[role="alertdialog"] button')].map((b) => Math.round(b.getBoundingClientRect().height)))
      check('phone: the question\'s buttons are thumb-sized (≥ 40 px)', hs.every((h) => h >= 40), JSON.stringify(hs))
      await p.shot('backup-phone-confirm')
      await p.click('Cancel', { within: '[role="alertdialog"]' })
    }
  }
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('backup'); await l.waitText(/Backup not configured/, { within: MAIN, ms: 20000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('backup-light')
}
