// =============================================================================
// UploadBackup — "Upload a backup": an archive kept elsewhere goes into the
// server's BACKUP_DEST_DIR (on a hub, into the VM the page shows, through the
// hub). The file itself is the request body (no base64), streamed, up to the
// server's API_MAX_BACKUP_UPLOAD_SIZE (20 GB); it is checked against that limit
// and the room on the server's disk before a byte is sent, and the button shows
// its progress. The server lists it only once it reads back whole as a DCS
// backup and says why when it does not (not gzip, cut short, no manifest,
// unsafe to unpack).
// =============================================================================

import { useCallback, useRef, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import Hint from '../common/Hint'
import { useToast } from '../common/Toast'
import { BTN_CARD_QUIET } from '../../lib/ui'
import { formatBytes, uploadBackupScoped, uploadRefusal } from '../../api/fleetScopedOps'
import type { UploadLimits } from '../../../shared/types'

export default function UploadBackup({ member, serverLabel, limits, disabled, onUploaded }: {
  /** the VM it goes into (null: this server, the hub) */
  member: string | null
  /** "the hub", "the VM media", "this server": for the hint and the toasts */
  serverLabel: string
  /** that server's limit and free room (its GET /backups/config `upload`): undefined on an older server, null while not known */
  limits: UploadLimits | null | undefined
  disabled?: boolean
  onUploaded: () => void
}) {
  const { addToast } = useToast()
  const fileRef = useRef<HTMLInputElement>(null)
  const [sent, setSent] = useState<{ sent: number; total: number } | null>(null)

  const upload = useCallback(async (file: File | null) => {
    if (!file) return
    if (file.size === 0) { addToast({ type: 'error', message: `${file.name} is empty` }); return }
    const refusal = uploadRefusal(file, limits, serverLabel)
    if (refusal) { addToast({ type: 'error', duration: 12000, message: refusal }); return }
    setSent({ sent: 0, total: file.size })
    try {
      const r = await uploadBackupScoped(member, file, (n, total) => setSent({ sent: n, total }))
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
      addToast({ type: 'error', duration: 15000, message: `${file.name} was not uploaded: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setSent(null)
    }
  }, [addToast, member, serverLabel, limits, onUploaded])

  const busy = sent !== null
  const pct = sent && sent.total > 0 ? Math.min(100, Math.floor((sent.sent / sent.total) * 100)) : 0
  const checking = sent !== null && sent.total > 0 && sent.sent >= sent.total
  const limitNote = limits ? ` (up to ${formatBytes(limits.max_bytes)}${limits.free_bytes !== null ? `, ${formatBytes(limits.free_bytes)} free there` : ''})` : ''
  return (
    <>
      <Hint label={busy
        ? (checking ? `Sent: ${serverLabel} is checking the archive before it lists it` : `Sent ${formatBytes(sent!.sent)} of ${formatBytes(sent!.total)}`)
        : `Put an archive you kept elsewhere into BACKUP_DEST_DIR on ${serverLabel}${limitNote}: it is checked before it is listed`}>
        <span className="inline-flex">
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={disabled || busy}
            aria-label={busy ? (checking ? 'Uploaded, being checked' : `Uploading, ${pct}%`) : `Upload a backup to ${serverLabel}`}
            className={`${BTN_CARD_QUIET} relative overflow-hidden`}
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
            {busy
              ? <span className="tabular-nums">{checking ? 'Checking…' : <>Uploading {pct}%<span className="hidden sm:inline"> · {formatBytes(sent!.sent)} of {formatBytes(sent!.total)}</span></>}</span>
              : <span>Upload a backup</span>}
            {busy && (
              // the share sent, as a bar along the button's foot
              <span aria-hidden className="absolute left-0 bottom-0 h-0.5 bg-emerald-400 transition-[width] duration-300" style={{ width: `${checking ? 100 : pct}%` }} />
            )}
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
