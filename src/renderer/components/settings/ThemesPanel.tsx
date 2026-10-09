// =============================================================================
// ThemesPanel — Settings → Themes: the gallery of built-in, server and
// on-this-device themes, the Theme Studio (make or edit one, both looks, with a
// live preview and contrast checks) and Install (paste JSON, pick a file, or
// give an https address). A theme is an identity with a dark and a light look;
// the switch at the top right picks the look.
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Check, Copy, Download, FileJson, Globe, Link, Loader2, Moon, Palette, Pencil, Plus, Server, Smartphone, Sparkles, Sun, Trash2, Upload, Eye, EyeOff, RefreshCw, Wand2 } from 'lucide-react'
import { useToast } from '../common/Toast'
import { useConfirm } from '../common/ConfirmDialog'
import { useSettingsStore } from '../../stores/settingsStore'
import { useAuthStore } from '../../stores/authStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useThemeStore, syncDocumentTheme, themeForMeta, type ThemeSource } from '../../stores/themeStore'
import { applyTheme, setThemePreviewing } from '../../lib/themeEngine'
import { useResolvedMode } from '../../lib/colorMode'
import { CSS_SANITIZE_NOTE, sanitizeCss } from '../../lib/cssSanitize'
import { ApiError } from '../../api/client'
import Hint from '../common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, BTN_ICON, BTN_ICON_SM, BTN_SHEET_QUIET, BTN_SHEET_PRIMARY, TONE_OK, TONE_GHOST, TONE_GHOST_DANGER, FOCUS_RING } from '../../lib/ui'
import { INPUT, LABEL } from '../../lib/fieldStyles'
import {
  type ContrastCheck,
  type PaletteKey,
  type Theme,
  type ThemeMode,
  type ThemePalette,
  type ThemeRadius,
  BUILT_IN_BY_NAME,
  BUILT_IN_LOOK_NAMES,
  BUILT_IN_THEMES,
  HEX_RE,
  PALETTE_LABELS,
  THEME_NAME_RE,
  THEME_RADII,
  blankTheme,
  checkContrast,
  derivePalette,
  isBuiltInCopy,
  normalizeHex,
  themeLooks,
  themeToJson,
  validateTheme,
  withBothLooks,
} from '../../../shared/themes'

import Sheet from '../common/Sheet'
import { Count, Pill } from '../common/Pill'
// ---------------------------------------------------------------------------
// Bits
// ---------------------------------------------------------------------------

/** an inline text button inside a strip of words (Follow the server, Clear for everyone) */
const TEXT_BTN = `h-auto rounded font-medium ${FOCUS_RING}`
/** a two- or three-way switch: the chosen option on a raised surface */
const SEG = 'inline-flex items-center gap-0.5 rounded-lg bg-white/[0.03] border border-white/5 p-0.5'
const SEG_ITEM = 'inline-flex items-center justify-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors'
const SEG_ON = 'bg-slate-800 text-slate-100 shadow-sm'
const SEG_OFF = 'text-slate-500 hover:text-slate-300'

function errorText(err: unknown): string {
  if (err instanceof ApiError) return err.message || `Request failed (${err.status})`
  return err instanceof Error ? err.message : String(err)
}

function slugify(title: string): string {
  const s = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return s.replace(/^[^a-z0-9]+/, '')
}

