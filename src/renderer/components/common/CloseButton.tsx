// =============================================================================
// CloseButton — the ✕ that closes or dismisses something, the same everywhere:
// a ghost icon button (lib/ui) named by what it closes.
//
//   <CloseButton onClick={onClose} />                         a sheet, a dialog, an overlay: 32 px (36 on a phone), ✕ at 16
//   <CloseButton size="sm" label="Close the guide" onClick={…} />   a guide, a panel, a toast, a notice: 28 px, ✕ at 14
// =============================================================================

import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { X } from 'lucide-react'
import { BTN_ICON, BTN_ICON_SM, TONE_GHOST } from '../../lib/ui'

export interface CloseButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** what it does, for a screen reader: "Close" (default), "Dismiss", "Close the guide" */
  label?: string
  size?: 'md' | 'sm'
}

const CloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function CloseButton({ label = 'Close', size = 'md', className = '', type = 'button', ...rest }, ref) {
  return (
    <button ref={ref} type={type} aria-label={label} className={`${size === 'sm' ? BTN_ICON_SM : BTN_ICON} ${TONE_GHOST} ${className}`} {...rest}>
      <X size={size === 'sm' ? 14 : 16} aria-hidden />
    </button>
  )
})

export default CloseButton
