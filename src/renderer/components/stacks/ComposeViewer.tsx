// =============================================================================
// ComposeViewer — Dual-mode YAML compose editor with syntax highlighting,
// in-file search, validation, diff view, and stack .env tab
// =============================================================================

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { SegmentedControl } from '@mantine/core'
import { Copy, Check, Search, FileCode2, Pencil, Save, CheckCircle, AlertTriangle, GitCompare, FileText, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import {
  validateStackCompose,
  saveStackCompose,
  fetchStackEnv,
  saveStackEnv,
} from '../../api/endpoints'
import { useComposeLinter, useEnvLinter } from '../../hooks/useComposeLinter'
import { usePluginStore } from '../../stores/pluginStore'
import type { LintDiagnostic, EnvDiagnostic } from '../../hooks/useComposeLinter'
import { useToast } from '../common/Toast'
import { LoadingState } from '../common/PageState'
import Hint from '../common/Hint'
import type { ComposeValidateResponse, StackEnvResponse } from '../../../shared/types'
import { useModalA11y } from '../../hooks/useModalA11y'
import { DiagNumber, EditorDiagnostics, CountBadge } from './LintParts'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_ICON, BTN_ICON_SM, TONE_QUIET, TONE_OK, TONE_GHOST, TONE_PRESSED } from '../../lib/ui'
import CloseButton from '../common/CloseButton'
import Kbd from '../common/Kbd'
interface ComposeViewerProps {
  stackName: string
  /** the docker-compose.yml as read from the API (the caller does not open the viewer when the read failed) */
  content: string
  onClose: () => void
  /** saving is an admin call on the API: a viewer reads */
  isAdmin?: boolean
}

// ---------------------------------------------------------------------------
// YAML syntax highlighting
// ---------------------------------------------------------------------------

interface HighlightedSegment {
  text: string
  className: string
}

/** Tokenize a single YAML line into highlighted segments */
function highlightYamlLine(line: string): HighlightedSegment[] {
  // Empty or whitespace-only line
  if (line.trim() === '') {
    return [{ text: line, className: 'text-slate-300' }]
  }

  // Full-line comment (possibly indented)
  const commentMatch = line.match(/^(\s*)(#.*)$/)
  if (commentMatch) {
    return [
      { text: commentMatch[1], className: 'text-slate-300' },
      { text: commentMatch[2], className: 'text-slate-500 italic' },
    ]
  }

  const segments: HighlightedSegment[] = []

  // Key-value line: `  key: value` or `  key:`
  const kvMatch = line.match(/^(\s*)([\w./-][\w./ -]*)(:)(.*)$/)
  if (kvMatch) {
    const [, indent, key, colon, rest] = kvMatch
    if (indent) segments.push({ text: indent, className: 'text-slate-300' })
    segments.push({ text: key, className: 'text-cyan-400' })
    segments.push({ text: colon, className: 'text-slate-500' })

    if (rest) {
      highlightValue(rest, segments)
    }
    return segments
  }

  // List item line: `  - value`
  const listMatch = line.match(/^(\s*)(-)(\s)(.*)$/)
  if (listMatch) {
    const [, indent, dash, space, value] = listMatch
    if (indent) segments.push({ text: indent, className: 'text-slate-300' })
    segments.push({ text: dash, className: 'text-slate-500' })
    segments.push({ text: space, className: 'text-slate-300' })

    // List item might itself be a key: value
    const nestedKv = value.match(/^([\w./-][\w./ -]*)(:)(.*)$/)
    if (nestedKv) {
      const [, nKey, nColon, nRest] = nestedKv
      segments.push({ text: nKey, className: 'text-cyan-400' })
      segments.push({ text: nColon, className: 'text-slate-500' })
      if (nRest) highlightValue(nRest, segments)
    } else {
      highlightValue(' ' + value, segments, true)
    }
    return segments
  }

  // Fallback: treat entire line as plain text
  segments.push({ text: line, className: 'text-slate-300' })
  return segments
}

/** Highlight a YAML value portion (after the colon, or a list item value) */
function highlightValue(
  raw: string,
  segments: HighlightedSegment[],
  stripLeadingSpace = false,
): void {
  // Inline comment
  const commentIdx = raw.indexOf(' #')
  let value = commentIdx >= 0 ? raw.slice(0, commentIdx) : raw
  const comment = commentIdx >= 0 ? raw.slice(commentIdx) : ''

  // Leading space before value
  const leadingMatch = value.match(/^(\s+)(.*)$/)
  let leading = ''
  if (leadingMatch) {
    leading = leadingMatch[1]
    value = leadingMatch[2]
  }

  if (leading && !stripLeadingSpace) {
    segments.push({ text: leading, className: 'text-slate-300' })
  } else if (leading && stripLeadingSpace) {
    // We added a space prefix in the list-item branch; strip it
    segments.push({ text: leading.slice(1), className: 'text-slate-300' })
  }

  if (value === '') {
    // Nothing after colon
  } else if (/^(true|false|yes|no|on|off)$/i.test(value)) {
    // Boolean
    segments.push({ text: value, className: 'text-rose-400' })
  } else if (/^-?\d[\d_.]*$/.test(value)) {
    // Number
    segments.push({ text: value, className: 'text-amber-400' })
  } else if (/^null$/i.test(value)) {
    // Null
    segments.push({ text: value, className: 'text-slate-500 italic' })
  } else if (/^['"].*['"]$/.test(value)) {
    // Quoted string
    segments.push({ text: value, className: 'text-emerald-400' })
  } else if (value.startsWith('${') || value.includes('${')) {
    // Variable interpolation — highlight the whole thing as a string
    segments.push({ text: value, className: 'text-emerald-400' })
  } else {
    // Unquoted string value
    segments.push({ text: value, className: 'text-emerald-400' })
  }

  if (comment) {
    segments.push({ text: comment, className: 'text-slate-500 italic' })
  }
}

// ---------------------------------------------------------------------------
// Simple line-by-line diff
// ---------------------------------------------------------------------------

interface DiffLine {
  type: 'same' | 'added' | 'removed'
  content: string
  lineNumber: number | null
}

interface DiffResult {
  left: DiffLine[]
  right: DiffLine[]
}

/** Simple line-by-line comparison producing side-by-side diff */
function computeDiff(original: string, edited: string): DiffResult {
  // Trim trailing empty lines to avoid phantom diffs at the bottom
  const trimTrailing = (lines: string[]) => {
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
    return lines
  }
  const origLines = trimTrailing(original.split('\n'))
  const editLines = trimTrailing(edited.split('\n'))

  const left: DiffLine[] = []
  const right: DiffLine[] = []

  // Use longest common subsequence (LCS) approach for better diffs
  const m = origLines.length
  const n = editLines.length

  // Build LCS table
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (origLines[i - 1] === editLines[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1])
      }
    }
  }

  // Backtrack to build diff
  const diffOps: Array<{ type: 'same' | 'removed' | 'added'; origIdx?: number; editIdx?: number }> = []
  let i = m
  let j = n

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === editLines[j - 1]) {
      diffOps.unshift({ type: 'same', origIdx: i - 1, editIdx: j - 1 })
      i--
      j--
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      diffOps.unshift({ type: 'added', editIdx: j - 1 })
      j--
    } else {
      diffOps.unshift({ type: 'removed', origIdx: i - 1 })
      i--
    }
  }

  // Convert ops to side-by-side lines
  for (const op of diffOps) {
    if (op.type === 'same') {
      left.push({ type: 'same', content: origLines[op.origIdx!], lineNumber: op.origIdx! + 1 })
      right.push({ type: 'same', content: editLines[op.editIdx!], lineNumber: op.editIdx! + 1 })
    } else if (op.type === 'removed') {
      left.push({ type: 'removed', content: origLines[op.origIdx!], lineNumber: op.origIdx! + 1 })
      right.push({ type: 'removed', content: '', lineNumber: null })
    } else {
      left.push({ type: 'added', content: '', lineNumber: null })
      right.push({ type: 'added', content: editLines[op.editIdx!], lineNumber: op.editIdx! + 1 })
    }
  }

  return { left, right }
}

