// =============================================================================
// Kbd — a key or a shortcut as it is written in a hint ("Press Esc to close",
// Ctrl+K beside the search). `md` is the size of the shortcuts panel's table.
// =============================================================================

import type { ReactNode } from 'react'

export default function Kbd({ children, size = 'sm', className = '' }: { children: ReactNode; size?: 'sm' | 'md'; className?: string }) {
  const box = size === 'md' ? 'rounded-md px-2 py-1 text-xs text-slate-300' : 'rounded px-1.5 py-0.5 text-[10px] text-slate-400'
  return <kbd className={`inline-flex items-center border border-white/10 bg-white/[0.03] font-mono leading-none ${box} ${className}`}>{children}</kbd>
}
