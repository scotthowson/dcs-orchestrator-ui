// =============================================================================
// BackupsGuide — the Backups page's guide: the three kinds of copy (a backup has
// the data, a config snapshot only settings, a recovery bundle the whole install
// encrypted), what each holds and what a restore of each does, as the server's
// code does it (.scripts/api-server.sh: _backup_build, _backup_restore_run,
// _snapshot_take, handle_snapshot_restore, _recovery_restore, handle_backup_upload).
// =============================================================================

import { useState } from 'react'
import { Archive, ArrowDownUp, BookOpen, Boxes, Camera, ChevronDown, ChevronRight, Compass, LifeBuoy, RotateCcw, RotateCw, SlidersHorizontal } from 'lucide-react'
import Hint from '../common/Hint'
import { pageLabel } from '../../constants/pageTitles'
import CloseButton from '../common/CloseButton'
const SECTIONS = [
  {
    title: 'Backup, snapshot or bundle?',
    icon: Compass,
    content: `Three kinds of copy, for three jobs:

Backup            your data and everything
                  around it; takes minutes;
                  as big as the data
  Use it: nightly from a schedule, before an
  upgrade, to get lost or broken App-Data back

Config snapshot   settings and stack files,
                  no data; takes seconds;
                  a few hundred KB
  Use it: before you change a compose file,
  a route or a setting you may want back

Recovery bundle   the whole install, encrypted
                  with a passphrase, with the
                  key of the secret store
  Use it: to move to a new machine, or to
  rebuild after a disaster (keep a copy off
  this box)`,
  },
  {
    title: 'What a backup holds',
    icon: Archive,
    content: `"Back up everything" makes a full backup:

• Every stack's folder  compose file, .env and
                        its App-Data (container data)
• App-Data on a drive   a stack whose App-Data is on
                        a drive of its own, as a part
                        that goes back to that path
• Named volumes         each stack's Docker volumes
• BACKUP_SOURCE_DIR     when it names a folder
                        outside DCS
• The install's state   root .env, accounts, rules,
                        settings, encrypted secrets,
                        schedules, templates, plugins,
                        compose history, snapshots

Never in it: session tokens, invite codes and
the secret store's key (.secrets/.master-key).
Keep that key, or a recovery bundle, to read
the secrets on another machine.

"Back up one stack" makes a smaller archive:
that stack's folder, its App-Data and its
volumes, without the install's state.

Running containers are paused while their stack
is read, so a database is copied at one instant.
Every archive is read back to the end and gets
a checksum (.sha256) before it is listed.`,
  },
  {
    title: 'What a snapshot holds',
    icon: Camera,
    content: `A config snapshot is made while you wait:

• Every stack's files   compose, .env and the other
                        configuration files of the
                        stack (up to 2 MB each; a
                        larger one is left out)
• Settings              the root .env and .config
• Rules and history     alerts, automations,
                        notifications, deploy and
                        update history, the accounts
                        file (a restore does not
                        bring accounts back)
• Schedules, Traefik's route files, templates
• Encrypted secrets     never the store's key

Never in it: App-Data, volumes, images, logs,
session tokens or invite codes.

Each server keeps its snapshots in .snapshots/
until you delete them: there is no retention.
The archive records the host and the DCS
version that took it.`,
  },
  {
    title: 'Restoring a backup',
    icon: RotateCcw,
    content: `1. Saved copies → Backups
2. Restore on the archive, type RESTORE
3. The status card shows the restore, then
   what came back and what did not

What happens:
• The archive is checked first: nothing is
  touched if it does not read back
• The stacks it holds are stopped
• A stack whose containers do not stop is
  skipped: its folder, App-Data and volumes
  stay exactly as they are and nothing of it
  is started. The status card names it in red
  with Docker's reason: stop it (Stacks page),
  then restore that stack alone
• Their folders, App-Data and volumes as they
  are now are set aside in .data/pre-restore
  (a drive's App-Data beside itself, as
  <path>.before-restore-<time>); the newest
  two of each are kept, older ones removed
• The archive's copy goes in their place,
  owners as they were
• A full backup also puts the install's state
  back: root .env, accounts, secrets, rules,
  settings, schedules (of the templates, only
  missing ones come back). Restart the API
  afterwards so it reads them
• The stacks start again

On a new machine with App-Data on a drive:
mount the drive and make the empty App-Data
folder the stack had, then restore; the backup
refuses to write where a drive is not mounted.

Tip: make a fresh backup before restoring an
older one, so you can go back.`,
  },
  {
    title: 'Downloading and uploading a backup',
    icon: ArrowDownUp,
    content: `Download (on each archive) saves the archive
itself in the browser, streamed from the
server's disk: a backup of many gigabytes is
never held in the page. On a hub a VM's
archive streams from the VM through the hub.
The shield beside a checked archive saves its
.sha256: sha256sum -c checks the copy.

Upload a backup puts an archive you kept
elsewhere into BACKUP_DEST_DIR of the server
the page shows (a VM's through the hub). It is
listed only once it reads back whole as a DCS
backup; junk, a cut-short file or a tar.gz
that is not a DCS backup is refused with the
reason, and nothing of it stays.

• Up to 20 GB (API_MAX_BACKUP_UPLOAD_SIZE),
  streamed to the server's disk as it goes,
  with its progress on the button. The file is
  checked against the server's limit and its
  free room before it is sent
• An upload cut off half way (a closed tab,
  a lost connection) leaves nothing behind
• Through Cloudflare a body may be 100 MB at
  most: upload larger archives over the LAN
• A renamed file ("… (1).tar.gz") gets a
  backup's name from when it was made
• The same archive twice is stored once
• It counts toward BACKUP_RETENTION_COUNT by
  when it was made: restore it before newer
  backups push it out`,
  },
  {
    title: 'Restoring a recovery bundle',
    icon: LifeBuoy,
    content: `On a new machine: the setup wizard's Admin
step, "Restore a recovery bundle". On a running
server: the Recovery bundle card, Restore.

What happens:
• The configuration as it is now is kept as a
  snapshot (.snapshots/pre-restore-<time>)
• The stacks whose App-Data the bundle brings
  back are stopped (the ones that run)
• A stack whose containers do not stop keeps
  its App-Data as it is and is not started;
  the card names it in red. Stop it, then
  restore the bundle again
• Their App-Data as it is now is set aside
  whole: .data/pre-restore/<time>/appdata, or
  beside a drive's App-Data as
  <path>.before-restore-<time>; old and new
  files never mix, and it can be put back
• The bundle's copy goes in its place, owners
  and modes as they were
• The stacks that ran start again; one that
  was stopped stays stopped

The answer, and "Last restore" on the card,
say what was stopped and started, where the
old App-Data went and what could not be done.

Upload a bundle streams the file to the server
(up to 20 GB, like a backup archive). The
setup wizard sends a bundle in one request
(about 96 MB at most): for a larger one,
create the admin there, then upload and
restore it on this card.`,
  },
  {
    title: 'Restoring a snapshot',
    icon: RotateCw,
    content: `1. Saved copies → Snapshots
2. Restore on the snapshot, type RESTORE

What happens:
• The state as it is now is taken as a
  snapshot first ("before restoring …"), so
  a restore can be undone
• Each stack's compose file goes through the
  security check: a stack that fails it is
  skipped and named, never half-restored
• The stacks' files go back (a stack that runs
  in a VM gets them there too), with .config,
  alert, automation and notification rules,
  schedules, Traefik routes and templates

Left as they are:
• The root .env: the snapshot's copy is put
  beside it as .env.restored, to compare
• Accounts, sign-in state and secrets
• App-Data and volumes (a snapshot has none)
• Running containers: nothing is stopped or
  started; deploy a stack again to run its
  restored files`,
  },
  {
    title: 'Backup settings',
    icon: SlidersHorizontal,
    content: `Each server reads these from its .env
(the ${pageLabel('environment')} page):

BACKUP_DEST_DIR="/srv/backups"
    where the archives go (required)
BACKUP_SOURCE_DIR=""
    a folder outside DCS a full backup
    takes too (empty: none)
BACKUP_RETENTION_COUNT=6
    archives kept of each kind: the full
    ones, and each stack's own
BACKUP_PAUSE=true
    pause containers while they are read
BACKUP_PAUSE_EXCEPT="dns media"
    stacks read while they run

Common destinations:
  /srv/backups        local storage
  /mnt/nas/backups    network storage
  /mnt/usb/backups    an external drive

"Backup settings" in the first card shows
what this server uses.`,
  },
  {
    title: 'Backups in a Proxmox fleet',
    icon: Boxes,
    content: `On a hub every VM runs its own DCS, and a
copy is made where the stack lives:

• Everywhere lists every server's backups and
  snapshots; Hub or a VM chip shows one
• "Back up everything" starts a full backup on
  the hub and on every VM at once; the status
  card can follow any of them
• The stack list names the hub's stacks first,
  then each VM's ("VM #103 · media"); a VM
  stack's backup runs on that VM
• A config snapshot on Everywhere is taken on
  every server, one each
• A restore always acts on the server that
  keeps the file
• Each VM has its own BACKUP_DEST_DIR and
  retention: pick its chip to see them

A VM's archive downloads through the hub, and
Upload a backup on a VM's chip puts one into
that VM. A recovery bundle belongs to one
server: the hub's is made here, a VM's on its
own dashboard.`,
  },
]

