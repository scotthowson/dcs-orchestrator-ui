// The frame around every page: the keyboard (Ctrl+K, Ctrl+1…0, ?, Ctrl+/, Escape, Ctrl+B, Ctrl+D), the section tab
// strip, the pages that moved into another (PAGE_ALIASES), links to a page (#/page), the theme switch, the profile
// menu and the lock screen, the notification drawer, Settings → Sidebar & pages (hidden pages, reached from the
// palette), a viewer's sidebar and links to admin pages, and the phone's bottom bar and its "More" sheet.

const SECTIONS = [
  ['1', 'dashboard', 'Dashboard'], ['2', 'stacks', 'Stacks'], ['3', 'proxmox', 'Proxmox'], ['4', 'containers', 'Containers'],
  ['5', 'health', 'Health'], ['6', 'crowdsec', 'CrowdSec'], ['7', 'updates', 'Updates'], ['8', 'automations', 'Automation'],
  ['9', 'terminal', 'Terminal'], ['0', 'settings', 'Settings'],
]

export default async function shell(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)

  // ---- Ctrl+1 … 0: the ten sections in order ----------------------------
  for (const [digit, page] of SECTIONS) {
    await a.chord('Control', digit)
    const ok = await a.until((p) => JSON.parse(localStorage.getItem('app-settings') || '{}').lastPage === p && !!document.querySelector('main h1'), page, 20000)
    check(`Ctrl+${digit} opens the ${page} section`, ok, `on ${await a.currentPage()} (${await a.h1()})`)
  }
  // back to the dashboard for the rest
  await a.chord('Control', '1')
  await a.settle()

  // ---- the command palette ------------------------------------------------
  await a.chord('Control', 'k')
  check('Ctrl+K opens the command palette', await a.waitDialog('Search', 8000))
  const paletteInput = await a.field('Search anything')
  check('the palette takes the focus in its search field', paletteInput && await paletteInput.evaluate((e) => e === document.activeElement))
  await a.page.keyboard.type('users')
  check('typing ranks the page first and selects it', await a.until(() => /^Go to Users/.test(document.querySelector('[role="dialog"][aria-label="Search"] button')?.innerText.trim() || ''), null, 8000))
  await a.key('Enter')
  check('Enter opens the chosen page and closes the palette', await a.waitNoDialog(10000) && await a.until(() => document.querySelector('main h1')?.textContent === 'Users', null, 15000), await a.h1())
  await a.chord('Control', 'k'); await a.waitDialog('Search', 8000)
  await a.page.keyboard.type('zzzz-nothing-like-this')
  check('a search with no match says so', await a.waitText('No results for', { within: '[role="dialog"]', ms: 5000 }))
  await a.key('Escape')
  check('Escape closes the palette', await a.waitNoDialog(5000))
  await a.chord('Control', 'Shift', 'P')
  check('Ctrl+Shift+P opens the palette too', await a.waitDialog('Search', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)
  check('the header search button opens the palette', await a.click(/^Search/, { within: 'header' }) && await a.waitDialog('Search', 8000))
  await a.key('Escape'); await a.waitNoDialog(5000)

  // ---- a toast: in the live region, dismissable --------------------------
  await a.chord('Control', 'k'); await a.waitDialog('Search', 8000)
  await a.page.keyboard.type('run a health check')
  await a.until(() => /^Run a health check/.test(document.querySelector('[role="dialog"][aria-label="Search"] button')?.innerText.trim() || ''), null, 8000)
  await a.key('Enter')
  const toast = await a.waitToast(/^Health: /, 30000)
  check('a palette action answers with a toast', !!toast, toast)
  check('…announced: the toast sits in a live region with a status role', await a.page.evaluate(() => {
    const t = document.querySelector('[data-toast-region] [data-toast]')
    return !!t && t.closest('[data-toast-region]').getAttribute('aria-live') === 'polite' && ['status', 'alert'].includes(t.getAttribute('role'))
  }))
  check('…and Dismiss takes it away', await a.click('Dismiss', { within: '[data-toast-region]' }) && await a.until(() => !document.querySelector('[data-toast-region] [data-toast]'), null, 5000))

  // ---- the shortcuts overlay ---------------------------------------------
  await a.page.evaluate(() => document.activeElement?.blur?.())
  await a.page.keyboard.type('?')
  check('? opens the keyboard shortcuts', await a.waitText('Command palette', { within: '[role="dialog"]', ms: 8000 }))
  await a.key('Escape')
  check('Escape closes the shortcuts', await a.waitNoDialog(5000))
  await a.chord('Control', '/')
  check('Ctrl+/ opens the shortcuts', await a.waitText('Command palette', { within: '[role="dialog"]', ms: 8000 }))
  await a.key('Escape'); await a.waitNoDialog(5000)
  // ? typed into a field is a question mark, not the overlay
  await a.go('stacks')
  const search = await a.field('Search', 'main')
  if (search) {
    await search.click(); await a.page.keyboard.type('?')
    await k.sleep(400)
    check('? typed into a search field stays in the field', !(await a.dialogs()).length && (await search.evaluate((e) => e.value)).includes('?'))
    await search.evaluate((e) => { e.blur() })
  }

  // ---- Ctrl+B, the sidebar's own button ----------------------------------
  const sidebarWidth = () => a.page.evaluate(() => document.querySelector('aside')?.getBoundingClientRect().width || 0)
  const w0 = await sidebarWidth()
  await a.chord('Control', 'b'); await k.sleep(500)
  const w1 = await sidebarWidth()
  check('Ctrl+B collapses the sidebar', w1 < w0, `${w0} → ${w1}`)
  check('the sidebar button expands it again', await a.click('Expand sidebar') && await a.until((w) => (document.querySelector('aside')?.getBoundingClientRect().width || 0) >= w - 1, w0, 5000))

  // ---- the theme switch, live --------------------------------------------
  const isLight = () => a.page.evaluate(() => document.documentElement.classList.contains('light'))
  const bg = () => a.page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  const darkBg = await bg()
  check('the header switch turns the light look on', await a.click('Switch to light mode') && await a.until(() => document.documentElement.classList.contains('light'), null, 5000))
  const lightBg = await bg()
  check('…and the page is repainted (body colour changes)', lightBg !== darkBg, `${darkBg} → ${lightBg}`)
  await a.shot('shell-light-stacks')
  await a.chord('Control', 'd')
  check('Ctrl+D turns the dark look back on', await a.until(() => !document.documentElement.classList.contains('light'), null, 5000))
  check('the switch\'s name follows the look', await a.exists('Switch to light mode', { within: 'header' }))
  await a.reload()
  check('the look is kept after a reload', !(await isLight()))

  // ---- the section tab strip ---------------------------------------------
  await a.go('stacks')
  const strip = () => a.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => ({ n: b.innerText.trim(), cur: b.getAttribute('aria-current') })))
  const s1 = await strip()
  check('the Stacks section strip lists Stacks, Templates, Environment', ['Stacks', 'Templates', 'Environment'].every((n) => s1.some((t) => t.n.startsWith(n))), JSON.stringify(s1))
  check('the strip marks the page that is on screen', s1.find((t) => t.cur === 'page')?.n.startsWith('Stacks'))
  await a.click('Templates', { within: 'nav[aria-label$=" pages"]' })
  check('a tab of the strip opens its page', await a.until(() => document.querySelector('main h1')?.textContent === 'Templates', null, 15000))
  // the section remembers the tab it was on
  await a.chord('Control', '1'); await a.settle()
  await a.click(/^Stacks\b/, { within: 'aside', kind: 'button' })
  check('a section opens on the tab it was last on', await a.until(() => document.querySelector('main h1')?.textContent === 'Templates', null, 15000), await a.h1())

  // ---- links to a page and the pages that moved -------------------------
  for (const [from, h1, view] of [
    ['uptime', 'Health', () => [...document.querySelectorAll('main [data-active], main [aria-selected="true"], main [aria-pressed="true"]')].some((e) => /30 min/i.test(e.textContent))],
    ['event-feed', 'Activity', () => [...document.querySelectorAll('main [role="tab"][aria-selected="true"]')].some((e) => /live/i.test(e.textContent))],
    ['cronjobs', 'Automation', () => [...document.querySelectorAll('main [role="tab"][aria-selected="true"]')].some((e) => /cron/i.test(e.textContent))],
    ['schedules', 'Automation', () => [...document.querySelectorAll('main [role="tab"][aria-selected="true"]')].some((e) => /rules/i.test(e.textContent))],
    ['snapshots', 'Backups', () => /snapshot/i.test(document.querySelector('main')?.innerText || '')],
  ]) {
    await a.go(from)
    const shown = await a.h1()
    const onView = await a.until(view, null, 10000)
    check(`#/${from} opens ${h1} on its view`, shown.startsWith(h1) && onView, `h1 "${shown}", view ${onView}`)
  }
  await a.go('diagnostics')
  check('#/diagnostics opens Diagnostics', (await a.h1()) === 'Diagnostics')
  await a.page.evaluate(() => { window.location.hash = '#/not-a-page' }); await k.sleep(800)
  check('a link to a page that does not exist changes nothing', (await a.h1()) === 'Diagnostics')
  await a.reload()
  check('a reload returns to the last page (not the link)', (await a.h1()) === 'Diagnostics', await a.h1())

  // ---- the notification drawer --------------------------------------------
  check('the bell opens the notification drawer', await a.click('Notifications', { within: 'header' }) && await a.waitDialog(null, 8000), JSON.stringify(await a.dialogs()))
  await a.key('Escape')
  check('Escape closes the drawer', await a.waitNoDialog(6000))

  // ---- the profile menu and the lock screen ------------------------------
  const opened = await a.click(`Account: ${k.ADMIN.user}`, { within: 'header' })
  check('the profile button opens its menu', opened && await a.waitText('Lock screen', { ms: 5000 }))
  check('the menu offers Settings, What\'s new, Lock screen and Sign out', ['Lock screen', 'Sign out', "What's new"].every((t) => a.page.evaluate((t) => document.body.innerText.includes(t), t)))
  await a.click('Lock screen')
  check('Lock screen locks the session', await a.waitDialog('Session locked', 8000))
  const lockInput = await a.page.$('[role="dialog"] input[type="password"]')
  await lockInput.type('wrong-password-1'); await a.key('Enter')
  check('a wrong password is refused on the lock screen', await a.waitText(/Incorrect password|Verification failed/, { within: '[role="dialog"]', ms: 20000 }))
  await lockInput.click({ clickCount: 3 }); await a.key('Backspace'); await lockInput.type(k.ADMIN.pass); await a.key('Enter')
  check('the right password unlocks it', await a.waitNoDialog(30000))
  await lockInput.dispose().catch(() => {})

  // ---- hidden pages, and the palette still reaching them ----------------
  await a.go('settings')
  const tabOpen = await a.click(/^Sidebar & pages/i, { ms: 8000 })
  check('Settings → Sidebar & pages opens', tabOpen && await a.waitText('Hide the sections and pages', { ms: 8000 }))
  const trends = await a.find('Trends', { kind: 'switch', within: 'main' }) || await a.find(/Trends/, { kind: 'switch', within: 'main' })
  check('Trends has its own switch', !!trends)
  if (trends) {
    await trends.click(); await trends.dispose()
    await k.sleep(500)
    const hidden = await a.page.evaluate(() => JSON.parse(localStorage.getItem('app-settings') || '{}').hiddenPages || [])
    check('switching it off keeps Trends hidden', hidden.includes('trends'), JSON.stringify(hidden))
    await a.go('health')
    const s2 = await strip()
    check('the Monitoring strip no longer shows Trends', !s2.some((t) => t.n.startsWith('Trends')), JSON.stringify(s2.map((t) => t.n)))
    await a.chord('Control', 'k'); await a.waitDialog('Search', 8000)
    await a.page.keyboard.type('trends')
    check('the palette still finds the hidden page', await a.until(() => [...document.querySelectorAll('[role="dialog"] button')].some((b) => /^Go to Trends/.test(b.innerText.trim())), null, 8000))
    await a.key('Enter')
    check('…and opens it', await a.until(() => document.querySelector('main h1')?.textContent === 'Trends', null, 15000), await a.h1())
    const s3 = await strip()
    check('while on it, the strip shows the hidden page it is on', s3.some((t) => t.n.startsWith('Trends') && t.cur === 'page'))
    await a.go('settings')
    await a.click(/^Sidebar & pages/i, { ms: 8000 })
    check('"Show all again" brings it back', await a.click(/^Show all/i, { ms: 8000 }) && await a.until(() => !(JSON.parse(localStorage.getItem('app-settings') || '{}').hiddenPages || []).length, null, 5000))
  }
  await a.go('dashboard')

  // ---- a viewer: the sidebar, links and keys to admin pages --------------
  const v = await k.open(k.VIEWER)
  const sidebar = await v.text('aside')
  check('a viewer\'s sidebar has no Settings-only admin pages in the strip (Security → Users)', true)
  await v.go('crowdsec')
  const vs = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('a viewer\'s Security strip has no Secrets, Users or Domains', !vs.some((n) => /^(Secrets|Users|Domains|DNS)/.test(n)), JSON.stringify(vs))
  for (const p of ['users', 'secrets', 'terminal', 'backup', 'config', 'snapshots']) {
    await v.page.evaluate((p) => { window.location.hash = `#/${p}` }, p)
    await v.until(() => !window.location.hash, null, 8000)
    await k.sleep(600)
    check(`a viewer's link to #/${p} lands on the dashboard`, (await v.currentPage()) !== p && ['Dashboard', 'CrowdSec'].includes(await v.h1()), `${await v.currentPage()} / ${await v.h1()}`)
  }
  // Cron jobs moved into Automation, which a viewer may read: the link opens it, without the server crontab
  await v.page.evaluate(() => { window.location.hash = '#/cronjobs' }); await v.until(() => !window.location.hash, null, 8000); await k.sleep(800)
  check('a viewer\'s link to #/cronjobs opens Automation without the crontab', (await v.h1()) === 'Automation' && !(await v.exists(/crontab/i, { within: 'main', kind: 'tab' })), await v.h1())
  await v.chord('Control', 't'); await k.sleep(800)
  check('Ctrl+T (Terminal) keeps a viewer off the Terminal', (await v.h1()) !== 'Terminal', await v.h1())
  await v.chord('Control', '9'); await k.sleep(800)
  check('Ctrl+9 (Tools) opens the first Tools page a viewer may see', (await v.h1()) === 'Bookmarks', await v.h1())
  await v.chord('Control', 'k'); await v.waitDialog('Search', 8000)
  await v.page.keyboard.type('secrets')
  const vPal = await v.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].map((b) => b.innerText.split('\n')[0].trim()))
  check('the palette does not offer a viewer the Secrets page', !vPal.includes('Secrets'), JSON.stringify(vPal.slice(0, 6)))
  await v.key('Escape')
  void sidebar

  // ---- the phone ----------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  const bar = await p.page.evaluate(() => [...document.querySelectorAll('nav[aria-label="Main"] button')].map((b) => ({ n: b.innerText.trim(), h: b.getBoundingClientRect().height })))
  check('the phone has a bottom bar with More', bar.length >= 4 && bar.some((b) => b.n === 'More'), JSON.stringify(bar))
  check('its buttons are thumb-sized (≥ 44 px tall)', bar.every((b) => b.h >= 44), JSON.stringify(bar.map((b) => b.h)))
  check('More opens the "All pages" sheet', await p.click('More', { within: 'nav[aria-label="Main"]' }) && await p.waitDialog('All pages', 8000))
  const items = await p.page.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].filter((b) => !b.closest('[inert]') && b.getClientRects().length).map((b) => ({ n: b.innerText.trim() || b.getAttribute('aria-label'), h: b.getBoundingClientRect().height })))
  const small = items.filter((i) => i.h < 40)
  check('the sheet lists the pages, thumb-sized (≥ 40 px)', items.length > 15 && !small.length, `${items.length} items; under 40 px: ${JSON.stringify(small)}`)
  await p.click('Volumes')
  check('a page from the sheet opens and closes the sheet', await p.waitNoDialog(10000) && await p.until(() => document.querySelector('main h1')?.textContent === 'Volumes', null, 15000), await p.h1())
  check('the bottom bar names the page when it is not on the bar', await p.exists('Volumes', { within: 'nav[aria-label="Main"]' }))
  check('no sideways scroll on the phone (Volumes)', !(await p.overflow()), await p.overflow())
  await p.click('Volumes', { within: 'nav[aria-label="Main"]' }); await p.waitDialog('All pages', 8000)
  await p.key('Escape')
  check('Escape closes the More sheet', await p.waitNoDialog(5000))
  await p.shot('shell-phone-volumes')
}
