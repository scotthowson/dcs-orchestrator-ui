// Proxmox (the hub's fleet): the overview, the guests (search, the Show filter, Cards / Table, the empty state), a
// guest's power actions (each asks first; Cancel only — VM 100 is media-vm, the lab's member), a VM's details sheet
// (ballooning and Resize asking first, cancelled), the member's sheet (Test the link, Remove and Destroy guarded,
// cancelled — media-vm is never removed), Link VMs, Join code (copy buttons; no new code), SSH keys, Add member
// (validation, cancelled), New VM stack, Host folders, Deploy a template here. A viewer, a phone and the light look.

const dlg = (t) => t.page.evaluate(() => {
  const d = [...document.querySelectorAll('[role="dialog"], [role="alertdialog"]')].filter((e) => e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[inert]') && !/Notifications/.test(e.getAttribute('aria-label') || ''))
  return d.length ? d[d.length - 1].innerText : ''
})
/** the guests section's text */
const guests = (t) => t.page.evaluate(() => [...document.querySelectorAll('main section')].find((s) => /^\s*GUESTS/i.test(s.innerText))?.innerText || '')
const guestNames = async (t) => { const g = await guests(t); return ['media-vm', 'networking-security', 'dns'].filter((n) => new RegExp(`(^|\\n)${n}(\\n|$)`).test(g)) }
const sheetBtn = (t, name) => t.page.evaluate((n) => {
  const d = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop()
  const b = d ? [...d.querySelectorAll('button')].find((x) => x.innerText.trim() === n) : null
  return b ? { disabled: b.disabled } : null
}, name)

export default async function proxmox(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  const writes = (from) => a.requests.slice(from).filter((r) => r.method !== 'GET' && !/^\/(auth|settings\/profile|chat)/.test(r.path)).map((r) => `${r.method} ${r.path}`)
  check('Proxmox opens', await a.go('proxmox') && (await a.h1()) === 'Proxmox')
  check('the guests are listed', await a.until(() => /media-vm/.test([...document.querySelectorAll('main section')].map((s) => s.innerText).join()), null, 30000))
  const main = await a.text('main')
  check('the overview reads (node, this server, templates, builds; no NaN / undefined)', /1\/1 online|online/.test(main) && /THIS SERVER/i.test(main) && /DCS TEMPLATES/i.test(main) && /VM BUILDS/i.test(main) && !/NaN|undefined/.test(main), main.slice(0, 300))

  // ---- the guests: search, Show, view --------------------------------------------------------------
  check('every guest shows (media-vm, networking-security, dns)', (await guestNames(a)).length === 3, JSON.stringify(await guestNames(a)))
  await a.type('Search the guests', 'dns'); await k.sleep(400)
  check('search narrows the guests', JSON.stringify(await guestNames(a)) === '["dns"]', JSON.stringify(await guestNames(a)))
  await a.type('Search the guests', 'zzz-no-guest')
  check('a search with no match says so and offers "Clear the filters"', await a.waitText('No guest matches', { within: 'main', ms: 5000 }) && await a.exists('Clear the filters', { within: 'main' }))
  await a.click('Clear the filters', { within: 'main' }); await k.sleep(400)
  check('"Clear the filters" brings every guest back', (await guestNames(a)).length === 3)
  for (const [seg, want] of [['Running', ['media-vm', 'networking-security']], ['Stopped', ['dns']], ['VMs', ['media-vm', 'networking-security']], ['LXC', ['dns']], ['DCS', ['media-vm']]]) {
    await a.click(new RegExp(`^${seg}( \\d+)?$`), { within: 'main' }); await k.sleep(400)
    const got = await guestNames(a)
    check(`Show "${seg}" lists ${want.join(', ')}`, JSON.stringify(got) === JSON.stringify(want), JSON.stringify(got))
  }
  await a.click(/^All( \d+)?$/, { within: 'main' }); await k.sleep(300)
  await a.click('Table', { within: 'main' })
  check('Table shows the guests as a table', await a.until(() => !!document.querySelector('main table') && /media-vm/.test(document.querySelector('main table').innerText), null, 5000))
  await a.click('Cards', { within: 'main' })
  check('Cards goes back to the cards', await a.until(() => !document.querySelector('main section table'), null, 5000))

  // ---- a guest's power actions: each asks, Cancel only -----------------------------------------------
  for (const [btn, q, danger] of [['Shut down', 'Shut down media-vm cleanly?', true], ['Reboot', 'Reboot media-vm?', false], ['Stop', 'Stop media-vm now?', true], ['Reset', 'Hard-reset media-vm?', true], ['Suspend', 'Suspend media-vm?', false], ['Start', 'Start dns?', false]]) {
    const w0 = a.requests.length
    await a.click(btn, { within: 'main', kind: 'button' })
    const info = await a.until(() => { const d = document.querySelector('[role="alertdialog"]'); if (!d) return false; const bs = [...d.querySelectorAll('button')]; const run = bs[bs.length - 1]; return { title: d.querySelector('h3')?.textContent || '', rose: /rose/.test(run.className), run: run.innerText.trim(), focused: document.activeElement?.innerText?.trim() } }, null, 5000)
    check(`${btn} asks "${q}"${danger ? ' (rose, Cancel focused)' : ''}`, info && info.title === q && info.rose === danger && (!danger || info.focused === 'Cancel'), JSON.stringify(info))
    await a.click('Cancel', { within: '[role="alertdialog"]' })
    check(`…Cancel sends nothing (${btn})`, await a.waitNoDialog(5000) && !writes(w0).length, writes(w0).join())
  }
  await a.click('Stop', { within: 'main', kind: 'button' }); await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000)
  await a.key('Escape')
  check('Escape closes a power action\'s question', await a.waitNoDialog(5000))

  // ---- a VM's details --------------------------------------------------------------------------------
  await a.click('Details, memory and ballooning', { within: 'main' })
  check('Details opens the VM\'s sheet', await a.waitDialog('media-vm', 8000) && await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /OPERATING SYSTEM/i.test(d.innerText)), null, 15000))
  const det = await dlg(a)
  check('…with CPU, memory, disk and network (no NaN / undefined)', /CPU/.test(det) && /MEMORY/i.test(det) && /DISK/i.test(det) && !/NaN|undefined/.test(det), det.slice(0, 300))
  let w0 = a.requests.length
  if (await a.exists('Enable ballooning', { kind: 'button' })) {
    await a.click('Enable ballooning', { kind: 'button' })
    const c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
    check('Enable ballooning asks first', c && c.title === 'Enable ballooning?', JSON.stringify(c))
    await a.click('Cancel', { within: '[role="alertdialog"]' }); await k.sleep(300)
    check('…Cancel sends nothing', !writes(w0).length, writes(w0).join())
  }
  await a.key('Escape')
  check('Escape closes the details sheet', await a.waitNoDialog(5000))

  // ---- the member's sheet ------------------------------------------------------------------------------
  await a.click('Manage media-vm', { within: 'main' })
  check('Manage opens the member\'s sheet', await a.waitDialog('media-vm', 8000) && /Remove from the fleet/.test(await dlg(a)))
  await a.click(/^Test the link/, { kind: 'button' })
  check('Test the link answers in the sheet', await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /Answers as|Not reachable|failed/.test(d.innerText)), null, 20000), (await dlg(a)).slice(0, 300))
  w0 = a.requests.length
  await a.click('Remove from the fleet', { kind: 'button' })
  let c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('Remove from the fleet asks "Forget this member?" (danger, Cancel focused)', c && c.title === 'Forget this member?' && c.danger && c.focused === 'Cancel', JSON.stringify(c))
  await a.click('Cancel', { within: '[role="alertdialog"]' })
  check('…Cancel keeps media-vm (nothing sent)', await a.until(() => !document.querySelector('[role="alertdialog"]'), null, 4000) && !writes(w0).length, writes(w0).join())
  await a.click(/^Stop and destroy the VM/, { kind: 'button' })
  check('Destroy asks for the stack\'s name, its button disabled', await a.until(() => !!document.querySelector('#destroy-vm-name'), null, 4000) && (await sheetBtn(a, 'Destroy the VM'))?.disabled === true)
  await a.type('#destroy-vm-name', 'not-the-name')
  check('…a wrong name keeps it disabled', (await sheetBtn(a, 'Destroy the VM'))?.disabled === true)
  await a.click('Cancel', { within: '[role="group"][aria-label="Confirm destroying the VM"]' })
  check('…Cancel closes the destroy question (nothing sent)', await a.until(() => !document.querySelector('#destroy-vm-name'), null, 4000) && !writes(w0).length, writes(w0).join())
  await a.click(/^Relink to the hub/, { kind: 'button' })
  c = await a.until(() => !!document.querySelector('[role="alertdialog"]'), null, 5000) && await a.confirmInfo()
  check('Relink asks first', c && c.title === 'Relink media-vm?', JSON.stringify(c))
  await a.click('Cancel', { within: '[role="alertdialog"]' }); await k.sleep(300)
  await a.click(/^Edit name, address/, { kind: 'button' })
  check('Edit opens the member\'s form', await a.waitDialog('Edit media-vm', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)
  check('media-vm is still a member', /media-vm/.test(await guests(a)) && await a.exists('Manage media-vm', { within: 'main' }))

  // ---- the fleet sheets: Link VMs, Join code, SSH keys, Add member, New VM stack -------------------
  await a.click('Link VMs', { within: 'main' })
  check('Link VMs scans the guests', await a.waitDialog('Link the VMs', 8000) && await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /linked as media-vm|every DCS found is linked|Ready/.test(d.innerText)), null, 30000))
  await a.key('Escape'); await a.waitNoDialog(5000)

  await a.click('Join code', { within: 'main' })
  check('Join code shows the code and the commands', await a.waitDialog('Join code', 8000) && await a.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /fleet\/bootstrap/.test(d.innerText)), null, 15000))
  const e0 = a.errors.length
  await a.click('Copy', { kind: 'button', dom: true })
  check('a Copy button copies (Copied, no error)', await a.until(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /Copied/.test(b.innerText || b.getAttribute('aria-label') || '')), null, 3000) && a.errors.length === e0, a.errors.slice(e0).join())
  await a.key('Escape'); await a.waitNoDialog(5000)

  await a.click('SSH keys', { within: 'main', kind: 'button' })
  check('SSH keys opens "SSH into your VMs"', await a.waitDialog('SSH into your VMs', 8000))
  await a.key('Escape')
  check('Escape closes it', await a.waitNoDialog(5000))

  await a.click('Add member', { within: 'main' })
  check('Add member opens its form', await a.waitDialog('Add a member', 8000))
  check('Link this server is disabled without a password', (await sheetBtn(a, 'Link this server'))?.disabled === true)
  await a.type('API address', 'not-an-address')
  await a.type('Password', 'e2e-only-not-a-password')
  w0 = a.requests.length
  await a.click('Link this server', { kind: 'button' })
  check('a malformed address is refused in the form (nothing sent)', await a.waitText('The address must look like', { within: '[role="dialog"]', ms: 4000 }) && !writes(w0).length, writes(w0).join())
  await a.click('Cancel', { kind: 'button' })
  check('Cancel closes Add member', await a.waitNoDialog(5000))

  await a.click('New VM stack', { within: 'main', kind: 'button' })
  check('New VM stack opens its sheet', await a.waitDialog('A stack in its own VM', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)
  await a.click('Host folders of media-vm', { within: 'main' })
  check('Host folders opens for the VM', await a.waitDialog('Host folders', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)
  await a.click('SSH into media-vm', { within: 'main' })
  check('"SSH into media-vm" opens the SSH sheet', await a.waitDialog('SSH into your VMs', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)
  w0 = a.requests.length
  await a.click('Refresh', { within: 'main', kind: 'button' }); await k.sleep(1500)
  check('Refresh reads Proxmox again', a.requests.slice(w0).some((r) => /^\/proxmox\//.test(r.path)), a.requests.slice(w0).map((r) => r.path).join())
  await a.click('Deploy a template into this VM', { within: 'main' })
  check('"Deploy a template into this VM" opens Templates', await a.until(() => document.querySelector('main h1')?.textContent === 'Templates', null, 15000))

  // ---- a viewer ------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Proxmox', await v.go('proxmox') && await v.until(() => /media-vm/.test([...document.querySelectorAll('main section')].map((s) => s.innerText).join()), null, 30000))
  const vb = await v.page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => (b.getAttribute('aria-label') || b.innerText).trim()))
  const vAdm = vb.filter((n) => /^(New VM stack|Link VMs|Join code|SSH|SSH keys|Add member|Settings|Manage |Shut down|Reboot|Stop|Reset|Suspend|Start|Link…|Bake one|Host folders|SSH into|Deploy a template)/.test(n))
  check('a viewer is offered no fleet or power action', !vAdm.length, JSON.stringify(vAdm))
  await v.click('Details, memory and ballooning', { within: 'main' })
  check('a viewer can read a VM\'s details', await v.waitDialog('media-vm', 8000) && await v.until(() => [...document.querySelectorAll('[role="dialog"]')].some((d) => /OPERATING SYSTEM/i.test(d.innerText)), null, 15000))
  const vd = await dlg(v)
  check('…without Enable ballooning or Resize, and no hint to do what only an admin may', !/Enable ballooning|^Resize$/m.test(vd) && !/— enable ballooning/.test(vd), vd.slice(0, 400))
  await v.key('Escape'); await v.waitNoDialog(5000)
  await v.click(/^Table$/, { within: 'main' })
  check('a viewer can switch to the table', await v.until(() => !!document.querySelector('main table'), null, 5000))

  // ---- a phone, the light look --------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('proxmox')
  await p.until(() => /media-vm/.test([...document.querySelectorAll('main section')].map((s) => s.innerText).join()), null, 30000)
  check('no sideways scroll on a phone (Proxmox)', !(await p.overflow()), await p.overflow())
  await p.click('Stop', { within: 'main', kind: 'button' })
  const sheet = await p.until(() => { const d = document.querySelector('[role="alertdialog"]'); if (!d) return false; const r = d.getBoundingClientRect(); return { bottom: Math.round(window.innerHeight - r.bottom), btns: [...d.querySelectorAll('button')].filter((b) => /^(Cancel|Stop)$/.test(b.innerText.trim())).map((b) => Math.round(b.getBoundingClientRect().height)) } }, null, 5000)
  check('a power action is a bottom sheet with thumb-sized buttons on a phone', sheet && sheet.bottom <= 1 && sheet.btns.length === 2 && sheet.btns.every((h) => h >= 40), JSON.stringify(sheet))
  await p.click('Cancel', { within: '[role="alertdialog"]' }); await p.waitNoDialog(5000)
  await p.click('Add member', { within: 'main' }); await p.waitDialog('Add a member', 8000)
  const am = await p.page.evaluate(() => { const d = [...document.querySelectorAll('[role="dialog"]')].filter((e) => e.getClientRects().length).pop(); return [...d.querySelectorAll('button')].filter((b) => /^(Cancel|Link this server)$/.test(b.innerText.trim())).map((b) => Math.round(b.getBoundingClientRect().height)) })
  check('Add member\'s buttons are thumb-sized on a phone', am.length === 2 && am.every((h) => h >= 40), JSON.stringify(am))
  await p.shot('proxmox-phone-add-member')
  await p.key('Escape')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('proxmox')
  await l.until(() => /media-vm/.test([...document.querySelectorAll('main section')].map((s) => s.innerText).join()), null, 30000)
  check('Proxmox in the light look (screenshot)', await l.page.evaluate(() => document.documentElement.classList.contains('light')), await l.shot('proxmox-light'))
}