export default function BackupsGuide({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<number | null>(0)
  return (
    <section aria-label={`${pageLabel('backup')} guide`} className="surface overflow-hidden animate-fade-in">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-slate-400" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-200">{pageLabel('backup')} guide</h2>
        </div>
        <Hint label="Close the guide">
          <CloseButton label="Close the guide" size="sm" onClick={onClose} />
        </Hint>
      </div>
      <div className="p-5 space-y-3">
        <p className="text-sm text-slate-400 mb-4">
          A backup copies your data; a config snapshot copies only settings and stack files; a recovery bundle carries the whole install, encrypted, to another machine. Pick the one that holds what you may need back.
        </p>
        {SECTIONS.map((section, i) => {
          const isOpen = open === i
          const Icon = section.icon
          return (
            <div key={section.title} className="border border-white/[0.03] rounded-lg overflow-hidden">
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : i)}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
              >
                <Icon size={14} className="text-slate-400 shrink-0" aria-hidden />
                <span className="text-sm font-medium text-slate-200 flex-1">{section.title}</span>
                {isOpen ? <ChevronDown size={14} className="text-slate-500" aria-hidden /> : <ChevronRight size={14} className="text-slate-500" aria-hidden />}
              </button>
              {isOpen && (
                <div className="px-4 pb-4 animate-fade-in">
                  <pre className="bg-slate-950/60 border border-white/[0.03] rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto scrollbar-thin whitespace-pre leading-relaxed">
                    {section.content}
                  </pre>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
