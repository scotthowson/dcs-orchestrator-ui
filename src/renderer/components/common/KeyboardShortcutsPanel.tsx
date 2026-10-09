// =============================================================================
// KeyboardShortcutsPanel — Quick-reference overlay for all keyboard shortcuts
// =============================================================================

import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { X, Keyboard } from 'lucide-react'
import ModalOverlay from './ModalOverlay'
import { pageLabel } from '../../constants/pageTitles'

import CloseButton from './CloseButton'
interface Props {
  open: boolean
  onClose: () => void
}

const shortcutGroups = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Ctrl', '1-9'], description: 'Switch to page by index' },
      { keys: ['Ctrl', '0'], description: pageLabel('settings') },
    ],
  },
  {
    title: 'Actions',
    shortcuts: [
      { keys: ['Ctrl', 'K'], description: 'Command palette' },
      { keys: ['Ctrl', 'B'], description: 'Toggle sidebar' },
      { keys: ['Ctrl', 'D'], description: 'Toggle theme' },
      { keys: ['Ctrl', 'R'], description: 'Refresh data' },
      { keys: ['Ctrl', 'T'], description: pageLabel('terminal') },
      { keys: ['Ctrl', 'Shift', 'P'], description: 'Command palette (alt)' },
    ],
  },
  {
    title: 'Page-specific',
    shortcuts: [
      { keys: ['?'], description: 'This shortcuts panel' },
      { keys: ['Esc'], description: 'Close dialogs and modals' },
    ],
  },
]

export default function KeyboardShortcutsPanel({ open, onClose }: Props) {
  useEffect(() => {
    if (!open) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <ModalOverlay onClose={onClose}
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={onClose}
    >
      <div
        className="bg-slate-900/95 backdrop-blur-xl rounded-2xl w-full max-w-lg mx-4 border border-white/10 shadow-2xl shadow-black/40 animate-scale-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-violet-500/10 border border-violet-500/20 flex items-center justify-center">
              <Keyboard size={16} className="text-violet-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-white">Keyboard shortcuts</h2>
              <p className="text-[11px] text-slate-500">Quick reference for all shortcuts</p>
            </div>
          </div>
          <CloseButton onClick={onClose} />
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {shortcutGroups.map((group) => (
            <div key={group.title}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                {group.title}
              </h3>
              <div className="space-y-1.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.description}
                    className="flex items-center justify-between py-1.5 px-3 rounded-lg hover:bg-white/[0.03] transition-colors"
                  >
                    <span className="text-sm text-slate-300">{shortcut.description}</span>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={key}>
                          {i > 0 && <span className="text-slate-500 mx-0.5">+</span>}
                          <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-6 px-1.5 rounded-md bg-slate-800/80 border border-white/10 text-[11px] font-mono font-medium text-slate-300 shadow-sm">
                            {key}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/5 text-center">
          <p className="text-[11px] text-slate-500">
            Press <kbd className="px-1.5 py-0.5 rounded bg-slate-800/60 border border-white/5 text-[10px] font-mono text-slate-400">?</kbd> anytime to toggle this panel
          </p>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
