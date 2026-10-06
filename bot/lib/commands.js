// =============================================================================
// Every slash command: its definition, the view it renders and the actions its
// buttons trigger. Views are plain functions returning { embeds, components },
// so a button can redraw the same message instead of posting a new one.
// =============================================================================

import { SlashCommandBuilder, MessageFlags } from 'discord.js'
import {
  COLORS, ICONS, bar, pctColor, since, rel, epochOf, plural, gb, bold, code, truncate,
  codeBlock, lines, dot, stateWord, parseSize, fmtBytes, embed, result,
} from './format.js'
import { button, link, row, rows, confirm, Style } from './components.js'
import { ApiError } from './api.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const EPH = { flags: MessageFlags.Ephemeral }

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------
const cmd = (name, desc) => new SlashCommandBuilder().setName(name).setDescription(desc)
const target = (o, desc = 'A stack or a container (start typing)') => o.setName('target').setDescription(desc).setRequired(true).setAutocomplete(true)
const containerActions = [
  { name: 'info', value: 'info' }, { name: 'logs', value: 'logs' }, { name: 'start', value: 'start' },
  { name: 'stop', value: 'stop' }, { name: 'restart', value: 'restart' }, { name: 'recreate (pull + rebuild)', value: 'recreate' },
]
const stackActions = [
  { name: 'info', value: 'info' }, { name: 'logs', value: 'logs' }, { name: 'start', value: 'start' },
  { name: 'stop', value: 'stop' }, { name: 'restart', value: 'restart' }, { name: 'update (pull + recreate changed)', value: 'update' },
]

export const definitions = [
  cmd('status', 'Server overview: containers, stacks, health, load, memory, disk and DCS itself'),
  cmd('usage', 'CPU, memory, swap and every mounted drive right now'),
  cmd('health', 'What is unhealthy, stopped, restarting or sleeping'),
  cmd('containers', 'Every container, grouped by stack')
    .addStringOption((o) => o.setName('filter').setDescription('Only names containing this'))
    .addStringOption((o) => o.setName('show').setDescription('Only some of them').addChoices(
      { name: 'running', value: 'running' }, { name: 'stopped', value: 'stopped' }, { name: 'unhealthy', value: 'unhealthy' }, { name: 'on demand (sleeping)', value: 'ondemand' })),
  cmd('stacks', 'Every stack with its container count and health'),
  cmd('top', 'Containers using the most CPU and memory'),
  cmd('disk', 'Mounted drives, what Docker takes up and the biggest App-Data folders'),
  cmd('updates', 'Images with a newer version, and images older than 30 days'),
  cmd('logs', 'Last log lines of a container or a stack (only you see them)')
    .addStringOption((o) => target(o))
    .addIntegerOption((o) => o.setName('lines').setDescription('How many lines (10–200, default 40)').setMinValue(10).setMaxValue(200)),
  cmd('container', 'Look at, or act on, one container')
    .addStringOption((o) => o.setName('name').setDescription('Container name').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('action').setDescription('What to do (default: info)').addChoices(...containerActions)),
  cmd('stack', 'Look at, or act on, one stack')
    .addStringOption((o) => o.setName('name').setDescription('Stack name').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('action').setDescription('What to do (default: info)').addChoices(...stackActions)),
  cmd('start', 'Start a stack or a container').addStringOption((o) => target(o)),
  cmd('stop', 'Stop a stack or a container').addStringOption((o) => target(o)),
  cmd('restart', 'Restart a stack or a container').addStringOption((o) => target(o)),
  cmd('update', 'Pull newer images and recreate what changed').addStringOption((o) => target(o, 'A stack, a container, or "all"')),
  cmd('deploy', 'Deploy a template into a stack (previewed first, then confirmed)')
    .addStringOption((o) => o.setName('template').setDescription('Template name').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('stack').setDescription('Target stack (default: the template\'s usual one)').setAutocomplete(true)),
  cmd('backup', 'Run a backup now, or list the recent ones')
    .addStringOption((o) => o.setName('stack').setDescription('Back up only this stack').setAutocomplete(true))
    .addBooleanOption((o) => o.setName('list').setDescription('Only list recent backups')),
  cmd('prune', 'Remove stopped containers, dangling images and unused networks (on-demand containers are kept)'),
  cmd('audit', 'Recent actions on the server').addIntegerOption((o) => o.setName('count').setDescription('How many (5–25)').setMinValue(5).setMaxValue(25)),
  cmd('schedules', 'Scheduled tasks and automations'),
  cmd('run', 'Run a scheduled task now').addStringOption((o) => o.setName('schedule').setDescription('Which one').setRequired(true).setAutocomplete(true)),
  cmd('power', 'UPS: mains or battery, charge, runtime and load'),
  cmd('security', 'CrowdSec: active bans and trusted addresses'),
  cmd('unban', 'Lift a CrowdSec ban').addStringOption((o) => o.setName('ip').setDescription('Address to unban').setRequired(true).setAutocomplete(true)),
  cmd('routes', 'Domains Traefik serves and where they go').addBooleanOption((o) => o.setName('check').setDescription('Probe every route through Traefik (slower)')),
  cmd('dcs', 'DCS itself: version, update, restart')
    .addStringOption((o) => o.setName('action').setDescription('What to do (default: info)').addChoices(
      { name: 'info', value: 'info' }, { name: 'check for updates', value: 'check' }, { name: 'update now', value: 'update' }, { name: 'restart the API', value: 'restart' })),
  cmd('vms', 'Every VM and container on the Proxmox host: state, CPU, memory, uptime'),
  cmd('fleet', 'The hub and its members: the DCS in each VM, its stacks, and whether it answers'),
  cmd('vm', 'Start, shut down, stop, reboot, reset, suspend or resume a Proxmox VM or container')
    .addStringOption((o) => o.setName('vm').setDescription('Name or VMID (start typing)').setRequired(true).setAutocomplete(true))
    .addStringOption((o) => o.setName('action').setDescription('What to do').setRequired(true).addChoices(
      { name: 'info', value: 'info' }, { name: 'start', value: 'start' }, { name: 'shutdown (clean)', value: 'shutdown' },
      { name: 'stop (hard)', value: 'stop' }, { name: 'reboot', value: 'reboot' }, { name: 'reset (VM only, hard)', value: 'reset' },
      { name: 'suspend', value: 'suspend' }, { name: 'resume', value: 'resume' })),
  cmd('help', 'What this bot can do'),
].map((c) => c.toJSON())

/** Commands that change the server; everything else is read-only */
export const ADMIN_COMMANDS = new Set(['start', 'stop', 'restart', 'update', 'deploy', 'backup', 'prune', 'run', 'unban'])

// ---------------------------------------------------------------------------
// Small shared pieces
// ---------------------------------------------------------------------------
const navRow = (...ids) => row(...ids.map(([id, label, emoji]) => button(`nav:${id}`, label, Style.Secondary, emoji)))
const refresh = (view) => button(`nav:${view}`, 'Refresh', Style.Secondary, '🔄')
const dashLink = (ctx, label = 'Dashboard') => (ctx.dashboard ? link(label, ctx.dashboard, '🧭') : null)
const pretty = (s) => String(s ?? '').replace(/^auth\./, '').replace(/[_.]/g, ' ').replace(/^\w/, (c) => c.toUpperCase())
const memPct = (sys) => (sys?.memory_mb?.total ? Math.round(((sys.memory_mb.total - sys.memory_mb.available) / sys.memory_mb.total) * 100) : 0)
const diskPct = (d) => parseInt(String(d?.percent ?? '0'), 10) || 0

/** "s:media-services" / "c:Plex" / free text → { kind, name } */
async function resolveTarget(api, raw) {
  const v = String(raw || '').trim()
  if (v.startsWith('s:')) return { kind: 's', name: v.slice(2) }
  if (v.startsWith('c:')) return { kind: 'c', name: v.slice(2) }
  if (v.toLowerCase() === 'all') return { kind: 'all', name: 'all' }
  const [stacks, containers] = await Promise.all([api.names.stacks(), api.names.containers()])
  const lc = v.toLowerCase()
  const s = stacks.find((x) => x.name.toLowerCase() === lc) || stacks.find((x) => x.name.toLowerCase().includes(lc))
  const c = containers.find((x) => x.name.toLowerCase() === lc) || containers.find((x) => x.name.toLowerCase().includes(lc))
  if (c && (!s || c.name.toLowerCase() === lc)) return { kind: 'c', name: c.name }
  if (s) return { kind: 's', name: s.name }
  throw new ApiError(`I don't know a stack or container called "${v}". Pick one from the list that appears while you type.`)
}

/** Wait for a background stack action; resolves to the activity record */
async function waitForStack(api, stack, { timeoutMs = 180000, everyMs = 3000 } = {}) {
  const started = Date.now()
  let last = null
  await sleep(1500)
  while (Date.now() - started < timeoutMs) {
    try { last = await api.get(`/stacks/${encodeURIComponent(stack)}/activity`) } catch { /* keep waiting */ }
    if (last && last.active === false && last.phase && last.phase !== 'idle') return last
    if (last && last.active === false && last.finished_at) return last
    await sleep(everyMs)
  }
  return last || { active: true }
}

