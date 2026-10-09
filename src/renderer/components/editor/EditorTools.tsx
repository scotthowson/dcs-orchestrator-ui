// =============================================================================
// EditorTools — the tools beside an editor's ✕, in the same order and words in
// every editor: Find · Diff · Copy. (History is a tab where the server keeps
// one: the stack's compose file.)
// =============================================================================

import { useState } from 'react'
import { Check, Copy, GitCompare, Search } from 'lucide-react'
import Hint from '../common/Hint'
import { copyText } from '../../lib/clipboard'
import { BTN_ICON, BTN_TOOLBAR, TONE_PRESSED, TONE_QUIET } from '../../lib/ui'

export default function EditorTools({ onFind, diff, copy }: {
  onFind?: () => void
  /** the Diff toggle: shown when there is a saved text to compare with */
  diff?: { on: boolean; toggle: () => void; changed: number }
  copy?: string
}) {
  const [copied, setCopied] = useState(false)
  return (
    <>
      {onFind && (
        <Hint label="Find and replace (Ctrl+F)">
          <button type="button" aria-label="Find" onClick={onFind} className={`${BTN_ICON} ${TONE_QUIET}`}><Search size={14} /></button>
        </Hint>
      )}
      {diff && (
        <Hint label={diff.changed ? 'Show your changes next to the saved file' : 'Nothing changed yet'}>
          <span className="inline-flex">
            <button type="button" aria-label="Diff" aria-pressed={diff.on} disabled={!diff.changed && !diff.on} onClick={diff.toggle} className={`${BTN_TOOLBAR} ${diff.on ? TONE_PRESSED : TONE_QUIET}`}>
              <GitCompare size={14} />
              <span className="hidden sm:inline">Diff</span>
            </button>
          </span>
        </Hint>
      )}
      {copy !== undefined && (
        <Hint label={copied ? 'Copied' : 'Copy the file'}>
          <button
            type="button"
            aria-label={copied ? 'Copied' : 'Copy the file'}
            onClick={() => copyText(copy).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) }).catch(() => {})}
            className={`${BTN_ICON} ${TONE_QUIET}`}
          >
            {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
          </button>
        </Hint>
      )}
    </>
  )
}
