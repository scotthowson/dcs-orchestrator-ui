// =============================================================================
// KeyboardShortcuts — Full-screen overlay showing all keyboard shortcuts
// =============================================================================

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { Keyboard, X } from 'lucide-react'
import { isNative } from '../hooks/useMobile'
import { useAuthStore } from '../stores/authStore'
import { useSettingsStore } from '../stores/settingsStore'
import ModalOverlay from './common/ModalOverlay'

import Kbd from './common/Kbd'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Shortcut {
  keys: string[]
  label: string
}

interface ShortcutSection {
  title: string
  shortcuts: Shortcut[]
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

const sections: ShortcutSection[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: ['Ctrl', '1-9'], label: 'Open a sidebar section by its place' },
      { keys: ['Ctrl', '0'], label: 'Settings (the tenth section)' },
      { keys: ['Ctrl', 'K'], label: 'Command palette' },
      { keys: ['Ctrl', 'Shift', 'P'], label: 'Command palette (alt)' },
      { keys: ['Ctrl', 'T'], label: 'Terminal' },
    ],
  },
  {
    title: 'Interface',
    shortcuts: [
      { keys: ['Ctrl', 'B'], label: 'Toggle sidebar' },
      { keys: ['Ctrl', 'D'], label: 'Toggle dark/light theme' },
      { keys: ['Ctrl', 'R'], label: 'Refresh all data' },
    ],
  },
  {
    title: 'Pages',
    shortcuts: [
      { keys: ['Ctrl', '/'], label: 'This shortcuts panel' },
      { keys: ['?'], label: 'This shortcuts panel' },
      { keys: ['Escape'], label: 'Close overlays' },
    ],
  },
  {
    title: 'Editors (compose files, templates)',
    shortcuts: [
      { keys: ['Ctrl', 'S'], label: 'Check, then save (one press)' },
      { keys: ['Ctrl', 'F'], label: 'Find and replace' },
      { keys: ['Enter'], label: 'Next match (Shift+Enter: the one before)' },
      { keys: ['Escape'], label: 'Close Find, then the editor (it asks when something is unsaved)' },
    ],
  },
]

// ---------------------------------------------------------------------------
// KeyBadge
// ---------------------------------------------------------------------------

function KeyBadge({ children }: { children: string }) {
  return (
    <Kbd size="md">
      {children}
    </Kbd>
  )
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false)
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const currentPage = useSettingsStore((s) => s.currentPage)

  // Open on "?" (outside inputs) or Ctrl+/  —  close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Disable during setup wizard and when not authenticated
      if (!isAuthenticated || currentPage === 'setup') return

      // Close on Escape
      if (e.key === 'Escape' && open) {
        e.preventDefault()
        setOpen(false)
        return
      }

      // Ctrl+/
      if ((e.ctrlKey || e.metaKey) && e.key === '/') {
        e.preventDefault()
        setOpen((prev) => !prev)
        return
      }

      // "?" — but not when typing in an input, textarea, or contenteditable
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName?.toLowerCase()
        const isEditable =
          tag === 'input' ||
          tag === 'textarea' ||
          tag === 'select' ||
          (e.target as HTMLElement)?.isContentEditable
        if (!isEditable) {
          e.preventDefault()
          setOpen((prev) => !prev)
        }
      }
    },
    [open, isAuthenticated, currentPage],
  )

  useEffect(() => {
    // Don't register keyboard listeners on native touch devices
    if (isNative) return
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Click backdrop to close
  const handleBackdropClick = useCallback(() => {
    setOpen(false)
  }, [])

  // Keyboard shortcuts are meaningless on touch devices
  if (isNative || !open) return null

  return createPortal(
    <ModalOverlay onClose={handleBackdropClick} className="fixed inset-0 z-[9999] flex items-start justify-center pt-[12vh]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm animate-fade-in"
        onClick={handleBackdropClick}
      />

      {/* Panel */}
      <div
        className="
          relative w-full max-w-[520px] mx-4
          bg-slate-900/95 backdrop-blur-2xl
          border border-white/10
          rounded-2xl shadow-2xl shadow-black/40
          animate-scale-in
        "
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-white/[0.05] border border-white/10">
              <Keyboard size={16} className="text-slate-400" />
            </div>
            <h2 className="text-sm font-semibold text-slate-200">
              Keyboard shortcuts
            </h2>
          </div>

          {/* Close button */}
          <button
            onClick={() => setOpen(false)}
            className="
              flex items-center justify-center w-7 h-7 rounded-lg
              text-slate-500 hover:bg-white/5 hover:text-slate-300
              transition-all duration-150
            "
            title="Close"
          >
            <X size={14} />
          </button>
        </div>

        {/* Shortcut sections */}
        <div className="px-6 py-4 space-y-5 max-h-[60vh] overflow-y-auto scrollbar-thin">
          {sections.map((section) => (
            <div key={section.title}>
              <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2.5">
                {section.title}
              </h3>
              <div className="space-y-1.5">
                {section.shortcuts.map((shortcut, idx) => (
                  <div
                    key={`${section.title}-${idx}`}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="text-sm text-slate-300">
                      {shortcut.label}
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-4">
                      {shortcut.keys.map((key, kidx) => (
                        <span key={kidx} className="flex items-center gap-1">
                          {kidx > 0 && (
                            <span className="text-[10px] text-slate-500">+</span>
                          )}
                          <KeyBadge>{key}</KeyBadge>
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
        <div className="px-6 py-3 border-t border-white/5">
          <p className="text-[11px] text-slate-500 text-center">
            Press <Kbd>?</Kbd> or{' '}
            <Kbd>Ctrl+/</Kbd> to toggle
          </p>
        </div>
      </div>
    </ModalOverlay>,
    document.body,
  )
}