async function reply(i, payload) {
  if (i.deferred || i.replied) return i.editReply(payload)
  return i.reply(payload)
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export const views = {}

const vmDot = (st) => (st === 'running' ? '🟢' : st === 'paused' || st === 'suspended' ? '🟡' : '⚫')
const vmKind = (v) => (v.type === 'lxc' ? 'LXC' : 'VM')
const gbOf = (b) => (b ? `${(b / 1073741824).toFixed(b >= 10737418240 ? 0 : 1)} GB` : '0')

views.vms = async (ctx) => {
  const st = await ctx.api.get('/proxmox/status')
  if (!st.configured) return { embeds: [result(ctx, 'warn', 'Proxmox is not linked', 'Set the URL and an API token in Server Config → Proxmox on the dashboard (docs/PROXMOX.md).')], components: [] }
  if (!st.reachable) return { embeds: [result(ctx, false, 'Proxmox did not answer', st.error || st.hints?.[0] || '')], components: [] }
  const [vms, nodes] = await Promise.all([ctx.api.get('/proxmox/vms'), ctx.api.get('/proxmox/nodes').catch(() => null)])
  const list = vms.vms || []
  const nodeLines = (nodes?.nodes || []).map((n) => `${n.status === 'online' ? '🟢' : '🔴'} ${bold(n.node)} · CPU ${bar(n.cpu)} ${n.cpu}% · RAM ${bar(n.mem_pct)} ${n.mem_pct}% · up ${since(n.uptime)}`)
  const byNode = {}
  for (const v of list) (byNode[v.node] ||= []).push(v)
  const fields = Object.keys(byNode).sort().map((node) => ({
    name: `${node} · ${byNode[node].filter((v) => v.status === 'running').length}/${byNode[node].length} running`,
    value: truncate(byNode[node].map((v) => `${vmDot(v.status)} ${bold(v.name)} \`${v.vmid}\` ${vmKind(v)}${v.status === 'running' ? ` · ${v.cpu}% · ${gbOf(v.mem)}/${gbOf(v.maxmem)} · ${since(v.uptime)}` : ` · ${v.status}`}`).join('\n') || '—', 1000),
  }))
  const e = embed(ctx, {
    title: `Proxmox VE ${st.version} · ${vms.running} of ${vms.total} guests running`,
    description: nodeLines.join('\n') || undefined,
    color: vms.running === vms.total ? COLORS.ok : vms.running === 0 ? COLORS.bad : COLORS.warn,
    fields,
  })
  return { embeds: [e], components: rows([button('nav:vms', 'Refresh', Style.Secondary, '🔄')]) }
}

views.fleet = async (ctx) => {
  const st = await ctx.api.get('/fleet/status')
  if (st.role === 'member') {
    const h = st.hub || {}
    return { embeds: [embed(ctx, { title: `This server is a member of ${h.name || h.url || 'a hub'}`, description: `Joined as ${bold(h.member_name || '?')}${h.vmid ? ` · guest ${h.vmid}${h.node ? ` on ${h.node}` : ''}` : ''}${h.version ? ` · hub runs DCS ${h.version}` : ''}\nThe hub's Proxmox page lists this server's stacks under its VM.`, color: COLORS.ok })], components: rows([button('nav:fleet', 'Refresh', Style.Secondary, '🔄')]) }
  }
  if (!st.members) return { embeds: [result(ctx, 'warn', 'No fleet members yet', st.proxmox_linked ? 'Link the VMs on the dashboard\'s Proxmox page (Link VMs), or run ./setup.sh with the join code on each Docker VM.' : 'Link Proxmox first (Server Config → Proxmox), then link the VMs on the Proxmox page.')], components: [] }
  const ov = await ctx.api.get('/fleet/overview')
  const fields = (ov.members || []).map((m) => ({
    name: `${m.reachable ? '🟢' : '🔴'} ${m.name}${m.vmid ? ` · VM ${m.vmid}` : ''}${m.version ? ` · DCS ${m.version}` : ''}`,
    value: truncate(m.reachable
      ? `${m.url}\n${(m.stacks || []).map((s) => `${s.status === 'running' ? '🟢' : '⚫'} ${s.name} (${s.running_containers})`).join(' · ') || 'no stacks yet'}`
      : `${m.url}\n${m.error || 'no answer'}`, 1000),
  }))
  const t = ov.totals || {}
  const e = embed(ctx, {
    title: `Fleet · ${t.reachable ?? 0}/${t.members ?? 0} members answering · ${t.stacks ?? 0} stacks · ${t.containers_running ?? 0}/${t.containers_total ?? 0} containers`,
    description: `Hub: ${bold(ov.hub?.name || ov.hub?.hostname || 'this server')} (DCS ${ov.hub?.version || '?'})`,
    color: (t.reachable ?? 0) === (t.members ?? 0) ? COLORS.ok : (t.reachable ?? 0) === 0 ? COLORS.bad : COLORS.warn,
    fields,
  })
  return { embeds: [e], components: rows([button('nav:fleet', 'Refresh', Style.Secondary, '🔄'), button('nav:vms', 'VMs', Style.Secondary, '🖥️')]) }
}

views.vm = async (ctx, ref) => {
  const v = await findVm(ctx, ref)
  if (!v) return { embeds: [result(ctx, false, `No VM or container called ${bold(ref)}`, 'Use /vms to list them.')], components: [] }
  const d = await ctx.api.get(`/proxmox/vms/${encodeURIComponent(v.node)}/${v.type}/${v.vmid}`).catch(() => null)
  const c = d?.config || {}
  const e = embed(ctx, {
    title: `${vmDot(v.status)} ${v.name} · ${vmKind(v)} ${v.vmid} on ${v.node}`,
    description: `${bold(v.status)}${v.status === 'running' ? ` for ${since(v.uptime)}` : ''}${v.tags?.length ? ` · tags: ${v.tags.join(', ')}` : ''}${v.intended ? ' · last change by DCS' : ''}`,
    color: v.status === 'running' ? COLORS.ok : COLORS.slate,
    fields: [
      { name: 'CPU', value: `${bar(v.cpu)} ${v.cpu}%\n${v.maxcpu || c.cores || '?'} cores`, inline: true },
      { name: 'Memory', value: `${bar(v.mem_pct)} ${v.mem_pct}%\n${gbOf(v.mem)} of ${gbOf(v.maxmem)}`, inline: true },
      { name: 'Disk', value: `${gbOf(v.maxdisk)}${c.bootdisk ? `\n${c.bootdisk}` : ''}`, inline: true },
      ...(c.ostype ? [{ name: 'OS type', value: c.ostype, inline: true }] : []),
      ...(c.onboot != null ? [{ name: 'Start at boot', value: String(c.onboot) === '1' ? 'yes' : 'no', inline: true }] : []),
      ...(d?.netin != null ? [{ name: 'Network', value: `↓ ${fmtBytes(d.netin)} · ↑ ${fmtBytes(d.netout)}`, inline: true }] : []),
      ...(c.description ? [{ name: 'Notes', value: truncate(c.description, 300) }] : []),
    ],
  })
  const key = `${v.node}/${v.type}/${v.vmid}`
  const acts = v.status === 'running'
    ? [button(`act:vm:shutdown:${key}`, 'Shut down', Style.Secondary, '⏻'), button(`act:vm:reboot:${key}`, 'Reboot', Style.Secondary, '🔁'), button(`act:vm:stop:${key}`, 'Stop', Style.Danger, '⏹️'), ...(v.type === 'qemu' ? [button(`act:vm:reset:${key}`, 'Reset', Style.Danger, '⚡')] : [])]
    : v.status === 'paused' || v.status === 'suspended'
      ? [button(`act:vm:resume:${key}`, 'Resume', Style.Success, '▶️')]
      : [button(`act:vm:start:${key}`, 'Start', Style.Success, '▶️')]
  return { embeds: [e], components: rows([...acts, button(`nav:vm:${key}`, 'Refresh', Style.Secondary, '🔄')]) }
}

async function findVm(ctx, ref) {
  const list = await ctx.api.names.vms()
  const r = String(ref || '').trim()
  if (r.includes('/')) { const [node, type, id] = r.split('/'); return list.find((v) => v.node === node && v.type === type && String(v.vmid) === id) || null }
  return list.find((v) => String(v.vmid) === r) || list.find((v) => v.name.toLowerCase() === r.toLowerCase()) || list.find((v) => v.name.toLowerCase().includes(r.toLowerCase())) || null
}

async function vmAction(ctx, i, ref, action) {
  if (action === 'info') return sendView(ctx, i, 'vm', ref)
  if (!needAdmin(ctx, i)) return
  const v = await findVm(ctx, ref)
  if (!v) { const msg = { embeds: [result(ctx, false, `No VM or container called ${bold(ref)}`, 'Use /vms to list them.')], ...EPH }; return i.deferred || i.replied ? i.followUp(msg) : i.reply(msg) }
  const words = { start: 'Start', shutdown: 'Shut down', stop: 'Stop', reboot: 'Reboot', reset: 'Reset', suspend: 'Suspend', resume: 'Resume' }
  const go = async (j) => {
    let r
    try { r = await ctx.api.post(`/proxmox/vms/${encodeURIComponent(v.node)}/${v.type}/${v.vmid}/${action}`) }
    catch (err) { return j.editReply({ embeds: [result(ctx, false, `${words[action]} ${bold(v.name)} failed`, err instanceof ApiError ? err.message : String(err))], components: [] }) }
    ctx.api.invalidate('vms')
    await sleep(2500)
    const view = await views.vm(ctx, `${v.node}/${v.type}/${v.vmid}`).catch(() => null)
    const head = result(ctx, r.success !== false, r.message || `${words[action]} ${bold(v.name)}`, r.upid ? `Proxmox task ${code(r.upid.split(':')[5] || r.upid)}` : '')
    await j.editReply({ embeds: [head, ...(view?.embeds || [])], components: view?.components || [] })
  }
  if (action !== 'start' && action !== 'resume') {
    const q = { shutdown: `Shut down ${bold(v.name)} cleanly?`, stop: `Stop ${bold(v.name)} now? Like pulling the plug — nothing inside gets to save.`, reboot: `Reboot ${bold(v.name)}?`, reset: `Hard-reset ${bold(v.name)}? Only for a VM that no longer answers.`, suspend: `Suspend ${bold(v.name)}?` }[action]
    return askConfirm(ctx, i, { question: q, label: `${words[action]} it`, run: go })
  }
  await (i.deferred || i.replied ? Promise.resolve() : i.deferReply())
  await go(i)
}

views.status = async (ctx) => {
  const [s, h, score, upd, imgs] = await Promise.all([
    ctx.api.get('/status'), ctx.api.get('/health').catch(() => null), ctx.api.get('/health/score').catch(() => null),
    ctx.api.cached('update-check', 600000, () => ctx.api.get('/system/update/check')).catch(() => null),
    ctx.api.get('/images/check-updates').catch(() => null),
  ])
  const d = s.docker || {}, sys = s.system || {}, st = s.stacks || d.stacks || {}
  const sum = h?.summary || {}
  const unhealthy = sum.unhealthy ?? 0, stopped = sum.stopped ?? d.containers?.stopped ?? 0, sleeping = sum.sleeping ?? 0
  const running = d.containers?.running ?? 0, total = d.containers?.total ?? running + stopped
  const mem = memPct(sys)
  const disks = await ctx.api.get('/disks').catch(() => null)
  const mounts = (disks?.disks || []).filter((m) => parseSize(m.total) > 0)
  const worstDisk = mounts.reduce((w, m) => Math.max(w, diskPct(m)), diskPct(sys.disk))
  const updates = (imgs?.images || []).filter((im) => im.update_available === true).length
  const stale = (imgs?.images || []).filter((im) => im.staleness === 'stale').length
  const load = (sys.load_average || []).map((n) => Number(n).toFixed(2))

  const verdict = unhealthy > 0
    ? `🟠 ${bold(plural(unhealthy, 'container'))} unhealthy`
    : h?.status === 'critical' ? '🔴 critical' : `🟢 all ${bold(running)} running containers healthy`
  const bits = [verdict, `${bold(st.running ?? '?')} of ${bold(st.total ?? '?')} stacks up`]
  if (sleeping) bits.push(`${bold(sleeping)} sleeping on demand`)
  if (stopped) bits.push(`${bold(stopped)} stopped`)
  if (score?.score != null) bits.push(`health score ${bold(`${score.score}`)}${score.grade ? ` (${score.grade})` : ''}`)

  const dcsLine = upd
    ? (upd.available ? `v${upd.current_version} → ${bold(upd.latest_name || upd.latest_version)} available` : `v${upd.current_version} · up to date`)
    : ctx.version ? `v${ctx.version}` : '—'
  const color = unhealthy > 0 || worstDisk >= 90 ? COLORS.bad : stopped > 0 || worstDisk >= 75 || mem >= 85 ? COLORS.warn : COLORS.ok
  const e = embed(ctx, {
    title: `${s.hostname || ctx.server} at a glance`,
    description: bits.join(' · '),
    color, thumbnail: ICONS.app,
    fields: [
      { name: 'Load', value: `${load.join(' · ') || '—'}\n${sys.cpu_count || '?'} cores`, inline: true },
      { name: 'Memory', value: `${bar(mem)} ${mem}%\n${sys.memory_mb ? `${gb(sys.memory_mb.total - sys.memory_mb.available)} of ${gb(sys.memory_mb.total)}` : '—'}`, inline: true },
      ...(mounts.length ? mounts.slice(0, 3).map((m) => ({ name: `Disk ${m.mount}`, value: `${bar(diskPct(m))} ${diskPct(m)}%\n${m.used} of ${m.total}`, inline: true }))
        : [{ name: 'Disk', value: sys.disk ? `${bar(diskPct(sys.disk))} ${diskPct(sys.disk)}%\n${sys.disk.used} of ${sys.disk.total}` : '—', inline: true }]),
      { name: 'Uptime', value: `${since(s.uptime_seconds)}\nsince ${rel(Math.floor(Date.now() / 1000) - (s.uptime_seconds || 0))}`, inline: true },
      { name: 'Images', value: `${d.images ?? '?'} total${updates ? ` · ${bold(updates)} updatable` : ''}${stale ? ` · ${stale} stale` : ''}`, inline: true },
      { name: 'DCS', value: dcsLine, inline: true },
    ],
  })
  return { embeds: [e], components: [navRow(['health', 'Health', '💓'], ['containers', 'Containers', '📦'], ['stacks', 'Stacks', '🗂️'], ['updates', 'Updates', '⬆️'], ['usage', 'Usage', '📊']), row(refresh('status'), dashLink(ctx))] }
}

views.usage = async (ctx) => {
  const [s, disks] = await Promise.all([ctx.api.get('/status'), ctx.api.get('/disks').catch(() => ({ disks: [] }))])
  const sys = s.system || {}
  const cores = sys.cpu_count || 1
  const load = (sys.load_average || [0]).map(Number)
  const cpu = Math.min(100, Math.round((load[0] / cores) * 100))
  const mem = memPct(sys)
  const swap = sys.swap_mb?.total ? Math.round(((sys.swap_mb.total - sys.swap_mb.free) / sys.swap_mb.total) * 100) : null
  const mounts = (disks.disks || []).filter((m) => parseSize(m.total) > 0)
  if (!mounts.length && sys.disk) mounts.push({ mount: sys.disk.mount || '/', used: sys.disk.used, total: sys.disk.total, percent: sys.disk.percent })
  const worst = Math.max(cpu, mem, ...mounts.map(diskPct))
  const fields = [
    { name: 'CPU', value: `${bar(cpu)} ${cpu}%\nload ${load.map((n) => n.toFixed(2)).join(' · ')} on ${cores} cores`, inline: true },
    { name: 'Memory', value: `${bar(mem)} ${mem}%\n${sys.memory_mb ? `${gb(sys.memory_mb.total - sys.memory_mb.available)} of ${gb(sys.memory_mb.total)}` : '—'}`, inline: true },
    { name: 'Swap', value: swap == null ? 'none' : `${bar(swap)} ${swap}%\n${gb(sys.swap_mb.total - sys.swap_mb.free)} of ${gb(sys.swap_mb.total)}`, inline: true },
    ...mounts.slice(0, 9).map((m) => ({ name: `Drive ${m.mount}`, value: `${bar(diskPct(m))} ${diskPct(m)}%\n${m.used} of ${m.total} · ${m.available} free`, inline: true })),
  ]
  const e = embed(ctx, { title: `${s.hostname || ctx.server} · usage`, color: pctColor(worst), fields, footer: `${plural(mounts.length, 'drive')} mounted` })
  return { embeds: [e], components: [row(refresh('usage'), button('nav:top', 'Top containers', Style.Secondary, '🔥'), button('nav:disk', 'Disk', Style.Secondary, '💽'), dashLink(ctx))] }
}

views.health = async (ctx) => {
  const [h, score] = await Promise.all([ctx.api.get('/health'), ctx.api.get('/health/score').catch(() => null)])
  const all = h.containers || []
  const unhealthy = all.filter((c) => c.state === 'running' && c.health === 'unhealthy')
  const restarting = all.filter((c) => c.state === 'restarting' || (c.restart_count || 0) >= 5)
  const stopped = all.filter((c) => c.state !== 'running' && !c.on_demand)
  const sleeping = all.filter((c) => c.state !== 'running' && c.on_demand)
  const missing = h.summary?.on_demand_missing || []
  const sum = h.summary || {}
  const fine = !unhealthy.length && !restarting.length && !stopped.length && !missing.length
  const head = fine
    ? `🟢 All ${bold(plural(sum.healthy ?? all.length, 'container'))} are healthy`
    : `${unhealthy.length ? '🟠' : '🟡'} ${bold(sum.healthy ?? 0)} healthy · ${bold(unhealthy.length)} unhealthy · ${bold(stopped.length)} stopped${restarting.length ? ` · ${bold(restarting.length)} restarting` : ''}`
  const fields = []
  if (unhealthy.length) fields.push({ name: `🟠 Unhealthy (${unhealthy.length})`, value: lines(unhealthy.map((c) => `${bold(c.name)}${c.restart_count ? ` · ${c.restart_count} restarts` : ''}`)) })
  if (restarting.length) fields.push({ name: `🔁 Restart loops (${restarting.length})`, value: lines(restarting.map((c) => `${bold(c.name)} · ${c.restart_count ?? '?'} restarts`)) })
  if (stopped.length) fields.push({ name: `⚫ Stopped (${stopped.length})`, value: lines(stopped.map((c) => `${bold(c.name)} · ${c.state}`)) })
  if (missing.length) fields.push({ name: `⚠️ On-demand containers missing (${missing.length})`, value: `${lines(missing.map(bold))}\nA prune removed them; the dashboard's Health page can recreate them.` })
  if (sleeping.length) fields.push({ name: `💤 Sleeping on demand (${sleeping.length})`, value: truncate(sleeping.map((c) => bold(c.name)).join(' · '), 1024) })
  if (score?.factors) {
    const f = score.factors
    fields.push({ name: `Health score ${score.score}${score.grade ? ` (${score.grade})` : ''}`, value: [
      f.stacks ? `containers ${f.stacks.score}` : null, f.resources ? `resources ${f.resources.score}` : null,
      f.images ? `images ${f.images.score}` : null, f.uptime ? `uptime ${f.uptime.score}` : null,
    ].filter(Boolean).join(' · '), inline: false })
  }
  const e = embed(ctx, { title: `Health · ${h.status || 'unknown'}`, description: head, color: unhealthy.length || h.status === 'critical' ? COLORS.bad : stopped.length || restarting.length || missing.length ? COLORS.warn : COLORS.ok, fields })
  const buttons = [refresh('health')]
  if (unhealthy.length) buttons.push(button('act:restart-unhealthy', `Restart ${plural(unhealthy.length, 'unhealthy container')}`, Style.Danger, '🔁'))
  if (missing.length) buttons.push(button('act:repair-ondemand', 'Recreate on-demand containers', Style.Primary, '💤'))
  return { embeds: [e], components: [row(...buttons), navRow(['status', 'Status', '🧭'], ['containers', 'Containers', '📦'])] }
}

views.containers = async (ctx, filter = '', show = '') => {
  const r = await ctx.api.get('/containers')
  const f = String(filter || '').toLowerCase()
  let list = (r.containers || []).filter((c) => !f || c.name.toLowerCase().includes(f) || (c.image || '').toLowerCase().includes(f))
  if (show === 'running') list = list.filter((c) => c.state === 'running')
  if (show === 'stopped') list = list.filter((c) => c.state !== 'running' && !c.on_demand)
  if (show === 'unhealthy') list = list.filter((c) => c.health === 'unhealthy')
  if (show === 'ondemand') list = list.filter((c) => c.on_demand)
  const groups = new Map()
  for (const c of list.sort((a, b) => a.name.localeCompare(b.name))) {
    const k = c.stack || 'not in a stack'
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push(c)
  }
  const running = list.filter((c) => c.state === 'running').length
  const fields = []
  let budget = 5200
  for (const [stack, cs] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const ls = cs.map((c) => `${dot(c)} ${bold(c.name)} · ${c.state === 'running' ? (c.health === 'unhealthy' ? 'unhealthy · ' : '') + since(c.uptime_seconds) : stateWord(c)}`)
    const value = lines(ls, Math.min(1024, Math.max(60, budget)))
    budget -= value.length + stack.length + 8
    if (budget < 0) { fields.push({ name: '…', value: `${plural(groups.size - fields.length, 'more stack')} — add a filter to narrow it down` }); break }
    fields.push({ name: `${stack} · ${cs.length}`, value })
  }
  const what = `${show ? `${show === 'ondemand' ? 'on-demand' : show} ` : ''}container${list.length === 1 ? '' : 's'}${f ? ` matching “${f}”` : ''}`
  const e = embed(ctx, {
    title: `Containers · ${list.length}`,
    description: list.length ? `${bold(running)} running · ${bold(list.length - running)} not running · ${bold(groups.size)} ${groups.size === 1 ? 'stack' : 'stacks'}` : `No ${what}.`,
    color: list.some((c) => c.health === 'unhealthy') ? COLORS.warn : COLORS.info, fields,
    footer: `🟢 running · 🟠 unhealthy · ⚫ stopped · 💤 sleeping on demand`,
  })
  return { embeds: [e], components: [row(refresh('containers'), button('nav:health', 'Health', Style.Secondary, '💓'), button('nav:stacks', 'Stacks', Style.Secondary, '🗂️'), dashLink(ctx))] }
}

views.stacks = async (ctx) => {
  const [r, c] = await Promise.all([ctx.api.get('/stacks'), ctx.api.get('/containers').catch(() => ({ containers: [] }))])
  const byStack = new Map()
  for (const x of c.containers || []) {
    const k = x.stack || ''
    if (!byStack.has(k)) byStack.set(k, { running: 0, unhealthy: 0, sleeping: 0, total: 0 })
    const g = byStack.get(k); g.total++
    if (x.state === 'running') { g.running++; if (x.health === 'unhealthy') g.unhealthy++ } else if (x.on_demand) g.sleeping++
  }
  const stacks = (r.stacks || []).slice().sort((a, b) => (a.status === b.status ? a.name.localeCompare(b.name) : a.status === 'running' ? -1 : 1))
  const up = stacks.filter((s) => s.status === 'running').length
  const totalContainers = stacks.reduce((n, s) => n + (byStack.get(s.name)?.total ?? s.running_containers ?? 0), 0)
  const ls = stacks.map((s) => {
    const g = byStack.get(s.name)
    const where = s.placement === 'vm' ? ` · VM${s.vmid ? ' ' + s.vmid : ''}${s.reachable === false ? ' (offline)' : ''}` : ''
    if (s.status !== 'running') return `⚫ ${bold(s.name)} · stopped${where}`
    const n = g?.running ?? s.running_containers ?? 0
    const notes = []
    if (g?.unhealthy) notes.push(`${g.unhealthy} unhealthy`)
    if (g?.sleeping) notes.push(`${g.sleeping} sleeping`)
    return `${g?.unhealthy ? '🟠' : '🟢'} ${bold(s.name)} · ${plural(n, 'container')}${notes.length ? ` · ${notes.join(' · ')}` : ''}`
  })
  const e = embed(ctx, {
    title: `Stacks · ${stacks.length}`,
    description: `${bold(up)} of ${bold(stacks.length)} running · ${bold(totalContainers)} containers\n\n${lines(ls, 3800, 'more')}`,
    color: stacks.some((s) => byStack.get(s.name)?.unhealthy) ? COLORS.warn : up === stacks.length ? COLORS.ok : COLORS.info,
    footer: 'Use /stack <name> for one stack, with start · stop · restart · update buttons',
  })
  return { embeds: [e], components: [row(refresh('stacks'), button('nav:containers', 'Containers', Style.Secondary, '📦'), button('nav:health', 'Health', Style.Secondary, '💓'), dashLink(ctx))] }
}

views.top = async (ctx) => {
  let r = await ctx.api.get('/containers')
  let list = (r.containers || []).filter((c) => c.state === 'running')
  if (list.length && list.every((c) => c.cpu_percent == null)) { await sleep(3000); r = await ctx.api.get('/containers'); list = (r.containers || []).filter((c) => c.state === 'running') }
  const withStats = list.filter((c) => c.cpu_percent != null || c.mem_percent != null)
  const byCpu = withStats.slice().sort((a, b) => (b.cpu_percent || 0) - (a.cpu_percent || 0)).slice(0, 8)
  const byMem = withStats.slice().sort((a, b) => (b.mem_percent || 0) - (a.mem_percent || 0)).slice(0, 8)
  const fmt = (c, v) => `${bar(v, 6)} ${bold(c.name)} ${Number(v || 0).toFixed(1)}%`
  const e = embed(ctx, {
    title: 'Top containers',
    description: withStats.length ? `Live figures for ${bold(plural(withStats.length, 'running container'))}` : 'No usage figures yet — DCS samples them in the background, try again in a moment.',
    color: byCpu[0]?.cpu_percent >= 80 ? COLORS.warn : COLORS.info,
    fields: withStats.length ? [
      { name: '🔥 CPU', value: lines(byCpu.map((c) => fmt(c, c.cpu_percent))), inline: true },
      { name: '🧠 Memory', value: lines(byMem.map((c) => fmt(c, c.mem_percent))), inline: true },
    ] : [],
    footer: 'CPU is per core (100% = one core busy); memory is of the container\'s limit',
  })
  return { embeds: [e], components: [row(refresh('top'), button('nav:usage', 'Usage', Style.Secondary, '📊'), dashLink(ctx))] }
}

views.disk = async (ctx) => {
  const [disks, m] = await Promise.all([ctx.api.get('/disks').catch(() => ({ disks: [] })), ctx.api.get('/maintenance/disk').catch(() => null)])
  const mounts = (disks.disks || []).filter((x) => parseSize(x.total) > 0)
  const fields = mounts.slice(0, 6).map((x) => ({ name: `Drive ${x.mount}`, value: `${bar(diskPct(x))} ${diskPct(x)}%\n${x.used} of ${x.total} · ${x.available} free`, inline: true }))
  const df = m?.docker_df
  if (Array.isArray(df) && df.length) {
    fields.push({ name: '🐳 Docker', value: df.map((d) => `${bold(d.type)} ${d.size}${d.reclaimable ? ` · ${d.reclaimable} reclaimable` : ''}`).join('\n'), inline: false })
  }
  const sizes = (m?.stack_sizes || []).slice().sort((a, b) => parseSize(b.size || b.human || 0) - parseSize(a.size || a.human || 0)).slice(0, 8)
  if (sizes.length) fields.push({ name: '📁 Biggest App-Data', value: lines(sizes.map((s) => `${bold(s.stack || s.name)} · ${s.size || s.human || '?'}`)), inline: false })
  const worst = Math.max(0, ...mounts.map(diskPct))
  const e = embed(ctx, { title: 'Disk', description: mounts.length ? `${plural(mounts.length, 'drive')} mounted · the fullest is at ${bold(`${worst}%`)}` : 'No drives reported', color: pctColor(worst), fields })
  const buttons = [refresh('disk')]
  if (ctx.isAdmin()) buttons.push(button('act:prune', 'Prune unused Docker data', Style.Danger, '🧹'))
  return { embeds: [e], components: [row(...buttons, dashLink(ctx))] }
}

views.updates = async (ctx) => {
  const r = await ctx.api.get('/images/check-updates')
  const all = r.images || []
  const upd = all.filter((im) => im.update_available === true)
  const stale = all.filter((im) => im.staleness === 'stale' && im.update_available !== true)
  const failed = all.filter((im) => im.status === 'check_failed').length
  const checked = r.registry_checked_at || r.checked_at
  const fields = []
  if (upd.length) fields.push({ name: `⬆️ Newer version published (${upd.length})`, value: lines(upd.map((im) => `${bold(im.image)}${im.containers && im.containers !== '-' ? ` · ${im.containers}` : ''}${im.stack ? ` (${im.stack})` : ''}`)) })
  if (stale.length) fields.push({ name: `🕒 Older than 30 days (${stale.length})`, value: lines(stale.map((im) => `${bold(im.image)} · ${im.age_days}d${im.containers && im.containers !== '-' ? ` · ${im.containers}` : ''}`)) })
  const e = embed(ctx, {
    title: `Updates · ${upd.length} available`,
    description: upd.length ? `${bold(plural(upd.length, 'image'))} can be updated${stale.length ? `, ${bold(stale.length)} more ${stale.length === 1 ? 'is' : 'are'} older than a month` : ''}.` : `Everything is current${stale.length ? `, though ${bold(plural(stale.length, 'image'))} ${stale.length === 1 ? 'is' : 'are'} older than a month` : ''}.`,
    color: upd.length ? COLORS.warn : COLORS.ok, fields,
    footer: checked ? `registry checked ${new Date(checked).toUTCString().replace(' GMT', ' UTC')}` : 'registry not checked yet — press “Check registry”',
  })
  const buttons = [button('act:check-registry', 'Check registry now', Style.Primary, '🔎'), refresh('updates')]
  if (upd.length && ctx.isAdmin()) buttons.push(button('act:update-all', 'Update everything', Style.Danger, '⬆️'))
  return { embeds: [e], components: [row(...buttons, dashLink(ctx))] }
}

views.container = async (ctx, name) => {
  const c = await ctx.api.get(`/containers/${encodeURIComponent(name)}`)
  const stats = c.state === 'running' ? await ctx.api.get(`/containers/${encodeURIComponent(name)}/stats`).catch(() => null) : null
  const ports = String(c.ports || '').split(',').map((p) => p.trim()).filter((p) => p && !p.startsWith(':::') && !p.startsWith('[::]'))
  const publ = ports.filter((p) => p.includes('->')).map((p) => p.replace('0.0.0.0:', '').replace(/->.*$/, '')).filter((v, i, a) => a.indexOf(v) === i)
  const fields = [
    { name: 'State', value: `${dot(c)} ${stateWord(c)}${c.state === 'running' ? ` · up ${since(c.uptime_seconds)}` : ''}`, inline: true },
    { name: 'Stack', value: c.stack || c.compose_project ? `${c.stack || c.compose_project}${c.compose_service ? ` / ${c.compose_service}` : ''}` : 'not in a stack', inline: true },
    { name: 'Restarts', value: `${c.restart_count ?? 0}${c.restart_policy ? ` · ${c.restart_policy}` : ''}`, inline: true },
    { name: 'Image', value: code(c.image), inline: false },
    publ.length ? { name: 'Published ports', value: publ.join(' · '), inline: true } : null,
    stats ? { name: 'Right now', value: `CPU ${Number(stats.cpu_percent || 0).toFixed(1)}% · memory ${String(stats.memory_usage || '').split('/')[0].trim() || '?'} (${Number(stats.memory_percent || 0).toFixed(1)}%)${stats.pids ? ` · ${stats.pids} processes` : ''}`, inline: true } : null,
    stats?.network_io ? { name: 'Network in / out', value: stats.network_io, inline: true } : null,
  ]
  const e = embed(ctx, { title: c.name, color: c.state !== 'running' ? (c.on_demand ? COLORS.info : COLORS.slate) : c.health === 'unhealthy' ? COLORS.bad : COLORS.ok, fields })
  const b = [button(`act:c:logs:${name}`, 'Logs', Style.Secondary, '📜')]
  if (ctx.isAdmin()) {
    b.push(button(`act:c:restart:${name}`, 'Restart', Style.Primary, '🔁'))
    b.push(c.state === 'running' ? button(`act:c:stop:${name}`, 'Stop', Style.Danger, '⏹️') : button(`act:c:start:${name}`, 'Start', Style.Success, '▶️'))
    b.push(button(`act:c:recreate:${name}`, 'Recreate', Style.Secondary, '♻️'))
  }
  b.push(button(`nav:container:${name}`, 'Refresh', Style.Secondary, '🔄'))
  return { embeds: [e], components: [row(...b), row(button('nav:containers', 'All containers', Style.Secondary, '📦'), dashLink(ctx))] }
}

views.stack = async (ctx, name) => {
  const s = await ctx.api.get(`/stacks/${encodeURIComponent(name)}`)
  const cs = (s.containers || []).slice().sort((a, b) => a.name.localeCompare(b.name))
  const running = cs.filter((c) => c.state === 'running').length
  const unhealthy = cs.filter((c) => c.health === 'unhealthy').length
  const ls = cs.map((c) => `${dot(c)} ${bold(c.name)} · ${c.state === 'running' ? (c.health === 'unhealthy' ? 'unhealthy · ' : '') + since(c.uptime_seconds) : stateWord(c)}${c.image ? ` · ${truncate(String(c.image).replace(/^docker\.io\//, ''), 40)}` : ''}`)
  const e = embed(ctx, {
    title: `Stack ${name}`,
    description: `${s.status === 'running' ? '🟢' : '⚫'} ${s.status}${cs.length ? ` · ${bold(running)} of ${bold(cs.length)} containers running` : ''}${unhealthy ? ` · ${bold(unhealthy)} unhealthy` : ''}${s.services?.length ? `\nservices: ${s.services.map(code).join(' ')}` : ''}\n\n${lines(ls, 3600)}`,
    color: unhealthy ? COLORS.bad : s.status === 'running' ? COLORS.ok : COLORS.slate,
  })
  const b = [button(`act:s:logs:${name}`, 'Logs', Style.Secondary, '📜')]
  if (ctx.isAdmin()) {
    b.push(button(`act:s:restart:${name}`, 'Restart', Style.Primary, '🔁'))
    b.push(s.status === 'running' ? button(`act:s:stop:${name}`, 'Stop', Style.Danger, '⏹️') : button(`act:s:start:${name}`, 'Start', Style.Success, '▶️'))
    b.push(button(`act:s:update:${name}`, 'Update', Style.Secondary, '⬆️'))
  }
  b.push(button(`nav:stack:${name}`, 'Refresh', Style.Secondary, '🔄'))
  return { embeds: [e], components: [row(...b), row(button('nav:stacks', 'All stacks', Style.Secondary, '🗂️'), dashLink(ctx))] }
}

views.audit = async (ctx, count = 12) => {
  const r = await ctx.api.get(`/audit?limit=${Math.min(25, Math.max(5, count))}`)
  const ls = (r.entries || []).map((e) => `${rel(epochOf(e.timestamp))} ${bold(pretty(e.action))} · ${truncate(String(e.detail || '').replace(/\s+/g, ' '), 110)}`)
  const e = embed(ctx, { title: 'Recent activity', description: lines(ls, 3900) , color: COLORS.slate, footer: 'newest first · the Activity page has the full log' })
  return { embeds: [e], components: [row(refresh('audit'), dashLink(ctx))] }
}

views.schedules = async (ctx) => {
  const [s, a] = await Promise.all([ctx.api.get('/schedules').catch(() => ({ schedules: [] })), ctx.api.get('/automations').catch(() => ({ automations: [] }))])
  const sched = s.schedules || []
  const autos = a.automations || []
  const sl = sched.map((x) => `${x.enabled === false ? '⚫' : '🟢'} ${bold(x.name || x.id)} · ${x.action || '?'}${x.target && x.target !== '*' ? ` ${x.target}` : ''} · ${code(x.cron || x.schedule || '?')}${x.last_run ? ` · last ${rel(epochOf(x.last_run))}` : ''}`)
  const al = autos.map((x) => `${x.enabled === false ? '⚫' : x.last_success === false ? '🟠' : '🟢'} ${bold(x.name)} · ${x.trigger_type || '?'}${x.trigger_value ? ` ${truncate(x.trigger_value, 24)}` : ''} → ${x.action_type || '?'}${x.action_target && x.action_target !== '*' ? ` ${x.action_target}` : ''}${x.last_run ? ` · ran ${rel(epochOf(x.last_run))}` : ''}`)
  const e = embed(ctx, {
    title: 'Schedules & automations',
    description: `${bold(plural(sched.length, 'schedule'))} · ${bold(plural(autos.length, 'automation'))}`,
    color: COLORS.info,
    fields: [
      sched.length ? { name: '⏰ Schedules', value: lines(sl) } : null,
      autos.length ? { name: '🤖 Automations', value: lines(al) } : null,
    ],
    footer: 'Run one now with /run',
  })
  return { embeds: [e], components: [row(refresh('schedules'), dashLink(ctx))] }
}

views.power = async (ctx) => {
  const p = await ctx.api.get('/power')
  if (!p.enabled) {
    return { embeds: [embed(ctx, { title: 'Power', description: `No UPS is being watched. ${p.hint || 'Set one up under Server Config → Power.'}`, color: COLORS.slate })], components: [row(refresh('power'), dashLink(ctx))] }
  }
  if (p.ok === false) {
    return { embeds: [embed(ctx, { title: 'Power', description: `⚠️ The UPS could not be read: ${p.error || 'unknown error'}`, color: COLORS.warn })], components: [row(refresh('power'))] }
  }
  const onBatt = p.on_battery === true
  const charge = p.charge ?? null
  const fields = [
    { name: 'Source', value: onBatt ? '⚡ battery' : '🔌 mains', inline: true },
    charge != null ? { name: 'Charge', value: `${bar(charge)} ${charge}%`, inline: true } : null,
    p.runtime_seconds != null ? { name: 'Runtime left', value: since(p.runtime_seconds), inline: true } : null,
    p.load != null ? { name: 'Load', value: `${bar(p.load)} ${p.load}%`, inline: true } : null,
    p.input_voltage != null ? { name: 'Input', value: `${p.input_voltage} V`, inline: true } : null,
    p.model ? { name: 'UPS', value: `${p.model}${p.source ? ` · ${p.source}` : ''}`, inline: true } : null,
    p.status ? { name: 'Status flags', value: code(p.status), inline: true } : null,
  ]
  const e = embed(ctx, { title: 'Power', description: onBatt ? `⚡ ${bold('Running on battery')}${p.low_battery ? ' — battery low, stacks stop soon' : ''}` : '🔌 On mains power', color: p.low_battery ? COLORS.bad : onBatt ? COLORS.warn : COLORS.ok, fields })
  return { embeds: [e], components: [row(refresh('power'), dashLink(ctx))] }
}

const prettyDuration = (d) => { const m = String(d || '').match(/^(?:(\d+)h)?(?:(\d+)m)?/); if (!m) return d; const h = m[1] ? `${m[1]}h` : '', mi = m[2] ? `${m[2]}m` : ''; return (h + (h && mi ? ' ' : '') + mi) || d }
views.security = async (ctx) => {
  const st = await ctx.api.get('/crowdsec/status')
  if (!st.installed || !st.running) {
    return { embeds: [embed(ctx, { title: 'Security', description: `🛡️ CrowdSec is not running. ${st.message || ''}`, color: COLORS.slate })], components: [row(refresh('security'), dashLink(ctx))] }
  }
  const dec = await ctx.api.get('/crowdsec/decisions').catch(() => ({ decisions: [] }))
  const bans = (dec.decisions || []).slice().sort((a, b) => String(b.since).localeCompare(String(a.since)))
  const flag = (cc) => (cc && /^[A-Za-z]{2}$/.test(cc) ? `:flag_${cc.toLowerCase()}:` : '')
  const ls = bans.slice(0, 15).map((d) => `🚫 ${bold(d.ip)} ${flag(d.country)} · ${String(d.scenario || '').replace(/^crowdsecurity\//, '')} · ${d.type || 'ban'} ${prettyDuration(d.duration)} left${d.origin && d.origin !== 'crowdsec' ? ` · ${d.origin}` : ''}`)
  const trusted = st.trusted || []
  const e = embed(ctx, {
    title: 'Security',
    description: `🛡️ CrowdSec is active · ${bold(plural(bans.length, 'active ban'))} · ${bold(plural(trusted.length, 'trusted address', 'trusted addresses'))}${st.client_banned ? '\n⚠️ your own address is banned — /unban it' : ''}`,
    color: bans.length ? COLORS.info : COLORS.ok,
    fields: [
      bans.length ? { name: `Active bans${bans.length > 15 ? ` (15 of ${bans.length})` : ''}`, value: lines(ls) } : null,
      trusted.length ? { name: 'Trusted (never banned)', value: truncate(trusted.map(code).join(' · '), 1024) } : null,
    ],
    footer: 'Lift a ban with /unban',
  })
  return { embeds: [e], components: [row(refresh('security'), dashLink(ctx))] }
}

views.routes = async (ctx, check = false) => {
  const r = await ctx.api.get('/routes')
  const routes = r.routes || []
  let probe = null
  if (check) probe = await ctx.api.get('/routes/health').catch(() => null)
  const health = new Map()
  for (const x of probe?.routes || probe?.results || []) health.set(x.subdomain || x.host || x.route, x)
  const status = (x) => {
    const h = health.get(x.subdomain); if (!h) return ''
    const ok = h.ok === true || h.healthy === true || (h.status >= 200 && h.status < 400) || (h.code >= 200 && h.code < 400)
    return ok ? ' · ✅' : ` · ❌${h.status || h.code ? ` ${h.status || h.code}` : ''}`
  }
  const ls = routes.map((x) => `🔗 [${x.subdomain}](https://${x.subdomain}) → ${bold(x.service)} (${x.stack})${x.conflict ? ' · ⚠️ duplicate' : ''}${status(x)}`)
  const e = embed(ctx, {
    title: `Routes · ${routes.length}`,
    description: routes.length ? `${bold(r.domain || 'domain')} · ${plural(routes.length, 'route')} through Traefik${check ? ' · probed just now' : ''}\n\n${lines(ls, 3800)}` : 'No custom routes yet. Deploy a template with HTTPS routing to create one.',
    color: routes.some((x) => x.conflict) ? COLORS.warn : COLORS.info,
  })
  return { embeds: [e], components: [row(refresh('routes'), button('nav:routes:check', 'Probe all', Style.Secondary, '🩺'), dashLink(ctx))] }
}

views.dcs = async (ctx, force = false) => {
  const [v, upd, h] = await Promise.all([
    ctx.api.get('/version').catch(() => ({})),
    (force ? ctx.api.get('/system/update/check') : ctx.api.cached('update-check', 600000, () => ctx.api.get('/system/update/check'))).catch((e) => ({ error: e.message })),
    ctx.api.get('/health').catch(() => null),
  ])
  if (force) ctx.api.invalidate('update-check')
  const apiUp = h?.api?.uptime_seconds
  const fields = [
    { name: 'Version', value: `DCS ${bold(`v${v.framework_version || ctx.version || '?'}`)} · API ${v.api_version || '?'}`, inline: true },
    { name: 'Channel', value: `${upd?.channel || '?'}${upd?.branch ? ` (${upd.branch})` : ''}`, inline: true },
    { name: 'Latest', value: upd?.error ? `⚠️ ${truncate(upd.error, 80)}` : upd?.available ? `${bold(upd.latest_name || upd.latest_version)} · ${plural(upd.commits_behind || 0, 'commit')} behind` : `${upd?.latest_name || 'up to date'} · current`, inline: true },
    { name: 'Docker', value: `${String(v.docker_version || '').replace(/^Docker version /, '').replace(/,.*$/, '') || '?'} · ${String(v.compose_version || '').replace(/^Docker Compose version /, '').replace(/[+-].*$/, '') || '?'}`, inline: true },
    upd?.restart_method ? { name: 'Restart', value: `${upd.restart_method}${upd.api_pid ? ` · pid ${upd.api_pid}` : ''}`, inline: true } : null,
    apiUp != null ? { name: 'API up', value: since(apiUp), inline: true } : null,
    upd?.ui_update?.available ? { name: 'Dashboard', value: `⬆️ a newer dashboard image is available${upd.ui_update.latest ? ` (${upd.ui_update.latest})` : ''}`, inline: false } : null,
    upd?.has_local_changes ? { name: 'Local edits', value: `${(upd.local_changes?.framework || []).length ? `framework files edited: ${upd.local_changes.framework.slice(0, 5).map(code).join(' ')}` : 'user files only'}`, inline: false } : null,
  ]
  if (upd?.available && upd.release_notes) fields.push({ name: `What's new in ${upd.latest_name || upd.latest_version}`, value: truncate(upd.release_notes.replace(/^#+\s*/gm, '').trim(), 900), inline: false })
  const e = embed(ctx, { title: 'DCS', description: upd?.available ? `⬆️ ${bold(`Update to ${upd.latest_name || upd.latest_version} available`)}` : '✅ DCS is up to date', color: upd?.available ? COLORS.warn : COLORS.ok, fields, thumbnail: ICONS.app })
  const b = [button('nav:dcs:check', 'Check again', Style.Secondary, '🔎')]
  if (ctx.isAdmin()) {
    if (upd?.available) b.push(button('act:dcs-update', `Update to ${upd.latest_name || upd.latest_version}`, Style.Primary, '⬆️'))
    b.push(button('act:dcs-restart', 'Restart API', Style.Danger, '♻️'))
  }
  return { embeds: [e], components: [row(...b, dashLink(ctx))] }
}

views.backups = async (ctx) => {
  const [l, st, cfg] = await Promise.all([ctx.api.get('/backups').catch(() => ({ backups: [] })), ctx.api.get('/backups/status').catch(() => ({})), ctx.api.get('/backups/config').catch(() => ({}))])
  const items = (l.backups || []).slice().sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0)).slice(0, 8)
  const running = st.status === 'running'
  const e = embed(ctx, {
    title: 'Backups',
    description: !cfg.configured && !items.length ? 'Backups are not configured — set a destination under Server Config → Backup.'
      : running ? `⏳ A backup is running: ${st.progress || st.stage || ''} (${st.percent ?? 0}%)`
      : st.last_backup ? `Last backup ${bold(st.last_backup.filename)} · ${st.last_backup.size} · ${rel(epochOf(st.last_backup.timestamp))}` : `${plural(items.length, 'backup')} kept in ${cfg.destination || 'the backup folder'}`,
    color: st.status === 'error' ? COLORS.bad : COLORS.violet,
    fields: items.length ? [{ name: 'Recent', value: lines(items.map((b) => `💾 ${bold(b.filename)} · ${b.size} · ${rel(b.timestamp)}`)) }] : [],
    footer: cfg.retention_count ? `keeps the last ${cfg.retention_count}` : undefined,
  })
  const b = [refresh('backups')]
  if (ctx.isAdmin() && cfg.configured && !running) b.push(button('act:backup', 'Back up now', Style.Primary, '💾'))
  return { embeds: [e], components: [row(...b, dashLink(ctx))] }
}

views.help = async (ctx) => {
  const e = embed(ctx, {
    title: 'What I can do',
    description: `Slash commands for ${bold(ctx.server)}. Buttons under a reply act on it; anything that changes the server asks you to confirm and is limited to the admins in DISCORD_ADMIN_IDS / DISCORD_ADMIN_ROLE_IDS.`,
    color: COLORS.info, thumbnail: ICONS.bot,
    fields: [
      { name: '👀 Look', value: '`/status` overview · `/usage` CPU, memory, drives · `/health` problems · `/containers [filter]` · `/stacks` · `/top` busiest containers · `/disk` drives and Docker usage · `/updates` newer images · `/routes` domains · `/power` UPS · `/security` CrowdSec bans · `/schedules` · `/audit` recent actions · `/dcs` version and updates · `/logs <target>` last log lines (only you see them)' },
      { name: '🎛️ Act', value: '`/start` · `/stop` · `/restart` a stack or a container · `/update <stack|container|all>` pull and recreate · `/container <name> [action]` and `/stack <name> [action]` with buttons · `/deploy <template> [stack]` previewed, then confirmed · `/backup` now or `list` · `/prune` · `/run <schedule>` · `/unban <ip>`' },
      { name: '💡 Tips', value: 'Names autocomplete while you type. Replies refresh with 🔄. The webhook notifications (deploys, health, updates, backups, CrowdSec) are set up on the dashboard under Notifications — the full guide is docs/DISCORD.md in the DCS repo.' },
    ],
  })
  return { embeds: [e], components: [row(button('nav:status', 'Status', Style.Primary, '🧭'), dashLink(ctx), link('Setup guide', 'https://github.com/scotthowson/dcs-orchestrator/blob/main/docs/DISCORD.md', '📖'))] }
}

// ---------------------------------------------------------------------------
// Actions (admin, confirmed where they can hurt)
// ---------------------------------------------------------------------------
function needAdmin(ctx, i) {
  if (ctx.isAdmin()) return true
  const msg = { embeds: [result(ctx, false, 'That changes the server, and your Discord account is not on the admin list.', 'Ask whoever runs DCS to add your user ID to DISCORD_ADMIN_IDS (or your role to DISCORD_ADMIN_ROLE_IDS) on the bot\'s template settings.')], ...EPH }
  if (i.deferred || i.replied) i.followUp(msg).catch(() => {})
  else i.reply(msg).catch(() => {})
  return false
}

/** Reply with a confirmation prompt; run() edits the same message with the outcome */
async function askConfirm(ctx, i, { question, label, run, note = '' }) {
  const c = confirm({ userId: i.user.id, label, run })
  const payload = { embeds: [embed(ctx, { description: `⚠️ ${question}${note ? `\n${note}` : ''}\n\n*Only you can confirm, within 60 seconds.*`, color: COLORS.warn })], components: [c.row] }
  await reply(i, payload)
}

async function containerAction(ctx, i, name, action) {
  if (action === 'logs') return sendLogs(ctx, i, 'c', name, 40)
  if (!needAdmin(ctx, i)) return
  const go = async (j) => {
    const r = await ctx.api.post(`/containers/${encodeURIComponent(name)}/${action}`)
    ctx.api.invalidate('containers')
    const view = await views.container(ctx, name).catch(() => null)
    const head = result(ctx, r.success !== false, `${{ start: 'Started', stop: 'Stopped', restart: 'Restarted', recreate: 'Recreated' }[action]} ${bold(name)}`, r.success === false ? codeBlock(r.output || 'no output', 900) : '')
    await j.editReply({ embeds: [head, ...(view?.embeds || [])], components: view?.components || [] })
  }
  if (action === 'stop' || action === 'recreate') {
    return askConfirm(ctx, i, { question: action === 'stop' ? `Stop ${bold(name)}?` : `Pull the latest image and rebuild ${bold(name)}? Its data stays; the container is replaced.`, label: action === 'stop' ? 'Stop it' : 'Recreate it', run: go })
  }
  await (i.deferred || i.replied ? Promise.resolve() : i.deferReply())
  await go(i)
}

async function stackAction(ctx, i, name, action) {
  if (action === 'logs') return sendLogs(ctx, i, 's', name, 40)
  if (!needAdmin(ctx, i)) return
  const go = async (j) => {
    await j.editReply({ embeds: [embed(ctx, { description: `⏳ ${{ start: 'Starting', stop: 'Stopping', restart: 'Restarting', update: 'Updating' }[action]} ${bold(name)}…`, color: COLORS.info })], components: [] }).catch(() => {})
    let ok = true, detail = ''
    if (action === 'update') {
      const r = await ctx.api.post(`/stacks/${encodeURIComponent(name)}/update`)
      ok = r.success !== false
      detail = r.changes_detected ? `Images changed: ${(r.changed_images || []).map(code).join(' ') || 'yes'} — those containers were recreated.` : 'Already on the newest images; nothing was recreated.'
      if (!ok) detail = codeBlock(r.output || 'no output', 900)
    } else {
      await ctx.api.post(`/stacks/${encodeURIComponent(name)}/${action}`)
      const a = await waitForStack(ctx.api, name)
      if (a.active) { ok = 'warn'; detail = 'Still running after 3 minutes — check the Stacks page for progress.' }
      else if (a.success === false) { ok = false; detail = (a.output || []).slice(-6).join('\n') ? codeBlock((a.output || []).slice(-6).join('\n'), 900) : (a.error || 'see the activity log on the Stacks page') }
    }
    ctx.api.invalidate()
    const view = await views.stack(ctx, name).catch(() => null)
    const head = result(ctx, ok, `${{ start: 'Started', stop: 'Stopped', restart: 'Restarted', update: 'Updated' }[action]} stack ${bold(name)}`, detail)
    await j.editReply({ embeds: [head, ...(view?.embeds || [])], components: view?.components || [] })
  }
  if (action === 'stop') return askConfirm(ctx, i, { question: `Stop every container in ${bold(name)}?`, label: 'Stop the stack', run: go })
  if (action === 'update') return askConfirm(ctx, i, { question: `Pull newer images for ${bold(name)} and recreate the containers that changed?`, label: 'Update it', run: go, note: 'Containers whose image did not change are left alone.' })
  await (i.deferred || i.replied ? Promise.resolve() : i.deferReply())
  await go(i)
}

async function sendLogs(ctx, i, kind, name, n) {
  const path = kind === 's' ? `/stacks/${encodeURIComponent(name)}/logs?lines=${n}` : `/containers/${encodeURIComponent(name)}/logs?lines=${n}`
  const r = await ctx.api.get(path)
  const text = String(r.logs || r.output || '').split('\n').slice(-n).join('\n')
  const payload = { content: `Last ${n} lines of ${bold(name)}:\n${codeBlock(text, 1850)}`, ...EPH }
  if (i.isButton?.()) return i.followUp(payload)
  return reply(i, payload)
}

const actions = {}

actions['restart-unhealthy'] = async (ctx, i) => {
  if (!needAdmin(ctx, i)) return
  const h = await ctx.api.get('/health')
  const bad = (h.containers || []).filter((c) => c.state === 'running' && c.health === 'unhealthy').map((c) => c.name)
  if (!bad.length) return reply(i, { embeds: [result(ctx, true, 'Nothing is unhealthy right now.')], ...EPH })
  return askConfirm(ctx, i, {
    question: `Restart ${bold(plural(bad.length, 'unhealthy container'))}: ${bad.map(bold).join(', ')}?`, label: 'Restart them',
    run: async (j) => {
      const out = []
      for (const name of bad) { const r = await ctx.api.post(`/containers/${encodeURIComponent(name)}/restart`).catch((e) => ({ success: false, output: e.message })); out.push(`${r.success === false ? '❌' : '✅'} ${bold(name)}`) }
      await sleep(4000)
      const view = await views.health(ctx)
      await j.editReply({ embeds: [embed(ctx, { description: out.join('\n'), color: COLORS.info }), ...view.embeds], components: view.components })
    },
  })
}

actions['repair-ondemand'] = async (ctx, i) => {
  if (!needAdmin(ctx, i)) return
  await i.deferUpdate?.().catch(() => {})
  const r = await ctx.api.post('/sablier/repair')
  const view = await views.health(ctx)
  await i.editReply({ embeds: [result(ctx, (r.failed || []).length ? 'warn' : true, `Recreated ${plural((r.repaired || []).length, 'on-demand container')}`, (r.failed || []).length ? (r.failed || []).join('\n') : ''), ...view.embeds], components: view.components })
}

actions['check-registry'] = async (ctx, i) => {
  await i.deferUpdate?.().catch(() => i.deferReply())
  await i.editReply({ embeds: [embed(ctx, { description: '🔎 Asking every registry for newer digests… this takes a moment.', color: COLORS.info })], components: [] }).catch(() => {})
  await ctx.api.post('/images/check-updates')
  const view = await views.updates(ctx)
  await i.editReply(view)
}

actions['update-all'] = async (ctx, i) => {
  if (!needAdmin(ctx, i)) return
  return askConfirm(ctx, i, {
    question: 'Pull newer images for **every stack** and recreate the containers that changed?', label: 'Update everything',
    note: 'Containers whose image did not change are left alone. This can take a few minutes.',
    run: async (j) => {
      await j.editReply({ embeds: [embed(ctx, { description: '⏳ Pulling and recreating across all stacks…', color: COLORS.info })], components: [] }).catch(() => {})
      const r = await ctx.api.post('/batch/update', { stacks: 'all' })
      const res = r.results || []
      const changed = res.filter((x) => x.changes_detected), failed = res.filter((x) => x.success === false)
      const ls = res.map((x) => `${x.success === false ? '❌' : x.changes_detected ? '⬆️' : '✅'} ${bold(x.stack)} · ${x.success === false ? truncate(x.message || 'failed', 60) : x.changes_detected ? 'updated' : 'already current'}`)
      ctx.api.invalidate()
      await j.editReply({ embeds: [embed(ctx, { title: 'Update everything', description: `${bold(plural(changed.length, 'stack'))} had newer images${failed.length ? `, ${bold(failed.length)} failed` : ''}.\n\n${lines(ls, 3500)}`, color: failed.length ? COLORS.bad : changed.length ? COLORS.ok : COLORS.info })], components: [row(button('nav:updates', 'Updates', Style.Secondary, '⬆️'), dashLink(ctx))] })
    },
  })
}

actions['prune'] = async (ctx, i) => {
  if (!needAdmin(ctx, i)) return
  return askConfirm(ctx, i, {
    question: 'Remove stopped containers, dangling images and unused networks?', label: 'Prune',
    note: 'Volumes are never touched, and on-demand (sleeping) containers are kept.',
    run: async (j) => {
      const r = await ctx.api.post('/maintenance/prune')
      const reclaimed = [...String(r.output || '').matchAll(/Total reclaimed space:\s*(.+)/g)].map((m) => m[1].trim())
      const view = await views.disk(ctx)
      await j.editReply({ embeds: [result(ctx, r.success !== false, r.success === false ? 'Prune failed' : `Pruned${reclaimed.length ? ` · reclaimed ${reclaimed.join(' + ')}` : ''}`, r.success === false ? codeBlock(r.output || '', 900) : ''), ...view.embeds], components: view.components })
    },
  })
}

actions['backup'] = async (ctx, i, stack = '') => {
  if (!needAdmin(ctx, i)) return
  await (i.isButton?.() ? i.deferUpdate().catch(() => {}) : (i.deferred || i.replied ? Promise.resolve() : i.deferReply()))
  const start = await ctx.api.post('/backups/trigger', stack ? { stack } : {})
  await i.editReply({ embeds: [embed(ctx, { description: `⏳ Backing up${stack ? ` ${bold(stack)}` : ''} → ${code(start.filename || 'archive')}…`, color: COLORS.violet })], components: [] })
  const t0 = Date.now()
  let st = {}
  while (Date.now() - t0 < 600000) {
    await sleep(5000)
    st = await ctx.api.get('/backups/status').catch(() => ({}))
    if (st.status !== 'running') break
    await i.editReply({ embeds: [embed(ctx, { description: `⏳ ${st.progress || st.stage || 'working'} ${bar(st.percent || 0)} ${st.percent || 0}%`, color: COLORS.violet })] }).catch(() => {})
  }
  const view = await views.backups(ctx)
  const ok = st.status === 'idle' && st.last_backup
  await i.editReply({ embeds: [result(ctx, ok ? true : st.status === 'running' ? 'warn' : false, ok ? `Backup done: ${bold(st.last_backup.filename)} (${st.last_backup.size})` : st.status === 'running' ? 'Still running after 10 minutes — the Backup page shows progress.' : `Backup failed: ${st.error || 'unknown error'}`), ...view.embeds], components: view.components })
}

actions['dcs-update'] = async (ctx, i) => {
  if (!needAdmin(ctx, i)) return
  const upd = await ctx.api.get('/system/update/check')
  if (!upd.available) return reply(i, { embeds: [result(ctx, true, 'DCS is already up to date.')], ...EPH })
  const conflicts = upd.local_changes?.conflicts || []
  if (conflicts.length) return reply(i, { embeds: [result(ctx, 'warn', 'This update needs a decision about edited framework files.', `Edited on the server: ${conflicts.slice(0, 6).map(code).join(' ')}\nApply it from the dashboard's Updates page, where you can keep or replace them.`)], ...EPH })
  return askConfirm(ctx, i, {
    question: `Update DCS ${bold(`v${upd.current_version}`)} → ${bold(upd.latest_name || upd.latest_version)} and restart the API?`, label: 'Update DCS',
    note: 'Your stacks, templates and accounts are kept; a backup tag allows a rollback from the Updates page.',
    run: async (j) => {
      await j.editReply({ embeds: [embed(ctx, { description: '⏳ Updating and restarting the API…', color: COLORS.info })], components: [] }).catch(() => {})
      const r = await ctx.api.post('/system/update/apply', { confirm: true, restart: true })
      const t0 = Date.now()
      let v = null
      while (Date.now() - t0 < 120000) { await sleep(5000); v = await ctx.api.get('/version').catch(() => null); if (v?.framework_version && v.framework_version !== upd.current_version) break }
      ctx.api.invalidate()
      const view = await views.dcs(ctx, true).catch(() => null)
      const ok = v?.framework_version && v.framework_version !== upd.current_version
      await j.editReply({ embeds: [result(ctx, ok ? true : 'warn', ok ? `DCS is now ${bold(`v${v.framework_version}`)}` : `Update applied (${r.message || r.state || 'done'}), but the API has not come back with the new version yet — check the Updates page.`), ...(view?.embeds || [])], components: view?.components || [] })
    },
  })
}

actions['dcs-restart'] = async (ctx, i) => {
  if (!needAdmin(ctx, i)) return
  return askConfirm(ctx, i, {
    question: 'Restart the DCS API? Dashboard sessions stay signed in; requests pause for a few seconds.', label: 'Restart API',
    run: async (j) => {
      const r = await ctx.api.post('/system/restart').catch((e) => ({ restarting: false, hint: e.message }))
      if (!r.restarting) return j.editReply({ embeds: [result(ctx, 'warn', 'The API cannot restart itself from here.', r.hint || '')], components: [] })
      await j.editReply({ embeds: [embed(ctx, { description: `⏳ Restarting (${r.method}), back in about ${r.eta_seconds || 5} s…`, color: COLORS.info })], components: [] }).catch(() => {})
      await sleep((r.eta_seconds || 5) * 1000 + 2000)
      let ok = false
      for (let n = 0; n < 12 && !ok; n++) { ok = !!(await ctx.api.get('/version').catch(() => null)); if (!ok) await sleep(2500) }
      const view = ok ? await views.dcs(ctx).catch(() => null) : null
      await j.editReply({ embeds: [result(ctx, ok, ok ? 'The API is back.' : 'The API has not answered yet — give it a minute, then /dcs.'), ...(view?.embeds || [])], components: view?.components || [] })
    },
  })
}

// ---------------------------------------------------------------------------
// Command handlers
// ---------------------------------------------------------------------------
export const handlers = {
  status: (ctx, i) => sendView(ctx, i, 'status'),
  vms: (ctx, i) => sendView(ctx, i, 'vms'),
  fleet: (ctx, i) => sendView(ctx, i, 'fleet'),
  vm: (ctx, i) => vmAction(ctx, i, i.options.getString('vm'), i.options.getString('action')),
  usage: (ctx, i) => sendView(ctx, i, 'usage'),
  health: (ctx, i) => sendView(ctx, i, 'health'),
  containers: (ctx, i) => sendView(ctx, i, 'containers', i.options.getString('filter') || '', i.options.getString('show') || ''),
  stacks: (ctx, i) => sendView(ctx, i, 'stacks'),
  top: (ctx, i) => sendView(ctx, i, 'top'),
  disk: (ctx, i) => sendView(ctx, i, 'disk'),
  updates: (ctx, i) => sendView(ctx, i, 'updates'),
  audit: (ctx, i) => sendView(ctx, i, 'audit', i.options.getInteger('count') || 12),
  schedules: (ctx, i) => sendView(ctx, i, 'schedules'),
  power: (ctx, i) => sendView(ctx, i, 'power'),
  security: (ctx, i) => sendView(ctx, i, 'security'),
  routes: (ctx, i) => sendView(ctx, i, 'routes', i.options.getBoolean('check') === true),
  help: (ctx, i) => sendView(ctx, i, 'help'),

  async logs(ctx, i) {
    const t = await resolveTarget(ctx.api, i.options.getString('target'))
    if (t.kind === 'all') throw new ApiError('Pick one stack or container for logs.')
    return sendLogs(ctx, i, t.kind, t.name, i.options.getInteger('lines') || 40)
  },
  async container(ctx, i) {
    const name = i.options.getString('name'), action = i.options.getString('action') || 'info'
    if (action === 'info') return sendView(ctx, i, 'container', name)
    return containerAction(ctx, i, name, action)
  },
  async stack(ctx, i) {
    const name = i.options.getString('name'), action = i.options.getString('action') || 'info'
    if (action === 'info') return sendView(ctx, i, 'stack', name)
    return stackAction(ctx, i, name, action)
  },
  async start(ctx, i) { const t = await resolveTarget(ctx.api, i.options.getString('target')); return t.kind === 's' ? stackAction(ctx, i, t.name, 'start') : containerAction(ctx, i, t.name, 'start') },
  async stop(ctx, i) { const t = await resolveTarget(ctx.api, i.options.getString('target')); return t.kind === 's' ? stackAction(ctx, i, t.name, 'stop') : containerAction(ctx, i, t.name, 'stop') },
  async restart(ctx, i) { const t = await resolveTarget(ctx.api, i.options.getString('target')); return t.kind === 's' ? stackAction(ctx, i, t.name, 'restart') : containerAction(ctx, i, t.name, 'restart') },
  async update(ctx, i) {
    const t = await resolveTarget(ctx.api, i.options.getString('target'))
    if (t.kind === 'all') return actions['update-all'](ctx, i)
    return t.kind === 's' ? stackAction(ctx, i, t.name, 'update') : containerAction(ctx, i, t.name, 'recreate')
  },
  async deploy(ctx, i) {
    if (!needAdmin(ctx, i)) return
    const name = i.options.getString('template')
    await i.deferReply()
    const templates = await ctx.api.names.templates()
    const tpl = templates.find((t) => t.name === name) || templates.find((t) => t.name.toLowerCase() === name.toLowerCase()) || templates.find((t) => (t.title || '').toLowerCase() === name.toLowerCase())
    if (!tpl) throw new ApiError(`No template called "${name}". Start typing and pick one from the list.`)
    const stack = i.options.getString('stack') || tpl.target_stack
    const dry = await ctx.api.post(`/templates/${encodeURIComponent(tpl.name)}/dry-run`, { target_stack: stack })
    const problems = []
    if (dry.has_missing_vars) problems.push(`needs values for ${String(dry.missing_required_vars || '').split(/[,\s]+/).filter(Boolean).map(code).join(' ')} — deploy it from the dashboard's Templates page to fill them in`)
    if (dry.has_service_conflicts) problems.push(`service already in the stack: ${dry.service_conflicts}`)
    if (dry.has_singleton_conflict) problems.push(dry.singleton_conflict || 'this template can only be deployed once')
    const warnings = []
    if (dry.has_port_conflicts) warnings.push(`port in use: ${dry.port_conflicts}`)
    if (Array.isArray(dry.security_warnings) && dry.security_warnings.length) warnings.push(...dry.security_warnings.slice(0, 3).map(String))
    if (Array.isArray(dry.policy_findings) && dry.policy_findings.length) warnings.push(...dry.policy_findings.slice(0, 3).map((p) => p.message || p.title || String(p)))
    const fields = [
      { name: 'Template', value: `${tpl.icon || ''} ${bold(tpl.title || tpl.name)} · ${tpl.category || ''}`, inline: true },
      { name: 'Into stack', value: bold(stack), inline: true },
      { name: 'Services', value: (dry.services || []).map(code).join(' ') || '—', inline: true },
      warnings.length ? { name: '⚠️ Heads-up', value: lines(warnings.map((w) => `• ${w}`)) } : null,
      dry.compose_preview ? { name: 'Compose to be added', value: codeBlock(dry.compose_preview, 900, 'yaml') } : null,
    ]
    if (problems.length) {
      return i.editReply({ embeds: [embed(ctx, { title: `Deploy ${tpl.title || tpl.name}`, description: `❌ Not from here: ${problems.join('; ')}.`, color: COLORS.bad, fields: fields.slice(0, 3) })] })
    }
    const c = confirm({
      userId: i.user.id, label: `Deploy ${tpl.title || tpl.name}`, danger: false,
      run: async (j) => {
        await j.editReply({ embeds: [embed(ctx, { description: `🚀 Deploying ${bold(tpl.title || tpl.name)} into ${bold(stack)}…`, color: COLORS.info })], components: [] }).catch(() => {})
        const r = await ctx.api.post(`/templates/${encodeURIComponent(tpl.name)}/deploy`, { target_stack: stack, auto_start: true })
        const a = await waitForStack(ctx.api, stack, { timeoutMs: 300000 })
        ctx.api.invalidate()
        const ok = a.active ? 'warn' : a.success !== false
        const view = await views.stack(ctx, stack).catch(() => null)
        await j.editReply({ embeds: [result(ctx, ok, ok === true ? `${bold(tpl.title || tpl.name)} is deployed into ${bold(stack)}` : ok === 'warn' ? 'Deploy is still running — the Stacks page shows its progress.' : 'The deploy ran into trouble', ok === true ? `services added: ${(r.services_added || []).map(code).join(' ') || '—'}${(r.on_demand || []).length ? ` · on demand: ${r.on_demand.join(', ')}` : ''}` : ok === false ? (a.error || (a.output || []).slice(-6).join('\n') ? codeBlock((a.output || []).slice(-6).join('\n') || a.error, 900) : '') : ''), ...(view?.embeds || [])], components: view?.components || [] })
      },
    })
    await i.editReply({ embeds: [embed(ctx, { title: `Deploy ${tpl.title || tpl.name}?`, description: `${truncate(tpl.description || '', 300)}\n\n*Only you can confirm, within 60 seconds.*`, color: warnings.length ? COLORS.warn : COLORS.info, fields })], components: [c.row] })
  },
  async backup(ctx, i) {
    if (i.options.getBoolean('list')) return sendView(ctx, i, 'backups')
    return actions.backup(ctx, i, i.options.getString('stack') || '')
  },
  prune: (ctx, i) => actions.prune(ctx, i),
  async run(ctx, i) {
    if (!needAdmin(ctx, i)) return
    const pick = i.options.getString('schedule')
    const scheds = await ctx.api.names.schedules()
    const s = scheds.find((x) => x.id === pick) || scheds.find((x) => (x.name || '').toLowerCase() === pick.toLowerCase())
    if (!s) throw new ApiError(`No schedule called "${pick}".`)
    await i.deferReply()
    const r = await ctx.api.post(`/schedules/${encodeURIComponent(s.id)}/run`)
    await i.editReply({ embeds: [result(ctx, r.success !== false, `Ran ${bold(s.name || s.id)}`, truncate(r.message || r.output || '', 900))] })
  },
  async unban(ctx, i) {
    if (!needAdmin(ctx, i)) return
    const ip = i.options.getString('ip').trim()
    if (!/^[0-9a-fA-F:.\/]+$/.test(ip)) throw new ApiError('That does not look like an IP address.')
    await i.deferReply()
    const r = await ctx.api.del(`/crowdsec/decisions/${encodeURIComponent(ip)}`)
    ctx.api.invalidate('decisions')
    await i.editReply({ embeds: [result(ctx, r.success !== false, `Unbanned ${bold(ip)}`, truncate(r.message || '', 300))] })
  },
  async dcs(ctx, i) {
    const action = i.options.getString('action') || 'info'
    if (action === 'info') return sendView(ctx, i, 'dcs')
    if (action === 'check') return sendView(ctx, i, 'dcs', true)
    if (action === 'update') return actions['dcs-update'](ctx, i)
    if (action === 'restart') return actions['dcs-restart'](ctx, i)
  },
}

async function sendView(ctx, i, view, ...args) {
  if (!i.deferred && !i.replied) await i.deferReply()
  const payload = await views[view](ctx, ...args)
  await i.editReply(payload)
}

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------
export async function handleButton(ctx, i) {
  const id = i.customId
  if (id.startsWith('nav:')) {
    const [, view, ...rest] = id.split(':')
    const arg = rest.join(':')
    if (!views[view]) return i.deferUpdate()
    await i.deferUpdate().catch(() => {})
    const payload = view === 'routes' ? await views.routes(ctx, arg === 'check') : view === 'dcs' ? await views.dcs(ctx, arg === 'check') : view === 'vm' ? await views.vm(ctx, arg) : await views[view](ctx, arg || undefined)
    return i.editReply(payload)
  }
  if (id.startsWith('act:')) {
    const parts = id.split(':')
    if (parts[1] === 'c' || parts[1] === 's') {
      const kind = parts[1], action = parts[2], name = parts.slice(3).join(':')
      if (action === 'logs') return sendLogs(ctx, i, kind, name, 40)
      if (kind === 'c') return containerAction(ctx, i, name, action)
      return stackAction(ctx, i, name, action)
    }
    if (parts[1] === 'vm') {
      const action = parts[2], ref = parts.slice(3).join(':')
      return vmAction(ctx, i, ref, action)
    }
    const fn = actions[parts[1]]
    if (!fn) return i.deferUpdate()
    return fn(ctx, i)
  }
  return i.deferUpdate()
}

// ---------------------------------------------------------------------------
// Autocomplete
// ---------------------------------------------------------------------------
export async function autocomplete(ctx, i) {
  const focused = i.options.getFocused(true)
  const q = String(focused.value || '').toLowerCase()
  const match = (n) => n.toLowerCase().includes(q)
  const rank = (a, b) => (a.toLowerCase().startsWith(q) === b.toLowerCase().startsWith(q) ? a.localeCompare(b) : a.toLowerCase().startsWith(q) ? -1 : 1)
  let choices = []
  const cmdName = i.commandName
  if (focused.name === 'target') {
    const [stacks, containers] = await Promise.all([ctx.api.names.stacks(), ctx.api.names.containers()])
    if (cmdName === 'update' && 'all'.includes(q)) choices.push({ name: '🌐 all stacks', value: 'all' })
    choices.push(...stacks.map((s) => s.name).filter(match).sort(rank).map((n) => ({ name: `📦 ${n} (stack)`, value: `s:${n}` })))
    choices.push(...containers.map((c) => c.name).filter(match).sort(rank).map((n) => ({ name: `🐳 ${n}`, value: `c:${n}` })))
  } else if (focused.name === 'name' && cmdName === 'stack' || focused.name === 'stack') {
    choices = (await ctx.api.names.stacks()).map((s) => s.name).filter(match).sort(rank).map((n) => ({ name: n, value: n }))
  } else if (focused.name === 'name') {
    choices = (await ctx.api.names.containers()).map((c) => c.name).filter(match).sort(rank).map((n) => ({ name: n, value: n }))
  } else if (focused.name === 'template') {
    choices = (await ctx.api.names.templates()).filter((t) => match(t.name) || match(t.title || '')).sort((a, b) => rank(a.name, b.name)).map((t) => ({ name: truncate(`${t.title || t.name} · ${t.name}`, 100), value: t.name }))
  } else if (focused.name === 'schedule') {
    choices = (await ctx.api.names.schedules()).filter((s) => match(s.name || s.id)).map((s) => ({ name: truncate(`${s.name || s.id} · ${s.action || ''}`, 100), value: s.id }))
  } else if (focused.name === 'vm') {
    choices = (await ctx.api.names.vms()).filter((v) => match(v.name) || String(v.vmid).includes(q)).sort((a, b) => rank(a.name, b.name))
      .map((v) => ({ name: truncate(`${v.status === 'running' ? '🟢' : '⚫'} ${v.name} · ${v.type === 'lxc' ? 'LXC' : 'VM'} ${v.vmid} · ${v.node}`, 100), value: `${v.node}/${v.type}/${v.vmid}` }))
  } else if (focused.name === 'ip') {
    choices = (await ctx.api.names.decisions()).map((d) => d.ip).filter((v, idx, a) => v && a.indexOf(v) === idx && match(v)).map((v) => ({ name: v, value: v }))
  }
  return i.respond(choices.slice(0, 25))
}

// ---------------------------------------------------------------------------
// Presence: the bot's status line mirrors the server
// ---------------------------------------------------------------------------
export async function presence(ctx) {
  const h = await ctx.api.get('/health')
  const s = h.summary || {}
  const unhealthy = s.unhealthy ?? 0, running = (s.total ?? 0) - (s.stopped ?? 0) - (s.sleeping ?? 0)
  if (unhealthy > 0) return { text: `${plural(unhealthy, 'container')} unhealthy · /health`, status: 'dnd' }
  if ((s.stopped ?? 0) > 0) return { text: `${running} running · ${s.stopped} stopped · /status`, status: 'idle' }
  return { text: `${running} containers · all healthy · /status`, status: 'online' }
}