function downloadJson(name: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${name || 'theme'}.theme.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** what a theme calls its looks ("Mocha" / "Latte" for a built-in family, else Dark / Light) */
function lookName(theme: Theme, mode: ThemeMode): string {
  return BUILT_IN_LOOK_NAMES[theme.name]?.[mode] ?? (mode === 'dark' ? 'Dark' : 'Light')
}

const failing = (checks: ContrastCheck[]) => checks.filter((c) => !c.ok)

/** one look drawn small: page, sidebar, a card, the brand gradient and the four status dots; `marked` = the look showing now */
function LookThumb({ palette: p, marked = false, className = '' }: { palette: ThemePalette; marked?: boolean; className?: string }) {
  const bar = (color: string, w: string, opacity = 1) => (
    <span className={`block h-1 rounded-full ${w}`} style={{ backgroundColor: color, opacity }} />
  )
  return (
    <div
      className={`w-full h-16 rounded-lg overflow-hidden ${className}`}
      style={{ backgroundColor: p.bg, boxShadow: `inset 0 0 0 1px ${p.border}`, ...(marked ? { outline: '2px solid var(--dcs-accent, #34d399)', outlineOffset: 2 } : {}) }}
      aria-hidden
    >
      <div className="flex h-full">
        <div className="w-5 h-full flex flex-col items-center gap-1 pt-1.5" style={{ backgroundColor: p.surface, borderRight: `1px solid ${p.border}` }}>
          <span className="w-2 h-2 rounded-[3px]" style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accentSecondary})` }} />
          <span className="w-2.5 h-1 rounded-full" style={{ backgroundColor: p.accent, opacity: 0.9 }} />
          <span className="w-2.5 h-1 rounded-full" style={{ backgroundColor: p.textMuted, opacity: 0.45 }} />
        </div>
        <div className="flex-1 p-1.5 flex flex-col gap-1 min-w-0">
          <div className="flex items-center gap-1">
            <span className="block h-1.5 w-7 rounded-full" style={{ background: `linear-gradient(90deg, ${p.accent}, ${p.accentSecondary})` }} />
            {bar(p.text, 'w-5', 0.35)}
          </div>
          <div className="flex-1 rounded-md p-1 flex flex-col gap-1" style={{ backgroundColor: p.surface, boxShadow: `inset 0 0 0 1px ${p.border}` }}>
            {bar(p.text, 'w-10', 0.75)}
            {bar(p.textMuted, 'w-12', 0.7)}
            <div className="mt-auto flex items-center gap-0.5">
              {[p.success, p.warning, p.danger, p.info].map((c, i) => (
                <span key={i} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c }} />
              ))}
              <span className="ml-auto h-1.5 w-5 rounded-sm" style={{ backgroundColor: p.surfaceRaised }} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** both looks of a theme side by side; the one the switch shows now is marked */
function LookPair({ theme, mode, onPick }: { theme: Theme; mode: ThemeMode; onPick?: (m: ThemeMode) => void }) {
  const looks = themeLooks(theme)
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {(['dark', 'light'] as ThemeMode[]).map((m) => {
        const on = m === mode
        const body = (
          <>
            <LookThumb palette={looks[m]} marked={on} />
            <span className={`mt-1 flex items-center gap-1 text-[10px] truncate ${on ? 'text-slate-200 font-medium' : 'text-slate-500'}`}>
              {m === 'dark' ? <Moon size={10} className="shrink-0" /> : <Sun size={10} className="shrink-0" />}
              <span className="truncate">{lookName(theme, m)}</span>
              {looks.derived === m && <span className="text-slate-600 font-normal">· derived</span>}
            </span>
          </>
        )
        return onPick ? (
          <button key={m} type="button" onClick={() => onPick(m)} className="text-left min-w-0 rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40" title={`Wear ${theme.title} · ${lookName(theme, m)}`} aria-label={`Wear ${theme.title}, ${lookName(theme, m)}`}>
            {body}
          </button>
        ) : (
          <div key={m} className="min-w-0">{body}</div>
        )
      })}
    </div>
  )
}

function SourceChip({ source }: { source: ThemeSource }) {
  if (source === 'server') return <Pill tone="info" icon={<Server size={10} aria-hidden />}>Server</Pill>
  if (source === 'local') return <Pill icon={<Smartphone size={10} aria-hidden />}>This device</Pill>
  return <Pill icon={<Sparkles size={10} aria-hidden />}>Built in</Pill>
}

// ---------------------------------------------------------------------------
// Theme Studio
// ---------------------------------------------------------------------------

interface StudioProps {
  initial: Theme
  /** editing a theme that already exists (name locked to what is stored) */
  editing: boolean
  isAdmin: boolean
  serverOk: boolean
  onClose: () => void
  onSaved: (theme: Theme, where: 'server' | 'local') => void
}

/** the palette, in the order a person thinks about it */
const GROUPS: Array<{ title: string; keys: PaletteKey[] }> = [
  { title: 'Brand', keys: ['accent', 'accentSecondary'] },
  { title: 'Surfaces', keys: ['bg', 'surface', 'surfaceRaised', 'border'] },
  { title: 'Text', keys: ['text', 'textMuted'] },
  { title: 'Status', keys: ['success', 'warning', 'danger', 'info'] },
]

/** the contrast rules each palette row answers for */
const ROW_RULES: Partial<Record<PaletteKey, string[]>> = {
  accent: ['accent-surface', 'accent-bg'],
  accentSecondary: ['accent2-surface'],
  border: ['border-surface', 'border-bg'],
  text: ['text-bg', 'text-surface', 'text-raised'],
  textMuted: ['muted-bg', 'muted-surface'],
  success: ['success-surface', 'success-bg'],
  warning: ['warning-surface', 'warning-bg'],
  danger: ['danger-surface', 'danger-bg'],
  info: ['info-surface', 'info-bg'],
}

/** the ratio a row reaches (its weakest pair), green when it passes, amber/rose when it does not */
function RowContrast({ checks }: { checks: ContrastCheck[] }) {
  if (!checks.length) return null
  const worst = checks.reduce((a, b) => (b.ratio / b.min < a.ratio / a.min ? b : a))
  const ok = checks.every((c) => c.ok)
  const cls = ok ? 'text-emerald-400' : worst.ratio >= worst.min * 0.8 ? 'text-amber-400' : 'text-rose-400'
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${cls}`} title={checks.map((c) => `${c.label}: ${c.ratio.toFixed(2)}:1 (needs ${c.min}:1)`).join('\n')}>
      {ok ? <Check size={10} /> : <AlertTriangle size={10} />}
      {worst.ratio.toFixed(1)}:1
    </span>
  )
}

