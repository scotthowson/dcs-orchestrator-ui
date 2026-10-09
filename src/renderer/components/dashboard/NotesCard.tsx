// =============================================================================
// NotesCard — a scratchpad that lives on the dashboard (saved with the layout)
// =============================================================================

import React, { useEffect, useState } from 'react'
import { StickyNote, Pencil, Check, X } from 'lucide-react'
import Hint from '../common/Hint'
import { BTN_CARD, BTN_ICON_SM, TONE_GHOST, TONE_GHOST_OK, TONE_OK } from '../../lib/ui'
import { Card, CardBody, type CardCommonProps } from './cardShared'
import { EmptyState } from '../common/PageState'
interface NotesConfig { text: string }

const URL_RE = /(https?:\/\/[^\s<]+)/g

/** Inline: **bold**, `code` and links. Rendered as elements, never as HTML. */
function inline(text: string, key: string): React.ReactNode[] {
  const out: React.ReactNode[] = []
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g)
  parts.forEach((part, i) => {
    if (!part) return
    if (part.startsWith('**') && part.endsWith('**')) { out.push(<strong key={`${key}-b${i}`} className="text-slate-100">{part.slice(2, -2)}</strong>); return }
    if (part.startsWith('`') && part.endsWith('`')) { out.push(<code key={`${key}-c${i}`} className="px-1 rounded bg-white/10 text-cyan-300 text-[11px]">{part.slice(1, -1)}</code>); return }
    part.split(URL_RE).forEach((seg, j) => {
      if (!seg) return
      if (/^https?:\/\//.test(seg)) out.push(<a key={`${key}-l${i}-${j}`} href={seg} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:underline break-all">{seg}</a>)
      else out.push(<React.Fragment key={`${key}-t${i}-${j}`}>{seg}</React.Fragment>)
    })
  })
  return out
}

function Rendered({ text }: { text: string }) {
  const lines = text.split('\n')
  const nodes: React.ReactNode[] = []
  let list: React.ReactNode[] = []
  const flush = () => { if (list.length) { nodes.push(<ul key={`ul-${nodes.length}`} className="list-disc pl-4 space-y-0.5 my-1">{list}</ul>); list = [] } }
  lines.forEach((line, i) => {
    const key = `l${i}`
    // Tasks: "[ ] thing" or "- [x] thing" (checked before bullets so the dash is not a bullet)
    const task = /^\s*(?:[-*] )?\[([ xX])\] (.*)$/.exec(line)
    if (task) {
      flush()
      const done = task[1] !== ' '
      nodes.push(<div key={key} className={`flex items-start gap-1.5 ${done ? 'text-slate-500 line-through' : ''}`}><span className={`mt-1 h-3 w-3 rounded border shrink-0 ${done ? 'bg-emerald-500/60 border-emerald-500/60' : 'border-white/30'}`} /><span>{inline(task[2], key)}</span></div>)
      return
    }
    if (/^\s*[-*] /.test(line)) { list.push(<li key={key}>{inline(line.replace(/^\s*[-*] /, ''), key)}</li>); return }
    flush()
    // (a note's own headings are text, not the page's outline: paragraphs in three weights)
    if (/^### /.test(line)) { nodes.push(<p key={key} className="text-xs font-semibold text-slate-200 mt-2">{inline(line.slice(4), key)}</p>); return }
    if (/^## /.test(line)) { nodes.push(<p key={key} className="text-sm font-semibold text-slate-100 mt-2">{inline(line.slice(3), key)}</p>); return }
    if (/^# /.test(line)) { nodes.push(<p key={key} className="text-base font-bold text-slate-100 mt-1">{inline(line.slice(2), key)}</p>); return }
    if (!line.trim()) { nodes.push(<div key={key} className="h-2" />); return }
    nodes.push(<p key={key}>{inline(line, key)}</p>)
  })
  flush()
  return <div className="text-xs text-slate-300 leading-relaxed">{nodes}</div>
}

export default function NotesCard({ cardConfig, onSaveConfig, dashboardEditMode }: CardCommonProps) {
  const text = typeof (cardConfig as NotesConfig | undefined)?.text === 'string' ? (cardConfig as NotesConfig).text : ''
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)
  const [saving, setSaving] = useState(false)
  useEffect(() => { if (!editing) setDraft(text) }, [text, editing])
  const canEdit = !!onSaveConfig && !dashboardEditMode

  const save = async () => {
    setSaving(true)
    try { await onSaveConfig?.({ text: draft }); setEditing(false) } finally { setSaving(false) }
  }

  return (
    <Card
      card="notes"
      actions={canEdit ? (editing ? (
        <>
          <Hint label="Discard"><button type="button" aria-label="Discard the changes" onClick={() => { setDraft(text); setEditing(false) }} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><X size={14} /></button></Hint>
          <Hint label="Save (Ctrl+Enter)"><button type="button" aria-label="Save the note" onClick={save} disabled={saving} className={`${BTN_ICON_SM} ${TONE_GHOST_OK}`}><Check size={14} /></button></Hint>
        </>
      ) : (
        <Hint label="Edit the note"><button type="button" aria-label="Edit the note" onClick={() => setEditing(true)} className={`${BTN_ICON_SM} ${TONE_GHOST}`}><Pencil size={13} /></button></Hint>
      )) : undefined}
    >
      {editing ? (
        <textarea
          autoFocus
          aria-label="Note"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') void save(); if (e.key === 'Escape') { setDraft(text); setEditing(false) } }}
          placeholder={'# Title\n- a bullet\n[ ] a task\n**bold**, `code`, links…'}
          spellCheck={false}
          className="flex-1 min-h-[6rem] w-full resize-none rounded-lg bg-white/5 border border-white/10 p-3 text-xs font-mono text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500/50 focus:ring-2 focus:ring-emerald-500/30"
        />
      ) : text.trim() ? (
        <CardBody className="pr-1">
          <div onDoubleClick={canEdit ? () => setEditing(true) : undefined}>
            <Rendered text={text} />
          </div>
        </CardBody>
      ) : (
        <EmptyState card
          icon={<StickyNote size={22} />}
          title="Nothing here yet"
          hint="Reminders, IPs, the things you keep looking up."
          action={canEdit ? <button type="button" onClick={() => setEditing(true)} className={`${BTN_CARD} ${TONE_OK}`}>Write a note</button> : undefined}
        />
      )}
    </Card>
  )
}
