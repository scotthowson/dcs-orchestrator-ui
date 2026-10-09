// A viewer presses everything. Signed in as a viewer (role "user"), every page a viewer may open is walked and each
// control on it pressed, the way a curious person would — safe here, since the server refuses a viewer every change.
// What a viewer is offered must work for a viewer: no press may be answered 403 (an admin's action or an admin's
// data), no confirmation may ask a viewer to do what only an admin may, and no link may lead to a page a viewer is
// sent away from. The Settings page is the viewer's own device settings and is walked by settings.mjs instead.

const PAGES = ['dashboard', 'stacks', 'templates', 'proxmox', 'topology', 'containers', 'images', 'volumes', 'networks', 'disk-analysis',
  'health', 'trends', 'diagnostics', 'activity', 'logs', 'crowdsec', 'updates', 'automations', 'bookmarks', 'notifications', 'system']
// never pressed: they end the session or leave the page's own controls (the strip, the scope, the chat)
const SKIP = /^(sign out|lock screen|back to top|open the chat|chat|close|cancel|dismiss)$|^(everywhere|hub|media-vm)$/i
// a list repeats its row actions: two of each verb are enough
const verbOf = (n) => n.split(' ')[0].toLowerCase()

export default async function viewerCensus(k) {
  const { check } = k
  const v = await k.open(k.VIEWER)
  const adminPages = new Set([...k.ADMIN_ONLY].map((p) => p))
  for (const pageId of PAGES) {
    if (!(await v.go(pageId))) { check(`${pageId}: opens for a viewer`, false, await v.h1()); continue }
    const strip = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
    const names = await v.page.evaluate(() => {
      const vis = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && !el.closest('[aria-hidden="true"], [inert]')
      const nm = (el) => (el.getAttribute('aria-label') || el.innerText || el.getAttribute('title') || '').trim().replace(/\s+/g, ' ')
      return [...document.querySelectorAll('main button, main [role="button"], main [role="switch"], main a[href]')]
        .filter((el) => vis(el) && !el.disabled && !el.closest('nav[aria-label$=" pages"]')).map(nm).filter(Boolean)
    })
    const seen = new Map()
    const todo = []
    for (const n of names) {
      if (SKIP.test(n) || strip.includes(n)) continue
      const verb = verbOf(n)
      const c = seen.get(verb) || 0
      if (/^(restart|stop|start|wake|delete|remove|favorite|copy|export|view|inspect|hide)$/.test(verb) && c >= 2) continue
      seen.set(verb, c + 1)
      if (!todo.includes(n)) todo.push(n)
    }
    // filters, sorts and views change what the page lists: pressed last, so the rows are there for the rest
    const isFilter = (n) => /^[A-Za-z][A-Za-z ]* \d+$|^[A-Z ()]{3,}$|^(all|running|stopped|asleep|paused|healthy|unhealthy|table|cards|grid|list)$/i.test(n)
    todo.sort((x, y) => Number(isFilter(x)) - Number(isFilter(y)))
    let pressed = 0
    for (const name of todo.slice(0, 80)) {
      if ((await v.h1()) !== (await headingOf(v, pageId))) await v.go(pageId)
      const before = { forbidden: v.forbidden.length, req: v.requests.length, h1: await v.h1(), errors: v.errors.length }
      let el = await v.find(name, { within: 'main', kind: 'button' }) || await v.find(name, { within: 'main' })
      if (!el) { await v.reload(); el = await v.find(name, { within: 'main', kind: 'button' }) || await v.find(name, { within: 'main' }) }
      if (!el) { k.j.note(`${pageId}: "${name}" was gone after a reload`); continue }
      await el.evaluate((e) => { e.scrollIntoView({ block: 'center' }); e.click() }).catch(() => {})
      await el.dispose().catch(() => {})
      pressed++
      await k.sleep(900)
      const outcome = []
      // a confirmation: say yes (the server refuses a viewer anything it may not do) and see what it answers
      const conf = await v.confirmInfo()
      if (conf) {
        const yes = conf.buttons.find((b) => !/^cancel$/i.test(b))
        await v.click(yes, { within: '[role="alertdialog"]', ms: 3000 })
        await k.sleep(1500)
        outcome.push(`asked "${conf.title}"`)
      }
      const d = await v.dialogs()
      if (d.length) outcome.push(`opened "${d[d.length - 1].title}"`)
      const h1 = await v.h1()
      const bounced = h1 === 'Dashboard' && before.h1 !== 'Dashboard'
      const newForbidden = v.forbidden.slice(before.forbidden)
      const writes = v.requests.slice(before.req).filter((r) => r.method !== 'GET').map((r) => `${r.method} ${r.path}`)
      // close what opened, go back to the page
      for (let i = 0; i < 3 && (await v.dialogs()).length; i++) { await v.key('Escape'); await k.sleep(300) }
      const newErrors = v.errors.slice(before.errors)
      const ok = !newForbidden.length && !bounced && !newErrors.length
      check(`${pageId}: "${name}" is a viewer's to press`, ok,
        [newForbidden.length ? `403 ${[...new Set(newForbidden)].join(', ')}` : '', bounced ? 'sent to the dashboard' : '', newErrors.length ? `console: ${newErrors.join(' | ')}` : '', ...outcome, writes.length ? `sent ${writes.join(', ')}` : ''].filter(Boolean).join('; '))
      if (h1 !== before.h1 && !bounced) k.j.note(`${pageId}: "${name}" → ${h1}`)
    }
    k.j.note(`${pageId}: ${pressed} controls pressed of ${names.length}`)
    void adminPages
  }
}

async function headingOf(t, pageId) {
  const map = { 'disk-analysis': 'Disk Analysis', automations: 'Automation', crowdsec: 'CrowdSec', proxmox: 'Proxmox' }
  return map[pageId] || pageId.charAt(0).toUpperCase() + pageId.slice(1)
}
