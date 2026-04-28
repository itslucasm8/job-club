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
