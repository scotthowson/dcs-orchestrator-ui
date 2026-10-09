// =============================================================================
// EditStackOverlay — the Stacks page's Edit: the stack's files in the one editor
// (StackFilesEditor), with the dashboard's labels for it. A container's "Edit
// compose" opens it at the container's service.
// =============================================================================

import type { StackInfo } from '../../../shared/types'
import StackFilesEditor from './StackFilesEditor'

interface Props {
  stack: StackInfo
  onClose: () => void
  onSaved: () => void
  /** open at this service's block (a container's Edit compose) */
  initialService?: string
}

export default function EditStackOverlay({ stack, onClose, onSaved, initialService }: Props) {
  return <StackFilesEditor stackName={stack.name} stack={stack} isAdmin withLabels initialService={initialService} onClose={onClose} onSaved={onSaved} />
}
