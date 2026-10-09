// =============================================================================
// themeEngine — dresses the document in one look of a theme.
//
// The app hard-codes thousands of Tailwind colour classes, so a look works the
// way light mode works: a palette becomes an override stylesheet (<style id=
// "dcs-theme">) of !important rules under html[data-theme] that beat both the
// utilities and the .light block in index.css. It restyles every colour class
// the pages use (lib/themeClasses.ts), the glass components, the colours
// charts and gauges hard-code as SVG attributes or inline styles, and
// Mantine's colour variables.
//
// A colour that equals the stock look of the mode emits nothing, which is why
// DCS Emerald's dark look renders pixel-identical to the untouched dashboard.
//
// applyTheme() is where the look reaches the document: the light/dark class,
// data-theme, color-scheme, the page colour, the meta theme-color and the
// stylesheet (stores/themeStore decides which theme and mode).
// =============================================================================

import {
  type Theme,
  type ThemeMode,
  type ThemePalette,
  type ThemeRadius,
  contrastRatio,
  hexToRgb,
  hexToTriplet,
  hexToOklch,
  oklchToHex,
  luminance,
  mixHex,
  stockPalette,
  themeLook,
  themeLooks,
  FONT_NAME_RE,
} from '../../shared/themes'
import { sanitizeCss } from './cssSanitize'
import { THEME_CLASSES } from './themeClasses'

export const THEME_STYLE_ID = 'dcs-theme'
const ROOT = 'html[data-theme]'
const ROOT_LIGHT = 'html[data-theme].light'

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** escape a Tailwind class name for use in a selector (bg-white/[0.03] → bg-white\/\[0\.03\]) */
function esc(cls: string): string {
  return cls.replace(/[^a-zA-Z0-9_-]/g, (ch) => `\\${ch}`)
}

/** "#rrggbb" + alpha → rgb(r g b / a) */
function rgba(hex: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha))
  return `rgb(${hexToTriplet(hex)} / ${+a.toFixed(3)})`
}

/** "#10b981" → "rgb(16, 185, 129)", the way the browser writes an inline style colour */
function cssRgb(hex: string): string {
  return `rgb(${hexToRgb(hex).join(', ')})`
}

function shade(hex: string, t: number): string {
  return mixHex(hex, '#000000', t)
}

/** the alpha a Tailwind opacity suffix means: "5" → 0.05, "[0.03]" → 0.03 */
function alphaOf(suffix: string): number {
  if (suffix.startsWith('[')) return parseFloat(suffix.slice(1, -1))
  return parseInt(suffix, 10) / 100
}

/** the selector a utility class (with an optional state variant) needs */
function selectorFor(cls: string): string {
  if (cls.startsWith('hover:')) return `${ROOT} .${esc(cls)}:hover`
  if (cls.startsWith('focus:')) return `${ROOT} .${esc(cls)}:focus`
  if (cls.startsWith('focus-visible:')) return `${ROOT} .${esc(cls)}:focus-visible`
  if (cls.startsWith('focus-within:')) return `${ROOT} .${esc(cls)}:focus-within`
  if (cls.startsWith('active:')) return `${ROOT} .${esc(cls)}:active`
  if (cls.startsWith('file:')) return `${ROOT} .${esc(cls)}::file-selector-button`
  if (cls.startsWith('group-hover:')) return `${ROOT} .group:hover .${esc(cls)}`
  if (cls.startsWith('placeholder:') || cls.startsWith('placeholder-')) return `${ROOT} .${esc(cls)}::placeholder`
  if (cls.startsWith('divide-')) return `${ROOT} .${esc(cls)} > :not([hidden]) ~ :not([hidden])`
  return `${ROOT} .${esc(cls)}`
}

/** the declaration a utility class sets, with the colour swapped */
function declarationFor(cls: string, value: string): string {
  const base = cls.replace(/^(hover|focus|focus-visible|focus-within|active|file|group-hover|placeholder):/, '').replace(/^!/, '')
  if (base.startsWith('placeholder')) return `color: ${value} !important`
  if (base.startsWith('bg-')) return `background-color: ${value} !important`
  if (base.startsWith('text-')) return `color: ${value} !important`
  if (base.startsWith('border-t-')) return `border-top-color: ${value} !important`
  if (base.startsWith('border-b-')) return `border-bottom-color: ${value} !important`
  if (base.startsWith('border-l-')) return `border-left-color: ${value} !important`
  if (base.startsWith('border-r-')) return `border-right-color: ${value} !important`
  if (base.startsWith('border-')) return `border-color: ${value} !important`
  if (base.startsWith('divide-')) return `border-color: ${value} !important`
  if (base.startsWith('ring-offset-')) return `--tw-ring-offset-color: ${value} !important`
  if (base.startsWith('ring-')) return `--tw-ring-color: ${value} !important`
  if (base.startsWith('shadow-')) return `--tw-shadow-color: ${value} !important`
  if (base.startsWith('from-')) return `--tw-gradient-from: ${value} var(--tw-gradient-from-position) !important`
  if (base.startsWith('to-')) return `--tw-gradient-to: ${value} var(--tw-gradient-to-position) !important`
  if (base.startsWith('via-')) return `--tw-gradient-stops: var(--tw-gradient-from), ${value} var(--tw-gradient-via-position), var(--tw-gradient-to) !important`
  if (base.startsWith('fill-')) return `fill: ${value} !important`
  if (base.startsWith('stroke-')) return `stroke: ${value} !important`
  if (base.startsWith('accent-')) return `accent-color: ${value} !important`
  return `color: ${value} !important`
}

/**
 * Collects rules and merges the selectors that share a declaration. Hand-written
 * rules (elements, components like .glass, variables) come out BEFORE the class
 * rules, so an explicit utility on an element keeps winning the way it does in
 * Tailwind's own cascade (components layer, then utilities).
 */
class Sheet {
  private groups = new Map<string, string[]>()
  private raw: string[] = []

  /** a utility class → its colour */
  cls(cls: string, value: string): void {
    this.sel(selectorFor(cls), declarationFor(cls, value))
  }

  /** several classes → one colour */
  each(classes: string[], value: string): void {
    for (const c of classes) this.cls(c, value)
  }

  /** a complete selector → a declaration (grouped with the others that share it) */
  sel(selector: string, decl: string): void {
    const list = this.groups.get(decl) ?? []
    list.push(selector)
    this.groups.set(decl, list)
  }

  /** a hand-written rule (selectors are already complete) */
  rule(selectors: string, body: string): void {
    this.raw.push(`${selectors} { ${body} }`)
  }

