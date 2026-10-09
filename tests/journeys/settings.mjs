// Settings: every section is there and folds; the profile (save, read back after a reload, Discard, the accent colour,
// put back); Appearance (Dark, Light, System; the background address's validation, Apply and Clear — no outside image
// is ever loaded); Sidebar & pages; Application preferences (no dead polling fields; Start on, 24-hour clock, reduce
// motion, the compact sidebar); notification preferences; Lock & session; Keyboard shortcuts; the alert thresholds'
// validation (never saved); the themes panel (wear one, copy its JSON, wear the first again). Every setting is put back.
// A viewer's Settings (their own device and profile, no server-wide controls); the phone and the light look.

const SNAP_KEYS = ['theme', 'themeName', 'defaultPage', 'use24hClock', 'reduceMotion', 'sidebarCollapsed', 'hiddenPages', 'autoLockMinutes',
  'sessionDurationMinutes', 'rememberUsername', 'notificationsEnabled']

const appSettings = (t) => t.page.evaluate(() => JSON.parse(localStorage.getItem('app-settings') || '{}'))
const pick = (o) => Object.fromEntries(SNAP_KEYS.map((k) => [k, o[k]]))

/** the body of a section by its title */
const SECTION = (title) => `[id="settings-card-${title.replace(/\s+/g, '-').toLowerCase()}-body"]`

/** a switch named by its label inside a section: read its state, or press it (press: true) */
function switchIn({ sel, label, press }) {
  const i = [...document.querySelector(sel).querySelectorAll('input[type="checkbox"], [role="switch"]')]
    .find((x) => (x.getAttribute('aria-label') || [...(x.labels || [])].map((l) => l.textContent).join(' ') || x.textContent || '').trim().startsWith(label))
  if (!i) return null
  if (press) i.click()
  return i.type === 'checkbox' ? i.checked : i.getAttribute('aria-checked') === 'true'
}

/** flip a switch; returns its state before and after, and the stored settings before and after */
async function flip(t, section, label) {
  const sel = SECTION(section)
  const before = await t.page.evaluate(switchIn, { sel, label })
  const store0 = await appSettings(t)
  const ok = (await t.page.evaluate(switchIn, { sel, label, press: true })) !== null
  await new Promise((r) => setTimeout(r, 400))
  return { ok, before, after: await t.page.evaluate(switchIn, { sel, label }), store0, store1: await appSettings(t) }
}

const changedKeys = (a, b) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]) && k !== 'lastPage')

export default async function settings(k) {
  const api = await k.apiAs(k.ADMIN)
  const serverProfile0 = (await api.get('/settings/profile')).data?.profile || {}
  try {
    await walk(k, api, serverProfile0)
  } finally {
    // whatever happened above, the shared lab account keeps its own profile (no test background, name or bio)
    const pr = (await api.get('/settings/profile')).data?.profile
    if (pr && (pr.backgroundImage !== (serverProfile0.backgroundImage ?? '') || pr.displayName !== serverProfile0.displayName || pr.bio !== serverProfile0.bio || pr.accentColor !== serverProfile0.accentColor)) {
      await api.post('/settings/profile', { profile: { ...pr, backgroundImage: serverProfile0.backgroundImage ?? '', displayName: serverProfile0.displayName ?? '', bio: serverProfile0.bio ?? '', accentColor: serverProfile0.accentColor ?? 'emerald' } })
    }
    await api.logout()
  }
}

