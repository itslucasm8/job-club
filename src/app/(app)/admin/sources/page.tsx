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
  // ATS adapters (greenhouse_api, workable_api, lever_api) use this instead of url.
  boardSlug?: string
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

// 3-flow grouping: which strategies belong to which dashboard button.
// Extensible: as new strategies land (rss_feed, sitemap_xml, etc.) just add
// them to the relevant flow array; no other code change.
const FLOW_A_STRATEGIES = ['structured_api', 'structured_html', 'rss_feed', 'sitemap_xml', 'api_partner'] as const  // Scan rapide
const FLOW_B_STRATEGIES = ['generic_web'] as const                                                                   // Scan intelligent
const FLOW_C_STRATEGIES = ['extension', 'keyword_search', 'email_inbound'] as const                                  // Tâches manuelles

const INGESTION_STRATEGIES: { value: string, label: string, badge: string }[] = [
  { value: 'structured_api',  label: 'Structured API (Greenhouse, Workable, Workday)', badge: 'API' },
  { value: 'structured_html', label: 'Structured HTML (selectors connus)',              badge: 'HTML' },
  { value: 'rss_feed',        label: 'RSS / Atom feed',                                 badge: 'RSS' },
  { value: 'sitemap_xml',     label: 'Sitemap.xml + crawl',                             badge: 'XML' },
  { value: 'generic_web',     label: 'Generic web (Playwright + Claude)',               badge: 'Web' },
  { value: 'extension',       label: 'Extension navigateur',                            badge: 'Ext' },
  { value: 'keyword_search',  label: 'Mots-clés de recherche',                          badge: 'Mots' },
  { value: 'email_inbound',   label: 'Email entrant (employeur)',                       badge: 'Mail' },
  { value: 'api_partner',     label: 'API partenaire formelle',                         badge: 'Part' },
  { value: 'manual',          label: 'Manuel',                                          badge: 'Man' },
]

// Operational status of a source — drives sort and status pill.
type SourceStatus = 'productive' | 'partial' | 'broken' | 'attention' | 'configured_off' | 'inventory'

function statusOf(s: Source): SourceStatus {
  if (!s.adapter) return 'inventory'
  // broken/partial outrank disabled — actionable signals must not hide under "configured (off)".
  if (s.healthStatus === 'broken') return 'broken'
  if (s.healthStatus === 'partial') return 'partial'
  if (!s.enabled) return 'configured_off'
  if (s.healthStatus === 'working') return 'productive'
  if (s.healthStatus === 'unverified') return 'attention'
  // Pre-healthStatus rows: infer from run history.
  if (s.totalApproved > 0 || s.lastRunStatus === 'ok') return 'productive'
  return 'attention'
}

const STATUS_META: Record<SourceStatus, { label: string, dot: string, pillClass: string, sortRank: number }> = {
  productive:    { label: 'Productive',       dot: '🟢', sortRank: 0, pillClass: 'bg-green-100 text-green-800' },
  partial:       { label: 'Partielle',        dot: '🟠', sortRank: 1, pillClass: 'bg-orange-100 text-orange-800' },
  broken:        { label: 'Cassée',           dot: '🔴', sortRank: 2, pillClass: 'bg-red-100 text-red-800' },
  attention:     { label: 'À tester',         dot: '🟡', sortRank: 3, pillClass: 'bg-amber-100 text-amber-800' },
  configured_off:{ label: 'Configurée (off)', dot: '🔵', sortRank: 4, pillClass: 'bg-blue-100 text-blue-700' },
  inventory:     { label: 'Inventaire',       dot: '⚪', sortRank: 5, pillClass: 'bg-stone-100 text-stone-500' },
}

// Tabs mirror Lucas's source sheet structure. Order = display order.
const SHEET_TABS: { value: string, label: string, hint?: string }[] = [
  { value: 'job_agency', label: 'Job Agencies' },
  { value: 'mine_agency', label: 'Mine Agencies' },
  { value: 'station', label: 'Stations' },
  { value: 'packhouse', label: 'Packhouses' },
  { value: 'website', label: 'Websites' },
  { value: 'government', label: 'Government', hint: 'Workforce Australia, Harvest Trail' },
  { value: 'facebook', label: 'Facebook', hint: 'Groupes — utilise l\'extension' },
  { value: 'gumtree', label: 'Gumtree', hint: 'Mots-clés de recherche' },
  { value: 'seek', label: 'Seek', hint: 'Mots-clés de recherche' },
  { value: 'manual', label: 'Manuel' },
]

const SOURCE_CATEGORIES = ['government', 'aggregator', 'ats_rss', 'competitor', 'manual', 'direct'] as const
const SOURCE_ADAPTERS = [
  'workforce_australia', 'harvest_trail',
  'generic_career_page',
  'greenhouse_api', 'workable_api', 'lever_api',
  'manual', 'extension',
] as const
const AU_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const JOB_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const