  toString(): string {
    const out: string[] = [...this.raw]
    for (const [decl, selectors] of this.groups) out.push(`${selectors.join(',\n')} { ${decl} }`)
    return out.join('\n')
  }
}

// ---------------------------------------------------------------------------
// Colours hard-coded outside the class names: SVG attributes (charts, gauges,
// rings) and inline styles (legend dots, bars, floating panels)
// ---------------------------------------------------------------------------

/** an SVG presentation attribute holding this colour gets the palette's instead (CSS beats the attribute) */
function svgColour(s: Sheet, hex: string, value: string): void {
  for (const [attr, prop] of [['fill', 'fill'], ['stroke', 'stroke'], ['stop-color', 'stop-color']] as const) {
    s.sel(`${ROOT} [${attr}="${hex}" i]`, `${prop}: ${value} !important`)
  }
}

/** an inline style colour (written by the browser as rgb(r, g, b)) gets the palette's instead */
function inlineColour(s: Sheet, hex: string, value: string): void {
  const rgb = cssRgb(hex)
  s.sel(`${ROOT} [style*="background-color: ${rgb}"], ${ROOT} [style*="background: ${rgb}"]`, `background-color: ${value} !important`)
  s.sel(`${ROOT} [style^="color: ${rgb}"], ${ROOT} [style*="; color: ${rgb}"]`, `color: ${value} !important`)
  s.sel(`${ROOT} [style*="border-color: ${rgb}"]`, `border-color: ${value} !important`)
}

type Step = 'c' | 's500' | 's600' | 't300'

/** the Tailwind hexes each status family hard-codes, and the step of the palette colour each one is */
const FAMILY_HEXES: Record<'success' | 'warning' | 'danger' | 'info', Record<string, Step>> = {
  success: { '#34d399': 'c', '#4ade80': 'c', '#10b981': 's500', '#22c55e': 's500', '#059669': 's600', '#047857': 's600', '#6ee7b7': 't300' },
  warning: { '#fbbf24': 'c', '#f59e0b': 's500', '#d97706': 's600', '#f97316': 's600', '#fcd34d': 't300', '#fde68a': 't300' },
  danger: { '#fb7185': 'c', '#f87171': 'c', '#f43f5e': 's500', '#ef4444': 's500', '#e11d48': 's600', '#dc2626': 's600', '#fda4af': 't300' },
  info: { '#22d3ee': 'c', '#38bdf8': 'c', '#06b6d4': 's500', '#3b82f6': 's500', '#0891b2': 's600', '#0284c7': 's600', '#67e8f9': 't300' },
}

// ---------------------------------------------------------------------------
// The palette → class map
// ---------------------------------------------------------------------------

/** the steps of a look's neutral scale that stand in for Tailwind's slate, white and black */
interface Ramp {
  /**
   * The text ramp (text-slate-100 … 700) keeps the dark design's order of emphasis in both looks: 100
   * headings, 300 body, 400 (= muted) secondary text, 500/600 quieter notes, 700 separators and the
   * faintest icons. Each step moves from muted toward the background; 500 stops where it would drop under
   * AA on the background or the surface (in both looks: it carries notes people read), and in a light look
   * 600 does too.
   */
  t100: string; t200: string; t300: string; t400: string; t500: string; t600: string; t700: string
  /** neutral solids (bg/border slate-500/600/700) between the raised surface and muted text */
  n500: string; n600: string; n700: string
}

/** a colour moved toward another by up to `most`, as far as it can go and still reach `min` against each backdrop */
function fadeWithin(c: string, toward: string, most: number, against: string[], min: number): string {
  let best = c
  for (let k = 0.02; k <= most + 1e-9; k += 0.02) {
    const next = mixHex(c, toward, k)
    if (!against.every((b) => contrastRatio(next, b) >= min)) break
    best = next
  }
  return best
}

function rampOf(p: ThemePalette, mode: ThemeMode): Ramp {
  const light = mode === 'light'
  const { bg, surface, surfaceRaised: raised, text, textMuted: muted } = p
  return {
    t100: text,
    t200: mixHex(text, muted, light ? 0.1 : 0.16),
    t300: mixHex(text, muted, light ? 0.3 : 0.4),
    t400: muted,
    t500: fadeWithin(muted, bg, light ? 0.25 : 0.3, [bg, surface], 4.5),
    t600: light ? fadeWithin(muted, bg, 0.4, [bg, surface], 4.5) : mixHex(muted, bg, 0.5),
    t700: mixHex(muted, bg, light ? 0.62 : 0.65),
    n500: mixHex(raised, muted, 0.6),
    n600: mixHex(raised, muted, 0.36),
    n700: mixHex(raised, muted, 0.2),
  }
}

/** how strong the palette border reads for a border-white/<alpha> class (the stock glass: fainter alphas, fainter edges) */
function borderFor(p: ThemePalette, a: number): string {
  const { border, text } = p
  if (a <= 0.03) return rgba(border, 0.45)
  if (a <= 0.05) return rgba(border, 0.55)
  if (a <= 0.06) return rgba(border, 0.65)
  if (a <= 0.08) return rgba(border, 0.8)
  if (a <= 0.12) return border
  if (a <= 0.15) return mixHex(border, text, 0.2)
  if (a <= 0.2) return mixHex(border, text, 0.3)
  if (a <= 0.3) return mixHex(border, text, 0.45)
  return mixHex(border, text, 0.55)
}

type StatusKey = 'success' | 'warning' | 'danger' | 'info'
/** the Tailwind hues the dashboard uses for each status colour */
const HUE_ROLE: Record<string, StatusKey> = {
  emerald: 'success', teal: 'success', lime: 'success', green: 'success',
  amber: 'warning', orange: 'warning', yellow: 'warning',
  rose: 'danger', red: 'danger',
  cyan: 'info', sky: 'info', blue: 'info',
}

/** a status colour at a Tailwind shade: the palette colour is the 400; lighter steps move toward the text colour, darker ones toward black */
function statusShade(c: string, text: string, shadeNo: number): string {
  if (shadeNo <= 50) return mixHex(c, text, 0.9)
  if (shadeNo <= 100) return mixHex(c, text, 0.75)
  if (shadeNo <= 200) return mixHex(c, text, 0.55)
  if (shadeNo <= 300) return mixHex(c, text, 0.3)
  if (shadeNo <= 400) return c
  if (shadeNo <= 500) return shade(c, 0.15)
  if (shadeNo <= 600) return shade(c, 0.3)
  if (shadeNo <= 700) return shade(c, 0.45)
  if (shadeNo <= 800) return shade(c, 0.6)
  if (shadeNo <= 900) return shade(c, 0.72)
  return shade(c, 0.8)
}

