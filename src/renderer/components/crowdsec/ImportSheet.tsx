// =============================================================================
// Import bans: paste or load a list of addresses (one per line, CSV with a
// header, or JSON). Every entry is checked like a single ban; what is refused
// (invalid, private, your own, already banned …) is listed with the reason.
// =============================================================================

import { useRef, useState } from 'react'
import { Upload, Loader2, FileUp, CheckCircle2, AlertTriangle } from 'lucide-react'
import { useToast } from '../common/Toast'
import { crowdsecImportBans } from '../../api/endpoints'
import type { CrowdSecImportResponse } from '../../../shared/types'
import { DurationPicker, PERMANENT, errMsg, useCs } from './kit'
import { BTN_TOOLBAR_OK, BTN_TOOLBAR_QUIET } from '../../lib/ui'
import { HINT, INPUT, LABEL } from '../../lib/fieldStyles'
import { Pill } from '../common/Pill'
import Segmented from '../common/Segmented'
import Sheet from '../common/Sheet'
type Fmt = 'auto' | 'values' | 'csv' | 'json'
const MAX_BYTES = 512 * 1024

export default function ImportSheet({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const { member } = useCs()
  const { addToast } = useToast()
  const file = useRef<HTMLInputElement>(null)
  const [fmt, setFmt] = useState<Fmt>('auto')
  const [text, setText] = useState('')
  const [duration, setDuration] = useState('24h')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<CrowdSecImportResponse | null>(null)

  const lines = text.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#')).length
  const load = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_BYTES) { setError('That file is larger than 512 KB. Split it and import it in parts.'); return }
    setError(''); setText(await f.text())
    if (f.name.endsWith('.csv')) setFmt('csv'); else if (f.name.endsWith('.json')) setFmt('json')
  }
  const submit = async () => {
    if (!text.trim() || busy) return
    setBusy(true); setError('')
    try {
      const r = await crowdsecImportBans({ format: fmt, content: text, ...(duration === PERMANENT ? { permanent: true } : { duration }), reason: reason.trim() || undefined }, member)
      setResult(r)
      addToast({ type: r.imported > 0 ? 'success' : 'warning', message: `${r.imported} ban${r.imported === 1 ? '' : 's'} imported${r.skipped ? `, ${r.skipped} skipped` : ''}`, duration: 6000 })
      if (r.imported > 0) onDone()
    } catch (e) { setError(errMsg(e, 'The import failed')) } finally { setBusy(false) }
  }

  return (
    <Sheet title="Import bans" subtitle="A list of addresses to ban in one go" icon={<Upload size={18} />} onClose={onClose} wide
      footer={
        <div className="flex gap-2 justify-end flex-wrap">
          <button type="button" onClick={onClose} className={BTN_TOOLBAR_QUIET}>{result ? 'Close' : 'Cancel'}</button>
          {!result && <button type="button" onClick={submit} disabled={!text.trim() || busy} className={BTN_TOOLBAR_OK}>{busy ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Import{lines ? ` ${lines} entr${lines === 1 ? 'y' : 'ies'}` : ''}</button>}
          {result && <button type="button" onClick={() => setResult(null)} className={BTN_TOOLBAR_QUIET}>Import more</button>}
        </div>
      }>
      {result ? (
        <div className="space-y-4" role="status">
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-emerald-500/[0.08] border border-emerald-500/20 py-3"><p className="text-2xl font-semibold text-emerald-300 tabular-nums">{result.imported}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">imported</p></div>
            <div className="rounded-xl bg-amber-500/[0.08] border border-amber-500/20 py-3"><p className="text-2xl font-semibold text-amber-300 tabular-nums">{result.skipped}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">skipped</p></div>
            <div className="rounded-xl bg-cyan-500/[0.08] border border-cyan-500/20 py-3"><p className="text-2xl font-semibold text-cyan-400 tabular-nums">{result.allowlisted}</p><p className="text-[10px] uppercase tracking-wider text-slate-500">allowlisted</p></div>
          </div>
          {result.error && <p className="text-sm text-rose-300 flex gap-2"><AlertTriangle size={15} className="shrink-0 mt-0.5" /> {result.error}</p>}
          {result.skipped_entries.length > 0 && (
            <div className="rounded-xl border border-white/5 overflow-hidden">
              <p className="px-3 py-2 text-[11px] font-semibold text-slate-500 bg-white/[0.03]">Not imported</p>
              <ul className="divide-y divide-white/[0.04] max-h-64 overflow-y-auto scrollbar-thin">
                {result.skipped_entries.map((e, i) => (
                  <li key={`${e.line}-${i}`} className="px-3 py-2 text-xs flex items-start gap-2">
                    <span className="text-slate-500 tabular-nums w-8 shrink-0">#{e.line}</span>
                    <span className="font-mono text-slate-300 break-all min-w-0">{e.value}</span>
                    <span className="text-slate-500 ml-auto text-right basis-1/2 min-w-0 break-words">{e.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.imported > 0 && <p className="text-sm text-emerald-300 flex gap-2 items-center"><CheckCircle2 size={15} /> The new bans are in the list.</p>}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Segmented<Fmt> value={fmt} onChange={setFmt} ariaLabel="Format" options={[{ value: 'auto', label: 'Detect' }, { value: 'values', label: 'One per line' }, { value: 'csv', label: 'CSV' }, { value: 'json', label: 'JSON' }]} />
            <input ref={file} type="file" accept=".csv,.json,.txt,text/plain,text/csv,application/json" className="hidden" aria-label="Choose a file to import" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = '' }} />
            <button type="button" onClick={() => file.current?.click()} className={BTN_TOOLBAR_QUIET}><FileUp size={13} /> Choose a file…</button>
          </div>
          <div>
            <label className={LABEL} htmlFor="import-text">The list</label>
            <textarea id="import-text" className={`${INPUT} font-mono text-xs`} rows={8} value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} placeholder={'203.0.113.7\n198.51.100.0/24   # a comment\n2001:db8::/32'} />
            <p className={HINT}>One address or network per line (a # starts a comment), or a CSV with a header line (value, duration, reason), or a JSON list of objects. Bans lasting longer than 10 years, private ranges, your own address and already banned ones are skipped.</p>
          </div>
          <div>
            <p className={LABEL}>Length for entries that name none</p>
            <DurationPicker value={duration} onChange={setDuration} allowPermanent maxSeconds={315360000} ariaLabel="Default ban length" />
          </div>
          <div>
            <label className={LABEL} htmlFor="import-reason">Reason for entries that name none <span className="text-slate-500 font-normal">(optional)</span></label>
            <input id="import-reason" className={INPUT} value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} placeholder="Imported from DCS" />
          </div>
          {error && <p className="text-sm text-rose-300 flex gap-2" role="alert"><AlertTriangle size={15} className="shrink-0 mt-0.5" /> {error}</p>}
          {lines > 2000 && <Pill tone="attention">Only 2000 entries per import</Pill>}
        </div>
      )}
    </Sheet>
  )
}
