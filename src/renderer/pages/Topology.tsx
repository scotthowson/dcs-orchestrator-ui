// =============================================================================
// Topology — the map of stacks → containers → networks: a three-tier tree with
// wires, drawn as SVG (zoom, pan, fullscreen) and exported as a PNG. The chrome
// around the map is the dashboard's; the map keeps its own colours for the
// tiers and the networks, and takes its text and card colours from the theme.
// =============================================================================

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import {
  Network,
  RefreshCw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Box,
  X,
  Layers,
  Server,
  WifiOff,
  ExternalLink, Download, Copy, Expand, Shrink, Link2,
} from 'lucide-react'
import { usePolling } from '../hooks/usePolling'
import { useFleetScope, type ScopeMember } from '../hooks/useFleetScope'
import { useConnectionStore } from '../stores/connectionStore'
import { useSystemStore } from '../stores/systemStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useToast } from '../components/common/Toast'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import VmCapsule from '../components/fleet/VmCapsule'
import { fetchTopologyOn, fetchTopologyFleet } from '../api/fleetScoped'
import type {
  TopologyResponse, TopologyNode, TopologyNetwork, TopologyServer,
} from '../../shared/types'
import { LoadingState, ErrorState, EmptyState } from '../components/common/PageState'
import ModalOverlay from '../components/common/ModalOverlay'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR_QUIET, BTN_ICON, BTN_ICON_SM, TONE_GHOST } from '../lib/ui'
import { CARD, FOCUS_RING } from '../lib/pageKit'
import { STATE_META } from '../lib/containerState'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NETWORK_COLORS = [
  '#10b981', '#06b6d4', '#f59e0b', '#8b5cf6',
  '#ec4899', '#f97316', '#14b8a6', '#6366f1',
]

// Node dimensions
const STACK_H = 48
const STACK_RX = 12
const CONTAINER_W = 172
const CONTAINER_H = 44
const CONTAINER_RX = 10
const NETWORK_W = 168
const NETWORK_H = 38
const NETWORK_RX = 19

// Spacing
const LEVEL_GAP = 130
const NODE_GAP = 26
const STACK_GROUP_GAP = 56
const PAD = 40
const SERVER_H = 40          // a server's band on a fleet map (the tier above the stacks)
const SERVER_GAP = 48
const SERVER_LEVEL_GAP = 64
const TIER_LABEL_OFFSET = 18   // vertical space above each tier for the label
const HEALTH_R = 4

// Zoom
const MIN_ZOOM = 0.15
const MAX_ZOOM = 3

// The map's text and card colours come from the theme (the --dcs-* variables the theme engine sets for the look in
// use); the fallback after each comma is the dark look, which is also what the PNG export draws — an exported SVG
// has no stylesheet, so it takes the fallbacks. Tier and network colours are the map's own.
const INK = { fill: 'var(--dcs-text, #e2e8f0)' }
const INK_STRONG = { fill: 'var(--dcs-text, #f8fafc)' }
const INK_INFO = { fill: 'var(--dcs-info, #67e8f9)' }
const INK_STACK = { fill: 'color-mix(in srgb, #8b5cf6 55%, var(--dcs-text, #e2e8f0))' }
const DOT = { fill: 'var(--dcs-text-muted, #ffffff)' }
/** the soft shadow under a card: black on the dark look (where it hardly shows), the look's own border colour on a light one */
const SHADOW = { fill: 'var(--dcs-border, #000000)' }

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function healthColor(state: string, health: string, onDemand?: boolean): string {
  const s = state.toLowerCase()
  const h = health.toLowerCase()
  // asleep on demand: Sablier stopped it on purpose, the first request wakes it — calm indigo, never the stopped red
  if (onDemand && s !== 'running' && s !== 'restarting') return STATE_META.asleep.color
  if (s === 'running' && h === 'healthy') return '#10b981'
  if (s === 'running' && (h === 'none' || !h || h === 'n/a')) return '#06b6d4'
  if (s === 'running' && h === 'unhealthy') return '#f59e0b'
  if (s === 'exited' || s === 'stopped' || s === 'dead') return '#ef4444'
  return '#64748b'
}

function netColor(name: string, allNames: string[]): string {
  const idx = allNames.indexOf(name)
  return NETWORK_COLORS[idx >= 0 ? idx % NETWORK_COLORS.length : 0]
}

function trunc(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 1) + '\u2026'
}

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

interface StackL {
  name: string
  x: number      // center
  y: number      // top
  width: number
  count: number
  /** the server it runs on (a fleet map), '' otherwise */
  server: string
}

interface ServerL {
  server: TopologyServer
  x: number      // center
  y: number      // top
  width: number
  stacks: number
}

interface ContainerL {
  node: TopologyNode
  x: number      // center
  y: number      // top
  stack: string
}

interface NetworkL {
  network: TopologyNetwork
  x: number      // center
  y: number      // top
  color: string
}

interface Layout {
  servers: ServerL[]
  stacks: StackL[]
  containers: ContainerL[]
  networks: NetworkL[]
  unusedNetworkY: number | null  // Y position of unused network row (null if none)
  connectedNetworkY: number      // Y position of connected network row
  w: number
  h: number
}

// ---------------------------------------------------------------------------
// Hierarchical layout algorithm
// ---------------------------------------------------------------------------