/** slate as a foreground (text, placeholder, fill, stroke): the text ramp; the darkest steps are the darkest neutral of the look */
function slateForeground(p: ThemePalette, r: Ramp, light: boolean, shadeNo: number): string {
  if (shadeNo <= 100) return r.t100
  if (shadeNo <= 200) return r.t200
  if (shadeNo <= 300) return r.t300
  if (shadeNo <= 400) return r.t400
  if (shadeNo <= 500) return r.t500
  if (shadeNo <= 600) return r.t600
  if (shadeNo <= 700) return r.t700
  if (shadeNo <= 800) return light ? mixHex(p.text, p.textMuted, 0.2) : p.surface
  return light ? p.text : p.bg
}

/** slate as a surface or line (bg, gradients, borders, rings, shadows) */
function slateSurface(p: ThemePalette, r: Ramp, shadeNo: number): string {
  if (shadeNo >= 950) return p.bg
  if (shadeNo >= 900) return p.surface
  if (shadeNo >= 800) return p.surfaceRaised
  if (shadeNo >= 700) return r.n700
  if (shadeNo >= 600) return r.n600
  if (shadeNo >= 500) return r.n500
  if (shadeNo >= 400) return p.textMuted
  if (shadeNo >= 300) return mixHex(p.textMuted, p.text, 0.35)
  if (shadeNo >= 200) return mixHex(p.textMuted, p.text, 0.65)
  return p.text
}

const CLASS_RE = /^(?:(hover|focus|focus-visible|focus-within|active|file|group-hover|placeholder):)?!?(bg|text|border(?:-[tblrxy])?|ring-offset|ring|from|to|via|fill|stroke|shadow|divide|accent|placeholder)-(emerald|teal|lime|green|amber|orange|yellow|rose|red|cyan|sky|blue|slate|white|black|violet|purple|fuchsia|pink|indigo)(?:-(\d{2,3}))?(?:\/(\d{1,3}|\[[\d.]+\]))?$/
/** the decorative hues' 700 (Tailwind): their pale text steps, made for dark glass, read as this on a light look */
const DECORATIVE_INK: Record<string, string> = { violet: '#6d28d9', purple: '#7e22ce', fuchsia: '#a21caf', pink: '#be185d', indigo: '#4338ca' }
interface ColourClass { cls: string; prop: string; family: string; shadeNo: number | null; alpha: number | null }
let parsed: ColourClass[] | null = null
function colourClasses(): ColourClass[] {
  if (!parsed) {
    parsed = []
    for (const cls of THEME_CLASSES) {
      const m = CLASS_RE.exec(cls)
      if (m) parsed.push({ cls, prop: m[2], family: m[3], shadeNo: m[4] ? parseInt(m[4], 10) : null, alpha: m[5] ? alphaOf(m[5]) : null })
    }
  }
  return parsed
}

/**
 * Every colour class the dashboard uses (lib/themeClasses.ts, kept current by
 * scripts/theme-classes.mjs) restyled from the palette: status hues from their
 * status colour, slate from the neutral scale, white as the text colour (white
 * glass on a dark look, ink on a light one), black darkening a light look
 * gently. Only what differs from the stock look is written.
 */
function emitClasses(s: Sheet, p: ThemePalette, stock: ThemePalette, mode: ThemeMode): void {
  const light = mode === 'light'
  const neutrals = !sameNeutrals(p, stock)
  const r = rampOf(p, mode)
  for (const { cls, prop, family, shadeNo, alpha } of colourClasses()) {
    const fg = prop === 'text' || prop === 'placeholder' || prop === 'fill' || prop === 'stroke'
    let value: string | null = null
    const role = HUE_ROLE[family]
    if (DECORATIVE_INK[family]) {
      // violet & co. keep their hue in every theme; only their pale text needs ink on a light page
      if (!light || !fg || shadeNo === null || shadeNo > 500) continue
      value = DECORATIVE_INK[family]
    } else if (role) {
      if (p[role] === stock[role] || shadeNo === null) continue
      value = statusShade(p[role], p.text, shadeNo)
    } else if (family === 'slate') {
      if (!neutrals || shadeNo === null) continue
      value = fg ? slateForeground(p, r, light, shadeNo) : slateSurface(p, r, shadeNo)
    } else if (family === 'white') {
      if (!neutrals || shadeNo !== null) continue
      if (prop.startsWith('border') || prop === 'divide') {
        if (alpha === null) continue
        s.cls(cls, prop === 'divide' && alpha <= 0.06 ? rgba(p.border, 0.5) : borderFor(p, alpha))
        continue
      }
      if (prop === 'bg' && alpha === null) continue // a solid white knob stays white
      value = fg ? r.t100 : p.text
    } else if (family === 'black') {
      // black darkens: on a dark look it stays black; on a light one it becomes a soft shade of ink
      if (!light || !neutrals || alpha === null || fg) continue
      s.cls(cls, rgba(p.text, alpha * (prop === 'shadow' ? 0.2 : 0.4)))
      continue
    }
    // dimmed text (text-amber-400/80, text-slate-500/80) reads as the solid step on a light page: the
    // dimming was meant for bright text on dark glass; faint separators (/[0.06]) stay translucent
    const solid = light && fg && alpha !== null && alpha >= 0.5
    if (value) s.cls(cls, alpha === null || solid ? value : rgba(value, alpha))
  }

  // Text written onto a solid status colour: the dark design pairs bright chips with dark text
  // (bg-amber-500/90 text-slate-900) and buttons with white text (bg-emerald-500 text-white). A look
  // moves those colours (a light one darkens status colours for AA; a pastel one lightens them), so
  // such a pair keeps whichever ink of the look reads best on the colour it has now.
  const all = colourClasses()
  const inks = all.filter((c) => c.prop === 'text' && !c.cls.includes(':') && c.alpha === null
    && (c.family === 'white' || c.family === 'black' || (c.family === 'slate' && c.shadeNo !== null && (c.shadeNo <= 200 || c.shadeNo >= 800))))
  for (const b of all) {
    const role = HUE_ROLE[b.family]
    if (b.prop !== 'bg' || !role || b.shadeNo === null || b.shadeNo < 400 || (b.alpha !== null && b.alpha < 0.6) || b.cls.includes(':')) continue
    if (p[role] === stock[role]) continue
    const colour = statusShade(p[role], p.text, b.shadeNo)
    const shown = b.alpha === null ? colour : mixHex(p.surface, colour, b.alpha)
    const lightInk = light ? p.surface : p.text
    const darkInk = light ? p.text : p.bg
    const best = contrastRatio(lightInk, shown) >= contrastRatio(darkInk, shown) ? lightInk : darkInk
    for (const t of inks) s.sel(`${ROOT} .${esc(b.cls)}.${esc(t.cls)}, ${ROOT} .${esc(b.cls)} .${esc(t.cls)}`, `color: ${best} !important`)
  }
}

