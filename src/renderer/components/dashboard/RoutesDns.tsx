// =============================================================================
// RoutesDns — every Traefik route one click away, with Cloudflare DNS status
// =============================================================================

import { Globe, ExternalLink, AlertTriangle, ShieldCheck, ShieldOff, Layers } from 'lucide-react'
import { Badge } from '@mantine/core'
import { usePolling } from '../../hooks/usePolling'
import { pollKeys } from '../../api/pollKeys'
import { fetchRoutes, fetchDnsStatus } from '../../api/endpoints'
import { Card, CardBody, CardEmpty, CardError, CardLoading } from './cardShared'

export default function RoutesDns() {
  const routes = usePolling(fetchRoutes, 60000, { key: pollKeys.routes })
  const dns = usePolling(fetchDnsStatus, 120000)

  const domain = routes.data?.domain || dns.data?.domain || ''
  const list = routes.data?.routes ?? []
  const dnsOk = dns.data?.cf_configured && dns.data?.token_status === 'active' && dns.data?.zone_found
  const dnsLabel = !dns.data ? '' : !dns.data.cf_configured ? 'DNS not linked' : dnsOk ? 'DNS linked' : `DNS ${dns.data.token_status}`

  return (
    <Card
      card="routes-dns"
      meta={routes.data ? `${routes.data.total} route${routes.data.total === 1 ? '' : 's'}` : undefined}
      open="dns"
      clickable={false}
      badge={dns.data ? (
        <Badge component="span" color={dnsOk ? 'emerald' : 'slate'} leftSection={dnsOk ? <ShieldCheck size={11} /> : <ShieldOff size={11} />}>{dnsLabel}</Badge>
      ) : undefined}
    >
      {routes.error && !routes.data ? (
        <CardError title="Could not load the routes" error={routes.error} onRetry={routes.refresh} />
      ) : !routes.data ? (
        <CardLoading label="Loading the routes…" rows={4} />
      ) : list.length === 0 ? (
        <CardEmpty icon={<Globe size={22} />} title="No routes yet" hint={domain ? `Deploy a template with HTTPS routing to publish it under ${domain}.` : 'Deploy Traefik and set a domain to publish services.'} />
      ) : (
        <CardBody className="space-y-1">
          {list.map((r) => {
            // The API reports the full host from the route's Host() rule; only a bare label needs the domain
            const host = r.subdomain.includes('.') || !domain ? r.subdomain : `${r.subdomain}.${domain}`
            const url = `https://${host}`
            return (
              <a
                key={`${r.stack}/${r.service}/${r.subdomain}`}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-center gap-2.5 rounded-lg px-2.5 py-2 bg-white/[0.03] border border-white/5 hover:bg-white/[0.05] hover:border-white/10 transition-colors no-underline"
                title={`Open ${url}`}
              >
                <span className={`h-2 w-2 rounded-full shrink-0 ${r.conflict ? 'bg-amber-400' : 'bg-emerald-400'}`} aria-hidden />
                <div className="flex-1 min-w-0">
                  <span className="block text-xs font-mono font-medium text-slate-200 truncate">{host}</span>
                  <span className="flex items-center gap-1 text-[10px] text-slate-500 truncate"><Layers size={9} aria-hidden />{r.stack} · {r.service}{r.target ? ` → ${r.target}` : ''}</span>
                </div>
                {r.conflict && <span className="flex items-center gap-1 text-[10px] text-amber-400 shrink-0" title="Two services claim this subdomain"><AlertTriangle size={11} aria-hidden />conflict</span>}
                <ExternalLink size={13} className="text-slate-500 group-hover:text-cyan-400 transition-colors shrink-0" aria-hidden />
              </a>
            )
          })}
        </CardBody>
      )}
    </Card>
  )
}
