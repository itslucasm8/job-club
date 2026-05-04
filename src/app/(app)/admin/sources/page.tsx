'use client'
import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

type SourceConfig = {
  url?: string
  jobLinkSelector?: string
  jobLinkPattern?: string
  defaultCategory?: string
  defaultState?: string
  maxListings?: number
  boardSlug?: string
  groupUrl?: string
  groupId?: string
  groupName?: string
}

type HealthStatus = 'working' | 'partial' | 'broken' | 'unverified' | 'disabled'

type Source = {
  id: string
  slug: string
  label: string
  category: string
  sheetTab: string | null
  ingestionStrategy: string | null
  enabled: boolean
  adapter: string | null
  siteSlug: string | null
  config: SourceConfig | null
  profile: any | null
  healthStatus: HealthStatus | null
  consecutiveFailures: number
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  totalSeen: number
  totalApproved: number
  totalRejected: number
}

type PerSourceResult = {
  slug: string
  status: 'ok' | 'error' | 'skipped'
  listingsFound: number
  listingsNew: number
  imported: number
  duplicates: number
  errors: number
  errorMessage?: string
  durationMs: number
}

type SourcingRun = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt: string | null
  sourceSlugs: string[]
  totalSources: number
  processedSources: number
  totalListingsFound: number
  totalListingsNew: number
  totalImported: number
  totalDuplicates: number
  totalErrors: number
  perSourceResults: PerSourceResult[] | null
  errorMessage: string | null
}

const AU_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const JOB_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const

const ADAPTER_OPTIONS: { value: string, label: string, hint: string }[] = [
  { value: 'generic_career_page', label: 'Generic web (Playwright)', hint: 'Most career pages and search results' },
  { value: 'greenhouse_api', label: 'Greenhouse API', hint: 'Boards hosted on Greenhouse' },
  { value: 'workable_api', label: 'Workable API', hint: 'Boards hosted on Workable' },
  { value: 'lever_api', label: 'Lever API', hint: 'Boards hosted on Lever' },
  { value: 'workforce_australia', label: 'Workforce Australia', hint: 'Built-in government adapter' },
  { value: 'harvest_trail', label: 'Harvest Trail', hint: 'Built-in government adapter' },
  { value: 'extension', label: 'Browser extension', hint: 'Imported by FB or generic extension' },
  { value: 'manual', label: 'Manual entry', hint: 'No automated scraping' },
]

const CATEGORY_OPTIONS = [
  { value: 'aggregator', label: 'Aggregator (Seek, BPJB)' },
  { value: 'direct', label: 'Direct (employer site)' },
  { value: 'government', label: 'Government' },
  { value: 'competitor', label: 'Competitor (other job board)' },
  { value: 'manual', label: 'Manual / utility' },
  { value: 'ats_rss', label: 'ATS / RSS feed' },
]

const ATS_API_ADAPTERS = ['greenhouse_api', 'workable_api', 'lever_api'] as const

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function isRunnable(s: Source): boolean {
  if (!s.adapter || s.adapter === 'manual') return false
  if (s.adapter === 'extension') return Boolean(s.config?.groupUrl || s.config?.url)
  if ((ATS_API_ADAPTERS as readonly string[]).includes(s.adapter)) return !!s.config?.boardSlug
  if (s.adapter === 'generic_career_page') return !!s.config?.url
  return true
}

function statusPill(s: Source): { label: string, className: string, rank: number } {
  if (!s.adapter) return { label: 'Unconfigured', className: 'bg-stone-100 text-stone-600', rank: 5 }
  if (s.healthStatus === 'broken') return { label: 'Broken', className: 'bg-red-100 text-red-700', rank: 2 }
  if (s.healthStatus === 'partial') return { label: 'Partial', className: 'bg-orange-100 text-orange-800', rank: 3 }
  if (!s.enabled) return { label: 'Disabled', className: 'bg-stone-100 text-stone-500', rank: 6 }
  if (s.healthStatus === 'working') return { label: 'Working', className: 'bg-green-100 text-green-700', rank: 0 }
  if (s.healthStatus === 'unverified') return { label: 'Untested', className: 'bg-amber-100 text-amber-800', rank: 4 }
  if (!s.lastRunAt) return { label: 'Never run', className: 'bg-blue-50 text-blue-700', rank: 4 }
  return { label: 'Active', className: 'bg-blue-50 text-blue-700', rank: 1 }
}