/** the hand-written neutral rules: page, glass components, generic borders, charts, hard-coded slate, light-mode elements */
function emitNeutrals(s: Sheet, p: ThemePalette, mode: ThemeMode): void {
  const light = mode === 'light'
  const { bg, surface, surfaceRaised: raised, border, text, textMuted: muted } = p
  const { t300, t500, t600, n500, n600, n700 } = rampOf(p, mode)

  // ── Page ──
  s.rule(`${ROOT} body, ${ROOT} .theme-bg`, `background-color: ${bg} !important; color: ${text} !important`)

  // ── Glass components (@apply'd in index.css, so the class map cannot reach them) ──
  s.rule(`${ROOT} .glass`, `background-color: ${rgba(surface, 0.75)} !important; border-color: ${border} !important`)
  s.rule(`${ROOT} .glass-subtle, ${ROOT} .glass-card, ${ROOT} .glass-1`, `background-color: ${rgba(surface, 0.65)} !important; border-color: ${rgba(border, 0.6)} !important`)
  s.rule(`${ROOT} .glass-card:hover`, `border-color: ${border} !important`)
  s.rule(`${ROOT} .glass-hover:hover`, `background-color: ${rgba(raised, 0.6)} !important; border-color: ${mixHex(border, text, 0.15)} !important`)
  s.rule(`${ROOT} .glass-2`, `background-color: ${rgba(raised, 0.6)} !important; border-color: ${rgba(border, 0.8)} !important`)
  s.rule(`${ROOT} .glass-3`, `background-color: ${rgba(raised, 0.8)} !important; border-color: ${border} !important`)
  s.rule(`${ROOT} .skeleton`, `background: linear-gradient(90deg, ${rgba(raised, 0.6)}, ${rgba(n700, 0.4)}, ${rgba(raised, 0.6)}) !important; background-size: 200% 100% !important`)

  // ── Borders without a colour class read the palette border ──
  s.rule(`${ROOT} .border-t, ${ROOT} .border-b, ${ROOT} .border-l, ${ROOT} .border-r`, `border-color: ${rgba(border, 0.55)} !important`)

  // ── Chrome: scrollbars, charts, selection ──
  s.rule(`${ROOT} ::-webkit-scrollbar-thumb`, `background-color: ${rgba(muted, 0.35)} !important`)
  s.rule(`${ROOT} ::-webkit-scrollbar-thumb:hover`, `background-color: ${rgba(muted, 0.55)} !important`)
  s.rule(`${ROOT} .scrollbar-thin`, `scrollbar-color: ${rgba(muted, 0.4)} transparent !important`)
  s.rule(`${ROOT} .recharts-cartesian-grid line`, `stroke: ${rgba(border, 0.8)} !important`)
  s.rule(`${ROOT} .recharts-text`, `fill: ${t500} !important`)
  s.rule(`${ROOT} .recharts-tooltip-wrapper .recharts-default-tooltip`, `background-color: ${rgba(light ? surface : raised, 0.97)} !important; border-color: ${border} !important; color: ${text} !important`)
  s.rule(`${ROOT} .recharts-tooltip-wrapper .recharts-tooltip-label`, `color: ${muted} !important`)
  s.rule(`${ROOT} .recharts-tooltip-wrapper .recharts-tooltip-item, ${ROOT} .recharts-tooltip-wrapper .recharts-tooltip-item-name, ${ROOT} .recharts-tooltip-wrapper .recharts-tooltip-item-separator, ${ROOT} .recharts-tooltip-wrapper .recharts-tooltip-item-value, ${ROOT} .recharts-tooltip-wrapper .recharts-tooltip-item-unit`, `color: ${text} !important`)
  s.rule(`${ROOT} .uptime-tip::before`, `border-color: ${border} !important`)

  // ── Hard-coded slate in SVG (gauge tracks, axes) and in inline styles (floating panels, tooltips) ──
  svgColour(s, '#0f172a', surface)
  svgColour(s, '#1e293b', raised)
  svgColour(s, '#334155', n700)
  svgColour(s, '#475569', n600)
  svgColour(s, '#64748b', t500)
  svgColour(s, '#94a3b8', muted)
  for (const a of ['0.88', '0.9', '0.92']) s.sel(`${ROOT} [fill="rgba(15, 23, 42, ${a})"]`, `fill: ${rgba(surface, parseFloat(a))} !important`)
  s.rule(`${ROOT} [style*="background-color: rgba(15, 23, 42, 0.9"]`, `background-color: ${rgba(light ? surface : raised, 0.97)} !important; color: ${text} !important`)
  s.rule(`${ROOT} [style*="border: 1px solid rgba(255, 255, 255, 0.1)"], ${ROOT} [style*="border-color: rgba(255, 255, 255, 0.1)"]`, `border-color: ${border} !important`)
  s.sel(`${ROOT} [style^="color: rgb(226, 232, 240)"], ${ROOT} [style*="; color: rgb(226, 232, 240)"]`, `color: ${text} !important`)

  if (light) {
    // The .light block styles elements as well as classes; give those the palette
    // too. html[data-theme] el (0,1,2) beats .light el (0,1,1) and still loses to
    // a utility class on the element (0,2,1), as in the stock cascade.
    s.rule(`${ROOT} h1, ${ROOT} h2, ${ROOT} h3, ${ROOT} h4, ${ROOT} h5, ${ROOT} h6`, `color: ${text} !important`)
    s.rule(`${ROOT} header, ${ROOT} footer`, `background-color: ${rgba(surface, 0.85)} !important; border-color: ${border} !important`)
    s.rule(`${ROOT} aside`, `background-color: ${rgba(surface, 0.8)} !important; border-color: ${border} !important`)
    s.rule(`${ROOT} input, ${ROOT} textarea, ${ROOT} select`, `background-color: ${surface} !important; border-color: ${border} !important; color: ${text} !important`)
    s.rule(`${ROOT} input::placeholder, ${ROOT} textarea::placeholder`, `color: ${t500} !important`)
    s.rule(`${ROOT} input:focus, ${ROOT} textarea:focus, ${ROOT} select:focus`, `border-color: ${rgba(p.accent, 0.7)} !important; box-shadow: 0 0 0 3px ${rgba(p.accent, 0.2)} !important`)
    s.rule(`${ROOT} table th`, `color: ${t500} !important; border-color: ${rgba(border, 0.7)} !important`)
    s.rule(`${ROOT} table td`, `color: ${t300} !important`)
    s.rule(`${ROOT} table thead`, `background-color: ${rgba(text, 0.02)} !important`)
    s.rule(`${ROOT} tr:hover, ${ROOT} table tr:hover`, `background-color: ${rgba(text, 0.03)} !important`)
    s.rule(`${ROOT} kbd`, `background-color: ${rgba(text, 0.05)} !important; border-color: ${border} !important; color: ${t600} !important`)
    s.rule(`${ROOT} pre, ${ROOT} code`, `background-color: ${raised} !important; color: ${t300} !important`)
    s.rule(`${ROOT} .font-mono`, `color: ${t300}`)
    s.rule(`${ROOT} aside button:hover`, `background-color: ${rgba(text, 0.05)} !important`)
    s.rule(`${ROOT_LIGHT} .bg-slate-950\\/60, ${ROOT_LIGHT} .bg-slate-900\\/80`, `border-color: ${border} !important`)
    // translucent white written into SVG (tracks, axes, ticks) is invisible on a light page
    s.sel(`${ROOT} [stroke^="rgba(255,255,255,0.0"], ${ROOT} [stroke^="rgba(255, 255, 255, 0.0"], ${ROOT} [stroke="rgba(255,255,255,0.1)"]`, `stroke: ${rgba(text, 0.1)} !important`)
    s.sel(`${ROOT} [fill="rgba(255,255,255,0.4)"], ${ROOT} [fill="rgba(255,255,255,0.3)"]`, `fill: ${t500} !important`)
    s.sel(`${ROOT} [fill="rgba(255,255,255,0.03)"]`, `fill: ${rgba(text, 0.04)} !important`)
  }
}

