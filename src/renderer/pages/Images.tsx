// =============================================================================
// Images — Image tracking page with table/card toggle and summary stats
// =============================================================================

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { SegmentedControl } from '@mantine/core'
import { useImageStore } from '../stores/imageStore'
import { usePolling } from '../hooks/usePolling'
import { fetchImages, runImagePrune, deleteImage, deleteImageRef, searchImages, pullImage, checkImageRegistry, checkFleetImageRegistry } from '../api/endpoints'
import { useFleetScope } from '../hooks/useFleetScope'
import FleetScopeChips from '../components/fleet/FleetScopeChips'
import AutoImageUpdates from '../components/updates/AutoImageUpdates'
import { useToast } from '../components/common/Toast'
import { useConfirm } from '../components/common/ConfirmDialog'
import { useConnectionStore } from '../stores/connectionStore'
import { useAuthStore } from '../stores/authStore'
import ImageList from '../components/images/ImageList'
import ImageCard from '../components/images/ImageCard'
import { imageKey } from '../components/images/imageFormat'
import PageHeader from '../components/common/PageHeader'
import Hint from '../components/common/Hint'
import { BTN_TOOLBAR, BTN_TOOLBAR_QUIET, BTN_CARD, BTN_CARD_QUIET, TONE_QUIET, TONE_OK, TONE_DANGER } from '../lib/ui'
import {
  HardDrive,
  CircleCheck,
  Clock,
  AlertTriangle,
  LayoutList,
  LayoutGrid,
  Search,
  Trash2,
  Loader2,
  ListChecks,
  Download,
  Star,
  BadgeCheck,
  X,
  Globe,
  RefreshCw,
  PackageSearch,
  ArrowUpCircle,
} from 'lucide-react'
import { DisconnectedBanner } from '../components/common/DisconnectedBanner'
import type { ImageSearchResult } from '../../shared/types'
import { LoadingState, EmptyState, ErrorState } from '../components/common/PageState'

const IMAGE_POLL_INTERVAL = 60_000

