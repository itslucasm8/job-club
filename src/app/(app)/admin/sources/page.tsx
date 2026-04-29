'use client'
import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'

type SourceConfig = {
  url?: string
  jobLinkSelector?: string
  jobLinkPattern?: string
  defaultCategory?: string
  defaultState?: string
  maxListings?: number
}

type Source = {
  id: string
  slug: string
  label: string
  category: string
  enabled: boolean
  adapter: string | null
  config: SourceConfig | null
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  totalSeen: number
  totalApproved: number
  totalRejected: number
}

const SOURCE_CATEGORIES = ['government', 'aggregator', 'ats_rss', 'competitor', 'manual', 'direct'] as const
const SOURCE_ADAPTERS = ['workforce_australia', 'harvest_trail', 'generic_career_page', 'manual', 'extension'] as const
const AU_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'] as const
const JOB_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other'] as const

type SourceFormState = {
  slug: string
  label: string
  category: string
  adapter: string
  enabled: boolean
  configUrl: string
  configState: string
  configCategory: string
  configSelector: string
  configPattern: string
}

function emptyForm(): SourceFormState {
  return {
    slug: '',
    label: '',
    category: 'direct',
    adapter: 'generic_career_page',
    enabled: true,
    configUrl: '',
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
    adapter: s.adapter || '',
    enabled: s.enabled,
    configUrl: cfg.url || '',
    configState: cfg.defaultState || '',
    configCategory: cfg.defaultCategory || '',
    configSelector: cfg.jobLinkSelector || '',
    configPattern: cfg.jobLinkPattern || '',
  }
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

  function openCreate() {
    setForm(emptyForm())
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
    if (form.adapter !== 'generic_career_page') return null
    const cfg: SourceConfig = { url: form.configUrl.trim() }
    if (form.configState) cfg.defaultState = form.configState
    if (form.configCategory) cfg.defaultCategory = form.configCategory
    if (form.configSelector.trim()) cfg.jobLinkSelector = form.configSelector.trim()
    if (form.configPattern.trim()) cfg.jobLinkPattern = form.configPattern.trim()
    return cfg
  }

  async function submitForm() {
    if (!editing) return
    setFormError(null)
    setFormSaving(true)
    try {
      const payload: any = {
        label: form.label,
        category: form.category,
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

  const runnable = sources.filter(s => s.enabled && s.adapter)
  const isRunning = activeRun && (activeRun.status === 'running' || activeRun.status === 'pending')

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-6xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Sources</h1>
      <p className="text-sm text-stone-500 mb-5">Rendement et scan automatique des sources d&apos;annonces.</p>

      {/* Run panel */}
      <div className="mb-5 p-4 bg-purple-50 border border-purple-200 rounded-lg">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => startRun()}
            disabled={starting || !!isRunning || runnable.length === 0}
            className="px-4 py-2 rounded-lg text-sm font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50"
          >
            {isRunning ? 'Scan en cours…' : `▶ Lancer un scan complet (${runnable.length} sources)`}
          </button>
          <span className="text-xs text-purple-800">
            Va parcourir chaque source, importer les nouvelles annonces et déposer dans /admin/candidates.
          </span>
        </div>
        {error && <div className="mt-2 text-xs text-red-700">{error}</div>}

        {activeRun && (
          <div className="mt-4 bg-white border border-purple-200 rounded p-3 space-y-2">
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
        )}
      </div>

      {/* Add/Edit panel */}
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-stone-900">Sources enregistrées</h2>
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

          {form.adapter === 'generic_career_page' && (
            <div className="mt-4 pt-3 border-t border-stone-200">
              <h4 className="text-xs font-bold text-stone-800 mb-2">Configuration generic_career_page</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1 sm:col-span-2">
                  <span className="block font-semibold text-stone-700">URL de la page liste *</span>
                  <input
                    type="url"
                    value={form.configUrl}
                    onChange={e => setForm({ ...form, configUrl: e.target.value })}
                    placeholder="https://example.com/careers"
                    className="w-full px-2 py-1.5 border border-stone-300 rounded font-mono"
                  />
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

      {/* Sources table */}
      {loading ? (
        <div className="text-center py-12 text-stone-500">Chargement…</div>
      ) : sources.length === 0 ? (
        <div className="text-center py-12 text-stone-500">Aucune source enregistrée.</div>
      ) : (
        <div className="overflow-x-auto bg-white border border-stone-200 rounded-lg">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-stone-200 text-xs">
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Source</th>
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Adapter</th>
                <th className="text-center px-3 py-2 font-semibold text-stone-700">État</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Vues</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Approuvées</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Rejetées</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Taux</th>
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Dernier run</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Action</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => {
                const denom = s.totalApproved + s.totalRejected
                const approvalRate = denom > 0 ? Math.round((s.totalApproved / denom) * 100) : 0
                const canRun = s.enabled && !!s.adapter
                return (
                  <tr key={s.id} className="border-b border-stone-100 text-xs">
                    <td className="px-3 py-2">
                      <div className="font-bold text-stone-900">{s.label}</div>
                      <div className="text-[10px] text-stone-500 font-mono">{s.slug}</div>
                    </td>
                    <td className="px-3 py-2 text-stone-600 font-mono text-[11px]">{s.adapter || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        s.enabled ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'
                      }`}>
                        {s.enabled ? 'actif' : 'désactivé'}
                      </span>
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
      )}

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