/** each status colour's primary Tailwind hue (the one with glows and neon text) and its pulse keyframes */
const FAMILIES: Record<StatusKey, { primary: string; keyframe: string | null }> = {
  success: { primary: 'emerald', keyframe: 'glowPulseEmerald' },
  warning: { primary: 'amber', keyframe: null },
  danger: { primary: 'rose', keyframe: 'glowPulseRose' },
  info: { primary: 'cyan', keyframe: 'glowPulseCyan' },
}

/** the arbitrary glow shadows hard-coded with a hue's rgb (sidebar dots, status pills) */
const ARBITRARY_GLOWS: Record<string, string[]> = {
  emerald: ['0_0_8px_rgba(52,211,153,0.6)', '0_0_8px_rgba(52,211,153,0.3)', '0_0_8px_rgba(52,211,153,.6)', '0_0_6px_rgba(52,211,153,0.4)', '0_0_6px_rgba(52,211,153,0.5)', '0_0_20px_rgba(52,211,153,0.2)', '0_0_12px_rgba(52,211,153,0.4)'],
  cyan: ['0_0_8px_rgba(34,211,238,0.3)'],
  amber: ['0_0_8px_rgba(251,191,36,0.3)'],
  rose: ['0_0_8px_rgba(251,113,133,0.3)'],
}

/** the glows, neon text and hard-coded arbitrary shadows of a family's primary hue */
function emitGlows(s: Sheet, hue: string, c: string, light: boolean): void {
  const glow = ARBITRARY_GLOWS[hue]
  if (glow) {
    for (const g of glow) {
      const m = /^0_0_(\d+)px_rgba\([^,]+,[^,]+,[^,]+,([0-9.]+)\)$/.exec(g)
      if (!m) continue
      const px = m[1]
      const a = parseFloat(m[2])
      // the class names are assembled piecewise so Tailwind's source scanner does
      // not read "shadow-[…]" here as an arbitrary utility to compile
      const open = '['
      const close = ']'
      s.rule(`${ROOT} .${esc('shadow-' + open + g + close)}`, `box-shadow: 0 0 ${px}px ${rgba(c, a)} !important`)
      s.rule(`${ROOT} .${esc('drop-shadow-' + open + g + close)}`, `filter: drop-shadow(0 0 ${px}px ${rgba(c, a)}) !important`)
    }
    s.rule(`${ROOT} .glow-${hue}`, light
      ? `box-shadow: 0 0 12px ${rgba(c, 0.1)} !important`
      : `box-shadow: 0 0 20px ${rgba(c, 0.15)}, 0 0 60px ${rgba(c, 0.05)} !important`)
    s.rule(`${ROOT} .neon-${hue}`, light ? 'text-shadow: none !important' : `text-shadow: 0 0 7px ${rgba(c, 0.4)}, 0 0 20px ${rgba(c, 0.15)} !important`)
  }
}

/** what a changed status colour needs besides its classes: glows, the pulse keyframes, the hexes charts hard-code */
function emitStatus(s: Sheet, p: ThemePalette, stock: ThemePalette, mode: ThemeMode): void {
  const light = mode === 'light'
  for (const key of ['success', 'warning', 'danger', 'info'] as const) {
    const c = p[key]
    if (c === stock[key]) continue
    const fam = FAMILIES[key]
    emitGlows(s, fam.primary, c, light)
    if (fam.keyframe) {
      s.rule(`@keyframes ${fam.keyframe}`, `0%, 100% { box-shadow: 0 0 8px ${rgba(c, 0.15)}; } 50% { box-shadow: 0 0 24px ${rgba(c, 0.3)}, 0 0 48px ${rgba(c, 0.1)}; }`)
    }
    // the same hues hard-coded in charts (SVG) and bars and dots (inline styles)
    const steps: Record<Step, string> = { c, s500: shade(c, 0.15), s600: shade(c, 0.3), t300: mixHex(c, p.text, 0.3) }
    for (const [hex, role] of Object.entries(FAMILY_HEXES[key])) {
      svgColour(s, hex, steps[role])
      inlineColour(s, hex, steps[role])
    }
  }
}

/**
 * The accent as small text — the page you are on in the sidebar and the tab bar, on its accent-bg-subtle
 * pill: the accent itself where it reads at 4.5:1 on the surface, the page and the pill, else the same hue
 * made darker (a light look) or lighter (a dark one) until it does. A look's accent only has to reach 3:1
 * as a colour; fills, rings and gradients keep it.
 */