function computeLayout(data: TopologyResponse, netNames: string[]): Layout {
  // A fleet map (servers present) groups by server first: the hub, then every VM in the order the hub lists them
  const serverList: TopologyServer[] = data.servers && data.servers.length > 0 ? data.servers : []
  const fleet = serverList.length > 0
  const serverOf = (n: TopologyNode): string => (fleet ? (n.member_name || serverList[0].name) : '')

  // Group containers by (server, stack)
  const groups = new Map<string, { server: string; stack: string; nodes: TopologyNode[] }>()
  for (const n of data.nodes) {
    const stack = n.stack || 'Standalone'
    const server = serverOf(n)
    const key = `${server}\u0001${stack}`
    if (!groups.has(key)) groups.set(key, { server, stack, nodes: [] })
    groups.get(key)!.nodes.push(n)
  }

  // Sort: servers in the hub's order, then largest stacks first, Standalone always last
  const serverRank = (name: string): number => { const i = serverList.findIndex((sv) => sv.name === name); return i < 0 ? serverList.length : i }
  const entries = [...groups.values()].sort((a, b) => {
    if (a.server !== b.server) return serverRank(a.server) - serverRank(b.server)
    if (a.stack === 'Standalone') return 1
    if (b.stack === 'Standalone') return -1
    return b.nodes.length - a.nodes.length
  })

  // Position servers (fleet map only), stacks and containers; leave room for tier labels above each row
  const serverY = PAD + TIER_LABEL_OFFSET
  const stackY = fleet ? serverY + SERVER_H + SERVER_LEVEL_GAP : PAD + TIER_LABEL_OFFSET
  const containerY = stackY + STACK_H + LEVEL_GAP

  const stacks: StackL[] = []
  const containers: ContainerL[] = []
  let cx = PAD
  let lastServer: string | null = null

  for (const { server, stack: name, nodes } of entries) {
    if (fleet && lastServer !== null && server !== lastServer) cx += SERVER_GAP   // a wider gap between two servers' stacks
    lastServer = server
    const fanW = nodes.length * (CONTAINER_W + NODE_GAP) - NODE_GAP
    const stackW = Math.max(240, fanW + 32)
    const center = cx + stackW / 2

    stacks.push({ name, x: center, y: stackY, width: stackW, count: nodes.length, server })

    const fanStart = center - fanW / 2 + CONTAINER_W / 2
    nodes.forEach((node, i) => {
      containers.push({
        node,
        x: fanStart + i * (CONTAINER_W + NODE_GAP),
        y: containerY,
        stack: name,
      })
    })

    cx += stackW + STACK_GROUP_GAP
  }

  // A server's band spans its stacks; a server without any (unreachable, empty, an older DCS) gets a narrow one after the last
  const servers: ServerL[] = []
  if (fleet) {
    let sx = Math.max(cx, PAD)
    for (const sv of serverList) {
      const mine = stacks.filter((st) => st.server === sv.name)
      if (mine.length > 0) {
        const left = Math.min(...mine.map((st) => st.x - st.width / 2)), right = Math.max(...mine.map((st) => st.x + st.width / 2))
        servers.push({ server: sv, x: (left + right) / 2, y: serverY, width: right - left, stacks: mine.length })
      } else {
        servers.push({ server: sv, x: sx + 120, y: serverY, width: 240, stacks: 0 })
        sx += 240 + SERVER_GAP
      }
    }
    cx = Math.max(cx, sx)
  }

  // Separate connected vs unused networks
  const connectedNets: TopologyNetwork[] = []
  const unusedNets: TopologyNetwork[] = []
  for (const net of data.networks) {
    const hasConnection = containers.some((c) => c.node.networks.includes(net.name))
    if (hasConnection) {
      connectedNets.push(net)
    } else {
      unusedNets.push(net)
    }
  }

  // Position connected networks (bottom tier) — aligned beneath their connected containers
  const networkY = containerY + CONTAINER_H + LEVEL_GAP

  type NP = { net: TopologyNetwork; idealX: number; color: string }
  const netPos: NP[] = connectedNets.map((net) => {
    const connected = containers.filter((c) => c.node.networks.includes(net.name))
    const idealX = connected.reduce((s, c) => s + c.x, 0) / connected.length
    return { net, idealX, color: netColor(net.name, netNames) }
  })

  // Sort by position to reduce crossing wires
  netPos.sort((a, b) => a.idealX - b.idealX)

  const networks: NetworkL[] = []
  let nx = PAD + NETWORK_W / 2
  for (const p of netPos) {
    const finalX = Math.max(nx, p.idealX)
    networks.push({ network: p.net, x: finalX, y: networkY, color: p.color })
    nx = finalX + NETWORK_W + NODE_GAP + 8
  }

  // Position unused networks in a separate row below connected ones
  const unusedY = networks.length > 0
    ? networkY + NETWORK_H + 60
    : networkY
  let ux = PAD + NETWORK_W / 2
  for (const net of unusedNets) {
    networks.push({
      network: net,
      x: ux,
      y: unusedY,
      color: netColor(net.name, netNames),
    })
    ux += NETWORK_W + NODE_GAP + 8
  }

  const maxNetX = Math.max(nx, ux) + NETWORK_W / 2
  const totalW = Math.max(cx, maxNetX) + PAD
  const bottomY = unusedNets.length > 0 ? unusedY : networkY
  const totalH = bottomY + NETWORK_H + PAD * 2

  return {
    servers,
    stacks,
    containers,
    networks,
    connectedNetworkY: networkY,
    unusedNetworkY: unusedNets.length > 0 ? unusedY : null,
    w: totalW,
    h: totalH,
  }
}

// ---------------------------------------------------------------------------
// Wire path builders (bezier curves)
// ---------------------------------------------------------------------------

function stackToContainerPath(s: StackL, c: ContainerL): string {
  const y1 = s.y + STACK_H
  const y2 = c.y
  const my = (y1 + y2) / 2
  return `M ${s.x} ${y1} C ${s.x} ${my}, ${c.x} ${my}, ${c.x} ${y2}`
}

function containerToNetworkPath(c: ContainerL, n: NetworkL): string {
  const y1 = c.y + CONTAINER_H
  const y2 = n.y
  const my = (y1 + y2) / 2
  return `M ${c.x} ${y1} C ${c.x} ${my}, ${n.x} ${my}, ${n.x} ${y2}`
}

// ---------------------------------------------------------------------------
// Detail panel (portal)
// ---------------------------------------------------------------------------

function parsePortLink(portStr: string, hostname: string | undefined): { label: string; href: string } | null {
  // Match "0.0.0.0:8080->80/tcp" or ":::8080->80/tcp"
  const m = portStr.match(/(?:[\d.]+|:::?):(\d+)->/)
  if (!m) return null
  const hostPort = m[1]
  const host = hostname || 'localhost'
  return { label: `Open :${hostPort}`, href: `http://${host}:${hostPort}` }
}

/** The address a VM's published ports answer on: the host of the URL the hub reaches that member at
 *  ('' when the member or its URL is not known — then there is nothing honest to link to) */
function memberHost(member: string, members: ScopeMember[]): string {
  const url = members.find((m) => m.id === member)?.url
  if (!url) return ''
  try { return new URL(url).hostname } catch { return '' }
}

