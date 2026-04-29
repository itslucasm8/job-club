'use client'
import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'

type Candidate = {
  id: string
  source: string
  sourceUrl: string
  rawData: any
  classifierScore: any
  status: string
  rejectReason: string | null
  createdAt: string
}

type StatusFilter = 'pending' | 'auto_rejected' | 'approved' | 'rejected'

type BulkUrlResult =
  | { url: string; status: 'inserted'; candidateId: string; title?: string }
  | { url: string; status: 'duplicate'; reason: string }
  | { url: string; status: 'extraction_failed'; reason: string }
  | { url: string; status: 'error'; error: string }

type BulkResult = {
  counts: { inserted: number; duplicate: number; extraction_failed: number; error: number }
  results: BulkUrlResult[]
  processed: number
}

type EditFields = {
  title: string
  company: string
  state: string
  location: string
  category: string
  type: string
  pay: string
  description: string
  applyUrl: string
  eligible88Days: boolean
}

const VALID_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']
const VALID_CATEGORIES = ['farm', 'hospitality', 'construction', 'retail', 'cleaning', 'events', 'animals', 'transport', 'other']
const VALID_TYPES = ['casual', 'full_time', 'part_time', 'contract']

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: 'pending', label: 'En attente' },
  { key: 'auto_rejected', label: 'Auto-rejetés' },
  { key: 'approved', label: 'Approuvés' },
  { key: 'rejected', label: 'Rejetés' },
]

const REJECT_REASONS = [
  'Locals only',
  'Pas WHV-friendly',
  'Suspicion arnaque',
  'Pas assez d\'info',
  'Doublon',
  'Hors zone géo',
  'Mauvaise catégorie',
  'Autre',
]

