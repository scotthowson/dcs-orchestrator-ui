// =============================================================================
// AutomationGuide — the Automation page's one guide: timed rules, condition
// rules, the server's own crontab, and which to reach for.
// =============================================================================

import { useState } from 'react'
import { BookOpen, ChevronDown, ChevronRight, Signpost, CalendarClock, Radar, Zap, Server, Clock, Terminal } from 'lucide-react'
import Hint from '../common/Hint'
import { pageLabel } from '../../constants/pageTitles'

import CloseButton from '../common/CloseButton'
const SECTIONS = [
  {
    title: 'Which one to use',
    icon: Signpost,
    content: `Something DCS should do at a time
  (a backup at night, a weekly prune, image updates)
  → a timed rule: New rule → At a time

Something DCS should do when the system changes
  (restart a container that turns unhealthy, warn
  when the disk fills up)
  → a condition rule: New rule → When something happens

Any other command of your own on this server
  (a script, a sync job, something outside DCS)
  → the Server crontab tab (administrators)

Rules live on the server you picked above (the hub
or one VM) and appear in Everywhere with the rest;
the crontab is always this server's own.`,
  },
  {
    title: 'Timed rules',
    icon: CalendarClock,
    content: `A timed rule runs a DCS task on a clock:
every minute, 5, 15 or 30 minutes, every hour,
day, week or month. Tasks: backup, update a stack,
image updates, Docker prune, health check, start,
stop or restart a stack, metrics snapshot, DCS
self-update, recovery bundle, a custom script.

A timed rule may also use a cron expression
(New rule → the cron line at the bottom):

* * * * *      Every minute
0 * * * *      Every hour
0 3 * * *      Daily at 3 AM
0 0 * * 0      Weekly on Sunday
0 */6 * * *    Every 6 hours

The DCS server checks every rule once a minute,
in the server's time zone (TZ). No crontab.`,
  },
  {
    title: 'Condition rules',
    icon: Radar,
    content: `A condition rule fires when the system changes:

Container unhealthy   its health check fails
Container exited      it stopped with an error
High CPU              load per core at or above 90%
High memory           memory use at or above 90%
Disk full             the install's disk 90% full

Conditions are checked every minute. After firing,
a rule waits 15 minutes before it can fire again,
so a flapping container does not start a restart
storm. A rule can set its own cooldown, and its own
threshold for the percentage conditions.
With target "*", container actions apply to the
containers that matched the condition.`,
  },
  {
    title: 'What a condition or cron rule can do',
    icon: Zap,
    content: `Start, stop or restart a stack
Restart a container
Docker prune
Start a configuration backup
Send a notification (the target is the text)
DCS self-update (target "images" also pulls
  image updates; rolls back when health drops)
Write an encrypted recovery bundle

Set the target to * for all, or name a stack or
a container.`,
  },
  {
    title: 'Run now, pause, history',
    icon: Clock,
    content: `Run now runs the action at once and records the
outcome in the rule's history (marked "manual"
for a timed rule).
Pause keeps the rule but stops it from running;
Resume starts it again.
The arrow on a rule opens its runs; a run with
output opens to show it.`,
  },
  {
    title: 'The server crontab',
    icon: Server,
    content: `The Server crontab tab is the real crontab of the
account the DCS API runs as, on this server only
(the hub and VM chips do not apply to it).

User crontab (editable)
  Add an entry, remove one, or edit the whole
  text in the Raw editor. Like crontab -e.
System cron (read-only)
  /etc/crontab and /etc/cron.d/: tasks of the OS
  and its packages.

┌───────── minute (0-59)
│ ┌─────── hour (0-23)
│ │ ┌───── day of month (1-31)
│ │ │ ┌─── month (1-12)
│ │ │ │ ┌─ day of week (0-7, 0 and 7 = Sun)
* * * * *    command to run`,
  },
  {
    title: 'Example: a nightly backup script',
    icon: Terminal,
    content: `Schedule:  0 2 * * *
Command:   /opt/dcs/backup.sh >> /var/log/backup.log 2>&1

Runs a script at 2 AM every night and appends its
output to a log file.

Tips:
  • Use full paths for commands
  • Redirect output to avoid cron mail
  • Test the command by hand first`,
  },
]

export default function AutomationGuide({ onClose }: { onClose: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(0)
  return (
    <section aria-label={`${pageLabel('automations')} guide`} className="glass rounded-xl border border-white/5 overflow-hidden animate-fade-in">
      <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-slate-400" aria-hidden />
          <h2 className="text-sm font-semibold text-slate-200">{pageLabel('automations')} guide</h2>
        </div>
        <Hint label="Close the guide">
          <CloseButton label="Close the guide" size="sm" onClick={onClose} />
        </Hint>
      </div>
      <div className="p-4 sm:p-5 space-y-3">
        <p className="text-sm text-slate-400 mb-4">
          A rule makes DCS do something by itself: at a time, or when something happens on a server.
          Both kinds run on the DCS server's own clock. The server crontab is something else: plain commands
          the operating system runs.
        </p>
        {SECTIONS.map((section, i) => {
          const isExpanded = expanded === i
          const Icon = section.icon
          return (
            <div key={section.title} className="border border-white/[0.03] rounded-lg overflow-hidden">
              <button
                type="button"
                aria-expanded={isExpanded}
                onClick={() => setExpanded(isExpanded ? null : i)}
                className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/40"
              >
                <Icon size={14} className="text-slate-400 shrink-0" aria-hidden />
                <span className="text-sm font-medium text-slate-200 flex-1">{section.title}</span>
                {isExpanded ? <ChevronDown size={14} className="text-slate-500" aria-hidden /> : <ChevronRight size={14} className="text-slate-500" aria-hidden />}
              </button>
              {isExpanded && (
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
