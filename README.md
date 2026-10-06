<p align="center">
  <a href="https://github.com/scotthowson/dcs-orchestrator-ui/releases"><img src="https://img.shields.io/github/v/release/scotthowson/dcs-orchestrator-ui?include_prereleases&sort=semver&style=flat-square&label=release&color=34d399" alt="Latest release" /></a>
  <a href="https://github.com/scotthowson/dcs-orchestrator-ui/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/scotthowson/dcs-orchestrator-ui/ci.yml?style=flat-square&label=CI&logo=githubactions&logoColor=white" alt="CI status" /></a>
  <a href="https://github.com/scotthowson/dcs-orchestrator-ui/actions/workflows/build.yml"><img src="https://img.shields.io/github/actions/workflow/status/scotthowson/dcs-orchestrator-ui/build.yml?style=flat-square&label=apps&logo=githubactions&logoColor=white" alt="Desktop and Android build status" /></a>
  <a href="https://github.com/scotthowson/dcs-orchestrator-ui/actions/workflows/docker-publish.yml"><img src="https://img.shields.io/github/actions/workflow/status/scotthowson/dcs-orchestrator-ui/docker-publish.yml?style=flat-square&label=image&logo=githubactions&logoColor=white" alt="Docker image build status" /></a>
  <a href="https://github.com/users/scotthowson/packages/container/package/dcs-orchestrator-ui"><img src="https://img.shields.io/badge/ghcr.io-dcs--orchestrator--ui-2496ED?style=flat-square&logo=docker&logoColor=white" alt="Docker image on GHCR" /></a>
  <a href="https://github.com/scotthowson/dcs-orchestrator-ui/commits/v2.0.0"><img src="https://img.shields.io/github/last-commit/scotthowson/dcs-orchestrator-ui/v2.0.0?style=flat-square&color=64748b" alt="Last commit" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Electron-33-47848F?style=flat-square&logo=electron&logoColor=white" alt="Electron 33" />
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=flat-square&logo=react&logoColor=black" alt="React 18" />
  <img src="https://img.shields.io/badge/TypeScript-5-3178C6?style=flat-square&logo=typescript&logoColor=white" alt="TypeScript 5" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=flat-square&logo=tailwindcss&logoColor=white" alt="Tailwind CSS 3" />
  <img src="https://img.shields.io/badge/Vite-6-646CFF?style=flat-square&logo=vite&logoColor=white" alt="Vite 6" />
  <img src="https://img.shields.io/badge/Mantine-8-339AF0?style=flat-square&logo=mantine&logoColor=white" alt="Mantine 8" />
  <img src="https://img.shields.io/badge/Android-APK-3DDC84?style=flat-square&logo=android&logoColor=white" alt="Android APK" />
</p>

# DCS Orchestrator — the dashboard

