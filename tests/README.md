# Dashboard tests

`tests/ui-sweep.mjs` opens every page of the dashboard in both themes at 1440 × 900 and at a 390 × 844 phone,
signed in to a lab API, and fails on console errors or warnings, uncaught exceptions, horizontal scroll on the
phone, leaked `undefined` / `NaN` / `[object Object]`, empty headings or pills, buttons, links and form fields without an
accessible name, focusable elements without a visible focus state, and on safe clicks (tabs, filters, view
switches, refresh, sheets that only open) that break the page. It never clicks anything that stops, deletes,
restarts, resets or updates. One screenshot per page, theme and width lands in `docs/ui-polish/sweep/`, with
`report.json` beside them. A page whose first load stays blank for 30 s (the dev server now and then stalls on one
of its hundreds of modules under four browsers) gets one more try; the summary lists every such page with the requests
it was still waiting on, and a page that stays blank twice fails.

Run it against the lab, never against a real server:

```bash
tests/lab/lab.sh start                                        # mock Proxmox, hub + member + fresh API copies, Vite on :3021
npm i --no-save --prefix /tmp/dcs-ui-sweep puppeteer-core@24  # once; the project does not depend on it
PUPPETEER_DIR=/tmp/dcs-ui-sweep WIZARD_API=http://127.0.0.1:41923 node tests/ui-sweep.mjs
tests/lab/lab.sh stop
```

`PAGES=proxmox,updates THEMES=dark VIEWPORTS=phone` narrows a run; `CLICKS=0` skips the clicks. The lab copies
the AIO checkout named by `AIO` (read-only) into `LAB` (default `/tmp/dcs-ui-lab`); its APIs never reach a
Docker daemon — `tests/lab/bin/docker` answers the read-only calls from a fixed set of containers and refuses
every call that would change something. The lab's throwaway admin is `lab` / `Lab-Only-Pass-123`.

`tests/signin-plain-password.mjs` is a second, small check against the same lab: an admin hands out a password with no uppercase letter and no number (the server asks for 8
characters), and the person must sign in with it on a device that has never seen them and on a second one, while a wrong password is still refused. Before 4.0.2 the app held the
local copy of such an account to the rules of choosing a password and refused the first sign-in.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/signin-plain-password.mjs
```

`tests/server-accounts.mjs` checks the accounts kept per server against the same lab: the member API serves as a second,
independent server with an admin of its own. Switching to a server without a session shows its sign-in with nothing of
the previous server in the page, Cancel goes back, a token ended on the server mid-use asks for that server only, a server
that does not answer gets its own screen, and the app's start shows the dashboard only after the server confirmed the
session. `tests/credential-vault.mjs` checks the desktop app's remembered passwords (the main process's vault and the
renderer's bridge) against stubs; Electron's safeStorage itself needs a desktop session.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/server-accounts.mjs
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/remember-password.mjs   # the desktop sign-in's remembered password, bridge stubbed
node tests/credential-vault.mjs
```

`tests/data-layer.mjs` checks the link between the dashboard and a server against the same lab: two tabs share the
saved server list (a server one tab adds survives the other tab saving its own change), a heartbeat ping that waits
behind the dashboard's own requests is not "Connection Lost" while the API answers, and the live stream carries the
session in its Authorization header, never in its address (docs/data-layer.md).

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/data-layer.mjs
```
