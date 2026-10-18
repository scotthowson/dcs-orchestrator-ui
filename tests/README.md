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
session. It also checks that nothing server A issued reaches server B: no request to B carries A's session token or A's terminal token
(the Terminal page's Linux sign-in, answered for A by a stand-in since the lab has no Linux account to check), the terminal session ends on A
when A is left and on sign-out (with no token or command history left in the browser), and B's `/settings/profile` is never written
from A's profile. `tests/credential-vault.mjs` checks the desktop app's remembered passwords (the main process's vault and the
renderer's bridge) against stubs; Electron's safeStorage itself needs a desktop session.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/server-accounts.mjs
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/remember-password.mjs   # the desktop sign-in's remembered password, bridge stubbed
node tests/credential-vault.mjs
node tests/external-links.mjs     # the desktop app opens only http(s) links outside the app
```

`tests/data-layer.mjs` checks the link between the dashboard and a server against the same lab: two tabs share the
saved server list (a server one tab adds survives the other tab saving its own change), a heartbeat ping that waits
behind the dashboard's own requests is not "Connection Lost" while the API answers, and the live stream carries the
session in its Authorization header, never in its address (docs/data-layer.md).

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/data-layer.mjs
```

`tests/journeys.mjs` walks every page the way a person uses it, as an admin and as a viewer, against the same lab: one
scripted journey per page in `tests/journeys/` (every button, tab, filter, sort, dialog, form with its validation and
read-back, copy button, phone width and the light look), plus the frame around them (`shell`: Ctrl+K, Ctrl+1…0, ?,
Escape, the section strip, the pages that moved, links to a page, hidden pages, the lock screen, the phone's More
sheet), the three editors and their save bar (`editors`: one press that the check stops and one that saves, Check
only, Ctrl+S, Discard, Escape, Find, Diff, History, a viewer, a phone; the lab's docker refuses YAML it cannot parse
and a service without an image, as `docker compose config` does), two servers with two accounts (`servers`), a viewer pressing everything (`viewer-census`), the requests per
page against docs/data-layer.md (`polling`), the empty server (`empty-states`, the lab's empty API) and failed requests
(`error-states`). Every tab is held to no console error, no token in an address and, for a viewer, no 403.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep MEMBER_API=http://127.0.0.1:41922 EMPTY_API=http://127.0.0.1:41924 WIZARD_API=http://127.0.0.1:41923 \
  VIEWER_USER=viewer VIEWER_PASS=… node tests/journeys.mjs        # JOURNEYS=stacks,users to run some; report in docs/ui-polish/journeys/
```

The viewer is an account of role `user` on the hub and on the member API (create it with `POST /auth/users`); the hub
also needs `austin` (role `user`) for the chat journey.

`tests/engine-update.mjs` checks the Updates page against the same lab, with the engine answers and the update POSTs served by a fake
inside the test: on a hub the Docker Engine card lists the VMs at once (before 4.0.50 they came with the next two-minute poll),
"Update 1 VM" sends `POST /fleet/docker-engine/update` with that VM, shows it updating, follows it and says how it ended (or the
VM's reason it did not start), a VM whose package index could not be refreshed reads "Index stale" instead of "Current", and an
install that cannot fast-forward offers Align (`POST /system/update/apply {align: true}`) instead of a `git reset --hard`.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/engine-update.mjs
```

`tests/backup-excludes.mjs` checks the stack page's *Excluded from backups* card against the same lab (server 4.0.59+): the lab hub's
`development-tools` gets a 3 MiB `App-Data/RomM/library`, *Suggest* offers it with its size and one click adds it, a pattern with a
`..` is stopped before it is sent, *Save* writes `.dcs-backup-exclude` through `PUT /stacks/{name}/backup-excludes` and the card
then says what it leaves out (still there after a reload, and on a phone without sideways scroll); the Backups page shows an archive's
`excluded_bytes` (the list served by a fake inside the test).

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep LAB=/tmp/dcs-ui-lab node tests/backup-excludes.mjs
```

`tests/policy-consent.mjs` checks consent for what the compose policy refuses (server 4.0.60+) against the same lab, with the
stack list, the dry run, the deploys, the stack editor's check and save and the compose policy answered inside the test: the
pelican deploy sheet shows *This template needs* (its `policy_needs` from the lab's catalogue) with every box unticked, the
first deploy carries no consent and is answered 422 with `policy_refusals`, which the sheet lists with their boxes; ticked,
*Allow and deploy* sends `allow_policy`. The stack editor offers the check's refusals the same way (*Allow and save*), and the
Config page lists this server's exceptions with who added them, Remove sending the list back without one.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/policy-consent.mjs
```

`tests/deploy-sheet.mjs` checks the template deploy sheet for a stack in a fleet VM against the same lab, with the stack list,
the VM's `/status`, Traefik, the domains, the dry run and the deploy answered inside the test: the VM's one NVIDIA card is
offered and picked, its slot goes out as `gpu`, and romm-streaming's own route (`route_override`) is one row that follows
its subdomain and port variables, behind Authelia unless switched off.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep node tests/deploy-sheet.mjs
```

`tests/technitium.mjs` drives the Technitium page with every `/dns/technitium/*` answer served from a fake inside the
test (no Technitium needed; the lab signs in): the overview, Allow on a blocked name, the pause's countdown and Resume,
a kids' group added, put in bedtime, paused, edited and deleted, SafeSearch, a device's queries and their filter, the
connect sheet (also with nothing connected), the device directory (an empty one scanned, the icon picker, a nickname
edited in place, search and filters, the drawer with a block until a time, pinning an address while the router does
DHCP), the DHCP move (the scope made off with every known device kept, the router's DHCP off, on here, a renewed device's
DNS), Config → Integrations turning it off (the tab and the DNS & routes card go, the page says so), the light look, and
a viewer on a phone (read-only, never asking for a device's queries). `GET /config` is the lab's own with
`technitium_enabled` from the fake: the lab's `.env` keeps Technitium off, so its clock never scans a real network.

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep VIEWER_USER=viewer VIEWER_PASS=… node tests/technitium.mjs   # screenshots in docs/ui-polish/technitium/
```

`tests/vpn.mjs` drives the VPN page the same way (every `/vpn/*` answer, `PUT /containers/{name}/vpn` and the vpn-gluetun deploy
from a fake inside the test): off in Config, Set up (deployed, not started), Connect (the account, the fastest region, PIA's
regions with Canada's first), the status, a container added from the picker and its VPN pill on Containers, the leak test,
Pause and Resume, the WireGuard clients' switch, a tunnel-down alert on the page and in "Needs your attention", a phone, and
a viewer (read-only).

```bash
PUPPETEER_DIR=/tmp/dcs-ui-sweep VIEWER_USER=viewer VIEWER_PASS=… node tests/vpn.mjs   # screenshots in docs/ui-polish/vpn/
```

CI (`.github/workflows/ci.yml`) runs the two Node tests; the browser tests need the lab and run locally.
