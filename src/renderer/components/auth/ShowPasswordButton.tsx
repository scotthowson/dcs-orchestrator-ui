// =============================================================================
// ShowPasswordButton — the eye at the end of a password field. Place it inside
// a `relative` wrapper; it can be reached with the keyboard and is named for
// what it does next ("Show password" / "Hide password").
// =============================================================================

import { Eye, EyeOff } from 'lucide-react'
import Hint from '../common/Hint'
import { BTN_ICON_SM, FOCUS_RING } from '../../lib/ui'
export default function ShowPasswordButton({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  const label = shown ? 'Hide password' : 'Show password'
  return (
    <Hint label={label}>
      <button
        type="button"
        onClick={onToggle}
        aria-label={label}
        className={`absolute right-1.5 top-1/2 -translate-y-1/2 ${BTN_ICON_SM} text-slate-500 hover:text-slate-300 hover:bg-white/5 ${FOCUS_RING}`}
      >
        {shown ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </Hint>
  )
}
