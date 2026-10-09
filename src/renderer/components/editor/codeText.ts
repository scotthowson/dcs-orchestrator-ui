// =============================================================================
// codeText — what the editors know about the text they edit, once (the stack
// editor, the container's way into it and the template editor all use these):
//   highlightLine   the colours of a YAML or .env line (the classes the theme engine restyles)
//   diffLines       a line diff of the saved text and the edited one (side by side, and the changed lines)
//   serviceBlocks   where each service of a compose file starts and ends
//   problemsFrom    a compose check's output as problems with a line where one can be found
// =============================================================================

export type CodeLanguage = 'yaml' | 'env'

export interface Segment { text: string; cls: string }

const PLAIN = 'text-slate-300'
const KEY = 'text-cyan-400'
const PUNCT = 'text-slate-500'
const COMMENT = 'text-slate-500 italic'
const STRING = 'text-emerald-400'
const NUMBER = 'text-amber-400'
const BOOL = 'text-rose-400'

function yamlValue(raw: string, out: Segment[]): void {
  const hash = raw.indexOf(' #')
  const body = hash >= 0 ? raw.slice(0, hash) : raw
  const comment = hash >= 0 ? raw.slice(hash) : ''
  const m = body.match(/^(\s*)(.*)$/)!
  const [, lead, value] = m
  if (lead) out.push({ text: lead, cls: PLAIN })
  if (value) {
    const cls = /^(true|false|yes|no|on|off)$/i.test(value) ? BOOL
      : /^-?\d[\d_.]*$/.test(value) ? NUMBER
        : /^(null|~)$/i.test(value) ? COMMENT
          : STRING
    out.push({ text: value, cls })
  }
  if (comment) out.push({ text: comment, cls: COMMENT })
}