The dashboard of [DCS Orchestrator](https://github.com/scotthowson/dcs-orchestrator): a desktop, browser and Android app for a hub and the Proxmox VMs it builds, one stack per VM. Light and dark looks for every theme, about 40 pages, real-time monitoring, CrowdSec, updates, backups and full server administration — built with Electron, React, Mantine and Tailwind CSS.

> **Platforms:** Linux (AppImage, .deb, .rpm) &bull; macOS (.dmg) &bull; Windows (NSIS) &bull; Android (APK via Capacitor)

---

## Quick Start

```bash
git clone https://github.com/scotthowson/dcs-orchestrator-ui.git
cd dcs-orchestrator-ui
npm install

# Desktop — Electron + Vite HMR
npm run dev:electron

# Browser only — Vite dev server at localhost:5173
npm run dev

# Production build
npm run build
```

**Requirements:** Node.js 20+, npm, and a running [DCS Orchestrator](https://github.com/scotthowson/dcs-orchestrator) server (its API is on by default).

---

## Feature Highlights

### Multi-Server Management

Connect to and switch between multiple DCS servers from a single app.

- **Server profiles** — add, rename, and remove servers with inline editing
- **One-click switching** — seamless connection with automatic data clearing between servers
- **Connection status** — real-time indicators (connected/connecting/error) per server
- **Server-specific notifications** — alerts are scoped to their originating server
- **Persistent profiles** — server list stored locally, survives app restarts

### Setup Wizard

5-step guided first-run configuration that activates automatically on uninitialized servers.

| Step | What it does |
|------|-------------|
| **1. Connect** | Enter server URL, auto-detect hostname, Docker/Compose versions, PUID/PGID, Docker availability |
| **2. Admin Account** | Create admin credentials with password strength meter, server + local auth registration |
| **3. Server Config** | Pre-populated timezone, domain, data directory, permissions. Collapsible advanced sections for Notifications, Startup & Health, and Backup settings |
| **4. Stack Categories** | Choose, rename, reorder, add, or remove stack categories |
| **5. Review & Apply** | Grouped summary by category, one-click write to server `.env`, auto-login to Dashboard |

- **Pre-flight validation** — detects already-configured servers and blocks duplicate setup
- **Docker status indicator** — green/red availability check in system info
- **Scrollable layout** — content-aware scrolling for long configuration forms
- **Welcome toast** — "Your server is configured and ready" on first Dashboard load

### Dashboard

Live overview with configurable polling intervals.

- **Needs your attention** — only what is broken or waiting on you (a stack with stopped containers, an unhealthy container, a VM that doesn't answer, a missing App-Data drive, a failed or old backup, a nearly full disk, image and DCS updates), worst first, each with the page that fixes it; hide an item until it changes. A dashboard arranged before the card existed is asked once whether to add it on top
- **Overview cards** — container counts, stack status, health summary
- **Health score gauge** — weighted 0–100 scoring with A–F grades (stacks, resources, images, uptime factors)
- **Resource charts** — real-time memory and load visualization (Recharts)
- **Disk monitor** — mounted filesystems with custom labels, usage bars, and custom locations
- **Container overview** — top containers by status, uptime, restart count
- **Recent events** — live Docker event feed (collapsible)
- **Quick actions** — 9-tile navigation grid (collapsible)
- **Server info** — hostname, Docker version, API version
- **Disconnected hero** — animated illustration with reconnect button and exponential backoff

### Stack Management

- Start, stop, restart, update stacks with confirmation modals
- **Clone stacks** — duplicate a stack with a new name for quick iteration
- **Annotations** — custom labels, priority levels (critical/high/normal/low), notes per stack
- **Create & delete** stacks with full-screen glass overlays (React portals, escape key, backdrop blur)
- **Batch operations** — multi-select with floating action bar for Start/Stop/Restart/Update Selected
- **Progress overlay** — per-stack result cards showing success/failure during batch operations

### Compose Editor

- **Full editor** with edit mode, save, and discard
- **Validation** — runs `docker compose config` to check syntax before saving
- **Safe saves** — creates `.bak` backup before writing changes
- **LCS-based diff view** — side-by-side comparison with green/red highlighting
- **Stack .env tab** — view and edit per-stack environment variables alongside the compose file
- **Syntax highlighting** — YAML-aware color coding
- **In-file search** — find text within the compose file

### Template System

- Browse, deploy, create, and edit templates with a polished modal workflow
- **URL import** — paste a GitHub URL (raw or blob) to import any compose file as a template
- **Template gallery** — curated catalog of 50+ popular compose templates from docker/awesome-compose
- **Boolean env var toggles** — detected automatically from defaults, rendered as toggle switches
- **Text inputs** for non-boolean variables with labels, required badges, and placeholders
- **Dry-run preview** — preview services, port conflicts, environment additions before deploying
- **Port conflict detection** — detailed conflict breakdown with host port, container, and conflicting service
- **Auto-start toggle** — optionally start the stack immediately after deployment
- **Compose preview** — collapsible YAML preview of what will be written

### Container Management

- Full container list with sorting, search, status filtering
- Container detail view with stats (CPU, memory, network I/O, PIDs)
- Container logs viewer
- Start/stop/restart individual containers
- **Nuke & reinstall** — a fresh install of a wedged container: preview of the App-Data folders and volumes that go (folders land in a trash kept for a week; anything shared with another container is kept), type the name to confirm, and the service comes back from its compose file
- **Batch operations** — multi-select with floating action bar and per-container result cards

### Health Monitoring

- **Aggregate health score** — weighted 0–100 scoring with A–F letter grades
- **Score factors** — stacks, resources, images, and uptime sub-scores with visual bars
- **Per-stack breakdown** — individual stack health scores, container counts, grade badges
- **Container health table** — per-container status with color-coded badges
- **Resource gauges** — CPU, memory, disk with animated SVG arcs

### Diagnostics & Factory Reset

- **Server Control** — Start All, Stop All, Restart All stacks, Maintenance Mode toggle
- **Resource gauges** — CPU, memory, disk with animated SVG arcs
- **Factory Reset** — dedicated `/auth/factory-reset` endpoint with:
  - App-only reset (clears local data, preserves server config)
  - Full reset (wipes server auth state + local data, returns to Setup Wizard)
  - **Compose reset toggle** — optionally restore all `docker-compose.yml` to git defaults
  - **5-second countdown** — confirmation timer prevents accidental resets
  - **Server URL preservation** — maintains connection after reset for seamless redirect to Setup Wizard

### Monitoring & Analysis

| Page | Capabilities |
|------|-------------|
| **Networks** | List, detail, create/delete, subnet/gateway/container IPs |
| **Volumes** | Search, sort, size analysis, delete with confirmation |
| **Images** | Repository/tag/size/age, staleness indicators, Docker Hub search, batch prune |
| **Updates** | Image freshness checker with current vs latest tag comparison |
| **Uptime** | Uptime monitoring and availability tracking |
| **Trends** | Resource usage history with interactive charts |
| **Topology** | Network topology visualization with container relationships |
| **Disk Analysis** | Per-stack disk usage breakdown |

### Server Administration

| Page | Capabilities |
|------|-------------|
| **Environment** | Root `.env` editor, raw mode, per-stack selector, validation, duplicate detection |
| **Config** | Runtime profile, feature flags, display, log formatting, API, NTFY, security |
| **Maintenance** | System report, orphan detection, disk analysis, safe/image/deep prune, log rotate |
| **Backup** | Status polling, trigger full/per-stack backup, archive list, restore with confirmation |
| **Logs** | Live viewer, server-side filtering, statistics panel, archive browser, export |
| **Terminal** | Remote terminal access with authentication |
| **Cron Jobs** | View user and system crontabs, add/remove entries, raw editor |
| **File Browser** | Navigate server filesystem, view files |
| **Secrets** | Encrypted secrets management for stacks |
| **Schedules** | Scheduled task management and execution |
| **Plugins** | Plugin management and configuration |
| **Snapshots** | Container state snapshots |

### Users & Security

- **PBKDF2 key derivation** — 100k iterations, random 128-bit salt, Web Crypto API
- **Server-side Bearer token auth** — API tokens with login/setup/verify flow
- **Admin setup** — first-run account creation via Setup Wizard
- **Login** — two-phase flow: server connection test, then authentication
- **Invite system** — generate invite codes, track usage, revoke
- **Auto-lock** — configurable inactivity timer (5/15/30/60/120 min)
- **User management** — admin panel for all registered users; three roles (admin, user, and **bot** for chat bots: day-to-day operations only, several sessions allowed), changeable per account
- **Offline fallback** — local-only auth when server is unreachable
- **Smooth logout** — `useLayoutEffect` fade-to-dark transition prevents login screen flash

### Role-Based Access Control

Defense-in-depth permission model with admin and user roles enforced across every layer.

| Layer | Mechanism |
|-------|-----------|
| **Navigation guard** | `setCurrentPage()` blocks non-admins from admin-only pages |
| **Sidebar filter** | Admin-only pages hidden from navigation |
| **Command Palette** | Admin pages and destructive actions filtered |
| **Page restore** | Won't restore admin-only pages for non-admin sessions |
| **Logout reset** | Forces page to dashboard on sign-out |

**Admin-only pages:** Terminal, Secrets, File Browser, Plugins, Environment, Config, Maintenance, Backup, Cron Jobs, Users, Automations, Snapshots

**Admin-only operations** (gated per-page on all accessible pages):

| Category | Gated Actions |
|----------|--------------|
| **Stacks** | Create, delete, edit compose, update (pull + redeploy), batch update |
| **Containers** | Remove (force delete), batch mode |
| **Images** | Prune, delete, pull from Docker Hub, batch mode |
| **Volumes** | Delete, batch mode |
| **Networks** | Create, delete, disconnect |
| **Templates** | Deploy, undeploy, URL import, gallery import |
| **Updates** | Update individual/all stale images |
| **System** | Maintenance panel (system prune, image prune) |
| **Disk Analysis** | Deep prune |
| **Trends** | Capture metrics snapshot, configure alert thresholds |
| **Notifications** | Create/toggle/delete rules, create/delete webhooks |
| **Schedules** | Create, delete scheduled tasks |
| **Diagnostics** | Server control, factory reset |
| **Dashboard** | Destructive quick actions (prune, log rotate, backup) |

**Non-admin users can:** View all data, start/stop/restart containers and stacks, search Docker Hub, browse logs, view health/uptime/trends, manage bookmarks, use the command palette for navigation.

### Settings & Personalization

- **Profile** — display name, email, avatar (file upload or URL), bio, status emoji + text, timezone, accent color (8 colors)
- **Connection** — server URL with test connection button
- **Appearance** — dark/light theme, background image, project name & subtitle branding
- **Polling intervals** — configurable per data type
- **Disk labels** — rename detected drives, add custom mount locations
- **Export/Import** — backup all settings + profile to JSON, restore on any device
- **Auto-lock** — inactivity timer
- **Notifications** — desktop notification toggle, server-scoped notification history
- **Session info** — status, expiry countdown, token preview
- **Security** — change password, delete account
- **Custom CSS** — inject your own styles
- **About** — version info, keyboard shortcut reference

### Notifications

- **Server-scoped** — notifications are tagged per server, filtered to the active connection
- **NTFY integration** — create notification rules for system events
- **Rule management** — add, toggle, delete rules with event type filtering
- **Test notifications** — send test pushes to verify configuration
- **Discord** — every rule also lands in a Discord channel as an embed in the dashboard's palette; presets for health changes, backups and stack failures; per-rule cooldowns; name, avatar and cooldown defaults under Server Config
- **Notification drawer** — slide-out panel with unread count, mark all read, clear all
- **Desktop notifications** — Web Notification API with permission management

### Proxmox

Link an API token in **Config → Proxmox** (or in the setup wizard, which opens the section by
itself when the server runs as a Proxmox guest) and the **Proxmox** page shows every node with
CPU, memory, disk and uptime bars, every VM and LXC container with state, load, uptime and tags,
filters and search, and — for admins — start, shut down, stop, reboot, reset, suspend and resume
with a confirmation sheet that explains each action. Recent Proxmox tasks are listed below. A
**Proxmox** dashboard card shows the same at a glance, the Notifications page has a *Proxmox*
event group and *VM stopped on its own* trigger, and the bot answers `/vms` and `/vm`.

**Config → Traefik & DNS → Traefik on another machine** publishes DCS's routes as a feed for a
Traefik elsewhere: switch it on, copy the snippet the panel shows into that Traefik, and watch
*Last pulled …* confirm it. Needs DCS 3.8.

### Discord

- **DCS Discord Bot** (`bot/`, image `ghcr.io/scotthowson/dcs-discord-bot`) — slash commands with buttons and confirmations: status, usage, health, containers, stacks, top, disk, updates, logs, routes, power, security, schedules, audit; start, stop, restart, update, deploy (dry-run first), backup, prune, run, unban and DCS self-update for the admins you name; locked to the channels you list; the bot's status line mirrors the server
- **Rich Presence** (desktop app) — "Managing *your server* · containers · stacks · health" on your profile while the app is open (Settings → Discord Rich Presence)
- **Brand kit** (`brand/discord/`) — app icon, bot avatar and banner, notification and CrowdSec avatars, presence art, with a note on where each goes
- The complete walkthrough (webhook, rules, CrowdSec alerts, the bot's application, invite URL, IDs and account, Rich Presence) is [docs/DISCORD.md](https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/DISCORD.md) in the DCS repository

### Activity

- Docker events as a timeline grouped by day; each day folds away so the audit log is one scroll away
- **Errors** filter: crashes, kills, out-of-memory and failed health checks only
- New events slide in; nothing else re-animates while the page polls
- A floating **back to top** arrow appears on every long page

### Automations

- Create automation rules triggered by system events
- Configurable actions and conditions
- Enable/disable individual automations

### Bookmarks

- Pin pages, stacks, containers, or custom references
- 8 color options, search, filter by type or pinned status
- Click to navigate directly

### Onboarding

- **First-run overlay** — step-by-step guide: Welcome, Connect, Deploy, Explore
- **Spotlight highlights** — draws attention to key UI elements
- **Skip / Don't show again** — respects user preference via localStorage
- **Re-accessible** — trigger from Settings page at any time

---

## Navigation

### Sidebar sections

The sidebar has ten sections; each opens on a strip of its pages, and returns to the one you were last on.

| Section | Pages |
|---------|-------|
| Dashboard | your cards |
| Stacks | Stacks · Templates · Environment |
| Fleet | Proxmox · Topology |
| Docker | Containers · Images · Volumes · Networks · Disk Analysis |
| Monitoring | Health (with each container's last 30 minutes) · Trends · Diagnostics · Activity (timeline, live stream, audit log) · Logs |
| Security | CrowdSec · DNS & Routes · Secrets · Users |
| Maintenance | Updates · Backups (backups, config snapshots, recovery bundles) · Export · Cleanup |
| Automation | one page: timed and condition rules, and the server crontab |
| Tools | Terminal · File Browser · Bookmarks · Plugins |
| Settings | Settings · Notifications · Config · System |

Settings → **Sidebar & pages** hides the sections and pages you don't use (on that device); a hidden page still opens from the command palette, a link or a notification.

### Command Palette

`Ctrl+K` / `Cmd+K` — global spotlight search across all pages, stacks, containers, and dynamic actions.

- **Dynamic entries** — live stack/container actions (restart, stop, view logs)
- **Section grouping** — Pages, Stack Actions, Container Actions, Quick Actions
- **Fuzzy search** — filters as you type

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Ctrl+1`–`9` | Open a sidebar section by its place (Dashboard, Stacks, Fleet, …) |
| `Ctrl+0` | Settings (the tenth section) |
| `Ctrl+K` | Command palette |
| `Ctrl+B` | Toggle sidebar |
| `Ctrl+D` | Toggle dark/light theme |
| `Ctrl+R` | Refresh all data |
| `Ctrl+T` | Terminal |
| `Ctrl+Shift+P` | Command palette (alternative) |
| `Ctrl+/` or `?` | Keyboard shortcuts overlay |

---

## Design System

Built on a **dark glassmorphism** foundation with full light mode support.

- **Glass components** — `.glass`, `.glass-subtle`, `.glass-card`, `.glass-hover` with 3 depth levels
- **Accent palette** — emerald (primary), cyan (info), amber (warning), rose (danger), violet (secondary)
- **Animations** — floating orbs, gradient rotation, morphing blobs, shimmer skeletons, stagger children, pulse glow, neon text
- **Micro-interactions** — `press` active feedback, hover transforms, staggered entrance animations
- **Toggle switches** — unified `h-6 w-11` / `h-5 w-9` pattern with smooth `translate-x` transitions
- **Icons** — exclusively Lucide React
- **Responsive** — mobile-first grids, `flex-wrap` controls, touch-optimized targets (36px+), safe area insets
- **Modals** — `createPortal` to document.body, escapes CSS transform stacking contexts, `z-[9999]`, backdrop blur

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Electron 33 |
| Mobile | Capacitor (Android APK) |
| UI framework | React 18 |
| Build tool | Vite 6 |
| Styling | Tailwind CSS 3 |
| State management | Zustand 5 (14 stores) |
| Charts | Recharts 2 |
| Icons | Lucide React |
| Language | TypeScript 5 |
| Settings persistence | electron-store 8 / localStorage fallback |
| Overlay system | React Portals |

---

## Project Structure

```
src/
  main/                    # Electron main process
    index.ts               #   App lifecycle, window creation, CORS proxy
    preload.ts             #   contextBridge IPC exposure
    store.ts               #   electron-store persistence
  renderer/                # React SPA
    api/
      client.ts            #   Fetch wrapper, auth headers, retry logic
      endpoints.ts         #   ~80 typed API endpoint functions
    hooks/                 #   usePolling, useConnection, useApi
    stores/                #   14 Zustand stores (auth, settings, connection, stacks, ...)
    components/
      common/              #   Modal, Toast, ErrorBoundary, DisconnectedBanner, ServerSwitcher, OnboardingOverlay
      dashboard/           #   OverviewCards, ResourceChart, DiskMonitor, HealthSummary, ...
      containers/          #   ContainerRow, ContainerDetail
      stacks/              #   StackCard, ComposeViewer, CreateStack, EditStack
      images/              #   ImageCard
      layout/              #   Sidebar, Header, StatusBar
      settings/            #   ConnectionForm, AppSettings, ProfileCustomization
      CommandPalette.tsx   #   Ctrl+K spotlight search with dynamic actions
      KeyboardShortcuts.tsx#   Ctrl+/ overlay
      NotificationDrawer.tsx#  Server-scoped notification panel
    pages/                 #   35+ page components
      SetupWizard.tsx      #     5-step first-run wizard with collapsible advanced config
      Dashboard.tsx        #     Live overview, health score, charts, quick actions
      Stacks.tsx           #     Stack management with batch operations
      Containers.tsx       #     Container management with batch operations
      Templates.tsx        #     Template gallery with URL import, boolean toggles & dry-run preview
      Images.tsx           #     Image tracking with staleness indicators and Docker Hub search
      Networks.tsx         #     Network management
      Volumes.tsx          #     Volume management with search & sort
      Health.tsx           #     Health scoring with weighted grades and per-stack breakdown
      Diagnostics.tsx      #     Resource gauges, server control, factory reset
      Logs.tsx             #     Log viewer with filtering & statistics
      Config.tsx           #     Server configuration editor
      Environment.tsx      #     Root and stack .env editor
      Backup.tsx           #     Backup/restore with archive browser
      Maintenance.tsx      #     System report, orphan detection, prune actions
      Settings.tsx         #     Profile, appearance, export/import, security
      Login.tsx            #     Two-phase auth: server connection + login/register
      Users.tsx            #     User management and invite codes
      Notifications.tsx    #     NTFY notification center
      Automations.tsx      #     Automation rules
      Terminal.tsx         #     Remote terminal
      CronJobs.tsx         #     Cron job viewer/editor
      FileBrowser.tsx      #     Server file browser
      DiskAnalysis.tsx     #     Disk usage analysis
      Topology.tsx         #     Network topology
      Trends.tsx           #     Resource trends
      Uptime.tsx           #     Uptime monitoring
      Updates.tsx          #     Image update checker
      Snapshots.tsx        #     Container snapshots
      Bookmarks.tsx        #     Pinned navigation
      Activity.tsx         #     Activity feed
      Secrets.tsx          #     Encrypted secrets management
      Schedules.tsx        #     Scheduled task management
      Plugins.tsx          #     Plugin management
      System.tsx           #     System information
  shared/
    types.ts               #   TypeScript interfaces for all API responses
```

---

## API Compatibility

Connects to the DCS Orchestrator REST API (default `http://127.0.0.1:9876`; the reference is [docs/API.md](https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/API.md)). The endpoints the dashboard uses are typed and wrapped:

```
/setup    /status    /health     /stacks      /containers   /images
/networks /volumes   /logs       /events      /config       /system
/version  /disks     /env        /maintenance  /backup      /auth
/terminal /batch     /templates  /cron        /files        /notifications
/secrets  /schedules /plugins    /export      /webhooks
```

Server-side filtering via query parameters. Background operations (backup, restore) use status polling. Factory reset uses a dedicated admin-only endpoint.

---

## Building

```bash
# Full production build + electron-builder packaging
npm run build

# Build just the renderer
npm run build:renderer

# Build main process + launch Electron
npm run electron
```

| Platform | Format |
|----------|--------|
| Linux | AppImage, .deb, .rpm |
| macOS | .dmg |
| Windows | NSIS installer |
| Android | APK (via Capacitor) |

### Testing the UI

`tests/ui-sweep.mjs` walks every page in both themes at desktop and phone width against a throwaway lab
(`tests/lab/lab.sh start`: a mock Proxmox and API copies that never touch Docker) and fails on console errors,
phone overflow, unnamed buttons, missing focus states and broken safe clicks — see [tests/README.md](tests/README.md).

---

## License

MIT

## Terms and privacy

The dashboard runs against your own server and sends nothing to the author. The [Terms of Service](TERMS.md) and [Privacy Policy](PRIVACY.md) spell it out; the Discord Rich Presence feature links to both.
