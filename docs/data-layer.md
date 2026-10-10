# The dashboard's data layer

How the dashboard asks a DCS server for data, keeps it fresh, hears it live, reads its errors and forgets it when
it leaves the server. One implementation of each; this page says which, and what changed when it was consolidated
(October 2026, from 4.0.36).

| Concern | The one implementation | Used by |
|---|---|---|
| Talking to the API | `api/client.ts` `apiClient` (session header, timeout, retry of failed GETs, identical GETs in flight shared, `cancelAll` on leaving a server, `answeredSince` for the heartbeat) | every endpoint function |
| The endpoints | `api/endpoints.ts` (one function per endpoint; an optional last `member` argument sends it to a fleet VM through the hub), `api/fleetScoped.ts` (the container calls on a row's server), `api/fleetScopedOps.ts` (the fan-out to every server of a fleet), `api/chat.ts`, `api/themes.ts`, `api/integrations.ts` | pages, stores, hooks |
| What an error means | `api/errors.ts` `apiOutcome` (cancelled, signed-out, forbidden, rate-limited with `retryAfterMs`, offline, failed), `apiErrorMessage`, `apiErrorData`, `isLinkFailure` | the polling engine, chat, CrowdSec, fleet sheets |
| Polling | `lib/poll.ts` (the engine) and `hooks/usePolling.ts` (its React face) | every page, card and hook that refreshes |
| The names of shared requests | `api/pollKeys.ts` | the polls that ask what another poll asks |
| The live stream | `lib/sse.ts` `sseClient` (one `GET /stream`, typed events, reconnect with backoff) and `hooks/useLiveStream.ts` (`useLiveEvent`, `useLiveConnected`); another server's chat room: `lib/chatStream.ts` (`GET /stream?only=chat` on that server, while the dashboard is shown) | Activity → Live stream, the chat |
| Leaving a server or an account | `lib/serverScope.ts` (`onServerReset`, `resetsWithServer`, `resetServerScope`) | every store and cache registers; `serverStore` calls it |
| The link to the server | `stores/connectionStore.ts` (connect, the 10 s heartbeat on `/ping`, reconnect with backoff) and `serverStore`'s "can't be reached" screen | App, the polling engine |

## Requests

`apiClient.get/post/put/delete` is the only way to the API, with these deliberate exceptions (each a `fetch` of its
own, for a reason): the server discovery before a server is chosen (`lib/discover.ts`, `App.tsx` `/setup/status`),
ending a session on a server that is not the active one (`serverStore` `logoutElsewhere`), ending the Terminal's
Linux sign-in when the dashboard leaves a server or signs out (`lib/terminalSession`: `keepalive`, it must outlive the
requests `cancelAll` drops), the chat's rooms on the other servers the dashboard is signed in to (`stores/chatStore`:
an `ApiClient` of their own per server, made with that server's address and the session that server issued — a token
never goes anywhere else — plus that room's live feed, `lib/chatStream`, and the people's pictures, fetched with that
server's session so the session never sits in an `<img>` address), the dashboard's own
`build.json` (`UpdateBanner`), a theme imported from a URL the person typed (`ThemesPanel`), the live stream
(`lib/sse.ts`: it is read as it arrives) and the two archive downloads that stream a file to the browser
(`apiClient.download`).

Identical GETs that are on their way at the same time (same server, session and path) are one request: the second
caller gets the first one's answer. Network failures of a GET are retried twice; nothing else is retried.

## Polling

```ts
const { data, loading, error, refresh, fetching, updatedAt, dataKey } =
  usePolling(fetchStacks, 15000, { key: pollKeys.stacks, enabled: isAdmin })
```

- **Connection**: a poll runs while the API link is connected (`requireConnection: false` for the screens before
  it: the setup wizard's VM builds, the "can't be reached" screen's retries, the dashboard's own build check).
- **Hidden tab**: polls pause and ask again when the tab shows (when their last request is 5 s old or more);
  `whenHidden: 'run'` keeps one going (the chat room while its live stream is down, so a notification still comes;
  the DCS update check; a plugin card without a refresh cadence).
- **Errors**: the next try backs off — 2×, 4× … the interval, at most a minute beyond it — and a 429 or a 503
  waits for its `Retry-After` (header, or the body's `retry_after`). A request the dashboard cancelled itself (a
  server switch) is nobody's error.
- **Reconnect**: when the link comes back every poll asks at once.
- **Shared requests**: polls with the same `key` are one request stream at the shortest interval any of them asks
  for; each gets every answer, and a poll that mounts while the last answer is younger than its own interval shows
  it at once instead of asking. A new key (a scope switch) asks at once; the answer shown stays until the new one
  lands, and `dataKey === key` tells the new one apart (a switch never shows the old rows under the new label).
  `lastPollValue(key)` reads the last answer of this server however old (the fleet role and the VM list, so a page
  mounts in the right mode), `refreshPoll(key)` asks again after an action (`useContainerStore().refresh`).
- **The link**: `reportsLink: true` makes a poll watch the link — a failure of the link (no answer, a gateway
  error) counts towards "unstable", an answer says it is fine. The Dashboard, Diagnostics and the Activity timeline
  watch it, as before.
- **Refresh** asks now (or right after the request on its way) and resolves when the answer is in; `fetching` is
  true while any request of the poll is on its way (a refresh button can turn).

What stays a plain timer: the heartbeat (`connectionStore`, it is the link probe itself), clocks and countdowns that
ask nothing (status bar, toasts, Health's "since" tick, CrowdSec's clock, the lock screen's countdown, the session
expiry check), the desktop app's Discord presence and its presence status (Electron, not the API), and the OS update
of the System page (it follows the update to its end even after the page is left, and then says so in a toast).

### The shared requests (`api/pollKeys.ts`)

| Key | Who asks it (interval) |
|---|---|
| `stacks` | Stacks page (5 s), dashboard (15 s), sidebar badges, stack counts of the cards and the Health page, the dashboard's fleet card (30 s), Proxmox page (15 s) |
| `containers` | global poller (15 s), Containers page on everywhere/the hub (10 s), Health page (10 s), Diagnostics (10 s) |
| `status`, `health:<scope>`, `health-score:<scope>` | global poller (10 s, 15 s), Health page (5–15 s), dashboard health card (30 s), Diagnostics (5 s, 15 s), the "on demand missing" banner (30 s) |
| `fleet-status`, `fleet-members`, `fleet-overview` | every page's fleet role and scope (30 s), the dashboard's Proxmox card (15–30 s), the Proxmox page (15–20 s), the sidebar and status bar totals (30 s) |
| `fleet-jobs`, `fleet-provision-defaults`, `proxmox-*` | Stacks page, Proxmox page, setup wizard, the dashboard's Proxmox card |
| `events:<scope>`, `system-info:<member>`, `version`, `disks`, `routes` | dashboard, Activity timeline, Diagnostics, System, Settings, DNS, CrowdSec overview |
| `crowdsec-status:<member>`, `crowdsec-community:<member>` | CrowdSec page (15 s; 3 s while it deploys), dashboard (60 s, 10 min), the CrowdSec tabs (60 s) |
| `update-check` | the global poller (an admin's automatic check) and the Updates page |

## The live stream

`sseClient` keeps one `GET /stream` open while the link is connected (App.tsx), with the session in the
`Authorization` header — never in the address, which proxies log (`docker/nginx.conf` also keeps the stream out of
its access log). It reads the stream with `fetch` as it arrives, reconnects with a backoff (1 s doubling to 30 s, 20
tries; a refused session every 60 s, 5 tries), and on a hub `setScope('all' | 'hub' | member)` asks for every VM's
Docker events or one VM's. Events are typed (`SSEEventMap`: `docker-event`, `metrics`, `log-line`, `health-score`,
`chat`); `useLiveEvent(type, handler)` subscribes a component, `useLiveConnected()` says whether the stream is open
(told when it opens or drops — it used to be checked every second).

## Errors

| Outcome | Status | What happens |
|---|---|---|
| signed-out | 401 (not on the paths whose 401 is about a password or a code in the request) | `apiClient` drops the session and tells `serverStore` (`api-auth-expired`, tagged with the server and session epoch): that server's sign-in only — by itself with a remembered password, else pre-filled; other servers' sessions stay |
| forbidden | 403 | a viewer asked for an admin's thing: the pages do not ask for admin-only data as a viewer; a poll that gets one backs off |
| rate-limited | 429 | `retryAfterMs` from `Retry-After` or `retry_after`; polls wait for it, the chat and the CrowdSec check say how long |
| offline | no answer, timeout, 502/503/504 | counts towards "unstable" for the polls that watch the link; the heartbeat misses a beat only when nothing at all answered since the last beat (a ping can wait behind the dashboard's own requests: six connections per server); three misses → reconnecting, and two silent pings → the server's "can't be reached" screen |
| cancelled | — | the dashboard left the server or the session: nobody sees it |
| failed | other 4xx/5xx | the server's message is shown where the request was made |

## Leaving a server or an account

`serverStore` leaves a server (a switch, a sign-out, a session the server ended, a server that stopped answering)
in one place: `apiClient.cancelAll()` (every request on its way is aborted and its answer dropped),
`sseClient.disconnect()`, then `resetServerScope()`, which empties every store and cache that registered: health,
system, images, events, schedules, secrets, plugins, containers (the favourites stay), stacks (the action times
stay), the chat room, the polls' kept answers, and the person's synced preferences. A new store registers next to
its definition (`resetsWithServer(useXStore)`) and cannot be forgotten.

The saved server list (`dcs-servers` in the browser) is shared by every tab: each change starts from what is saved
now, and a tab follows the list another tab saved (the `storage` event), keeping its own active server.

## Requests per minute

The lab (`tests/lab/lab.sh`: hub with a fleet VM, mock Proxmox, fake Docker), signed in as the admin, one tab, a
60 s window after 12 s on the page, every request to the API counted (`OPTIONS` preflights apart):

| Page | Before (4.0.36) | After | Mostly from |
|---|---|---|---|
| Dashboard | 88 | 69 | `/stacks` 13 → 4 (four pollers at 15/30/30/20 s are one stream at 15 s), `/fleet/status` 5 → 2, `/fleet/overview` 5 → 3 |
| Stacks | 55 | 49 | `/stacks` 11 → 7 (one stream, each request waits for the one before), `/fleet/status` 4 → 2 |
| Containers | 38 | 34 | `/containers` 10 → 6 (the page's list and the global poller's are one request) |
| Health | 63 | 46 | `/containers` 12 → 5, `/stacks` 5 → 2, `/health?fleet=1` 6 → 4 |
| CrowdSec | 35 | 34 | `/fleet/members` 4 → 2 (CrowdSec is not set up in the lab: the page shows its install state) |

The lab API answers slowly (a `/stacks` takes 5–19 s), so the counts are bounded by the answers as much as by the
intervals; the intervals below are what the code asks for. A poll whose answer takes longer than its interval asks
again as soon as the answer is in, as before; the Stacks page's 5 s list shows every answer as before — the requests
that went away are the other pollers' copies of it.

The three fixes of the October audit have their own check (`tests/data-layer.mjs`: the lab, two tabs and slowed pings): the base build fails 6 of its 12 checks (a server added in one tab is written away by the other, three
pings that wait 9 s behind the dashboard's requests are "Connection Lost", the session is in the stream's address), this
one passes all 12.

### Intervals per page (before → after)

Nothing asks more often than before, and nothing a page shows is refreshed less often than before: where requests
were merged, every poll gets the answers of the fastest one.

| Page | Request | Before | After |
|---|---|---|---|
| every page | `/ping` heartbeat | 10 s | 10 s (a miss only when nothing answered) |
| every page | `/status`, `/health`, `/containers` (global) | 10 / 15 / 15 s | same; shared with the pages below |
| every page | `/fleet/status`, `/fleet/members`, `/fleet/overview` | 30 s per hook instance (a 10 s shared answer) | one 30 s stream each (15 s while the dashboard's Proxmox card shows the overview) |
| every page | `/stacks` (sidebar badge, hub) | 30 s (a 20 s shared answer) | shared `stacks` stream |
| every page | chat presence / room | 30 s / 5 s while the stream is down | same |
| every page | the chat rooms of the other servers the dashboard is signed in to (4.0.42) | — | a 10 s tick per room: nothing while its `GET /stream?only=chat` is live (presence every 30 s), else its room; a room that is off or unknown is asked again after 60 s |
| Dashboard | `/stacks` | 15 s + 30 s (counts) + 30 s (fleet card) + 30 s (badge) | one stream at 15 s |
| Dashboard | `/events`, `/disks`, `/logs/stats`, `/notifications/history`, `/backups/status` | 8 / 30 / 30 / 30 / 30 s | same |
| Dashboard | `/system`, `/maintenance/report`, `/automations`, `/schedules`, `/crowdsec/status`, `/metrics/trends` | 60 s | same |
| Dashboard | `/health/score` (card), `/power`, `/proxmox/vms`, `/proxmox/nodes` | 30 / 15 / 15 / 15 s | same |
| Dashboard | `/version`, `/system/os-updates`, `/crowdsec/community`, `/images/check-updates`, `/routes`, `/dns/status` | 10 min / 10 min / 10 min / 2 min / 60 s / 2 min | same |
| Stacks | `/stacks` | 5 s (+ the shell's) | 5 s, the one stream |
| Stacks | `/fleet/jobs`, provision defaults, Proxmox capabilities (hub, admin) | 5 / 60 / 60 s | same, shared with the Proxmox page |
| Stacks | a stack's detail / its App-Data on the hub | 5 / 30 s (kept running in a hidden tab) | 5 / 30 s, paused in a hidden tab |
| Proxmox | a guest's snapshots, while its details or its *Take snapshot* sheet are open (4.0.42) | — | 30 s |
| DNS & routes | `/routes/maintenance`, once when a route's maintenance sheet opens (4.0.42) | — | no poll |
| Technitium (4.0.42) | `/dns/technitium/status` (shared with its card on DNS & routes, 60 s there), the numbers, the kids' groups, the lists, a device's queries | — | 15 / 30 / 30 / 60 / 15 s (the queries only while a device is chosen) |
| Technitium (devices) | `/dns/technitium/devices` (`technitium-devices`, shared by the Devices, Kids, Activity and DHCP tabs), `/dns/technitium/dhcp`, a device's 50 latest queries while its drawer is open (admin) | — | 30 / 30 / 30 s; none of it while Config → Integrations has Technitium off |
| every page | `/config` (`config`: the Technitium switch the navigation follows, shared with the Config page) | — | 5 min (60 s while the Config page is open; a save asks again) |
| Containers | the list (everywhere / hub) | 10 s + the global 15 s | one stream at 10 s |
| Containers | a container's stats / processes | 10 s (+ a second sample after 2 s) / 10 s | same |
| Health | report / containers / events / metrics / score | 5 (15 everywhere) / 10 / 15 (20) / 10 / 15 s | same; report and containers shared with the global poller |
| Logs | the log tail (`/logs`) | 3 s (5 s for a VM) | same |
| CrowdSec | status | 15 s (3 s while it deploys, a second stream) | 15 s, 3 s while it deploys (one stream) |
| CrowdSec | tabs: hub, log, alerts, bans, bouncers, allowlist, settings | 30 / 5 / 15–30 / 15 / 15–60 / 15 / 15–60 s | same; the hub and the log pause in a hidden tab as before |

## Inventory: before and after

| | 4.0.36 | After |
|---|---|---|
| Polling implementations | `usePolling`, `useApi` (the same plus the link), `GlobalPoller`'s own timers, `sharedFetch` caches (4), 20 hand-made `setInterval` request loops in pages and cards | one engine (`lib/poll`) behind `usePolling` |
| Poll call sites | 127 in 51 files + the loops above | 153 in 67 files, 55 of them on a shared key |
| `visibilitychange` handlers | 12 in 6 files | 3 in 2 (the engine; the chat marking messages read) |
| `setInterval` | 46 in 32 files | 17 in 13 (clocks, the heartbeat, the System OS update; 4 in plugin HTML strings) |
| Live stream | `EventSource` with `?token=` in the address, status checked by 1 s timers | `fetch` with the `Authorization` header, status told to subscribers |
| Error readers | `ApiError` checks spread over pages, `errMsg`/`errData`/`errText` copies | `api/errors.ts` (the copies re-export it) |
| Server reset | a hand-kept list of 13 stores in `serverStore` (the chat and the poll caches were not in it) | each store registers itself (`lib/serverScope`) |
| Endpoint functions | `endpoints.ts` 378, `fleetScoped.ts` 30, `fleetScopedOps.ts` 47 | 320, 26, 34 |
| Stores | 20 | 16 |
| Raw `fetch` calls | 12 | 12: the exceptions listed above, all in `api/client.ts`, `lib/sse.ts`, `lib/discover.ts` and the five places named (the two archive downloads now go through `apiClient.download`) |

Removed as dead (nothing called them): 59 endpoint functions (`fetchContainer`, `fetchContainerStats`,
`resetContainer`, `fetchRollback*`, `fetchMetricsHistory`, `fetchPluginHooks`, `fetchTopology` … — the fleet-aware
twins in `fleetScoped*.ts` are what the pages use), the twins merged into one function with a `member` argument
(`fetchContainers`, `fetchSystemInfo`, `fetchLogStats`, `fetchBackupStatus`, `triggerBackup`, `fetchStackEnv`,
`saveStackEnv`, `terminalAuth`, `runImagePrune`, `triggerDeepPrune`, `triggerLogRotate`,
`fetchMaintenanceReport/Orphans/Disk`; `fetchContainersScoped` was defined twice), the stores nobody read
(`configStore`, `networkStore`, `metricsStore`, `rollbackStore`), dead store fields (the plugin detail panel,
`logStore.logs/logFile/loading`, `health/system/stackStore.loading`, `stackStore.selectedStack`,
`containerStore.fetchedAt/refresher`, `imageStore.staleCount`), `hooks/useApi.ts`, `hooks/useConnection.ts`
(unused), `lib/sharedFetch.ts`, `useFleetRole`'s `fleetRoleSnapshot`. Types the API answers with that were declared
in `endpoints.ts` (`ContainerListResponse`, the route and DNS types) or a second time in `Diagnostics.tsx` now live
in `shared/types.ts` only.

The client's endpoints were compared with the server's `docs/API.md` (4.0.41): every path the client asks is a
documented route. The live shapes of the core reads (`/status`, `/containers`, `/stacks`, `/health`,
`/health/score`, `/events`, `/system`, `/version`, `/fleet/status`, `/fleet/overview`) were compared with their
types: two fields the server sends were missing (`HealthScoreResponse.docker/timestamp`, `FleetOverview.at`) and
were added; the fields only the types have are the fleet tags a hub adds on other rows.

## Behaviour that changed on purpose

- Polls pause in a hidden tab where some hand-made loops did not (a stack's detail, a container's stats, the audit
  log, the CrowdSec log and hub, the automatic image-update schedules, the live log tail, operations followed to
  their end: the Docker Engine update, a VM's shared folders, the Authelia code). They ask at once when the tab
  shows; an operation's result toast then shows when the person is back.
- A failing poll backs off instead of asking at its interval; a 429 waits for its `Retry-After`.
- The Activity timeline and Diagnostics counted every failed poll towards "unstable"; like the dashboard they now
  count only failures of the link (a 500 from one endpoint says nothing about the link).
- The admin's automatic DCS update check kept its timer only until the tab was first hidden; it now keeps going
  (in the background too, at the interval set in Settings).
- A mounted poll whose request another poll answered less than its own interval ago shows that answer instead of
  asking again (the Containers page no longer forces a second list request when it opens).
- `useFleetRole` no longer shows the fleet role of the server before a switch until the new one answers.
- `runImagePrune` waits 120 s for its answer everywhere (the System and Maintenance pages did; the dashboard's quick
  action and the command palette gave up after 30 s while the prune went on), `triggerDeepPrune` 180 s (the
  Maintenance page's; Disk analysis used 120 s).
- Plugin cards are drawn again on a theme change from the HTML they have (they used to download it again).

Left as they were, on purpose: the System page's OS update keeps following the update after the page is left (its
toast says when it is done); the template deploy's error text still looks for "403" in the message (a wording
change belongs to the page's owner); `serverStore`'s gate texts and the themes' error texts keep their own wording.
