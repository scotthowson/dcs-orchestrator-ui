// =============================================================================
// ConnectionForm — Compact server URL with inline status, test & save
// =============================================================================

import React, { useState, useCallback, useEffect } from 'react'
import { Link2, Check, X, Loader2, Save } from 'lucide-react'
import { useConnectionStore } from '../../stores/connectionStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { discoverServer, type DiscoveredServer } from '../../lib/discover'
import { useServerStore } from '../../stores/serverStore'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, TONE_OK } from '../../lib/ui'
import { FIELD } from '../../lib/fieldStyles'

type TestStatus = 'idle' | 'testing' | 'success' | 'failed'

const statusStyles: Record<string, { dot: string; bg: string; text: string }> = {
  connected: { dot: 'bg-emerald-400', bg: 'bg-emerald-500/15', text: 'text-emerald-400' },
  connecting: { dot: 'bg-amber-400 animate-pulse', bg: 'bg-amber-500/15', text: 'text-amber-400' },
  error: { dot: 'bg-rose-400', bg: 'bg-rose-500/15', text: 'text-rose-400' },
  disconnected: { dot: 'bg-slate-400', bg: 'bg-slate-500/15', text: 'text-slate-400' },
}

export default function ConnectionForm() {
  const serverUrl = useConnectionStore((s) => s.serverUrl)
  const connectionStatus = useConnectionStore((s) => s.status)
  const setServerUrl = useConnectionStore((s) => s.setServerUrl)
  const connect = useConnectionStore((s) => s.connect)
  const updateSetting = useSettingsStore((s) => s.updateSetting)

  const [urlInput, setUrlInput] = useState(serverUrl)
  const [testStatus, setTestStatus] = useState<TestStatus>('idle')
  const [dirty, setDirty] = useState(false)
  const [resolved, setResolved] = useState<DiscoveredServer | null>(null)

  // Sync when server URL changes externally (e.g. server switch via ServerSwitcher)
  useEffect(() => {
    setUrlInput(serverUrl)
    setDirty(false)
    setTestStatus('idle')
  }, [serverUrl])

  const handleUrlChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setUrlInput(e.target.value)
      setDirty(e.target.value !== serverUrl)
      setTestStatus('idle')
    },
    [serverUrl],
  )

  const handleTest = useCallback(async () => {
    setTestStatus('testing')
    setResolved(null)
    // Discovery accepts the dashboard hostname, a LAN address or the API port
    // and returns the URL that really answers (direct or via the /api proxy)
    const found = await discoverServer(urlInput)
    if (!found) {
      setTestStatus('failed')
      return
    }
    setResolved(found)
    if (found.url !== urlInput) {
      setUrlInput(found.url)
      setDirty(found.url !== serverUrl)
    }
    setTestStatus('success')
  }, [urlInput, serverUrl])

  const handleSave = useCallback(() => {
    setServerUrl(urlInput)
    updateSetting('serverUrl', urlInput)
    // The sidebar's active profile is this connection: keep them the same. Another address is another server: the
    // session (and a remembered password) of the old one is not sent there, its sign-in asks
    const { activeServerId, updateServer, getActiveServer, enterActiveServer } = useServerStore.getState()
    const moved = !!activeServerId && getActiveServer()?.url !== urlInput
    if (activeServerId) updateServer(activeServerId, { url: urlInput })
    setDirty(false)
    if (moved) void enterActiveServer({ leave: true })
    else connect()
  }, [urlInput, setServerUrl, updateSetting, connect])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (dirty) handleSave()
      else handleTest()
    }
  }, [dirty, handleSave, handleTest])

  const style = statusStyles[connectionStatus] ?? statusStyles.disconnected

  return (
    <div className="space-y-3">
      {/* Status + URL input row */}
      <div className="flex items-center gap-2">
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium shrink-0 transition-colors duration-500 ${style.bg} ${style.text}`}>
          <span className={`h-1.5 w-1.5 rounded-full transition-colors duration-500 ${style.dot}`} />
          {connectionStatus}
        </span>
        <input
          aria-label="Server address"
          type="text"
          inputMode="url"
          value={urlInput}
          onChange={handleUrlChange}
          onKeyDown={handleKeyDown}
          placeholder="192.168.1.10:9876 or https://ui.example.com"
          className={`flex-1 min-w-0 font-mono ${FIELD}`}
        />
        <div className="flex items-center justify-center w-5 h-5 shrink-0">
          {testStatus === 'testing' && <Loader2 size={12} className="animate-spin text-amber-400" />}
          {testStatus === 'success' && <Check size={12} className="text-emerald-400" />}
          {testStatus === 'failed' && <X size={12} className="text-rose-400" />}
        </div>
      </div>

      {/* Test result — fixed height */}
      <div className="h-3.5" aria-live="polite">
        {testStatus === 'success' && (
          <p className="text-[10px] text-emerald-400 animate-fade-in">
            Reachable {resolved?.via === 'proxy' ? 'through the dashboard proxy' : 'on the API port'}{resolved?.version ? ` · API ${resolved.version}` : ''}{dirty ? ' — save to use this address' : ''}
          </p>
        )}
        {testStatus === 'failed' && (
          <p className="text-[10px] text-rose-400 animate-fade-in">Unreachable — tried as typed, with /api and on port 9876</p>
        )}
      </div>

      {/* Buttons */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testStatus === 'testing' || !urlInput.trim()}
          className={BTN_TOOLBAR_QUIET}
        >
          {testStatus === 'testing' ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />}
          Test
        </button>

        {/* the save button is there while the address is unchanged too, folded to nothing (and out of the tab order) */}
        <div className={`transition-all duration-200 overflow-hidden ${dirty ? 'max-w-[220px] opacity-100' : 'max-w-0 opacity-0 invisible'}`}>
          <button onClick={handleSave} className={`${BTN_TOOLBAR} ${TONE_OK} whitespace-nowrap`}>
            <Save size={14} />
            Save and reconnect
          </button>
        </div>
      </div>
    </div>
  )
}