function urlHost(s: Source): string {
  const url = s.config?.url || s.config?.groupUrl
  if (!url) return ''
  try { return new URL(url).host.replace(/^www\./, '') } catch { return '' }
}

export default function AdminSourcesPage() {
  const { data: session } = useSession()
  const [sources, setSources] = useState<Source[]>([])
  const [runs, setRuns] = useState<SourcingRun[]>([])
  const [activeRun, setActiveRun] = useState<SourcingRun | null>(null)
  const [loading, setLoading] = useState(true)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const [filter, setFilter] = useState<'active' | 'disabled' | 'all'>('active')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [showHistory, setShowHistory] = useState(false)

  const [drawer, setDrawer] = useState<
    | { mode: 'create' }
    | { mode: 'edit', source: Source }
    | null
  >(null)

  async function loadSources() {
    const res = await fetch('/api/admin/sources')
    if (res.ok) setSources(await res.json())
  }

  async function loadRuns() {
    const res = await fetch('/api/admin/sources/runs')
    if (res.ok) {
      const data = await res.json()
      setRuns(data.runs || [])
      const inFlight = (data.runs || []).find((r: SourcingRun) => r.status === 'running' || r.status === 'pending')
      if (inFlight && (!activeRun || activeRun.id !== inFlight.id)) setActiveRun(inFlight)
    }
  }

  async function pollActiveRun(id: string) {
    const res = await fetch(`/api/admin/sources/run/${id}`)
    if (!res.ok) return
    const data = await res.json()
    setActiveRun(data.run)
    if (data.run.status === 'completed' || data.run.status === 'failed') {
      await Promise.all([loadSources(), loadRuns()])
    }
  }

  useEffect(() => {
    Promise.all([loadSources(), loadRuns()]).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!activeRun) return
    if (activeRun.status === 'completed' || activeRun.status === 'failed') {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      return
    }
    pollRef.current = setInterval(() => pollActiveRun(activeRun.id), 2000)
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    }
  }, [activeRun?.id, activeRun?.status])

  const isRunning = !!activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')

  async function startRun(slugs: string[]) {
    if (slugs.length === 0) return
    setError(null)
    setStarting(true)
    try {
      const res = await fetch('/api/admin/sources/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Error')
        if (data.runId) await pollActiveRun(data.runId)
        return
      }
      setActiveRun({
        id: data.runId,
        status: 'pending',
        startedAt: new Date().toISOString(),
        completedAt: null,
        sourceSlugs: data.slugs || slugs,
        totalSources: (data.slugs || slugs).length,
        processedSources: 0,
        totalListingsFound: 0,
        totalListingsNew: 0,
        totalImported: 0,
        totalDuplicates: 0,
        totalErrors: 0,
        perSourceResults: null,
        errorMessage: null,
      })
      setSelected(new Set())
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setStarting(false)
    }
  }

  async function toggleEnabled(s: Source) {
    const res = await fetch(`/api/admin/sources/${encodeURIComponent(s.slug)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !s.enabled }),
    })
    if (res.ok) await loadSources()
    else alert((await res.json().catch(() => ({}))).error || `Error ${res.status}`)
  }

  async function bulkSetEnabled(enabled: boolean) {
    const slugs = Array.from(selected)
    await Promise.all(
      slugs.map(slug =>
        fetch(`/api/admin/sources/${encodeURIComponent(slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ enabled }),
        }).catch(() => null)
      )
    )
    setSelected(new Set())
    await loadSources()
  }

  const q = search.trim().toLowerCase()
  const filtered = sources
    .filter(s => filter === 'all' ? true : filter === 'active' ? s.enabled : !s.enabled)
    .filter(s => !q || s.slug.toLowerCase().includes(q) || s.label.toLowerCase().includes(q) || urlHost(s).includes(q))
    .sort((a, b) => {
      const pa = statusPill(a).rank
      const pb = statusPill(b).rank
      if (pa !== pb) return pa - pb
      if (a.totalApproved !== b.totalApproved) return b.totalApproved - a.totalApproved
      return a.label.localeCompare(b.label)
    })

  const counts = {
    active: sources.filter(s => s.enabled).length,
    disabled: sources.filter(s => !s.enabled).length,
    all: sources.length,
  }

  const allFilteredSelected = filtered.length > 0 && filtered.every(s => selected.has(s.slug))
  const someSelected = selected.size > 0
  const runnableSelectedCount = Array.from(selected)
    .map(slug => sources.find(s => s.slug === slug))
    .filter((s): s is Source => !!s && isRunnable(s)).length

  function toggleAllVisible() {
    if (allFilteredSelected) {
      const next = new Set(selected)
      for (const s of filtered) next.delete(s.slug)
      setSelected(next)
    } else {
      const next = new Set(selected)
      for (const s of filtered) next.add(s.slug)
      setSelected(next)
    }
  }

  function toggleOne(slug: string) {
    const next = new Set(selected)
    if (next.has(slug)) next.delete(slug)
    else next.add(slug)
    setSelected(next)
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 py-5"><p className="text-stone-500">Unauthorized</p></div>
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-6xl">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900">Sources</h1>
        <button
          onClick={() => setDrawer({ mode: 'create' })}
          className="px-3 py-1.5 rounded-md text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white transition"
        >
          + New source
        </button>
      </div>
      <p className="text-sm text-stone-500 mb-5">
        Where Job Club gathers listings from. Pick sources and run them — or run them one at a time.
      </p>

      {error && <div className="mb-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {activeRun && <RunProgressCard run={activeRun} />}

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="flex bg-stone-100 rounded-md p-0.5">
          {(['active', 'disabled', 'all'] as const).map(f => (
            <button
              key={f}
              onClick={() => { setFilter(f) }}
              className={`px-3 py-1 rounded text-xs font-bold transition ${
                filter === f ? 'bg-white text-stone-900 shadow-sm' : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              {f === 'active' ? 'Active' : f === 'disabled' ? 'Disabled' : 'All'}
              <span className="ml-1.5 opacity-60 font-mono text-[10px]">{counts[f]}</span>
            </button>
          ))}
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search sources…"
          className="ml-auto px-3 py-1 border border-stone-300 rounded-md text-xs w-full sm:w-64"
        />
      </div>

      {someSelected && (
        <div className="mb-3 sticky top-0 z-10 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm">
          <span className="text-xs font-bold text-purple-900">
            {selected.size} selected
            {runnableSelectedCount !== selected.size && (
              <span className="ml-1 font-normal text-purple-700">({runnableSelectedCount} runnable)</span>
            )}
          </span>
          <div className="flex-1" />
          <button
            onClick={() => startRun(Array.from(selected).filter(slug => {
              const src = sources.find(s => s.slug === slug)
              return src ? isRunnable(src) : false
            }))}
            disabled={starting || isRunning || runnableSelectedCount === 0}
            className="px-3 py-1 rounded text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white disabled:opacity-50 disabled:cursor-not-allowed"
          >
            ▶ Run selected
          </button>
          <button
            onClick={() => bulkSetEnabled(true)}
            className="px-3 py-1 rounded text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-700"
          >
            Enable
          </button>
          <button
            onClick={() => bulkSetEnabled(false)}
            className="px-3 py-1 rounded text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-700"
          >
            Disable
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-stone-600 hover:text-stone-900"
          >
            Clear
          </button>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-stone-500">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-stone-500">
          {sources.length === 0 ? 'No sources yet. Click "+ New source" to add one.' : 'No sources match this filter.'}
        </div>
      ) : (
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="px-3 py-2 border-b-2 border-stone-200 bg-stone-50 flex items-center gap-2 text-[11px] font-semibold text-stone-700">
            <input
              type="checkbox"
              checked={allFilteredSelected}
              onChange={toggleAllVisible}
              aria-label="Select all visible"
              className="w-3.5 h-3.5 rounded border-stone-400 cursor-pointer"
            />
            <span className="flex-1">Source</span>
            <span className="hidden sm:block w-20 text-right">Last run</span>
            <span className="hidden sm:block w-24 text-right">Seen / Approved</span>
            <span className="w-44 text-right">Actions</span>
          </div>

          {filtered.map(s => {
            const pill = statusPill(s)
            const host = urlHost(s)
            const runnable = isRunnable(s)
            const checked = selected.has(s.slug)
            return (
              <div
                key={s.id}
                className={`px-3 py-2.5 border-b border-stone-100 last:border-0 flex items-center gap-2 text-xs hover:bg-stone-50/60 ${checked ? 'bg-purple-50/50' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleOne(s.slug)}
                  aria-label={`Select ${s.label}`}
                  className="w-3.5 h-3.5 rounded border-stone-400 cursor-pointer"
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-stone-900 truncate">{s.label}</span>
                    <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${pill.className}`}>
                      {pill.label}
                    </span>
                    {s.consecutiveFailures >= 2 && (
                      <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700" title={s.lastRunError || 'Recent failures'}>
                        {s.consecutiveFailures} fails
                      </span>
                    )}
                  </div>
                  <div className="text-[10px] text-stone-500 truncate">
                    {host && <span>{host} · </span>}
                    <span className="font-mono">{s.slug}</span>
                  </div>
                </div>
                <span className="hidden sm:block w-20 text-right text-stone-600">
                  {timeAgo(s.lastRunAt)}
                </span>
                <span className="hidden sm:block w-24 text-right tabular-nums">
                  <span className="text-stone-700">{s.totalSeen}</span>
                  <span className="text-stone-400"> / </span>
                  <span className="text-green-700 font-semibold">{s.totalApproved}</span>
                </span>
                <div className="w-44 flex items-center justify-end gap-1">
                  {runnable ? (
                    <button
                      onClick={() => startRun([s.slug])}
                      disabled={starting || isRunning}
                      className="px-2 py-1 rounded text-[11px] font-bold bg-purple-100 hover:bg-purple-200 text-purple-800 disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Run this source now"
                    >
                      ▶ Run
                    </button>
                  ) : (
                    <span className="text-[10px] text-stone-400 px-2" title="No adapter or missing config">—</span>
                  )}
                  <button
                    onClick={() => setDrawer({ mode: 'edit', source: s })}
                    title="Edit"
                    className="px-1.5 py-1 rounded text-[11px] bg-stone-100 hover:bg-stone-200 text-stone-700"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggleEnabled(s)}
                    title={s.enabled ? 'Disable' : 'Enable'}
                    className="px-1.5 py-1 rounded text-[11px] bg-stone-100 hover:bg-stone-200 text-stone-700 w-8"
                  >
                    {s.enabled ? 'On' : 'Off'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {runs.length > 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowHistory(v => !v)}
            className="text-xs font-bold text-stone-700 hover:text-stone-900"
          >
            {showHistory ? '▾' : '▸'} Recent runs ({runs.length})
          </button>
          {showHistory && <RunHistory runs={runs} />}
        </div>
      )}

      {drawer && (
        <SourceDrawer
          mode={drawer.mode}
          source={drawer.mode === 'edit' ? drawer.source : undefined}
          onClose={() => setDrawer(null)}
          onSaved={async () => { await loadSources(); setDrawer(null) }}
          onDeleted={async () => { await loadSources(); setDrawer(null) }}
        />
      )}
    </div>
  )
}

function RunProgressCard({ run }: { run: SourcingRun }) {
  const pct = run.totalSources > 0 ? (run.processedSources / run.totalSources) * 100 : 0
  const elapsedSec = run.completedAt
    ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
    : Math.round((Date.now() - new Date(run.startedAt).getTime()) / 1000)
  return (
    <div className="mb-5 p-4 bg-white border border-stone-200 rounded-lg space-y-2">
      <div className="flex items-center justify-between text-xs">
        <span className="font-bold text-purple-900">
          {run.status === 'pending' && 'Starting…'}
          {run.status === 'running' && `Scanning (${run.processedSources}/${run.totalSources})`}
          {run.status === 'completed' && `✓ Done in ${elapsedSec}s`}
          {run.status === 'failed' && `✗ Failed`}
        </span>
        <Link href="/admin/candidates" className="text-purple-700 hover:underline">
          View candidates →
        </Link>
      </div>
      <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
        <div
          className={`h-full transition-all ${run.status === 'failed' ? 'bg-red-500' : 'bg-purple-600'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
        <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700">{run.totalListingsFound} seen</span>
        <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800">{run.totalListingsNew} new</span>
        <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">{run.totalImported} imported</span>
        {run.totalDuplicates > 0 && <span className="px-2 py-0.5 rounded bg-stone-200 text-stone-700">{run.totalDuplicates} dup</span>}
        {run.totalErrors > 0 && <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">{run.totalErrors} errors</span>}
      </div>
      {run.perSourceResults && run.perSourceResults.length > 0 && (
        <details className="text-[11px] mt-1">
          <summary className="cursor-pointer text-purple-800 font-semibold">Per-source detail</summary>
          <ul className="mt-1 space-y-1">
            {run.perSourceResults.map(r => (
              <li key={r.slug} className="flex flex-wrap gap-2 items-baseline">
                <span className={r.status === 'ok' ? 'text-green-700' : 'text-red-700'}>
                  {r.status === 'ok' ? '✓' : '✗'}
                </span>
                <span className="font-mono text-stone-700">{r.slug}</span>
                <span className="text-stone-500">
                  {r.listingsFound} seen, {r.listingsNew} new, {r.imported} imported, {r.errors} errors ({Math.round(r.durationMs / 1000)}s)
                </span>
                {r.errorMessage && <span className="text-red-600">— {r.errorMessage.slice(0, 120)}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
      {run.errorMessage && (
        <div className="text-[11px] text-red-700">{run.errorMessage}</div>
      )}
    </div>
  )
}

function RunHistory({ runs }: { runs: SourcingRun[] }) {
  return (
    <div className="mt-2 overflow-x-auto bg-white border border-stone-200 rounded-lg">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b-2 border-stone-200">
            <th className="text-left px-3 py-2 font-semibold text-stone-700">Started</th>
            <th className="text-center px-3 py-2 font-semibold text-stone-700">Status</th>
            <th className="text-right px-3 py-2 font-semibold text-stone-700">Sources</th>
            <th className="text-right px-3 py-2 font-semibold text-stone-700">Seen</th>
            <th className="text-right px-3 py-2 font-semibold text-stone-700">New</th>
            <th className="text-right px-3 py-2 font-semibold text-stone-700">Imported</th>
            <th className="text-right px-3 py-2 font-semibold text-stone-700">Duration</th>
          </tr>
        </thead>
        <tbody>
          {runs.map(r => (
            <tr key={r.id} className="border-b border-stone-100">
              <td className="px-3 py-1.5 text-stone-700">{timeAgo(r.startedAt)}</td>
              <td className="px-3 py-1.5 text-center">
                <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  r.status === 'completed' ? 'bg-green-100 text-green-700' :
                  r.status === 'failed' ? 'bg-red-100 text-red-700' :
                  r.status === 'running' ? 'bg-purple-100 text-purple-700' :
                  'bg-stone-200 text-stone-600'
                }`}>
                  {r.status}
                </span>
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.processedSources}/{r.totalSources}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{r.totalListingsFound}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-blue-700">{r.totalListingsNew}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-green-700 font-semibold">{r.totalImported}</td>
              <td className="px-3 py-1.5 text-right tabular-nums text-stone-600">
                {r.completedAt ? `${Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000)}s` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

type DrawerState = {
  slug: string
  label: string
  category: string
  adapter: string
  enabled: boolean
  configUrl: string
  configBoardSlug: string
  configState: string
  configCategory: string
  configSelector: string
  configPattern: string
  siteSlug: string
}

function drawerStateFor(s: Source | undefined): DrawerState {
  if (!s) {
    return {
      slug: '',
      label: '',
      category: 'direct',
      adapter: 'generic_career_page',
      enabled: true,
      configUrl: '',
      configBoardSlug: '',
      configState: '',
      configCategory: '',
      configSelector: '',
      configPattern: '',
      siteSlug: '',
    }
  }
  const c = s.config || {}
  return {
    slug: s.slug,
    label: s.label,
    category: s.category,
    adapter: s.adapter || '',
    enabled: s.enabled,
    configUrl: c.url || '',
    configBoardSlug: c.boardSlug || '',
    configState: c.defaultState || '',
    configCategory: c.defaultCategory || '',
    configSelector: c.jobLinkSelector || '',
    configPattern: c.jobLinkPattern || '',
    siteSlug: s.siteSlug || '',
  }
}

function SourceDrawer({
  mode,
  source,
  onClose,
  onSaved,
  onDeleted,
}: {
  mode: 'create' | 'edit'
  source?: Source
  onClose: () => void
  onSaved: () => void | Promise<void>
  onDeleted: () => void | Promise<void>
}) {
  const [state, setState] = useState<DrawerState>(drawerStateFor(source))
  const [showAdvanced, setShowAdvanced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [detect, setDetect] = useState<{ kind: 'idle' | 'detecting' | 'found' | 'not_found' | 'error', message?: string, suggestion?: { adapter: string, boardSlug: string } }>({ kind: 'idle' })

  const isCreate = mode === 'create'
  const adapterMeta = ADAPTER_OPTIONS.find(a => a.value === state.adapter)

  async function detectAts() {
    if (!state.configUrl.trim()) return
    setDetect({ kind: 'detecting' })
    try {
      const res = await fetch('/api/admin/sources/detect-ats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: state.configUrl.trim() }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDetect({ kind: 'error', message: data?.error || `Error ${res.status}` })
        return
      }
      if (data.adapter) {
        setDetect({
          kind: 'found',
          suggestion: { adapter: data.adapter, boardSlug: data.boardSlug },
          message: `${data.evidence} → ${data.adapter}`,
        })
      } else {
        setDetect({ kind: 'not_found', message: data.reason || 'No known ATS' })
      }
    } catch (e: any) {
      setDetect({ kind: 'error', message: e?.message || 'Network error' })
    }
  }

  function applyDetection() {
    if (detect.kind !== 'found' || !detect.suggestion) return
    setState({ ...state, adapter: detect.suggestion.adapter, configBoardSlug: detect.suggestion.boardSlug })
    setDetect({ kind: 'idle' })
  }

  function buildConfig() {
    if (state.adapter === 'generic_career_page') {
      const cfg: SourceConfig = { url: state.configUrl.trim() }
      if (state.configState) cfg.defaultState = state.configState
      if (state.configCategory) cfg.defaultCategory = state.configCategory
      if (state.configSelector.trim()) cfg.jobLinkSelector = state.configSelector.trim()
      if (state.configPattern.trim()) cfg.jobLinkPattern = state.configPattern.trim()
      return cfg
    }
    if ((ATS_API_ADAPTERS as readonly string[]).includes(state.adapter)) {
      const cfg: SourceConfig = { boardSlug: state.configBoardSlug.trim() }
      if (state.configState) cfg.defaultState = state.configState
      if (state.configCategory) cfg.defaultCategory = state.configCategory
      return cfg
    }
    return null
  }

  async function save() {
    setErr(null)
    setSaving(true)
    try {
      const payload: any = {
        label: state.label,
        category: state.category,
        adapter: state.adapter || null,
        siteSlug: state.siteSlug.trim() || null,
        enabled: state.enabled,
        config: buildConfig(),
      }
      let res: Response
      if (isCreate) {
        payload.slug = state.slug
        res = await fetch('/api/admin/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch(`/api/admin/sources/${encodeURIComponent(state.slug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setErr(data?.error || `Error ${res.status}`)
        return
      }
      await onSaved()
    } catch (e: any) {
      setErr(e?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!confirm(`Delete source "${state.slug}"? Existing candidates won't be affected.`)) return
    setSaving(true)
    try {
      const res = await fetch(`/api/admin/sources/${encodeURIComponent(state.slug)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setErr(data?.error || `Error ${res.status}`)
        return
      }
      await onDeleted()
    } catch (e: any) {
      setErr(e?.message || 'Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-stone-900/30" onClick={onClose} />
      <div className="w-full sm:w-[480px] h-full bg-white border-l border-stone-200 shadow-xl overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-stone-200 px-4 py-3 flex items-center justify-between">
          <h2 className="text-base font-extrabold text-stone-900">
            {isCreate ? 'New source' : `Edit ${source?.label || state.slug}`}
          </h2>
          <button onClick={onClose} className="text-stone-500 hover:text-stone-900 text-lg leading-none">✕</button>
        </div>

        <div className="px-4 py-4 space-y-4 text-sm">
          {!isCreate && source && (
            <div className="text-[11px] text-stone-500 -mt-2 font-mono">{source.slug}</div>
          )}

          <Field label="Name">
            <input
              type="text"
              value={state.label}
              onChange={e => setState({ ...state, label: e.target.value })}
              placeholder="e.g. Costa Group Careers"
              className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
            />
          </Field>

          {isCreate && (
            <Field label="Slug" hint="lowercase, a-z 0-9 _ -">
              <input
                type="text"
                value={state.slug}
                onChange={e => setState({ ...state, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '') })}
                placeholder="e.g. costa_careers"
                className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm font-mono"
              />
            </Field>
          )}

          <Field label="Adapter">
            <select
              value={state.adapter}
              onChange={e => setState({ ...state, adapter: e.target.value })}
              className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
            >
              <option value="">— None (manual) —</option>
              {ADAPTER_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
            {adapterMeta && <p className="text-[11px] text-stone-500 mt-1">{adapterMeta.hint}</p>}
          </Field>

          {state.adapter === 'generic_career_page' && (
            <>
              <Field label="URL">
                <div className="flex gap-2">
                  <input
                    type="url"
                    value={state.configUrl}
                    onChange={e => setState({ ...state, configUrl: e.target.value })}
                    placeholder="https://example.com/careers"
                    className="flex-1 px-2 py-1.5 border border-stone-300 rounded text-sm font-mono"
                  />
                  <button
                    type="button"
                    onClick={detectAts}
                    disabled={detect.kind === 'detecting' || !state.configUrl.trim()}
                    className="px-2 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] whitespace-nowrap disabled:opacity-50"
                    title="Detect Greenhouse / Workable / Lever"
                  >
                    {detect.kind === 'detecting' ? '…' : 'Detect ATS'}
                  </button>
                </div>
                {detect.kind === 'found' && detect.suggestion && (
                  <div className="mt-2 p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px]">
                    <div className="font-semibold">ATS detected</div>
                    <div>{detect.message}</div>
                    <button
                      type="button"
                      onClick={applyDetection}
                      className="mt-1 px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[10px]"
                    >
                      Apply ({detect.suggestion.adapter})
                    </button>
                  </div>
                )}
                {detect.kind === 'not_found' && (
                  <div className="mt-2 p-2 rounded bg-stone-100 border border-stone-200 text-stone-600 text-[11px]">{detect.message}</div>
                )}
                {detect.kind === 'error' && (
                  <div className="mt-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-[11px]">{detect.message}</div>
                )}
              </Field>
            </>
          )}

          {(ATS_API_ADAPTERS as readonly string[]).includes(state.adapter) && (
            <Field label="Board slug" hint="The identifier in the ATS board URL (e.g. 'atlassian' from boards.greenhouse.io/atlassian)">
              <input
                type="text"
                value={state.configBoardSlug}
                onChange={e => setState({ ...state, configBoardSlug: e.target.value })}
                placeholder="e.g. atlassian"
                className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm font-mono"
              />
            </Field>
          )}

          <div className="grid grid-cols-2 gap-3">
            <Field label="Default state">
              <select
                value={state.configState}
                onChange={e => setState({ ...state, configState: e.target.value })}
                className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
              >
                <option value="">— Any —</option>
                {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="Default category">
              <select
                value={state.configCategory}
                onChange={e => setState({ ...state, configCategory: e.target.value })}
                className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
              >
                <option value="">— Any —</option>
                {JOB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={state.enabled}
              onChange={e => setState({ ...state, enabled: e.target.checked })}
              className="w-4 h-4 rounded border-stone-400"
            />
            <span className="font-semibold text-stone-700">Enabled (included in scans)</span>
          </label>

          <div className="border-t border-stone-200 pt-3">
            <button
              type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="text-xs font-bold text-stone-700 hover:text-stone-900"
            >
              {showAdvanced ? '▾' : '▸'} Advanced settings
            </button>
            {showAdvanced && (
              <div className="mt-3 space-y-3 bg-stone-50 border border-stone-200 rounded p-3">
                <Field label="Source category">
                  <select
                    value={state.category}
                    onChange={e => setState({ ...state, category: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm"
                  >
                    {CATEGORY_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                  </select>
                </Field>
                <Field label="Site slug" hint="Sources sharing the same site slug share extraction rules. Leave blank if unsure.">
                  <input
                    type="text"
                    value={state.siteSlug}
                    onChange={e => setState({ ...state, siteSlug: e.target.value })}
                    placeholder="e.g. seek_au, facebook_groups"
                    className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm font-mono"
                  />
                </Field>
                {state.adapter === 'generic_career_page' && (
                  <>
                    <Field label="Link CSS selector" hint="Empty = automatic heuristic (matches /jobs/, /careers/, /positions/)">
                      <input
                        type="text"
                        value={state.configSelector}
                        onChange={e => setState({ ...state, configSelector: e.target.value })}
                        placeholder='e.g. a.job-link, .careers-list a[href*="/job/"]'
                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm font-mono"
                      />
                    </Field>
                    <Field label="Link URL pattern" hint="Optional substring or regex to filter href values">
                      <input
                        type="text"
                        value={state.configPattern}
                        onChange={e => setState({ ...state, configPattern: e.target.value })}
                        placeholder="e.g. /careers/job/"
                        className="w-full px-2 py-1.5 border border-stone-300 rounded text-sm font-mono"
                      />
                    </Field>
                  </>
                )}
                {!isCreate && source && (
                  <div className="pt-2 border-t border-stone-200">
                    <Link
                      href={`/admin/sources/${encodeURIComponent(source.slug)}`}
                      className="text-xs text-purple-700 hover:underline"
                    >
                      View diagnostics →
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>

          {err && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-3 py-2">{err}</div>}
        </div>

        <div className="sticky bottom-0 bg-white border-t border-stone-200 px-4 py-3 flex items-center gap-2">
          <button
            onClick={save}
            disabled={saving || !state.label || (isCreate && !state.slug)}
            className="px-4 py-1.5 rounded-md text-sm font-bold bg-purple-700 hover:bg-purple-800 text-white disabled:opacity-50"
          >
            {saving ? 'Saving…' : isCreate ? 'Create' : 'Save'}
          </button>
          <button onClick={onClose} className="px-3 py-1.5 rounded-md text-sm font-semibold text-stone-600 hover:text-stone-900">
            Cancel
          </button>
          {!isCreate && (
            <>
              <div className="flex-1" />
              <button
                onClick={remove}
                disabled={saving}
                className="px-3 py-1.5 rounded-md text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function Field({ label, hint, children }: { label: string, hint?: string, children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="block text-xs font-semibold text-stone-700">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-stone-500">{hint}</span>}
    </label>
  )
}