type SourceFormState = {
  slug: string
  label: string
  category: string
  sheetTab: string
  ingestionStrategy: string
  adapter: string
  enabled: boolean
  configUrl: string
  configBoardSlug: string
  configState: string
  configCategory: string
  configSelector: string
  configPattern: string
}

function emptyForm(defaultTab?: string | null): SourceFormState {
  return {
    slug: '',
    label: '',
    category: 'direct',
    sheetTab: defaultTab || '',
    ingestionStrategy: 'generic_web',
    adapter: 'generic_career_page',
    enabled: true,
    configUrl: '',
    configBoardSlug: '',
    configState: '',
    configCategory: '',
    configSelector: '',
    configPattern: '',
  }
}

function formFromSource(s: Source): SourceFormState {
  const cfg = s.config || {}
  return {
    slug: s.slug,
    label: s.label,
    category: s.category,
    sheetTab: s.sheetTab || '',
    ingestionStrategy: s.ingestionStrategy || '',
    adapter: s.adapter || '',
    enabled: s.enabled,
    configUrl: cfg.url || '',
    configBoardSlug: cfg.boardSlug || '',
    configState: cfg.defaultState || '',
    configCategory: cfg.defaultCategory || '',
    configSelector: cfg.jobLinkSelector || '',
    configPattern: cfg.jobLinkPattern || '',
  }
}

