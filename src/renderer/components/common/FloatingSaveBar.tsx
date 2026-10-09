// =============================================================================
// FloatingSaveBar — a page's form with unsaved changes (Settings, Config, the
// environment, a container's variables): the editors' save bar (editor/SaveBar)
// at the bottom of the window, above a phone's tab bar, lifting the chat and
// back-to-top buttons by its height while it shows.
// =============================================================================

import type React from 'react'
import SaveBar from '../editor/SaveBar'

interface FloatingSaveBarProps {
  hasChanges: boolean
  onSave: () => void
  onDiscard: () => void
  saving?: boolean
  saveLabel?: string
  savingLabel?: string
  message?: string
  /** what saving changes, under the message */
  detail?: string
  discardLabel?: string
  /** Extra control shown next to the message, e.g. an "apply now" switch */
  extra?: React.ReactNode
  /** Raise above full-screen editors (their overlays sit at 9999) */
  zIndex?: number
}

export function FloatingSaveBar({
  hasChanges,
  onSave,
  onDiscard,
  saving = false,
  saveLabel = 'Save',
  savingLabel = 'Saving…',
  message = 'You have unsaved changes',
  detail,
  discardLabel = 'Discard',
  extra,
  zIndex = 100,
}: FloatingSaveBarProps) {
  return (
    <SaveBar
      open={hasChanges}
      placement="page"
      status={message}
      detail={detail}
      phase={saving ? 'saving' : 'idle'}
      extra={extra}
      secondary={{ label: discardLabel, onClick: onDiscard }}
      primary={{ label: saveLabel, busyLabel: savingLabel, onClick: onSave }}
      zIndex={zIndex}
    />
  )
}
