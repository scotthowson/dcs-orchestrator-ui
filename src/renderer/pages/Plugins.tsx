// =============================================================================
// Plugins — extension marketplace with featured plugins, install and a guide
// =============================================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react'
import type { PluginCatalogEntry } from '../../shared/types'
import { createPortal } from 'react-dom'
import {
  Puzzle,
  Trash2,
  GitBranch,
  LayoutTemplate,
  Zap,
  Package,
  X,
  Loader2,
  AlertCircle,
  CheckCircle,
  RefreshCw,
  Download,
  Shield,
  Activity,
  Code,
  ChevronDown,
  ChevronRight,
  FileJson,
  FolderTree,
  Terminal,
  BookOpen,
  Sparkles,
  Bell,
  FileCheck,
  Gauge,
  Archive,
  Lock,
  FileSearch,
  Wrench,
  HardDrive,
  RotateCcw,
  Timer,
  Network,
  Database,
  Info,
} from 'lucide-react'
import { Switch } from '@mantine/core'
import { usePluginStore } from '../stores/pluginStore'
import { useConnectionStore } from '../stores/connectionStore'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import CardStudio from '../components/plugins/CardStudio'
import ModalOverlay from '../components/common/ModalOverlay'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { EmptyState } from '../components/common/PageState'
import { Panel } from '../components/dashboard/cardShared'
import { BTN_ICON_SM, BTN_SHEET_PRIMARY, BTN_SHEET_QUIET, BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_GHOST, TONE_GHOST_DANGER, TONE_OK } from '../lib/ui'

import { Pill } from '../components/common/Pill'
import CloseButton from '../components/common/CloseButton'
// ---------------------------------------------------------------------------
// Featured plugins catalog
// ---------------------------------------------------------------------------

interface FeaturedPlugin {
  name: string
  description: string
  author: string
  version: string
  icon: React.ElementType
  url: string
  tags: string[]
  hookCount: number
  templateCount: number
  category?: 'safety' | 'monitoring' | 'operations' | 'advanced' | 'cards'
  /** Built-in feature — always available, toggle controls the feature directly */
  builtIn?: boolean
  /** Root .env variables the hooks read (declared by the plugin) */
  env?: string[]
  /** Installed by the server from its catalogue */
  fromCatalog?: boolean
  /** When provided, plugin is scaffolded locally instead of git-cloned */
  scaffold?: {
    hooks?: Record<string, string>
    cards?: Record<string, { meta: Record<string, unknown>; html: string }>
  }
}

// A category is a group heading and an icon, never a colour: a colour on this page would mean a status
const CATEGORY_LABELS: Record<string, { label: string; icon: React.ElementType }> = {
  safety: { label: 'Safety and validation', icon: Shield },
  monitoring: { label: 'Monitoring and observability', icon: Activity },
  operations: { label: 'Operations and maintenance', icon: Wrench },
  advanced: { label: 'Advanced and security', icon: Lock },
  cards: { label: 'Dashboard cards', icon: LayoutTemplate },
}

