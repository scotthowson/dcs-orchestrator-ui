// =============================================================================
// ComposeViewer — a stack's detail's Compose: the stack's files in the one
// editor (StackFilesEditor). An admin edits them there; a viewer reads the
// compose file and its history.
// =============================================================================

import type { StackInfo } from '../../../shared/types'
import StackFilesEditor from './StackFilesEditor'

interface ComposeViewerProps {
  stackName: string
  /** the docker-compose.yml as read from the API (the caller does not open the viewer when the read failed) */
  content: string
  onClose: () => void
  /** saving is an admin call on the API: a viewer reads */
  isAdmin?: boolean
  stack?: StackInfo | null
}

export function ComposeViewer({ stackName, content, onClose, isAdmin = false, stack }: ComposeViewerProps) {
  return <StackFilesEditor stackName={stackName} stack={stack ?? undefined} initialContent={content} isAdmin={isAdmin} onClose={onClose} />
}