export default function AdminCandidatesPage() {
  const { data: session } = useSession()
  const [status, setStatus] = useState<StatusFilter>('pending')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [actingId, setActingId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [importPasteText, setImportPasteText] = useState('')
  const [importPasteOpen, setImportPasteOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importMessage, setImportMessage] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editError, setEditError] = useState<string | null>(null)
  const [bulkUrls, setBulkUrls] = useState('')
  const [bulkImporting, setBulkImporting] = useState(false)
  const [bulkResult, setBulkResult] = useState<BulkResult | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  function updateCandidateLocally(updated: Candidate) {
    setCandidates(cs => cs.map(c => (c.id === updated.id ? updated : c)))
  }

  async function saveEdit(id: string, fields: Partial<EditFields>): Promise<boolean> {
    setEditError(null)
    setActingId(id)
    try {
      const res = await fetch(`/api/admin/candidates/${id}/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(fields),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setEditError(data.error || 'Erreur')
        return false
      }
      if (data.candidate) updateCandidateLocally(data.candidate)
      return true
    } catch (e: any) {
      setEditError(e?.message || 'Erreur réseau')
      return false
    } finally {
      setActingId(null)
    }
  }

  async function saveAndApprove(id: string, fields: Partial<EditFields>) {
    const ok = await saveEdit(id, fields)
    if (ok) {
      setEditingId(null)
      await approve(id)
    }
  }

  function parseBulkUrls(text: string): string[] {
    return text
      .split(/[\s,;]+/)
      .map(u => u.trim())
      .filter(u => /^https?:\/\//i.test(u))
  }

  async function importBulk() {
    const urls = parseBulkUrls(bulkUrls)
    if (urls.length === 0) return
    setBulkImporting(true)
    setBulkResult(null)
    try {
      const res = await fetch('/api/admin/candidates/from-urls-bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        setBulkResult(data as BulkResult)
        // Clear textarea on full success; keep failed URLs visible if any.
        const counts = (data as BulkResult).counts
        if (counts.extraction_failed === 0 && counts.error === 0) {
          setBulkUrls('')
        } else {
          // Replace with only the URLs that failed so admin can retry/fix them.
          const failedUrls = (data as BulkResult).results
            .filter(r => r.status === 'extraction_failed' || r.status === 'error')
            .map(r => r.url)
          setBulkUrls(failedUrls.join('\n'))
        }
        fetchCandidates()
      } else {
        setBulkResult({
          counts: { inserted: 0, duplicate: 0, extraction_failed: 0, error: 1 },
          results: [{ url: '(batch)', status: 'error', error: data.error || 'Erreur' }],
          processed: 0,
        })
      }
    } catch (e: any) {
      setBulkResult({
        counts: { inserted: 0, duplicate: 0, extraction_failed: 0, error: 1 },
        results: [{ url: '(batch)', status: 'error', error: e?.message || 'Erreur réseau' }],
        processed: 0,
      })
    } finally {
      setBulkImporting(false)
    }
  }

  const fetchCandidates = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ status })
      if (search.trim()) params.set('q', search.trim())
      const res = await fetch(`/api/admin/candidates?${params.toString()}`)
      if (res.ok) {
        const data = await res.json()
        setCandidates(data.candidates || [])
        setStatusCounts(data.statusCounts || {})
      }
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [status, search])

  useEffect(() => { fetchCandidates() }, [fetchCandidates])

  async function approve(id: string) {
    setActingId(id)
    try {
      const res = await fetch(`/api/admin/candidates/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) {
        setCandidates(c => c.filter(x => x.id !== id))
        setStatusCounts(prev => ({ ...prev, pending: Math.max(0, (prev.pending || 0) - 1), approved: (prev.approved || 0) + 1 }))
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Erreur')
      }
    } finally { setActingId(null) }
  }

  async function importFromUrl() {
    if (!importUrl.trim()) return
    setImporting(true)
    setImportMessage(null)
    try {
      const payload: any = { url: importUrl.trim() }
      if (importPasteText.trim().length >= 200) payload.page_text = importPasteText.trim()
      const res = await fetch('/api/admin/candidates/from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        if (data.status === 'duplicate') {
          setImportMessage(`⚠ ${data.message}`)
        } else {
          setImportMessage(`✓ Importée: ${data.raw?.title || ''}`)
          setImportUrl('')
          setImportPasteText('')
          setImportPasteOpen(false)
          fetchCandidates()
        }
      } else {
        setImportMessage(`✗ ${data.error || 'Erreur'}`)
      }
    } catch (e: any) {
      setImportMessage(`✗ ${e?.message || 'Erreur réseau'}`)
    } finally {
      setImporting(false)
    }
  }

  async function reject(id: string, reason: string) {
    setActingId(id)
    try {
      const res = await fetch(`/api/admin/candidates/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (res.ok) {
        setCandidates(c => c.filter(x => x.id !== id))
        setStatusCounts(prev => ({ ...prev, [status]: Math.max(0, (prev[status] || 0) - 1), rejected: (prev.rejected || 0) + 1 }))
      } else {
        alert('Erreur')
      }
    } finally { setActingId(null) }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${Math.max(1, mins)}min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}j`
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">Non autorisé</p></div>
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-6xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Candidats</h1>
      <p className="text-sm text-stone-500 mb-4">Annonces collectées par les sources, en attente de revue.</p>

      {/* Import by URL (optionally with pasted page text) */}
      <div className="mb-5 p-3 bg-purple-50 border border-purple-200 rounded-lg">
        <div className="text-xs font-bold text-purple-900 mb-2">Importer une annonce par URL</div>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="url"
            value={importUrl}
            onChange={e => setImportUrl(e.target.value)}
            placeholder="https://... (URL d'annonce)"
            className="flex-1 px-3 py-2 rounded-lg border border-purple-300 bg-white text-sm focus:outline-none focus:border-purple-500"
            onKeyDown={e => { if (e.key === 'Enter' && !importPasteOpen) importFromUrl() }}
          />
          <button
            onClick={importFromUrl}
            disabled={importing || !importUrl.trim()}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50 whitespace-nowrap"
          >
            {importing ? 'Extraction…' : 'Extraire (IA)'}
          </button>
        </div>
        <button
          type="button"
          onClick={() => setImportPasteOpen(o => !o)}
          className="mt-2 text-[11px] font-semibold text-purple-700 hover:text-purple-900 underline"
        >
          {importPasteOpen ? '− Fermer le texte collé' : '+ Coller le texte directement (pour Gumtree, Seek, sites bloqués)'}
        </button>
        {importPasteOpen && (
          <div className="mt-2">
            <textarea
              value={importPasteText}
              onChange={e => setImportPasteText(e.target.value)}
              rows={6}
              placeholder="Copie-colle le texte de l'annonce ici (Ctrl+A puis Ctrl+C sur la page Gumtree/Seek). L'URL au-dessus sert de référence."
              className="w-full px-3 py-2 rounded-lg border border-purple-300 bg-white text-xs focus:outline-none focus:border-purple-500"
            />
            <div className="text-[11px] text-purple-700 mt-1">
              {importPasteText.length} caractères {importPasteText.length >= 200 ? '✓' : '(min 200 pour utiliser le texte collé)'}
            </div>
          </div>
        )}
        {importMessage && (
          <div className="mt-2 text-xs text-purple-900">{importMessage}</div>
        )}
      </div>

      {/* Bulk URL import — paste many URLs at once */}
      <div className="mb-5 p-3 bg-orange-50 border border-orange-200 rounded-lg">
        <button
          type="button"
          onClick={() => setBulkOpen(o => !o)}
          className="w-full flex items-center justify-between text-xs font-bold text-orange-900 hover:text-orange-950 transition"
        >
          <span>Importer un lot d&apos;URLs ({parseBulkUrls(bulkUrls).length} prêtes)</span>
          <span className="text-orange-600">{bulkOpen ? '−' : '+'}</span>
        </button>
        {bulkOpen && (
          <div className="mt-2">
            <textarea
              value={bulkUrls}
              onChange={e => setBulkUrls(e.target.value)}
              rows={5}
              placeholder={'Colle plusieurs URLs (une par ligne, espaces ou virgules autorisés). Max 30 par lot.\n\nExemple:\nhttps://www.backpackerjobboard.com.au/job/123\nhttps://www.backpackerjobboard.com.au/job/456\nhttps://workforceaustralia.gov.au/individuals/jobs/details/789'}
              className="w-full px-3 py-2 rounded-lg border border-orange-300 bg-white text-xs font-mono focus:outline-none focus:border-orange-500"
            />
            <div className="flex flex-wrap gap-2 items-center mt-2">
              <button
                onClick={importBulk}
                disabled={bulkImporting || parseBulkUrls(bulkUrls).length === 0}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white transition disabled:opacity-50"
              >
                {bulkImporting ? `Traitement de ${parseBulkUrls(bulkUrls).length} URLs… (peut prendre 1-2 min)` : `Importer ${parseBulkUrls(bulkUrls).length} URLs`}
              </button>
              <span className="text-[11px] text-orange-700">
                Ne marche pas pour Gumtree/Seek (datacenter bloqué) — utilise l&apos;extension pour ces sites.
              </span>
            </div>
            {bulkResult && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                  {bulkResult.counts.inserted > 0 && (
                    <span className="px-2 py-1 rounded bg-green-100 text-green-800">✓ {bulkResult.counts.inserted} importée(s)</span>
                  )}
                  {bulkResult.counts.duplicate > 0 && (
                    <span className="px-2 py-1 rounded bg-stone-200 text-stone-700">{bulkResult.counts.duplicate} doublon(s)</span>
                  )}
                  {bulkResult.counts.extraction_failed > 0 && (
                    <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">⚠ {bulkResult.counts.extraction_failed} extraction(s) échouée(s)</span>
                  )}
                  {bulkResult.counts.error > 0 && (
                    <span className="px-2 py-1 rounded bg-red-100 text-red-800">✗ {bulkResult.counts.error} erreur(s)</span>
                  )}
                </div>
                <details className="text-[11px]">
                  <summary className="cursor-pointer text-orange-800 font-semibold">Détails par URL</summary>
                  <ul className="mt-1 space-y-1 bg-white border border-orange-200 rounded p-2 max-h-48 overflow-y-auto">
                    {bulkResult.results.map((r, i) => (
                      <li key={i} className="flex gap-2 items-start">
                        <span className={
                          r.status === 'inserted' ? 'text-green-700' :
                          r.status === 'duplicate' ? 'text-stone-500' :
                          r.status === 'extraction_failed' ? 'text-amber-700' :
                          'text-red-700'
                        }>
                          {r.status === 'inserted' ? '✓' : r.status === 'duplicate' ? '·' : r.status === 'extraction_failed' ? '⚠' : '✗'}
                        </span>
                        <span className="font-mono text-stone-600 truncate flex-1" title={r.url}>{r.url}</span>
                        <span className="text-stone-500 flex-shrink-0">
                          {r.status === 'inserted' && (r.title?.slice(0, 40) || 'importée')}
                          {r.status === 'duplicate' && `doublon (${r.reason})`}
                          {r.status === 'extraction_failed' && r.reason.slice(0, 60)}
                          {r.status === 'error' && r.error.slice(0, 60)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-2 mb-4 overflow-x-auto">
        {STATUS_TABS.map(tab => {
          const active = status === tab.key
          const count = statusCounts[tab.key] || 0
          return (
            <button
              key={tab.key}
              onClick={() => setStatus(tab.key)}
              className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition border ${
                active
                  ? 'bg-purple-700 text-white border-purple-700'
                  : 'bg-white text-stone-600 border-stone-200 hover:border-purple-300'
              }`}
            >
              {tab.label} <span className={`ml-1 ${active ? 'text-purple-200' : 'text-stone-400'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Recherche par titre, entreprise, lieu…"
          className="w-full px-4 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-stone-500">Chargement…</div>
      ) : candidates.length === 0 ? (
        <div className="text-center py-12 text-stone-500">Aucun candidat dans cet onglet.</div>
      ) : (
        <div className="space-y-2">
          {candidates.map(c => {
            const raw = (c.rawData as any) || {}
            const score = (c.classifierScore as any) || null
            const expanded = expandedId === c.id
            return (
              <div key={c.id} className="bg-white border border-stone-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedId(expanded ? null : c.id)}
                  className="w-full text-left px-4 py-3 hover:bg-stone-50 transition"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-stone-900 truncate">{raw.title || '(sans titre)'}</div>
                      <div className="text-xs text-stone-600 truncate">
                        {raw.company || '?'} · {raw.location || raw.state || '?'}
                      </div>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{c.source}</span>
                        <span className="text-[10px] text-stone-400">{timeAgo(c.createdAt)}</span>
                        <EligibilityBadge raw={raw} />
                        <PayBadge raw={raw} />
                        <QualityBadges raw={raw} />
                        {score?.has_locals_only_red_flag && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Locals only</span>}
                        {score?.has_scam_red_flags && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">⚠ arnaque</span>}
                        {score?.is_backpacker_suitable === false && <span className="text-[10px] font-semibold text-stone-700 bg-stone-200 px-1.5 py-0.5 rounded">Pas WHV</span>}
                      </div>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-stone-400 transition-transform flex-shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`}>
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </div>
                </button>

                {expanded && (
                  <div className="border-t border-stone-100 px-4 py-3 bg-stone-50 space-y-3">
                    {editingId === c.id ? (
                      <EditCandidateForm
                        raw={raw}
                        saving={actingId === c.id}
                        error={editError}
                        onCancel={() => { setEditingId(null); setEditError(null) }}
                        onSave={async (fields) => {
                          const ok = await saveEdit(c.id, fields)
                          if (ok) setEditingId(null)
                        }}
                        onSaveAndApprove={(fields) => saveAndApprove(c.id, fields)}
                      />
                    ) : (
                      <>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
                          <Field label="Catégorie" value={raw.category} />
                          <Field label="Type" value={raw.type} />
                          <Field label="Pay" value={raw.pay} />
                          <Field label="State" value={raw.state} />
                        </div>
                        <EligibilityPanel raw={raw} />
                        <div>
                          <div className="text-[10px] font-semibold text-stone-500 uppercase mb-1">Description</div>
                          <div className="text-xs text-stone-800 bg-white border border-stone-200 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                            {raw.description || '(vide)'}
                          </div>
                        </div>
                        <NotesPanel raw={raw} />
                        <SourceTextPanel raw={raw} />
                        {score && (
                          <div>
                            <div className="text-[10px] font-semibold text-stone-500 uppercase mb-1">Classifier</div>
                            <pre className="text-[11px] text-stone-700 bg-white border border-stone-200 rounded p-2 overflow-x-auto">{JSON.stringify(score, null, 2)}</pre>
                          </div>
                        )}
                        <div className="flex flex-wrap gap-2">
                          <a
                            href={c.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-700 transition"
                          >
                            Source ↗
                          </a>
                          {(c.status === 'pending' || c.status === 'auto_rejected') && (
                            <>
                              <button
                                onClick={() => { setEditingId(c.id); setEditError(null) }}
                                disabled={actingId === c.id}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-50"
                              >
                                Modifier
                              </button>
                              <button
                                onClick={() => approve(c.id)}
                                disabled={actingId === c.id}
                                className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
                              >
                                {actingId === c.id ? '…' : 'Approuver'}
                              </button>
                              <RejectMenu onPick={(reason) => reject(c.id, reason)} disabled={actingId === c.id} />
                            </>
                          )}
                        </div>
                        {c.rejectReason && (
                          <div className="text-xs text-stone-600">
                            <span className="font-semibold">Raison: </span>{c.rejectReason}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-stone-500 uppercase">{label}</div>
      <div className="text-stone-800 truncate">{value || '—'}</div>
    </div>
  )
}

function EligibilityBadge({ raw }: { raw: any }) {
  // Prefer the deterministic verdict if the proxy returned it; else fall back
  // to the raw LLM flag (older candidates predate the eligibility module).
  const det = raw.eligibility_88_days
  const conf = raw.eligibility_confidence as 'high' | 'medium' | 'low' | undefined
  const reason = raw.eligibility_reason as string | undefined
  if (det === undefined && raw.eligible88Days) {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title="Annonce pré-eligibility module — vérifier manuellement">88 j (LLM)</span>
  }
  if (det === true) {
    const cls = conf === 'high' ? 'text-green-700 bg-green-100' : 'text-amber-700 bg-amber-100'
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`} title={reason || ''}>88 j ✓</span>
  }
  if (det === null) {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title={reason || ''}>88 j ?</span>
  }
  return null // det === false → no badge to keep header clean
}

function PayBadge({ raw }: { raw: any }) {
  const status = raw.pay_status as string | undefined
  const gap = raw.pay_gap as number | undefined
  const minUsed = raw.award_min_casual_hourly ?? raw.award_min_hourly
  if (!status || status === 'unknown') return null
  if (status === 'below') {
    return <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded"
      title={`Sous le minimum award ${minUsed}$/h (écart ${gap}$/h)`}>$ &lt; award</span>
  }
  if (status === 'piece_rate') {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
      title="Pay au piecework — comparaison automatique impossible">piecework</span>
  }
  if (status === 'above' || status === 'at') {
    return <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded"
      title={`Min award: ${minUsed}$/h`}>$ ≥ award</span>
  }
  return null
}

function EligibilityPanel({ raw }: { raw: any }) {
  if (raw.eligibility_88_days === undefined && !raw.award_id) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-white border border-stone-200 rounded p-2">
      <Field label="Postcode" value={raw.postcode ?? null} />
      <Field label="Industrie 88j" value={raw.industry} />
      <Field label="Confiance" value={raw.eligibility_confidence} />
      <Field label="Award" value={raw.award_id ? `${raw.award_id}${raw.award_name ? ' · ' + raw.award_name : ''}` : null} />
      <Field label="Min FT $/h" value={raw.award_min_hourly ? `${raw.award_min_hourly}` : null} />
      <Field label="Min casual $/h" value={raw.award_min_casual_hourly ? `${raw.award_min_casual_hourly}` : null} />
      <Field label="Pay parsed $/h" value={raw.pay_parsed_hourly ? `${raw.pay_parsed_hourly} (${raw.pay_kind})` : null} />
      <Field label="Pay status" value={raw.pay_status} />
      <Field label="Gap" value={raw.pay_gap !== null && raw.pay_gap !== undefined ? `${raw.pay_gap}$/h (${raw.pay_gap_pct}%)` : null} />
    </div>
  )
}

function NotesPanel({ raw }: { raw: any }) {
  const notes: string[] = Array.isArray(raw.extraction_notes) ? raw.extraction_notes : []
  if (notes.length === 0) return null
  return (
    <div>
      <div className="text-[10px] font-semibold text-stone-500 uppercase mb-1">Notes d'extraction</div>
      <ul className="text-xs text-stone-800 bg-white border border-stone-200 rounded p-2 space-y-1">
        {notes.map((n, i) => (
          <li key={i} className="flex gap-2">
            <span className="text-stone-400 flex-shrink-0">•</span>
            <span className="whitespace-pre-wrap">{n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function RejectMenu({ onPick, disabled }: { onPick: (reason: string) => void; disabled: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 text-red-900 transition disabled:opacity-50"
      >
        Rejeter ▾
      </button>
      {open && (
        <div className="absolute z-10 mt-1 right-0 bg-white border border-stone-200 rounded-lg shadow-lg w-44 py-1">
          {REJECT_REASONS.map(r => (
            <button
              key={r}
              onClick={() => { setOpen(false); onPick(r) }}
              className="w-full text-left px-3 py-1.5 text-xs hover:bg-stone-50 transition"
            >
              {r}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function SourceTextPanel({ raw }: { raw: any }) {
  const [open, setOpen] = useState(false)
  const text: string = raw._source_text || ''
  if (!text) return null
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[10px] font-semibold text-purple-700 hover:text-purple-900 underline mb-1"
      >
        {open ? '− Cacher' : '+ Voir'} le texte source ({text.length} caractères) — comparer à l'extraction IA
      </button>
      {open && (
        <div className="text-[11px] text-stone-700 bg-white border border-stone-200 rounded p-2 max-h-64 overflow-y-auto whitespace-pre-wrap font-mono">
          {text}
        </div>
      )}
    </div>
  )
}

function QualityBadges({ raw }: { raw: any }) {
  const desc = String(raw.description || '')
  const pay = String(raw.pay || '').trim()
  const state = raw.state
  // Any of: email, AU mobile (04xx), whatsapp, French "appeler" stem, or any URL/web link.
  // A URL counts as contact because most government/aggregator postings link out to an apply portal.
  const hasContact = /(?:[\w.+-]+@[\w-]+\.[\w.-]+|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\bwhatsapp\b|\bappel\w*\b|https?:\/\/\S+|\bwww\.\S+)/i.test(desc)
  const issues: { label: string; cls: string; title: string }[] = []
  if (desc.length < 150) issues.push({ label: 'Description courte', cls: 'text-amber-700 bg-amber-100', title: `${desc.length} caractères — vérifie qu'il ne manque rien` })
  if (!pay) issues.push({ label: 'Pay manquant', cls: 'text-amber-700 bg-amber-100', title: 'Aucun salaire indiqué' })
  if (!state) issues.push({ label: 'State manquant', cls: 'text-red-700 bg-red-100', title: "Bloque l'approbation — édite la candidature pour préciser" })
  if (!hasContact) issues.push({ label: 'Pas de contact', cls: 'text-amber-700 bg-amber-100', title: 'Aucun email/téléphone détecté dans la description' })
  if (issues.length === 0) return null
  return (
    <>
      {issues.map(iss => (
        <span key={iss.label} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${iss.cls}`} title={iss.title}>{iss.label}</span>
      ))}
    </>
  )
}

function EditCandidateForm({
  raw,
  saving,
  error,
  onCancel,
  onSave,
  onSaveAndApprove,
}: {
  raw: any
  saving: boolean
  error: string | null
  onCancel: () => void
  onSave: (fields: Partial<EditFields>) => void
  onSaveAndApprove: (fields: Partial<EditFields>) => void
}) {
  const [form, setForm] = useState<EditFields>({
    title: raw.title || '',
    company: raw.company || '',
    state: raw.state || '',
    location: raw.location || '',
    category: raw.category || '',
    type: raw.type || 'casual',
    pay: raw.pay || '',
    description: raw.description || '',
    applyUrl: raw.applyUrl || '',
    eligible88Days: !!raw.eligible88Days,
  })
  const set = <K extends keyof EditFields>(k: K, v: EditFields[K]) => setForm(p => ({ ...p, [k]: v }))

  return (
    <div className="space-y-3">
      <div className="text-[10px] font-semibold text-purple-700 uppercase">
        Édition — toute modification déclenche une re-vérification (88j + award)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldInput label="Titre" value={form.title} onChange={v => set('title', v)} required />
        <FieldInput label="Entreprise" value={form.company} onChange={v => set('company', v)} required />
        <FieldSelect label="State" value={form.state} options={['', ...VALID_STATES]} onChange={v => set('state', v)} />
        <FieldInput label="Lieu (ville/postcode)" value={form.location} onChange={v => set('location', v)} />
        <FieldSelect label="Catégorie" value={form.category} options={['', ...VALID_CATEGORIES]} onChange={v => set('category', v)} />
        <FieldSelect label="Type" value={form.type} options={VALID_TYPES} onChange={v => set('type', v)} />
        <FieldInput label="Pay" value={form.pay} onChange={v => set('pay', v)} placeholder="$28/hr — vide si non indiqué" />
        <FieldInput label="Apply URL" value={form.applyUrl} onChange={v => set('applyUrl', v)} placeholder="(optionnel)" />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-stone-500 uppercase">Description</label>
        <textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          rows={8}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs focus:outline-none focus:border-purple-500 whitespace-pre-wrap"
        />
        <div className="text-[11px] text-stone-500 mt-1">{form.description.length} caractères</div>
      </div>
      <label className="flex items-center gap-2 text-xs text-stone-700">
        <input type="checkbox" checked={form.eligible88Days} onChange={e => set('eligible88Days', e.target.checked)} />
        <span>88 jours éligible (sera ré-évalué via postcode si possible)</span>
      </label>
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-200 hover:bg-stone-300 text-stone-900 transition disabled:opacity-50"
        >
          {saving ? '…' : 'Enregistrer (re-vérifier)'}
        </button>
        <button
          onClick={() => onSaveAndApprove(form)}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
        >
          {saving ? '…' : 'Enregistrer + Approuver'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-stone-300 hover:bg-stone-50 text-stone-700 transition disabled:opacity-50"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

function FieldInput({ label, value, onChange, required, placeholder }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; placeholder?: string }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-stone-500 uppercase">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs focus:outline-none focus:border-purple-500"
      />
    </div>
  )
}

function FieldSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <div>
      <label className="text-[10px] font-semibold text-stone-500 uppercase">{label}</label>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="mt-1 w-full px-3 py-1.5 rounded-lg border border-stone-300 bg-white text-xs focus:outline-none focus:border-purple-500"
      >
        {options.map(o => (
          <option key={o} value={o}>{o || '—'}</option>
        ))}
      </select>
    </div>
  )
}