// Two entries live in the UI: the compose linter (a built-in feature of the
// editors) and the example dashboard cards. Every other plugin comes from the
// server's catalogue (.plugins-catalog/), where the hook scripts are versioned,
// linted and installed by copying — so what you see is exactly what runs.
const SPECIAL_PLUGINS: FeaturedPlugin[] = [
  {
    name: 'compose-linter',
    builtIn: true,
    category: 'safety',
    description: 'Comprehensive compose validation — catches missing restart policies, privileged containers, unbound ports, Docker socket mounts, missing health checks, resource limits, and 18+ security rules before deployment.',
    author: 'DCS Community',
    version: '1.2.0',
    icon: FileCheck,
    url: '',
    tags: ['validation', 'compose', 'safety'],
    hookCount: 1,
    templateCount: 0,
  },
  {
    name: 'example-card',
    category: 'cards',
    description: 'Dashboard widget cards — a live system clock, an animated server pulse with CPU, RAM and network metrics, and a CSS showcase. Add custom widgets to your dashboard.',
    author: 'DCS Community',
    version: '1.0.0',
    icon: LayoutTemplate,
    url: '',
    tags: ['dashboard', 'cards', 'widgets', 'ui'],
    hookCount: 0,
    templateCount: 3,
    scaffold: {
      cards: {
        'system-clock': {
          meta: { name: 'system-clock', title: 'System clock', description: 'Live date and time', defaultW: 6, defaultH: 4, minW: 4, minH: 3, maxW: 12, maxH: 6 },
          html: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:transparent;color:var(--dcs-text,#e2e8f0);display:flex;align-items:center;justify-content:center;height:100vh;overflow:hidden}.clock{text-align:center}.time{font-size:2.5rem;font-weight:700;letter-spacing:.05em;background:linear-gradient(135deg,#34d399,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.date{font-size:.75rem;color:var(--dcs-text-muted,#64748b);margin-top:.25rem}.seconds{font-size:.875rem;color:var(--dcs-text-muted,#475569);font-variant-numeric:tabular-nums}</style></head><body><div class="clock"><div class="time" id="time">--:--</div><div class="seconds" id="sec">:00</div><div class="date" id="date">Loading...</div></div><script>function u(){const n=new Date();document.getElementById('time').textContent=n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:true}).replace(/:\\d{2}\\s/,' ');document.getElementById('sec').textContent=':'+String(n.getSeconds()).padStart(2,'0');document.getElementById('date').textContent=n.toLocaleDateString([],{weekday:'long',month:'long',day:'numeric',year:'numeric'})}u();setInterval(u,1000)</script></body></html>`,
        },
        'server-pulse': {
          meta: { name: 'server-pulse', title: 'Server pulse', description: 'Animated CPU, RAM and network metrics', defaultW: 8, defaultH: 5, minW: 6, minH: 4, maxW: 16, maxH: 8 },
          html: `<!DOCTYPE html><html><head><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:transparent;color:var(--dcs-text,#e2e8f0);padding:1rem;overflow:hidden}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem;height:100%}.metric{background:color-mix(in srgb,var(--dcs-text,#fff) 5%,transparent);border:1px solid color-mix(in srgb,var(--dcs-text,#fff) 7%,transparent);border-radius:.75rem;padding:.75rem;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:.25rem}.label{font-size:.6rem;text-transform:uppercase;letter-spacing:.1em;color:var(--dcs-text-muted,#64748b);font-weight:600}.value{font-size:1.5rem;font-weight:700;font-variant-numeric:tabular-nums}.bar{width:100%;height:4px;background:color-mix(in srgb,var(--dcs-text,#fff) 7%,transparent);border-radius:2px;overflow:hidden}.fill{height:100%;border-radius:2px;transition:width .8s ease}.cpu .value{color:#34d399}.cpu .fill{background:linear-gradient(90deg,#34d399,#059669)}.ram .value{color:#06b6d4}.ram .fill{background:linear-gradient(90deg,#06b6d4,#0284c7)}.net .value{color:#a78bfa}.net .fill{background:linear-gradient(90deg,#a78bfa,#7c3aed)}</style></head><body><div class="grid"><div class="metric cpu"><span class="label">CPU</span><span class="value" id="cpu">0%</span><div class="bar"><div class="fill" id="cpuBar" style="width:0%"></div></div></div><div class="metric ram"><span class="label">RAM</span><span class="value" id="ram">0%</span><div class="bar"><div class="fill" id="ramBar" style="width:0%"></div></div></div><div class="metric net"><span class="label">NET</span><span class="value" id="net">0ms</span><div class="bar"><div class="fill" id="netBar" style="width:0%"></div></div></div></div><script>function r(min,max){return Math.floor(Math.random()*(max-min+1))+min}function u(){const cpu=r(15,85),ram=r(30,75),net=r(1,45);document.getElementById('cpu').textContent=cpu+'%';document.getElementById('cpuBar').style.width=cpu+'%';document.getElementById('ram').textContent=ram+'%';document.getElementById('ramBar').style.width=ram+'%';document.getElementById('net').textContent=net+'ms';document.getElementById('netBar').style.width=Math.min(net*2,100)+'%'}u();setInterval(u,3000)</script></body></html>`,
        },
        'css-showcase': {
          meta: { name: 'css-showcase', title: 'CSS showcase', description: 'Complete CSS reference for building plugin cards', defaultW: 10, defaultH: 10, minW: 8, minH: 6, maxW: 24, maxH: 16 },
          html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><style>*,*::before,*::after{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:transparent;color:var(--dcs-text,#e2e8f0);padding:1.25rem;overflow-y:auto;overflow-x:hidden;line-height:1.5;scrollbar-width:thin;scrollbar-color:color-mix(in srgb,var(--dcs-text,#fff) 14%,transparent) transparent}body::-webkit-scrollbar{width:4px}body::-webkit-scrollbar-thumb{background:color-mix(in srgb,var(--dcs-text,#fff) 14%,transparent);border-radius:2px}.section-title{font-size:.6rem;font-weight:700;color:var(--dcs-text-muted,#475569);text-transform:uppercase;letter-spacing:.12em;margin:1rem 0 .5rem 0;display:flex;align-items:center;gap:.5rem}.section-title::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,color-mix(in srgb,var(--dcs-text,#fff) 9%,transparent),transparent)}.section-title:first-child{margin-top:0}.palette{display:flex;gap:.375rem;flex-wrap:wrap;margin-bottom:.25rem}.swatch{width:2.25rem;height:2.25rem;border-radius:.625rem;cursor:pointer;transition:transform .2s,box-shadow .2s;position:relative}.swatch:hover{transform:scale(1.2) translateY(-2px);box-shadow:0 8px 20px -4px currentColor}.swatch::after{content:attr(data-label);position:absolute;bottom:-14px;left:50%;transform:translateX(-50%);font-size:7px;color:var(--dcs-text-muted,#64748b);white-space:nowrap;opacity:0;transition:opacity .15s}.swatch:hover::after{opacity:1}.pills{display:flex;gap:.375rem;flex-wrap:wrap}.pill{padding:.2rem .625rem;border-radius:9999px;font-size:.6rem;font-weight:600;border:1px solid;transition:transform .15s,filter .15s;cursor:default}.pill:hover{transform:translateY(-1px);filter:brightness(1.2)}.pill-emerald{background:rgba(52,211,153,.12);color:#34d399;border-color:rgba(52,211,153,.2)}.pill-cyan{background:rgba(6,182,212,.12);color:#06b6d4;border-color:rgba(6,182,212,.2)}.pill-violet{background:rgba(167,139,250,.12);color:#a78bfa;border-color:rgba(167,139,250,.2)}.pill-amber{background:rgba(251,191,36,.12);color:#fbbf24;border-color:rgba(251,191,36,.2)}.pill-rose{background:rgba(251,113,133,.12);color:#fb7185;border-color:rgba(251,113,133,.2)}.pill-indigo{background:rgba(129,140,248,.12);color:#818cf8;border-color:rgba(129,140,248,.2)}.pill-solid{background:#34d399;color:#0f172a;border-color:#34d399;font-weight:700}.buttons{display:flex;gap:.375rem;flex-wrap:wrap}.btn{padding:.3rem .75rem;border-radius:.5rem;font-size:.6rem;font-weight:600;border:1px solid;cursor:pointer;transition:all .2s;display:inline-flex;align-items:center;gap:.25rem}.btn:hover{transform:translateY(-1px)}.btn-ghost{background:rgba(52,211,153,.1);color:#34d399;border-color:rgba(52,211,153,.2)}.btn-ghost:hover{background:rgba(52,211,153,.2)}.btn-solid{background:#34d399;color:#0f172a;border-color:#34d399}.btn-solid:hover{background:#2dd4a8;box-shadow:0 4px 12px rgba(52,211,153,.3)}.btn-outline{background:transparent;color:var(--dcs-text-muted,#94a3b8);border-color:color-mix(in srgb,var(--dcs-text,#fff) 14%,transparent)}.btn-outline:hover{background:color-mix(in srgb,var(--dcs-text,#fff) 7%,transparent);border-color:color-mix(in srgb,var(--dcs-text,#fff) 24%,transparent)}.btn-danger{background:rgba(251,113,133,.1);color:#fb7185;border-color:rgba(251,113,133,.2)}.btn-danger:hover{background:rgba(251,113,133,.2)}.bar-stack{display:flex;gap:3px;height:8px;border-radius:4px;overflow:hidden;background:color-mix(in srgb,var(--dcs-text,#fff) 5%,transparent)}.bar-seg{height:100%;border-radius:4px;transition:width 1.5s cubic-bezier(.4,0,.2,1)}.progress-row{display:flex;align-items:center;gap:.5rem;margin-bottom:.375rem}.progress-label{font-size:.55rem;color:var(--dcs-text-muted,#64748b);width:2.5rem;text-align:right}.progress-track{flex:1;height:6px;background:color-mix(in srgb,var(--dcs-text,#fff) 6%,transparent);border-radius:3px;overflow:hidden}.progress-fill{height:100%;border-radius:3px;transition:width 1s ease}.progress-val{font-size:.55rem;color:var(--dcs-text-muted,#94a3b8);width:2rem;font-variant-numeric:tabular-nums}.cards-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:.5rem}.glass-card{background:color-mix(in srgb,var(--dcs-text,#fff) 5%,transparent);border:1px solid color-mix(in srgb,var(--dcs-text,#fff) 9%,transparent);border-radius:.75rem;padding:.625rem;transition:all .2s;cursor:default}.glass-card:hover{background:color-mix(in srgb,var(--dcs-text,#fff) 7%,transparent);border-color:color-mix(in srgb,var(--dcs-text,#fff) 14%,transparent);transform:translateY(-1px);box-shadow:0 8px 24px -8px rgba(0,0,0,.3)}.glass-card .card-icon{font-size:1rem;margin-bottom:.25rem}.glass-card .card-title{font-size:.6rem;font-weight:600;color:var(--dcs-text,#e2e8f0)}.glass-card .card-value{font-size:1.1rem;font-weight:700;font-variant-numeric:tabular-nums}.glass-card .card-sub{font-size:.5rem;color:var(--dcs-text-muted,#64748b)}.type-row{margin-bottom:.375rem;display:flex;align-items:baseline;gap:.75rem;flex-wrap:wrap}.t-gradient{font-weight:800;font-size:.875rem;background:linear-gradient(135deg,#34d399,#06b6d4,#a78bfa);-webkit-background-clip:text;-webkit-text-fill-color:transparent}.t-glow{font-weight:700;font-size:.75rem;color:#34d399;text-shadow:0 0 20px rgba(52,211,153,.5)}.t-mono{font-family:'SF Mono','Fira Code',monospace;font-size:.65rem;color:#06b6d4;background:rgba(6,182,212,.08);padding:.1rem .4rem;border-radius:.25rem}.t-muted{font-size:.65rem;color:var(--dcs-text-muted,#475569)}.t-label{font-size:.55rem;font-weight:600;text-transform:uppercase;letter-spacing:.1em;color:var(--dcs-text-muted,#64748b)}.pulse-container{display:flex;align-items:center;gap:.75rem}.pulse-dot{width:10px;height:10px;border-radius:50%;background:#34d399;position:relative}.pulse-dot::before{content:'';position:absolute;inset:-4px;border-radius:50%;border:2px solid #34d399;animation:pulse-ring 2s ease-out infinite}@keyframes pulse-ring{0%{transform:scale(.8);opacity:.8}100%{transform:scale(2);opacity:0}}.toggle{display:flex;align-items:center;gap:.5rem}.toggle-track{width:28px;height:16px;border-radius:8px;background:#334155;position:relative;cursor:pointer;transition:background .2s}.toggle-track.on{background:#34d399}.toggle-thumb{width:12px;height:12px;border-radius:50%;background:white;position:absolute;top:2px;left:2px;transition:transform .2s;box-shadow:0 1px 3px rgba(0,0,0,.3)}.toggle-track.on .toggle-thumb{transform:translateX(12px)}.toggle-label{font-size:.6rem;color:var(--dcs-text-muted,#94a3b8)}.sep{height:1px;background:linear-gradient(90deg,transparent,color-mix(in srgb,var(--dcs-text,#fff) 9%,transparent),transparent);margin:.75rem 0}</style></head><body><div class="section-title">Typography</div><div class="type-row"><span class="t-gradient">Gradient text</span><span class="t-glow">Glow effect</span><span class="t-mono">monospace</span><span class="t-muted">Muted caption</span><span class="t-label">Label</span></div><div class="section-title">Color palette</div><div class="palette"><div class="swatch" style="background:#34d399;color:rgba(52,211,153,.4)" data-label="Emerald"></div><div class="swatch" style="background:#06b6d4;color:rgba(6,182,212,.4)" data-label="Cyan"></div><div class="swatch" style="background:#a78bfa;color:rgba(167,139,250,.4)" data-label="Violet"></div><div class="swatch" style="background:#fbbf24;color:rgba(251,191,36,.4)" data-label="Amber"></div><div class="swatch" style="background:#fb7185;color:rgba(251,113,133,.4)" data-label="Rose"></div><div class="swatch" style="background:#f472b6;color:rgba(244,114,182,.4)" data-label="Pink"></div><div class="swatch" style="background:#818cf8;color:rgba(129,140,248,.4)" data-label="Indigo"></div><div class="swatch" style="background:#38bdf8;color:rgba(56,189,248,.4)" data-label="Sky"></div><div class="swatch" style="background:#4ade80;color:rgba(74,222,128,.4)" data-label="Green"></div><div class="swatch" style="background:#f97316;color:rgba(249,115,22,.4)" data-label="Orange"></div></div><div class="section-title">Badges</div><div class="pills"><span class="pill pill-emerald">Success</span><span class="pill pill-cyan">Info</span><span class="pill pill-violet">Feature</span><span class="pill pill-amber">Warning</span><span class="pill pill-rose">Error</span><span class="pill pill-indigo">Update</span><span class="pill pill-solid">Active</span></div><div class="section-title">Buttons</div><div class="buttons"><button class="btn btn-solid">&#9654; Primary</button><button class="btn btn-ghost">&#10010; Ghost</button><button class="btn btn-outline">&#9881; Outline</button><button class="btn btn-danger">&#10005; Danger</button></div><div class="section-title">Progress bars</div><div class="progress-row"><span class="progress-label">CPU</span><div class="progress-track"><div class="progress-fill" id="cpu-bar" style="width:0%;background:linear-gradient(90deg,#34d399,#059669)"></div></div><span class="progress-val" id="cpu-val">0%</span></div><div class="progress-row"><span class="progress-label">RAM</span><div class="progress-track"><div class="progress-fill" id="ram-bar" style="width:0%;background:linear-gradient(90deg,#06b6d4,#0284c7)"></div></div><span class="progress-val" id="ram-val">0%</span></div><div class="progress-row"><span class="progress-label">Disk</span><div class="progress-track"><div class="progress-fill" id="disk-bar" style="width:0%;background:linear-gradient(90deg,#a78bfa,#7c3aed)"></div></div><span class="progress-val" id="disk-val">0%</span></div><div style="margin-top:.5rem"><div class="bar-stack"><div class="bar-seg" id="seg1" style="width:0%;background:#34d399"></div><div class="bar-seg" id="seg2" style="width:0%;background:#06b6d4"></div><div class="bar-seg" id="seg3" style="width:0%;background:#a78bfa"></div><div class="bar-seg" id="seg4" style="width:0%;background:#fbbf24"></div><div class="bar-seg" id="seg5" style="width:0%;background:#fb7185"></div></div></div><div class="section-title">Glass cards</div><div class="cards-grid"><div class="glass-card"><div class="card-icon">&#9889;</div><div class="card-title">Uptime</div><div class="card-value" style="color:#34d399" id="uptime">99.9%</div><div class="card-sub">Last 30 days</div></div><div class="glass-card"><div class="card-icon">&#128230;</div><div class="card-title">Containers</div><div class="card-value" style="color:#06b6d4" id="containers">24</div><div class="card-sub">3 stacks</div></div><div class="glass-card"><div class="card-icon">&#128737;</div><div class="card-title">Alerts</div><div class="card-value" style="color:#fbbf24" id="alerts">0</div><div class="card-sub">All clear</div></div></div><div class="section-title">Interactive</div><div style="display:flex;align-items:center;gap:1rem;flex-wrap:wrap"><div class="pulse-container"><div class="pulse-dot"></div><span style="font-size:.6rem;color:#34d399;font-weight:600">Live</span></div><div class="toggle" onclick="this.querySelector('.toggle-track').classList.toggle('on')"><div class="toggle-track on"><div class="toggle-thumb"></div></div><span class="toggle-label">Auto-refresh</span></div><div class="toggle" onclick="this.querySelector('.toggle-track').classList.toggle('on')"><div class="toggle-track"><div class="toggle-thumb"></div></div><span class="toggle-label">Dark mode</span></div></div><div class="sep"></div><div style="text-align:center;font-size:.5rem;color:var(--dcs-text-muted,#334155)">DCS plugin card CSS &middot; build custom dashboard widgets</div><script>function randomize(){var cpu=Math.floor(Math.random()*60)+20;var ram=Math.floor(Math.random()*40)+35;var disk=Math.floor(Math.random()*30)+40;document.getElementById('cpu-bar').style.width=cpu+'%';document.getElementById('cpu-val').textContent=cpu+'%';document.getElementById('ram-bar').style.width=ram+'%';document.getElementById('ram-val').textContent=ram+'%';document.getElementById('disk-bar').style.width=disk+'%';document.getElementById('disk-val').textContent=disk+'%';var segs=[35,25,20,12,8].map(function(v){return v+Math.floor(Math.random()*6)-3});var total=segs.reduce(function(a,b){return a+b},0);for(var i=0;i<5;i++){document.getElementById('seg'+(i+1)).style.width=((segs[i]/total)*100)+'%'}document.getElementById('uptime').textContent=(99+Math.random()).toFixed(1)+'%';document.getElementById('containers').textContent=Math.floor(Math.random()*30)+10;document.getElementById('alerts').textContent=Math.floor(Math.random()*3)}setTimeout(randomize,300);setInterval(randomize,5000)</script></body></html>`,
        },
      },
    },
  },
]

const PLUGIN_ICONS: Record<string, React.ElementType> = {
  'env-validator': FileSearch,
  'deploy-guard': Shield,
  'auto-backup': Archive,
  'rollback-sentinel': RotateCcw,
  'container-notifier': Bell,
  'resource-monitor': Gauge,
  'uptime-ping': Activity,
  'disk-watchdog': HardDrive,
  'response-timer': Timer,
  'port-guard': Network,
  'cleanup-sweeper': Trash2,
  'crash-responder': RefreshCw,
  'volume-sizer': Database,
  'dependency-checker': GitBranch,
  'network-firewall': Lock
}

/** Display shape for a catalogue entry delivered by the server */
function catalogToDisplay(entry: PluginCatalogEntry): FeaturedPlugin {
  const cat = (entry.category || 'operations') as FeaturedPlugin['category']
  return {
    name: entry.name,
    description: entry.description,
    author: entry.author || 'DCS Community',
    version: entry.version,
    icon: PLUGIN_ICONS[entry.name] || CATEGORY_LABELS[cat || 'operations']?.icon || Wrench,
    url: '',
    tags: entry.tags || [],
    hookCount: entry.hooks?.length ?? 0,
    templateCount: 0,
    category: cat,
    env: entry.env,
    fromCatalog: true,
  }
}

// ---------------------------------------------------------------------------
// Plugin creation guide content
// ---------------------------------------------------------------------------

const GUIDE_SECTIONS = [
  {
    title: 'Directory structure',
    icon: FolderTree,
    content: `my-plugin/
├── plugin.json          # Required manifest
├── hooks/               # Lifecycle hook scripts
│   ├── post-deploy      # Runs after stack deploy
│   ├── pre-update       # Runs before stack update
│   ├── post-start       # Runs after stack start
│   └── pre-stop         # Runs before stack stop
└── templates/           # Compose templates
    └── my-service/
        └── docker-compose.yml`,
  },
  {
    title: 'Plugin manifest',
    icon: FileJson,
    content: `{
  "name": "my-plugin",
  "version": "1.0.0",
  "description": "What your plugin does",
  "author": "Your Name",
  "enabled": true,
  "hooks": ["post-start"],
  "env": ["NOTIFY_WEBHOOK_URL"],
  "config": { "threshold": 85 }
}
// "env": root .env values the hooks may read
// "config": editable from the UI, passed as DCS_PLUGIN_CONFIG`,
  },
  {
    title: 'Example hook',
    icon: Terminal,
    content: `#!/bin/bash
# hooks/post-deploy — runs after every deployment
# Receives deployment context as JSON via stdin

CONTEXT=$(cat)
STACK=$(echo "$CONTEXT" | jq -r '.stack // "unknown"')
OK=$(echo "$CONTEXT" | jq -r '.success // true')
[ "\${DCS_DRY_RUN:-false}" = "true" ] && { echo "dry run: skipping side effects"; exit 0; }

if [ "$OK" = "true" ]; then
  echo "✓ $STACK deployed" >> "$PLUGIN_STATE_DIR/log.txt"
else
  curl -s -H "Title: DCS" -d "$STACK deployment failed" "$DCS_NTFY_URL"
fi`,
  },
  {
    title: 'Available hooks',
    icon: Zap,
    content: `pre-start      Before a stack starts (stack, batch, template auto-start)
post-start     After the start finished — context.success tells the outcome
pre-stop       Before a stack stops
post-stop      After the stop finished
pre-update     Before a stack's images are pulled
post-update    After the update — with changed_images
pre-deploy     Before a template is merged (context.compose = the template;
               dry runs set dry_run: true and show your output in the preview)
post-deploy    After the deployment (and its auto-start) — with success

Context arrives as JSON on stdin: {event, stack, project, compose_file,
action, success, containers[], template, compose, dry_run}.
Environment: BASE_DIR COMPOSE_DIR DCS_EVENT PLUGIN_NAME PLUGIN_DIR
PLUGIN_STATE_DIR DCS_PLUGIN_CONFIG DCS_DRY_RUN DCS_NTFY_URL NTFY_TOKEN
DOCKER_COMPOSE_CMD TZ, plus the .env names listed under "env" in
plugin.json. 30 s timeout, 64 KB output, logs on the plugin's page.`,
  },
]

// ---------------------------------------------------------------------------
// What a plugin's "details" say: its name, version, description, hooks, templates and tags
// ---------------------------------------------------------------------------

function PluginDetails({ name, version, description, hooks, templates, tags, author, Icon }: {
  name: string
  version: string
  description?: string
  hooks?: string[]
  templates?: string[]
  tags?: string[]
  author?: string
  Icon: React.ElementType
}) {
  return (
    <div className="space-y-2.5 py-0.5 max-w-[280px]">
      <div className="flex items-center gap-2">
        <Icon className="w-4 h-4 text-slate-300 shrink-0" />
        <span className="text-xs font-semibold text-slate-100">{name}</span>
        <span className="text-[10px] text-slate-400 font-mono">v{version}</span>
      </div>
      {description && <p className="text-[11px] text-slate-300 leading-relaxed">{description}</p>}
      {hooks && hooks.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Lifecycle hooks</p>
          <div className="flex flex-wrap gap-1">
            {hooks.map((hook) => <span key={hook} className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] font-mono text-cyan-300">{hook}</span>)}
          </div>
        </div>
      )}
      {templates && templates.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Templates</p>
          <div className="flex flex-wrap gap-1">
            {templates.map((t) => <span key={t} className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300">{t}</span>)}
          </div>
        </div>
      )}
      {tags && tags.length > 0 && (
        <div>
          <p className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold mb-1">Tags</p>
          <div className="flex flex-wrap gap-1">
            {tags.map((tag) => <span key={tag} className="px-1.5 py-0.5 rounded bg-white/10 text-[10px] text-slate-300">{tag}</span>)}
          </div>
        </div>
      )}
      {author && <p className="text-[10px] text-slate-400">by {author}</p>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function Plugins() {
  const { plugins, catalog, catalogLoading, loading, installing, error, fetchPlugins, fetchCatalog, installPlugin, installFromCatalog, scaffoldPlugin, removePlugin, togglePlugin } = usePluginStore()
  const [showInstall, setShowInstall] = useState(false)
  const [gitUrl, setGitUrl] = useState('')
  const [showGuide, setShowGuide] = useState(false)
  const [showStudio, setShowStudio] = useState(false)
  const [expandedGuide, setExpandedGuide] = useState<number | null>(null)
  const [installingFeatured, setInstallingFeatured] = useState<string | null>(null)
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const { addToast } = useToast()
  const confirm = useConfirm()

  useEffect(() => { if (isConnected) { fetchPlugins(); fetchCatalog() } }, [fetchPlugins, fetchCatalog, isConnected])

  // Everything the page can offer: the two UI-side entries plus the server catalogue
  const displayPlugins = useMemo<FeaturedPlugin[]>(() => {
    const fromServer = catalog.map(catalogToDisplay)
    const names = new Set(fromServer.map((p) => p.name))
    return [...SPECIAL_PLUGINS.filter((sp) => !names.has(sp.name)), ...fromServer]
  }, [catalog])

  const handleInstall = useCallback(async () => {
    if (!gitUrl) return
    const ok = await installPlugin(gitUrl)
    if (ok) {
      setShowInstall(false)
      setGitUrl('')
      addToast({ type: 'success', message: 'Plugin installed' })
    }
  }, [gitUrl, installPlugin, addToast])

  const handleInstallFeatured = useCallback(async (fp: FeaturedPlugin) => {
    if (installingFeatured) return
    // Check if already installed
    if (plugins.some(p => p.name === fp.name)) {
      addToast({ type: 'info', message: `${fp.name} is already installed` })
      return
    }
    setInstallingFeatured(fp.name)
    let ok: boolean
    if (fp.fromCatalog) {
      ok = await installFromCatalog(fp.name)
    } else if (fp.scaffold) {
      // Scaffold bundled plugin directly on disk (no git clone needed)
      ok = await scaffoldPlugin({
        name: fp.name,
        description: fp.description,
        version: fp.version,
        author: fp.author,
        hooks: fp.scaffold.hooks,
        cards: fp.scaffold.cards,
      })
    } else {
      ok = await installPlugin(fp.url)
    }
    setInstallingFeatured(null)
    if (ok) {
      addToast({ type: 'success', message: `${fp.name} installed — enable it to activate its hooks` })
    } else {
      addToast({ type: 'error', message: usePluginStore.getState().error || `Could not install ${fp.name}` })
    }
  }, [installingFeatured, plugins, installPlugin, installFromCatalog, scaffoldPlugin, addToast])

  const installedNames = new Set(plugins.map(p => p.name))

  // Built-in plugin toggle — just calls the store (which handles localStorage persistence)
  const handleBuiltInToggle = useCallback((name: string) => {
    togglePlugin(name).then((ok) => {
      if (!ok) addToast({ type: 'error', message: usePluginStore.getState().error || `Could not switch ${name}` })
    })
  }, [togglePlugin, addToast])

  // Read built-in toggle state from the store (reactive — re-renders on toggle)
  const builtInToggles: Record<string, boolean> = {}
  for (const fp of displayPlugins) {
    if (fp.builtIn) {
      const p = plugins.find(pl => pl.name === fp.name)
      builtInToggles[fp.name] = p ? p.enabled : true
    }
  }

  const askRemove = useCallback(async (name: string) => {
    if (!(await confirm({
      title: `Remove ${name}?`,
      message: `This removes ${name} and all its templates and hooks. It cannot be undone.`,
      confirmLabel: 'Remove plugin',
      danger: true,
    }))) return
    const ok = await removePlugin(name)
    if (ok) addToast({ type: 'success', message: `${name} removed` })
  }, [confirm, removePlugin, addToast])

  return (
    <div className="space-y-4 md:space-y-5 animate-fade-in">
      <DisconnectedBanner />
      <PageHeader
        page="plugins"
        actions={<>
          <button type="button" onClick={() => fetchPlugins()} disabled={loading} aria-label="Refresh" className={BTN_TOOLBAR_QUIET}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button type="button" onClick={() => setShowGuide(!showGuide)} aria-expanded={showGuide} aria-label="Plugin guide" className={BTN_TOOLBAR_QUIET}>
            <BookOpen size={14} />
            <span className="hidden sm:inline">Plugin guide</span>
          </button>
          <Hint label="Build a dashboard card from an endpoint, or write one">
            <button type="button" onClick={() => setShowStudio(true)} className={BTN_TOOLBAR_QUIET}>
              <LayoutTemplate size={14} />
              <span>Card Studio</span>
            </button>
          </Hint>
          <button type="button" onClick={() => setShowInstall(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}>
            <Download size={14} />
            <span>Install from Git</span>
          </button>
        </>}
      />

      {error && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.06] px-4 py-3 text-xs text-rose-300 flex items-center gap-2 animate-fade-in" role="alert">
          <AlertCircle className="w-4 h-4 shrink-0" aria-hidden />
          {error}
        </div>
      )}

      {/* Plugin guide (opens and closes) */}
      {showGuide && (
        <Panel
          icon={Code}
          title="Create your own plugin"
          actions={<Hint label="Close the guide"><CloseButton label="Close the guide" size="sm" onClick={() => setShowGuide(false)} /></Hint>}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-400">
              Plugins are Git repositories with a <code className="text-cyan-400 bg-cyan-500/10 px-1.5 py-0.5 rounded text-xs">plugin.json</code> manifest.
              They can provide compose templates and lifecycle hook scripts that run during deployments.
            </p>
            {GUIDE_SECTIONS.map((section, i) => {
              const isExpanded = expandedGuide === i
              const Icon = section.icon
              return (
                <div key={section.title} className="border border-white/5 rounded-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={() => setExpandedGuide(isExpanded ? null : i)}
                    aria-expanded={isExpanded}
                    className="w-full flex items-center gap-2.5 px-4 py-3 text-left hover:bg-white/[0.03] transition-colors"
                  >
                    <Icon size={14} className="text-slate-400 shrink-0" aria-hidden />
                    <span className="text-sm font-medium text-slate-200 flex-1">{section.title}</span>
                    {isExpanded
                      ? <ChevronDown size={14} className="text-slate-500" aria-hidden />
                      : <ChevronRight size={14} className="text-slate-500" aria-hidden />
                    }
                  </button>
                  {isExpanded && (
                    <div className="px-4 pb-4 animate-fade-in">
                      <pre className="bg-slate-950/60 border border-white/5 rounded-lg p-4 text-xs font-mono text-slate-300 overflow-x-auto scrollbar-thin whitespace-pre leading-relaxed">
                        {section.content}
                      </pre>
                    </div>
                  )}
                </div>
              )
            })}
            <div className="flex items-center gap-2 pt-1 text-xs text-slate-500">
              <Sparkles size={12} aria-hidden />
              <span>Make your hook scripts executable: <code className="text-cyan-400">chmod +x hooks/*</code></span>
            </div>
          </div>
        </Panel>
      )}

      {/* Featured plugins — grouped by category */}
      {catalogLoading && catalog.length === 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4" role="status" aria-label="Loading the plugin catalogue">
          {[0, 1, 2].map((i) => <div key={i} className="skeleton h-44" aria-hidden />)}
        </div>
      )}
      {(['safety', 'monitoring', 'operations', 'advanced', 'cards'] as const).map((cat) => {
        const catPlugins = displayPlugins.filter((fp) => (fp.category || 'safety') === cat)
        if (catPlugins.length === 0) return null
        const catInfo = CATEGORY_LABELS[cat]
        const CatIcon = catInfo.icon
        return (
          <div key={cat}>
            <div className="flex items-center gap-2 mb-3">
              <CatIcon size={13} className="text-slate-400" aria-hidden />
              <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{catInfo.label}</h2>
              <div className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
              {catPlugins.map((fp) => {
                const Icon = fp.icon
                const isInstalled = installedNames.has(fp.name)
                const isInstalling = installingFeatured === fp.name
                const enabled = fp.builtIn ? builtInToggles[fp.name] : !!plugins.find((p) => p.name === fp.name)?.enabled
                return (
                  <div
                    key={fp.name}
                    className={`glass-card p-4 flex flex-col ${isInstalled ? 'border-emerald-500/20' : ''}`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0" aria-hidden>
                        <Icon className="w-5 h-5 text-slate-300" />
                      </div>
                      <div className="flex items-center gap-1.5">
                        {isInstalled && (
                          <Pill tone="ok" icon={<CheckCircle size={10} />}>Installed</Pill>
                        )}
                        <Hint label={<PluginDetails name={fp.name} version={fp.version} description={fp.description} hooks={fp.scaffold?.hooks ? Object.keys(fp.scaffold.hooks) : undefined} tags={fp.tags} author={fp.author} Icon={Icon} />} position="left">
                          <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label="Plugin details">
                            <Info size={14} />
                          </button>
                        </Hint>
                      </div>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-200 mb-1">{fp.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed mb-3 line-clamp-2">{fp.description}</p>
                    <div className="flex-1" aria-hidden />
                    <div className="flex items-center gap-3 text-[11px] text-slate-500 mb-4">
                      {fp.category === 'cards' ? (
                        <span className="flex items-center gap-1"><LayoutTemplate size={10} aria-hidden />{fp.templateCount} cards</span>
                      ) : (
                        <>
                          <span className="flex items-center gap-1"><Zap size={10} aria-hidden />{fp.hookCount} hooks</span>
                          {fp.templateCount > 0 && <span className="flex items-center gap-1"><LayoutTemplate size={10} aria-hidden />{fp.templateCount} templates</span>}
                        </>
                      )}
                      <span>v{fp.version}</span>
                    </div>
                    {fp.builtIn || isInstalled ? (
                      <Switch
                        checked={!!enabled}
                        onChange={() => (fp.builtIn ? handleBuiltInToggle(fp.name) : togglePlugin(fp.name))}
                        aria-label={`${fp.name} enabled`}
                        label={enabled ? 'Enabled' : 'Disabled'}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => handleInstallFeatured(fp)}
                        disabled={isInstalling || !isConnected}
                        className={`${BTN_TOOLBAR} ${TONE_OK} w-full justify-center press`}
                      >
                        {isInstalling ? (
                          <><Loader2 size={14} className="animate-spin" /> Installing…</>
                        ) : (
                          <><Download size={14} /> Install</>
                        )}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}

      {/* Installed plugins */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Package size={13} className="text-slate-400" aria-hidden />
          <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Installed ({plugins.length})</h2>
          <div className="flex-1 h-px bg-gradient-to-r from-white/[0.06] to-transparent" />
        </div>

        {loading && plugins.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4" role="status" aria-label="Loading the installed plugins">
            {[1, 2].map((i) => <div key={i} className="skeleton h-36" aria-hidden />)}
          </div>
        ) : plugins.length === 0 ? (
          <div className="glass-card">
            <EmptyState
              compact
              icon={<Package size={28} />}
              title="No plugins installed yet"
              hint="Install a featured plugin above, or add one from a Git URL."
              action={<button type="button" onClick={() => setShowInstall(true)} className={`${BTN_TOOLBAR} ${TONE_OK}`}><Download size={14} /> Install from Git</button>}
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
            {plugins.map((p) => (
              <div key={p.name} className={`glass-card p-4 animate-fade-in ${p.enabled ? 'border-emerald-500/20' : ''}`}>
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 border ${p.enabled ? 'bg-emerald-500/10 border-emerald-500/20' : 'bg-white/5 border-white/10'}`} aria-hidden>
                      <Puzzle className={`w-4 h-4 ${p.enabled ? 'text-emerald-400' : 'text-slate-500'}`} />
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-medium text-slate-100 truncate">{p.name}</h3>
                        <span className="text-[11px] text-slate-500 font-mono">v{p.version}</span>
                      </div>
                      {p.author && <span className="text-xs text-slate-500">{p.author}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Hint label={<PluginDetails name={p.name} version={p.version} description={p.description} hooks={p.hooks} templates={p.templates} author={p.author} Icon={Puzzle} />} position="left">
                      <button type="button" className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label="Plugin details">
                        <Info size={14} />
                      </button>
                    </Hint>
                  </div>
                </div>

                {p.description && (
                  <p className="text-xs text-slate-400 leading-relaxed mb-3">{p.description}</p>
                )}

                {/* Hook chips */}
                {p.hooks && p.hooks.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-3">
                    {p.hooks.map((hook) => (
                      <span key={hook} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-white/5 text-[10px] font-mono text-slate-400 border border-white/5">
                        <Zap size={8} aria-hidden />
                        {hook}
                      </span>
                    ))}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-slate-500">
                  <span className="flex items-center gap-1">
                    <LayoutTemplate size={11} aria-hidden />
                    {(p.templates ?? []).length} {(p.templates ?? []).length === 1 ? 'template' : 'templates'}
                  </span>
                  <span className="flex items-center gap-1">
                    <Zap size={11} aria-hidden />
                    {(p.hooks ?? []).length} {(p.hooks ?? []).length === 1 ? 'hook' : 'hooks'}
                  </span>
                  <span className="ml-auto flex items-center gap-2">
                    <Switch
                      checked={p.enabled}
                      onChange={() => togglePlugin(p.name)}
                      aria-label={`${p.name} enabled`}
                      label={p.enabled ? 'Active' : 'Disabled'}
                    />
                    <Hint label="Remove the plugin">
                      <button type="button" onClick={() => askRemove(p.name)} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`Remove ${p.name}`}>
                        <Trash2 size={13} />
                      </button>
                    </Hint>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showStudio && <CardStudio onClose={() => setShowStudio(false)} onSaved={() => { void fetchPlugins() }} />}

      {/* Install from Git */}
      {showInstall && createPortal(
        <ModalOverlay onClose={() => setShowInstall(false)} className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in" onClick={() => setShowInstall(false)}>
          <div className="bg-slate-900/95 backdrop-blur-xl rounded-2xl p-6 w-full max-w-md mx-4 border border-white/10 shadow-2xl shadow-black/40 animate-scale-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-white/5 border border-white/10 flex items-center justify-center" aria-hidden>
                  <GitBranch size={14} className="text-slate-300" />
                </div>
                <h2 className="text-base font-semibold text-slate-100">Install from Git</h2>
              </div>
              <Hint label="Close"><CloseButton onClick={() => setShowInstall(false)} /></Hint>
            </div>
            <div className="space-y-4">
              <div>
                <label htmlFor="plugin-git-url" className="block text-xs font-medium text-slate-400 mb-1.5">Repository URL</label>
                <input
                  id="plugin-git-url"
                  value={gitUrl}
                  onChange={e => setGitUrl(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleInstall()}
                  placeholder="https://github.com/user/my-dcs-plugin.git"
                  autoFocus
                  className="w-full px-3 py-2.5 rounded-lg bg-white/5 text-sm text-slate-100 placeholder-slate-500 border border-white/10 focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30 focus:outline-none transition-all"
                />
              </div>
              <div className="bg-white/[0.03] rounded-lg px-3.5 py-3 border border-white/5">
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  The repository must contain a <code className="text-cyan-400 font-medium">plugin.json</code> manifest at its root.
                  Plugins can include templates and lifecycle hook scripts.
                </p>
              </div>
              <div className="flex gap-3 pt-1">
                <button type="button" onClick={() => setShowInstall(false)} className={`${BTN_SHEET_QUIET} flex-1`}>Cancel</button>
                <button type="button" onClick={handleInstall} disabled={installing || !gitUrl.trim()} className={`${BTN_SHEET_PRIMARY} flex-1`}>
                  {installing
                    ? <><Loader2 size={14} className="animate-spin" /> Installing…</>
                    : <><Download size={14} /> Install plugin</>
                  }
                </button>
              </div>
            </div>
          </div>
        </ModalOverlay>,
        document.body,
      )}
    </div>
  )
}
