// =============================================================================
// SearchInput — the one search box: a magnifier at the left, the field
// (lib/fieldStyles), and a ✕ that clears it once something is typed. It fills
// the width of what holds it; the holder decides how wide that is.
//
//   <SearchInput value={q} onChange={setQ} placeholder="Search containers…" />
//   <SearchInput size="sm" value={q} onChange={setQ} label="Filter the lines" />   34 px, in a toolbar or a card
//
//   label   the field's name for a screen reader (default: the placeholder, else "Search")
//   onClear what the ✕ does besides emptying the field (focus stays in the field)
// =============================================================================

import { forwardRef, useRef, type InputHTMLAttributes } from 'react'
import { Search, X } from 'lucide-react'
import { FIELD_SM, INPUT_ICON } from '../../lib/fieldStyles'
import { BTN_ICON_SM, TONE_GHOST } from '../../lib/ui'

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'size'> {
  value: string
  onChange: (v: string) => void
  label?: string
  size?: 'md' | 'sm'
  onClear?: () => void
}

const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, label, size = 'md', onClear, placeholder, className = '', onKeyDown, ...input }, ref,
) {
  const own = useRef<HTMLInputElement | null>(null)
  const sm = size === 'sm'
  const clear = () => {
    onChange('')
    onClear?.()
    own.current?.focus()
  }
  return (
    <div className={`relative min-w-0 ${className}`}>
      <Search size={sm ? 12 : 14} className={`absolute top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none ${sm ? 'left-2.5' : 'left-3'}`} aria-hidden />
      <input
        {...input}
        ref={(el) => {
          own.current = el
          if (typeof ref === 'function') ref(el)
          else if (ref) ref.current = el
        }}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label={label ?? placeholder ?? 'Search'}
        className={sm ? `w-full ${FIELD_SM} !pl-8 pr-8` : `${INPUT_ICON} !pr-9`}
      />
      {value && (
        <button type="button" onClick={clear} aria-label="Clear the search" className={`absolute right-1 top-1/2 -translate-y-1/2 ${BTN_ICON_SM} ${TONE_GHOST} ${sm ? '!h-7 !w-7 sm:!h-6 sm:!w-6' : ''}`}>
          <X size={12} aria-hidden />
        </button>
      )}
    </div>
  )
})

export default SearchInput
