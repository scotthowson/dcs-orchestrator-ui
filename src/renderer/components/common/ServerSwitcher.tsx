import React, { useState, useRef, useEffect, useCallback } from 'react'
import { Server, Plus, ChevronDown, Check, Trash2, Globe, Loader2, Pencil, AlertCircle, WifiOff, LogOut, KeyRound } from 'lucide-react'
import { useServerStore } from '../../stores/serverStore'
import { useConnectionStore } from '../../stores/connectionStore'
import { useAuthStore } from '../../stores/authStore'
import { accountLine } from '../auth/ServerGateScreens'

export function ServerSwitcher() {
  const { servers, activeServerId, loading, loadServers, addServer, removeServer, updateServer, switchServer } = useServerStore()
  const { status, lastError, reconnectAttempts } = useConnectionStore()
  const unreachable = useServerStore((s) => s.unreachable)
  const signedInHere = useAuthStore((s) => s.isAuthenticated && s.validatedServerId === activeServerId)
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newUrl, setNewUrl] = useState('')
  const [addError, setAddError] = useState('')
  const [switching, setSwitching] = useState<string | null>(null)
  const [switchError, setSwitchError] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const editInputRef = useRef<HTMLInputElement>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { loadServers() }, [loadServers])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false)
        setEditingId(null)
        setShowAddForm(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  // Focus edit input when editing
  useEffect(() => {
    if (editingId && editInputRef.current) editInputRef.current.focus()
  }, [editingId])

  // Focus name input when add form opens
  useEffect(() => {
    if (showAddForm && nameInputRef.current) nameInputRef.current.focus()
  }, [showAddForm])

  const active = servers.find(s => s.id === activeServerId)
  const isError = status === 'error' || status === 'disconnected'
  const isConnecting = status === 'connecting'
  const statusDot = status === 'connected' ? 'bg-emerald-400'
    : isConnecting ? 'bg-amber-400 animate-pulse'
    : isError ? 'bg-rose-400'
    : 'bg-slate-500'

  const handleSwitch = useCallback(async (id: string) => {
    if (id === activeServerId && status === 'connected') {
      setOpen(false)
      return
    }
    setSwitching(id)
    setSwitchError(null)
    const ok = await switchServer(id)
    setSwitching(null)
    if (ok) {
      setSwitchError(null)
      setOpen(false)
    } else {
      setSwitchError(id)
    }
  }, [activeServerId, status, switchServer])

  const handleAdd = useCallback(async () => {
    if (!newName.trim() || !newUrl.trim()) return
    setAddError('')

    let url = newUrl.trim()
    if (!/^https?:\/\//i.test(url)) url = `http://${url}`

    const s = addServer({ name: newName.trim(), url })
    setSwitching(s.id)
    setSwitchError(null)
    const ok = await switchServer(s.id)
    setSwitching(null)

    if (ok) {
      setShowAddForm(false)
      setNewName('')
      setNewUrl('')
      setAddError('')
      setSwitchError(null)
      setOpen(false)
    } else {
      setAddError('Could not connect — check the URL and ensure the server is running')
      setSwitchError(s.id)
    }
  }, [newName, newUrl, addServer, switchServer])

  const handleStartEdit = useCallback((id: string, currentName: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingId(id)
    setEditName(currentName)
  }, [])

  const handleSaveEdit = useCallback((id: string) => {
    if (editName.trim()) {
      updateServer(id, { name: editName.trim() })
    }
    setEditingId(null)
  }, [editName, updateServer])

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') handleSaveEdit(id)
    if (e.key === 'Escape') setEditingId(null)
  }, [handleSaveEdit])

  const resetAddForm = useCallback(() => {
    setShowAddForm(false)
    setNewName('')
    setNewUrl('')
    setAddError('')
  }, [])

  return (
    <div ref={dropdownRef} className="relative">
      {/* Trigger button */}
      <button onClick={() => { setOpen(!open); if (open) { setEditingId(null); resetAddForm() } }} className="flex items-center gap-2 w-full px-2 py-1.5 rounded-lg hover:bg-white/5 transition-colors duration-200 group">
        <div className="relative">
          <Server className="w-4 h-4 text-slate-400" />
          <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${statusDot} ring-2 ring-slate-900 transition-colors duration-500`} />
        </div>
        <div className="flex-1 min-w-0 text-left">
          <span className="text-sm text-slate-300 truncate block">{active?.name || 'No server'}</span>
          {isError && active && (
            <span className="text-[10px] text-rose-400 truncate block">Connection failed</span>
          )}
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-slate-900/95 backdrop-blur-xl rounded-xl border border-white/10 shadow-2xl z-50 overflow-hidden animate-scale-in origin-top">
          {/* Connection error banner */}
          {isError && active && (
            <div className="px-3 py-2.5 bg-rose-500/[0.08] border-b border-rose-500/15 flex items-start gap-2">
              <AlertCircle className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <p className="text-[11px] text-rose-400 font-medium">
                  {isConnecting ? 'Connecting...' : reconnectAttempts > 0 ? `Reconnecting (attempt ${reconnectAttempts})...` : 'Unable to connect'}
                </p>
                <p className="text-[10px] text-rose-400/60 truncate mt-0.5">
                  {lastError || active.url}
                </p>
              </div>
            </div>
          )}

          {/* Server list */}
          <div className="p-1 max-h-64 overflow-y-auto scrollbar-thin">
            {servers.map(s => {
              const isActive = s.id === activeServerId
              const isSwitching = switching === s.id
              const hasSwitchError = switchError === s.id && !isSwitching
              const isEditing = editingId === s.id

              return (
                <div key={s.id} className={`rounded-lg ${isActive ? 'bg-white/5' : 'hover:bg-white/[0.03]'} transition-colors`}>
                  <div className="flex items-center gap-2 px-3 py-2 group">
                    {/* Server info / switch button */}
                    <button
                      onClick={() => handleSwitch(s.id)}
                      disabled={isSwitching}
                      className="flex items-center gap-2 flex-1 min-w-0"
                    >
                      <div className="relative shrink-0">
                        {isSwitching ? (
                          <Loader2 className="w-4 h-4 text-cyan-400 animate-spin" />
                        ) : (
                          <>
                            <Globe className="w-4 h-4 text-slate-500" />
                            {isActive && <div className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full ${statusDot} ring-2 ring-slate-900 transition-colors duration-500`} />}
                          </>
                        )}
                      </div>
                      <div className="flex-1 min-w-0 text-left">
                        {isEditing ? (
                          <input aria-label="Server name"
                            ref={editInputRef}
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            onKeyDown={e => handleEditKeyDown(e, s.id)}
                            onBlur={() => handleSaveEdit(s.id)}
                            onClick={e => e.stopPropagation()}
                            className="w-full px-1.5 py-0.5 -ml-1.5 rounded bg-black/40 text-sm text-white border border-cyan-500/30 focus:outline-none"
                          />
                        ) : (
                          <div className="text-sm text-white truncate">{s.name}</div>
                        )}
                        <div className="text-[11px] text-slate-500 truncate font-mono">{s.url}</div>
                        {(() => {
                          const line = accountLine(s, { active: isActive, signedInHere, unreachable: unreachable[s.id] })
                          return <div className={`text-[10px] truncate ${line.tone === 'ok' ? 'text-emerald-400' : line.tone === 'bad' ? 'text-rose-400' : 'text-slate-500'}`}>{line.text}</div>
                        })()}
                      </div>
                      {isActive && !isSwitching && status === 'connected' && (
                        <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                      )}
                      {isActive && isError && !isSwitching && (
                        <WifiOff className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                      )}
                    </button>

                    {/* Action buttons */}
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
                      {s.session?.token && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void useServerStore.getState().signOutServer(s.id) }}
                          className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-amber-300 transition-colors"
                          title="Sign out here"
                          aria-label={`Sign out of ${s.name}`}
                        >
                          <LogOut className="w-3 h-3" />
                        </button>
                      )}
                      {s.remember && (
                        <button
                          onClick={(e) => { e.stopPropagation(); void useServerStore.getState().forgetServerPassword(s.id) }}
                          className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-amber-300 transition-colors"
                          title="Forget password"
                          aria-label={`Forget the password saved for ${s.name}`}
                        >
                          <KeyRound className="w-3 h-3" />
                        </button>
                      )}
                      {!isEditing && (
                        <button
                          onClick={(e) => handleStartEdit(s.id, s.name, e)}
                          className="p-1 rounded hover:bg-white/5 text-slate-500 hover:text-cyan-400 transition-colors"
                          title="Rename"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                      )}
                      {servers.length > 1 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); removeServer(s.id) }}
                          className="p-1 rounded hover:bg-rose-500/10 text-slate-500 hover:text-rose-400 transition-colors"
                          title="Remove"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Per-server switch error */}
                  {hasSwitchError && (
                    <div className="px-3 pb-2 flex items-center gap-1.5 animate-fade-in">
                      <AlertCircle className="w-3 h-3 text-rose-400 shrink-0" />
                      <span className="text-[10px] text-rose-400">Failed to connect — check URL and server status</span>
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {/* Add Server section */}
          <div className="border-t border-white/5">
            {showAddForm ? (
              <div className="p-2.5 space-y-2 animate-fade-in">
                <input
                  ref={nameInputRef}
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setAddError('') }}
                  placeholder="Server name"
                  className="w-full px-2.5 py-1.5 rounded-lg bg-black/30 text-sm text-white placeholder-slate-500 border border-white/5 focus:border-cyan-500/30 focus:outline-none transition-colors"
                  onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && newUrl.trim()) handleAdd(); if (e.key === 'Escape') resetAddForm() }}
                />
                <input
                  value={newUrl}
                  onChange={e => { setNewUrl(e.target.value); setAddError('') }}
                  placeholder="http://192.168.1.100:9876"
                  className={`w-full px-2.5 py-1.5 rounded-lg bg-black/30 text-sm text-white font-mono placeholder-slate-500 border focus:outline-none transition-colors ${
                    addError ? 'border-rose-500/30 focus:border-rose-500/40' : 'border-white/5 focus:border-cyan-500/30'
                  }`}
                  onKeyDown={e => { if (e.key === 'Enter' && newName.trim() && newUrl.trim()) handleAdd(); if (e.key === 'Escape') resetAddForm() }}
                />
                {addError && (
                  <div className="flex items-start gap-1.5 animate-fade-in">
                    <AlertCircle className="w-3 h-3 text-rose-400 mt-0.5 shrink-0" />
                    <span className="text-[10px] text-rose-400 leading-tight">{addError}</span>
                  </div>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={resetAddForm}
                    className="flex-1 px-2 py-1.5 rounded-lg text-xs text-slate-400 hover:bg-white/5 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAdd}
                    disabled={loading || !newName.trim() || !newUrl.trim() || !!switching}
                    className="flex-1 px-2 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-400 text-xs font-medium hover:bg-emerald-500/25 disabled:opacity-50 flex items-center justify-center gap-1.5 transition-colors press"
                  >
                    {switching ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                    Add & Connect
                  </button>
                </div>
              </div>
            ) : (
              <div className="p-1">
                <button
                  onClick={() => setShowAddForm(true)}
                  className="flex items-center gap-2 w-full px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-emerald-400 hover:bg-white/5 transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  Add Server
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
