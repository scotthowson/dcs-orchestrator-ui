// =============================================================================
// CrowdSecStatus — dashboard card: is the intrusion prevention running, is the
// current visitor banned, which addresses are trusted, and one-click fixes.
// =============================================================================

import { useState } from 'react'
import { Badge } from '@mantine/core'
import { ShieldAlert, ShieldOff, Loader2, Unlock, UserCheck } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useToast } from '../common/Toast'
import { crowdsecUnbanMe, crowdsecTrust, crowdsecUnban } from '../../api/endpoints'
import type { CrowdSecStatusResponse } from '../../../shared/types'
import { pageLabel } from '../../constants/pageTitles'
import { BTN_CARD, BTN_CARD_QUIET, TONE_OK } from '../../lib/ui'
import { Card, CardBody, CardOffline } from './cardShared'
import { Skeleton, EmptyState, ErrorState } from '../common/PageState'
interface Props {
  data: CrowdSecStatusResponse | null
  error?: Error | null
  onRetry?: () => void
}

export default function CrowdSecStatus({ data, error, onRetry }: Props) {
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const setCurrentPage = useSettingsStore.getState().setCurrentPage
  const { addToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)

  const run = async (key: string, fn: () => Promise<{ message?: string }>, done: string) => {
    setBusy(key)
    try {
      const res = await fn()
      addToast({ type: 'success', message: res.message || done })
      onRetry?.()
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Request failed' })
    } finally {
      setBusy(null)
    }
  }

  if (!isConnected && !data) return <Card card="crowdsec" dim><CardOffline /></Card>
  if (!data && error) return <Card card="crowdsec" tone="attention"><ErrorState card title={`Could not load ${pageLabel('crowdsec')}'s state`} error={error} onRetry={onRetry} /></Card>
  if (!data) return <Card card="crowdsec"><Skeleton label={`Asking ${pageLabel('crowdsec')}…`} rows={3} /></Card>
  // deployed but not running well (stopped, restarting, Docker down): say so, and send the person to the page that fixes it
  if (!data.installed && data.state && data.state !== 'not_deployed') {
    return (
      <Card card="crowdsec" icon={ShieldAlert} tone="attention" open="crowdsec">
        <EmptyState card
          title={data.title || 'CrowdSec needs attention'}
          hint={data.detail || `Open the ${pageLabel('crowdsec')} page for the reason and the one-click fix.`}
        />
      </Card>
    )
  }
  if (!data.installed) {
    return (
      <Card card="crowdsec" icon={ShieldOff} open="crowdsec">
        <EmptyState card
          icon={<ShieldOff size={22} />}
          title="CrowdSec is not running"
          hint="Deploy the crowdsec template to block scanners and brute-force attempts at the reverse proxy."
          action={<button type="button" onClick={() => setCurrentPage('crowdsec')} className={`${BTN_CARD} ${TONE_OK}`}>Set up {pageLabel('crowdsec')}</button>}
        />
      </Card>
    )
  }

  const decisions = data.decisions ?? []
  // the list holds the first 50 bans; the count is every active one
  const activeBans = data.counts?.decisions_active ?? decisions.length
  const shown = Math.min(decisions.length, 60)
  // what the CrowdSec page raises as needing attention (a bouncer that stopped asking, a chain without the bouncer ...) counts here too
  const attention = (data.issues ?? []).filter((i) => i.severity === 'warning' || i.severity === 'error')
  const banned = data.client_banned
  const trusted = data.trusted ?? []
  const whitelist = data.whitelist?.addresses ?? []

  return (
    <Card
      card="crowdsec"
      icon={banned || attention.length > 0 ? ShieldAlert : undefined}
      tone={banned ? 'problem' : attention.length > 0 ? 'attention' : undefined}
      badge={<Badge component="span" color={attention.length > 0 || activeBans > 0 ? 'amber' : 'emerald'}>{attention.length > 0 ? 'needs attention' : `${activeBans} active ban${activeBans === 1 ? '' : 's'}`}</Badge>}
      open="crowdsec"
      clickable={false}
    >
      {attention.length > 0 && (
        <button type="button" onClick={() => setCurrentPage('crowdsec')} className="mb-3 w-full text-left rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 hover:bg-amber-500/15 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40">
          <span className="font-medium">{attention[0].title}</span>{attention.length > 1 ? ` and ${attention.length - 1} more` : ''}
          <span className="block text-[10px] mt-0.5">Open the {pageLabel('crowdsec')} page to fix it</span>
        </button>
      )}
      {banned && (
        <div className="mb-3 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-2 text-xs text-rose-300">
          Your address <span className="font-mono">{data.client_ip}</span> is currently banned.
        </div>
      )}

      <CardBody className="text-[11px] text-slate-500 space-y-1">
        <p>
          Whitelist follows the home address{data.whitelist?.public_ip ? <> (<span className="font-mono text-slate-300">{data.whitelist.public_ip}</span>)</> : null}
          {data.whitelist?.synced_at ? <> · synced {new Date(data.whitelist.synced_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</> : null}
        </p>
        {whitelist.length > 0 && (
          <p className="truncate">Trusted: <span className="font-mono text-slate-300">{whitelist.join(', ')}</span></p>
        )}
        {decisions.slice(0, 60).map((d) => (
          <div key={`${d.ip}-${d.scenario}`} className="flex items-center justify-between gap-2">
            <span className="truncate"><span className="font-mono text-slate-300">{d.ip}</span> <span className="text-slate-600">{d.scenario?.replace('crowdsecurity/', '')}</span></span>
            {isAdmin && (
              <button
                type="button"
                onClick={() => run(`unban-${d.ip}`, () => crowdsecUnban(d.ip), `Unbanned ${d.ip}`)}
                disabled={busy !== null}
                aria-label={`Unban ${d.ip}`}
                className="text-[10px] text-cyan-400 hover:text-cyan-300 shrink-0 disabled:opacity-50 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
              >
                {busy === `unban-${d.ip}` ? <Loader2 size={10} className="animate-spin" /> : 'unban'}
              </button>
            )}
          </div>
        ))}
        {activeBans > shown && <p className="text-slate-600">+{activeBans - shown} more</p>}
      </CardBody>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => run('me', () => crowdsecUnbanMe(), 'Your addresses were unbanned')}
          disabled={busy !== null}
          className={BTN_CARD_QUIET}
          title="Remove any ban on your current address and the home public address"
        >
          {busy === 'me' ? <Loader2 size={11} className="animate-spin" /> : <Unlock size={11} />} Unban me
        </button>
        {isAdmin && (
          <button
            type="button"
            onClick={() => run('trust', () => crowdsecTrust(), 'Address added to the whitelist')}
            disabled={busy !== null}
            className={`${BTN_CARD} ${TONE_OK}`}
            title="Whitelist the home public address and your current address so they can never be banned"
          >
            {busy === 'trust' ? <Loader2 size={11} className="animate-spin" /> : <UserCheck size={11} />} Trust my address
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-600">{trusted.length} trusted</span>
      </div>
    </Card>
  )
}