export function accentInk(p: ThemePalette): string {
  const against = [p.surface, p.bg, mixHex(p.surface, p.accent, 0.12)]
  const reads = (c: string) => against.every((bg) => contrastRatio(c, bg) >= 4.5)
  if (reads(p.accent)) return p.accent
  const { l, c, h } = hexToOklch(p.accent)
  const step = luminance(p.text) < luminance(p.surface) ? -0.005 : 0.005
  for (let li = l + step; li > 0 && li < 1; li += step) {
    const next = oklchToHex({ l: li, c, h })
    if (reads(next)) return next
  }
  return p.text
}

/** the brand: --color-accent, the emerald→cyan gradients, selection, the logo's glow */
function emitBrand(s: Sheet, p: ThemePalette, stock: ThemePalette, mode: ThemeMode): void {
  const a = p.accent
  const b = p.accentSecondary
  // a personal accent (Settings → Profile, anything but the default emerald) beats the theme's
  const themeAccent = [`${ROOT}:not([data-accent])`, `${ROOT}[data-accent="emerald"]`]
  const ink = accentInk(p)
  if (ink !== a) s.rule(themeAccent.map((r) => `${r} .accent-text`).join(', '), `color: ${ink} !important`)
  const changed = a !== stock.accent || b !== stock.accentSecondary
  if (!changed) return
  const vars: string[] = []
  if (a !== stock.accent) vars.push(`--color-accent: ${hexToTriplet(a)}`)
  if (b !== stock.accentSecondary) vars.push(`--color-accent-secondary: ${hexToTriplet(b)}`)
  s.rule(themeAccent.join(', '), vars.join('; '))
  // the emerald → cyan pairs are the brand gradient (avatar, logo box, primary CTA), not status colours
  const pairs: Array<[string, string, number]> = [
    ['from-emerald-500', 'to-cyan-500', 1],
    ['from-emerald-400', 'to-cyan-400', 1],
    ['from-emerald-500/20', 'to-cyan-500/20', 0.2],
  ]
  for (const [from, to, alpha] of pairs) {
    const fromC = alpha < 1 ? rgba(a, alpha) : a
    const toC = alpha < 1 ? rgba(b, alpha) : b
    s.rule(`${ROOT} .${esc(from)}.${esc(to)}`, `--tw-gradient-from: ${fromC} var(--tw-gradient-from-position) !important; --tw-gradient-to: ${toC} var(--tw-gradient-to-position) !important`)
    s.rule(`${ROOT} .${esc(to.replace('to-', 'from-'))}.${esc(from.replace('from-', 'to-'))}`, `--tw-gradient-from: ${toC} var(--tw-gradient-from-position) !important; --tw-gradient-to: ${fromC} var(--tw-gradient-to-position) !important`)
  }
  // the .light block paints these two with its own emerald → cyan
  s.rule(`${ROOT_LIGHT} .bg-gradient-to-r.from-emerald-500.to-cyan-500`, `background-image: linear-gradient(to right, ${a}, ${b}) !important`)
  s.rule(`${ROOT_LIGHT} .bg-gradient-to-br.from-emerald-500.to-cyan-500`, `background-image: linear-gradient(to bottom right, ${a}, ${b}) !important`)
  s.rule(`${ROOT} .gradient-border::before`, `background: linear-gradient(135deg, ${rgba(a, 0.3)}, ${rgba(b, 0.1)}, ${rgba(a, 0.3)}) !important`)
  s.rule(`${ROOT} .gradient-border-animated::before`, `background: conic-gradient(from var(--gradient-angle, 0deg), ${rgba(a, 0.4)}, ${rgba(b, 0.2)}, ${rgba(a, 0.4)}, ${rgba(b, 0.2)}, ${rgba(a, 0.4)}) !important`)
  s.rule(`${ROOT} .text-gradient.neon-emerald`, mode === 'light' ? 'text-shadow: none !important' : `text-shadow: 0 0 7px ${rgba(a, 0.4)}, 0 0 20px ${rgba(a, 0.15)} !important`)
  s.rule(`${ROOT} ::selection`, `background-color: ${rgba(a, 0.3)} !important`)
  s.rule(`@keyframes blinkCaret`, `0%, 100% { border-color: transparent; } 50% { border-color: ${rgba(a, 0.8)}; }`)
}

// ---------------------------------------------------------------------------
// Variables: the palette for custom CSS, the hint bubble, and Mantine
// ---------------------------------------------------------------------------

function emitVariables(s: Sheet, theme: Theme, p: ThemePalette): void {
  s.rule(ROOT, [
    `--dcs-accent: ${p.accent}`, `--dcs-accent-secondary: ${p.accentSecondary}`,
    `--dcs-bg: ${p.bg}`, `--dcs-surface: ${p.surface}`, `--dcs-surface-raised: ${p.surfaceRaised}`, `--dcs-border: ${p.border}`,
    `--dcs-text: ${p.text}`, `--dcs-text-muted: ${p.textMuted}`,
    `--dcs-success: ${p.success}`, `--dcs-warning: ${p.warning}`, `--dcs-danger: ${p.danger}`, `--dcs-info: ${p.info}`,
  ].join('; '))
  // Hint bubbles (common/Tooltip, Mantine's Tooltip on dark.7) are dark in both modes, as shipped:
  // the theme's own dark look. The stock look is the component's fallback, so DCS Emerald sets nothing.
  const d = themeLooks(theme).dark
  if (!sameNeutrals(d, stockPalette('dark'))) {
    s.rule(ROOT, `--dcs-hint-bg: ${rgba(d.surface, 0.96)}; --dcs-hint-border: ${rgba(d.text, 0.12)}; --dcs-hint-text: ${mixHex(d.text, d.textMuted, 0.16)}`)
  }
}

const NEUTRALS = ['bg', 'surface', 'surfaceRaised', 'border', 'text', 'textMuted'] as const
function sameNeutrals(a: ThemePalette, b: ThemePalette): boolean {
  return NEUTRALS.every((k) => a[k] === b[k])
}

/** ten shades of a colour, lightest first, with the colour itself at `at` (Mantine's primary shade: 4 dark, 6 light) */
function scaleOf(hex: string, at: number): string[] {
  const { l, c, h } = hexToOklch(hex)
  const top = Math.max(l, 0.97)
  const bottom = Math.min(l, 0.22)
  return Array.from({ length: 10 }, (_, i) => {
    if (i === at) return hex
    const t = i < at ? (at - i) / at : (i - at) / (9 - at)
    const li = i < at ? l + (top - l) * t : l - (l - bottom) * t
    return oklchToHex({ l: li, c: c * (1 - 0.55 * t), h })
  })
}

