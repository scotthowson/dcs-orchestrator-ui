// =============================================================================
// UploadBackup — "Upload a backup": an archive kept elsewhere goes into the
// server's BACKUP_DEST_DIR (on a hub, into the VM the page shows, through the
// hub). The file itself is the request body (no base64), with its progress; the
// server lists it only once it reads back whole as a DCS backup and says why
// when it does not (not gzip, cut short, no manifest, unsafe to unpack).
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import Hint from '../common/Hint'
import { useToast } from '../common/Toast'
import { BTN_CARD_QUIET } from '../../lib/ui'
import { BACKUP_UPLOAD_MAX_BYTES, formatBytes, uploadBackupScoped } from '../../api/fleetScopedOps'

export default function UploadBackup({ member, serverLabel, disabled, onUploaded }: {
  /** the VM it goes into (null: this server, the hub) */
  member: string | null
  /** "the hub", "the VM media", "this server": for the hint and the toasts */
  serverLabel: string
  disabled?: boolean
  onUploaded: () => void
}) {
  const { addToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [share, setShare] = useState<number | null>(null)

  const upload = useCallback(async (file: File | null) => {
    if (!file) return
    if (file.size === 0) { addToast({ type: 'error', message: `${file.name} is empty` }); return }
    if (file.size > BACKUP_UPLOAD_MAX_BYTES) {
      addToast({ type: 'error', duration: 10000, message: `${file.name} is ${formatBytes(file.size)}: an upload can be ${formatBytes(BACKUP_UPLOAD_MAX_BYTES)} at most. Copy a larger archive into BACKUP_DEST_DIR on ${serverLabel} by hand (scp, a share); it is listed there as it is` })
      return
    }
    setShare(0)
    try {
      const r = await uploadBackupScoped(member, file, setShare)
      const what = r.kind === 'stack' && r.stack ? `a backup of ${r.stack}` : 'a full backup'
      addToast(r.duplicate
        ? { type: 'info', duration: 8000, message: `${r.filename} is already on ${serverLabel}, byte for byte: nothing was stored twice` }
        : {
            type: r.complete ? 'success' : 'warning',
            duration: 10000,
            message: `Uploaded to ${serverLabel} as ${r.filename}: ${what}, checked (${r.parts} parts)${r.renamed ? ` — renamed from ${file.name}` : ''}${r.complete ? '' : `; it was incomplete when it was made: ${r.warnings.join('; ')}`}`,
          })
      onUploaded()
    } catch (e) {
      addToast({ type: 'error', duration: 10000, message: `${file.name} was not uploaded: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setShare(null)
    }
  }, [addToast, member, serverLabel, onUploaded])

  const busy = share !== null
  return (
    <>
      <Hint label={`Put an archive you kept elsewhere into BACKUP_DEST_DIR on ${serverLabel}: it is checked before it is listed`}>
        <span className="inline-flex">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
            aria-label={busy ? `Uploading, ${Math.round((share ?? 0) * 100)}%` : `Upload a backup to ${serverLabel}`}
            className={BTN_CARD_QUIET}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {busy ? <span className="tabular-nums">{share !== null && share >= 1 ? 'Checking…' : `Uploading ${Math.round((share ?? 0) * 100)}%`}</span> : <span>Upload a backup</span>}
          </button>
        </span>
      </Hint>
      <input
        ref={fileRef}
        type="file"
        accept=".gz,.tgz,application/gzip,application/x-gzip"
        className="hidden"
        aria-label="Backup archive to upload"
        tabIndex={-1}
        onChange={(e) => { upload(e.target.files?.[0] ?? null); e.target.value = '' }}
      />
    </>
  )
}