/** the coloured pieces of one line; joined, they are the line itself */
export function highlightLine(line: string, lang: CodeLanguage): Segment[] {
  if (line.trim() === '') return [{ text: line, cls: PLAIN }]
  const comment = line.match(/^(\s*)(#.*)$/)
  if (comment) return [{ text: comment[1], cls: PLAIN }, { text: comment[2], cls: COMMENT }]
  if (lang === 'env') {
    const eq = line.indexOf('=')
    if (eq > 0) return [{ text: line.slice(0, eq), cls: KEY }, { text: '=', cls: PUNCT }, { text: line.slice(eq + 1), cls: STRING }]
    return [{ text: line, cls: PLAIN }]
  }
  const out: Segment[] = []
  const kv = line.match(/^(\s*)([\w./-][\w./ -]*)(:)(.*)$/)
  if (kv) {
    const [, indent, key, colon, rest] = kv
    if (indent) out.push({ text: indent, cls: PLAIN })
    out.push({ text: key, cls: KEY }, { text: colon, cls: PUNCT })
    if (rest) yamlValue(rest, out)
    return out
  }
  const item = line.match(/^(\s*)(-)(\s?)(.*)$/)
  if (item) {
    const [, indent, dash, space, value] = item
    if (indent) out.push({ text: indent, cls: PLAIN })
    out.push({ text: dash, cls: PUNCT })
    if (space) out.push({ text: space, cls: PLAIN })
    const nested = value.match(/^([\w./-][\w./ -]*)(:)(.*)$/)
    if (nested) {
      out.push({ text: nested[1], cls: KEY }, { text: nested[2], cls: PUNCT })
      if (nested[3]) yamlValue(nested[3], out)
    } else if (value) yamlValue(value, out)
    return out
  }
  return [{ text: line, cls: PLAIN }]
}

// ---------------------------------------------------------------------------
// The line diff
// ---------------------------------------------------------------------------

export interface DiffRow {
  /** the saved side: its line number (null on a row only the edited side has) */
  left: { n: number | null; text: string; kind: 'same' | 'removed' | 'pad' }
  right: { n: number | null; text: string; kind: 'same' | 'added' | 'pad' }
}

export interface LineDiff {
  rows: DiffRow[]
  /** the edited text's line numbers (1-based) that are new or changed */
  changed: Set<number>
  added: number
  removed: number
}

/**
 * A line diff of `saved` and `edited`: the common start and end are skipped, the middle is an LCS (an edit is
 * local, so the middle stays small while typing). A removed line next to an added one is one changed row.
 */
export function diffLines(saved: string, edited: string): LineDiff {
  const a = saved.split('\n')
  const b = edited.split('\n')
  let pre = 0
  while (pre < a.length && pre < b.length && a[pre] === b[pre]) pre++
  let suf = 0
  while (suf < a.length - pre && suf < b.length - pre && a[a.length - 1 - suf] === b[b.length - 1 - suf]) suf++
  const am = a.slice(pre, a.length - suf)
  const bm = b.slice(pre, b.length - suf)
  type Op = { t: 'same' | 'removed' | 'added'; i?: number; j?: number }
  const ops: Op[] = []
  const m = am.length
  const n = bm.length
  if (m * n > 4_000_000) {
    // too large to align line by line: everything in the middle changed
    for (let i = 0; i < m; i++) ops.push({ t: 'removed', i })
    for (let j = 0; j < n; j++) ops.push({ t: 'added', j })
  } else {
    const dp: Uint32Array[] = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1))
    for (let i = m - 1; i >= 0; i--) for (let j = n - 1; j >= 0; j--) dp[i][j] = am[i] === bm[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    let i = 0
    let j = 0
    while (i < m || j < n) {
      if (i < m && j < n && am[i] === bm[j]) { ops.push({ t: 'same', i, j }); i++; j++ }
      else if (j < n && (i === m || dp[i][j + 1] >= dp[i + 1][j])) { ops.push({ t: 'added', j }); j++ }
      else { ops.push({ t: 'removed', i }); i++ }
    }
  }
  const rows: DiffRow[] = []
  const changed = new Set<number>()
  let added = 0
  let removed = 0
  for (let k = 0; k < pre; k++) rows.push({ left: { n: k + 1, text: a[k], kind: 'same' }, right: { n: k + 1, text: b[k], kind: 'same' } })
  // pair runs of removed and added lines into changed rows
  let k = 0
  while (k < ops.length) {
    const op = ops[k]
    if (op.t === 'same') {
      rows.push({ left: { n: pre + op.i! + 1, text: am[op.i!], kind: 'same' }, right: { n: pre + op.j! + 1, text: bm[op.j!], kind: 'same' } })
      k++
      continue
    }
    const rem: number[] = []
    const add: number[] = []
    while (k < ops.length && ops[k].t !== 'same') {
      if (ops[k].t === 'removed') rem.push(ops[k].i!)
      else add.push(ops[k].j!)
      k++
    }
    removed += rem.length
    added += add.length
    for (let r = 0; r < Math.max(rem.length, add.length); r++) {
      const li = rem[r]
      const rj = add[r]
      if (rj !== undefined) changed.add(pre + rj + 1)
      rows.push({
        left: li !== undefined ? { n: pre + li + 1, text: am[li], kind: 'removed' } : { n: null, text: '', kind: 'pad' },
        right: rj !== undefined ? { n: pre + rj + 1, text: bm[rj], kind: 'added' } : { n: null, text: '', kind: 'pad' },
      })
    }
  }
  for (let s = suf; s > 0; s--) {
    const li = a.length - s
    const rj = b.length - s
    rows.push({ left: { n: li + 1, text: a[li], kind: 'same' }, right: { n: rj + 1, text: b[rj], kind: 'same' } })
  }
  return { rows, changed, added, removed }
}

/** "3 lines changed" — a changed line counts once, an added or a removed one once */
export function changeSummary(d: Pick<LineDiff, 'added' | 'removed'>): string {
  const n = Math.max(d.added, d.removed)
  return n === 0 ? 'No changes' : `${n} line${n === 1 ? '' : 's'} changed`
}

// ---------------------------------------------------------------------------
// Compose structure
// ---------------------------------------------------------------------------

export interface ServiceBlock { name: string; start: number; end: number }

/** the services of a compose file with their first and last line (1-based) */
export function serviceBlocks(text: string): ServiceBlock[] {
  const lines = text.split('\n')
  const out: ServiceBlock[] = []
  let inServices = false
  let indent = -1
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]
    if (/^\S/.test(l) && !l.startsWith('#')) {
      inServices = /^services:\s*(#.*)?$/.test(l)
      indent = -1
      if (out.length && out[out.length - 1].end === -1) out[out.length - 1].end = i
      continue
    }
    if (!inServices) continue
    const m = l.match(/^(\s+)([A-Za-z0-9._-]+):\s*(#.*)?$/)
    if (m && (indent === -1 || m[1].length === indent)) {
      indent = m[1].length
      if (out.length && out[out.length - 1].end === -1) out[out.length - 1].end = i
      out.push({ name: m[2], start: i + 1, end: -1 })
    }
  }
  if (out.length && out[out.length - 1].end === -1) {
    let end = lines.length
    while (end > out[out.length - 1].start && lines[end - 1].trim() === '') end--
    out[out.length - 1].end = end
  }
  return out
}

/** a compose text without what Compose ignores: comment-only and blank lines, trailing spaces */
const meaningful = (lines: string[]) => lines.filter((l) => !/^\s*(#.*)?$/.test(l)).map((l) => l.trimEnd()).join('\n')

/** the edit changes something Compose reads (not only comments and blank lines) */
export function changesMeaning(saved: string, edited: string): boolean {
  return meaningful(saved.split('\n')) !== meaningful(edited.split('\n'))
}

/** the services whose block differs between the saved file and the edited one (added and removed ones too; comments aside) */
export function changedServices(saved: string, edited: string): string[] {
  const block = (t: string) => {
    const lines = t.split('\n')
    return new Map(serviceBlocks(t).map((s) => [s.name, meaningful(lines.slice(s.start - 1, s.end))]))
  }
  const a = block(saved)
  const b = block(edited)
  const names = new Set([...a.keys(), ...b.keys()])
  return [...names].filter((n) => a.get(n) !== b.get(n))
}

// ---------------------------------------------------------------------------
// Problems
// ---------------------------------------------------------------------------

export interface Problem {
  severity: 'error' | 'warning'
  message: string
  /** 1-based; absent when the message names no place in the file */
  line?: number
}

/**
 * The problems in a compose check's output (docker compose config, a policy refusal): one per line of output that
 * says something, with its line where it gives one ("yaml: line 7: …") or where it names a service ("services.web …",
 * 'service "web" …').
 */
export function problemsFrom(output: string, text: string): Problem[] {
  const blocks = serviceBlocks(text)
  const seen = new Set<string>()
  const out: Problem[] = []
  for (const raw of output.split('\n')) {
    // docker's own log lines: time="…" level=warning msg="…"
    const logged = raw.match(/level=(\w+)\s+msg="((?:[^"\\]|\\.)*)"/)
    const severity: Problem['severity'] = logged && /warn/i.test(logged[1]) ? 'warning' : 'error'
    const msg = (logged ? logged[2].replace(/\\"/g, '"') : raw)
      .replace(/^(error|Error|ERROR)(:|\s)\s*/, '')
      .replace(/^validating \S+: /, '')
      .trim()
    if (!msg || seen.has(msg)) continue
    seen.add(msg)
    let line: number | undefined
    const lm = msg.match(/\bline (\d+)/i)
    if (lm) line = Number(lm[1])
    else {
      // "services.web.ports …" (a schema error) or 'service "web" has neither an image nor a build context'
      const sm = msg.match(/\bservices\.([A-Za-z0-9._-]+?)(?:\.|\s|$|:)/) ?? msg.match(/\bservice "([A-Za-z0-9._-]+)"/)
      const b = sm && blocks.find((x) => x.name === sm[1])
      if (b) line = b.start
    }
    out.push({ severity, message: msg, line })
  }
  return out.slice(0, 30)
}