function DetailPanel({
  node,
  netNames,
  onClose,
  vmHost,
}: {
  node: TopologyNode
  netNames: string[]
  onClose: () => void
  /** null: the node runs on the hub; a string: the address of the VM that runs it ('' = not known, so no link) */
  vmHost: string | null
}) {
  const stroke = healthColor(node.state, node.health, node.on_demand)
  // a VM's published port answers on the VM: the hub's hostname in that link opened the wrong machine
  const hubHostname = useSystemStore((s) => s.status?.hostname)
  const hostname = vmHost === null ? hubHostname : vmHost

  return createPortal(
    <ModalOverlay onClose={onClose}
      className="fixed inset-0 z-[9999] flex items-end md:items-center md:justify-end bg-black/40 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="w-full md:w-96 md:h-full md:max-h-screen max-h-[85vh] glass rounded-t-2xl md:rounded-none border-t md:border-t-0 md:border-l border-white/10 shadow-2xl shadow-black/40 animate-slide-up md:animate-fade-in overflow-y-auto scrollbar-thin"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-white/5">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="flex items-center justify-center w-9 h-9 rounded-xl ring-1 shrink-0"
              style={{ backgroundColor: `${stroke}15`, borderColor: `${stroke}30` }}
            >
              <Box size={16} style={{ color: stroke }} aria-hidden />
            </div>
            <div className="min-w-0">
              <h2 className="text-sm font-bold text-slate-100 truncate font-mono">
                {node.name ?? node.id}
              </h2>
              <p className="text-[11px] text-slate-500">Container details</p>
            </div>
          </div>
          <button type="button" aria-label="Close"
            onClick={onClose}
            className={`${BTN_ICON} text-slate-400 hover:text-slate-200 hover:bg-white/5 ${FOCUS_RING}`}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className={`${CARD} p-3.5`}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">State</p>
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: stroke }} aria-hidden />
                <span className="text-sm font-medium text-slate-200 capitalize">{node.on_demand && node.state !== 'running' ? 'asleep (on demand)' : node.state}</span>
              </div>
            </div>
            <div className={`${CARD} p-3.5`}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Health</p>
              <span className="text-sm font-medium text-slate-200 capitalize">{node.health || 'N/A'}</span>
            </div>
          </div>

          <div className={`${CARD} p-3.5`}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Image</p>
            <p className="text-xs text-slate-300 font-mono break-all">{node.image}</p>
          </div>

          {node.stack && (
            <div className={`${CARD} p-3.5`}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Stack</p>
              <p className="text-sm text-slate-200">{node.stack}</p>
            </div>
          )}

          {node.ports && (
            <div className={`${CARD} p-3.5`}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-1.5">Ports</p>
              <div className="space-y-1.5">
                {node.ports.split(' ').filter(Boolean).map((p) => {
                  // a VM whose address is not known gets no link (never the hub's, never localhost)
                  const link = vmHost === '' ? null : parsePortLink(p, hostname)
                  return (
                    <div key={p} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-slate-300 font-mono break-all">{p}</span>
                      {link && (
                        <a
                          href={link.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className={`inline-flex items-center gap-1 ml-2 px-2 py-1 rounded-md text-[11px] font-medium text-cyan-400 bg-cyan-500/10 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors shrink-0 ${FOCUS_RING}`}
                        >
                          <ExternalLink size={10} aria-hidden />
                          {link.label}
                        </a>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {node.ip_addresses && node.ip_addresses.length > 0 && (
            <div className={`${CARD} p-3.5`}>
              <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
                IP addresses ({node.ip_addresses.length})
              </p>
              <div className="space-y-1">
                {node.ip_addresses.map((entry) => {
                  const c = netColor(entry.network, netNames)
                  return (
                    <div key={entry.network} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.03] px-2.5 py-1.5">
                      <span className="text-[11px] text-slate-400 flex items-center gap-1.5 min-w-0">
                        <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c }} aria-hidden />
                        <span className="truncate">{entry.network}</span>
                      </span>
                      <span className="text-xs text-cyan-400 font-mono shrink-0">{entry.ip}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className={`${CARD} p-3.5`}>
            <p className="text-[10px] text-slate-500 uppercase tracking-wider mb-2">
              Networks ({node.networks.length})
            </p>
            <div className="flex flex-wrap gap-1.5">
              {node.networks.map((net) => {
                const c = netColor(net, netNames)
                return (
                  <span
                    key={net}
                    className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-mono border"
                    style={{ backgroundColor: `${c}12`, borderColor: `${c}25`, color: c }}
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: c }} aria-hidden />
                    {net}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Main Topology component
// ---------------------------------------------------------------------------

export default function Topology() {
  const isConnected = useConnectionStore((s) => s.status) === 'connected'

  // a hub: everywhere is the fleet map (the hub's own map with every reachable VM's, each under its server's band),
  // the hub alone is its own map, and a VM's map comes through the hub's proxy
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()
  const fleetMap = scope === 'all' && hasFleet
  const fetchScoped = useCallback(async () => ({ member: scopeMember, res: await (fleetMap ? fetchTopologyFleet() : fetchTopologyOn(scopeMember)) }), [scopeMember, fleetMap])
  const { data: tagged, loading, error, refresh } = usePolling<{ member: string | null; res: TopologyResponse }>(
    fetchScoped, 15000, { enabled: isConnected },
  )
  // the answer for the server chosen above (a switch never draws the old map under the new label)
  const topoData = tagged && tagged.member === scopeMember ? tagged.res : null
  const memberRef = useRef(scopeMember)
  useEffect(() => { if (memberRef.current !== scopeMember) { memberRef.current = scopeMember; refresh() } }, [scopeMember, refresh])

  const { addToast } = useToast()
  const hubHostname = useSystemStore((s) => s.status?.hostname)
  const hostForExport = scopeMember ? memberName : hubHostname
  const reduceMotionPref = useSettingsStore((s) => s.reduceMotion)
  // Zoom & pan
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, px: 0, py: 0 })
  const lastPinchDist = useRef<number | null>(null)

  // Selection / hover
  const [selectedNode, setSelectedNode] = useState<TopologyNode | null>(null)
  const [hoveredStack, setHoveredStack] = useState<string | null>(null)
  const [hoveredContainer, setHoveredContainer] = useState<string | null>(null)
  const [hoveredNetwork, setHoveredNetwork] = useState<string | null>(null)

  // a node of another server has no place on the new map
  useEffect(() => { setSelectedNode(null) }, [scopeMember])

  // Stable network name list for coloring
  const netNames = useMemo(
    () => (topoData?.networks ?? []).map((n) => n.name),
    [topoData],
  )

  // Compute hierarchical layout
  const layout = useMemo(() => {
    if (!topoData || topoData.nodes.length === 0) return null
    return computeLayout(topoData, netNames)
  }, [topoData, netNames])

  // Stats
  const totalContainers = topoData?.nodes.length ?? 0
  const totalNetworks = topoData?.networks.length ?? 0
  const totalEdges = topoData?.edges.length ?? 0

  // --- Auto-fit on first layout ---
  const didAutoFit = useRef(false)
  useEffect(() => {
    if (!layout || !containerRef.current || didAutoFit.current) return
    didAutoFit.current = true
    const rect = containerRef.current.getBoundingClientRect()
    const sx = rect.width / layout.w
    const sy = rect.height / layout.h
    const fitZoom = Math.min(sx, sy, 1.2) * 0.88
    setZoom(fitZoom)
    setPan({
      x: (rect.width - layout.w * fitZoom) / 2,
      y: (rect.height - layout.h * fitZoom) / 2,
    })
  }, [layout])

  // --- Zoom handlers ---
  const handleZoomIn = useCallback(() => setZoom((z) => Math.min(z * 1.25, MAX_ZOOM)), [])
  const handleZoomOut = useCallback(() => setZoom((z) => Math.max(z / 1.25, MIN_ZOOM)), [])
  const handleReset = useCallback(() => {
    if (!layout || !containerRef.current) { setZoom(1); setPan({ x: 0, y: 0 }); return }
    const rect = containerRef.current.getBoundingClientRect()
    const sx = rect.width / layout.w
    const sy = rect.height / layout.h
    const fitZoom = Math.min(sx, sy, 1.2) * 0.88
    setZoom(fitZoom)
    setPan({ x: (rect.width - layout.w * fitZoom) / 2, y: (rect.height - layout.h * fitZoom) / 2 })
  }, [layout])

  // A container the keyboard reached may lie outside the visible part of the map: the map pans to it
  // (a clipped box would otherwise scroll to its focused child and leave the map where it was)
  const revealNode = useCallback((x: number, y: number) => {
    const el = containerRef.current
    if (!el) return
    el.scrollLeft = 0
    el.scrollTop = 0
    const box = el.getBoundingClientRect()
    const px = pan.x + x * zoom
    const py = pan.y + y * zoom
    const margin = 70
    const dx = px < margin ? margin - px : px > box.width - margin ? box.width - margin - px : 0
    const dy = py < margin ? margin - py : py > box.height - margin ? box.height - margin - py : 0
    if (dx || dy) setPan({ x: pan.x + dx, y: pan.y + dy })
  }, [pan, zoom])

  // --- Fullscreen: the map fills the screen, then re-fits ---
  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen()
    else void el.requestFullscreen?.()
  }, [])
  useEffect(() => {
    const onChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      setTimeout(() => handleReset(), 60)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [handleReset])

  // --- Export: the whole map as a PNG (download or clipboard), with a caption ---
  const exportImage = useCallback(async (mode: 'download' | 'copy') => {
    const svg = svgRef.current
    if (!svg || !layout || exporting) return
    setExporting(true)
    try {
      const PADX = 48, PADY = 48, FOOT = 44
      const w = Math.ceil(layout.w + PADX * 2)
      const h = Math.ceil(layout.h + PADY * 2 + FOOT)
      const clone = svg.cloneNode(true) as SVGSVGElement
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
      clone.setAttribute('width', String(w))
      clone.setAttribute('height', String(h))
      clone.setAttribute('viewBox', `0 0 ${w} ${h}`)
      clone.removeAttribute('class')
      clone.removeAttribute('style')
      const rootGroup = clone.querySelector('g')
      if (rootGroup) rootGroup.setAttribute('transform', `translate(${PADX},${PADY}) scale(1)`)
      const ns = 'http://www.w3.org/2000/svg'
      const style = document.createElementNS(ns, 'style')
      style.textContent = 'text { font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; } .topo-flow, .topo-pulse { animation: none; }'
      const bg = document.createElementNS(ns, 'rect')
      bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#0b1220')
      clone.insertBefore(bg, clone.firstChild)
      clone.insertBefore(style, clone.firstChild)
      const xml = new XMLSerializer().serializeToString(clone)
      const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))
      const img = new Image()
      try {
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve()
          img.onerror = () => reject(new Error('The map could not be rendered to an image'))
          img.src = url
        })
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000)
      }
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const ctx = canvas.getContext('2d')
      if (!ctx) throw new Error('Canvas is not available')
      ctx.scale(scale, scale)
      ctx.drawImage(img, 0, 0, w, h)
      const host = hostForExport || 'DCS'
      ctx.fillStyle = 'rgba(148,163,184,0.9)'
      ctx.font = '600 12px ui-sans-serif, system-ui, sans-serif'
      ctx.fillText(`DCS Orchestrator · ${host} · ${new Date().toLocaleString()} · ${totalContainers} containers · ${totalNetworks} networks · ${totalEdges} links`, PADX, h - 18)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
      if (!blob) throw new Error('PNG encoding failed')
      if (mode === 'copy') {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
        addToast({ type: 'success', message: 'Topology copied to the clipboard' })
      } else {
        const a = document.createElement('a')
        a.href = URL.createObjectURL(blob)
        a.download = `dcs-topology-${host.replace(/[^A-Za-z0-9_-]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.png`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(a.href), 2000)
        addToast({ type: 'success', message: 'Topology saved as PNG' })
      }
    } catch (err) {
      addToast({ type: 'error', message: err instanceof Error ? err.message : 'Export failed' })
    } finally {
      setExporting(false)
    }
  }, [layout, exporting, hostForExport, totalContainers, totalNetworks, totalEdges, addToast])

  // React's onWheel is passive (preventDefault is ignored and the page scrolls),
  // so the wheel is handled natively: multiplicative zoom centred on the cursor.
  const zoomRef = useRef(zoom); zoomRef.current = zoom
  const panRef = useRef(pan); panRef.current = pan
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY > 0 ? 0.9 : 1.1
      const z0 = zoomRef.current
      const z1 = Math.min(Math.max(z0 * factor, MIN_ZOOM), MAX_ZOOM)
      if (z1 === z0) return
      const p0 = panRef.current
      setPan({ x: cx - (cx - p0.x) * (z1 / z0), y: cy - (cy - p0.y) * (z1 / z0) })
      setZoom(z1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [layout])
  const reduceMotion = useMemo(() => reduceMotionPref || (typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches), [reduceMotionPref])

  // --- Pan handlers ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('[data-node]')) return
    setIsPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
  }, [pan])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanning) return
    setPan({
      x: panStart.current.px + (e.clientX - panStart.current.x),
      y: panStart.current.py + (e.clientY - panStart.current.y),
    })
  }, [isPanning])

  const handleMouseUp = useCallback(() => setIsPanning(false), [])

  // Touch events
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1) {
      setIsPanning(true)
      panStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY, px: pan.x, py: pan.y }
    } else if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      lastPinchDist.current = Math.hypot(dx, dy)
    }
  }, [pan])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && isPanning) {
      setPan({
        x: panStart.current.px + (e.touches[0].clientX - panStart.current.x),
        y: panStart.current.py + (e.touches[0].clientY - panStart.current.y),
      })
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      setZoom((z) => Math.min(Math.max(z * (dist / lastPinchDist.current!), MIN_ZOOM), MAX_ZOOM))
      lastPinchDist.current = dist
    }
  }, [isPanning])

  const handleTouchEnd = useCallback(() => {
    setIsPanning(false)
    lastPinchDist.current = null
  }, [])

  useEffect(() => {
    const up = () => setIsPanning(false)
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  }, [])

  // --- Highlight logic ---
  // Which stacks, containers & networks are highlighted?
  const highlightedStacks = useMemo(() => {
    const set = new Set<string>()
    if (hoveredStack) set.add(hoveredStack)
    if (hoveredContainer) {
      const cl = layout?.containers.find((c) => c.node.id === hoveredContainer)
      if (cl) set.add(cl.stack)
    }
    return set
  }, [hoveredStack, hoveredContainer, layout])

  const highlightedContainers = useMemo(() => {
    const set = new Set<string>()
    if (hoveredContainer) {
      set.add(hoveredContainer)
    }
    if (hoveredStack) {
      for (const c of layout?.containers ?? []) {
        if (c.stack === hoveredStack) set.add(c.node.id)
      }
    }
    if (hoveredNetwork) {
      for (const c of layout?.containers ?? []) {
        if (c.node.networks.includes(hoveredNetwork)) set.add(c.node.id)
      }
    }
    return set
  }, [hoveredStack, hoveredContainer, hoveredNetwork, layout])

  const highlightedNetworks = useMemo(() => {
    const set = new Set<string>()
    if (hoveredNetwork) {
      set.add(hoveredNetwork)
    }
    if (hoveredContainer) {
      const node = topoData?.nodes.find((n) => n.id === hoveredContainer)
      if (node) node.networks.forEach((n) => set.add(n))
    }
    if (hoveredStack) {
      for (const c of layout?.containers ?? []) {
        if (c.stack === hoveredStack) {
          c.node.networks.forEach((n) => set.add(n))
        }
      }
    }
    return set
  }, [hoveredStack, hoveredContainer, hoveredNetwork, topoData, layout])

  const hasHighlight = highlightedStacks.size > 0 || highlightedContainers.size > 0 || highlightedNetworks.size > 0

  // --- Render ---
  const isEmpty = !topoData || topoData.nodes.length === 0
  const scopeVmid = scopeMembers.find((m) => m.id === scopeMember)?.vmid

  // the line under the name: the page's own (the registry's) unless it shows one part of a fleet
  const subtitle = scopeMember
    ? `Stacks, containers and networks inside the VM ${memberName}`
    : scope === 'all' && hasFleet
      ? 'The hub\'s own map — every VM has its own network, one chip away'
      : undefined

  const tools = [
    { fn: handleZoomIn, icon: ZoomIn, title: 'Zoom in', disabled: false },
    { fn: handleZoomOut, icon: ZoomOut, title: 'Zoom out', disabled: false },
    { fn: handleReset, icon: Maximize2, title: 'Fit to view', disabled: false },
    { fn: () => void exportImage('download'), icon: Download, title: 'Save as PNG', disabled: exporting || !layout },
    { fn: () => void exportImage('copy'), icon: Copy, title: 'Copy image to clipboard', disabled: exporting || !layout },
    { fn: toggleFullscreen, icon: isFullscreen ? Shrink : Expand, title: isFullscreen ? 'Leave fullscreen' : 'Fullscreen', disabled: !layout },
  ]

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />
      {/* Detail panel */}
      {selectedNode && (
        // the VM that runs the node: its own on the fleet map, the chosen VM on a single VM's map, none on the hub's
        <DetailPanel node={selectedNode} netNames={netNames} onClose={() => setSelectedNode(null)}
          vmHost={(selectedNode.member ?? scopeMember) ? memberHost((selectedNode.member ?? scopeMember) as string, scopeMembers) : null} />
      )}

      <PageHeader
        page="topology"
        badge={hasFleet ? <VmCapsule member={scopeMember} name={memberName} vmid={scopeVmid} /> : undefined}
        subtitle={subtitle}
        actions={isConnected ? (
          <button type="button" onClick={refresh} disabled={loading} className={`${BTN_TOOLBAR_QUIET} ${FOCUS_RING}`}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            Refresh
          </button>
        ) : undefined}
      >
        {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Map of" busy={loading && !!topoData} />}
      </PageHeader>

      {!isConnected ? (
        <EmptyState icon={<WifiOff size={26} />} title="Connect to a server to see the topology map" />
      ) : (
      <>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 md:gap-3">
        {[
          ...(layout && layout.servers.length > 0 ? [{ icon: Server, label: 'Servers', value: layout.servers.length }] : []),
          { icon: Layers, label: 'Stacks', value: layout?.stacks.length ?? 0 },
          { icon: Box, label: 'Containers', value: totalContainers },
          { icon: Network, label: 'Networks', value: totalNetworks },
          { icon: Link2, label: 'Links', value: totalEdges },
        ].map((s) => (
          <div key={s.label} className={`${CARD} hover:border-white/10 transition-colors p-3 md:p-4`}>
            <div className="flex items-center gap-1.5 mb-1">
              <s.icon size={13} className="text-cyan-400" aria-hidden />
              <span className="text-[10px] text-slate-500 uppercase tracking-wider">{s.label}</span>
            </div>
            <p className="text-lg md:text-2xl font-bold text-slate-100 tabular-nums">{s.value}</p>
          </div>
        ))}
      </div>

      {/* Canvas card */}
      <div className={`${CARD} p-3 md:p-6`}>
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-2 mb-3 md:mb-4">
          <div className="flex items-center gap-2 min-w-0">
            <Network size={15} className="text-cyan-400 shrink-0" aria-hidden />
            <h2 className="text-xs md:text-sm font-semibold text-slate-300 whitespace-nowrap">Topology map</h2>
            <span className="hidden sm:inline text-[11px] text-slate-500 ml-1 tabular-nums" aria-label={`Zoom ${Math.round(zoom * 100)} percent`}>{Math.round(zoom * 100)}%</span>
            {(hoveredContainer || hoveredNetwork || hoveredStack) && (
              <span className="hidden sm:inline-flex items-center gap-1.5 ml-2 px-2 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-[11px] font-mono text-cyan-300 truncate max-w-[220px] animate-fade-in" aria-hidden>
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse shrink-0" />
                {hoveredContainer || hoveredNetwork || hoveredStack}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {tools.map((btn) => (
              <Hint key={btn.title} label={btn.title}>
                <button
                  type="button"
                  onClick={btn.fn}
                  disabled={btn.disabled}
                  aria-label={btn.title}
                  className={`${BTN_ICON_SM} ${TONE_GHOST} ${FOCUS_RING}`}
                >
                  <btn.icon size={14} />
                </button>
              </Hint>
            ))}
          </div>
        </div>

        {/* Canvas */}
        {loading && !topoData ? (
          <LoadingState label="Mapping the network…" />
        ) : error && !topoData ? (
          <ErrorState title="Could not load the topology" error={error} onRetry={refresh} />
        ) : isEmpty ? (
          <EmptyState
            icon={<Network size={36} />}
            title="No containers running"
            hint="Start some stacks and the map of their networks appears here."
          />
        ) : layout ? (
          <div
            ref={containerRef}
            className={`relative overflow-hidden rounded-lg border border-white/[0.03] ${isFullscreen ? 'bg-slate-950' : 'bg-slate-950/50'}`}
            style={{
              height: isFullscreen ? '100vh' : 'clamp(300px, 55vh, 640px)',
              cursor: isPanning ? 'grabbing' : 'grab',
              touchAction: 'none',
            }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
          >
            <svg ref={svgRef} width="100%" height="100%" className="select-none" style={{ overflow: 'visible' }} role="group" aria-label={`Topology map: ${layout.stacks.length} stack${layout.stacks.length === 1 ? '' : 's'}, ${totalContainers} container${totalContainers === 1 ? '' : 's'}, ${totalNetworks} network${totalNetworks === 1 ? '' : 's'}`}>
              <g transform={`translate(${pan.x},${pan.y}) scale(${zoom})`}>

                {/* =========== SVG DEFS =========== */}
                <defs>
                  {/* Dot grid pattern */}
                  <pattern id="dotGrid" width="28" height="28" patternUnits="userSpaceOnUse">
                    <circle cx="14" cy="14" r="0.8" fill="white" opacity="0.07" style={DOT} />
                  </pattern>

                  {/* Network color gradients (for wires) */}
                  {NETWORK_COLORS.map((color, i) => (
                    <linearGradient key={`ng${i}`} id={`netGrad${i}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={layout?.h ?? 1000}>
                      <stop offset="0%" stopColor={color} stopOpacity={0.5} />
                      <stop offset="100%" stopColor={color} stopOpacity={0.8} />
                    </linearGradient>
                  ))}

                  {/* Structural wire gradient (stack → container) */}
                  <linearGradient id="structGrad" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2={layout?.h ?? 1000}>
                    <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.2} />
                  </linearGradient>

                  {/* Glow filter for highlighted wires */}
                  <filter id="wireGlow" x="-40%" y="-40%" width="180%" height="180%">
                    <feGaussianBlur in="SourceGraphic" stdDeviation="3" result="blur" />
                    <feMerge>
                      <feMergeNode in="blur" />
                      <feMergeNode in="SourceGraphic" />
                    </feMerge>
                  </filter>

                  {/* Subtle card shadow */}
                  <filter id="cardShadow" x="-10%" y="-10%" width="120%" height="130%">
                    <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="black" floodOpacity="0.3" />
                  </filter>
                </defs>

                {/* Background grid */}
                <rect x={0} y={0} width={layout.w} height={layout.h} fill="url(#dotGrid)" rx={8} />

                {/* =========== TIER 1: Stack → Container wires =========== */}
                {layout.containers.map((c) => {
                  const stack = layout.stacks.find((s) => s.name === c.stack)
                  if (!stack) return null
                  const path = stackToContainerPath(stack, c)
                  const isHigh = highlightedContainers.has(c.node.id)
                  const dim = hasHighlight && !isHigh
                  const wireColor = stack.name === 'Standalone' ? '#475569' : '#8b5cf6'

                  return (
                    <g key={`sw-${c.node.id}`}>
                      {/* Glow layer when highlighted */}
                      {isHigh && (
                        <path
                          d={path}
                          fill="none"
                          stroke={wireColor}
                          strokeWidth={5}
                          strokeOpacity={0.1}
                          filter="url(#wireGlow)"
                        />
                      )}
                      {/* Flow along the wire while it is highlighted */}
                      {isHigh && !reduceMotion && (
                        <path
                          d={path}
                          fill="none"
                          stroke={wireColor}
                          strokeWidth={2.4}
                          strokeOpacity={0.55}
                          strokeLinecap="round"
                          strokeDasharray="5 14"
                          className="topo-flow"
                        />
                      )}
                      {/* Main wire */}
                      <path
                        d={path}
                        fill="none"
                        stroke={isHigh ? wireColor : 'url(#structGrad)'}
                        strokeWidth={dim ? 0.7 : isHigh ? 2 : 1.1}
                        opacity={dim ? 0.12 : isHigh ? 0.8 : 0.5}
                        strokeLinecap="round"
                        style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }}
                      />
                      {/* Animated flow dot when highlighted */}
                      {isHigh && !reduceMotion && (
                        <circle r={2.2} fill={wireColor} opacity={0.8}>
                          <animateMotion dur="2s" repeatCount="indefinite" path={path} />
                        </circle>
                      )}
                      {/* Endpoint dots */}
                      {isHigh && (
                        <>
                          <circle cx={stack.x} cy={stack.y + STACK_H} r={2} fill={wireColor} opacity={0.5} />
                          <circle cx={c.x} cy={c.y} r={2} fill={wireColor} opacity={0.5} />
                        </>
                      )}
                    </g>
                  )
                })}

                {/* =========== TIER 2: Container → Network wires =========== */}
                {layout.containers.flatMap((c) =>
                  c.node.networks.map((netName) => {
                    const net = layout.networks.find((n) => n.network.name === netName)
                    if (!net) return null
                    const path = containerToNetworkPath(c, net)
                    const gradIdx = netNames.indexOf(netName)
                    const gi = gradIdx >= 0 ? gradIdx % NETWORK_COLORS.length : 0
                    const isHigh =
                      highlightedContainers.has(c.node.id) && highlightedNetworks.has(netName)
                    const dim = hasHighlight && !isHigh
                    return (
                      <g key={`nw-${c.node.id}-${netName}`}>
                        {/* Glow layer (only when highlighted) */}
                        {isHigh && (
                          <path
                            d={path}
                            fill="none"
                            stroke={net.color}
                            strokeWidth={5}
                            strokeOpacity={0.12}
                            filter="url(#wireGlow)"
                          />
                        )}
                        {isHigh && !reduceMotion && (
                          <path
                            d={path}
                            fill="none"
                            stroke={net.color}
                            strokeWidth={2.4}
                            strokeOpacity={0.6}
                            strokeLinecap="round"
                            strokeDasharray="5 14"
                            className="topo-flow"
                          />
                        )}
                        {/* Main wire */}
                        <path
                          d={path}
                          fill="none"
                          stroke={`url(#netGrad${gi})`}
                          strokeWidth={isHigh ? 2.2 : 1.2}
                          opacity={dim ? 0.08 : isHigh ? 1 : 0.35}
                          strokeLinecap="round"
                          style={{ transition: 'opacity 0.2s, stroke-width 0.2s' }}
                        />
                        {/* Animated flow dots when highlighted */}
                        {isHigh && (
                          <circle r={2.5} fill={net.color} opacity={0.9}>
                            <animateMotion dur="2.5s" repeatCount="indefinite" path={path} />
                          </circle>
                        )}
                        {/* Endpoint dots */}
                        <circle cx={c.x} cy={c.y + CONTAINER_H} r={dim ? 1 : 1.8} fill={net.color} opacity={dim ? 0.08 : 0.45} />
                        <circle cx={net.x} cy={net.y} r={dim ? 1 : 1.8} fill={net.color} opacity={dim ? 0.08 : 0.45} />
                      </g>
                    )
                  }),
                )}

                {/* =========== SERVER BANDS (a fleet map: the hub and every VM, above their stacks) =========== */}
                {layout.servers.map((sv) => {
                  const accent = sv.server.hub ? '#f59e0b' : sv.server.answered ? '#38bdf8' : '#64748b'
                  const mine = layout.stacks.filter((st) => st.server === sv.server.name)
                  const label = sv.server.hub ? `${sv.server.name} · hub` : sv.server.answered ? sv.server.name : `${sv.server.name} · ${sv.server.reachable === false ? 'unreachable' : 'no answer'}`
                  return (
                    <g key={`server-${sv.server.name}`} data-node="true">
                      {mine.map((st) => (
                        <path
                          key={`sw-${sv.server.name}-${st.name}`}
                          d={`M ${sv.x} ${sv.y + SERVER_H} C ${sv.x} ${sv.y + SERVER_H + SERVER_LEVEL_GAP / 2}, ${st.x} ${st.y - SERVER_LEVEL_GAP / 2}, ${st.x} ${st.y}`}
                          fill="none"
                          stroke={accent}
                          strokeWidth={1}
                          strokeOpacity={0.3}
                        />
                      ))}
                      <rect x={sv.x - sv.width / 2 + 1} y={sv.y + 2} width={sv.width} height={SERVER_H} rx={STACK_RX} fill="black" fillOpacity={0.25} style={SHADOW} />
                      <rect
                        x={sv.x - sv.width / 2}
                        y={sv.y}
                        width={sv.width}
                        height={SERVER_H}
                        rx={STACK_RX}
                        fill="rgba(15, 23, 42, 0.88)"
                        stroke={accent}
                        strokeWidth={1}
                        strokeOpacity={0.45}
                        strokeDasharray={sv.server.answered ? 'none' : '4 3'}
                      />
                      <rect x={sv.x - sv.width / 2 + 4} y={sv.y + 4} width={sv.width - 8} height={2} rx={1} fill={accent} fillOpacity={0.45} />
                      <g transform={`translate(${sv.x - sv.width / 2 + 14}, ${sv.y + SERVER_H / 2 - 7})`}>
                        <rect width={14} height={14} rx={3} fill={`${accent}20`} />
                        <rect x={3} y={3} width={8} height={3} rx={1} fill={accent} fillOpacity={0.9} />
                        <rect x={3} y={8} width={8} height={3} rx={1} fill={accent} fillOpacity={0.6} />
                      </g>
                      <text
                        x={sv.x - sv.width / 2 + 34}
                        y={sv.y + SERVER_H / 2 + 4}
                        fill="#e2e8f0"
                        fontSize={12}
                        fontWeight={600}
                        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                      >
                        <title>{`${sv.server.name}: ${sv.stacks} stack${sv.stacks === 1 ? '' : 's'}`}</title>
                        {trunc(label, Math.max(8, Math.floor((sv.width - 48) / 7)))}
                      </text>
                    </g>
                  )
                })}

                {/* =========== STACK CARDS (top tier) =========== */}
                {layout.stacks.map((s) => {
                  const isStandalone = s.name === 'Standalone'
                  const isStackHigh = highlightedStacks.has(s.name)
                  const stackDim = hasHighlight && !isStackHigh
                  const stackAccent = isStandalone ? '#475569' : '#8b5cf6'

                  return (
                    <g
                      key={`stack-${s.name}`}
                      data-node="true"
                      style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                      opacity={stackDim ? 0.35 : 1}
                      onMouseEnter={() => setHoveredStack(s.name)}
                      onMouseLeave={() => setHoveredStack(null)}
                    >
                      {/* Outer glow ring on hover */}
                      {isStackHigh && (
                        <rect
                          x={s.x - s.width / 2 - 4}
                          y={s.y - 4}
                          width={s.width + 8}
                          height={STACK_H + 8}
                          rx={STACK_RX + 4}
                          fill="none"
                          stroke={stackAccent}
                          strokeWidth={1}
                          strokeOpacity={0.25}
                        />
                      )}
                      {/* Shadow */}
                      <rect
                        x={s.x - s.width / 2 + 1}
                        y={s.y + 2}
                        width={s.width}
                        height={STACK_H}
                        rx={STACK_RX}
                        fill="black"
                        fillOpacity={0.25}
                        style={SHADOW}
                      />
                      {/* Background */}
                      <rect
                        x={s.x - s.width / 2}
                        y={s.y}
                        width={s.width}
                        height={STACK_H}
                        rx={STACK_RX}
                        fill="rgba(15, 23, 42, 0.88)"
                        stroke={stackAccent}
                        strokeWidth={isStackHigh ? 1.4 : 1}
                        strokeOpacity={isStackHigh ? 0.7 : 0.35}
                        strokeDasharray={isStandalone ? '4 3' : 'none'}
                      />
                      {/* Inner accent bar at top (inside card, below the rounded corner) */}
                      <rect
                        x={s.x - s.width / 2 + 4}
                        y={s.y + 4}
                        width={s.width - 8}
                        height={2}
                        rx={1}
                        fill={stackAccent}
                        fillOpacity={isStackHigh ? 0.6 : 0.4}
                      />
                      {/* Stack icon */}
                      <g transform={`translate(${s.x - s.width / 2 + 14}, ${s.y + STACK_H / 2 - 7})`}>
                        <rect width={14} height={14} rx={3} fill={isStandalone ? '#47556920' : '#8b5cf620'} />
                        {/* Simple layers icon */}
                        <line x1={3} y1={5} x2={11} y2={5} stroke={isStandalone ? '#64748b' : '#a78bfa'} strokeWidth={1.2} strokeLinecap="round" />
                        <line x1={3} y1={7.5} x2={11} y2={7.5} stroke={isStandalone ? '#64748b' : '#a78bfa'} strokeWidth={1.2} strokeLinecap="round" />
                        <line x1={3} y1={10} x2={11} y2={10} stroke={isStandalone ? '#64748b' : '#a78bfa'} strokeWidth={1.2} strokeLinecap="round" />
                      </g>
                      {/* Stack name */}
                      <text
                        x={s.x - s.width / 2 + 34}
                        y={s.y + STACK_H / 2 - 2}
                        dominantBaseline="central"
                        fill={isStandalone ? '#94a3b8' : '#c4b5fd'}
                        style={isStandalone ? undefined : INK_STACK}
                        fontSize={12}
                        fontWeight={700}
                        fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                      >
                        {trunc(s.name, 28)}
                      </text>
                      {/* Count badge */}
                      <rect
                        x={s.x + s.width / 2 - 36}
                        y={s.y + STACK_H / 2 - 9}
                        width={24}
                        height={18}
                        rx={9}
                        fill={isStandalone ? '#47556925' : '#8b5cf618'}
                        stroke={isStandalone ? '#475569' : '#8b5cf6'}
                        strokeWidth={0.5}
                        strokeOpacity={0.3}
                      />
                      <text
                        x={s.x + s.width / 2 - 24}
                        y={s.y + STACK_H / 2}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={isStandalone ? '#94a3b8' : '#a78bfa'}
                        style={isStandalone ? undefined : INK_STACK}
                        fontSize={10}
                        fontWeight={700}
                      >
                        {s.count}
                      </text>
                    </g>
                  )
                })}

                {/* =========== CONTAINER CARDS (middle tier) =========== */}
                {layout.containers.map((c) => {
                  const stroke = healthColor(c.node.state, c.node.health, c.node.on_demand)
                  const isHigh = highlightedContainers.has(c.node.id)
                  const dim = hasHighlight && !isHigh
                  const isSel = selectedNode?.id === c.node.id

                  return (
                    <g
                      key={`c-${c.node.id}`}
                      data-node="true"
                      role="button"
                      tabIndex={0}
                      aria-label={`Container ${c.node.id}, ${c.node.on_demand && c.node.state !== 'running' ? 'asleep on demand' : c.node.state || 'unknown'}${c.node.health && c.node.health !== 'none' ? `, ${c.node.health}` : ''}. Open its details`}
                      style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                      opacity={dim ? 0.35 : 1}
                      onClick={(e) => { e.stopPropagation(); setSelectedNode(c.node) }}
                      // Enter or Space presses it like a button: a click, so the dialog that opens knows what to give the focus back to
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.currentTarget.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) } }}
                      onFocus={() => { setHoveredContainer(c.node.id); revealNode(c.x, c.y + CONTAINER_H / 2) }}
                      onBlur={() => setHoveredContainer(null)}
                      onMouseEnter={() => setHoveredContainer(c.node.id)}
                      onMouseLeave={() => setHoveredContainer(null)}
                    >
                      <title>{`${c.node.id} — ${c.node.on_demand && c.node.state !== 'running' ? 'asleep on demand: wakes on the first request' : c.node.state || 'unknown'}${c.node.health && c.node.health !== 'none' ? ` (${c.node.health})` : ''} · ${c.node.image}`}</title>
                      {/* Outer glow rings on hover */}
                      {(isHigh || isSel) && (
                        <>
                          <rect
                            x={c.x - CONTAINER_W / 2 - 5}
                            y={c.y - 5}
                            width={CONTAINER_W + 10}
                            height={CONTAINER_H + 10}
                            rx={CONTAINER_RX + 5}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={1}
                            strokeOpacity={0.12}
                          />
                          <rect
                            x={c.x - CONTAINER_W / 2 - 2}
                            y={c.y - 2}
                            width={CONTAINER_W + 4}
                            height={CONTAINER_H + 4}
                            rx={CONTAINER_RX + 2}
                            fill="none"
                            stroke={stroke}
                            strokeWidth={1}
                            strokeOpacity={0.3}
                          />
                          {hoveredContainer === c.node.id && !reduceMotion && (
                            <rect
                              x={c.x - CONTAINER_W / 2 - 2}
                              y={c.y - 2}
                              width={CONTAINER_W + 4}
                              height={CONTAINER_H + 4}
                              rx={CONTAINER_RX + 2}
                              fill="none"
                              stroke={stroke}
                              strokeWidth={1.5}
                              className="topo-pulse"
                            />
                          )}
                        </>
                      )}

                      {/* Shadow */}
                      <rect
                        x={c.x - CONTAINER_W / 2 + 1}
                        y={c.y + 2}
                        width={CONTAINER_W}
                        height={CONTAINER_H}
                        rx={CONTAINER_RX}
                        fill="black"
                        fillOpacity={0.3}
                        style={SHADOW}
                      />

                      {/* Background */}
                      <rect
                        x={c.x - CONTAINER_W / 2}
                        y={c.y}
                        width={CONTAINER_W}
                        height={CONTAINER_H}
                        rx={CONTAINER_RX}
                        fill="rgba(15, 23, 42, 0.92)"
                        stroke={stroke}
                        strokeWidth={isHigh || isSel ? 1.6 : 0.8}
                        strokeOpacity={isHigh || isSel ? 1 : 0.5}
                      />

                      {/* Left accent bar */}
                      <rect
                        x={c.x - CONTAINER_W / 2}
                        y={c.y + 6}
                        width={3}
                        height={CONTAINER_H - 12}
                        rx={1.5}
                        fill={stroke}
                        fillOpacity={isHigh ? 0.9 : 0.5}
                      />

                      {/* Container name */}
                      <text
                        x={c.x - CONTAINER_W / 2 + 14}
                        y={c.y + CONTAINER_H / 2 - 5}
                        dominantBaseline="central"
                        fill={isHigh ? '#f8fafc' : '#e2e8f0'}
                        style={isHigh ? INK_STRONG : INK}
                        fontSize={11}
                        fontWeight={600}
                        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
                      >
                        {trunc(c.node.name ?? c.node.id, 19)}
                      </text>

                      {/* Subtitle: first IP or image name */}
                      <text
                        x={c.x - CONTAINER_W / 2 + 14}
                        y={c.y + CONTAINER_H / 2 + 9}
                        dominantBaseline="central"
                        fill={c.node.ip_addresses?.length ? '#67e8f9' : '#64748b'}
                        style={c.node.ip_addresses?.length ? INK_INFO : undefined}
                        fontSize={9}
                        fontFamily={c.node.ip_addresses?.length ? 'ui-monospace, SFMono-Regular, monospace' : 'ui-sans-serif, system-ui, sans-serif'}
                        fillOpacity={c.node.ip_addresses?.length ? 0.7 : 1}
                      >
                        {c.node.ip_addresses?.length
                          ? c.node.ip_addresses[0].ip
                          : trunc(c.node.image, 22)}
                      </text>

                      {/* Health dot with glow ring */}
                      <circle
                        cx={c.x + CONTAINER_W / 2 - 12}
                        cy={c.y + 12}
                        r={HEALTH_R + 2}
                        fill={stroke}
                        fillOpacity={0.15}
                      />
                      <circle
                        cx={c.x + CONTAINER_W / 2 - 12}
                        cy={c.y + 12}
                        r={HEALTH_R}
                        fill={stroke}
                      />
                    </g>
                  )
                })}

                {/* =========== NETWORK PILLS (bottom tier) =========== */}
                {layout.networks.map((n) => {
                  const isHigh = highlightedNetworks.has(n.network.name)
                  const dim = hasHighlight && !isHigh

                  return (
                    <g
                      key={`n-${n.network.name}`}
                      data-node="true"
                      style={{ cursor: 'pointer', transition: 'opacity 0.2s' }}
                      opacity={dim ? 0.3 : 1}
                      onMouseEnter={() => setHoveredNetwork(n.network.name)}
                      onMouseLeave={() => setHoveredNetwork(null)}
                    >
                      {/* Outer glow on hover */}
                      {isHigh && (
                        <rect
                          x={n.x - NETWORK_W / 2 - 3}
                          y={n.y - 3}
                          width={NETWORK_W + 6}
                          height={NETWORK_H + 6}
                          rx={NETWORK_RX + 3}
                          fill="none"
                          stroke={n.color}
                          strokeWidth={1}
                          strokeOpacity={0.35}
                        />
                      )}

                      {/* Shadow */}
                      <rect
                        x={n.x - NETWORK_W / 2 + 1}
                        y={n.y + 1.5}
                        width={NETWORK_W}
                        height={NETWORK_H}
                        rx={NETWORK_RX}
                        fill="black"
                        fillOpacity={0.2}
                        style={SHADOW}
                      />

                      {/* Pill background */}
                      <rect
                        x={n.x - NETWORK_W / 2}
                        y={n.y}
                        width={NETWORK_W}
                        height={NETWORK_H}
                        rx={NETWORK_RX}
                        fill={`${n.color}10`}
                        stroke={n.color}
                        strokeWidth={isHigh ? 1.4 : 0.8}
                        strokeOpacity={isHigh ? 0.8 : 0.35}
                      />

                      {/* Color dot */}
                      <circle
                        cx={n.x - NETWORK_W / 2 + 16}
                        cy={n.y + NETWORK_H / 2}
                        r={3.5}
                        fill={n.color}
                        fillOpacity={isHigh ? 1 : 0.7}
                      />

                      {/* Network name */}
                      <text
                        x={n.x - NETWORK_W / 2 + 26}
                        y={n.y + NETWORK_H / 2 - (n.network.subnet ? 3 : 0)}
                        dominantBaseline="central"
                        fill={n.color}
                        fontSize={11}
                        fontWeight={600}
                        fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
                        opacity={isHigh ? 1 : 0.8}
                      >
                        {trunc(n.network.name, 17)}
                      </text>

                      {/* Subnet */}
                      {n.network.subnet && (
                        <text
                          x={n.x - NETWORK_W / 2 + 26}
                          y={n.y + NETWORK_H / 2 + 9}
                          dominantBaseline="central"
                          fill={n.color}
                          fontSize={9}
                          fontFamily="ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace"
                          opacity={0.7}
                        >
                          {n.network.subnet}
                        </text>
                      )}

                      {/* Driver badge */}
                      <text
                        x={n.x + NETWORK_W / 2 - 12}
                        y={n.y + NETWORK_H / 2}
                        textAnchor="end"
                        dominantBaseline="central"
                        fill={n.color}
                        fontSize={8}
                        fontFamily="ui-sans-serif, system-ui, sans-serif"
                        opacity={0.65}
                      >
                        {n.network.driver}
                      </text>
                    </g>
                  )
                })}

                {/* =========== TIER LABELS (above each tier) =========== */}
                {layout.servers.length > 0 && (
                  <>
                    <text
                      x={PAD}
                      y={layout.servers[0].y - 8}
                      fill="#f59e0b"
                      fontSize={10}
                      fontWeight={700}
                      letterSpacing={2.5}
                      opacity={0.8}
                      fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                    >
                      SERVERS
                    </text>
                    <line x1={PAD} y1={layout.servers[0].y - 3} x2={PAD + 62} y2={layout.servers[0].y - 3} stroke="#f59e0b" strokeWidth={1} strokeOpacity={0.15} strokeLinecap="round" />
                  </>
                )}
                {layout.stacks.length > 0 && (
                  <>
                    {/* Stacks label — above stack row */}
                    <text
                      x={PAD}
                      y={layout.stacks[0].y - 8}
                      fill="#8b5cf6"
                      fontSize={10}
                      fontWeight={700}
                      letterSpacing={2.5}
                      opacity={0.8}
                      fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                    >
                      STACKS
                    </text>
                    <line
                      x1={PAD}
                      y1={layout.stacks[0].y - 3}
                      x2={PAD + 56}
                      y2={layout.stacks[0].y - 3}
                      stroke="#8b5cf6"
                      strokeWidth={1}
                      strokeOpacity={0.15}
                      strokeLinecap="round"
                    />

                    {/* Containers label — above container row */}
                    {layout.containers.length > 0 && (
                      <>
                        <text
                          x={PAD}
                          y={layout.containers[0].y - 8}
                          fill="#10b981"
                          fontSize={10}
                          fontWeight={700}
                          letterSpacing={2.5}
                          opacity={0.8}
                          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                        >
                          CONTAINERS
                        </text>
                        <line
                          x1={PAD}
                          y1={layout.containers[0].y - 3}
                          x2={PAD + 84}
                          y2={layout.containers[0].y - 3}
                          stroke="#10b981"
                          strokeWidth={1}
                          strokeOpacity={0.15}
                          strokeLinecap="round"
                        />
                      </>
                    )}

                    {/* Networks label — above connected network row */}
                    {layout.networks.length > 0 && (
                      <>
                        <text
                          x={PAD}
                          y={layout.connectedNetworkY - 8}
                          fill="#06b6d4"
                          fontSize={10}
                          fontWeight={700}
                          letterSpacing={2.5}
                          opacity={0.8}
                          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                        >
                          NETWORKS
                        </text>
                        <line
                          x1={PAD}
                          y1={layout.connectedNetworkY - 3}
                          x2={PAD + 70}
                          y2={layout.connectedNetworkY - 3}
                          stroke="#06b6d4"
                          strokeWidth={1}
                          strokeOpacity={0.15}
                          strokeLinecap="round"
                        />
                      </>
                    )}

                    {/* Unused networks label — above unused network row */}
                    {layout.unusedNetworkY !== null && (
                      <>
                        <text
                          x={PAD}
                          y={layout.unusedNetworkY - 8}
                          fill="#64748b"
                          fontSize={10}
                          fontWeight={700}
                          letterSpacing={2.5}
                          opacity={0.8}
                          fontFamily="ui-sans-serif, system-ui, -apple-system, sans-serif"
                        >
                          UNUSED NETWORKS
                        </text>
                        <line
                          x1={PAD}
                          y1={layout.unusedNetworkY - 3}
                          x2={PAD + 122}
                          y2={layout.unusedNetworkY - 3}
                          stroke="#64748b"
                          strokeWidth={1}
                          strokeOpacity={0.12}
                          strokeLinecap="round"
                        />
                      </>
                    )}
                  </>
                )}

              </g>
            </svg>
          </div>
        ) : null}

        {/* Legend */}
        {!isEmpty && layout && (
          <div className="mt-3 md:mt-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 md:gap-x-4 md:gap-y-2">
            <span className="text-[10px] text-slate-500 uppercase tracking-wider mr-1">Networks</span>
            {layout.networks.map((n) => (
              <div key={n.network.name} className="flex items-center gap-1.5 rounded-full bg-white/[0.03] border border-white/5 px-2 py-0.5 hover:border-white/10 transition-colors">
                <span className="w-2 h-2 md:w-2.5 md:h-2.5 rounded-full shrink-0" style={{ backgroundColor: n.color }} aria-hidden />
                <span className="text-[11px] text-slate-400 font-mono">{n.network.name}</span>
                <span className="text-[10px] text-slate-500">({n.network.container_count})</span>
              </div>
            ))}

            <span className="text-[10px] text-slate-500 uppercase tracking-wider ml-2 md:ml-4 mr-1">Health</span>
            {[
              { label: 'Healthy', color: '#10b981' },
              { label: 'Running', color: '#06b6d4' },
              { label: 'Warning', color: '#f59e0b' },
              { label: 'Stopped', color: '#ef4444' },
              { label: 'Asleep (on demand)', color: STATE_META.asleep.color },
            ].map((h) => (
              <div key={h.label} className="flex items-center gap-1 rounded-full bg-white/[0.03] border border-white/5 px-2 py-0.5">
                <span className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full shrink-0" style={{ backgroundColor: h.color }} aria-hidden />
                <span className="text-[10px] text-slate-500">{h.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      </>
      )}
    </div>
  )
}
