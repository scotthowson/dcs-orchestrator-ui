# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

DCS Manager is the dashboard of [DCS Orchestrator](https://github.com/scotthowson/dcs-orchestrator) (formerly Docker Compose Skeleton): a premium Electron desktop application that also builds as a web app (the `DCS-UI` container) and an Android app (Capacitor). It connects to the DCS REST API (default `http://127.0.0.1:9876`) and provides live monitoring, stack management, container control, and full server administration through a dark glassmorphism design system.

**Stack:** Electron 33 + React 18 + Vite 6 + Tailwind CSS 3 + Zustand 5 + TypeScript 5 (+ [Mantine](https://mantine.dev) 8 for a few components, see below)

## Build & Dev Commands

```bash
npm run dev              # Vite dev server only (browser at localhost:5173)
npm run dev:electron     # Full Electron dev mode (Vite + esbuild + Electron)
npm run build:main       # Bundle main/preload to dist/main/*.cjs via esbuild
npm run build:renderer   # Vite build to dist/renderer/
npm run build            # Full production build + electron-builder packaging
npm run electron         # Build main process and launch Electron
```

There is no unit-test suite and no linter. The checks are `npm run typecheck`, `npm run check:themes` and the browser sweep `tests/ui-sweep.mjs` against the lab (`tests/lab/lab.sh`, see `tests/README.md`); GitHub Actions builds and publishes on a tag.

## Architecture

### Process Model (Electron)

```
Main Process (src/main/index.ts; its first import, userData.ts, names the data folder "DCS Manager" and carries an older "Docker Compose Skeleton UI" folder over once)
  ├── BrowserWindow with contextIsolation: true
  ├── electron-store for persistent settings (IPC bridge)
  ├── CORS proxy via session.webRequest (allows localhost API calls)
  └── IPC handlers: get-settings, set-setting, get-setting, get-version

Preload (src/main/preload.ts)
  └── contextBridge exposes window.electronAPI (getSettings, setSetting, etc.)

Renderer (src/renderer/)
  ├── React 18 SPA — no React Router, uses currentPage state
  ├── Zustand stores (one per concern, in src/renderer/stores/) for all state management
  ├── Fetch-based API client with retry logic
  └── Tailwind + custom glassmorphism CSS
```

The main process bundles to CJS (`dist/main/index.cjs`) via esbuild. The renderer builds to `dist/renderer/` via Vite. Both are wired together by electron-builder.

### Navigation / Page Routing

There is no React Router. Navigation is a `currentPage: PageId` state in `settingsStore`. App.tsx maps `PageId` to components via `pageComponents` record. Pages transition with a 150ms opacity fade.

The sidebar has ten **sections** (`src/renderer/constants/navSections.ts`: Dashboard, Stacks, Fleet, Docker, Monitoring, Security, Maintenance, Automation, Tools, Settings); every page lives in exactly one, and a section's pages are the tab strip over the page (`components/layout/SectionTabs.tsx`). A page keeps its own `PageId`, so anything that opens a page by id still works. The sidebar, the strip, the phone's More sheet, the command palette and `Ctrl+1…9, 0` (the sections in order) all read `navSections`. A person can hide sections and pages in Settings → Sidebar & pages (`hiddenPages`, kept per device); a hidden page still opens from the palette or a link.

**To add a new page:**
1. Add to `PageId` union in `src/shared/types.ts`
2. Name it once in `pageMeta` in `src/renderer/constants/pageTitles.ts` (label, icon, a one-line subtitle, the names it went by as `aliases`). The sidebar, the phone menu, the breadcrumb, the top bar on a phone, the command palette, the quick-action picker, the browser tab and the page's own heading (`<PageHeader page="…" />`) all read that entry; where a sentence names a page, write `pageLabel('id')`, never the words
3. Create `src/renderer/pages/YourPage.tsx` (default export)
4. Import and add to `pageComponents` in `App.tsx`
5. Give it a section: one line in `SECTION_OF` in `src/renderer/constants/navSections.ts` (TypeScript refuses a page without one; the order there is the tab order)
6. Add its search words to `pageDescriptions` / `pageKeywords` in `CommandPalette.tsx`

### State Management (Zustand)

All stores follow: `export const useXStore = create<State>((set, get) => ({ ... }))`

Key stores to understand:
- **authStore** — PBKDF2 password hashing, session management, rate limiting. Sign-in goes to the server (`POST /auth/login`, optional 2FA); the token it returns is the credential (`apiToken`), and a local PBKDF2 account is kept beside it so the lock screen works offline.
- **settingsStore** — Dual persistence: electron-store IPC or localStorage fallback. Holds currentPage, theme, serverUrl, polling intervals, and all user preferences.
- **connectionStore** — API connection lifecycle with exponential backoff (max 30s, 50 retries), heartbeat monitoring (10s), and tab-visibility-aware reconnection. Pages use `reportPollSuccess/reportPollFailure` to track connection health.

### API Layer

**Client** (`src/renderer/api/client.ts`): Fetch wrapper with 30s timeout, AbortController, max 2 retries on network errors only. Singleton `apiClient` instance. Sends the session token as `Authorization: Bearer` (`apiClient.setAuthToken`); a 401 on a signed-in session signs the person out.

**Endpoints** (`src/renderer/api/endpoints.ts`): ~60 typed functions wrapping all REST routes. Every function returns `Promise<TypedResponse>`. To add a new endpoint:
1. Add response type in `src/shared/types.ts`
2. Add typed function in `endpoints.ts`
3. Import the type in the endpoint file's import block

**Connection-aware polling** (`usePolling` / `useApi` hooks): Auto-pauses when tab is hidden, prevents overlapping requests, uses `enabled` flag gated by connection status.

### Settings Persistence

Dual backend: `window.electronAPI?.setSetting()` (electron-store JSON file) or `localStorage['app-settings']` (browser fallback). The `settingsStore.updateSetting()` auto-persists. Profile data is stored separately in `localStorage['user-profile-<username>']`.

What belongs to the PERSON follows them to every device (`lib/userSync.ts`): the server keeps one document per user (`GET/POST /settings/profile`) with the profile fields (name, icon, status, accent colour, background image) and, under `prefs`, the choices that describe how they want the dashboard (dark / light / system, personal theme, reduced motion, 24-hour clock, start page, custom CSS). `hydrateUser()` reads it, the server themes and the dashboard layout at every sign-in (the sign-in page awaits it for at most 1.5 s; `App.tsx` covers a restored session and a server switch) and a choice changed on this device is written back a moment later. The server wins on a device that has changed nothing yet (`dcs-prefs-at-<username>` holds when this device last changed them). Add a setting to `SYNCED_PREFS` only if it describes the person, not the device (polling, sidebar, server address stay local). Never POST the profile without reading it first: `patchServerProfile()` does the read-merge-write.

### Authentication Flow

The server issues the session token; a local PBKDF2 account (100k iterations, random 128-bit salt, Web Crypto API) is kept beside it for the lock screen. Three modes on Login page:
1. Initial setup → Create Admin Account
2. Returning user → Sign In (4-hour sessions, rate-limited to 5 attempts)
3. Invite registration → Register with invite code via `authRegister` API endpoint

Sessions persist in `localStorage['auth-session']`. Auto-lock via configurable inactivity timer.

## Styling Conventions

### Design System

- **Dark mode default** — `bg-slate-950` base, glassmorphism cards with `bg-slate-900/60 backdrop-blur-xl border border-white/[0.06]`
- **Light mode** — `.light` class on `<html>`, CSS overrides in `index.css` using `!important`
- **Themes** — a theme (`src/shared/themes.ts`) is one identity with a dark and a light palette (`palette_dark`/`palette_light`; a document with only `palette` gets the other look from `derivePalette`). The person picks the theme (Settings → Themes) and the mode (`settings.theme` = dark/light/system; the header switch, Ctrl+D and the palette set dark or light). `themeStore.syncDocumentTheme()` is the one place the look reaches the page (`lib/themeEngine.applyTheme`: `light` class, `data-theme`, `color-scheme`, meta theme-color, the override sheet, the pre-paint cache index.html reads). Write plain Tailwind colour classes: the engine restyles every one listed in `lib/themeClasses.ts` — after adding a class, run `npm run themes:classes` (CI's `npm run check:themes` fails otherwise). Colours passed as values (charts, Mantine `color=`, inline styles) use `var(--dcs-success)`, `var(--dcs-info)`, `var(--dcs-warning)`, `var(--dcs-danger)`, `var(--dcs-text-muted)`, … (with the stock hex as fallback) or a Mantine colour name (emerald, cyan, amber, orange, rose and slate follow the theme; violet stays violet), not a hex
- **Glass component classes** — `.glass`, `.glass-subtle`, `.glass-card`, `.glass-hover`, `.glass-1/2/3` (depth levels)
- **Accent colors** — emerald (primary/success), cyan (info), amber (warning), rose (error/danger), violet (secondary)
- **Icons** — exclusively `lucide-react`, imported per-component
- **Mantine** (`@mantine/core` 8, React 18 compatible) is used where its components beat what is here — progress bars/rings, tooltips (the VM build cards). Rules: import a component's styles one by one in `src/renderer/lib/mantine.tsx` (`@mantine/core/styles/Progress.css`, …), never `styles.css` or `baseline.css` (they restyle the page); `DcsMantineProvider` (wrapped around `<App />` in `main.tsx`) carries the dashboard's emerald/cyan/amber/rose palette and follows the `light` class on `<html>`; colours are passed as CSS values or Tailwind classes the light theme already remaps (`text-cyan-400`, `text-amber-300`, …), not Mantine's pale dark-scheme tints

### CSS Patterns

Custom animations defined in both `tailwind.config.js` (keyframes) and `src/renderer/index.css` (@layer components). Key classes:
- `animate-fade-in`, `animate-scale-in`, `animate-slide-up` — entrance animations
- `stagger-children` — cascading entrance (60ms delay per child, up to 12)
- `gradient-border`, `gradient-border-animated` — decorative card borders
- `text-gradient`, `text-gradient-warm`, `text-gradient-cool` — gradient text
- `glow-emerald/cyan/rose/amber/violet` — subtle glow effects
- `neon-emerald/cyan/rose/amber` — text shadow glow
- `skeleton` — shimmer loading placeholder
- `press` — active:scale(0.97) click feedback
- `scrollbar-thin`, `scrollbar-none` — custom scrollbar utilities

### Card Pattern

```tsx
<div className="bg-slate-900/60 backdrop-blur-md border border-white/5 rounded-xl p-6">
  <h3 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Title</h3>
  {/* content */}
</div>
```

### Table Pattern

```tsx
<th className="text-xs text-slate-500 uppercase tracking-wider">Header</th>
<tr className="border-b border-white/[0.04] hover:bg-white/[0.02]">
```

### Full-screen Overlay Pattern

Use `createPortal(jsx, document.body)` with `z-[9999]` for overlays that must escape CSS transform containing blocks (the page transition wrapper uses `translate-y-0` which creates a new stacking context for `position: fixed`).

## Key Patterns

### Adding a Toast Notification

```tsx
import { useToast } from '../components/common/Toast'
const { addToast } = useToast()
addToast({ type: 'success', message: 'Done!' })
```

### Connection-Gated Polling

```tsx
const isConnected = useConnectionStore((s) => s.status === 'connected')
const { data, refresh } = usePolling(fetchFn, intervalMs, { enabled: isConnected })
```

### Store-Driven Page Data

Pages poll data via hooks, sync results into stores, and components read from stores:
```tsx
// Page: poll → store
const { data } = useApi(fetchStacks, 5000, { enabled: isConnected })
useEffect(() => { if (data) setStacks(data.stacks) }, [data])

// Component: read store
const stacks = useStackStore((s) => s.stacks)
```

## Backend API Reference

The UI connects to the DCS Orchestrator REST API (`.scripts/api-server.sh`). The backend repo is `dcs-orchestrator` (checkout `../Docker-Compose-Skeleton-AIO/`). Key endpoint groups: `/status`, `/health`, `/stacks`, `/containers`, `/images`, `/networks`, `/volumes`, `/logs`, `/events`, `/config`, `/system`, `/env`, `/maintenance`, `/backups`, `/batch`, `/auth`.

All endpoint types are defined in `src/shared/types.ts` and all fetch wrappers in `src/renderer/api/endpoints.ts`.