async function walk(k, api, serverProfile0) {
  const { check } = k
  const stamp = Date.now().toString(36)
  const BG = `${k.UI}/icon-512.png`

  const a = await k.open(k.ADMIN)
  check('the page opens for an admin', await a.go('settings') && (await a.h1()) === 'Settings', await a.h1())
  const s0 = pick(await appSettings(a))
  const sections = await a.page.evaluate(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].map((b) => ({ t: b.innerText.trim(), open: b.getAttribute('aria-expanded') === 'true' })))
  const want = ['User profile', 'Server connection', 'Appearance', 'Sidebar & pages', 'Chat', 'Application preferences', 'Keyboard shortcuts', 'Disk configuration',
    'Notification preferences', 'Alert thresholds', 'Lock & session', 'Backup & restore', 'Web terminal', 'Themes', 'Custom CSS', 'About', 'Security & account']
  const missing = want.filter((w) => !sections.some((s) => s.t === w))
  check(`every section is there (${want.length})`, !missing.length, `missing ${JSON.stringify(missing)}`)
  // a person reads them all: open the folded ones (put back at the end)
  const folded = sections.filter((s) => !s.open).map((s) => s.t)
  const toggleSection = (title) => a.page.evaluate((t) => [...document.querySelectorAll('main h2 button[aria-expanded]')].find((b) => b.innerText.trim() === t)?.click(), title)
  for (const t of folded) await toggleSection(t)
  check('every section unfolds', await a.until(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].every((b) => b.getAttribute('aria-expanded') === 'true'), null, 5000))
  const text = await a.text('main')
  check('no undefined / NaN / [object Object]', !/\bundefined\b|\bNaN\b|\[object Object\]/.test(text), (text.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/) || [''])[0])
  await toggleSection('About')
  check('a section folds (About)', await a.until(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].find((b) => b.innerText.trim() === 'About')?.getAttribute('aria-expanded') === 'false', null, 3000))
  await toggleSection('About')

  // ---- the profile ----------------------------------------------------------------------
  const name0 = await a.value('#profile-display-name')
  const bio0 = await a.value('#profile-bio')
  const newName = `e2e ${stamp}`
  await a.type('#profile-display-name', newName)
  check('a profile change shows the save bar', await a.until(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Discard'), null, 4000))
  await a.click('Discard', { within: 'body', kind: 'button' })
  check('Discard puts the field back', await a.until((v) => document.querySelector('#profile-display-name')?.value === v, name0, 4000), await a.value('#profile-display-name'))
  await a.type('#profile-display-name', newName)
  await a.type('#profile-bio', `bio ${stamp}`)
  const accent0 = await a.page.evaluate(() => [...document.querySelectorAll('[role="group"][aria-labelledby="profile-accent-label"] button')].find((b) => b.getAttribute('aria-pressed') === 'true')?.getAttribute('aria-label') || 'Emerald')
  const accent1 = accent0 === 'Cyan' ? 'Violet' : 'Cyan'
  await a.click(accent1, { within: '[aria-labelledby="profile-accent-label"]' })
  check(`the accent colour ${accent1} is chosen (pressed)`, await a.until((n) => document.querySelector(`[aria-labelledby="profile-accent-label"] button[aria-label="${n}"]`)?.getAttribute('aria-pressed') === 'true', accent1, 3000))
  await a.click('Save', { within: 'body', kind: 'button' })
  check('Save keeps the profile (the save bar goes)', await a.until(() => ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Discard'), null, 8000))
  let sp = null
  for (let i = 0; i < 20 && !sp; i++) { const pr = (await api.get('/settings/profile')).data?.profile || {}; if (pr.displayName === newName) sp = pr; else await k.sleep(300) }
  check('the server has the profile (name, bio, accent)', sp && sp.bio === `bio ${stamp}` && sp.accentColor === accent1.toLowerCase(), JSON.stringify(sp && { n: sp.displayName, b: sp.bio, c: sp.accentColor }))
  await a.reload()
  check('after a reload the profile reads back', await a.until((v) => document.querySelector('#profile-display-name')?.value === v, newName, 15000) && (await a.value('#profile-bio')) === `bio ${stamp}`)
  // put it back
  await a.type('#profile-display-name', name0 || '')
  await a.type('#profile-bio', bio0 || '')
  await a.click(accent0, { within: '[aria-labelledby="profile-accent-label"]' })
  await a.click('Save', { within: 'body', kind: 'button' })
  await a.until(() => ![...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Discard'), null, 8000)
  let sp2 = null
  for (let i = 0; i < 20; i++) { sp2 = (await api.get('/settings/profile')).data?.profile || {}; if ((sp2.displayName || '') === (serverProfile0.displayName || name0 || '')) break; await k.sleep(300) }
  check('…and the profile is put back as it was', (sp2.displayName || '') === (serverProfile0.displayName ?? (name0 || '')) && (sp2.bio || '') === (serverProfile0.bio ?? (bio0 || '')) && (sp2.accentColor || 'emerald') === (serverProfile0.accentColor || 'emerald'), JSON.stringify({ was: { n: serverProfile0.displayName, b: serverProfile0.bio, c: serverProfile0.accentColor }, now: { n: sp2.displayName, b: sp2.bio, c: sp2.accentColor } }))

  // ---- Appearance: the mode -------------------------------------------------------------------
  const isLight = () => a.page.evaluate(() => document.documentElement.classList.contains('light'))
  await a.click('Light', { within: '[role="radiogroup"][aria-label="Mode"]' })
  check('Light turns the light look on (and is the checked radio)', await a.until(() => document.documentElement.classList.contains('light'), null, 4000) && await a.page.evaluate(() => document.querySelector('[aria-label="Mode"] [aria-checked="true"]')?.textContent.trim() === 'Light'))
  await a.shot('settings-light-appearance')
  await a.click('System', { within: '[role="radiogroup"][aria-label="Mode"]' })
  const sysWant = await a.page.evaluate(() => !window.matchMedia('(prefers-color-scheme: dark)').matches)
  check('System follows the device', await a.until((w) => document.documentElement.classList.contains('light') === w, sysWant, 4000) && (await appSettings(a)).theme === 'system')
  await a.click('Dark', { within: '[role="radiogroup"][aria-label="Mode"]' })
  check('Dark turns the dark look on', await a.until(() => !document.documentElement.classList.contains('light'), null, 4000))
  void isLight

  // ---- Appearance: the background (no outside image is loaded) ----------------------------------
  await a.type('Background image address', 'not an address', SECTION('Appearance'))
  check('a background that is not a web address is refused with a message (regression)', await a.waitText("Use an image's web address", { within: SECTION('Appearance'), ms: 3000 }) && await a.page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Apply')?.disabled, SECTION('Appearance')))
  // a same-origin image: nothing outside is loaded, and a tab of the same account never logs a failed request
  await a.type('Background image address', BG, SECTION('Appearance'))
  await a.click('Apply', { within: SECTION('Appearance') })
  const bgSet = await a.until((bg) => { try { return Object.entries(localStorage).some(([kk, v]) => kk.startsWith('user-profile') && v.includes(bg)) } catch { return false } }, BG, 4000)
  check('Apply keeps the background address', bgSet)
  const clearCls = await a.page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('button')].find((b) => b.textContent.trim() === 'Clear')?.className || '', SECTION('Appearance'))
  check('Clear (not destructive) is a quiet button, not rose (regression)', clearCls && !/rose/.test(clearCls), clearCls)
  await a.click('Clear', { within: SECTION('Appearance') })
  check('Clear removes the background', await a.until((bg) => !Object.entries(localStorage).some(([kk, v]) => kk.startsWith('user-profile') && v.includes(bg)), BG, 4000))
  let bgSrv = 'x'
  for (let i = 0; i < 20 && bgSrv; i++) { bgSrv = (await api.get('/settings/profile')).data?.profile?.backgroundImage || ''; if (bgSrv) await k.sleep(300) }
  check('…on the server too', !bgSrv, bgSrv)
  check('the "None" preset is the one pressed', await a.page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('button[aria-pressed="true"]')].some((b) => b.textContent.trim() === 'None'), SECTION('Appearance')))

  // ---- Sidebar & pages ---------------------------------------------------------------------------
  const img = (await a.page.evaluate(switchIn, { sel: SECTION('Sidebar & pages'), label: 'Images', press: true })) !== null
  check('Sidebar & pages: Images can be hidden', img && await a.until(() => (JSON.parse(localStorage.getItem('app-settings') || '{}').hiddenPages || []).includes('images'), null, 4000))
  check('…and "Show all" brings it back', await a.click(/^Show all/i, { within: SECTION('Sidebar & pages'), ms: 5000 }) && await a.until(() => !(JSON.parse(localStorage.getItem('app-settings') || '{}').hiddenPages || []).length, null, 4000))

  // ---- Application preferences -----------------------------------------------------------------------
  const prefs = SECTION('Application preferences')
  const pollFields = await a.page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('input, label')].filter((e) => /polling/i.test(e.getAttribute('aria-label') || e.textContent || '')).length + (/Polling intervals/i.test(document.querySelector(sel).innerText) ? 1 : 0), prefs)
  check('Application preferences offers no polling fields (they changed nothing; regression)', pollFields === 0, String(pollFields))
  const startSel = await a.page.$(`${prefs} select`)
  const start0 = await startSel.evaluate((s) => s.value)
  const start1 = start0 === 'stacks' ? 'containers' : 'stacks'
  await startSel.select(start1)
  check(`Start on → ${start1} is kept`, await a.until((v) => JSON.parse(localStorage.getItem('app-settings') || '{}').defaultPage === v, start1, 4000))
  await startSel.select(start0); await startSel.dispose()
  check('…and put back', await a.until((v) => JSON.parse(localStorage.getItem('app-settings') || '{}').defaultPage === v, start0, 4000))
  for (const [label, key] of [['24-hour clock', 'use24hClock'], ['Reduce motion', 'reduceMotion'], ['Sidebar collapsed', 'sidebarCollapsed']]) {
    const f1 = await flip(a, 'Application preferences', label)
    check(`${label}: the switch changes the setting`, f1.ok && f1.after === !f1.before && f1.store1[key] === f1.after, JSON.stringify({ b: f1.before, a: f1.after, stored: f1.store1[key] }))
    const f2 = await flip(a, 'Application preferences', label)
    check(`${label}: switching it back puts it back`, f2.after === f1.before && (f2.store1[key] ?? f1.before) === f1.before, JSON.stringify({ was: f1.before, now: f2.after, stored: f2.store1[key] }))
  }
  check('Reset to defaults keeps the sidebar open', await a.click('Reset to defaults', { within: prefs }) && (await appSettings(a)).sidebarCollapsed === false)

  // ---- Notification preferences ----------------------------------------------------------------------
  for (const label of ['Health alerts', 'Connection alerts', 'Container crash alerts']) {
    const f1 = await flip(a, 'Notification preferences', label)
    check(`notification preference "${label}" flips`, f1.ok && f1.after === !f1.before, JSON.stringify(f1))
    const f2 = await flip(a, 'Notification preferences', label)
    check(`…"${label}" is put back`, f2.after === f1.before)
  }

  // ---- Lock & session ----------------------------------------------------------------------------------
  const lock = SECTION('Lock & session')
  const checkedIn = () => a.page.evaluate((sel) => [...document.querySelector(sel).querySelectorAll('[role="radio"][aria-checked="true"]')].map((b) => b.textContent.trim()), lock)
  const lock0 = await checkedIn()
  check('Lock & session shows the auto-lock and the session length (one checked each)', lock0.length === 2, JSON.stringify(lock0))
  const autoTo = lock0[0] === '15 min' ? '30 min' : '15 min'
  const sessTo = lock0[1] === '12h' ? '4h' : '12h'
  await a.click(autoTo, { within: lock }); await a.click(sessTo, { within: lock })
  check(`auto-lock ${autoTo} and session ${sessTo} are chosen`, await a.until(({ sel, w }) => JSON.stringify([...document.querySelector(sel).querySelectorAll('[role="radio"][aria-checked="true"]')].map((b) => b.textContent.trim())) === JSON.stringify(w), { sel: lock, w: [autoTo, sessTo] }, 4000), JSON.stringify(await checkedIn()))
  await a.reload()
  check('…kept after a reload', JSON.stringify(await checkedIn()) === JSON.stringify([autoTo, sessTo]), JSON.stringify(await checkedIn()))
  await a.click(lock0[0], { within: lock }); await a.click(lock0[1], { within: lock })
  check('…and put back', await a.until(({ sel, w }) => JSON.stringify([...document.querySelector(sel).querySelectorAll('[role="radio"][aria-checked="true"]')].map((b) => b.textContent.trim())) === JSON.stringify(w), { sel: lock, w: lock0 }, 4000))
  const ru1 = await flip(a, 'Lock & session', 'Remember username')
  const ru2 = await flip(a, 'Lock & session', 'Remember username')
  check('Remember username flips and back', ru1.ok && ru1.after === !ru1.before && ru2.after === ru1.before && (ru2.store1.rememberUsername ?? ru1.before) === ru1.before)

  // ---- Keyboard shortcuts ---------------------------------------------------------------------------------
  check('Keyboard shortcuts lists the shortcuts', /Command palette/i.test(await a.text(SECTION('Keyboard shortcuts'))))

  // ---- Alert thresholds: validation only (server-wide: never saved here) ------------------------------------
  const thr = SECTION('Alert thresholds')
  await a.type('Container restart threshold', '0', thr)
  check('a restart count of 0 is said (regression: an empty field saved 0)', await a.waitText(/Restarts: use a whole number from 1 to 50/, { within: thr, ms: 3000 }))
  await a.click('Save', { within: 'body', kind: 'button' })
  check('Save refuses the thresholds with the reason, nothing sent', await a.waitToast(/Alert thresholds not saved/, 6000) && !a.requests.some((r) => r.method === 'POST' && r.path === '/alerts/config'))
  await a.click('Discard', { within: 'body', kind: 'button' })
  check('Discard puts the thresholds back', await a.until((sel) => !document.querySelector(sel)?.querySelector('[role="alert"]'), thr, 4000))

  // ---- Themes -------------------------------------------------------------------------------------------------
  const theme0 = (await appSettings(a)).themeName
  check('the themes panel lists the stock themes', await a.exists('Wear Nord, Polar Night', { within: 'main' }) && await a.exists('Wear DCS Emerald, Slate', { within: 'main' }))
  await a.click('Wear Nord, Polar Night', { within: 'main' })
  check('wearing Nord changes the theme', await a.until((t0) => JSON.parse(localStorage.getItem('app-settings') || '{}').themeName !== t0, theme0, 5000), JSON.stringify((await appSettings(a)).themeName))
  await k.sleep(400); await a.shot('settings-theme-nord')
  const n0 = a.errors.length
  await a.click('Copy the JSON of Nord', { within: 'main' })
  check('Copy the JSON says what happened (copied, or that the browser refused), no console error', !!(await a.waitToast(/JSON copied|Could not copy/, 6000)) && a.errors.length === n0, JSON.stringify(await a.toasts()))
  await a.click('Wear DCS Emerald, Slate', { within: 'main' })
  check('wearing DCS Emerald again', await a.until(() => /emerald|^$|default/i.test(JSON.parse(localStorage.getItem('app-settings') || '{}').themeName || ''), null, 5000), (await appSettings(a)).themeName)

  // ---- everything put back ----------------------------------------------------------------------------------------
  if ((await appSettings(a)).theme !== s0.theme && s0.theme) await a.click(s0.theme[0].toUpperCase() + s0.theme.slice(1), { within: '[role="radiogroup"][aria-label="Mode"]' })
  for (const t of folded) await toggleSection(t)
  await k.sleep(600)
  const s1 = pick(await appSettings(a))
  // a key the device had not stored yet (null) holds its default: only a stored choice must come back to the same value
  const drift = SNAP_KEYS.filter((kk) => s0[kk] != null && JSON.stringify(s0[kk]) !== JSON.stringify(s1[kk]) && !(kk === 'themeName' && /emerald/i.test(String(s1[kk])) && !s0[kk]))
  check('every setting is as it was', !drift.length, JSON.stringify(drift.map((kk) => [kk, s0[kk], s1[kk]])))

  const bgEnd = (await api.get('/settings/profile')).data?.profile?.backgroundImage || ''
  check('the server profile has no background left', !bgEnd, bgEnd)
  if (bgEnd) { const pr = (await api.get('/settings/profile')).data.profile; await api.post('/settings/profile', { profile: { ...pr, backgroundImage: '' } }) }

  // ---- a viewer: their own device and profile -------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('the page opens for a viewer', await v.go('settings') && (await v.h1()) === 'Settings')
  const vs = await v.page.evaluate(() => [...document.querySelectorAll('main h2 button[aria-expanded]')].map((b) => b.innerText.trim()))
  const adminOnly = ['Server connection', 'Disk configuration', 'Alert thresholds', 'Backup & restore', 'Web terminal']
  check('a viewer is not offered the server-wide sections', !vs.some((s) => adminOnly.includes(s)), JSON.stringify(vs))
  const vb = await v.page.evaluate(() => [...document.querySelectorAll('main button')].map((b) => b.getAttribute('aria-label') || b.innerText.trim()))
  check('a viewer is not offered "Set … for everyone" nor the server\'s chat switches', !vb.some((n) => /for everyone$/.test(n)) && !/Chat on this server|Users may write/.test(await v.text('main')), JSON.stringify(vb.filter((n) => /everyone/.test(n))))
  check('a viewer\'s Application preferences has no polling fields either', !/polling/i.test(await v.text(SECTION('Application preferences'))))

  // ---- phone + light -------------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone', theme: 'light' })
  await p.go('settings')
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  await p.type('#profile-display-name', `${newName}-p`)
  const bar = await p.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^(Save|Discard)$/.test(b.textContent.trim())).map((b) => { const r = b.getBoundingClientRect(); return { h: Math.round(r.height), right: Math.round(r.right) } }))
  check('phone: the save bar fits, its buttons reachable', bar.length === 2 && bar.every((b) => b.right <= 390), JSON.stringify(bar))
  await k.sleep(400); await p.shot('settings-phone-light-savebar')
  await p.click('Discard', { within: 'body', kind: 'button' })
  check('phone + light (screenshot)', !!(await p.shot('settings-phone-light')))
}
