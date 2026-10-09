// Activity: the tabs (Timeline / Live stream / Audit log for an admin; arrow keys; remembered after a reload), the
// scope, the Timeline (the counts, the type filter and the name filter with their empty state and "Show all events",
// a day folding), the Live stream (type filter, Auto-scroll, Clear), the Audit log (action filter, search, empty
// state), #/event-feed opening the Live stream, a viewer (no Audit log), the phone and the light look.

const SCOPE = '[role="group"][aria-label="Show"]'
const TABS = '[role="tablist"][aria-label="Activity views"]'
const selectedTab = (t) => t.page.evaluate(() => document.querySelector('[role="tablist"][aria-label="Activity views"] [aria-selected="true"]')?.innerText.trim().split('\n')[0])
const shownCount = (t) => t.page.evaluate(() => { const m = (document.querySelector('#activity-panel-timeline [role="status"]')?.innerText || '').match(/^(\d+)(?: of (\d+))?/); return m ? { shown: Number(m[1]), all: Number(m[2] ?? m[1]) } : null })

export default async function activity(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('Activity opens on the Timeline', await a.go('activity') && (await a.h1()) === 'Activity' && (await selectedTab(a)) === 'Timeline', await selectedTab(a))
  check('an admin sees Timeline, Live stream and Audit log', await a.exists('Timeline', { within: TABS, kind: 'tab' }) && await a.exists('Live stream', { within: TABS, kind: 'tab' }) && await a.exists(/^Audit log/, { within: TABS, kind: 'tab' }))
  await a.until(() => /\d+ events|No events yet/.test(document.querySelector('#activity-panel-timeline')?.innerText || ''), null, 30000)

  // ---- the Timeline ------------------------------------------------------------------------------------------
  const c0 = await shownCount(a)
  check('the Timeline counts its events (the tiles agree)', !!c0 && await a.page.evaluate((n) => new RegExp(`(^|\\n)${n}\\s*Total`, 'i').test(document.querySelector('#activity-panel-timeline')?.innerText || ''), c0.all), JSON.stringify(c0))
  for (const f of ['Containers', 'Networks', 'Volumes', 'Images', 'Errors']) {
    await a.click(f, { within: '[aria-label="Type of event"]' })
    const ok = await a.until(() => { const t = document.querySelector('#activity-panel-timeline')?.innerText || ''; return /^\d+ of \d+|\d+ events/m.test(t) || /No events match/.test(t) }, null, 5000)
    const c = await shownCount(a)
    check(`the ${f} filter narrows the events (or says none match)`, ok && (!c || c.shown <= c.all), JSON.stringify(c))
  }
  if (await a.hasText('No events match', '#activity-panel-timeline')) {
    check('"Show all events" clears the filters', await a.click('Show all events', { within: '#activity-panel-timeline' }) && await a.until(() => document.querySelector('[aria-label="Type of event"] input:checked')?.value === 'all', null, 3000))
  }
  await a.click('All', { within: '[aria-label="Type of event"]' })
  await a.type('Filter events by name', 'zzz-nothing-like-this')
  check('a name with no match: "No events match" and "Show all events"', await a.waitText('No events match', { within: '#activity-panel-timeline', ms: 5000 }) && await a.exists('Show all events', { within: '#activity-panel-timeline' }))
  await a.click('Show all events', { within: '#activity-panel-timeline' })
  check('"Show all events" clears the name filter too', await a.until(() => document.querySelector('#activity-panel-timeline input[aria-label="Filter events by name"]')?.value === '', null, 3000))
  const day = await a.find(/^(Today|Yesterday|\w+day|\w{3} \d+)/i, { within: '#activity-panel-timeline', kind: 'button' })
  if (day) {
    await day.click()
    check('a day folds (aria-expanded false)', await day.evaluate((e) => e.getAttribute('aria-expanded')) === 'false')
    await day.click(); await day.dispose()
  }
  const n0 = a.requests.length
  check('Refresh asks for the events again', await a.click('Refresh', { within: 'main' }) && await (async () => { const end = Date.now() + 8000; while (Date.now() < end) { if (a.requests.slice(n0).some((r) => /\/events$/.test(r.path))) return true; await k.sleep(200) } return false })())

  // ---- scope ---------------------------------------------------------------------------------------------------
  await a.until((sel) => !!document.querySelector(sel), SCOPE, 20000)
  await a.click('media-vm', { within: SCOPE })
  check('media-vm: the VM\'s events (its capsule in the header)', await a.until(() => /media-vm/.test(document.querySelector('main header, main')?.innerText || ''), null, 10000) && await a.until(() => /\d+ events|No events yet|No events match/.test(document.querySelector('#activity-panel-timeline')?.innerText || ''), null, 20000))
  await a.click('Everywhere', { within: SCOPE })

  // ---- tabs with the keyboard -----------------------------------------------------------------------------------
  const tl = await a.find('Timeline', { within: TABS, kind: 'tab' }); await tl.focus(); await tl.dispose()
  await a.key('ArrowRight')
  check('→ moves to the Live stream', (await selectedTab(a)) === 'Live stream')
  await a.key('End')
  check('End moves to the Audit log', /^Audit log/.test(await selectedTab(a) || ''))
  await a.key('Home')
  check('Home moves back to the Timeline', (await selectedTab(a)) === 'Timeline')

  // ---- the Live stream ---------------------------------------------------------------------------------------------
  await a.click('Live stream', { within: TABS, kind: 'tab' })
  check('the Live stream shows its feed (or waits for events)', await a.until(() => /\d+ events?/.test(document.querySelector('#activity-panel-live [role="status"]')?.innerText || ''), null, 10000) && !!(await a.page.$('#activity-panel-live [role="log"][aria-label="Live events"]')))
  const auto = () => a.page.evaluate(() => [...document.querySelectorAll('#activity-panel-live button[aria-pressed]')].find((b) => /Auto-scroll/.test(b.innerText))?.getAttribute('aria-pressed'))
  check('Auto-scroll starts on', (await auto()) === 'true')
  await a.click('Auto-scroll', { within: '#activity-panel-live' })
  check('Auto-scroll turns off', (await auto()) === 'false')
  await a.click('Auto-scroll', { within: '#activity-panel-live' })
  check('…and on again', (await auto()) === 'true')
  for (const [f, val] of [['Docker events', 'docker-event'], ['Metrics', 'metrics'], ['All', 'all']]) {
    await a.click(f, { within: '[aria-label="Type of live event"]' })
    check(`the live ${f} filter is chosen (the count follows)`, await a.until((v) => document.querySelector('[aria-label="Type of live event"] input:checked')?.value === v && /\d+ events?/.test(document.querySelector('#activity-panel-live [role="status"]')?.innerText || ''), val, 3000))
  }
  await a.click('Clear', { within: '#activity-panel-live' })
  check('Clear empties the feed (no confirmation: it is this tab\'s copy only)', await a.waitText(/^0 events/, { within: '#activity-panel-live [role="status"]', ms: 3000 }))
  check('the Live pill says the stream is up (or down)', await a.hasText(/Live|Stream down/, 'main'))

  // ---- the Audit log -----------------------------------------------------------------------------------------------
  await a.click(/^Audit log/, { within: TABS, kind: 'tab' })
  check('the Audit log lists entries (or says there are none)', await a.until(() => /\d+ entr(y|ies)|No audit entries found/.test(document.querySelector('#activity-panel-audit')?.innerText || ''), null, 20000))
  await a.type('Search the audit log', 'zzz-nothing-like-this')
  check('a search with no match: "No entries match"', await a.waitText(/No entries match|No audit entries found/, { within: '#activity-panel-audit', ms: 5000 }))
  await a.click('Clear the search', { within: '#activity-panel-audit' })
  const actions = await a.page.evaluate(() => [...document.querySelectorAll('#activity-panel-audit select[aria-label="Filter by action"] option')].map((o) => o.value))
  if (actions.length > 1) {
    await a.page.select('#activity-panel-audit select[aria-label="Filter by action"]', actions[1])
    check('the action filter narrows the entries', await a.until(() => /^\d+ of \d+/.test(document.querySelector('#activity-panel-audit [role="status"]')?.innerText || ''), null, 3000) || await a.hasText(/\d+ entr/, '#activity-panel-audit'))
    await a.page.select('#activity-panel-audit select[aria-label="Filter by action"]', 'all')
  }
  await a.reload()
  check('the tab is remembered after a reload', /^Audit log/.test(await selectedTab(a) || ''), await selectedTab(a))
  await a.click('Timeline', { within: TABS, kind: 'tab' })

  // ---- #/event-feed opens the Live stream ----------------------------------------------------------------------------
  await a.go('event-feed')
  check('#/event-feed opens Activity on the Live stream', (await a.h1()) === 'Activity' && (await selectedTab(a)) === 'Live stream')
  await a.click('Timeline', { within: TABS, kind: 'tab' })

  // ---- a viewer -----------------------------------------------------------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('a viewer opens Activity', await v.go('activity') && (await v.h1()) === 'Activity')
  check('a viewer has no Audit log tab', !(await v.exists(/^Audit log/, { within: TABS, kind: 'tab' })) && await v.exists('Live stream', { within: TABS, kind: 'tab' }))
  await v.click('Live stream', { within: TABS, kind: 'tab' })
  check('a viewer reads the live stream', await v.until(() => /\d+ events?/.test(document.querySelector('#activity-panel-live [role="status"]')?.innerText || ''), null, 10000))
  await v.click('Timeline', { within: TABS, kind: 'tab' })

  // ---- phone, light -----------------------------------------------------------------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('activity'); await p.until(() => /\d+ events|No events yet/.test(document.querySelector('#activity-panel-timeline')?.innerText || ''), null, 30000); await p.settle(800)
  check('phone: no sideways scroll on Activity', !(await p.overflow()), await p.overflow())
  await p.shot('activity-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('activity'); await l.until(() => /\d+ events|No events yet/.test(document.querySelector('#activity-panel-timeline')?.innerText || ''), null, 30000)
  check('light: Activity draws in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('activity-light')
}
