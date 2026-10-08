// =============================================================================
// The Discord tab's model: the form the person edits, the rules the API
// checks (mirrored here so a mistake is shown next to the field, the server
// still has the last word), the difference between two settings (only what
// was changed is sent), the words for the samples and the colours, and the
// draft that survives a switch to another tab.
// =============================================================================

import type { CrowdSecMessageField, CrowdSecNotifySettings, CrowdSecPlaceholder, DiscordWebhookPayload } from '../../../shared/types'

export type Settings = CrowdSecNotifySettings
export type WebhookMode = Settings['webhook']['mode']
export type MentionMode = Settings['mention']['mode']
export type ColorMode = Settings['embed']['color_mode']
export type GroupBy = NonNullable<Settings['delivery']['group_by']>
export type Limits = { title: number; description: number; footer: number; fields: number; group_threshold_max: number }

/** the numbers the API checks that GET /crowdsec/notifications does not list (they live in _CS_JQ_NOTIFY_VALIDATE) */
export const LIM = { name: 80, avatar: 300, mentionText: 300, link: 300, fieldName: 100, fieldValue: 500, list: 20 } as const
export const NUM = {
  minEvents: { min: 0, max: 1000 },
  groupWait: { min: 1, max: 600 },
  groupThreshold: { min: 1, max: 100 },
  maxRetry: { min: 0, max: 10 },
  timeout: { min: 1, max: 60 },
} as const

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

export interface FormField { key: number; name: string; value: string; inline: boolean }
export interface NotifyForm {
  enabled: boolean
  mode: WebhookMode
  name: string
  avatar: string
  colorMode: ColorMode
  color: string
  mention: MentionMode
  mentionId: string
  mentionText: string
  bans: boolean
  simulated: boolean
  detectOnly: boolean
  minEvents: string
  only: string[]
  ignore: string[]
  /** undefined: the server has no such setting (older than the grouped messages) */
  groupBy: GroupBy | undefined
  groupWait: string
  groupThreshold: string
  maxRetry: string
  timeout: string
  title: string
  description: string
  footer: string
  link: string
  timestamp: boolean
  fields: FormField[]
}

let keySeq = 1
export const newFieldKey = (): number => keySeq++

export function toForm(s: Settings): NotifyForm {
  return {
    enabled: s.enabled,
    mode: s.webhook.mode,
    name: s.identity.name,
    avatar: s.identity.avatar_url,
    colorMode: s.embed.color_mode,
    color: s.embed.color,
    mention: s.mention.mode,
    mentionId: s.mention.id,
    mentionText: s.mention.text,
    bans: s.events.bans,
    simulated: s.events.simulated,
    detectOnly: s.events.detect_only,
    minEvents: String(s.filters.min_events),
    only: [...s.filters.only],
    ignore: [...s.filters.ignore],
    groupBy: s.delivery.group_by,
    groupWait: String(s.delivery.group_wait),
    groupThreshold: String(s.delivery.group_threshold),
    maxRetry: String(s.delivery.max_retry),
    timeout: String(s.delivery.timeout),
    title: s.message.title,
    description: s.message.description,
    footer: s.message.footer,
    link: s.message.link,
    timestamp: s.message.timestamp,
    fields: s.message.fields.map((f) => ({ key: newFieldKey(), name: f.name, value: f.value, inline: f.inline })),
  }
}

/** a whole number, or NaN (which never equals anything, so a half-typed number always counts as a change) */
const whole = (v: string): number => (/^\s*\d{1,9}\s*$/.test(v) ? Number(v) : NaN)
const uniqSorted = (l: string[]): string[] => [...new Set(l)].sort()

