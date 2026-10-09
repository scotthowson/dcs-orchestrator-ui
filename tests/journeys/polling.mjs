// No page asks more often than docs/data-layer.md says. Each page is left alone for a while (as an admin, who polls
// the most) and every API request in a quiet window is counted per path: no path may be asked more often than its
// documented interval allows (identical GETs on their way at once are one request, shared polls are one stream).
// Then the tab is hidden: the polls pause (the heartbeat, the live stream and the few that run hidden on purpose
// apart) and ask again when it shows.

const WINDOW = Number(process.env.POLL_WINDOW || 30) * 1000
// the shortest interval any poll of a path asks for (data-layer.md "Intervals per page" and "The shared requests")
const LIMITS = [
  [/^\/ping$/, 10],
  [/^\/fleet\/status$/, 30],
  [/^\/fleet\/members$/, 15],
  [/^\/fleet\/overview$/, 15],
  [/^\/containers$/, 10],
  [/^\/version$/, 600],
  [/^\/system\/os-updates$/, 600],
  [/^\/crowdsec\/community/, 600],
  [/^\/images\/check-updates$/, 120],
  [/^\/dns\/status$/, 120],
  [/^\/routes$/, 60],
  [/^\/chat\/presence/, 30],
  [/^\/stream$/, 0],          // one long request, reconnects with a backoff
  [/^\/logs$/, 3],            // the Logs page's tail: 3 s (5 s for a VM)
  [/./, 5],                   // nothing in the docs asks more often than every 5 s outside a CrowdSec deploy
]
const limitOf = (path) => LIMITS.find(([re]) => re.test(path))[1]
// asked while the tab is hidden, on purpose (data-layer.md "Hidden tab")
const HIDDEN_OK = /^\/(ping|stream|chat\/|version$|system\/update\/check$|plugins\/)/

const GROUPS = [
  ['dashboard', 'stacks', 'templates', 'environment', 'proxmox', 'topology', 'containers', 'images', 'volumes', 'networks', 'disk-analysis'],
  ['health', 'trends', 'diagnostics', 'activity', 'logs', 'crowdsec', 'dns', 'secrets', 'users', 'updates', 'backup'],
  ['export', 'maintenance', 'automations', 'terminal', 'file-browser', 'bookmarks', 'plugins', 'settings', 'notifications', 'config', 'system'],
]

export default async function polling(k) {
  const { check } = k
  const table = []
  await Promise.all(GROUPS.map(async (pages, gi) => {
    const t = await k.open(k.ADMIN)
    for (const pageId of pages) {
      await t.go(pageId)
      await k.sleep(8000)
      const from = t.requests.length
      const t0 = Date.now()
      await k.sleep(WINDOW)
      const span = (Date.now() - t0) / 1000
      const win = t.requests.slice(from).filter((r) => r.origin === k.API)
      const byPath = new Map()
      // a path with another query is another request (/health and /health?fleet=1 are two polls)
      for (const r of win) { const key = `${r.method} ${r.path}${r.search || ''}`; byPath.set(key, (byPath.get(key) || 0) + 1) }
      const over = []
      for (const [key, n] of byPath) {
        const [method, full] = key.split(' ')
        const path = full.split('?')[0]
        const lim = limitOf(path)
        const allowed = lim === 0 ? 2 : Math.floor(span / lim) + 1
        if (method === 'GET' && n > allowed) over.push(`${full} ${n}× in ${Math.round(span)} s (every ${lim} s at most → ${allowed})`)
      }
      const perMin = Math.round(win.length * 60 / span)
      table.push({ page: pageId, perMin, top: [...byPath.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p, n]) => `${p.replace('GET ', '')} ${n}`).join(', ') })
      check(`${pageId}: no request more often than documented`, !over.length, over.join('; '))
      void gi
    }
    // the hidden tab: polls pause
    await t.go('dashboard')
    await k.sleep(5000)
    await t.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    await k.sleep(3000)
    const from = t.requests.length
    await k.sleep(25000)
    const hiddenReqs = t.requests.slice(from).filter((r) => r.origin === k.API && r.method === 'GET' && !HIDDEN_OK.test(r.path))
    check(`a hidden tab pauses its polls (group ${gi + 1})`, hiddenReqs.length <= 2, hiddenReqs.map((r) => r.path).slice(0, 8).join(', '))
    const at = t.requests.length
    await t.page.evaluate(() => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    const resumed = await t.until((n) => n, null, 1)  // a tick
    void resumed
    await k.sleep(4000)
    const back = t.requests.slice(at).filter((r) => r.origin === k.API && !HIDDEN_OK.test(r.path))
    check(`…and asks again at once when it shows (group ${gi + 1})`, back.length > 0, `${back.length} requests in 4 s`)
  }))
  table.sort((a, b) => b.perMin - a.perMin)
  k.j.note('requests per minute (admin, idle): ' + table.map((r) => `${r.page} ${r.perMin}`).join(', '))
  for (const r of table.slice(0, 8)) k.j.note(`${r.page}: ${r.top}`)
}
