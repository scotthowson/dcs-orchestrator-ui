// =============================================================================
// Small pieces only the fleet UI needs: time-ago, a host from a URL, the hub's
// firewall note, how a VM was matched. Its sheets are common/Sheet with
// tone="fleet", its fields lib/fieldStyles INPUT_FLEET, its copy buttons
// common/CopyButton.
//
// The fleet's colour is violet — the hub, a VM, "this runs in a VM": its capsules,
// its scope chips, the icon tile of its sheets, the focus and the chosen preset of
// its forms. Amber stays for "needs attention" (a DCS install nobody linked, a
// token that cannot create VMs, a build to finish by hand).
// =============================================================================

import { ShieldAlert } from 'lucide-react'
import { CopyButton } from '../common/CopyButton'
import type { HubFirewall } from '../../../shared/types'

export function ago(epoch: number): string {
  if (!epoch) return 'never'
  const s = Math.max(0, Math.floor(Date.now() / 1000 - epoch))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function hostOf(url: string): string {
  const m = /^[a-z]+:\/\/([^/]+)/i.exec(url)
  return m ? m[1] : url
}

/** firewalld on the hub blocks (or, as its zone ships, would block) the port the VMs fetch DCS from and join on */
export function HubFirewallNote({ fw }: { fw?: HubFirewall | null }) {
  if (!fw?.active || fw.open !== false) return null
  const cmd = `sudo firewall-cmd --permanent${fw.zone ? ` --zone=${fw.zone}` : ''} --add-port=${fw.port}/tcp && sudo firewall-cmd --reload`
  return (
    <div className="rounded-lg border border-rose-500/25 bg-rose-500/[0.06] p-3 space-y-2">
      <p className="text-[11px] text-rose-300 flex items-start gap-2">
        <ShieldAlert size={13} className="text-rose-300 shrink-0 mt-0.5" />
        <span>
          {fw.certain ? <>firewalld on this hub <b>blocks port {fw.port}/tcp</b></> : <>firewalld on this hub keeps <b>port {fw.port}/tcp</b> closed{fw.zone ? <> in its <span className="font-mono">{fw.zone}</span> zone</> : null} unless it was opened by hand</>}
          {' '}— every new VM fetches DCS from that port and joins on it, so a build stops at <i>Install</i>. Open it on the hub (once):
        </span>
      </p>
      <div className="flex items-start gap-2">
        {/* the whole command, wrapped and selectable with one click, so it can be copied by hand too */}
        <code className="flex-1 min-w-0 rounded bg-black/30 px-2 py-1.5 text-[11px] leading-relaxed text-slate-200 font-mono break-all select-all cursor-text">{cmd}</code>
        <CopyButton text={cmd} label="Copy" variant="chip" />
      </div>
    </div>
  )
}

export const MATCH_LABEL: Record<string, string> = {
  uuid: 'matched by the VM\'s SMBIOS UUID',
  ip: 'matched by address',
  name: 'matched by name',
  provision: 'built by the hub — no guest matched yet (“Test the link” matches it)',
  manual: 'mapped by hand',
}

