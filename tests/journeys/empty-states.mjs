// A server with nothing on it (the lab's empty API: set up, no stacks, no containers, no images): every page that
// lists something says so the kit's way (EmptyState: one line, one hint, a next step) — never a blank page, a
// spinner that stays, a failure, or leaked "undefined" / "NaN". The empty API is EMPTY_API (tests/lab/lab.sh).

const EMPTY = process.env.EMPTY_API || 'http://127.0.0.1:41924'
// the pages that list something, and whether their empty state must be a kit EmptyState
const LISTS = ['stacks', 'containers', 'images', 'volumes', 'health', 'bookmarks', 'secrets', 'automations', 'backup', 'plugins', 'topology', 'logs']
const OTHERS = ['dashboard', 'templates', 'environment', 'proxmox', 'networks', 'disk-analysis', 'trends', 'diagnostics', 'activity', 'crowdsec',
  'dns', 'users', 'updates', 'export', 'maintenance', 'terminal', 'file-browser', 'settings', 'notifications', 'config', 'system']

export default async function emptyStates(k) {
  const { check } = k
  let up = false
  try { up = (await (await fetch(`${EMPTY}/setup/status`)).json()).initialized === true } catch { /* not running */ }
  if (!check('the lab\'s empty API answers', up, EMPTY)) return
  for (const [width, theme] of [['desktop', 'dark'], ['phone', 'light']]) {
    const t = await k.open(k.ADMIN, { api: EMPTY, width, theme })
    for (const pageId of [...LISTS, ...OTHERS]) {
      if (width === 'phone' && !LISTS.includes(pageId)) continue
      await t.go(pageId)
      // the first answer is in: no skeleton or spinner left in the page
      const loaded = await t.until(() => ![...document.querySelectorAll('main [aria-busy="true"], main .animate-spin, main .skeleton')].some((e) => e.getClientRects().length), null, 20000)
      const s = await t.page.evaluate(() => {
        const main = document.querySelector('main')
        const vis = (e) => e.getClientRects().length && !e.closest('[aria-hidden="true"]')
        return {
          empty: [...main.querySelectorAll('[data-state="empty"]')].filter(vis).map((e) => e.innerText.trim().replace(/\s+/g, ' ').slice(0, 90)),
          error: [...main.querySelectorAll('[data-state="error"]')].filter(vis).map((e) => e.innerText.trim().replace(/\s+/g, ' ').slice(0, 120)),
          leaked: /\bundefined\b|\bNaN\b|\[object Object\]/.test(main.innerText),
          text: main.innerText.length,
        }
      })
      const label = `${pageId} (${width}, ${theme})`
      if (LISTS.includes(pageId)) check(`${label}: says it is empty the kit's way`, s.empty.length > 0 && loaded, s.empty[0] || `no EmptyState; loaded ${loaded}`)
      check(`${label}: no failure shown on an empty server`, !s.error.length, s.error.join(' | '))
      check(`${label}: no leaked value`, !s.leaked && s.text > 20)
      if (width === 'phone') check(`${label}: no sideways scroll`, !(await t.overflow()), await t.overflow())
      if (['stacks', 'containers', 'dashboard', 'images'].includes(pageId)) await t.shot(`empty-${pageId}-${width}-${theme}`)
    }
  }
}