// Adapters that need a boardSlug (ATS APIs) instead of a free-form URL.
const ATS_API_ADAPTERS = ['greenhouse_api', 'workable_api', 'lever_api'] as const

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

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `${mins}min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.floor(hours / 24)}j`
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
  // Form state — null when closed, otherwise either {mode:'create'} or {mode:'edit', originalSlug}.
  const [editing, setEditing] = useState<{ mode: 'create' } | { mode: 'edit', originalSlug: string } | null>(null)
  const [form, setForm] = useState<SourceFormState>(emptyForm())
  const [formError, setFormError] = useState<string | null>(null)
  const [formSaving, setFormSaving] = useState(false)
  // Active sheet-tab filter. null = "Tous". When creating, pre-fill with selectedTab.
  const [selectedTab, setSelectedTab] = useState<string | null>(null)
  // Status-based quick filter (orthogonal to sheet tab). null = no filter.
  const [statusFilter, setStatusFilter] = useState<SourceStatus | null>(null)
  // Free-text search across slug + label.
  const [searchQuery, setSearchQuery] = useState('')

  function openCreate() {
    setForm(emptyForm(selectedTab))
    setFormError(null)
    setEditing({ mode: 'create' })
  }
  function openEdit(s: Source) {
    setForm(formFromSource(s))
    setFormError(null)
    setEditing({ mode: 'edit', originalSlug: s.slug })
  }
  function closeForm() {
    setEditing(null)
    setFormError(null)
  }

  function buildConfigPayload(): SourceConfig | null {
    if (form.adapter === 'generic_career_page') {
      const cfg: SourceConfig = { url: form.configUrl.trim() }
      if (form.configState) cfg.defaultState = form.configState
      if (form.configCategory) cfg.defaultCategory = form.configCategory
      if (form.configSelector.trim()) cfg.jobLinkSelector = form.configSelector.trim()
      if (form.configPattern.trim()) cfg.jobLinkPattern = form.configPattern.trim()
      return cfg
    }
    if (ATS_API_ADAPTERS.includes(form.adapter as any)) {
      const cfg: SourceConfig = { boardSlug: form.configBoardSlug.trim() }
      if (form.configState) cfg.defaultState = form.configState
      if (form.configCategory) cfg.defaultCategory = form.configCategory
      return cfg
    }
    return null
  }

  // Detect ATS button — sniffs the configured URL for embedded Greenhouse /
  // Workable / Lever markers and offers to swap the adapter in one click.
  const [detectStatus, setDetectStatus] = useState<{ kind: 'idle' | 'detecting' | 'found' | 'not_found' | 'error', message?: string, suggestion?: { adapter: string, boardSlug: string, evidence: string } }>({ kind: 'idle' })

  async function detectAts() {
    const url = form.configUrl.trim()
    if (!url) {
      setDetectStatus({ kind: 'error', message: 'Renseigne d\'abord l\'URL avant de lancer la détection.' })
      return
    }
    setDetectStatus({ kind: 'detecting' })
    try {
      const res = await fetch('/api/admin/sources/detect-ats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) {
        setDetectStatus({ kind: 'error', message: data?.error || `Erreur ${res.status}` })
        return
      }
      if (data.adapter) {
        setDetectStatus({
          kind: 'found',
          suggestion: { adapter: data.adapter, boardSlug: data.boardSlug, evidence: data.evidence },
          message: `${data.evidence} → ${data.adapter} (slug: ${data.boardSlug})`,
        })
      } else {
        setDetectStatus({ kind: 'not_found', message: data.reason || 'Pas d\'ATS connu' })
      }
    } catch (e: any) {
      setDetectStatus({ kind: 'error', message: e?.message || 'Erreur réseau' })
    }
  }

  function applyDetectionSuggestion() {
    if (detectStatus.kind !== 'found' || !detectStatus.suggestion) return
    const sug = detectStatus.suggestion
    setForm({
      ...form,
      adapter: sug.adapter,
      ingestionStrategy: 'structured_api',
      configBoardSlug: sug.boardSlug,
    })
    setDetectStatus({ kind: 'idle' })
  }

  async function submitForm() {
    if (!editing) return
    setFormError(null)
    setFormSaving(true)
    try {
      const payload: any = {
        label: form.label,
        category: form.category,
        sheetTab: form.sheetTab || null,
        ingestionStrategy: form.ingestionStrategy || null,
        adapter: form.adapter || null,
        enabled: form.enabled,
        config: buildConfigPayload(),
      }
      let res: Response
      if (editing.mode === 'create') {
        payload.slug = form.slug
        res = await fetch('/api/admin/sources', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      } else {
        res = await fetch(`/api/admin/sources/${encodeURIComponent(editing.originalSlug)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
      }
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setFormError(data?.error || `Erreur ${res.status}`)
        return
      }
      await loadSources()
      closeForm()
    } catch (e: any) {
      setFormError(e?.message || 'Erreur réseau')
    } finally {
      setFormSaving(false)
    }
  }

  async function deleteSource(slug: string) {
    if (!confirm(`Supprimer la source "${slug}" ? Les candidats déjà importés ne seront pas affectés.`)) return
    try {
      const res = await fetch(`/api/admin/sources/${encodeURIComponent(slug)}`, { method: 'DELETE' })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.error || `Erreur ${res.status}`)
        return
      }
      await loadSources()
    } catch (e: any) {
      alert(e?.message || 'Erreur réseau')
    }
  }

  async function toggleEnabled(s: Source) {
    try {
      const res = await fetch(`/api/admin/sources/${encodeURIComponent(s.slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !s.enabled }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data?.error || `Erreur ${res.status}`)
        return
      }
      await loadSources()
    } catch (e: any) {
      alert(e?.message || 'Erreur réseau')
    }
  }

  async function loadSources() {
    const res = await fetch('/api/admin/sources')
    if (res.ok) setSources(await res.json())
  }

  async function loadRuns() {
    const res = await fetch('/api/admin/sources/runs')
    if (res.ok) {
      const data = await res.json()
      setRuns(data.runs || [])
      // If a run is currently in flight, attach to it.
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
      // Refresh sources + runs once the run terminates so counters are current.
      await Promise.all([loadSources(), loadRuns()])
    }
  }

  useEffect(() => {
    Promise.all([loadSources(), loadRuns()]).finally(() => setLoading(false))
  }, [])

  // Poll while a run is active.
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

  async function startRun(slugs?: string[]) {
    setError(null)
    setStarting(true)
    try {
      const res = await fetch('/api/admin/sources/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(slugs ? { slugs } : {}),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || 'Erreur')
        if (data.runId) {
          // Already-running case — attach to it.
          await pollActiveRun(data.runId)
        }
        return
      }
      // Optimistic placeholder so UI flips to 'running' instantly.
      setActiveRun({
        id: data.runId,
        status: 'pending',
        startedAt: new Date().toISOString(),
        completedAt: null,
        sourceSlugs: data.slugs || [],
        totalSources: (data.slugs || []).length,
        processedSources: 0,
        totalListingsFound: 0,
        totalListingsNew: 0,
        totalImported: 0,
        totalDuplicates: 0,
        totalErrors: 0,
        perSourceResults: null,
        errorMessage: null,
      })
    } catch (e: any) {
      setError(e?.message || 'Erreur réseau')
    } finally {
      setStarting(false)
    }
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">Non autorisé</p></div>
  }

  // 3-flow runnable buckets: each Run button is scoped to its strategy set.
  const flowARunnable = sources.filter(s => s.enabled && s.adapter && FLOW_A_STRATEGIES.includes(s.ingestionStrategy as any))
  const flowBRunnable = sources.filter(s => s.enabled && s.adapter && FLOW_B_STRATEGIES.includes(s.ingestionStrategy as any))
  const flowCInventory = sources.filter(s => FLOW_C_STRATEGIES.includes(s.ingestionStrategy as any))
  const isRunning = activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-6xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Sources</h1>
      <p className="text-sm text-stone-500 mb-5">Rendement et scan automatique des sources d&apos;annonces.</p>

      {/* Run panel — three flows mirroring ingestion strategies */}
      <div className="mb-5 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Flow A — Scan rapide */}
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
          <button
            onClick={() => startRun(flowARunnable.map(s => s.slug))}
            disabled={starting || !!isRunning || flowARunnable.length === 0}
            className="w-full px-3 py-2 rounded-lg text-sm font-bold bg-emerald-700 hover:bg-emerald-800 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? '…' : `▶ Scan rapide (${flowARunnable.length})`}
          </button>
          <p className="text-[11px] text-emerald-800 mt-2 leading-tight">
            <span className="font-semibold">Flow A.</span> APIs structurées (Greenhouse, RSS, gov SPAs). Rapide, ~$0/listing.
          </p>
        </div>

        {/* Flow B — Scan intelligent */}
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <button
            onClick={() => startRun(flowBRunnable.map(s => s.slug))}
            disabled={starting || !!isRunning || flowBRunnable.length === 0}
            className="w-full px-3 py-2 rounded-lg text-sm font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isRunning ? '…' : `▶ Scan intelligent (${flowBRunnable.length})`}
          </button>
          <p className="text-[11px] text-purple-800 mt-2 leading-tight">
            <span className="font-semibold">Flow B.</span> Career pages génériques (Playwright + Claude). Plus lent, ~$0.01-0.05/listing.
          </p>
        </div>

        {/* Flow C — Tâches manuelles */}
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <button
            onClick={() => setSelectedTab('__flow_c__')}
            className="w-full px-3 py-2 rounded-lg text-sm font-bold bg-amber-600 hover:bg-amber-700 text-white transition"
          >
            ✓ Tâches manuelles ({flowCInventory.length})
          </button>
          <p className="text-[11px] text-amber-800 mt-2 leading-tight">
            <span className="font-semibold">Flow C.</span> Extension navigateur + mots-clés Seek/Gumtree. À parcourir à la main.
          </p>
        </div>
      </div>

      {error && <div className="mb-3 text-xs text-red-700">{error}</div>}

      {activeRun && (
        <div className="mb-5 p-4 bg-stone-50 border border-stone-200 rounded-lg">
          <div className="bg-white border border-stone-200 rounded p-3 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-purple-900">
                {activeRun.status === 'pending' && 'En préparation…'}
                {activeRun.status === 'running' && `Scan en cours (${activeRun.processedSources}/${activeRun.totalSources})`}
                {activeRun.status === 'completed' && `✓ Terminé en ${Math.round((new Date(activeRun.completedAt!).getTime() - new Date(activeRun.startedAt).getTime()) / 1000)}s`}
                {activeRun.status === 'failed' && `✗ Échec`}
              </span>
              <span className="text-stone-500">{timeAgo(activeRun.startedAt)}</span>
            </div>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-stone-200 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${activeRun.status === 'failed' ? 'bg-red-500' : 'bg-purple-600'}`}
                style={{ width: `${activeRun.totalSources > 0 ? (activeRun.processedSources / activeRun.totalSources) * 100 : 0}%` }}
              />
            </div>

            <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
              <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700">{activeRun.totalListingsFound} vues</span>
              <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800">{activeRun.totalListingsNew} nouvelles</span>
              <span className="px-2 py-0.5 rounded bg-green-100 text-green-800">{activeRun.totalImported} importées</span>
              {activeRun.totalDuplicates > 0 && <span className="px-2 py-0.5 rounded bg-stone-200 text-stone-700">{activeRun.totalDuplicates} doublons</span>}
              {activeRun.totalErrors > 0 && <span className="px-2 py-0.5 rounded bg-red-100 text-red-800">{activeRun.totalErrors} erreurs</span>}
            </div>

            {activeRun.perSourceResults && activeRun.perSourceResults.length > 0 && (
              <details className="text-[11px] mt-1">
                <summary className="cursor-pointer text-purple-800 font-semibold">Détails par source</summary>
                <ul className="mt-1 space-y-1">
                  {activeRun.perSourceResults.map((r) => (
                    <li key={r.slug} className="flex flex-wrap gap-2 items-baseline">
                      <span className={r.status === 'ok' ? 'text-green-700' : 'text-red-700'}>
                        {r.status === 'ok' ? '✓' : '✗'}
                      </span>
                      <span className="font-mono text-stone-700">{r.slug}</span>
                      <span className="text-stone-500">{r.listingsFound} vues, {r.listingsNew} nouvelles, {r.imported} importées, {r.errors} erreurs ({Math.round(r.durationMs / 1000)}s)</span>
                      {r.errorMessage && <span className="text-red-600">— {r.errorMessage.slice(0, 120)}</span>}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {activeRun.errorMessage && (
              <div className="text-[11px] text-red-700">{activeRun.errorMessage}</div>
            )}
          </div>
        </div>
      )}

      {/* Tab navigation — mirrors Lucas's source sheet structure */}
      {!loading && sources.length > 0 && (() => {
        const counts = new Map<string, number>()
        let untagged = 0
        for (const s of sources) {
          if (s.sheetTab) counts.set(s.sheetTab, (counts.get(s.sheetTab) || 0) + 1)
          else untagged++
        }
        return (
          <div className="mb-4 flex flex-wrap gap-1.5 border-b border-stone-200 pb-1">
            <button
              onClick={() => setSelectedTab(null)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                selectedTab === null ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              Tous <span className="opacity-70 font-mono">{sources.length}</span>
            </button>
            {SHEET_TABS.map(tab => {
              const count = counts.get(tab.value) || 0
              if (count === 0) return null
              const active = selectedTab === tab.value
              return (
                <button
                  key={tab.value}
                  onClick={() => setSelectedTab(tab.value)}
                  title={tab.hint}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                    active ? 'bg-purple-700 text-white' : 'bg-purple-50 text-purple-800 hover:bg-purple-100'
                  }`}
                >
                  {tab.label} <span className="opacity-70 font-mono">{count}</span>
                </button>
              )
            })}
            {untagged > 0 && (
              <button
                onClick={() => setSelectedTab('__untagged__')}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                  selectedTab === '__untagged__' ? 'bg-amber-700 text-white' : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
                }`}
              >
                Sans onglet <span className="opacity-70 font-mono">{untagged}</span>
              </button>
            )}
          </div>
        )
      })()}

      {/* Add/Edit panel */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-stone-900">
          {selectedTab === null && 'Toutes les sources'}
          {selectedTab === '__untagged__' && 'Sources sans onglet'}
          {selectedTab === '__flow_c__' && 'Tâches manuelles (Flow C)'}
          {selectedTab && selectedTab !== '__untagged__' && selectedTab !== '__flow_c__' && (SHEET_TABS.find(t => t.value === selectedTab)?.label || selectedTab)}
        </h2>
        {!editing && (
          <button
            onClick={openCreate}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white transition"
          >
            + Nouvelle source
          </button>
        )}
      </div>

      {editing && (
        <div className="mb-4 p-4 bg-stone-50 border border-stone-300 rounded-lg">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-stone-900">
              {editing.mode === 'create' ? 'Nouvelle source' : `Modifier ${editing.originalSlug}`}
            </h3>
            <button onClick={closeForm} className="text-xs text-stone-500 hover:text-stone-700">✕ Annuler</button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <label className="space-y-1">
              <span className="block font-semibold text-stone-700">Slug (a-z, 0-9, _, -)</span>
              <input
                type="text"
                value={form.slug}
                onChange={e => setForm({ ...form, slug: e.target.value.toLowerCase() })}
                disabled={editing.mode === 'edit'}
                placeholder="ex: costa_careers"
                className="w-full px-2 py-1.5 border border-stone-300 rounded font-mono disabled:bg-stone-100 disabled:text-stone-500"
              />
            </label>
            <label className="space-y-1">
              <span className="block font-semibold text-stone-700">Label</span>
              <input
                type="text"
                value={form.label}
                onChange={e => setForm({ ...form, label: e.target.value })}
                placeholder="ex: Costa Group Careers"
                className="w-full px-2 py-1.5 border border-stone-300 rounded"
              />
            </label>
            <label className="space-y-1">
              <span className="block font-semibold text-stone-700">Catégorie de source</span>
              <select
                value={form.category}
                onChange={e => setForm({ ...form, category: e.target.value })}
                className="w-full px-2 py-1.5 border border-stone-300 rounded"
              >
                {SOURCE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className="space-y-1">
              <span className="block font-semibold text-stone-700">Onglet (sheet)</span>
              <select
                value={form.sheetTab}
                onChange={e => setForm({ ...form, sheetTab: e.target.value })}
                className="w-full px-2 py-1.5 border border-stone-300 rounded"
              >
                <option value="">— aucun —</option>
                {SHEET_TABS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="space-y-1 sm:col-span-2">
              <span className="block font-semibold text-stone-700">Stratégie d&apos;ingestion (Flow A/B/C)</span>
              <select
                value={form.ingestionStrategy}
                onChange={e => setForm({ ...form, ingestionStrategy: e.target.value })}
                className="w-full px-2 py-1.5 border border-stone-300 rounded"
              >
                <option value="">— non classée —</option>
                {INGESTION_STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
              <span className="block text-[10px] text-stone-500">
                Détermine quel bouton (rapide / intelligent / manuel) pilote cette source.
              </span>
            </label>
            <label className="space-y-1">
              <span className="block font-semibold text-stone-700">Adapter</span>
              <select
                value={form.adapter}
                onChange={e => setForm({ ...form, adapter: e.target.value })}
                className="w-full px-2 py-1.5 border border-stone-300 rounded"
              >
                <option value="">— aucun (manuel) —</option>
                {SOURCE_ADAPTERS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </label>
            <label className="flex items-center gap-2 sm:col-span-2">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={e => setForm({ ...form, enabled: e.target.checked })}
              />
              <span className="font-semibold text-stone-700">Actif (inclus dans les scans)</span>
            </label>
          </div>

          {ATS_API_ADAPTERS.includes(form.adapter as any) && (
            <div className="mt-4 pt-3 border-t border-stone-200">
              <h4 className="text-xs font-bold text-stone-800 mb-2">
                Configuration {form.adapter}
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1 sm:col-span-2">
                  <span className="block font-semibold text-stone-700">Board slug *</span>
                  <input
                    type="text"
                    value={form.configBoardSlug}
                    onChange={e => setForm({ ...form, configBoardSlug: e.target.value })}
                    placeholder={
                      form.adapter === 'greenhouse_api' ? 'ex: atlassian (depuis boards.greenhouse.io/atlassian)' :
                      form.adapter === 'workable_api'   ? 'ex: company (depuis apply.workable.com/company)' :
                                                          'ex: company (depuis jobs.lever.co/company)'
                    }
                    className="w-full px-2 py-1.5 border border-stone-300 rounded font-mono"
                  />
                  <span className="block text-[10px] text-stone-500">
                    Pas besoin d&apos;URL complète — juste le slug d&apos;identifiant. La détection ATS depuis l&apos;URL le récupère automatiquement.
                  </span>
                </label>
                <label className="space-y-1">
                  <span className="block font-semibold text-stone-700">État par défaut</span>
                  <select
                    value={form.configState}
                    onChange={e => setForm({ ...form, configState: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-300 rounded"
                  >
                    <option value="">— aucun —</option>
                    {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block font-semibold text-stone-700">Catégorie par défaut</span>
                  <select
                    value={form.configCategory}
                    onChange={e => setForm({ ...form, configCategory: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-300 rounded"
                  >
                    <option value="">— aucune —</option>
                    {JOB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              </div>
            </div>
          )}

          {form.adapter === 'generic_career_page' && (
            <div className="mt-4 pt-3 border-t border-stone-200">
              <h4 className="text-xs font-bold text-stone-800 mb-2">Configuration generic_career_page</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1 sm:col-span-2">
                  <span className="block font-semibold text-stone-700">URL de la page liste *</span>
                  <div className="flex gap-2">
                    <input
                      type="url"
                      value={form.configUrl}
                      onChange={e => setForm({ ...form, configUrl: e.target.value })}
                      placeholder="https://example.com/careers"
                      className="flex-1 px-2 py-1.5 border border-stone-300 rounded font-mono"
                    />
                    <button
                      type="button"
                      onClick={detectAts}
                      disabled={detectStatus.kind === 'detecting' || !form.configUrl.trim()}
                      className="px-2 py-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[11px] whitespace-nowrap disabled:opacity-50"
                      title="Sniff la page pour Greenhouse / Workable / Lever et propose le bon adapter Flow A"
                    >
                      {detectStatus.kind === 'detecting' ? '…' : '🔎 Détecter ATS'}
                    </button>
                  </div>
                  {detectStatus.kind === 'found' && detectStatus.suggestion && (
                    <div className="mt-2 p-2 rounded bg-emerald-50 border border-emerald-200 text-emerald-900 text-[11px]">
                      <div className="font-semibold">✓ ATS détecté !</div>
                      <div>{detectStatus.message}</div>
                      <button
                        type="button"
                        onClick={applyDetectionSuggestion}
                        className="mt-1 px-2 py-1 rounded bg-emerald-700 hover:bg-emerald-800 text-white font-bold text-[10px]"
                      >
                        ✓ Appliquer (basculer en {detectStatus.suggestion.adapter})
                      </button>
                    </div>
                  )}
                  {detectStatus.kind === 'not_found' && (
                    <div className="mt-2 p-2 rounded bg-stone-100 border border-stone-200 text-stone-600 text-[11px]">
                      ℹ {detectStatus.message}
                    </div>
                  )}
                  {detectStatus.kind === 'error' && (
                    <div className="mt-2 p-2 rounded bg-red-50 border border-red-200 text-red-700 text-[11px]">
                      ✗ {detectStatus.message}
                    </div>
                  )}
                </label>
                <label className="space-y-1">
                  <span className="block font-semibold text-stone-700">État par défaut</span>
                  <select
                    value={form.configState}
                    onChange={e => setForm({ ...form, configState: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-300 rounded"
                  >
                    <option value="">— aucun —</option>
                    {AU_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </label>
                <label className="space-y-1">
                  <span className="block font-semibold text-stone-700">Catégorie par défaut</span>
                  <select
                    value={form.configCategory}
                    onChange={e => setForm({ ...form, configCategory: e.target.value })}
                    className="w-full px-2 py-1.5 border border-stone-300 rounded"
                  >
                    <option value="">— aucune —</option>
                    {JOB_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="block font-semibold text-stone-700">Sélecteur CSS des liens (optionnel)</span>
                  <input
                    type="text"
                    value={form.configSelector}
                    onChange={e => setForm({ ...form, configSelector: e.target.value })}
                    placeholder='ex: a.job-link, .careers-list a[href*="/job/"]'
                    className="w-full px-2 py-1.5 border border-stone-300 rounded font-mono"
                  />
                  <span className="block text-[10px] text-stone-500">Vide = heuristique automatique (matche /jobs/, /careers/, /positions/, etc.)</span>
                </label>
                <label className="space-y-1 sm:col-span-2">
                  <span className="block font-semibold text-stone-700">Pattern URL des liens (optionnel)</span>
                  <input
                    type="text"
                    value={form.configPattern}
                    onChange={e => setForm({ ...form, configPattern: e.target.value })}
                    placeholder="ex: /careers/job/ ou regex"
                    className="w-full px-2 py-1.5 border border-stone-300 rounded font-mono"
                  />
                </label>
              </div>
            </div>
          )}

          {formError && <div className="mt-3 text-xs text-red-700">{formError}</div>}

          <div className="mt-4 flex items-center gap-2">
            <button
              onClick={submitForm}
              disabled={formSaving}
              className="px-4 py-1.5 rounded-md text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50"
            >
              {formSaving ? 'Enregistrement…' : editing.mode === 'create' ? 'Créer' : 'Enregistrer'}
            </button>
            <button onClick={closeForm} className="px-3 py-1.5 rounded-md text-xs font-semibold text-stone-600 hover:text-stone-900">
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Quick-filter chips + search — orthogonal to sheet-tab filter */}
      {!loading && sources.length > 0 && (() => {
        const statusCounts: Record<SourceStatus, number> = {
          productive: 0, partial: 0, broken: 0, attention: 0, configured_off: 0, inventory: 0,
        }
        for (const s of sources) statusCounts[statusOf(s)]++
        return (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => setStatusFilter(null)}
              className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                statusFilter === null ? 'bg-stone-900 text-white' : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
              }`}
            >
              Toutes <span className="opacity-70 font-mono">{sources.length}</span>
            </button>
            {(['productive', 'partial', 'broken', 'attention', 'configured_off', 'inventory'] as SourceStatus[]).map(st => {
              if (statusCounts[st] === 0 && st !== statusFilter) return null
              return (
                <button
                  key={st}
                  onClick={() => setStatusFilter(statusFilter === st ? null : st)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition ${
                    statusFilter === st ? `${STATUS_META[st].pillClass} ring-2 ring-offset-1 ring-stone-400` : `${STATUS_META[st].pillClass} hover:opacity-90`
                  }`}
                >
                  {STATUS_META[st].dot} {STATUS_META[st].label} <span className="opacity-70 font-mono">{statusCounts[st]}</span>
                </button>
              )
            })}
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="🔎 Rechercher slug ou label…"
              className="ml-auto px-3 py-1 border border-stone-300 rounded-md text-xs w-full sm:w-64"
            />
          </div>
        )
      })()}

      {/* Sources table — composes sheet-tab + status filter + search, sorted by status rank */}
      {(() => {
        const q = searchQuery.trim().toLowerCase()
        const filteredSources = sources
          // Sheet-tab filter
          .filter(s => {
            if (selectedTab === null) return true
            if (selectedTab === '__untagged__') return !s.sheetTab
            if (selectedTab === '__flow_c__') return FLOW_C_STRATEGIES.includes(s.ingestionStrategy as any)
            return s.sheetTab === selectedTab
          })
          // Status filter
          .filter(s => !statusFilter || statusOf(s) === statusFilter)
          // Search
          .filter(s => !q || s.slug.toLowerCase().includes(q) || s.label.toLowerCase().includes(q))
          // Sort: productives first, then attention, then off, then inventory.
          // Within tier: by totalApproved desc, then label asc.
          .sort((a, b) => {
            const ra = STATUS_META[statusOf(a)].sortRank
            const rb = STATUS_META[statusOf(b)].sortRank
            if (ra !== rb) return ra - rb
            if (a.totalApproved !== b.totalApproved) return b.totalApproved - a.totalApproved
            return a.label.localeCompare(b.label)
          })
        return loading ? (
          <div className="text-center py-12 text-stone-500">Chargement…</div>
        ) : sources.length === 0 ? (
          <div className="text-center py-12 text-stone-500">Aucune source enregistrée.</div>
        ) : filteredSources.length === 0 ? (
          <div className="text-center py-12 text-stone-500">Aucune source dans cet onglet.</div>
        ) : (
        <div className="overflow-x-auto bg-white border border-stone-200 rounded-lg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-stone-200 text-xs">
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Statut</th>
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Source</th>
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Adapter</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Vues</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Approuvées</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Rejetées</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Taux</th>
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Dernier run</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredSources.map(s => {
                const denom = s.totalApproved + s.totalRejected
                const approvalRate = denom > 0 ? Math.round((s.totalApproved / denom) * 100) : 0
                const status = statusOf(s)
                const meta = STATUS_META[status]
                // Per-row Run button gate: just needs an adapter. The `enabled`
                // flag only controls whether the master "scan complet" includes
                // this source — explicit per-row Run is always allowed.
                const canRun = !!s.adapter
                // Visually de-emphasize inventory rows so the eye lands on
                // productives + attention rows first.
                const rowDim = status === 'inventory' ? 'opacity-60' : ''
                return (
                  <tr key={s.id} className={`border-b border-stone-100 text-xs ${rowDim}`}>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${meta.pillClass}`}>
                        <span>{meta.dot}</span>
                        <span>{meta.label}</span>
                      </span>
                      {!s.enabled && status !== 'configured_off' && status !== 'inventory' && (
                        <span className="ml-1 inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold bg-stone-200 text-stone-600">off</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Link
                        href={`/admin/sources/${encodeURIComponent(s.slug)}`}
                        className="font-bold text-stone-900 hover:text-purple-700 hover:underline transition"
                        title="Voir la fiche détaillée + analytics"
                      >
                        {s.label}
                      </Link>
                      <div className="text-[10px] text-stone-500 font-mono flex items-center gap-1">
                        <span>{s.slug}</span>
                        {s.profile?.notes && (
                          <span title={s.profile.notes.slice(0, 200)} className="text-purple-600">📝</span>
                        )}
                        {s.profile?.fixHistory?.length > 0 && (
                          <span title={`${s.profile.fixHistory.length} fix(es) enregistrés`} className="text-stone-500">🔧</span>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-stone-600 font-mono text-[11px]">
                      {s.adapter || '—'}
                      {s.ingestionStrategy && (() => {
                        const strat = INGESTION_STRATEGIES.find(x => x.value === s.ingestionStrategy)
                        const flowColor =
                          FLOW_A_STRATEGIES.includes(s.ingestionStrategy as any) ? 'bg-emerald-100 text-emerald-800' :
                          FLOW_B_STRATEGIES.includes(s.ingestionStrategy as any) ? 'bg-purple-100 text-purple-800' :
                          FLOW_C_STRATEGIES.includes(s.ingestionStrategy as any) ? 'bg-amber-100 text-amber-800' :
                          'bg-stone-200 text-stone-600'
                        return (
                          <span className={`ml-1.5 inline-block px-1.5 py-0.5 rounded text-[9px] font-bold ${flowColor}`}>
                            {strat?.badge || s.ingestionStrategy}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-800">{s.totalSeen}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-green-700 font-semibold">{s.totalApproved}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-red-700">{s.totalRejected}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-stone-700">{denom > 0 ? `${approvalRate}%` : '—'}</td>
                    <td className="px-3 py-2 text-stone-600">
                      <div>{timeAgo(s.lastRunAt)}</div>
                      {s.lastRunStatus && (
                        <div className={`text-[10px] ${
                          s.lastRunStatus === 'ok' ? 'text-green-600' :
                          s.lastRunStatus === 'error' ? 'text-red-600' : 'text-stone-400'
                        }`}>{s.lastRunStatus}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        {canRun ? (
                          <button
                            onClick={() => startRun([s.slug])}
                            disabled={starting || !!isRunning}
                            className="px-2 py-1 rounded text-[11px] font-bold bg-purple-100 hover:bg-purple-200 text-purple-800 transition disabled:opacity-50"
                          >
                            ▶ Run
                          </button>
                        ) : (
                          <span className="text-[10px] text-stone-400">manuel</span>
                        )}
                        <button
                          onClick={() => toggleEnabled(s)}
                          title={s.enabled ? 'Désactiver' : 'Activer'}
                          className="px-1.5 py-1 rounded text-[11px] font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 transition"
                        >
                          {s.enabled ? '◐' : '◯'}
                        </button>
                        <button
                          onClick={() => openEdit(s)}
                          title="Modifier"
                          className="px-1.5 py-1 rounded text-[11px] font-semibold bg-stone-100 hover:bg-stone-200 text-stone-700 transition"
                        >
                          ✏
                        </button>
                        <button
                          onClick={() => deleteSource(s.slug)}
                          title="Supprimer"
                          className="px-1.5 py-1 rounded text-[11px] font-semibold bg-red-50 hover:bg-red-100 text-red-700 transition"
                        >
                          ✕
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        )
      })()}

      {/* Recent runs history */}
      {runs.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-bold text-stone-900 mb-2">Scans récents</h2>
          <div className="overflow-x-auto bg-white border border-stone-200 rounded-lg">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr className="border-b-2 border-stone-200">
                  <th className="text-left px-3 py-2 font-semibold text-stone-700">Démarré</th>
                  <th className="text-center px-3 py-2 font-semibold text-stone-700">Statut</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Sources</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Vues</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Nouvelles</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Importées</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Durée</th>
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
        </div>
      )}
    </div>
  )
}
