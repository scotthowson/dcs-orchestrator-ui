# The dashboard's UI kit

What the dashboard draws each kind of thing with, once. Every page builds from this list; a page that
needs something the list does not have adds it here (a variant as a prop, never a copy in the page).
The numbers are measured in `src/renderer` of v4.0.36 (before) and of this branch (after). The older,
page-by-page audit that led here is in [ui-polish/AUDIT.md](ui-polish/AUDIT.md).

## The kit

| concept | canonical | variants (props) | file |
|---|---|---|---|
| colour meaning | `Tone`: `ok` emerald · `attention` amber · `problem` rose · `info` cyan · `neutral` slate · `fleet` violet | `TONE_TEXT`, `TONE_FILL`, `TONE_DOT`, `TONE_TILE`, `TONE_HEX`, `TONE_COLOR` (Mantine), `pctTone`, `loadTone`, `scoreGrade` + `GRADE_TONE` | `lib/tone.ts` |
| button | shape + tone class strings | shapes `BTN_TOOLBAR` (34 px), `BTN_CARD` (32), `BTN_SHEET` (44), `BTN_ICON` (32/36), `BTN_ICON_SM` (28/32); tones `TONE_QUIET`, `TONE_OK`, `TONE_ATTN`, `TONE_DANGER`, `TONE_GHOST*`, `TONE_PRESSED` (a toggle that is on); pairs `BTN_TOOLBAR_QUIET/OK/ATTN/DANGER/PRIMARY`, `BTN_CARD_QUIET`, `BTN_SHEET_QUIET/PRIMARY/DANGER` | `lib/ui.ts` |
| close / dismiss ✕ | `CloseButton` | `size="md"` (a sheet, a dialog: ✕ 16) · `"sm"` (a guide, a panel, a toast, a notice: ✕ 14); `label` | `components/common/CloseButton.tsx` |
| copy | `CopyButton`, `CopyBlock` | `variant="icon"` (24 px, beside a value) · `"chip"` (card button with its word); `CopyBlock` = a command in a well | `components/common/CopyButton.tsx` |
| headings | `PageHeader` (the page's one `<h1>`), `TITLE_PANEL`, `TITLE_DIALOG`, `SECTION_LABEL` / `SectionHeader` | `SectionHeader`: icon, count, controls on the right | `components/common/PageHeader.tsx`, `lib/ui.ts`, `components/common/SectionHeader.tsx` |
| page section / card | `Panel` (the page card `CARD` + the card header) | `sub`, `flush`, `id`, `tone`, `actions`, `badge`, `open`; the dashboard's widgets keep their own `Card` (glass) | `components/dashboard/cardShared.tsx`, `lib/pageKit.ts` |
| number tile | `StatTile` | `tone`, `short` (three to a row on a phone), `onClick` (leads to the detail), `sub` | `components/common/StatTile.tsx` |
| status chip | `Pill` (the themed Mantine Badge) | `tone`, `dot`, `icon` (10 px), `size` `xs`/`sm`/`md`, `title`; a container's own state keeps `StateChip` | `components/common/Pill.tsx` |
| number bubble | `Count` | `tone` (beside a tab or heading) · `alert` (the red count on an icon) | `components/common/Pill.tsx` |
| status line | `StatusLine` | `tone`, `icon`, `action`, `dense` (a long checklist), `as="li"`; a screen reader hears the verdict first | `components/common/StatusLine.tsx` |
| boxed message | `Notice` | `tone`, `icon`, `title`, `action`, `onDismiss`, `role` | `components/common/Notice.tsx` |
| sheet / form panel | `Sheet` | `tone` of its icon tile (`fleet` for the fleet's sheets), `wide`, `footer`, `placement="side"` (an editor beside the page), `keepOnBackdrop` | `components/common/Sheet.tsx` |
| confirmation | `useConfirm()` → `ConfirmDialog` | `danger` (rose, Cancel focused); the title asks a question | `components/common/ConfirmDialog.tsx` |
| loading / empty / failed | `Skeleton` (shape known), `LoadingState` (not known), `EmptyState`, `ErrorState` | `compact` (in a panel), `card` (in a dashboard card); `Skeleton` `variant` rows/tiles/cards/chart; `SkeletonBlock` for a hand-shaped one; one "Try again" | `components/common/PageState.tsx` |
| text field | `INPUT`, `FIELD`, `INPUT_ICON`, `FIELD_SM`, `INPUT_FLEET` (+ `LABEL`, `CAPTION`, `HINT`) | 40 px like Mantine's fields; `FIELD_SM` 34 px in a toolbar or row; `INPUT_FLEET` the fleet's violet | `lib/fieldStyles.ts` |
| search | `SearchInput` | `size="sm"` (34 px), `label`, `onClear`; the ✕ appears once something is typed | `components/common/SearchInput.tsx` |
| on / off | `Toggle`, `ToggleRow` (a real `role="switch"`) | `ToggleRow`: label, help, `def` ("Default: on.") | `components/common/Toggle.tsx` |
| one of a few (filter, view, window) | `Segmented` (Mantine `SegmentedControl` in a row that scrolls on a phone) | option `icon`, `count`, `title`, `disabled`; `fullWidth` | `components/common/Segmented.tsx` |
| choice chips (presets) | `CHOICE` / `CHOICE_SM` + `CHOICE_ON` / `CHOICE_OFF` | toolbar or card size | `lib/fieldStyles.ts` |
| keyboard hint | `Kbd` | `size="md"` in the shortcuts table | `components/common/Kbd.tsx` |
| hint on hover / focus | `Hint` (Mantine tooltip) | `position` | `components/common/Hint.tsx` |
| focus ring | `FOCUS_RING` on anything that is not a field or on the button scale | — | `lib/ui.ts` |

## Rules the kit holds the pages to

- **Icon sizes.** 14 in a toolbar button and an icon button, 12 in a card's button and a small icon
  button, 16 in a sheet's button, at the head of a row, a card or a notice, 10 in a pill, 20 in a page's
  tile, 28 in an empty state (22 inside a dashboard card). A spinner takes the size of what it replaces.
- **Colour.** Status only through a `Tone`; amber means "needs a look", never the fleet (violet is the
  fleet's). A number that is fine stays plain (`quiet()`); only a verdict that needs a look takes a colour.
  No new colour class (`npm run check:themes` holds the inventory: this branch only removes classes).
- **Buttons.** One shape per place (toolbar, card, sheet, icon); one solid primary per view
  (`BTN_TOOLBAR_PRIMARY` or `BTN_SHEET_PRIMARY`); destructive is rose and always asks first.
- **Confirmation.** `useConfirm()`; the title asks the question ("Delete this volume?"), the confirm
  button says the verb ("Delete volume"), `danger` for anything that deletes, stops, replaces or rolls
  back. A dialog that shows the progress of what it runs (Proxmox guest actions, deleting a DNS route or
  record) or makes you type a name (restoring a backup, nuking a stack) stays its own dialog.
- **States.** A list or table loads with `Skeleton` (or a `SkeletonBlock` shaped like its rows), says
  nothing is there with `EmptyState` (and the next step), and fails with `ErrorState` and "Try again".
- **Words.** Sentence case for every label, title, button and hint; product names keep their case
  (DCS Orchestrator, Docker, Traefik, CrowdSec, Proxmox, Cloudflare, Discord, Sablier, Homarr). One verb
  per action family: *Save* (keep what is in the form), *Save and apply* (keep it and make the server use
  it), *Delete* (gone for good), *Remove* (taken off a list, the thing stays), *Cancel* (leave a form),
  *Close* (leave a view), *Dismiss* (a message), *Refresh* (read again), *Try again* (after a failure),
  *Clear the …* (empty a search, filter or selection). Terms: server, stack, container, app, VM, hub,
  member (a VM that joined the hub). CrowdSec's LAPI and CAPI appear only where the CrowdSec page
  explains them.
- **Keyboard and touch.** Everything clickable is a `button` or a link with a name and a focus ring;
  actions revealed on hover (`REVEAL`) are always there on a touch screen; a setting that is kept is a
  `Toggle` (`role="switch"`); nothing scrolls the page sideways at 390 px.

## Consolidated in this branch

| concept | before (v4.0.36) | after | call sites changed |
|---|---|---|---|
| tone vocabulary | 4 `Tone` types (`good/warn/bad/mute` in CrowdSec, `ok/attention/problem` on the dashboard, colour names on Updates, a local one in the fleet jobs) | 1 (`lib/tone`) | 26 CrowdSec files, Updates, the fleet jobs, 12 colour maps turned into tone maps (health grade, backup state, event action, crontab source, DNS token …) |
| status chip | Mantine `Badge` called directly 133×, CrowdSec `Chip` 82×, Updates `Pill` 30×, two text-and-icon chips | `Pill` (246 uses); the Badge is called directly only by `Pill`, the fleet's `VmCapsule` and two indigo "asleep" tags | about 230 |
| button classes | 11 button constants outside `lib/ui` (CrowdSec `BTN*`, `ICON_BTN`, two `TONE_ATTN` in amber-200 and amber-300, two cyan `TONE_ON`, `CLOSE_BTN`) | 0 | about 130 |
| icon size in scale buttons | 226 off the shape's size | 38 (special cases: spinners in tight rows, an emphasised glyph) | 267 icons |
| close ✕ | 53 hand-made, 23 looks (✕ at 12–18, `p-1`…`h-9`) | `CloseButton`, 2 sizes (49 uses); 3 left: two tinted ✕ inside sign-in notices, the phone's round search bar | 46 |
| search field | 28 hand-built (icons 13/14/16/h-4, offsets left-2.5/3/3.5, heights 32–42 px, a ✕ on some) | `SearchInput` (30 uses) | 28 |
| text field constants | 23 (`FIELD` ×10 in 10 files at 6 heights, `INPUT`/`TEXTAREA`/`inputCls`/`W_*`/`LOGIN_INPUT` …) | 7, all in `lib/fieldStyles` | about 120 fields and labels |
| sheet | 3 (`fleetShared.Sheet`, CrowdSec `CsSheet`, the themes panel's side sheet) | `Sheet` (22 uses) | 22 |
| boxed message | 3 `Notice` (CrowdSec settings, Discord fields, bouncers) | `Notice` | 27 |
| status / check row | 8 (`StatusRow` ×2, `CheckRow`, `CheckLine`, `Check`, `Outcome` …) | `StatusLine` (58 uses) | 58 |
| switch | 4 (CrowdSec `Switch`, the Settings wrapper, two toggle rows) | `Toggle` / `ToggleRow` (the notification drawer's compact preference list keeps Mantine's own left-labelled `Switch`) | 18 |
| copy | 6 (`CopyButton`, `CopyIcon`, `CopyChip` ×2, `CopyLine` ×2) | `CopyButton` (icon, chip) + `CopyBlock` | 27 |
| number tile | 5 (`StatTile` ×4, CrowdSec `Kpi`) | `StatTile` | 32 |
| page section | 4 `Panel` (dashboard kit on glass, three CrowdSec ones on the page card) | `Panel` on the page card | 17 (the 34 existing uses take the page card) |
| loading / empty / failed | two families (`LoadingState`/`EmptyState`/`ErrorState` and `CardLoading`/`CardEmpty`/`CardError`), CrowdSec `Skel` and `Quiet`, "Retry" and "Try again" | one `PageState` family with `compact` and `card` sizes, `Skeleton`/`SkeletonBlock`, "Try again" | about 120 |
| small-capitals headings | 9 looks (10 px / xs, slate-300/400/500, three trackings) | 1 (`SECTION_LABEL`) | 22 |
| panel titles | slate-100 and slate-200 | `TITLE_PANEL` (slate-200) | 24 |
| empty-state icons | 9 sizes (20–40) | 28, 22 in a card | 46 |
| number bubbles | 7 hand-made (16 / 18 px, 9 / 10 px text) | `Count` | 7 |
| key hints | 21 `<kbd>` in 8 looks | `Kbd` | 19 |
| keyboard shortcuts | two overlays, both opened by `?` at once | one (`KeyboardShortcuts`) | — |
| filter select, time-ago, preset chips | CrowdSec `Select` ×2, `Ago` ×3; preset chips in 5 hand-made styles | `FilterSelect`, `Ago` (CrowdSec kit); `CHOICE_SM` | 13 |
| confirmations | 38 titles that were labels, 9 destructive ones without the rose tone | questions, `danger` on every overwrite | 47 |
| dead code | `common/Tooltip` (no importer), `KeyboardShortcutsPanel` | removed | — |

182 files, about 700 lines fewer.

## Not changed, and why

| what | why |
|---|---|
| The Proxmox guest-action dialog, the DNS "Delete route" / "Delete DNS record" dialogs | they run the action inside the dialog (a spinner, an error in place, a typed name for a protected record); `useConfirm()` closes first, so moving them would change what the person sees when it fails |
| `TypedConfirmDialog` (restore a backup) and `NukeDialog` | the typed name is the point |
| The tab strips (the section tabs under the top bar, the underline tabs of Activity, Automations and a template's files, the themes panel's look switch) | they are `role="tab"` with their own arrow-key handling; one `Tabs` component is the next step, not a rename |
| Header icon buttons (44 px on a phone), the phone's round buttons, the floating chat and back-to-top buttons | app chrome with touch sizes of its own |
| Time-ago formatters (`fmtAgo`, `ago`, `formatRelativeTime`) | three spellings ("5m ago" / "5 min ago"); one formatter changes words people already read in toasts and rows — a wording decision |
| The two indigo "asleep on demand" tags | indigo is the asleep identity; the Mantine palette has no themed indigo, adding one is a theme change |
| Page-local skeleton rows (Volumes, Updates) | shaped like their own table columns, built from `skeleton` blocks already |

## Checks

`npm run typecheck`, `npm run check:themes` (2265/2265, the colour-class inventory only lost classes),
`npm run build:renderer`, and `tests/ui-sweep.mjs` for an admin and a viewer, both themes, desktop and
phone, against the lab (`tests/lab/lab.sh`).

| sweep (40 pages × 2 themes × 2 widths) | v4.0.36 | this branch |
|---|---:|---:|
| admin | 7 failures (3 empty gauge captions, 4 unnamed overview tiles) | 0 |
| viewer | 129 failures (103 unnamed overview tiles, 26 empty gauge captions — the dashboard is behind every admin-only page a viewer opens) | 0 |
