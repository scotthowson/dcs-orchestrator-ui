// =============================================================================
// CopyButton — the one way to copy a value: the copy icon turns into a green
// check for a moment ("Copied"). It copies over plain http too (lib/clipboard).
//
//   <CopyButton text={ip} />                              an icon (24 px, the icon at 12) beside a value
//   <CopyButton text={cmd} label="Copy" variant="chip" />  a card-size button with its word, "Copied" after
//   <CopyBlock text={cmd} label="the setup commands" />    a command in a well, the icon in its corner
//
//   label   what is copied, for a screen reader and the hint ("Copy the token"); the chip shows it
// =============================================================================

import { useState, type MouseEvent } from 'react'
import { Copy, Check } from 'lucide-react'
import Hint from './Hint'
import { copyText } from '../../lib/clipboard'
import { BTN_CARD_QUIET, FOCUS_RING } from '../../lib/ui'

function useCopied(text: string): [boolean, (e: MouseEvent) => void] {
  const [copied, setCopied] = useState(false)
  const copy = (e: MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    copyText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => { /* refused by the browser: the icon simply does not turn green */ })
  }
  return [copied, copy]
}

export function CopyButton({ text, label = 'Copy to clipboard', variant = 'icon', className = '' }: {
  text: string
  label?: string
  variant?: 'icon' | 'chip'
  className?: string
}) {
  const [copied, copy] = useCopied(text)
  const icon = copied ? <Check size={12} className="text-emerald-400" aria-hidden /> : <Copy size={12} aria-hidden />
  if (variant === 'chip') {
    return (
      <button type="button" onClick={copy} className={`${BTN_CARD_QUIET} ${className}`}>
        {icon} {copied ? 'Copied' : label}
      </button>
    )
  }
  return (
    <Hint label={copied ? 'Copied' : label}>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? 'Copied' : label}
        className={`inline-flex items-center justify-center h-6 w-6 rounded-md shrink-0 text-slate-500 hover:text-slate-200 hover:bg-white/10 transition-colors ${FOCUS_RING} ${className}`}
      >
        {icon}
      </button>
    </Hint>
  )
}

/** a command or a file in a well, selectable by hand, with the copy icon in its top corner */
export function CopyBlock({ text, label }: { text: string; label: string }) {
  return (
    <div className="relative">
      <pre className="rounded-lg bg-black/30 border border-white/10 px-3 py-2 pr-10 text-[11px] font-mono text-slate-300 whitespace-pre-wrap break-all">{text}</pre>
      <div className="absolute top-1.5 right-1.5"><CopyButton text={text} label={`Copy ${label}`} /></div>
    </div>
  )
}