/**
 * Mantine follows the look too: its colour variables are set over the ones its
 * provider writes (html[data-theme][data-mantine-color-scheme] outranks
 * :root[data-mantine-color-scheme]), so every Mantine component — Progress,
 * RingProgress, Tooltip, Select, Badge… — takes the theme's status colours and
 * surfaces without lib/mantine.tsx knowing about themes. As with the classes,
 * only what differs from the stock look is set: DCS Emerald keeps Mantine's
 * shipped look exactly. The --dcs-field/dropdown/option/seg/tint variables are
 * the ones lib/mantine.tsx gives its fields, dropdowns and chips.
 */
function emitMantine(s: Sheet, theme: Theme, mode: ThemeMode, p: ThemePalette, stock: ThemePalette): void {
  const light = mode === 'light'
  const decls: string[] = []
  // the Mantine colours named like the Tailwind hues, mapped the way the classes are (HUE_ROLE: orange is the warning colour)
  const names = { success: ['emerald'], info: ['cyan'], warning: ['amber', 'orange'], danger: ['rose'] } as const
  for (const key of ['success', 'info', 'warning', 'danger'] as const) {
    const c = p[key]
    if (c === stock[key]) continue
    const s500 = shade(c, 0.15)
    for (const name of names[key]) {
      scaleOf(c, light ? 6 : 4).forEach((v, i) => decls.push(`--mantine-color-${name}-${i}: ${v}`))
      decls.push(
        `--mantine-color-${name}-light: ${light ? rgba(c, 0.08) : rgba(s500, 0.12)}`,
        `--mantine-color-${name}-light-hover: ${light ? rgba(c, 0.14) : rgba(s500, 0.18)}`,
        `--mantine-color-${name}-light-color: ${light ? c : mixHex(c, p.text, 0.3)}`,
        `--mantine-color-${name}-outline: ${c}`,
        `--mantine-color-${name}-outline-hover: ${rgba(c, 0.06)}`,
        `--dcs-tint-${name}-border: ${light ? rgba(c, 0.25) : rgba(s500, 0.22)}`,
      )
    }
  }
  // color="slate" (neutral chips and filters) takes the look's neutrals, as the slate classes do; each value sits where
  // the stock slate step sits in DCS Emerald (tint of slate-500 / 600, text of slate-300 / 700, outline = muted text)
  if (!sameNeutrals(p, stock)) {
    const { bg, surface, surfaceRaised: raised, border, text, textMuted: muted } = p
    const tint = light ? muted : rampOf(p, mode).n500
    const scale = light
      ? [surface, bg, raised, mixHex(raised, border, 0.5), border, mixHex(border, muted, 0.5), muted, mixHex(muted, text, 0.5), mixHex(muted, text, 0.8), text]
      : [text, mixHex(text, muted, 0.5), muted, mixHex(muted, border, 0.5), border, mixHex(border, raised, 0.5), raised, surface, mixHex(surface, bg, 0.5), bg]
    scale.forEach((v, i) => decls.push(`--mantine-color-slate-${i}: ${v}`))
    decls.push(
      `--mantine-color-slate-light: ${rgba(tint, light ? 0.08 : 0.1)}`,
      `--mantine-color-slate-light-hover: ${rgba(tint, light ? 0.14 : 0.18)}`,
      `--mantine-color-slate-light-color: ${light ? mixHex(text, muted, 0.6) : rampOf(p, mode).t300}`,
      `--mantine-color-slate-outline: ${muted}`,
      `--mantine-color-slate-outline-hover: ${rgba(muted, 0.06)}`,
      `--dcs-tint-slate-border: ${rgba(tint, light ? 0.25 : 0.22)}`,
    )
  }
  const { dark: d, light: l } = themeLooks(theme)
  // Mantine's dark scale (surfaces and text of its dark scheme, and the dark.7 hint bubble in both) from the dark look
  if (!sameNeutrals(d, stockPalette('dark'))) {
    const dark = [d.text, mixHex(d.text, d.textMuted, 0.5), d.textMuted, mixHex(d.textMuted, d.border, 0.5), d.border, mixHex(d.border, d.surfaceRaised, 0.5), d.surfaceRaised, d.surface, mixHex(d.surface, d.bg, 0.5), d.bg]
    dark.forEach((v, i) => decls.push(`--mantine-color-dark-${i}: ${v}`))
  }
  // its gray scale (the light scheme's surfaces and text) from the light look
  if (!sameNeutrals(l, stockPalette('light'))) {
    const gray = [l.surface, l.bg, l.surfaceRaised, mixHex(l.surfaceRaised, l.border, 0.5), l.border, mixHex(l.border, l.textMuted, 0.5), l.textMuted, mixHex(l.textMuted, l.text, 0.5), mixHex(l.textMuted, l.text, 0.8), l.text]
    gray.forEach((v, i) => decls.push(`--mantine-color-gray-${i}: ${v}`))
  }
  if (!sameNeutrals(p, stock)) {
    const { bg, surface, surfaceRaised: raised, border, text, textMuted: muted } = p
    const t500 = light ? mixHex(muted, text, 0.35) : mixHex(muted, bg, 0.3)
    const ok = p.success
    decls.push(
      `--mantine-color-text: ${text}`, `--mantine-color-body: ${surface}`, `--mantine-color-dimmed: ${muted}`,
      `--mantine-color-placeholder: ${t500}`, `--mantine-color-default-border: ${border}`,
      `--mantine-color-default: ${light ? surface : raised}`, `--mantine-color-default-hover: ${light ? bg : mixHex(raised, text, 0.06)}`, `--mantine-color-default-color: ${text}`,
      // lib/mantine.tsx: fields, dropdowns, options, segmented filters
      `--dcs-field-bg: ${light ? mixHex(surface, bg, 0.5) : rgba(text, 0.05)}`,
      `--dcs-field-border: ${border}`,
      `--dcs-field-focus: ${light ? ok : rgba(shade(ok, 0.15), 0.5)}`,
      `--dcs-field-ring: ${rgba(light ? ok : shade(ok, 0.15), 0.2)}`,
      `--dcs-field-color: ${light ? text : mixHex(text, muted, 0.16)}`,
      `--dcs-field-placeholder: ${t500}`,
      `--dcs-dropdown-bg: ${light ? surface : rgba(surface, 0.98)}`,
      `--dcs-dropdown-border: ${light ? border : rgba(muted, 0.2)}`,
      `--dcs-dropdown-shadow: ${light ? `0 12px 32px ${rgba(text, 0.14)}` : '0 12px 32px rgb(0 0 0 / 0.5)'}`,
      `--dcs-option-hover: ${light ? bg : rgba(text, 0.06)}`,
      `--dcs-option-checked: ${light ? ok : mixHex(ok, text, 0.3)}`,
      `--dcs-muted: ${t500}`,
      `--dcs-seg-bg: ${light ? rgba(bg, 0.7) : rgba(text, 0.05)}`,
      `--dcs-seg-border: ${border}`,
      `--dcs-seg-label: ${light ? t500 : muted}`,
      `--dcs-seg-label-hover: ${light ? text : mixHex(text, muted, 0.16)}`,
      `--dcs-fleet-field-bg: ${light ? mixHex(surface, bg, 0.5) : rgba(raised, 0.5)}`,
      `--dcs-fleet-field-focus: ${light ? ok : rgba(shade(p.warning, 0.15), 0.4)}`,
      `--dcs-fleet-field-ring: ${light ? rgba(ok, 0.2) : rgba(shade(p.warning, 0.15), 0.12)}`,
    )
  }
  if (decls.length) s.rule(`${ROOT}[data-mantine-color-scheme]`, decls.join('; '))
}

