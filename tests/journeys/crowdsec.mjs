// CrowdSec. In the lab CrowdSec is not deployed, so the page is its invitation: the four steps, the pre-flight, and the
// deploy form (stack, "Block bans at Traefik", Deploy CrowdSec). An admin gets the form (the deployment itself is never
// sent here); a viewer is told an admin deploys it and is offered none of it (the server answers a viewer 403 for a
// deploy). The scope chips pick the hub or the VM; Refresh asks again; the Templates link opens the template.

const MAIN = 'main'
/** the tab sent a request to `path` since request number `from` */
async function asked(k, t, from, path, ms = 8000) {
  for (const end = Date.now() + ms; Date.now() < end; await k.sleep(200)) if (t.requests.slice(from).some((r) => r.path === path)) return true
  return false
}

export default async function crowdsec(k) {
  const { check } = k
  const a = await k.open(k.ADMIN)
  check('admin: the page opens', await a.go('crowdsec') && (await a.h1()).startsWith('CrowdSec'), await a.h1())
  check('admin: the not-deployed invitation is shown', await a.waitText('CrowdSec is not deployed yet', { within: MAIN, ms: 30000 }))
  check('admin: the section strip names CrowdSec, DNS & Routes, Secrets and Users', await a.until(() => {
    const t = [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim())
    return ['CrowdSec', 'DNS & Routes', 'Secrets', 'Users'].every((n) => t.some((x) => x.startsWith(n)))
  }, null, 8000))
  check('admin: the pre-flight lists what was checked', await a.waitText('Docker answers', { within: MAIN, ms: 15000 }) && await a.hasText('The CrowdSec template is available', MAIN))
  check('admin: the four steps explain what it does', ['It reads the log', 'It decides', 'Traefik blocks', 'You hear about it'].every((s) => a.page.evaluate((s) => document.querySelector('main').innerText.includes(s), s)))

  // the deploy form: stack, the bouncer switch, the button (never pressed: no deployment in the lab)
  const opts = await a.page.evaluate(() => [...document.querySelectorAll('#cs-stack option')].map((o) => o.value))
  check('admin: the stack list offers the stacks, one recommended', opts.length >= 2 && await a.page.evaluate(() => [...document.querySelectorAll('#cs-stack option')].some((o) => /recommended/.test(o.textContent))), JSON.stringify(opts))
  const first = await a.value('#cs-stack')
  const other = opts.find((o) => o !== first)
  if (other) {
    await a.page.select('#cs-stack', other)
    check('admin: choosing another stack takes it', (await a.value('#cs-stack')) === other)
    await a.page.select('#cs-stack', first)
  }
  const sw = () => a.page.evaluate(() => { const e = document.querySelector('main [role="switch"]#cs-bouncer'); return e ? String(e.checked) : null })
  const s0 = await sw()
  check('admin: "Block bans at Traefik" is a switch', s0 === 'true' || s0 === 'false', String(s0))
  await a.click('Block bans at Traefik', { kind: 'switch', within: MAIN })
  check('admin: the switch turns over', await a.until((s0) => String(document.querySelector('#cs-bouncer')?.checked) !== s0, s0, 4000))
  await a.click('Block bans at Traefik', { kind: 'switch', within: MAIN })
  check('admin: …and back', (await sw()) === s0)
  const deployBtn = await a.find('Deploy CrowdSec', { within: MAIN, kind: 'button' })
  check('admin: Deploy CrowdSec is offered (not pressed in the lab)', !!deployBtn && !(await deployBtn.evaluate((e) => e.disabled)))
  await deployBtn?.dispose()

  // Refresh asks the server again
  const n0 = a.requests.length
  check('admin: Refresh asks for the status again', await a.click('Refresh', { within: MAIN }) && await asked(k, a, n0, '/crowdsec/status'))

  // the scope chips: the VM's CrowdSec, then the hub's again
  if (await a.until(() => [...document.querySelectorAll('main [role="group"] button')].some((b) => b.innerText.trim() === 'media-vm'), null, 10000)) {
    await a.click('media-vm', { within: 'main [role="group"]' })
    check('admin: the media-vm chip shows the VM\'s CrowdSec', await a.until(() => /VM media-vm/.test(document.querySelector('main h1')?.textContent || ''), null, 15000), await a.h1())
    check('admin: …and it answers (not deployed there either, or its state)', await a.waitText(/CrowdSec is not deployed yet|Watching Traefik|CrowdSec/, { within: MAIN, ms: 20000 }))
    await a.click('Hub', { within: 'main [role="group"]' })
    check('admin: the Hub chip comes back to the hub', await a.until(() => !/VM media-vm/.test(document.querySelector('main h1')?.textContent || ''), null, 15000))
  } else k.j.note('crowdsec: no fleet scope chips (no VM in the lab?)')

  // the template link
  await a.click(/^Prefer the Templates page/, { within: MAIN })
  check('admin: "Open the template there" opens Templates', await a.until(() => document.querySelector('main h1')?.textContent === 'Templates', null, 15000), await a.h1())
  check('admin: …searching for crowdsec', await a.until(() => [...document.querySelectorAll('main input')].some((i) => /crowdsec/i.test(i.value)), null, 8000))
  await a.shot('crowdsec-admin')

  // ---- a viewer ----------------------------------------------------------
  const v = await k.open(k.VIEWER)
  check('viewer: the page opens', await v.go('crowdsec') && (await v.h1()).startsWith('CrowdSec'), await v.h1())
  check('viewer: the invitation is shown', await v.waitText('CrowdSec is not deployed yet', { within: MAIN, ms: 30000 }))
  // regression: a viewer used to get the whole deploy form (a disabled Deploy CrowdSec, the stack list, a live switch)
  check('viewer: no Deploy CrowdSec button', !(await v.exists('Deploy CrowdSec', { within: MAIN })))
  check('viewer: no "Block bans at Traefik" switch and no stack list', !(await v.page.$('main [role="switch"]')) && !(await v.page.$('#cs-stack')))
  check('viewer: told that an admin deploys it', await v.hasText('Only an admin can deploy CrowdSec', MAIN))
  check('viewer: no Templates detour to a deployment', !(await v.exists(/^Prefer the Templates page/, { within: MAIN })))
  check('viewer: Refresh works', await v.click('Refresh', { within: MAIN }) && await v.waitText('CrowdSec is not deployed yet', { within: MAIN, ms: 10000 }))
  if (await v.until(() => [...document.querySelectorAll('main [role="group"] button')].some((b) => b.innerText.trim() === 'media-vm'), null, 10000)) {
    await v.click('media-vm', { within: 'main [role="group"]' })
    check('viewer: the VM chip works', await v.until(() => /VM media-vm/.test(document.querySelector('main h1')?.textContent || ''), null, 15000))
    await v.click('Hub', { within: 'main [role="group"]' })
  }
  const vs = await v.page.evaluate(() => [...document.querySelectorAll('nav[aria-label$=" pages"] button')].map((b) => b.innerText.trim()))
  check('viewer: the strip offers no Secrets, Users or DNS & Routes', !vs.some((n) => /^(Secrets|Users|DNS)/.test(n)), JSON.stringify(vs))

  // ---- phone and light ---------------------------------------------------
  const p = await k.open(k.ADMIN, { width: 'phone' })
  await p.go('crowdsec'); await p.waitText('CrowdSec is not deployed yet', { within: MAIN, ms: 30000 })
  check('phone: no sideways scroll', !(await p.overflow()), await p.overflow())
  const btnH = await p.page.evaluate(() => [...document.querySelectorAll('main button')].filter((b) => /Deploy CrowdSec/.test(b.innerText)).map((b) => b.getBoundingClientRect().height)[0] || 0)
  check('phone: Deploy CrowdSec is thumb-sized (≥ 40 px)', btnH >= 40, String(btnH))
  await p.shot('crowdsec-phone')
  const l = await k.open(k.ADMIN, { theme: 'light' })
  await l.go('crowdsec'); await l.waitText('CrowdSec is not deployed yet', { within: MAIN, ms: 30000 })
  check('light: the page is in the light look', await l.page.evaluate(() => document.documentElement.classList.contains('light')))
  await l.shot('crowdsec-light')
}