/** the settings the form stands for, in the shape the API keeps them (normalised the way the API normalises) */
export function settingsOf(f: NotifyForm, v = 1): Settings {
  const withId = f.mention === 'role' || f.mention === 'user'
  return {
    v,
    enabled: f.enabled,
    webhook: { mode: f.mode },
    identity: { name: f.name, avatar_url: f.avatar },
    embed: { color_mode: f.colorMode, color: f.color.toLowerCase() },
    mention: { mode: f.mention, id: withId ? f.mentionId.trim() : '', text: f.mentionText },
    events: { bans: f.bans, simulated: f.simulated, detect_only: f.detectOnly },
    filters: { min_events: whole(f.minEvents), only: uniqSorted(f.only), ignore: uniqSorted(f.ignore) },
    delivery: { ...(f.groupBy ? { group_by: f.groupBy } : {}), group_wait: whole(f.groupWait), group_threshold: whole(f.groupThreshold), max_retry: whole(f.maxRetry), timeout: whole(f.timeout) },
    message: {
      title: f.title,
      description: f.description,
      footer: f.footer,
      link: f.link,
      timestamp: f.timestamp,
      fields: f.fields.map<CrowdSecMessageField>((x) => ({ name: x.name, value: x.value, inline: x.inline })),
    },
  }
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  const ka = Object.keys(a as object), kb = Object.keys(b as object)
  return ka.length === kb.length && ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x)

/** what changed from `base` to `next`, as the smallest patch the API merges (lists are replaced whole), or undefined when nothing did */
export function diffPatch(base: unknown, next: unknown): unknown {
  if (deepEqual(base, next)) return undefined
  if (isObj(base) && isObj(next)) {
    const out: Record<string, unknown> = {}
    for (const k of Object.keys(next)) {
      const d = diffPatch(base[k], next[k])
      if (d !== undefined) out[k] = d
    }
    return Object.keys(out).length ? out : undefined
  }
  return next
}

/** the changes of a patch in a few words, for the bar at the bottom ("Title, Colour, Fields") */
export function describeChanges(patch: unknown, extra: string[] = []): string[] {
  const out: string[] = []
  const add = (s: string) => { if (!out.includes(s)) out.push(s) }
  const p = (isObj(patch) ? patch : {}) as Record<string, Record<string, unknown> | boolean | undefined>
  const has = (sec: string, key?: string) => {
    const v = p[sec]
    if (v === undefined) return false
    if (!key) return true
    return isObj(v) && key in v
  }
  if ('enabled' in p) add(p.enabled ? 'Turned on' : 'Turned off')
  if (has('webhook')) add('Webhook source')
  if (has('identity', 'name')) add('Sender name')
  if (has('identity', 'avatar_url')) add('Avatar')
  if (has('embed')) add('Colour')
  if (has('mention')) add('Mention')
  if (has('events')) add('Events')
  if (has('filters', 'min_events')) add('Minimum events')
  if (has('filters', 'only')) add('Only these scenarios')
  if (has('filters', 'ignore')) add('Ignored scenarios')
  if (has('delivery')) add('Delivery')
  if (has('message', 'title')) add('Title')
  if (has('message', 'description')) add('Description')
  if (has('message', 'footer')) add('Footer')
  if (has('message', 'link')) add('Link')
  if (has('message', 'timestamp')) add('Timestamp')
  if (has('message', 'fields')) add('Fields')
  for (const x of extra) add(x)
  return out
}

// ---------------------------------------------------------------------------
// The rules (the same ones the API applies, in the same words where they read well)
// ---------------------------------------------------------------------------

const CTRL_ONE = /[\x00-\x1f\x7f]/
const CTRL_MULTI = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/
/** characters the way the API counts them (code points, not UTF-16 units) */
export const cpLen = (s: string): number => Array.from(s).length

export function unknownPlaceholder(text: string, known: Set<string> | null): string | null {
  if (!known) return null
  for (const m of text.matchAll(/\{([A-Za-z0-9_]+)\}/g)) if (!known.has(m[1])) return m[1]
  return null
}

export const PATTERN_OK = /^[A-Za-z0-9][A-Za-z0-9._/@:+-]{0,119}\*?$/
export function patternProblem(p: string): string | null {
  return PATTERN_OK.test(p) ? null : `"${p.length > 40 ? `${p.slice(0, 40)}…` : p}" is not a scenario name. Use a name such as crowdsecurity/ssh-bf or a prefix such as crowdsecurity/ssh*`
}