// ---------------------------------------------------------------------------
// ComposeViewer component
// ---------------------------------------------------------------------------

// Shared design tokens for all editor modes (view, edit, diff, .env)
// Inlined as comments for reference — applied directly in className strings
// because Tailwind JIT requires complete literal class strings for detection.
//   Font: text-[13px]   Line height: leading-6   Gutter: w-12   BG: bg-slate-950

export function ComposeViewer({ stackName, content, onClose, isAdmin = false }: ComposeViewerProps) {
  const overlayRef = useRef<HTMLDivElement>(null)
  // focus stays inside and returns to what opened it (Escape steps back through search and edit mode first: handled below)
  useModalA11y(overlayRef, () => {}, { closeOnEscape: false })
  const searchInputRef = useRef<HTMLInputElement>(null)
  const codeContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { addToast } = useToast()

  // Existing state
  const [copied, setCopied] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [activeMatchIndex, setActiveMatchIndex] = useState(0)

  // Edit mode state
  const [editMode, setEditMode] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [validationResult, setValidationResult] = useState<{ valid: boolean; output: string } | null>(null)
  const [validating, setValidating] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showDiff, setShowDiff] = useState(false)

  // Tab state
  const [activeTab, setActiveTab] = useState<'compose' | 'env'>('compose')

  // Env state
  const [envContent, setEnvContent] = useState<string | null>(null)
  const [envLoading, setEnvLoading] = useState(false)
  const [envEditContent, setEnvEditContent] = useState('')
  const [envSaving, setEnvSaving] = useState(false)
  const [envEditMode, setEnvEditMode] = useState(false)
  const [envError, setEnvError] = useState<string | null>(null)

  const yaml = content
  const lines = useMemo(() => yaml.split('\n'), [yaml])

  // ---- Plugin state (compose-linter toggle) ----
  const linterPluginEnabled = usePluginStore((s) => { const p = s.plugins.find((pl) => pl.name === 'compose-linter'); return !p || p.enabled })

  // ---- Real-time linting ----
  const { diagnostics: composeDiagnostics, counts: composeCounts } = useComposeLinter(
    editMode ? editContent : yaml,
    (envEditMode ? envEditContent : envContent) ?? undefined,
  )
  const { diagnostics: envDiagnostics, counts: envCounts } = useEnvLinter(
    envEditMode ? envEditContent : (envContent ?? undefined),
    editMode ? editContent : yaml,
  )

  // Build a map of line number -> diagnostics for the gutter
  const lineDiagnostics = useMemo(() => {
    const map = new Map<number, LintDiagnostic[]>()
    for (const d of composeDiagnostics) {
      const existing = map.get(d.line) || []
      existing.push(d)
      map.set(d.line, existing)
    }
    return map
  }, [composeDiagnostics])

  const envLineDiagnostics = useMemo(() => {
    const map = new Map<number, EnvDiagnostic[]>()
    for (const d of envDiagnostics) {
      const existing = map.get(d.line) || []
      existing.push(d)
      map.set(d.line, existing)
    }
    return map
  }, [envDiagnostics])

  // ---- Load .env when tab switches ----
  useEffect(() => {
    // a stack's .env is an admin's to read (the server refuses it to anyone else)
    if (isAdmin && activeTab === 'env' && envContent === null && !envLoading) {
      setEnvLoading(true)
      setEnvError(null)
      fetchStackEnv(stackName)
        .then((res: StackEnvResponse) => {
          setEnvContent(res.raw)
          setEnvEditContent(res.raw)
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : 'Failed to load .env'
          setEnvError(msg)
          setEnvContent('')
          setEnvEditContent('')
        })
        .finally(() => setEnvLoading(false))
    }
  }, [isAdmin, activeTab, stackName, envContent, envLoading])

  // ---- Initialize edit content when entering edit mode ----
  useEffect(() => {
    if (editMode) {
      setEditContent(yaml)
      setValidationResult(null)
      setShowDiff(false)
    }
  }, [editMode, yaml])

  // ---- Search logic ----
  /** Map of line index -> array of match ranges for the current search query */
  const searchMatches = useMemo(() => {
    if (!searchQuery.trim()) return new Map<number, { start: number; end: number }[]>()

    const query = searchQuery.toLowerCase()
    const result = new Map<number, { start: number; end: number }[]>()

    lines.forEach((line, lineIdx) => {
      const lower = line.toLowerCase()
      const ranges: { start: number; end: number }[] = []
      let pos = 0
      while (pos < lower.length) {
        const idx = lower.indexOf(query, pos)
        if (idx === -1) break
        ranges.push({ start: idx, end: idx + query.length })
        pos = idx + 1
      }
      if (ranges.length > 0) {
        result.set(lineIdx, ranges)
      }
    })

    return result
  }, [lines, searchQuery])

  /** Flat list of all match positions: [lineIdx, rangeIdx] */
  const allMatches = useMemo(() => {
    const flat: { line: number; rangeIdx: number }[] = []
    searchMatches.forEach((ranges, lineIdx) => {
      ranges.forEach((_, rangeIdx) => {
        flat.push({ line: lineIdx, rangeIdx })
      })
    })
    flat.sort((a, b) => a.line - b.line || a.rangeIdx - b.rangeIdx)
    return flat
  }, [searchMatches])

  const totalMatches = allMatches.length

  // Reset active match when query changes
  useEffect(() => {
    setActiveMatchIndex(0)
  }, [searchQuery])

  // Scroll active match into view
  useEffect(() => {
    if (totalMatches === 0 || !codeContainerRef.current) return
    const activeLine = allMatches[activeMatchIndex]?.line
    if (activeLine == null) return

    const lineEl = codeContainerRef.current.querySelector(
      `[data-line-index="${activeLine}"]`,
    )
    if (lineEl) {
      lineEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [activeMatchIndex, allMatches, totalMatches])

  // ---- Keyboard handlers ----
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchOpen) {
          setSearchOpen(false)
          setSearchQuery('')
        } else if (editMode) {
          setEditMode(false)
          setShowDiff(false)
          setValidationResult(null)
        } else {
          onClose()
        }
        return
      }

      // Ctrl+F / Cmd+F opens search (only in view mode for compose tab)
      if ((e.ctrlKey || e.metaKey) && e.key === 'f' && !editMode) {
        e.preventDefault()
        setSearchOpen(true)
        // Focus the search input after render
        setTimeout(() => searchInputRef.current?.focus(), 0)
        return
      }

      // Ctrl+S / Cmd+S to save in edit mode
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        if (editMode && validationResult?.valid) {
          e.preventDefault()
          handleSave()
        } else if (envEditMode && activeTab === 'env') {
          e.preventDefault()
          handleEnvSave()
        }
        return
      }

      // Enter/Shift+Enter to navigate matches
      if (searchOpen && e.key === 'Enter' && totalMatches > 0) {
        e.preventDefault()
        if (e.shiftKey) {
          setActiveMatchIndex((prev) => (prev - 1 + totalMatches) % totalMatches)
        } else {
          setActiveMatchIndex((prev) => (prev + 1) % totalMatches)
        }
      }
    },
    [onClose, searchOpen, totalMatches, editMode, validationResult, envEditMode, activeTab],
  )

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // ---- Backdrop click ----
  const handleOverlayClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (e.target === overlayRef.current) onClose()
    },
    [onClose],
  )

  // ---- Copy to clipboard ----
  const handleCopy = useCallback(async () => {
    try {
      const textToCopy = editMode ? editContent : yaml
      await navigator.clipboard.writeText(textToCopy)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may fail in some environments — ignore silently
    }
  }, [yaml, editMode, editContent])

  // ---- Validate compose ----
  const handleValidate = useCallback(async () => {
    setValidating(true)
    try {
      const res: ComposeValidateResponse = await validateStackCompose(stackName, editContent)
      setValidationResult({ valid: res.valid, output: res.output })
      if (res.valid) {
        addToast({ type: 'success', message: 'Compose file is valid' })
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Validation failed'
      setValidationResult({ valid: false, output: msg })
    } finally {
      setValidating(false)
    }
  }, [stackName, editContent, addToast])

  // ---- Save compose ----
  const handleSave = useCallback(async () => {
    if (!validationResult?.valid) return
    setSaving(true)
    try {
      const res = await saveStackCompose(stackName, editContent)
      // HTTP 200 with success:false is a compose file Docker refused: nothing was written, the editor stays open
      if (!res.success) throw new Error(res.validation_errors || res.message || 'Validation failed')
      // a VM stack: the hub's copy is saved either way; pushed:false means the VM did not take it yet
      if (res.pushed === false) addToast({ type: 'warning', message: res.message, duration: 8000 })
      else addToast({ type: 'success', message: `Compose file saved for ${stackName}` })
      setEditMode(false)
      setShowDiff(false)
      setValidationResult(null)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      addToast({ type: 'error', message: msg })
    } finally {
      setSaving(false)
    }
  }, [stackName, editContent, validationResult, addToast])

  // ---- Save env ----
  const handleEnvSave = useCallback(async () => {
    setEnvSaving(true)
    try {
      const res = await saveStackEnv(stackName, envEditContent)
      if (!res.success) throw new Error(res.message || 'Save failed')
      setEnvContent(envEditContent)
      if (res.pushed === false) addToast({ type: 'warning', message: res.message, duration: 8000 })
      else addToast({ type: 'success', message: `.env saved for ${stackName}` })
      setEnvEditMode(false)
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Save failed'
      addToast({ type: 'error', message: msg })
    } finally {
      setEnvSaving(false)
    }
  }, [stackName, envEditContent, addToast])

  // ---- Diff computation ----
  const diff = useMemo(() => {
    if (!showDiff) return null
    return computeDiff(yaml, editContent)
  }, [showDiff, yaml, editContent])

  // ---- Pretty stack name ----
  const formattedName = stackName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

  // ---- Determine which line the active match is on ----
  const activeMatchLine = totalMatches > 0 ? allMatches[activeMatchIndex]?.line : -1

  // Build a set of lines that have *any* match for the highlight background
  const matchedLineSet = useMemo(() => {
    const s = new Set<number>()
    searchMatches.forEach((_, lineIdx) => s.add(lineIdx))
    return s
  }, [searchMatches])

  // ---- Clear edit/validation state when switching tabs ----
  const switchTab = useCallback((tab: 'compose' | 'env') => {
    if (tab === activeTab) return
    // Exit edit modes when switching
    if (editMode) {
      setEditMode(false)
      setShowDiff(false)
      setValidationResult(null)
    }
    if (envEditMode) {
      setEnvEditMode(false)
    }
    setSearchOpen(false)
    setSearchQuery('')
    setActiveTab(tab)
  }, [activeTab, editMode, envEditMode])

  // ---- Reset validation when edit content changes ----
  useEffect(() => {
    if (editMode) {
      setValidationResult(null)
    }
  }, [editContent])

  // ---- Render highlighted line with search overlays ----
  function renderLine(line: string, lineIdx: number) {
    const highlighted = highlightYamlLine(line)
    const lineMatches = searchMatches.get(lineIdx)
    const isActiveMatchLine = lineIdx === activeMatchLine

    // If no search matches on this line, render normally
    if (!lineMatches || lineMatches.length === 0) {
      return (
        <span>
          {highlighted.map((seg, i) => (
            <span key={i} className={seg.className}>
              {seg.text}
            </span>
          ))}
        </span>
      )
    }

    // Build character-level highlight map for search matches on this line
    // We render the syntax-highlighted segments but wrap matched characters in a highlight span
    const charHighlights = new Array<{ active: boolean; match: boolean }>(line.length)
    for (let i = 0; i < line.length; i++) {
      charHighlights[i] = { active: false, match: false }
    }

    // Determine which range is the "active" one on this line
    let activeRangeOnLine = -1
    if (isActiveMatchLine) {
      activeRangeOnLine = allMatches[activeMatchIndex]?.rangeIdx ?? -1
    }

    lineMatches.forEach((range, rangeIdx) => {
      for (let i = range.start; i < range.end; i++) {
        charHighlights[i] = {
          match: true,
          active: isActiveMatchLine && rangeIdx === activeRangeOnLine,
        }
      }
    })

    // Re-render syntax segments with match overlays
    let charPos = 0
    return (
      <span>
        {highlighted.map((seg, segIdx) => {
          const segStart = charPos
          charPos += seg.text.length

          // Check if any character in this segment has a match
          let hasMatch = false
          for (let i = segStart; i < charPos; i++) {
            if (charHighlights[i]?.match) {
              hasMatch = true
              break
            }
          }

          if (!hasMatch) {
            return (
              <span key={segIdx} className={seg.className}>
                {seg.text}
              </span>
            )
          }

          // Split segment into sub-spans for matched / unmatched characters
          const subSpans: { text: string; match: boolean; active: boolean }[] = []
          let cur = { text: '', match: charHighlights[segStart]?.match ?? false, active: charHighlights[segStart]?.active ?? false }

          for (let i = segStart; i < segStart + seg.text.length; i++) {
            const ch = charHighlights[i] ?? { match: false, active: false }
            if (ch.match === cur.match && ch.active === cur.active) {
              cur.text += seg.text[i - segStart]
            } else {
              if (cur.text) subSpans.push({ ...cur })
              cur = { text: seg.text[i - segStart], match: ch.match, active: ch.active }
            }
          }
          if (cur.text) subSpans.push(cur)

          return (
            <span key={segIdx}>
              {subSpans.map((sub, si) => {
                if (sub.match) {
                  return (
                    <span
                      key={si}
                      className={`
                        rounded-sm px-[1px] -mx-[1px]
                        ${sub.active
                          ? 'bg-amber-400/30 ring-1 ring-amber-400/60 text-white'
                          : 'bg-amber-400/15 text-white'
                        }
                      `}
                    >
                      {sub.text}
                    </span>
                  )
                }
                return (
                  <span key={si} className={seg.className}>
                    {sub.text}
                  </span>
                )
              })}
            </span>
          )
        })}
      </span>
    )
  }

  // ---- Render diff view ----
  function renderDiffView() {
    if (!diff) return null

    // Trim trailing empty placeholder lines from both sides
    let trimmedLeft = diff.left
    let trimmedRight = diff.right
    while (
      trimmedLeft.length > 0 &&
      trimmedRight.length > 0 &&
      trimmedLeft[trimmedLeft.length - 1].content === '' &&
      trimmedRight[trimmedRight.length - 1].content === '' &&
      trimmedLeft[trimmedLeft.length - 1].lineNumber === null &&
      trimmedRight[trimmedRight.length - 1].lineNumber === null
    ) {
      trimmedLeft = trimmedLeft.slice(0, -1)
      trimmedRight = trimmedRight.slice(0, -1)
    }

    const renderDiffColumn = (
      lines: DiffLine[],
      side: 'left' | 'right',
    ) => (
      <div className={`min-w-0 flex flex-col ${side === 'left' ? 'border-r border-white/5' : ''}`}>
        <div className="px-4 py-2 text-[10px] uppercase tracking-wider border-b border-white/5 bg-slate-900/50 font-sans font-semibold flex items-center gap-2 shrink-0">
          <span className={`w-1.5 h-1.5 rounded-full ${side === 'left' ? 'bg-rose-400/60' : 'bg-emerald-400/60'}`} />
          <span className="text-slate-400">{side === 'left' ? 'Original' : 'Edited'}</span>
          <span className="text-[9px] text-slate-500 ml-auto tabular-nums">
            {lines.filter(l => l.type === (side === 'left' ? 'removed' : 'added')).length} {side === 'left' ? 'removed' : 'added'}
          </span>
        </div>
        <div className="bg-slate-950 flex-1 overflow-x-auto">
          {lines.map((dl, idx) => {
            const isChange = side === 'left' ? dl.type === 'removed' : dl.type === 'added'
            const isPlaceholder = side === 'left' ? dl.type === 'added' : dl.type === 'removed'
            return (
              <div
                key={idx}
                className={`
                  flex min-h-6
                  ${isChange
                    ? side === 'left' ? 'bg-rose-500/[0.08]' : 'bg-emerald-500/[0.08]'
                    : isPlaceholder
                      ? 'bg-slate-900/40'
                      : 'hover:bg-white/[0.03]'
                  }
                `}
              >
                <span className={`inline-block w-12 shrink-0 text-right pr-3 pl-3 select-none tabular-nums text-xs leading-6 ${
                  isChange
                    ? side === 'left' ? 'text-rose-400/60 bg-rose-500/[0.06]' : 'text-emerald-400/60 bg-emerald-500/[0.06]'
                    : 'text-slate-500'
                }`}>
                  {dl.lineNumber ?? ''}
                </span>
                <span className={`flex-1 py-[1px] whitespace-pre pl-2 pr-4 ${
                  isChange
                    ? side === 'left' ? 'text-rose-300' : 'text-emerald-300'
                    : isPlaceholder
                      ? 'text-transparent'
                      : 'text-slate-400'
                }`}>
                  {dl.content || '\u00A0'}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )

    return (
      <div className="overflow-y-auto max-h-[80vh] scrollbar-thin">
        <div className={`grid grid-cols-2 font-mono text-[13px] leading-6`}>
          {renderDiffColumn(trimmedLeft, 'left')}
          {renderDiffColumn(trimmedRight, 'right')}
        </div>
      </div>
    )
  }

  // ---- Render .env tab content ----
  function renderEnvTab() {
    if (envLoading) {
      return <LoadingState compact label="Reading the .env file…" />
    }

    if (envError) {
      return (
        <div className="flex items-center justify-center h-48 text-sm" role="alert">
          <div className="flex items-center gap-2 text-rose-400">
            <AlertTriangle size={16} />
            {envError}
          </div>
        </div>
      )
    }

    if (envEditMode) {
      const envEditLines = envEditContent.split('\n')
      return (
        <div className={`flex overflow-y-auto max-h-[80vh] scrollbar-thin bg-slate-950`}>
          {/* Line number gutter with diagnostic markers */}
          <div className={`shrink-0 select-none border-r border-white/5 bg-slate-950 sticky left-0`} aria-hidden="true">
            <div className="h-4" />
            {envEditLines.map((_, idx) => {
              const diags = envLineDiagnostics.get(idx + 1)
              return (
                <div key={idx} className={`w-12 pr-3 pl-3 text-right leading-6 relative`}>
                  {diags ? (
                    <DiagNumber line={idx + 1} diags={diags} focusable={false} width={300} className="text-xs tabular-nums font-mono" />
                  ) : (
                    <span className="text-xs tabular-nums font-mono text-slate-500">{idx + 1}</span>
                  )}
                </div>
              )
            })}
          </div>
          {/* Textarea — py-4 and leading-6 must match gutter exactly */}
          <textarea aria-label=".env file"
            value={envEditContent}
            onChange={(e) => setEnvEditContent(e.target.value)}
            className={`flex-1 bg-slate-950 text-slate-200 font-mono text-[13px] py-4 px-4 resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/30 leading-6`}
            style={{ minHeight: '70vh' }}
            spellCheck={false}
          />
        </div>
      )
    }

    // Read-only view of .env with basic highlighting
    const envLines = (envContent ?? '').split('\n')
    return (
      <div className="overflow-y-auto max-h-[80vh] scrollbar-thin">
        <div className={`bg-slate-950 font-mono text-[13px] leading-6`}>
          {envLines.map((line, idx) => {
            const isComment = line.trimStart().startsWith('#')
            const isEmpty = line.trim() === ''

            let rendered: React.ReactNode
            if (isEmpty) {
              rendered = <span className="text-slate-300">{line}</span>
            } else if (isComment) {
              rendered = <span className="text-slate-500 italic">{line}</span>
            } else {
              // Try to split on first =
              const eqIdx = line.indexOf('=')
              if (eqIdx > 0) {
                const key = line.slice(0, eqIdx)
                const val = line.slice(eqIdx)
                rendered = (
                  <span>
                    <span className="text-cyan-400">{key}</span>
                    <span className="text-slate-500">=</span>
                    <span className="text-emerald-400">{val.slice(1)}</span>
                  </span>
                )
              } else {
                rendered = <span className="text-slate-300">{line}</span>
              }
            }

            const diags = envLineDiagnostics.get(idx + 1)
            const highestSeverity = diags?.[0]?.severity

            return (
              <div
                key={idx}
                className={`flex px-5 ${diags
                  ? highestSeverity === 'error' ? 'bg-rose-500/[0.03]' : highestSeverity === 'warning' ? 'bg-amber-500/[0.02]' : 'hover:bg-white/[0.03]'
                  : 'hover:bg-white/[0.03]'
                }`}
              >
                <span className={`inline-block w-12 shrink-0 text-right pr-3 pl-3 select-none tabular-nums text-xs leading-6 relative`}>
                  {diags ? (
                    <DiagNumber line={idx + 1} diags={diags} focusable={true} width={300} />
                  ) : (
                    <span className="text-slate-500">{idx + 1}</span>
                  )}
                </span>
                <span className="flex-1 py-[1px] whitespace-pre overflow-x-auto">
                  {rendered}
                </span>
              </div>
            )
          })}
          <div className="h-4" />
        </div>
      </div>
    )
  }

  // ---- Render compose tab content ----
  function renderComposeTab() {
    // Diff view
    if (editMode && showDiff) {
      return renderDiffView()
    }

    // Edit mode — textarea with line numbers and live diagnostics
    if (editMode) {
      const editLines = editContent.split('\n')
      return (
        <div className={`flex overflow-y-auto max-h-[80vh] scrollbar-thin bg-slate-950`}>
          {/* Line number gutter with diagnostic markers */}
          <div className={`shrink-0 select-none border-r border-white/5 bg-slate-950 sticky left-0`} aria-hidden="true">
            {/* Top padding matching textarea py-4 */}
            <div className="h-4" />
            {editLines.map((_, idx) => {
              const diags = lineDiagnostics.get(idx + 1)
              return (
                <div key={idx} className={`w-12 pr-3 pl-3 text-right leading-6 relative`}>
                  {diags ? (
                    <DiagNumber line={idx + 1} diags={diags} focusable={false} width={300} className="text-xs tabular-nums font-mono" />
                  ) : (
                    <span className="text-xs tabular-nums font-mono text-slate-500">{idx + 1}</span>
                  )}
                </div>
              )
            })}
          </div>
          {/* Textarea — py-4 and leading-6 must match gutter exactly */}
          <textarea aria-label="Compose file"
            ref={textareaRef}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className={`flex-1 bg-slate-950 text-slate-200 font-mono text-[13px] py-4 px-4 resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-500/30 leading-6`}
            style={{ minHeight: '70vh' }}
            spellCheck={false}
          />
        </div>
      )
    }

    // View mode — syntax-highlighted read-only view
    return (
      <div
        ref={codeContainerRef}
        className="overflow-y-auto max-h-[80vh] scrollbar-thin"
      >
        <div className={`bg-slate-950 font-mono text-[13px] leading-6`}>
          {lines.map((line, idx) => {
            const isMatchedLine = matchedLineSet.has(idx)
            const isActiveLine = idx === activeMatchLine
            const diags = lineDiagnostics.get(idx + 1) // diagnostics use 1-indexed lines
            const highestSeverity = diags?.[0]?.severity

            return (
              <div
                key={idx}
                data-line-index={idx}
                className={`
                  flex px-5 transition-colors duration-100 group/line relative
                  ${isActiveLine
                    ? 'bg-amber-400/[0.06]'
                    : isMatchedLine
                      ? 'bg-amber-400/[0.03]'
                      : diags
                        ? highestSeverity === 'error'
                          ? 'border-l-2 border-l-rose-400 bg-rose-500/[0.04]'
                          : highestSeverity === 'warning'
                            ? 'border-l-2 border-l-amber-400 bg-amber-500/[0.03]'
                            : 'border-l-2 border-l-cyan-400/50 hover:bg-white/[0.03]'
                        : 'hover:bg-white/[0.03]'
                  }
                `}
              >
                {/* Diagnostic gutter indicator */}
                <span className={`inline-block w-12 shrink-0 text-right pr-3 pl-3 py-[1px] select-none tabular-nums text-xs leading-6 relative`}>
                  {diags ? (
                    <DiagNumber line={idx + 1} diags={diags} focusable={true} width={320} />
                  ) : (
                    <span className="text-slate-500">{idx + 1}</span>
                  )}
                </span>

                {/* Line content */}
                <span className="flex-1 py-[1px] whitespace-pre overflow-x-auto">
                  {renderLine(line, idx)}
                </span>
              </div>
            )
          })}

          {/* Bottom padding for comfortable scrolling */}
          <div className="h-4" />
        </div>
      </div>
    )
  }

  return createPortal(
    <div
      ref={overlayRef}
      onClick={handleOverlayClick}
      className="
        fixed inset-0 z-[9999]
        flex items-center justify-center
        bg-black/60 backdrop-blur-sm
        animate-fade-in
      "
    >
      <div
        className={`
          relative
          w-full ${showDiff ? 'max-w-[98vw]' : 'max-w-[95vw] xl:max-w-7xl'} mx-4
          bg-slate-950/95 backdrop-blur-xl
          border rounded-2xl
          shadow-2xl shadow-black/50
          animate-fade-in
          flex flex-col
          max-h-[92vh]
          transition-all duration-500
          ${(activeTab === 'compose' ? composeCounts : envCounts).errors > 0
            ? 'border-rose-500/20 glow-rose'
            : (activeTab === 'compose' ? composeCounts : envCounts).warnings > 0
              ? 'border-amber-500/15'
              : composeDiagnostics.length === 0 && envDiagnostics.length === 0
                ? 'border-emerald-500/10'
                : 'border-white/5'
          }
        `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-viewer-title"
      >
        {/* ---- Header ---- */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-3 px-4 sm:px-5 py-3 sm:py-3.5 border-b border-white/5 shrink-0">
          <div className="flex items-center gap-3 min-w-0 flex-1 basis-48">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-cyan-500/10 ring-1 ring-cyan-500/20 shrink-0">
              {activeTab === 'compose' ? (
                <FileCode2 className="w-4 h-4 text-cyan-400" />
              ) : (
                <FileText className="w-4 h-4 text-cyan-400" />
              )}
            </div>
            <div className="min-w-0">
              <h2
                id="compose-viewer-title"
                className="text-sm font-semibold text-slate-200 truncate"
              >
                {formattedName}
              </h2>
              <p className="text-[11px] text-slate-500 font-mono truncate">
                {activeTab === 'compose' ? 'docker-compose.yml' : '.env'}
              </p>
            </div>
          </div>

          {/* Tabs: one choice (the .env holds the stack's secrets: only an admin may read it) */}
          {isAdmin ? (
            <SegmentedControl
              aria-label="File"
              value={activeTab}
              onChange={(v) => switchTab(v as 'compose' | 'env')}
              data={[
                { value: 'compose', label: <span className="flex items-center gap-1.5"><FileCode2 size={12} aria-hidden />Compose<CountBadge errors={composeCounts.errors} warnings={composeCounts.warnings} /></span> },
                { value: 'env', label: <span className="flex items-center gap-1.5"><FileText size={12} aria-hidden />.env<CountBadge errors={envCounts.errors} warnings={envCounts.warnings} /></span> },
              ]}
            />
          ) : (
            <p className="text-[11px] text-slate-500">Admins can open the stack&apos;s .env</p>
          )}

          <div className="flex flex-wrap items-center gap-1.5 shrink-0">
            {/* ---- Compose tab buttons ---- */}
            {activeTab === 'compose' && (
              <>
                {/* Edit / View toggle (saving is an admin call on the API: a viewer only reads) */}
                {isAdmin && (
                  <Hint label={editMode ? 'Switch to view mode' : 'Switch to edit mode'}>
                    <button
                      type="button"
                      aria-label="Edit mode"
                      aria-pressed={editMode}
                      onClick={() => {
                        if (editMode) {
                          setEditMode(false)
                          setShowDiff(false)
                          setValidationResult(null)
                        } else {
                          setEditMode(true)
                          setSearchOpen(false)
                          setSearchQuery('')
                        }
                      }}
                      className={`${BTN_TOOLBAR} ${editMode ? TONE_PRESSED : TONE_QUIET}`}
                    >
                      <Pencil size={14} />
                      <span className="hidden sm:inline">{editMode ? 'Editing' : 'Edit'}</span>
                    </button>
                  </Hint>
                )}

                {/* Diff toggle (edit mode only) */}
                {editMode && (
                  <Hint label="Show what changed next to the saved file">
                    <button
                      type="button"
                      aria-label="Diff view"
                      aria-pressed={showDiff}
                      onClick={() => setShowDiff((prev) => !prev)}
                      className={`${BTN_TOOLBAR} ${showDiff ? TONE_PRESSED : TONE_QUIET}`}
                    >
                      <GitCompare size={14} />
                      <span className="hidden sm:inline">Diff</span>
                    </button>
                  </Hint>
                )}

                {/* Validate (edit mode only) */}
                {editMode && (
                  <Hint label="Check the compose file with Docker">
                    <button
                      type="button"
                      aria-label="Validate the compose file"
                      onClick={handleValidate}
                      disabled={validating}
                      className={BTN_TOOLBAR_QUIET}
                    >
                      {validating ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                      <span className="hidden sm:inline">Validate</span>
                    </button>
                  </Hint>
                )}

                {/* Save (edit mode only, disabled until validated) */}
                {isAdmin && editMode && (
                  <Hint label={!validationResult?.valid ? 'Validate first, then save' : 'Save the compose file'}>
                    <span className="inline-flex">
                      <button
                        type="button"
                        aria-label="Save the compose file"
                        onClick={handleSave}
                        disabled={!validationResult?.valid || saving}
                        className={`${BTN_TOOLBAR} ${TONE_OK}`}
                      >
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                        <span className="hidden sm:inline">Save</span>
                      </button>
                    </span>
                  </Hint>
                )}

                {/* Search toggle (view mode only) */}
                {!editMode && (
                  <Hint label="Search (Ctrl+F)">
                    <button
                      type="button"
                      aria-label="Search in the file"
                      aria-pressed={searchOpen}
                      onClick={() => {
                        setSearchOpen((prev) => !prev)
                        if (!searchOpen) {
                          setTimeout(() => searchInputRef.current?.focus(), 0)
                        } else {
                          setSearchQuery('')
                        }
                      }}
                      className={`${BTN_ICON} ${searchOpen ? TONE_PRESSED : TONE_QUIET}`}
                    >
                      <Search size={14} />
                    </button>
                  </Hint>
                )}

                {/* Copy button */}
                <Hint label={copied ? 'Copied!' : 'Copy to the clipboard'}>
                  <button
                    type="button"
                    aria-label="Copy to the clipboard"
                    onClick={handleCopy}
                    className={`${BTN_ICON} ${TONE_QUIET}`}
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                  </button>
                </Hint>
              </>
            )}

            {/* ---- .env tab buttons ---- */}
            {activeTab === 'env' && (
              <>
                {/* Edit / View toggle (saving is an admin call on the API: a viewer only reads) */}
                {isAdmin && (
                  <Hint label={envEditMode ? 'Switch to view mode' : 'Switch to edit mode'}>
                    <span className="inline-flex">
                      <button
                        type="button"
                        aria-label="Edit mode"
                        aria-pressed={envEditMode}
                        onClick={() => {
                          if (envEditMode) {
                            setEnvEditMode(false)
                          } else {
                            setEnvEditMode(true)
                            setEnvEditContent(envContent ?? '')
                          }
                        }}
                        disabled={envLoading || envError !== null}
                        className={`${BTN_TOOLBAR} ${envEditMode ? TONE_PRESSED : TONE_QUIET}`}
                      >
                        <Pencil size={14} />
                        <span className="hidden sm:inline">{envEditMode ? 'Editing' : 'Edit'}</span>
                      </button>
                    </span>
                  </Hint>
                )}

                {/* Save (edit mode only) */}
                {isAdmin && envEditMode && (
                  <button
                    type="button"
                    aria-label="Save the .env file"
                    onClick={handleEnvSave}
                    disabled={envSaving}
                    className={`${BTN_TOOLBAR} ${TONE_OK}`}
                  >
                    {envSaving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                    <span className="hidden sm:inline">Save</span>
                  </button>
                )}
              </>
            )}

            {/* Close button (always visible) */}
            <Hint label="Close">
              <CloseButton onClick={onClose} />
            </Hint>
          </div>
        </div>

        {/* ---- Validation result bar ---- */}
        {activeTab === 'compose' && editMode && validationResult && (
          <div role="status" className={`
            flex items-start gap-2 px-4 sm:px-5 py-2.5 border-b border-white/5 shrink-0 text-xs
            ${validationResult.valid
              ? 'bg-emerald-500/[0.06] text-emerald-400'
              : 'bg-rose-500/[0.06] text-rose-400'
            }
          `}>
            {validationResult.valid ? (
              <CheckCircle size={14} className="shrink-0 mt-0.5" />
            ) : (
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
            )}
            <pre className="flex-1 whitespace-pre-wrap font-mono leading-relaxed">
              {validationResult.valid ? 'Valid compose file' : validationResult.output}
            </pre>
          </div>
        )}

        {/* ---- Search bar (compose view mode only) ---- */}
        {activeTab === 'compose' && !editMode && searchOpen && (
          <div className="flex items-center gap-2 px-4 sm:px-5 py-2.5 border-b border-white/5 bg-slate-900/50 shrink-0">
            <Search size={14} className="text-slate-500 shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              aria-label="Search in the file"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search…"
              autoFocus
              className="
                flex-1 min-w-0 bg-transparent text-sm text-slate-200
                placeholder-slate-600 rounded px-1
                focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40
              "
            />
            {searchQuery && (
              <span className="text-[11px] text-slate-500 font-mono tabular-nums shrink-0" role="status">
                {totalMatches > 0
                  ? `${activeMatchIndex + 1} / ${totalMatches}`
                  : 'No results'
                }
              </span>
            )}
            {totalMatches > 1 && (
              <div className="flex items-center gap-0.5 shrink-0">
                <Hint label="Previous match (Shift+Enter)">
                  <button
                    onClick={() =>
                      setActiveMatchIndex((prev) => (prev - 1 + totalMatches) % totalMatches)
                    }
                    className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                    aria-label="Previous match"
                  >
                    <ChevronUp size={14} />
                  </button>
                </Hint>
                <Hint label="Next match (Enter)">
                  <button
                    onClick={() =>
                      setActiveMatchIndex((prev) => (prev + 1) % totalMatches)
                    }
                    className={`${BTN_ICON_SM} ${TONE_GHOST}`}
                    aria-label="Next match"
                  >
                    <ChevronDown size={14} />
                  </button>
                </Hint>
              </div>
            )}
            <Hint label="Close the search">
              <CloseButton label="Close the search" size="sm" onClick={() => {
                  setSearchOpen(false)
                  setSearchQuery('')
                }} />
            </Hint>
          </div>
        )}

        {/* ---- Content area ---- */}
        {activeTab === 'compose' ? renderComposeTab() : renderEnvTab()}

        {/* ---- In edit mode the messages are listed under the editor; otherwise a summary bar (hidden when the compose-linter plugin is disabled) ---- */}
        {linterPluginEnabled && ((activeTab === 'compose' && editMode) || (activeTab === 'env' && envEditMode)) && (
          activeTab === 'compose'
            ? <EditorDiagnostics diagnostics={composeDiagnostics} counts={composeCounts} validation={validationResult} kind="compose" hint="Ctrl+S saves once validated · Esc leaves edit mode" />
            : <EditorDiagnostics diagnostics={envDiagnostics} counts={envCounts} kind="env" hint="Ctrl+S saves · Esc leaves edit mode" />
        )}
        {linterPluginEnabled && !((activeTab === 'compose' && editMode) || (activeTab === 'env' && envEditMode)) && (
        <div className="flex items-center gap-3 px-4 sm:px-5 py-2 border-t border-white/5 bg-slate-900/60 shrink-0">
          <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">Lint</span>
          {(activeTab === 'compose' ? composeDiagnostics.length : envDiagnostics.length) === 0 ? (
            <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 neon-emerald">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              All clear
            </span>
          ) : (
            <>
              {(activeTab === 'compose' ? composeCounts : envCounts).errors > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-rose-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-pulse" />
                  {(activeTab === 'compose' ? composeCounts : envCounts).errors} error{(activeTab === 'compose' ? composeCounts : envCounts).errors !== 1 ? 's' : ''}
                </span>
              )}
              {(activeTab === 'compose' ? composeCounts : envCounts).warnings > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-amber-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  {(activeTab === 'compose' ? composeCounts : envCounts).warnings} warning{(activeTab === 'compose' ? composeCounts : envCounts).warnings !== 1 ? 's' : ''}
                </span>
              )}
              {(activeTab === 'compose' ? composeCounts : envCounts).info > 0 && (
                <span className="flex items-center gap-1 text-[10px] font-medium text-cyan-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
                  {(activeTab === 'compose' ? composeCounts : envCounts).info} hint{(activeTab === 'compose' ? composeCounts : envCounts).info !== 1 ? 's' : ''}
                </span>
              )}
              <span className="ml-auto hidden sm:inline text-[10px] text-slate-500">Marked line numbers show their messages on hover or focus</span>
            </>
          )}
        </div>
        )}

        {/* ---- Footer ---- */}
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-4 sm:px-5 py-2.5 border-t border-white/5 shrink-0">
          <span className="text-[11px] text-slate-500 font-mono">
            {activeTab === 'compose'
              ? `${editMode ? editContent.split('\n').length : lines.length} line${(editMode ? editContent.split('\n').length : lines.length) !== 1 ? 's' : ''}`
              : envContent !== null
                ? `${(envEditMode ? envEditContent : envContent).split('\n').length} line${(envEditMode ? envEditContent : envContent).split('\n').length !== 1 ? 's' : ''}`
                : ''
            }
          </span>
          <div className="flex items-center gap-3">
            {((activeTab === 'compose' && editMode) || (activeTab === 'env' && envEditMode)) && (
              <span className="text-[11px] text-cyan-400/80 font-medium">
                Editing
              </span>
            )}
            <span className="text-[11px] text-slate-500">
              {activeTab === 'compose' ? 'YAML' : 'ENV'}
            </span>
            <span className="hidden sm:inline text-[10px] text-slate-500">
              Press <Kbd>Esc</Kbd> to close
            </span>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