/** the rounded-* scale for each radius setting ('lg' is what ships) */
const RADIUS_SCALE: Record<Exclude<ThemeRadius, 'lg'>, Record<string, string>> = {
  sm: { md: '0.25rem', lg: '0.375rem', xl: '0.5rem', '2xl': '0.625rem', '3xl': '0.875rem' },
  md: { md: '0.3125rem', lg: '0.4375rem', xl: '0.625rem', '2xl': '0.8125rem', '3xl': '1.125rem' },
  xl: { md: '0.5rem', lg: '0.75rem', xl: '1rem', '2xl': '1.375rem', '3xl': '1.75rem' },
}

function emitRadius(s: Sheet, radius: Theme['radius']): void {
  if (!radius || radius === 'lg' || !(radius in RADIUS_SCALE)) return
  const scale = RADIUS_SCALE[radius]
  s.rule(ROOT, `--dcs-radius: ${scale.xl}`)
  for (const [step, value] of Object.entries(scale)) {
    s.rule(`${ROOT} .rounded-${step}`, `border-radius: ${value} !important`)
    s.rule(`${ROOT} .rounded-t-${step}`, `border-top-left-radius: ${value} !important; border-top-right-radius: ${value} !important`)
    s.rule(`${ROOT} .rounded-b-${step}`, `border-bottom-left-radius: ${value} !important; border-bottom-right-radius: ${value} !important`)
  }
  s.rule(`${ROOT} .glass, ${ROOT} .glass-subtle, ${ROOT} .glass-card, ${ROOT} .glass-1, ${ROOT} .glass-2, ${ROOT} .glass-3`, `border-radius: ${scale.xl} !important`)
}

function emitFont(s: Sheet, font: string): void {
  const name = font.trim()
  if (!name || !FONT_NAME_RE.test(name)) return
  s.rule(`${ROOT} body`, `font-family: "${name}", 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important`)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const cssCache = new WeakMap<Theme, Partial<Record<ThemeMode, string>>>()

/** the complete override stylesheet for one look of a theme */
export function buildThemeCss(theme: Theme, mode: ThemeMode): string {
  const cached = cssCache.get(theme)?.[mode]
  if (cached !== undefined) return cached
  const stock = stockPalette(mode)
  const p = themeLook(theme, mode)
  const s = new Sheet()

  // the palette as variables, always: custom CSS (a theme's own or the person's) and the studio build on them
  emitVariables(s, theme, p)
  if (!sameNeutrals(p, stock)) emitNeutrals(s, p, mode)
  emitClasses(s, p, stock, mode)
  emitStatus(s, p, stock, mode)
  emitBrand(s, p, stock, mode)
  emitMantine(s, theme, mode, p, stock)
  emitRadius(s, theme.radius)
  emitFont(s, theme.font)

  const parts = [`/* theme: ${theme.name || 'draft'} (${mode}) */`, s.toString()]
  if (theme.css && theme.css.trim()) {
    parts.push(`/* ── ${theme.name || 'draft'}: extra css ── */`, sanitizeCss(theme.css).css)
  }
  const css = parts.join('\n')
  cssCache.set(theme, { ...cssCache.get(theme), [mode]: css })
  return css
}

function ensureStyle(): HTMLStyleElement {
  let el = document.getElementById(THEME_STYLE_ID) as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = THEME_STYLE_ID
    // after Tailwind's sheet and before custom-user-css, so the person's own CSS still wins
    const custom = document.getElementById('custom-user-css')
    if (custom) document.head.insertBefore(el, custom)
    else document.head.appendChild(el)
  }
  return el
}

function setMetaThemeColor(color: string): void {
  const meta = document.querySelector('meta[name="theme-color"]') as HTMLMetaElement | null
  if (meta && meta.content !== color) meta.content = color
}

/** while the studio previews a draft, the periodic re-sync keeps its hands off the document */
let previewing = false
export function setThemePreviewing(on: boolean): void {
  previewing = on
}
export function isThemePreviewing(): boolean {
  return previewing
}

/**
 * Dress the document in one look of a theme — the single place the mode and the
 * palette reach the page: the light/dark class, data-theme, color-scheme (native
 * controls and scrollbars), the page colour, the meta theme-color, the stylesheet.
 */
let appliedPalette: ThemePalette | null = null
/** the palette the page is dressed in right now (null before the first theme is applied) */
export function appliedThemePalette(): ThemePalette | null { return appliedPalette }

export function applyTheme(theme: Theme, mode: ThemeMode): void {
  const html = document.documentElement
  const style = ensureStyle()
  const palette = themeLook(theme, mode)
  appliedPalette = palette
  const light = mode === 'light'
  html.setAttribute('data-theme', theme.name || 'draft')
  html.classList.toggle('light', light)
  html.classList.toggle('dark', !light)
  if (html.style.colorScheme !== mode) html.style.colorScheme = mode
  // the canvas behind everything, so no stylesheet timing shows another colour
  html.style.backgroundColor = palette.bg
  const css = buildThemeCss(theme, mode)
  if (style.textContent !== css) style.textContent = css
  setMetaThemeColor(palette.surface)
}
