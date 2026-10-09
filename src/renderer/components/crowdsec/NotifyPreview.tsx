// =============================================================================
// The preview column: the message as Discord would draw it (drawn by the
// server, so it is what CrowdSec really sends), the example alert to draw it
// for, a dark/light Discord, the raw message, and the test message.
// =============================================================================

import { useEffect, useRef } from 'react'
import { ChevronDown, ChevronRight, Clock, Eye, Info, Loader2, Moon, Send, Sun, TriangleAlert } from 'lucide-react'
import type { DiscordWebhookPayload } from '../../../shared/types'
import { fmtAgo, useNow } from './kit'
import { DiscordMessage } from './DiscordPreview'
import { SAMPLE_INFO, redact, sampleLabel } from './NotifyModel'
import { TestOutcome, type TestOutcomeData } from './NotifyStatus'

import { BTN_TOOLBAR_OK } from '../../lib/ui'
import { INPUT } from '../../lib/fieldStyles'
import { CARD } from '../../lib/pageKit'
import SectionHeader from '../common/SectionHeader'
import { SkeletonBlock } from '../common/PageState'
import Segmented from '../common/Segmented'
import { CopyButton } from '../common/CopyButton'
import Notice from '../common/Notice'
export interface PreviewPanelProps {
  payload: DiscordWebhookPayload | null
  loading: boolean
  /** why the settings on the page cannot be drawn (the server's own words) */
  problem: string | null
  approximate: boolean
  /** the person can change the settings (the preview then follows what is typed); a viewer only reads */
  editable?: boolean
  samples: string[]
  sample: string
  onSample: (s: string) => void
  dark: boolean
  onDark: (dark: boolean) => void
  isAdmin: boolean
  /** null = a test can be sent; otherwise why not */
  testBlocked: string | null
  testing: boolean
  onTest: () => void
  includeMention: boolean
  onIncludeMention: (v: boolean) => void
  hasMention: boolean
  test: TestOutcomeData | null
  testWebhook?: string
  /** what the server remembers, shown under the test: the last change and the delivery problems CrowdSec reported */
  lastApply: { at: number; ok: boolean; message: string } | null
  deliveryErrors: { time: string; message: string }[]
  unsaved: boolean
  /** inside a sheet, which already has its own frame */
  bare?: boolean
}