const Images: React.FC = () => {
  const setImages = useImageStore((s) => s.setImages)
  const setLoading = useImageStore((s) => s.setLoading)
  const images = useImageStore((s) => s.images)
  const loading = useImageStore((s) => s.loading)

  const [viewMode, setViewMode] = useState<'table' | 'cards'>('table')
  const [searchQuery, setSearchQuery] = useState('')
  const [pruneLoading, setPruneLoading] = useState(false)
  const [batchMode, setBatchMode] = useState(false)
  const [selectedImages, setSelectedImages] = useState<Set<string>>(new Set())
  const [batchLoading, setBatchLoading] = useState(false)
  const { addToast } = useToast()
  const confirm = useConfirm()
  const isConnected = useConnectionStore((s) => s.status === 'connected')
  const userRole = useAuthStore((s) => s.userRole)
  const isAdmin = userRole === 'admin'

  // Docker Hub search state
  const [activeTab, setActiveTab] = useState<'library' | 'search'>('library')
  const [hubSearchQuery, setHubSearchQuery] = useState('')
  const [hubSearchResults, setHubSearchResults] = useState<ImageSearchResult[]>([])
  const [hubSearchLoading, setHubSearchLoading] = useState(false)
  const [hubSearched, setHubSearched] = useState(false)
  const [pullingImages, setPullingImages] = useState<Set<string>>(new Set())

  // Registry check state
  const [registryChecking, setRegistryChecking] = useState(false)

  // a hub: everywhere (the hub and every VM), the hub alone, or one VM — the choice the Health and Updates pages share
  const { scope, setScope, member: scopeMember, memberName, members: scopeMembers, hasFleet } = useFleetScope()

  // Fetch images via the connection-aware polling hook
  const handleFetch = useCallback(async () => {
    setLoading(true)
    try {
      const result = await fetchImages(scope)
      setImages(result.images)
      return result
    } finally {
      // (a failed read must not leave the table waiting for ever)
      setLoading(false)
    }
  }, [setImages, setLoading, scope])

  const { refresh, error: fetchError } = usePolling(handleFetch, IMAGE_POLL_INTERVAL)
  const scopeRef = useRef(scope)
  useEffect(() => { if (scopeRef.current !== scope) { scopeRef.current = scope; setSelectedImages(new Set()); refresh() } }, [scope, refresh])

  // Docker Hub search handler
  const handleHubSearch = useCallback(async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!hubSearchQuery.trim() || hubSearchLoading) return
    setHubSearchLoading(true)
    setHubSearched(true)
    try {
      const res = await searchImages(hubSearchQuery.trim(), 25)
      setHubSearchResults(res.results)
    } catch {
      addToast({ type: 'error', message: 'Failed to search Docker Hub' })
      setHubSearchResults([])
    } finally {
      setHubSearchLoading(false)
    }
  }, [hubSearchQuery, hubSearchLoading, addToast])

  // Pull image handler
  const handlePullImage = useCallback(async (imageName: string) => {
    if (pullingImages.has(imageName)) return
    if (scope === 'all') { addToast({ type: 'info', message: 'Everywhere is a view: pick the hub or one VM above, then change it there' }); return }
    setPullingImages((prev) => new Set(prev).add(imageName))
    try {
      const res = await pullImage(imageName, scopeMember)
      if (res.success) {
        addToast({ type: 'success', message: `Pulling ${imageName} started` })
        // Refresh image list after a delay
        setTimeout(() => handleFetch(), 3000)
      } else {
        addToast({ type: 'error', message: res.message || `Failed to pull ${imageName}` })
      }
    } catch {
      addToast({ type: 'error', message: `Failed to pull ${imageName}` })
    } finally {
      setPullingImages((prev) => {
        const next = new Set(prev)
        next.delete(imageName)
        return next
      })
    }
  }, [pullingImages, addToast, handleFetch, scope, scopeMember])

  // Check registry for digest updates (slow POST): the whole fleet at once, or the hub / one VM
  const handleCheckRegistry = useCallback(async () => {
    if (registryChecking) return
    setRegistryChecking(true)
    try {
      if (scope === 'all') {
        const r = await checkFleetImageRegistry()
        addToast({
          type: r.unreachable ? 'warning' : 'info',
          message: `Registry check complete: ${r.updates_available} update${r.updates_available !== 1 ? 's' : ''} across ${r.members.length} DCS (${r.total} image${r.total !== 1 ? 's' : ''})${r.unreachable ? ` — ${r.unreachable} not answering` : ''}`,
          duration: 6000,
        })
      } else {
        const result = await checkImageRegistry(scopeMember)
        addToast({
          type: 'info',
          message: `Registry check complete: ${result.updates_available} update${result.updates_available !== 1 ? 's' : ''} available out of ${result.total} image${result.total !== 1 ? 's' : ''}${scopeMember ? ` on ${memberName}` : ''}`,
          duration: 5000,
        })
      }
      await handleFetch()
    } catch {
      addToast({ type: 'error', message: 'Registry check failed' })
    } finally {
      setRegistryChecking(false)
    }
  }, [registryChecking, addToast, handleFetch, scope, scopeMember, memberName])

  // Prune dangling images on the hub or the chosen VM
  const handlePrune = useCallback(async () => {
    if (pruneLoading) return
    if (scope === 'all') { addToast({ type: 'info', message: 'Everywhere is a view: pick the hub or one VM above, then change it there' }); return }
    if (!(await confirm({
      title: 'Prune dangling images',
      message: `Remove every dangling image (an untagged image that no container uses) ${scopeMember ? `on the VM ${memberName}` : 'on the hub'}? This cannot be undone.`,
      confirmLabel: 'Prune',
      danger: true,
    }))) return
    setPruneLoading(true)
    try {
      const result = await runImagePrune(scopeMember)
      if (result.success) {
        addToast({
          type: 'success',
          message: result.output || 'Dangling images pruned successfully',
        })
        await handleFetch()
      } else {
        addToast({
          type: 'error',
          message: result.output || 'Image prune failed',
        })
      }
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to prune dangling images'
      addToast({ type: 'error', message })
    } finally {
      setPruneLoading(false)
    }
  }, [pruneLoading, addToast, confirm, handleFetch, scope, scopeMember, memberName])

  // Filter by search
  const filteredImages = useMemo(() => {
    if (!searchQuery.trim()) return images
    const q = searchQuery.toLowerCase()
    return images.filter(
      (i) =>
        i.repository.toLowerCase().includes(q) ||
        i.tag.toLowerCase().includes(q) ||
        i.id.toLowerCase().includes(q) ||
        i.staleness.toLowerCase().includes(q),
    )
  }, [images, searchQuery])

  // Batch mode handlers
  const handleToggleBatch = useCallback(() => {
    setBatchMode(prev => {
      if (prev) {
        setSelectedImages(new Set())
      }
      return !prev
    })
  }, [])

  const handleToggleImage = useCallback((id: string) => {
    setSelectedImages(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const handleSelectAll = useCallback(() => {
    setSelectedImages(new Set(filteredImages.map(imageKey)))
  }, [filteredImages])

  const handleClearSelection = useCallback(() => {
    setSelectedImages(new Set())
  }, [])

  const handleDeleteSelected = useCallback(async () => {
    if (selectedImages.size === 0 || batchLoading) return
    const n = selectedImages.size
    if (!(await confirm({
      title: 'Delete images',
      message: `Delete ${n} image${n !== 1 ? 's' : ''}? Docker refuses an image a container still uses; the rest cannot be brought back without pulling them again.`,
      confirmLabel: 'Delete',
      danger: true,
    }))) return
    setBatchLoading(true)

    const results: Array<{ id: string; success: boolean; message: string }> = []

    for (const key of selectedImages) {
      const sep = key.indexOf('|'); const member = key.slice(0, sep) || null; const id = key.slice(sep + 1)
      try {
        // a tagged image goes by its name: Docker refuses an id that carries several tags; an untagged one ("<none>") by its id
        const row = images.find((i) => imageKey(i) === key)
        const tagged = !!row && row.repository !== '<none>' && row.tag !== '<none>'
        const res = tagged ? await deleteImageRef(`${row.repository}:${row.tag}`, member) : await deleteImage(id, member)
        results.push({ id, success: res.success, message: res.message })
      } catch (err) {
        results.push({ id, success: false, message: err instanceof Error ? err.message : 'Failed' })
      }
    }

    setBatchLoading(false)

    const successCount = results.filter(r => r.success).length
    if (successCount > 0) {
      addToast({ type: 'success', message: `Deleted ${successCount} image${successCount !== 1 ? 's' : ''}` })
      await handleFetch()
    }
    if (successCount < results.length) {
      addToast({ type: 'error', message: `${results.length - successCount} deletion${results.length - successCount !== 1 ? 's' : ''} failed`, duration: 5000 })
    }
    setSelectedImages(new Set())
  }, [selectedImages, batchLoading, addToast, confirm, handleFetch, images])

  // Summary counts
  const counts = useMemo(() => {
    const total = images.length
    const current = images.filter((i) => i.staleness === 'current').length
    const aging = images.filter((i) => i.staleness === 'aging').length
    const stale = images.filter((i) => i.staleness === 'stale').length
    const updates = images.filter((i) => i.update_available === true).length
    return { total, current, aging, stale, updates }
  }, [images])

  const selectedCount = selectedImages.size
  const subtitle = scope === 'all'
    ? `Every image on the hub and its ${scopeMembers.length} VM${scopeMembers.length === 1 ? '' : 's'}`
    : scopeMember ? `The images inside the VM ${memberName}` : undefined
  const openHubSearch = () => setActiveTab('search')

  return (
    <div className="h-full overflow-y-auto scrollbar-thin p-4 md:p-6">
      <DisconnectedBanner />
      <div className="flex flex-col gap-4 md:gap-5 animate-fade-in">
        {/* ---- Header ---- */}
        <PageHeader
          page="images"
          badge={images.length > 0 ? (
            <span className="text-sm text-slate-400">
              <span>{counts.total} total</span>
              {counts.stale > 0 && (
                <>
                  <span className="mx-1.5 text-slate-500">&middot;</span>
                  <span className="text-rose-400">{counts.stale} stale</span>
                </>
              )}
              {counts.updates > 0 && (
                <>
                  <span className="mx-1.5 text-slate-500">&middot;</span>
                  <span className="text-emerald-400 font-semibold">{counts.updates} with updates</span>
                </>
              )}
            </span>
          ) : undefined}
          subtitle={subtitle}
          actions={<>
            <Hint label="Compare the local digests with the upstream registries">
              <button
                onClick={handleCheckRegistry}
                disabled={registryChecking || !isConnected}
                aria-label={registryChecking ? 'Checking the registries' : 'Check registry'}
                className={BTN_TOOLBAR_QUIET}
              >
                {registryChecking ? <Loader2 size={14} className="animate-spin" /> : <PackageSearch size={14} />}
                <span className="hidden sm:inline">{registryChecking ? 'Checking…' : 'Check registry'}</span>
              </button>
            </Hint>
            <button aria-label="Refresh" onClick={refresh} disabled={loading} className={BTN_TOOLBAR_QUIET}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
            {/* batch delete and prune are destructive: admins only */}
            {isAdmin && (
              <button
                onClick={handleToggleBatch}
                aria-label={batchMode ? 'Exit batch mode' : 'Batch mode'}
                aria-pressed={batchMode}
                className={`${BTN_TOOLBAR} ${batchMode ? 'bg-cyan-500/15 border border-cyan-500/25 text-cyan-400 hover:bg-cyan-500/25' : TONE_QUIET}`}
              >
                <ListChecks size={14} />
                <span className="hidden sm:inline">{batchMode ? 'Exit batch mode' : 'Batch mode'}</span>
              </button>
            )}
            {isAdmin && (
              <Hint label="Remove the untagged images no container uses">
                <button
                  onClick={handlePrune}
                  disabled={pruneLoading}
                  aria-label="Prune dangling images"
                  className={`${BTN_TOOLBAR} ${TONE_DANGER}`}
                >
                  {pruneLoading ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  <span className="hidden sm:inline">Prune dangling images</span>
                </button>
              </Hint>
            )}
            <SegmentedControl
              aria-label="View"
              value={viewMode}
              onChange={(v) => setViewMode(v as 'table' | 'cards')}
              data={[
                { value: 'table', label: <Hint label="Table"><span className="flex items-center gap-1.5 py-0.5"><LayoutList size={14} aria-hidden /><span className="sr-only sm:not-sr-only">Table</span></span></Hint> },
                { value: 'cards', label: <Hint label="Cards"><span className="flex items-center gap-1.5 py-0.5"><LayoutGrid size={14} aria-hidden /><span className="sr-only sm:not-sr-only">Cards</span></span></Hint> },
              ]}
            />
          </>}
        >
          {hasFleet && <FleetScopeChips scope={scope} members={scopeMembers} onChange={setScope} label="Images on" busy={loading && images.length > 0} />}
        </PageHeader>

        {/* the same automatic image updates as the Updates page, on the servers the chips select (admins: they write schedules) */}
        {isAdmin && <AutoImageUpdates scope={scope} members={scopeMembers} />}

        {/* ---- Section: the library, or a search of Docker Hub; a phone swipes it sideways ---- */}
        <div className="min-w-0 max-w-full self-start overflow-x-auto scrollbar-none">
          <SegmentedControl
            aria-label="Section"
            value={activeTab}
            onChange={(v) => setActiveTab(v as 'library' | 'search')}
            data={[
              { value: 'library', label: <span className="flex items-center gap-1.5"><HardDrive size={13} aria-hidden />Image library</span> },
              { value: 'search', label: <span className="flex items-center gap-1.5"><Globe size={13} aria-hidden />Docker Hub search</span> },
            ]}
          />
        </div>

        {activeTab === 'library' && (
          <>
        {/* ---- Search bar ---- */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
          <input
            type="text"
            aria-label="Search images"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search images by repository, tag or ID…"
            className="
              w-full pl-10 pr-4 py-2.5 rounded-xl text-sm
              bg-white/5 border border-white/10
              text-slate-200 placeholder-slate-500
              focus:outline-none focus:ring-1 focus:ring-emerald-500/30 focus:border-emerald-500/30
              transition-all duration-200
            "
          />
          {searchQuery && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
              {filteredImages.length} result{filteredImages.length !== 1 ? 's' : ''}
            </span>
          )}
        </div>

        {/* ---- Batch action bar ---- */}
        {batchMode && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl bg-cyan-500/[0.06] border border-cyan-500/15 animate-fade-in">
            <span className="text-xs font-semibold text-cyan-400">
              {selectedCount} selected
            </span>
            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <button onClick={handleSelectAll} className={BTN_CARD_QUIET}>Select all</button>
              <button onClick={handleClearSelection} className={BTN_CARD_QUIET}>Clear</button>
              {isAdmin && (
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedCount === 0 || batchLoading}
                  className={`${BTN_CARD} ${TONE_DANGER}`}
                >
                  {batchLoading ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  Delete selected
                </button>
              )}
            </div>
          </div>
        )}

        {/* ---- Summary stat cards ---- */}
        <div className={`grid grid-cols-2 ${counts.updates > 0 ? 'md:grid-cols-5' : 'md:grid-cols-4'} gap-3 stagger-children`}>
          <SummaryCard
            icon={<HardDrive className="h-4 w-4 text-cyan-400" />}
            label="Total images"
            value={counts.total}
            color="cyan"
          />
          <SummaryCard
            icon={<CircleCheck className="h-4 w-4 text-emerald-400" />}
            label="Current"
            value={counts.current}
            color="emerald"
          />
          <SummaryCard
            icon={<Clock className="h-4 w-4 text-amber-400" />}
            label="Aging"
            value={counts.aging}
            color="amber"
          />
          <SummaryCard
            icon={<AlertTriangle className="h-4 w-4 text-rose-400" />}
            label="Stale"
            value={counts.stale}
            color="rose"
          />
          {counts.updates > 0 && (
            <SummaryCard
              icon={<ArrowUpCircle className="h-4 w-4 text-emerald-400" />}
              label="Updates"
              value={counts.updates}
              color="emerald"
            />
          )}
        </div>

        {/* ---- Content ---- */}
        {fetchError && images.length === 0 ? (
          <ErrorState title="Could not read the images" error={fetchError} onRetry={refresh} />
        ) : viewMode === 'table' ? (
          <ImageList
            rows={filteredImages}
            query={searchQuery.trim()}
            onClearSearch={() => setSearchQuery('')}
            batchMode={batchMode}
            selectedImages={selectedImages}
            onToggleImage={handleToggleImage}
            showWhere={scope === 'all'}
            onPickWhere={(m) => setScope(m ?? 'hub')}
            onSearchHub={openHubSearch}
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {filteredImages.length === 0 ? (
              <div className="col-span-full">
                <EmptyState
                  icon={<HardDrive size={32} />}
                  title={searchQuery ? 'No images match your search.' : 'No images found.'}
                  hint={searchQuery ? 'Try another name or tag.' : 'Run a registry check to discover images, or pull one from Docker Hub.'}
                  action={searchQuery
                    ? <button type="button" onClick={() => setSearchQuery('')} className={BTN_TOOLBAR_QUIET}><X size={14} /> Clear the search</button>
                    : <button type="button" onClick={openHubSearch} className={BTN_TOOLBAR_QUIET}><Search size={14} /> Search Docker Hub</button>}
                />
              </div>
            ) : (
              filteredImages.map((image, idx) => (
                <ImageCard
                  key={`${imageKey(image)}-${idx}`}
                  image={image}
                  showWhere={scope === 'all'}
                  batchMode={batchMode}
                  selected={selectedImages.has(imageKey(image))}
                  onToggle={handleToggleImage}
                />
              ))
            )}
          </div>
        )}
          </>
        )}

        {/* ---- Docker Hub Search Tab ---- */}
        {activeTab === 'search' && (
          <div className="space-y-4 animate-fade-in">
            {/* Search form */}
            <form onSubmit={handleHubSearch} className="flex items-stretch gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
                <input
                  type="text"
                  aria-label="Search Docker Hub"
                  value={hubSearchQuery}
                  onChange={(e) => setHubSearchQuery(e.target.value)}
                  placeholder="Search Docker Hub for images (for example nginx, postgres, redis)…"
                  className="w-full pl-10 pr-9 py-2.5 rounded-xl text-sm bg-white/5 border border-white/10 text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-emerald-500/30 focus:border-emerald-500/30 transition-all duration-200"
                />
                {hubSearchQuery && (
                  <Hint label="Clear the search">
                    <button aria-label="Clear the search"
                      type="button"
                      onClick={() => { setHubSearchQuery(''); setHubSearchResults([]); setHubSearched(false) }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </Hint>
                )}
              </div>
              <button
                type="submit"
                disabled={hubSearchLoading || !hubSearchQuery.trim() || !isConnected}
                className={`${BTN_TOOLBAR} ${TONE_OK} px-4`}
              >
                {hubSearchLoading ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
                Search
              </button>
            </form>

            {/* Loading */}
            {hubSearchLoading && <LoadingState compact label="Searching Docker Hub…" />}

            {/* No results */}
            {!hubSearchLoading && hubSearched && hubSearchResults.length === 0 && (
              <div className="glass-subtle">
                <EmptyState
                  icon={<Search size={28} />}
                  title={`No images found for “${hubSearchQuery}”`}
                  hint="Try a shorter name, or the name of the project."
                />
              </div>
            )}

            {/* Initial state */}
            {!hubSearchLoading && !hubSearched && (
              <div className="glass-subtle">
                <EmptyState
                  icon={<Globe size={28} className="text-cyan-500/60" />}
                  title="Search Docker Hub for container images"
                  hint="Find official and community images to pull."
                />
              </div>
            )}

            {/* Results */}
            {!hubSearchLoading && hubSearchResults.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs text-slate-500 mb-2">
                  {hubSearchResults.length} result{hubSearchResults.length !== 1 ? 's' : ''} for “{hubSearchQuery}”
                </div>
                {hubSearchResults.map((result, idx) => (
                  <div
                    key={`${result.name}-${idx}`}
                    className="glass-subtle glass-hover p-4 animate-fade-in"
                    style={{ animationDelay: `${Math.min(idx * 40, 400)}ms` }}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5">
                          <span className="text-sm font-semibold text-slate-200 truncate">{result.name}</span>
                          {result.official === '[OK]' && (
                            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                              <BadgeCheck size={10} />
                              Official
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-slate-500 leading-relaxed line-clamp-2">
                          {result.description || 'No description available'}
                        </p>
                        <div className="flex items-center gap-3 mt-2">
                          <span className="inline-flex items-center gap-1 text-[10px] text-slate-400">
                            <Star size={10} className="text-amber-400" />
                            {result.stars.toLocaleString()}
                          </span>
                        </div>
                      </div>
                      {isAdmin && (
                      <button
                        onClick={() => handlePullImage(result.name)}
                        disabled={pullingImages.has(result.name) || !isConnected}
                        aria-label={`Pull ${result.name}`}
                        className={`${BTN_CARD} ${TONE_OK}`}
                      >
                        {pullingImages.has(result.name) ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Download size={12} />
                        )}
                        Pull
                      </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SummaryCard — small stat card for the summary row
// ---------------------------------------------------------------------------

interface SummaryCardProps {
  icon: React.ReactNode
  label: string
  value: number
  color: 'emerald' | 'cyan' | 'rose' | 'amber'
}

const GLOW_MAP: Record<string, string> = {
  emerald: 'glow-emerald',
  cyan: 'glow-cyan',
  rose: 'glow-rose',
  amber: 'glow-amber',
}

const SummaryCard: React.FC<SummaryCardProps> = ({ icon, label, value, color }) => (
  <div className={`glass-subtle p-3 md:p-4 flex items-center gap-3 ${GLOW_MAP[color] ?? ''}`}>
    <div className="flex-shrink-0">{icon}</div>
    <div>
      <p className="text-[10px] md:text-xs text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-lg md:text-xl font-bold text-slate-100">{value}</p>
    </div>
  </div>
)

export default Images
