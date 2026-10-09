// The setup wizard against the lab's never-set-up API (WIZARD_API): its first screens only, never completed — Connect
// (an empty address, a malformed one, the real one), Next, the Admin step's validation (a short username, a weak
// password, passwords that differ, the eye), Back. Nothing is created: the API is still not set up at the end. The
// phone and the light look.

const WIZ = process.env.WIZARD_API || 'http://127.0.0.1:41923'
const nextOff = (t) => t.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next')?.disabled)

export default async function setup(k) {
  const { check } = k
  const status = async () => { try { return await (await fetch(`${WIZ}/setup/status`)).json() } catch { return null } }
  const s0 = await status()
  if (!check('the never-set-up API answers and is not set up', s0 && s0.initialized === false && s0.needs_admin === true, JSON.stringify(s0))) return

  const t = await k.open(null, { signIn: false, api: WIZ })
  check('the wizard opens on its first step', await t.waitText('Set up DCS Orchestrator', { ms: 30000 }) && await t.waitText('Welcome to DCS Orchestrator', { ms: 5000 }))
  check('the steps are named (Connect, Admin, Server, Stacks, Review)', ['Connect', 'Admin', 'Server', 'Stacks', 'Review'].every((w) => t.page.evaluate((w) => document.body.innerText.includes(w), w)))
  check('Next is off before the server answers', await nextOff(t) === true)

  // ---- Connect -------------------------------------------------------------------------------------
  await t.type('Server address', '')
  check('Connect is off with no address', await t.page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Connect')?.disabled === true))
  await t.page.focus('input[aria-label="Server address"]'); await t.key('Enter')
  check('Enter with no address says what is missing', await t.waitText(/enter a server (URL|address)/i, { ms: 5000 }))
  await t.type('Server address', 'http://[not-an-address')
  await t.click('Connect')
  check('a malformed address is refused with words', await t.waitText(/Invalid URL format|not a valid/i, { ms: 5000 }))
  await t.type('Server address', WIZ)
  await t.click('Connect')
  check('the real address connects', await t.until(() => !/Not connected/.test(document.body.innerText), null, 20000) && await t.until(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Next')?.disabled === false, null, 20000), await t.text('body'))
  await t.shot('setup-connected')

  // ---- Admin: validation only (Next here would create the admin: never pressed) -------------------------
  await t.click('Next')
  check('Next opens the Admin step', await t.until(() => !!document.querySelector('#wizard-username'), null, 10000))
  check('…with Next off while it is empty', await nextOff(t) === true)
  await t.type('#wizard-username', 'ab')
  check('a two-letter username is refused, in rose (regression: amber)', await t.until(() => [...document.querySelectorAll('[role="alert"]')].some((e) => /At least 3 characters/.test(e.textContent) && /rose/.test(e.className)), null, 3000))
  await t.type('#wizard-username', 'e2e-admin')
  await t.type('#wizard-password', 'weak')
  check('a weak password shows the strength meter, Next stays off', await nextOff(t) === true && /weak|fair|strong|8 char|uppercase/i.test(await t.text('body')))
  await t.type('#wizard-password', 'E2e-Wizard-Pass-1')
  await t.type('#wizard-confirm-password', 'E2e-Wizard-Pass-2')
  check('passwords that differ are said, Next stays off', await t.waitText('Passwords do not match', { ms: 3000 }) && await nextOff(t) === true)
  check('the eye shows both passwords', await t.click('Show the password') && await t.until(() => document.querySelector('#wizard-password')?.type === 'text' && document.querySelector('#wizard-confirm-password')?.type === 'text', null, 3000))
  await t.click('Hide the password')
  // clear the fields before anything else: a valid pair is never left in the form
  await t.type('#wizard-confirm-password', ''); await t.type('#wizard-password', '')
  check('Back returns to Connect', await t.click('Back') && await t.until(() => !!document.querySelector('input[aria-label="Server address"]'), null, 5000))
  const s1 = await status()
  check('nothing was created: the API is still not set up', s1 && s1.initialized === false && s1.needs_admin === true, JSON.stringify(s1))

  // ---- phone + light ----------------------------------------------------------------------------------
  const p = await k.open(null, { signIn: false, api: WIZ, width: 'phone', theme: 'light' })
  await p.waitText('Welcome to DCS Orchestrator', { ms: 30000 })
  check('phone: no sideways scroll', !(await p.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth > 1)))
  const h = await p.page.evaluate(() => [...document.querySelectorAll('button')].filter((b) => /^(Connect|Next)$/.test(b.textContent.trim())).map((b) => Math.round(b.getBoundingClientRect().height)))
  check('phone: Connect and Next are ≥ 40 px', h.length === 2 && h.every((x) => x >= 40), JSON.stringify(h))
  check('phone + light (screenshot)', !!(await p.shot('setup-phone-light')))
}