export default function PreviewPanel(p: PreviewPanelProps) {
  const now = useNow()
  const json = p.payload ? JSON.stringify(p.payload, null, 2) : ''
  const result = useRef<HTMLDivElement>(null)
  // a new answer is scrolled into view: the column scrolls on its own when the message is tall
  useEffect(() => { if (p.test) result.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [p.test?.at]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <section className={p.bare ? 'space-y-3' : `${CARD} p-4 space-y-3`} aria-label="Preview">
      <SectionHeader icon={Eye} title="Live preview"
        right={
          <div className="flex items-center gap-2">
            {p.loading && <Loader2 size={13} className="animate-spin text-slate-500" aria-label="Updating the preview" />}
            <Segmented<'dark' | 'light'> value={p.dark ? 'dark' : 'light'} onChange={(v) => p.onDark(v === 'dark')} ariaLabel="Discord theme"
              options={[{ value: 'dark', label: 'Dark', icon: Moon, title: 'Discord’s dark theme' }, { value: 'light', label: 'Light', icon: Sun, title: 'Discord’s light theme' }]} />
          </div>
        } />

      {p.approximate
        ? <Notice tone="info" icon={Info}>This is drawn here from example values, so it is close but not exact. An administrator sees the message exactly as the server builds it.</Notice>
        : <p className="text-xs text-slate-500 leading-relaxed">Drawn by the server, so it is what CrowdSec sends.{p.editable === false ? '' : ' It updates as you type.'}</p>}

      {p.approximate ? null : (
        <div>
          <label htmlFor="notify-sample" className="block text-xs font-medium text-slate-500 mb-1">Example alert</label>
          <div className="relative">
            <select id="notify-sample" value={p.sample} onChange={(e) => p.onSample(e.target.value)} className={`${INPUT} !h-9 !text-xs appearance-none pr-8 cursor-pointer`}>
              {p.samples.map((s) => <option key={s} value={s}>{sampleLabel(s)}</option>)}
            </select>
            <ChevronDown size={12} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          <p className="text-[11px] text-slate-500 mt-1">{SAMPLE_INFO[p.sample]?.hint ?? 'A made-up alert to show the message with.'}</p>
        </div>
      )}

      {p.payload
        ? <DiscordMessage payload={p.payload} dark={p.dark} dim={p.loading || !!p.problem} />
        : p.problem ? null : <SkeletonBlock className="h-52" />}

      {p.problem && (
        <Notice tone="problem" icon={TriangleAlert} role="alert" title="This message cannot be drawn">
          {p.problem}{p.payload ? <span className="block mt-1 opacity-80">The preview above is the last one that worked.</span> : null}
        </Notice>
      )}

      {p.isAdmin && (
        <div className="border-t border-white/5 pt-3 space-y-2.5">
          <div className="flex items-center gap-3 flex-wrap">
            <button type="button" onClick={p.onTest} disabled={p.testing || !!p.testBlocked} className={BTN_TOOLBAR_OK} title={p.testBlocked ?? 'Post this example to the webhook now'}>
              {p.testing ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Send test message
            </button>
            <label className="inline-flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
              <input type="checkbox" checked={p.includeMention} onChange={(e) => p.onIncludeMention(e.target.checked)} className="accent-emerald-500" disabled={p.testing} />
              Include the mention in the test
            </label>
          </div>
          {p.testBlocked
            ? <p className="text-[11px] text-amber-300">{p.testBlocked}</p>
            : p.includeMention
              ? <p className="text-[11px] text-amber-300 leading-relaxed">This posts the example exactly as CrowdSec would send it, with the mention{p.hasMention ? ', so whoever is mentioned gets pinged' : ' (none is set up, so nobody is)'}.</p>
              : <p className="text-[11px] text-slate-500 leading-relaxed">Posts this example to your channel for real, with the settings on this page{p.unsaved ? ' (even the ones you have not saved)' : ''}. It adds “· test message” to the footer{p.hasMention ? ' and leaves the mention out, so nobody is pinged' : ''}.</p>}
          {p.test && <div ref={result}><TestOutcome t={p.test} webhook={p.testWebhook} /></div>}
          {(p.lastApply || p.deliveryErrors.length > 0) && (
            <ul className="space-y-1 text-[11px] text-slate-500" aria-label="Recent activity">
              {p.lastApply && <li className={`flex items-start gap-1.5 ${p.lastApply.ok ? '' : 'text-rose-300'}`}><Clock size={11} className="shrink-0 mt-0.5" /><span className="min-w-0 break-words">Last change {p.lastApply.ok ? 'applied' : 'failed'} {fmtAgo(p.lastApply.at, now)}: {redact(p.lastApply.message)}</span></li>}
              {p.deliveryErrors.length > 0 && <li className="flex items-start gap-1.5 text-amber-300"><TriangleAlert size={11} className="shrink-0 mt-0.5" /><span className="min-w-0 break-words">{p.deliveryErrors.length} delivery problem{p.deliveryErrors.length === 1 ? '' : 's'} reported, the latest {fmtAgo(p.deliveryErrors[0].time, now)}: <span className="font-mono">{redact(p.deliveryErrors[0].message)}</span></span></li>}
            </ul>
          )}
        </div>
      )}

      {p.payload && (
        <details className="group text-xs">
          <summary className="cursor-pointer text-slate-500 hover:text-slate-200 select-none inline-flex items-center gap-1.5 list-none [&::-webkit-details-marker]:hidden"><ChevronRight size={12} className="transition-transform group-open:rotate-90" /> The message as JSON</summary>
          <div className="relative mt-2">
            <div className="absolute right-1 top-1"><CopyButton text={json} label="Copy the message as JSON" /></div>
            <pre className="text-[11px] leading-relaxed font-mono text-slate-300 bg-white/[0.03] border border-white/5 rounded-lg p-3 pr-9 max-h-64 overflow-auto scrollbar-thin whitespace-pre-wrap break-words" tabIndex={0} aria-label="The message as JSON">{json}</pre>
          </div>
        </details>
      )}
    </section>
  )
}