export type Errors = Record<string, string>

function textRule(v: string, what: string, max: number, multi: boolean, known: Set<string> | null, placeholders = true): string | null {
  if (CTRL_ONE.test(v) && !multi) return `${what} must be a single line without control characters`
  if (multi && CTRL_MULTI.test(v)) return `${what} must not contain control characters`
  if (cpLen(v) > max) return `${what} is too long (${max} characters at most)`
  if (placeholders) {
    const u = unknownPlaceholder(v, known)
    if (u) return `${what} uses {${u}}, which is not a placeholder. Pick one from the list.`
  }
  return null
}

function numRule(v: string, what: string, r: { min: number; max: number }): string | null {
  const n = whole(v)
  return Number.isFinite(n) && n >= r.min && n <= r.max ? null : `${what} must be a whole number from ${r.min} to ${r.max}`
}

export function validateForm(f: NotifyForm, known: Set<string> | null, limits: Limits): Errors {
  const e: Errors = {}
  const put = (k: string, m: string | null) => { if (m && !e[k]) e[k] = m }
  // who sends it
  put('name', textRule(f.name, 'The sender name', LIM.name, false, known, false))
  if (!e.name) {
    if (f.name.length === 0) e.name = 'The sender name is empty'
    else if (/discord|clyde|[@#:]|```/i.test(f.name)) e.name = 'Discord refuses sender names that contain "discord", "clyde", @, # or :'
  }
  if (f.avatar !== '' && !/^https:\/\/[^\s"\\<>]{1,300}$/.test(f.avatar)) e.avatar = 'The avatar must be an https:// address (or empty)'
  if (!/^#[0-9a-fA-F]{6}$/.test(f.color)) e.color = 'The colour must look like #e11d48'
  if ((f.mention === 'role' || f.mention === 'user') && !/^[0-9]{15,21}$/.test(f.mentionId.trim())) e.mentionId = 'The id is the long number Discord shows in developer mode (usually 17 to 19 digits)'
  put('mentionText', textRule(f.mentionText, 'The text next to the mention', LIM.mentionText, true, known, false))
  // what triggers it
  put('minEvents', numRule(f.minEvents, 'The minimum number of events', NUM.minEvents))
  for (const key of ['only', 'ignore'] as const) {
    const list = f[key]
    if (list.length > LIM.list) e[key] = `The scenario lists take up to ${LIM.list} names`
    else {
      const bad = list.map(patternProblem).find((x) => x)
      if (bad) e[key] = bad
    }
  }
  // delivery
  put('groupWait', numRule(f.groupWait, 'The grouping wait (seconds)', NUM.groupWait))
  put('groupThreshold', numRule(f.groupThreshold, 'The number of alerts in one message', { min: 1, max: limits.group_threshold_max }))
  put('maxRetry', numRule(f.maxRetry, 'The number of retries', NUM.maxRetry))
  put('timeout', numRule(f.timeout, 'The request timeout (seconds)', NUM.timeout))
  // the message
  put('title', textRule(f.title, 'The title', limits.title, false, known))
  put('description', textRule(f.description, 'The description', limits.description, true, known))
  put('footer', textRule(f.footer, 'The footer', limits.footer, false, known))
  put('link', textRule(f.link, 'The title link', LIM.link, false, known))
  if (f.fields.length > limits.fields) e.fields = `A message has up to ${limits.fields} fields`
  f.fields.forEach((x, i) => {
    put(`field.${i}.name`, textRule(x.name, `Field ${i + 1} name`, LIM.fieldName, false, known))
    put(`field.${i}.value`, textRule(x.value, `Field ${i + 1} value`, LIM.fieldValue, true, known))
    if (!e[`field.${i}.name`] && x.name.length === 0) e[`field.${i}.name`] = `Field ${i + 1} needs a name`
    if (!e[`field.${i}.value`] && x.value.length === 0) e[`field.${i}.value`] = `Field ${i + 1} needs a value`
  })
  if (f.title.length === 0 && f.description.length === 0 && f.fields.length === 0) e.message = 'The message would be empty: give it a title, a description or a field'
  return e
}

/** which section of the editor a problem belongs to */
export function sectionOfError(key: string): 'webhook' | 'appearance' | 'triggers' | 'message' | 'delivery' {
  if (key === 'webhook') return 'webhook'
  if (['name', 'avatar', 'color', 'mentionId', 'mentionText'].includes(key)) return 'appearance'
  if (['minEvents', 'only', 'ignore'].includes(key)) return 'triggers'
  if (['groupWait', 'groupThreshold', 'maxRetry', 'timeout'].includes(key)) return 'delivery'
  return 'message'
}

const WEBHOOK_HOSTS = ['discord.com', 'discordapp.com', 'ptb.discord.com', 'canary.discord.com']
/** null = fine (or empty); otherwise what is wrong with the address, in words */
export function webhookProblem(raw: string): string | null {
  const u = raw.trim()
  if (!u) return null
  if (/\s/.test(u)) return 'The address must not contain spaces'
  if (!u.startsWith('https://')) return 'A webhook address starts with https://'
  if (/[?#]/.test(u) || u.endsWith('/')) return 'Remove everything after the token: no "?" part and no trailing "/"'
  const m = /^https:\/\/([A-Za-z0-9.]+)\/api\/webhooks\/([0-9]{5,25})\/([A-Za-z0-9_-]{10,200})$/.exec(u)
  if (!m) return 'That is not a Discord webhook address. It looks like https://discord.com/api/webhooks/<id>/<token>'
  if (!WEBHOOK_HOSTS.includes(m[1])) return 'Only discord.com, discordapp.com, ptb.discord.com and canary.discord.com webhooks are accepted'
  return null
}

/** a webhook address that slipped into a message (CrowdSec's own errors quote the address they posted to) loses its token */
export function redact(text: string): string {
  return text.replace(/(\/api\/webhooks\/\d+\/)[A-Za-z0-9_-]+/g, '$1••••')
}

// ---------------------------------------------------------------------------
// Words: the samples and the colours
// ---------------------------------------------------------------------------

export const SAMPLE_INFO: Record<string, { label: string; hint: string }> = {
  burst: { label: 'Burst from one address', hint: 'One scanner firing 47 alerts in 7 seconds: one block that counts what it tried' },
  crowd: { label: 'Three addresses at once', hint: 'Three attackers in the same batch: one block each' },
  probe: { label: 'Web probing', hint: 'A scanner looking for weak spots on your websites' },
  ssh: { label: 'SSH brute force', hint: 'Repeated SSH logins guessing a password' },
  exploit: { label: 'Exploit attempt', hint: 'A request for a known vulnerable path' },
  manual: { label: 'Manual ban', hint: 'An address banned by hand from DCS' },
  simulated: { label: 'Simulated ban', hint: 'A scenario in simulation mode: an alert, but nothing is banned' },
}
const SAMPLE_ORDER = ['burst', 'crowd', 'probe', 'ssh', 'exploit', 'manual', 'simulated']
export const sampleLabel = (s: string): string => SAMPLE_INFO[s]?.label ?? (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)
export function orderSamples(list: string[]): string[] {
  return [...list].sort((a, b) => {
    const ia = SAMPLE_ORDER.indexOf(a), ib = SAMPLE_ORDER.indexOf(b)
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b)
  })
}

export const intToHex = (n: number): string => `#${Math.max(0, Math.min(0xffffff, Math.round(n))).toString(16).padStart(6, '0')}`
export const hexToInt = (h: string): number => parseInt(h.replace('#', ''), 16)
/** the colours "automatic" picks: by the kind of attack (the numbers are the ones in the API's template) */
export const AUTO_COLORS: { label: string; hex: string }[] = [
  { label: 'Brute force and anything else', hex: intToHex(15942494) },
  { label: 'Exploits', hex: intToHex(10979578) },
  { label: 'Probing', hex: intToHex(16098851) },
  { label: 'Captcha decisions', hex: intToHex(2282478) },
]
export const COLOR_PRESETS: { label: string; hex: string }[] = [
  { label: 'Rose', hex: '#e11d48' },
  { label: 'Amber', hex: '#f59e0b' },
  { label: 'Violet', hex: '#a78bfa' },
  { label: 'Cyan', hex: '#22d3ee' },
  { label: 'Emerald', hex: '#34d399' },
  { label: 'Discord blue', hex: '#5865f2' },
  { label: 'Slate', hex: '#94a3b8' },
]

export function mentionTag(m: Settings['mention']): string {
  const tag = m.mode === 'role' ? `<@&${m.id}>` : m.mode === 'user' ? `<@${m.id}>` : m.mode === 'here' ? '@here' : m.mode === 'everyone' ? '@everyone' : ''
  return [tag, m.text].filter((x) => x.length > 0).join(' ')
}

/**
 * The message drawn on this side, from the examples the API lists for the placeholders. Only for a person who may not ask the server
 * for a preview (a viewer): it uses one example alert, so it is an approximation and the panel says so.
 */
export function approximatePayload(s: Settings, placeholders: CrowdSecPlaceholder[]): DiscordWebhookPayload {
  const vals: Record<string, string> = {}
  for (const p of placeholders) vals[p.name] = p.example
  const fill = (t: string) => t.replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in vals ? vals[k] : m))
  const fields = s.message.fields
    .map((f) => ({ name: fill(f.name), value: fill(f.value), inline: f.inline }))
    .filter((f) => f.name.trim() !== '' && f.value.trim() !== '')
  const link = fill(s.message.link), footer = fill(s.message.footer)
  const content = mentionTag(s.mention)
  const embed: DiscordWebhookPayload['embeds'][number] = {
    title: fill(s.message.title),
    color: s.embed.color_mode === 'fixed' ? hexToInt(s.embed.color) : 16098851,
    description: fill(s.message.description),
    fields,
  }
  if (link) embed.url = link
  if (footer) embed.footer = { text: footer }
  if (s.message.timestamp) embed.timestamp = new Date().toISOString()
  return {
    username: s.identity.name,
    ...(s.identity.avatar_url ? { avatar_url: s.identity.avatar_url } : {}),
    ...(content ? { content } : {}),
    embeds: [embed],
  }
}

// ---------------------------------------------------------------------------
// The changes, one line each, before and after (the review before saving)
// ---------------------------------------------------------------------------

export interface ChangeRow { label: string; before: string; after: string }

const oneLine = (s: string): string => {
  const t = s.replace(/\s*\n\s*/g, ' ⏎ ')
  return t === '' ? '(empty)' : t.length > 140 ? `${t.slice(0, 140)}…` : t
}
const onOff = (b: boolean): string => (b ? 'on' : 'off')
const WEBHOOK_WORD: Record<WebhookMode, string> = { global: 'Global webhook', custom: 'Custom webhook', keep: 'Keep the current one' }
const MENTION_WORD: Record<MentionMode, string> = { none: 'Nobody', role: 'A role', user: 'A user', here: '@here', everyone: '@everyone' }
const listWord = (l: string[]): string => (l.length ? l.join(', ') : 'none')
export const GROUP_WORD: Record<GroupBy, string> = { address: 'One block per address', alert: 'One block per alert' }

/** what saving would change, in the words of the page (the same differences the request carries) */
export function changeRows(a: Settings, b: Settings, newAddress: boolean): ChangeRow[] {
  const rows: ChangeRow[] = []
  const put = (label: string, before: string, after: string) => { if (before !== after) rows.push({ label, before, after }) }
  put('Alerts', onOff(a.enabled), onOff(b.enabled))
  put('Webhook source', WEBHOOK_WORD[a.webhook.mode], WEBHOOK_WORD[b.webhook.mode])
  if (newAddress) rows.push({ label: 'Custom webhook address', before: 'as stored', after: 'a new address (never shown again)' })
  put('Sender name', oneLine(a.identity.name), oneLine(b.identity.name))
  put('Avatar', a.identity.avatar_url || 'the webhook’s own picture', b.identity.avatar_url || 'the webhook’s own picture')
  put('Colour', a.embed.color_mode === 'auto' ? 'automatic' : a.embed.color, b.embed.color_mode === 'auto' ? 'automatic' : b.embed.color)
  put('Mention', MENTION_WORD[a.mention.mode], MENTION_WORD[b.mention.mode])
  put('Mention id', a.mention.id || 'none', b.mention.id || 'none')
  put('Text next to the mention', oneLine(a.mention.text), oneLine(b.mention.text))
  put('New bans', onOff(a.events.bans), onOff(b.events.bans))
  put('Simulated bans', onOff(a.events.simulated), onOff(b.events.simulated))
  put('Detection-only alerts', onOff(a.events.detect_only), onOff(b.events.detect_only))
  put('Minimum events', String(a.filters.min_events), String(b.filters.min_events))
  put('Only these scenarios', listWord(a.filters.only), listWord(b.filters.only))
  put('Never for these scenarios', listWord(a.filters.ignore), listWord(b.filters.ignore))
  put('Grouping', GROUP_WORD[a.delivery.group_by ?? 'address'], GROUP_WORD[b.delivery.group_by ?? 'address'])
  put('Wait before sending', `${a.delivery.group_wait} s`, `${b.delivery.group_wait} s`)
  put('Alerts per message', String(a.delivery.group_threshold), String(b.delivery.group_threshold))
  put('Retries', String(a.delivery.max_retry), String(b.delivery.max_retry))
  put('Give up after', `${a.delivery.timeout} s`, `${b.delivery.timeout} s`)
  put('Title', oneLine(a.message.title), oneLine(b.message.title))
  put('Description', oneLine(a.message.description), oneLine(b.message.description))
  put('Footer', oneLine(a.message.footer), oneLine(b.message.footer))
  put('Title link', oneLine(a.message.link), oneLine(b.message.link))
  put('Show the time', onOff(a.message.timestamp), onOff(b.message.timestamp))
  const fa = a.message.fields, fb = b.message.fields
  if (JSON.stringify(fa) !== JSON.stringify(fb)) {
    const label = (x: (typeof fa)[number]) => (x.name || '(no name)') + (x.inline ? '' : ' (full width)')
    const sameNames = fa.length === fb.length && fa.every((x, i) => x.name === fb[i].name)
    if (!sameNames) rows.push({ label: 'Fields', before: fa.length ? fa.map(label).join(' · ') : 'no fields', after: fb.length ? fb.map(label).join(' · ') : 'no fields' })
    else {
      fa.forEach((x, i) => {
        const y = fb[i]
        if (x.value !== y.value) rows.push({ label: `Field ${i + 1} (${x.name}): value`, before: oneLine(x.value), after: oneLine(y.value) })
        if (x.inline !== y.inline) rows.push({ label: `Field ${i + 1} (${x.name}): side by side`, before: onOff(x.inline), after: onOff(y.inline) })
      })
    }
  }
  return rows
}

// ---------------------------------------------------------------------------
// The draft that survives a switch to another tab (in memory only: a webhook address that was typed never touches a storage)
// ---------------------------------------------------------------------------

export interface DraftMemo { form: NotifyForm; base: Settings; url: string; sample: string }
const memory = new Map<string, DraftMemo>()
export const draftMemory = {
  get: (member: string | null): DraftMemo | undefined => memory.get(member ?? 'hub'),
  set: (member: string | null, d: DraftMemo): void => { memory.set(member ?? 'hub', d) },
  clear: (member: string | null): void => { memory.delete(member ?? 'hub') },
  clearAll: (): void => { memory.clear() },
}