function ThemeStudio({ initial, editing, isAdmin, serverOk, onClose, onSaved }: StudioProps) {
  const { addToast } = useToast()
  const saveServer = useThemeStore((s) => s.save)
  const saveLocal = useThemeStore((s) => s.saveLocal)
  const showing = useResolvedMode()
  // the draft always carries both looks; `palette` follows `mode` when it is saved
  const [draft, setDraft] = useState<Theme>(() => withBothLooks(initial))
  const [look, setLook] = useState<ThemeMode>(showing)
  const lookKey = look === 'dark' ? 'palette_dark' : 'palette_light'
  const other: ThemeMode = look === 'dark' ? 'light' : 'dark'
  const p = draft[lookKey] as ThemePalette
  const [hexText, setHexText] = useState<Record<string, string>>(() => ({ ...p }))
  const [nameTouched, setNameTouched] = useState(editing || !!initial.name)
  const [preview, setPreview] = useState(true)
  const [derived, setDerived] = useState<ThemePalette | null>(null)
  const [saving, setSaving] = useState<'server' | 'local' | null>(null)
  const [errors, setErrors] = useState<string[]>([])

  // the hex fields show the look being edited
  useEffect(() => { setHexText({ ...(draft[lookKey] as ThemePalette) }); setDerived(null) }, [look]) // eslint-disable-line react-hooks/exhaustive-deps

  const update = useCallback(<K extends keyof Theme>(key: K, value: Theme[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }, [])

  const setColor = useCallback((key: PaletteKey, value: string) => {
    setHexText((h) => ({ ...h, [key]: value }))
    const norm = normalizeHex(value)
    if (HEX_RE.test(norm)) setDraft((d) => ({ ...d, [lookKey]: { ...(d[lookKey] as ThemePalette), [key]: norm } }))
  }, [lookKey])

  // Live preview: the whole dashboard wears the draft, in the look being edited; closing puts the real look back
  useEffect(() => {
    if (!preview) { setThemePreviewing(false); syncDocumentTheme(); return }
    setThemePreviewing(true)
    const t = setTimeout(() => applyTheme(draft, look), 60)
    return () => clearTimeout(t)
  }, [draft, look, preview])
  useEffect(() => () => { setThemePreviewing(false); syncDocumentTheme() }, [])

  const validation = useMemo(() => validateTheme(withBothLooks(draft)), [draft])
  const sanitized = useMemo(() => sanitizeCss(draft.css), [draft.css])
  const checks = useMemo(() => checkContrast(p), [p])
  const otherChecks = useMemo(() => checkContrast(draft[other === 'dark' ? 'palette_dark' : 'palette_light'] as ThemePalette), [draft, other])
  const byId = useMemo(() => Object.fromEntries(checks.map((c) => [c.id, c])), [checks])

  const finalTheme = (): Theme | null => {
    const v = validateTheme(withBothLooks(draft))
    if (!v.ok || !v.theme) { setErrors(v.errors); return null }
    setErrors([])
    return v.theme
  }

  const commit = async (where: 'server' | 'local') => {
    const theme = finalTheme()
    if (!theme) return
    setSaving(where)
    try {
      if (where === 'server') {
        const res = await saveServer(theme)
        if (res.stripped && res.stripped.length) addToast({ type: 'info', message: `Saved, with a note: ${res.stripped.join('; ')}` })
        else addToast({ type: 'success', message: `${theme.title} ${res.replaced ? 'updated on' : 'saved to'} the server` })
        onSaved(res.theme, 'server')
      } else {
        saveLocal(theme)
        addToast({ type: 'success', message: `${theme.title} saved on this device` })
        onSaved(theme, 'local')
      }
    } catch (err) {
      addToast({ type: 'error', message: `Could not save the theme: ${errorText(err)}` })
    } finally {
      setSaving(null)
    }
  }

  const exportFile = () => {
    const theme = finalTheme()
    if (theme) downloadJson(theme.name, themeToJson(theme))
  }
  const copyJson = async () => {
    const theme = finalTheme()
    if (!theme) return
    try {
      await navigator.clipboard.writeText(themeToJson(theme))
      addToast({ type: 'success', message: 'Theme JSON copied' })
    } catch {
      addToast({ type: 'error', message: 'Could not copy to the clipboard' })
    }
  }

  const applyDerived = () => {
    if (!derived) return
    setDraft((d) => ({ ...d, [other === 'dark' ? 'palette_dark' : 'palette_light']: derived }))
    setDerived(null)
    addToast({ type: 'success', message: `The ${other} look was made from the ${look} one` })
  }

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 mr-auto">
        <button type="button" onClick={() => setPreview((v) => !v)} className={`${BTN_TOOLBAR} ${TONE_GHOST}`} aria-pressed={preview} title={preview ? 'The dashboard shows the draft; click to stop' : 'Show the draft on the dashboard'}>
          {preview ? <Eye size={14} className="text-emerald-400" /> : <EyeOff size={14} />} {preview ? 'Previewing' : 'Preview off'}
        </button>
        <Hint label="Copy the JSON"><button type="button" onClick={copyJson} className={`${BTN_ICON} ${TONE_GHOST}`} aria-label="Copy the JSON"><Copy size={14} /></button></Hint>
        <Hint label="Save as a file"><button type="button" onClick={exportFile} className={`${BTN_ICON} ${TONE_GHOST}`} aria-label="Save as a file"><Download size={14} /></button></Hint>
      </div>
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} flex-auto sm:flex-none`}>Cancel</button>
        <button type="button" onClick={() => commit('local')} disabled={!!saving} className={`${isAdmin && serverOk ? BTN_SHEET_QUIET : BTN_SHEET_PRIMARY} flex-auto sm:flex-none`}>
          {saving === 'local' ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />} Save on this device
        </button>
        {isAdmin && serverOk && (
          <button type="button" onClick={() => commit('server')} disabled={!!saving} className={`${BTN_SHEET_PRIMARY} flex-auto sm:flex-none`}>
            {saving === 'server' ? <Loader2 size={16} className="animate-spin" /> : <Server size={16} />} Save to server
          </button>
        )}
      </div>
    </div>
  )

  const lookTab = (m: ThemeMode) => {
    const bad = failing(m === look ? checks : otherChecks).length
    return (
      <button key={m} type="button" role="tab" aria-selected={look === m} onClick={() => setLook(m)} className={`${SEG_ITEM} ${look === m ? SEG_ON : SEG_OFF}`}>
        {m === 'dark' ? <Moon size={13} /> : <Sun size={13} />}
        {m === 'dark' ? 'Dark look' : 'Light look'}
        {bad > 0 && <Count n={bad} tone="attention" label={`${bad} contrast ${bad === 1 ? 'warning' : 'warnings'}`} className="ml-0.5" />}
      </button>
    )
  }

  return (
    <Sheet placement="side" tone="neutral" title={editing ? `Edit ${initial.title || initial.name}` : 'New theme'} icon={<Palette size={16} className="accent-text" />} onClose={onClose} footer={footer} wide keepOnBackdrop>
      <div className="space-y-5">
        {/* Identity */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="studio-title" className={LABEL}>Title</label>
            <input
              id="studio-title"
              type="text"
              value={draft.title}
              placeholder="Midnight Teal"
              onChange={(e) => {
                const title = e.target.value
                setDraft((d) => ({ ...d, title, name: nameTouched ? d.name : slugify(title) }))
              }}
              className={INPUT}
            />
          </div>
          <div>
            <label htmlFor="studio-name" className={LABEL}>Name <span className="text-slate-600">(a-z, 0-9, dashes)</span></label>
            <input
              id="studio-name"
              type="text"
              value={draft.name}
              placeholder="midnight-teal"
              disabled={editing}
              onChange={(e) => { setNameTouched(true); update('name', e.target.value.toLowerCase()) }}
              className={`${INPUT} font-mono ${draft.name && !THEME_NAME_RE.test(draft.name) ? 'border-rose-500/40' : ''} disabled:opacity-60`}
            />
          </div>
          <div className="sm:col-span-2">
            <label htmlFor="studio-description" className={LABEL}>Description</label>
            <input id="studio-description" type="text" value={draft.description} placeholder="One line about the mood" onChange={(e) => update('description', e.target.value)} className={INPUT} />
          </div>
        </div>

        {/* The two looks */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className={SEG} role="tablist" aria-label="Look to edit">{(['dark', 'light'] as ThemeMode[]).map(lookTab)}</div>
            <button type="button" onClick={() => setDerived(derived ? null : derivePalette(p, look))} className={`${BTN_TOOLBAR} ${TONE_GHOST}`} title={`Build the ${other} look from the ${look} one: same hues, the readable lightness for a ${other} page`}>
              <Wand2 size={14} /> Make the {other} look from this one
            </button>
          </div>

          {derived && (
            <div className="rounded-xl bg-white/[0.03] border border-white/10 p-3 space-y-2.5 animate-fade-in">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Now</p>
                  <LookThumb palette={draft[other === 'dark' ? 'palette_dark' : 'palette_light'] as ThemePalette} />
                </div>
                <div>
                  <p className="text-[10px] text-slate-500 mb-1">Made from the {look} look</p>
                  <LookThumb palette={derived} marked />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] text-slate-400 mr-auto">{failing(checkContrast(derived)).length === 0 ? 'Every pair reaches AA contrast.' : `${failing(checkContrast(derived)).length} contrast warnings.`}</p>
                <button type="button" onClick={() => setDerived(null)} className={`${BTN_TOOLBAR} ${TONE_GHOST}`}>Keep the current one</button>
                <button type="button" onClick={applyDerived} className={`${BTN_TOOLBAR} ${TONE_OK}`}><Check size={14} /> Use it</button>
              </div>
            </div>
          )}

          <div className="rounded-xl bg-white/[0.03] border border-white/5 overflow-hidden">
            {GROUPS.map((group) => (
              <div key={group.title} className="border-b border-white/[0.04] last:border-b-0">
                <p className="px-3 pt-2.5 pb-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500">{group.title}</p>
                {group.keys.map((key) => {
                  const rowChecks = (ROW_RULES[key] ?? []).map((id) => byId[id]).filter(Boolean) as ContrastCheck[]
                  return (
                    <div key={key} className="flex items-center gap-3 px-3 py-1.5">
                      <label className="relative w-8 h-8 shrink-0 rounded-md overflow-hidden cursor-pointer" style={{ backgroundColor: p[key], boxShadow: `inset 0 0 0 1px ${p.border}` }} title="Pick a colour">
                        <input
                          type="color"
                          value={p[key]}
                          onChange={(e) => setColor(key, e.target.value)}
                          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                          aria-label={`${PALETTE_LABELS[key].label} colour`}
                        />
                      </label>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-slate-200 font-medium">{PALETTE_LABELS[key].label}</span>
                          <RowContrast checks={rowChecks} />
                        </div>
                        <div className="text-[10px] text-slate-500 truncate">{PALETTE_LABELS[key].hint}</div>
                      </div>
                      <input
                        type="text"
                        value={hexText[key] ?? p[key]}
                        onChange={(e) => setColor(key, e.target.value)}
                        onBlur={() => setHexText((h) => ({ ...h, [key]: p[key] }))}
                        spellCheck={false}
                        className={`${INPUT} !w-24 font-mono text-center ${HEX_RE.test(normalizeHex(hexText[key] ?? '')) ? '' : 'border-rose-500/40'}`}
                        aria-label={`${PALETTE_LABELS[key].label} hex`}
                      />
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          {failing(checks).length > 0 && (
            <p className="text-[11px] text-amber-400 flex items-start gap-1.5">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              <span>Hard to read in the {look} look: {failing(checks).map((c) => `${c.label.toLowerCase()} ${c.ratio.toFixed(1)}:1`).join(', ')}.</span>
            </p>
          )}
        </div>

        {/* Details */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="studio-author" className={LABEL}>Author</label>
            <input id="studio-author" type="text" value={draft.author} placeholder="Your name" onChange={(e) => update('author', e.target.value)} className={INPUT} />
          </div>
          <div>
            <label htmlFor="studio-version" className={LABEL}>Version</label>
            <input id="studio-version" type="text" value={draft.version} placeholder="1.0.0" onChange={(e) => update('version', e.target.value)} className={`${INPUT} font-mono`} />
          </div>
          <div>
            <label htmlFor="studio-font" className={LABEL}>Font <span className="text-slate-600">(installed on the device)</span></label>
            <input id="studio-font" type="text" value={draft.font} placeholder="Inter" onChange={(e) => update('font', e.target.value)} className={INPUT} />
          </div>
          <div>
            <span id="studio-roundness-label" className={LABEL}>Roundness</span>
            <div className={`${SEG} w-full`} role="radiogroup" aria-labelledby="studio-roundness-label">
              {([...THEME_RADII] as ThemeRadius[]).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={(draft.radius || 'lg') === r} onClick={() => update('radius', r === 'lg' ? '' : r)} className={`${SEG_ITEM} flex-1 uppercase ${(draft.radius || 'lg') === r ? SEG_ON : SEG_OFF}`}>{r}</button>
              ))}
            </div>
          </div>
          <div className="sm:col-span-2">
            <span id="studio-mainlook-label" className={LABEL}>Main look</span>
            <div className="flex flex-wrap items-center gap-2">
              <div className={SEG} role="radiogroup" aria-labelledby="studio-mainlook-label">
                {(['dark', 'light'] as ThemeMode[]).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={draft.mode === m} onClick={() => update('mode', m)} className={`${SEG_ITEM} ${draft.mode === m ? SEG_ON : SEG_OFF}`}>
                    {m === 'dark' ? <Moon size={13} /> : <Sun size={13} />} {m === 'dark' ? 'Dark' : 'Light'}
                  </button>
                ))}
              </div>
              <span className="text-[10px] text-slate-500">Dashboards older than 4.0 show only this one.</span>
            </div>
          </div>
        </div>

        {/* Extra CSS */}
        <div>
          <label htmlFor="studio-css" className={LABEL}>Extra CSS <span className="text-slate-600">(optional, up to 64 KB, both looks)</span></label>
          <textarea
            id="studio-css"
            value={draft.css}
            onChange={(e) => update('css', e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder={'/* the look\'s colours are variables */\n.glass { box-shadow: 0 0 0 1px var(--dcs-border); }'}
            className="w-full px-4 py-3 bg-slate-950 border border-white/10 rounded-xl text-xs text-emerald-400 placeholder-slate-700 font-mono focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 resize-y transition-all leading-relaxed"
          />
          <p className="text-[10px] text-slate-500 mt-1">
            {CSS_SANITIZE_NOTE}
            {sanitized.stripped.length > 0 && <span className="text-amber-400"> Removed here: {sanitized.stripped.join(', ')}.</span>}
            {' '}Variables: --dcs-accent, --dcs-accent-secondary, --dcs-bg, --dcs-surface, --dcs-surface-raised, --dcs-border, --dcs-text, --dcs-text-muted, --dcs-success, --dcs-warning, --dcs-danger, --dcs-info, --dcs-radius; html.light is set in the light look.
          </p>
        </div>

        {(errors.length > 0 || (!validation.ok && (draft.name || draft.title))) && (
          <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[11px] text-rose-300 space-y-0.5">
            {(errors.length ? errors : validation.errors).map((e) => <div key={e}>{e}</div>)}
          </div>
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Install
// ---------------------------------------------------------------------------

type InstallTab = 'paste' | 'file' | 'url'

interface InstallProps {
  isAdmin: boolean
  serverOk: boolean
  onClose: () => void
  onInstalled: (theme: Theme, where: 'server' | 'local') => void
}

function InstallSheet({ isAdmin, serverOk, onClose, onInstalled }: InstallProps) {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const showing = useResolvedMode()
  const metas = useThemeStore((s) => s.metas)
  const localThemes = useThemeStore((s) => s.localThemes)
  const saveServer = useThemeStore((s) => s.save)
  const saveLocal = useThemeStore((s) => s.saveLocal)
  const importFromUrl = useThemeStore((s) => s.importFromUrl)
  const canServer = isAdmin && serverOk
  const [tab, setTab] = useState<InstallTab>('paste')
  const [where, setWhere] = useState<'server' | 'local'>(canServer ? 'server' : 'local')
  const [text, setText] = useState('')
  const [url, setUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // what the pasted / picked document validates to
  const parsed = useMemo(() => {
    if (!text.trim()) return null
    try {
      return validateTheme(JSON.parse(text))
    } catch {
      return { ok: false, errors: ['That is not valid JSON'], theme: null }
    }
  }, [text])

  const readFile = (file: File | undefined) => {
    if (!file) return
    setFileName(file.name)
    const reader = new FileReader()
    reader.onload = () => setText(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => addToast({ type: 'error', message: `Could not read ${file.name}` })
    reader.readAsText(file)
  }

  const installDocument = async (theme: Theme) => {
    if (where === 'server') {
      if (metas.some((m) => m.name === theme.name)) {
        const ok = await confirm({ danger: true, title: 'Replace the server theme?', message: `A theme named "${theme.name}" is stored on the server already. Installing replaces it for everyone who follows it.`, confirmLabel: 'Replace' })
        if (!ok) return
      }
      const res = await saveServer(theme)
      if (res.stripped && res.stripped.length) addToast({ type: 'info', message: `Installed, with a note: ${res.stripped.join('; ')}` })
      else addToast({ type: 'success', message: `${theme.title} installed on the server` })
      onInstalled(res.theme, 'server')
    } else {
      if (localThemes.some((t) => t.name === theme.name)) {
        const ok = await confirm({ danger: true, title: 'Replace the theme on this device?', message: `You already have a theme named "${theme.name}" on this device.`, confirmLabel: 'Replace' })
        if (!ok) return
      }
      saveLocal(theme)
      addToast({ type: 'success', message: `${theme.title} installed on this device` })
      onInstalled(theme, 'local')
    }
  }

  const install = async () => {
    setBusy(true)
    try {
      if (tab === 'url') {
        const u = url.trim()
        if (!/^https:\/\//i.test(u)) { addToast({ type: 'warning', message: 'Give an https address of a theme JSON file' }); return }
        if (where === 'server') {
          try {
            const res = await importFromUrl(u)
            if (res.stripped && res.stripped.length) addToast({ type: 'info', message: `Installed, with a note: ${res.stripped.join('; ')}` })
            else addToast({ type: 'success', message: `${res.theme.title} installed on the server` })
            onInstalled(res.theme, 'server')
          } catch (err) {
            if (err instanceof ApiError && err.status === 409) {
              const ok = await confirm({ danger: true, title: 'Replace the server theme?', message: `${err.message}\n\nReplace it for everyone who follows it?`, confirmLabel: 'Replace' })
              if (!ok) return
              const res = await importFromUrl(u, true)
              addToast({ type: 'success', message: `${res.theme.title} replaced on the server` })
              onInstalled(res.theme, 'server')
            } else {
              throw err
            }
          }
        } else {
          // no server import for this person: the browser fetches it (the site must allow cross-origin reads)
          const resp = await fetch(u, { headers: { Accept: 'application/json' } })
          if (!resp.ok) throw new Error(`The address answered ${resp.status}`)
          const body = await resp.text()
          if (body.length > 262144) throw new Error('The document is larger than 256 KB')
          const v = validateTheme(JSON.parse(body))
          if (!v.ok || !v.theme) { addToast({ type: 'error', message: `Not a theme: ${v.errors[0]}` }); return }
          await installDocument(v.theme)
        }
        return
      }
      if (!parsed || !parsed.ok || !parsed.theme) {
        addToast({ type: 'warning', message: parsed?.errors[0] ?? 'Paste a theme document or pick a file first' })
        return
      }
      await installDocument(parsed.theme)
    } catch (err) {
      addToast({ type: 'error', message: `Could not install the theme: ${errorText(err)}` })
    } finally {
      setBusy(false)
    }
  }

  const tabs: Array<{ id: InstallTab; label: string; icon: React.ReactNode }> = [
    { id: 'paste', label: 'Paste JSON', icon: <FileJson size={14} /> },
    { id: 'file', label: 'From file', icon: <Upload size={14} /> },
    { id: 'url', label: 'From URL', icon: <Link size={14} /> },
  ]

  const footer = (
    <div className="flex flex-wrap items-center gap-2">
      {canServer ? (
        <div className={`${SEG} mr-auto`}>
          {(['server', 'local'] as const).map((w) => (
            <button key={w} type="button" onClick={() => setWhere(w)} className={`${SEG_ITEM} ${where === w ? SEG_ON : SEG_OFF}`}>
              {w === 'server' ? <Server size={13} /> : <Smartphone size={13} />} {w === 'server' ? 'Server' : 'This device'}
            </button>
          ))}
        </div>
      ) : (
        <span className="text-[10px] text-slate-500 mr-auto inline-flex items-center gap-1"><Smartphone size={12} /> Installs on this device{isAdmin ? ' (this server cannot store themes)' : ''}</span>
      )}
      <button type="button" onClick={onClose} className={`${BTN_SHEET_QUIET} flex-auto sm:flex-none`}>Cancel</button>
      <button type="button" onClick={install} disabled={busy} className={`${BTN_SHEET_PRIMARY} flex-auto sm:flex-none`}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />} Install
      </button>
    </div>
  )

  return (
    <Sheet placement="side" tone="neutral" title="Install a theme" icon={<Download size={16} className="text-cyan-400" />} onClose={onClose} footer={footer}>
      <div className="space-y-4">
        <div className={`${SEG} w-full`} role="tablist">
          {tabs.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`${SEG_ITEM} flex-1 ${tab === t.id ? SEG_ON : SEG_OFF}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {tab === 'paste' && (
          <textarea
            aria-label="Theme JSON"
            value={text}
            onChange={(e) => { setText(e.target.value); setFileName('') }}
            rows={12}
            spellCheck={false}
            placeholder={'{ "schema": 1, "name": "midnight-teal", "title": "Midnight Teal", "mode": "dark",\n  "palette_dark": { "accent": "#2dd4bf", "bg": "#0b1020", "surface": "#111a2e", "text": "#e6edf7" },\n  "palette_light": { "accent": "#0f766e", "bg": "#f1f5f9", "surface": "#ffffff", "text": "#0f172a" } }'}
            className="w-full px-4 py-3 bg-slate-950 border border-white/10 rounded-xl text-xs text-slate-200 placeholder-slate-700 font-mono focus:outline-none focus:border-emerald-500/50 resize-y transition-all leading-relaxed"
          />
        )}

        {tab === 'file' && (
          <div
            className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center cursor-pointer hover:border-emerald-500/30 hover:bg-white/[0.04] transition-all"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); readFile(e.dataTransfer.files?.[0]) }}
          >
            <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
            <Upload size={20} className="mx-auto text-slate-500 mb-2" />
            <p className="text-xs text-slate-300">{fileName || 'Pick a .theme.json file, or drop it here'}</p>
            <p className="text-[10px] text-slate-500 mt-1">Saved by the Theme Studio, or exported from another dashboard</p>
          </div>
        )}

        {tab === 'url' && (
          <div>
            <label htmlFor="install-url" className={LABEL}>https address of the theme JSON</label>
            <input id="install-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://example.com/themes/midnight-teal.json" className={`${INPUT} font-mono`} />
            <p className="text-[10px] text-slate-500 mt-1">
              {where === 'server' ? 'The server fetches it (256 KB at most) and stores it.' : 'Fetched by this browser; the site must allow cross-origin reads.'}
            </p>
          </div>
        )}

        {tab !== 'url' && parsed && (
          parsed.ok && parsed.theme ? (
            <div className="rounded-xl bg-white/[0.03] border border-white/5 p-3 space-y-2.5">
              <LookPair theme={parsed.theme} mode={showing} />
              <div className="min-w-0">
                <div className="text-xs font-semibold text-slate-100 truncate">{parsed.theme.title}</div>
                <div className="text-[10px] text-slate-500 font-mono truncate">{parsed.theme.name} · v{parsed.theme.version}{parsed.theme.author ? ` · ${parsed.theme.author}` : ''}</div>
                {parsed.theme.description && <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-2">{parsed.theme.description}</div>}
                {themeLooks(parsed.theme).derived && <div className="text-[10px] text-slate-500 mt-0.5">It carries one look; the {themeLooks(parsed.theme).derived} one is made from it.</div>}
                {parsed.theme.css && <div className="text-[10px] text-amber-400 mt-0.5">Carries extra CSS ({(parsed.theme.css.length / 1024).toFixed(1)} KB), sanitised before use.</div>}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 px-3 py-2 text-[11px] text-rose-300 space-y-0.5">
              {parsed.errors.map((e) => <div key={e}>{e}</div>)}
            </div>
          )
        )}
      </div>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// The gallery
// ---------------------------------------------------------------------------

interface Entry {
  theme: Theme
  source: ThemeSource
}

export default function ThemesPanel() {
  const { addToast } = useToast()
  const confirm = useConfirm()
  const isAdmin = useAuthStore((s) => s.userRole) === 'admin'
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const themeName = useSettingsStore((s) => s.themeName)
  const serverThemeActive = useSettingsStore((s) => s.serverThemeActive)
  const updateSetting = useSettingsStore((s) => s.updateSetting)
  const showing = useResolvedMode()
  const supported = useThemeStore((s) => s.supported)
  const metas = useThemeStore((s) => s.metas)
  const docs = useThemeStore((s) => s.docs)
  const localThemes = useThemeStore((s) => s.localThemes)
  const loading = useThemeStore((s) => s.loading)
  const storeError = useThemeStore((s) => s.error)
  const refresh = useThemeStore((s) => s.refresh)
  const ensureDoc = useThemeStore((s) => s.ensureDoc)
  const saveServer = useThemeStore((s) => s.save)
  const removeServer = useThemeStore((s) => s.remove)
  const removeLocal = useThemeStore((s) => s.removeLocal)
  const setActive = useThemeStore((s) => s.setActive)

  const serverOk = isConnected && supported === true
  const fallback = serverThemeActive || BUILT_IN_THEMES[0].name
  const effective = themeName || fallback
  /** a personal choice that differs from what the person would wear without one */
  const ownChoice = !!themeName && themeName !== fallback

  const [studio, setStudio] = useState<{ theme: Theme; editing: boolean } | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [working, setWorking] = useState<string | null>(null)

  const entries = useMemo<Entry[]>(() => {
    const byName = new Map<string, Entry>()
    for (const b of BUILT_IN_THEMES) byName.set(b.name, { theme: b, source: 'built-in' })
    for (const m of metas) {
      const theme = docs[m.name] ?? themeForMeta(m)
      // a server copy of a built-in ("Set for everyone") is that built-in: its card stands for it
      if (BUILT_IN_BY_NAME[m.name] && !m.has_css && isBuiltInCopy(theme)) continue
      byName.set(m.name, { theme, source: 'server' })
    }
    for (const l of localThemes) byName.set(l.name, { theme: l, source: 'local' })
    const order = (e: Entry) => (e.source === 'built-in' ? 0 : e.source === 'server' ? 1 : 2)
    const builtInIndex = new Map(BUILT_IN_THEMES.map((b, i) => [b.name, i]))
    return [...byName.values()].sort((a, b) => {
      const oa = order(a)
      const ob = order(b)
      if (oa !== ob) return oa - ob
      if (oa === 0) return (builtInIndex.get(a.theme.name) ?? 0) - (builtInIndex.get(b.theme.name) ?? 0)
      return a.theme.title.localeCompare(b.theme.title)
    })
  }, [metas, docs, localThemes])

  const titleOf = (name: string) => entries.find((e) => e.theme.name === name)?.theme.title ?? name

  const use = (name: string, mode?: ThemeMode) => {
    if (name !== themeName) updateSetting('themeName', name)
    if (mode && mode !== showing) updateSetting('theme', mode)
    const entry = entries.find((e) => e.theme.name === name)
    addToast({ type: 'success', message: `Now wearing ${titleOf(name)}${entry ? ` · ${lookName(entry.theme, mode ?? showing)}` : ''}` })
  }
  const followServer = () => {
    updateSetting('themeName', '')
    addToast({ type: 'info', message: serverThemeActive ? `Following the server's theme, ${titleOf(serverThemeActive)}` : 'Back to DCS Emerald' })
  }

  /** the full document (css included) for a server theme before editing, duplicating or exporting it */
  const fullDoc = async (entry: Entry): Promise<Theme> => {
    if (entry.source !== 'server') return entry.theme
    const meta = metas.find((m) => m.name === entry.theme.name)
    if (!meta?.has_css || docs[entry.theme.name]) return docs[entry.theme.name] ?? entry.theme
    return (await ensureDoc(entry.theme.name)) ?? entry.theme
  }

  const setForEveryone = async (entry: Entry) => {
    setWorking(entry.theme.name)
    try {
      const doc = await fullDoc(entry)
      if (entry.source !== 'server') {
        // the server only activates a theme it stores: put the document there first, under the same name
        const stored = metas.find((m) => m.name === doc.name)
        if (stored && !(entry.source === 'built-in' && isBuiltInCopy(themeForMeta(stored)))) {
          const ok = await confirm({ danger: true, title: 'Replace the server copy?', message: `The server already stores a theme named "${doc.name}". Setting this one for everyone replaces it.`, confirmLabel: 'Replace and set' })
          if (!ok) return
        }
        await saveServer(doc)
      }
      await setActive(doc.name)
      addToast({ type: 'success', message: `Everyone now follows ${doc.title}` })
    } catch (err) {
      addToast({ type: 'error', message: `Could not set the theme for everyone: ${errorText(err)}` })
    } finally {
      setWorking(null)
    }
  }

  const clearForEveryone = async () => {
    setWorking('__clear')
    try {
      await setActive('')
      addToast({ type: 'info', message: 'The server sets no theme now' })
    } catch (err) {
      addToast({ type: 'error', message: `Could not clear the server theme: ${errorText(err)}` })
    } finally {
      setWorking(null)
    }
  }

  const edit = async (entry: Entry) => {
    const doc = await fullDoc(entry)
    setStudio({ theme: doc, editing: true })
  }
  const duplicate = async (entry: Entry) => {
    const doc = await fullDoc(entry)
    setStudio({ theme: { ...withBothLooks(doc), name: slugify(`${doc.name}-copy`), title: `${doc.title} copy`, author: '', version: '1.0.0', updated_at: undefined }, editing: false })
  }
  const exportJson = async (entry: Entry) => {
    const doc = await fullDoc(entry)
    downloadJson(doc.name, themeToJson(doc))
  }
  const copyJson = async (entry: Entry) => {
    const doc = await fullDoc(entry)
    try {
      await navigator.clipboard.writeText(themeToJson(doc))
      addToast({ type: 'success', message: `${doc.title} JSON copied` })
    } catch {
      addToast({ type: 'error', message: 'Could not copy to the clipboard' })
    }
  }
  const remove = async (entry: Entry) => {
    const ok = await confirm({
      title: entry.source === 'server' ? 'Delete this theme from the server?' : 'Delete this theme from this device?',
      message: entry.source === 'server'
        ? `"${entry.theme.title}" goes away for everyone; dashboards following it go back to DCS Emerald.`
        : `"${entry.theme.title}" is removed from this browser.`,
      confirmLabel: 'Delete',
      danger: true,
    })
    if (!ok) return
    setWorking(entry.theme.name)
    try {
      if (entry.source === 'server') await removeServer(entry.theme.name)
      else removeLocal(entry.theme.name)
      if (themeName === entry.theme.name) updateSetting('themeName', '')
      addToast({ type: 'success', message: `${entry.theme.title} deleted` })
    } catch (err) {
      addToast({ type: 'error', message: `Could not delete the theme: ${errorText(err)}` })
    } finally {
      setWorking(null)
    }
  }

  const onSaved = (theme: Theme) => {
    setStudio(null)
    setInstallOpen(false)
    // the person was looking at it: keep wearing it
    updateSetting('themeName', theme.name)
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <p className="flex-1 min-w-[12rem] text-[11px] text-slate-500">
          Every theme has a dark and a light look; the switch at the top right picks one. Themes travel as small JSON documents.
        </p>
        <div className="flex items-center gap-2">
          {isConnected && supported !== false && (
            <Hint label="Read the server's themes again">
              <button type="button" onClick={() => refresh()} className={`${BTN_ICON} ${TONE_GHOST}`} aria-label="Refresh the server's themes">
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              </button>
            </Hint>
          )}
          <button type="button" onClick={() => setInstallOpen(true)} className={BTN_TOOLBAR_QUIET}><Download size={14} /> Install</button>
          <button type="button" onClick={() => setStudio({ theme: blankTheme(showing), editing: false })} className={`${BTN_TOOLBAR} ${TONE_OK}`}><Plus size={14} /> New theme</button>
        </div>
      </div>

      {/* Where the look comes from */}
      <div className="rounded-lg bg-white/[0.03] border border-white/5 px-3 py-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-slate-300">
          <Globe size={12} className="text-cyan-400 shrink-0" />
          {supported === false
            ? 'This server cannot share themes yet (DCS 3.9.2 or newer can); built-in and on-device themes work.'
            : serverThemeActive
              ? <span>Everyone follows <span className="text-slate-100 font-medium">{titleOf(serverThemeActive)}</span></span>
              : 'The server sets no theme; everyone starts on DCS Emerald.'}
        </span>
        {ownChoice && (
          <span className="inline-flex items-center gap-1.5 text-slate-400 sm:border-l sm:border-white/10 sm:pl-3">
            You wear <span className="text-slate-200 font-medium">{titleOf(themeName)}</span>
            <button type="button" onClick={followServer} className={`${TEXT_BTN} text-emerald-400 hover:text-emerald-300`}>{serverThemeActive ? 'Follow the server' : 'Back to DCS Emerald'}</button>
          </span>
        )}
        {isAdmin && serverOk && serverThemeActive && (
          <button type="button" onClick={clearForEveryone} disabled={working === '__clear'} className={`${TEXT_BTN} ml-auto text-slate-400 hover:text-rose-400`}>Clear for everyone</button>
        )}
        {storeError && <span className="text-amber-400 w-full">Could not read the server's themes: {storeError}</span>}
      </div>

      {/* Gallery */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-3">
        {entries.map((entry) => {
          const t = entry.theme
          const isEffective = effective === t.name
          const isServerActive = serverThemeActive === t.name
          const busy = working === t.name
          const canManage = entry.source === 'local' || (entry.source === 'server' && isAdmin && serverOk)
          return (
            <div
              key={`${entry.source}:${t.name}`}
              className={`group rounded-xl bg-white/[0.03] border p-3 flex flex-col gap-2.5 transition-colors ${isEffective ? 'border-emerald-500/30 ring-1 ring-emerald-500/20' : 'border-white/5 hover:border-white/10'}`}
            >
              <LookPair theme={t} mode={showing} onPick={(m) => use(t.name, m)} />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-xs font-semibold text-slate-100 truncate">{t.title}</span>
                  {isEffective && <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 shrink-0"><Check size={10} /> Wearing</span>}
                </div>
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 min-w-0">
                  <SourceChip source={entry.source} />
                  {isServerActive && <span className="inline-flex items-center gap-1 text-cyan-400"><Globe size={10} /> Everyone</span>}
                  {t.author && entry.source !== 'built-in' && <span className="truncate">by {t.author}</span>}
                </div>
                {t.description && <p className="text-[10px] text-slate-500 mt-1 line-clamp-2">{t.description}</p>}
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1.5">
                {/* the worn card needs no button: the line above says how to go back */}
                {!isEffective && (
                  <button type="button" onClick={() => use(t.name)} className={`${BTN_CARD} ${TONE_OK}`} aria-label={`Use ${t.title}`}><Check size={12} /> Use</button>
                )}
                {isAdmin && serverOk && !isServerActive && (
                  <button type="button" onClick={() => setForEveryone(entry)} disabled={busy} className={BTN_CARD_QUIET} aria-label={`Set ${t.title} for everyone`} title="Every dashboard on this server follows it">
                    {busy ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />} For everyone
                  </button>
                )}
                <div className="ml-auto flex items-center">
                  {canManage && <Hint label="Edit"><button type="button" onClick={() => edit(entry)} className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label={`Edit ${t.title}`}><Pencil size={14} /></button></Hint>}
                  <Hint label="Duplicate into the studio"><button type="button" onClick={() => duplicate(entry)} className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label={`Duplicate ${t.title}`}><Plus size={14} /></button></Hint>
                  <Hint label="Copy the JSON"><button type="button" onClick={() => copyJson(entry)} className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label={`Copy the JSON of ${t.title}`}><Copy size={14} /></button></Hint>
                  <Hint label="Save the JSON as a file"><button type="button" onClick={() => exportJson(entry)} className={`${BTN_ICON_SM} ${TONE_GHOST}`} aria-label={`Save the JSON of ${t.title} as a file`}><FileJson size={14} /></button></Hint>
                  {canManage && <Hint label="Delete"><button type="button" onClick={() => remove(entry)} disabled={busy} className={`${BTN_ICON_SM} ${TONE_GHOST_DANGER}`} aria-label={`Delete ${t.title}`}><Trash2 size={14} /></button></Hint>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {studio && (
        <ThemeStudio
          initial={studio.theme}
          editing={studio.editing}
          isAdmin={isAdmin}
          serverOk={serverOk}
          onClose={() => setStudio(null)}
          onSaved={onSaved}
        />
      )}
      {installOpen && (
        <InstallSheet isAdmin={isAdmin} serverOk={serverOk} onClose={() => setInstallOpen(false)} onInstalled={onSaved} />
      )}
    </div>
  )
}
