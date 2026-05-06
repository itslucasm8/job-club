'use client'
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import ManualPublishForm from '@/components/ManualPublishForm'

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
  { key: 'pending', label: 'Pending' },
  { key: 'auto_rejected', label: 'Auto-rejected' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
]

const REJECT_REASONS = [
  'Locals only',
  'Not WHV-friendly',
  'Suspected scam',
  'Not enough info',
  'Duplicate',
  'Out of geo',
  'Wrong category',
  'Other',
]

// Score a candidate for the "approve-first" sort. Higher = more attractive
// to approve. We surface easy wins (clean data + good signals) at the top so
// the team can blast through them, and push junky/risky ones to the bottom.
function approvalScore(c: Candidate): number {
  const raw = c.rawData || {}
  const score = c.classifierScore || {}
  let s = 0
  // 88-day signal
  if (raw.eligibility_88_days === true) {
    s += raw.eligibility_confidence === 'high' ? 3 : 2
  } else if (raw.eligibility_88_days === null) {
    s += 0 // unknown: neutral
  } else if (raw.eligibility_88_days === false) {
    s -= 1
  }
  // Pay vs award
  if (raw.pay_status === 'above' || raw.pay_status === 'at') s += 1
  else if (raw.pay_status === 'below') s -= 2
  // Required-data presence
  if (raw.state) s += 1
  if (String(raw.description || '').length >= 150) s += 1
  if (String(raw.pay || '').trim()) s += 1
  // Classifier red flags
  if (score.is_backpacker_suitable === false) s -= 3
  if (score.has_scam_red_flags) s -= 3
  if (score.has_locals_only_red_flag) s -= 2
  return s
}

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function AdminCandidatesPage() {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const router = useRouter()
  const sourceFilter = searchParams.get('source') || ''

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
  const [importerOpen, setImporterOpen] = useState(false)
  const [sortMode, setSortMode] = useState<'smart' | 'newest' | 'oldest'>('smart')

  // Bulk-action state
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkActing, setBulkActing] = useState<{ phase: 'approving' | 'rejecting'; done: number; total: number } | null>(null)
  // Per-row failure list from the most recent bulk action. Cleared on the
  // next bulk action; admin sees what specifically failed instead of just a
  // count alert.
  const [bulkErrors, setBulkErrors] = useState<{ id: string; title: string; reason: string }[]>([])

  // Manual publish modal — replaces the standalone /admin/publish page in the
  // daily flow. Sources are the primary intake; this is the escape hatch.
  const [manualOpen, setManualOpen] = useState(false)

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
        setEditError(data.error || 'Error')
        return false
      }
      if (data.candidate) updateCandidateLocally(data.candidate)
      return true
    } catch (e: any) {
      setEditError(e?.message || 'Network error')
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
        const counts = (data as BulkResult).counts
        if (counts.extraction_failed === 0 && counts.error === 0) {
          setBulkUrls('')
        } else {
          const failedUrls = (data as BulkResult).results
            .filter(r => r.status === 'extraction_failed' || r.status === 'error')
            .map(r => r.url)
          setBulkUrls(failedUrls.join('\n'))
        }
        fetchCandidates()
      } else {
        setBulkResult({
          counts: { inserted: 0, duplicate: 0, extraction_failed: 0, error: 1 },
          results: [{ url: '(batch)', status: 'error', error: data.error || 'Error' }],
          processed: 0,
        })
      }
    } catch (e: any) {
      setBulkResult({
        counts: { inserted: 0, duplicate: 0, extraction_failed: 0, error: 1 },
        results: [{ url: '(batch)', status: 'error', error: e?.message || 'Network error' }],
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
      if (sourceFilter) params.set('source', sourceFilter)
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
  }, [status, search, sourceFilter])

  useEffect(() => { fetchCandidates() }, [fetchCandidates])

  // Reset selection when the underlying list changes (filter/search/source).
  useEffect(() => { setSelected(new Set()) }, [status, sourceFilter])

  async function approve(id: string) {
    setActingId(id)
    try {
      const res = await fetch(`/api/admin/candidates/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
      if (res.ok) {
        setCandidates(c => c.filter(x => x.id !== id))
        setStatusCounts(prev => ({ ...prev, pending: Math.max(0, (prev.pending || 0) - 1), approved: (prev.approved || 0) + 1 }))
      } else {
        const err = await res.json().catch(() => ({}))
        alert(err.error || 'Error')
      }
    } finally { setActingId(null) }
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
        alert('Error')
      }
    } finally { setActingId(null) }
  }

  // Bulk approve. Sequential so the live counter is accurate and we don't
  // hammer the approve endpoint (each approval does Job creation +
  // notifications matching, which isn't free).
  async function bulkApprove() {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Approve ${ids.length} candidate${ids.length > 1 ? 's' : ''}? This publishes them to the live feed.`)) return
    setBulkActing({ phase: 'approving', done: 0, total: ids.length })
    setBulkErrors([])
    const errors: { id: string; title: string; reason: string }[] = []
    let okCount = 0
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const c = candidates.find(x => x.id === id)
      const title = (c?.rawData as any)?.title || id
      try {
        const res = await fetch(`/api/admin/candidates/${id}/approve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
        if (res.ok) okCount++
        else {
          const data = await res.json().catch(() => ({}))
          errors.push({ id, title, reason: data?.error || `HTTP ${res.status}` })
        }
      } catch (e: any) {
        errors.push({ id, title, reason: e?.message || 'Network error' })
      }
      setBulkActing(prev => prev ? { ...prev, done: i + 1 } : prev)
    }
    setBulkActing(null)
    setSelected(new Set())
    setBulkErrors(errors)
    await fetchCandidates()
  }

  async function bulkReject(reason: string) {
    const ids = Array.from(selected)
    if (ids.length === 0) return
    if (!confirm(`Reject ${ids.length} candidate${ids.length > 1 ? 's' : ''} with reason "${reason}"?`)) return
    setBulkActing({ phase: 'rejecting', done: 0, total: ids.length })
    setBulkErrors([])
    const errors: { id: string; title: string; reason: string }[] = []
    let okCount = 0
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]
      const c = candidates.find(x => x.id === id)
      const title = (c?.rawData as any)?.title || id
      try {
        const res = await fetch(`/api/admin/candidates/${id}/reject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason }),
        })
        if (res.ok) okCount++
        else {
          const data = await res.json().catch(() => ({}))
          errors.push({ id, title, reason: data?.error || `HTTP ${res.status}` })
        }
      } catch (e: any) {
        errors.push({ id, title, reason: e?.message || 'Network error' })
      }
      setBulkActing(prev => prev ? { ...prev, done: i + 1 } : prev)
    }
    setBulkActing(null)
    setSelected(new Set())
    setBulkErrors(errors)
    await fetchCandidates()
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
          setImportMessage(`✓ Imported: ${data.raw?.title || ''}`)
          setImportUrl('')
          setImportPasteText('')
          setImportPasteOpen(false)
          fetchCandidates()
        }
      } else {
        setImportMessage(`✗ ${data.error || 'Error'}`)
      }
    } catch (e: any) {
      setImportMessage(`✗ ${e?.message || 'Network error'}`)
    } finally {
      setImporting(false)
    }
  }

  function clearSourceFilter() {
    const params = new URLSearchParams(searchParams.toString())
    params.delete('source')
    const qs = params.toString()
    router.replace(`/admin/candidates${qs ? '?' + qs : ''}`)
  }

  const sorted = useMemo(() => {
    const list = [...candidates]
    if (sortMode === 'smart' && status === 'pending') {
      list.sort((a, b) => approvalScore(b) - approvalScore(a))
    } else if (sortMode === 'newest' || (sortMode === 'smart' && status !== 'pending' && status !== 'auto_rejected')) {
      list.sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    } else {
      list.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))
    }
    return list
  }, [candidates, sortMode, status])

  const allVisibleSelected = sorted.length > 0 && sorted.every(c => selected.has(c.id))
  const someSelected = selected.size > 0

  function toggleAllVisible() {
    if (allVisibleSelected) {
      const next = new Set(selected)
      for (const c of sorted) next.delete(c.id)
      setSelected(next)
    } else {
      const next = new Set(selected)
      for (const c of sorted) next.add(c.id)
      setSelected(next)
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">Unauthorized</p></div>
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-6xl">
      <div className="flex items-baseline justify-between mb-1">
        <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900">Candidates</h1>
        <button
          onClick={() => setManualOpen(true)}
          className="px-3 py-1.5 rounded-md text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white transition"
        >
          + Post job manually
        </button>
      </div>
      <p className="text-sm text-stone-500 mb-4">Listings collected from sources, waiting for review.</p>

      {sourceFilter && (
        <div className="mb-4 flex items-center gap-2 text-xs bg-purple-50 border border-purple-200 rounded-lg px-3 py-2">
          <span className="text-purple-900">
            Filtered to source: <code className="font-mono font-bold">{sourceFilter}</code>
          </span>
          <button onClick={clearSourceFilter} className="ml-auto text-purple-700 hover:text-purple-900 font-semibold">
            Clear filter ✕
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={() => setImporterOpen(o => !o)}
        className="mb-4 text-xs font-bold text-stone-700 hover:text-stone-900"
      >
        {importerOpen ? '▾' : '▸'} Manual import (single URL or paste batch)
      </button>

      {importerOpen && (
        <>
          <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
            <div className="text-xs font-bold text-purple-900 mb-2">Import a listing by URL</div>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                type="url"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                placeholder="https://… (listing URL)"
                className="flex-1 px-3 py-2 rounded-lg border border-purple-300 bg-white text-sm focus:outline-none focus:border-purple-500"
                onKeyDown={e => { if (e.key === 'Enter' && !importPasteOpen) importFromUrl() }}
              />
              <button
                onClick={importFromUrl}
                disabled={importing || !importUrl.trim()}
                className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50 whitespace-nowrap"
              >
                {importing ? 'Extracting…' : 'Extract (AI)'}
              </button>
            </div>
            <button
              type="button"
              onClick={() => setImportPasteOpen(o => !o)}
              className="mt-2 text-[11px] font-semibold text-purple-700 hover:text-purple-900 underline"
            >
              {importPasteOpen ? '− Close pasted text' : '+ Paste page text directly (for Gumtree, Seek, blocked sites)'}
            </button>
            {importPasteOpen && (
              <div className="mt-2">
                <textarea
                  value={importPasteText}
                  onChange={e => setImportPasteText(e.target.value)}
                  rows={6}
                  placeholder="Paste the listing text here (Ctrl+A then Ctrl+C on the Gumtree/Seek page). The URL above is kept as a reference."
                  className="w-full px-3 py-2 rounded-lg border border-purple-300 bg-white text-xs focus:outline-none focus:border-purple-500"
                />
                <div className="text-[11px] text-purple-700 mt-1">
                  {importPasteText.length} chars {importPasteText.length >= 200 ? '✓' : '(min 200 to use pasted text)'}
                </div>
              </div>
            )}
            {importMessage && (
              <div className="mt-2 text-xs text-purple-900">{importMessage}</div>
            )}
          </div>

          <div className="mb-5 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <button
              type="button"
              onClick={() => setBulkOpen(o => !o)}
              className="w-full flex items-center justify-between text-xs font-bold text-orange-900 hover:text-orange-950 transition"
            >
              <span>Bulk URL import ({parseBulkUrls(bulkUrls).length} ready)</span>
              <span className="text-orange-600">{bulkOpen ? '−' : '+'}</span>
            </button>
            {bulkOpen && (
              <div className="mt-2">
                <textarea
                  value={bulkUrls}
                  onChange={e => setBulkUrls(e.target.value)}
                  rows={5}
                  placeholder={'Paste multiple URLs (one per line, spaces or commas allowed). Max 30 per batch.\n\nExample:\nhttps://www.backpackerjobboard.com.au/job/123\nhttps://workforceaustralia.gov.au/individuals/jobs/details/789'}
                  className="w-full px-3 py-2 rounded-lg border border-orange-300 bg-white text-xs font-mono focus:outline-none focus:border-orange-500"
                />
                <div className="flex flex-wrap gap-2 items-center mt-2">
                  <button
                    onClick={importBulk}
                    disabled={bulkImporting || parseBulkUrls(bulkUrls).length === 0}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-orange-600 hover:bg-orange-700 text-white transition disabled:opacity-50"
                  >
                    {bulkImporting ? `Processing ${parseBulkUrls(bulkUrls).length} URLs… (1-2 min)` : `Import ${parseBulkUrls(bulkUrls).length} URLs`}
                  </button>
                  <span className="text-[11px] text-orange-700">
                    Doesn&apos;t work for Gumtree/Seek (datacenter blocked) — use the extension for those.
                  </span>
                </div>
                {bulkResult && (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-2 text-[11px] font-semibold">
                      {bulkResult.counts.inserted > 0 && (
                        <span className="px-2 py-1 rounded bg-green-100 text-green-800">✓ {bulkResult.counts.inserted} imported</span>
                      )}
                      {bulkResult.counts.duplicate > 0 && (
                        <span className="px-2 py-1 rounded bg-stone-200 text-stone-700">{bulkResult.counts.duplicate} duplicate</span>
                      )}
                      {bulkResult.counts.extraction_failed > 0 && (
                        <span className="px-2 py-1 rounded bg-amber-100 text-amber-800">⚠ {bulkResult.counts.extraction_failed} extraction failed</span>
                      )}
                      {bulkResult.counts.error > 0 && (
                        <span className="px-2 py-1 rounded bg-red-100 text-red-800">✗ {bulkResult.counts.error} error</span>
                      )}
                    </div>
                    <details className="text-[11px]">
                      <summary className="cursor-pointer text-orange-800 font-semibold">Per-URL detail</summary>
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
                              {r.status === 'inserted' && (r.title?.slice(0, 40) || 'imported')}
                              {r.status === 'duplicate' && `duplicate (${r.reason})`}
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
        </>
      )}

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

      {/* Search + sort */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by title, company, location…"
          className="flex-1 min-w-[200px] px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
        />
        <select
          value={sortMode}
          onChange={e => setSortMode(e.target.value as any)}
          className="px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
          title="Sort order"
        >
          <option value="smart">Smart sort (best first)</option>
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </select>
      </div>

      {/* Per-row failures from the most recent bulk action. Shown until the
          next bulk action clears it or the user dismisses. */}
      {bulkErrors.length > 0 && (
        <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-xs font-bold text-red-800">
            <span>{bulkErrors.length} action{bulkErrors.length > 1 ? 's' : ''} failed</span>
            <div className="flex-1" />
            <button onClick={() => setBulkErrors([])} className="text-red-700 hover:text-red-900">Dismiss</button>
          </div>
          <ul className="mt-1 space-y-0.5 text-[11px] text-red-900 max-h-40 overflow-y-auto">
            {bulkErrors.map((e) => (
              <li key={e.id} className="flex gap-2">
                <span className="truncate flex-1 font-semibold">{e.title}</span>
                <span className="text-red-700">{e.reason.slice(0, 80)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Bulk action bar — sticky */}
      {someSelected && (
        <div className="mb-3 sticky top-0 z-10 bg-purple-50 border border-purple-200 rounded-lg px-3 py-2 flex items-center gap-2 shadow-sm flex-wrap">
          <span className="text-xs font-bold text-purple-900">{selected.size} selected</span>
          <div className="flex-1" />
          {bulkActing ? (
            <span className="text-xs text-purple-800">
              {bulkActing.phase === 'approving' ? 'Approving' : 'Rejecting'} {bulkActing.done}/{bulkActing.total}…
            </span>
          ) : (
            <>
              <button
                onClick={bulkApprove}
                disabled={status !== 'pending' && status !== 'auto_rejected'}
                className="px-3 py-1 rounded text-xs font-bold bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
              >
                ✓ Approve {selected.size}
              </button>
              <BulkRejectMenu onPick={bulkReject} disabled={status !== 'pending' && status !== 'auto_rejected'} count={selected.size} />
              <button
                onClick={() => setSelected(new Set())}
                className="text-xs text-stone-600 hover:text-stone-900"
              >
                Clear
              </button>
            </>
          )}
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-stone-500">Loading…</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 text-stone-500">No candidates in this tab.</div>
      ) : (
        <>
          {(status === 'pending' || status === 'auto_rejected') && (
            <div className="mb-2 flex items-center gap-2 text-[11px] text-stone-600">
              <input
                type="checkbox"
                checked={allVisibleSelected}
                onChange={toggleAllVisible}
                className="w-3.5 h-3.5 rounded border-stone-400 cursor-pointer"
                aria-label="Select all visible"
              />
              <span>Select all visible ({sorted.length})</span>
            </div>
          )}
          <div className="space-y-2">
            {sorted.map(c => {
              const raw = (c.rawData as any) || {}
              const score = (c.classifierScore as any) || null
              const expanded = expandedId === c.id
              const checked = selected.has(c.id)
              const selectable = status === 'pending' || status === 'auto_rejected'
              return (
                <div key={c.id} className={`bg-white border rounded-lg overflow-hidden ${checked ? 'border-purple-300 bg-purple-50/30' : 'border-stone-200'}`}>
                  <div className="flex items-start gap-2 px-3 py-2.5">
                    {selectable && (
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleOne(c.id)}
                        onClick={e => e.stopPropagation()}
                        className="w-3.5 h-3.5 mt-1 rounded border-stone-400 cursor-pointer flex-shrink-0"
                        aria-label={`Select ${raw.title || 'candidate'}`}
                      />
                    )}
                    <button
                      onClick={() => setExpandedId(expanded ? null : c.id)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-bold text-stone-900 truncate">{raw.title || '(no title)'}</div>
                          <div className="text-xs text-stone-600 truncate">
                            {raw.company || '?'} · {raw.location || raw.state || '?'}
                            {raw.pay && <span className="text-stone-700"> · {raw.pay}</span>}
                          </div>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-stone-500 bg-stone-100 px-1.5 py-0.5 rounded">{c.source}</span>
                            <span className="text-[10px] text-stone-400">captured {timeAgo(c.createdAt)}</span>
                            {raw.postedAt && (
                              <span className="text-[10px] text-stone-500 italic" title={`Posted on FB: ${raw.postedAt}`}>
                                · posted {String(raw.postedAt).slice(0, 28)}
                              </span>
                            )}
                            <EligibilityBadge raw={raw} />
                            <PayBadge raw={raw} />
                            {/* Quality + classifier badges only when expanded — keep collapsed rows scannable */}
                            {expanded && <QualityBadges raw={raw} />}
                            {expanded && score?.has_locals_only_red_flag && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">Locals only</span>}
                            {expanded && score?.has_scam_red_flags && <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded">⚠ scam</span>}
                            {expanded && score?.is_backpacker_suitable === false && <span className="text-[10px] font-semibold text-stone-700 bg-stone-200 px-1.5 py-0.5 rounded">Not WHV</span>}
                          </div>
                        </div>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-stone-400 transition-transform flex-shrink-0 mt-1 ${expanded ? 'rotate-180' : ''}`}>
                          <path d="M6 9l6 6 6-6"/>
                        </svg>
                      </div>
                    </button>
                  </div>

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
                            <Field label="Category" value={raw.category} />
                            <Field label="Type" value={raw.type} />
                            <Field label="Pay" value={raw.pay} />
                            <Field label="State" value={raw.state} />
                          </div>
                          <EligibilityPanel raw={raw} />
                          <div>
                            <div className="text-[10px] font-semibold text-stone-500 uppercase mb-1">Description</div>
                            <div className="text-xs text-stone-800 bg-white border border-stone-200 rounded p-2 max-h-48 overflow-y-auto whitespace-pre-wrap">
                              {raw.description || '(empty)'}
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
                                  Edit
                                </button>
                                <button
                                  onClick={() => approve(c.id)}
                                  disabled={actingId === c.id}
                                  className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
                                >
                                  {actingId === c.id ? '…' : 'Approve'}
                                </button>
                                <RejectMenu onPick={(reason) => reject(c.id, reason)} disabled={actingId === c.id} />
                              </>
                            )}
                          </div>
                          {c.rejectReason && (
                            <div className="text-xs text-stone-600">
                              <span className="font-semibold">Reason: </span>{c.rejectReason}
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
        </>
      )}

      {manualOpen && (
        <ManualPublishModal
          onClose={() => setManualOpen(false)}
          onPublished={() => { setManualOpen(false); fetchCandidates() }}
        />
      )}
    </div>
  )
}

function ManualPublishModal({ onClose, onPublished }: { onClose: () => void; onPublished: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl my-8"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-stone-200">
          <div>
            <div className="text-base font-extrabold text-stone-900">Post a job manually</div>
            <div className="text-xs text-stone-500">Bypasses the candidate queue — publishes straight to the live feed.</div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-stone-100 text-stone-500 hover:text-stone-900 transition flex items-center justify-center"
            aria-label="Close"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="w-4 h-4">
              <path d="M6 6l12 12 M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div className="px-5 py-4">
          <ManualPublishForm onPublished={onPublished} onCancel={onClose} />
        </div>
      </div>
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
  const det = raw.eligibility_88_days
  const conf = raw.eligibility_confidence as 'high' | 'medium' | 'low' | undefined
  const reason = raw.eligibility_reason as string | undefined
  if (det === undefined && raw.eligible88Days) {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title="Pre-eligibility-module listing — verify manually">88 days (LLM)</span>
  }
  if (det === true) {
    const cls = conf === 'high' ? 'text-green-700 bg-green-100' : 'text-amber-700 bg-amber-100'
    return <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${cls}`} title={reason || ''}>88 days ✓</span>
  }
  if (det === null) {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded" title={reason || ''}>88 days ?</span>
  }
  return null
}

function PayBadge({ raw }: { raw: any }) {
  const status = raw.pay_status as string | undefined
  const gap = raw.pay_gap as number | undefined
  const minUsed = raw.award_min_casual_hourly ?? raw.award_min_hourly
  if (!status || status === 'unknown') return null
  if (status === 'below') {
    return <span className="text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded"
      title={`Below award minimum ${minUsed}/hr (gap ${gap}/hr)`}>$ &lt; award</span>
  }
  if (status === 'piece_rate') {
    return <span className="text-[10px] font-semibold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded"
      title="Piecework pay — automatic comparison not possible">piecework</span>
  }
  if (status === 'above' || status === 'at') {
    return <span className="text-[10px] font-semibold text-green-700 bg-green-100 px-1.5 py-0.5 rounded"
      title={`Award min: ${minUsed}/hr`}>$ ≥ award</span>
  }
  return null
}

function EligibilityPanel({ raw }: { raw: any }) {
  if (raw.eligibility_88_days === undefined && !raw.award_id) return null
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs bg-white border border-stone-200 rounded p-2">
      <Field label="Postcode" value={raw.postcode ?? null} />
      <Field label="88-day industry" value={raw.industry} />
      <Field label="Confidence" value={raw.eligibility_confidence} />
      <Field label="Award" value={raw.award_id ? `${raw.award_id}${raw.award_name ? ' · ' + raw.award_name : ''}` : null} />
      <Field label="Min FT $/hr" value={raw.award_min_hourly ? `${raw.award_min_hourly}` : null} />
      <Field label="Min casual $/hr" value={raw.award_min_casual_hourly ? `${raw.award_min_casual_hourly}` : null} />
      <Field label="Pay parsed $/hr" value={raw.pay_parsed_hourly ? `${raw.pay_parsed_hourly} (${raw.pay_kind})` : null} />
      <Field label="Pay status" value={raw.pay_status} />
      <Field label="Gap" value={raw.pay_gap !== null && raw.pay_gap !== undefined ? `${raw.pay_gap}/hr (${raw.pay_gap_pct}%)` : null} />
    </div>
  )
}

function NotesPanel({ raw }: { raw: any }) {
  const notes: string[] = Array.isArray(raw.extraction_notes) ? raw.extraction_notes : []
  if (notes.length === 0) return null
  return (
    <div>
      <div className="text-[10px] font-semibold text-stone-500 uppercase mb-1">Extraction notes</div>
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
        Reject ▾
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

function BulkRejectMenu({ onPick, disabled, count }: { onPick: (reason: string) => void; disabled: boolean; count: number }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        disabled={disabled}
        className="px-3 py-1 rounded text-xs font-bold bg-red-100 hover:bg-red-200 text-red-900 disabled:opacity-50"
      >
        ✕ Reject {count} ▾
      </button>
      {open && (
        <div className="absolute z-20 mt-1 right-0 bg-white border border-stone-200 rounded-lg shadow-lg w-44 py-1">
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
        {open ? '− Hide' : '+ Show'} source text ({text.length} chars) — compare against AI extraction
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
  const hasContact = /(?:[\w.+-]+@[\w-]+\.[\w.-]+|\b04\d{2}[\s-]?\d{3}[\s-]?\d{3}\b|\bwhatsapp\b|\bcall\w*\b|https?:\/\/\S+|\bwww\.\S+)/i.test(desc)
  const issues: { label: string; cls: string; title: string }[] = []
  if (desc.length < 150) issues.push({ label: 'Short description', cls: 'text-amber-700 bg-amber-100', title: `${desc.length} chars — verify nothing's missing` })
  if (!pay) issues.push({ label: 'Pay missing', cls: 'text-amber-700 bg-amber-100', title: 'No salary listed' })
  if (!state) issues.push({ label: 'State missing', cls: 'text-red-700 bg-red-100', title: "Blocks approval — edit the candidate to set state" })
  if (!hasContact) issues.push({ label: 'No contact', cls: 'text-amber-700 bg-amber-100', title: 'No email/phone detected in the description' })
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
        Edit — any change re-runs verification (88 days + award)
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FieldInput label="Title" value={form.title} onChange={v => set('title', v)} required />
        <FieldInput label="Company" value={form.company} onChange={v => set('company', v)} required />
        <FieldSelect label="State" value={form.state} options={['', ...VALID_STATES]} onChange={v => set('state', v)} />
        <FieldInput label="Location (city/postcode)" value={form.location} onChange={v => set('location', v)} />
        <FieldSelect label="Category" value={form.category} options={['', ...VALID_CATEGORIES]} onChange={v => set('category', v)} />
        <FieldSelect label="Type" value={form.type} options={VALID_TYPES} onChange={v => set('type', v)} />
        <FieldInput label="Pay" value={form.pay} onChange={v => set('pay', v)} placeholder="$28/hr — leave blank if not stated" />
        <FieldInput label="Apply URL" value={form.applyUrl} onChange={v => set('applyUrl', v)} placeholder="(optional)" />
      </div>
      <div>
        <label className="text-[10px] font-semibold text-stone-500 uppercase">Description</label>
        <textarea
          value={form.description}
          onChange={e => set('description', e.target.value)}
          rows={8}
          className="mt-1 w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs focus:outline-none focus:border-purple-500 whitespace-pre-wrap"
        />
        <div className="text-[11px] text-stone-500 mt-1">{form.description.length} chars</div>
      </div>
      <label className="flex items-center gap-2 text-xs text-stone-700">
        <input type="checkbox" checked={form.eligible88Days} onChange={e => set('eligible88Days', e.target.checked)} />
        <span>88 days eligible (re-evaluated via postcode if possible)</span>
      </label>
      {error && <div className="text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">{error}</div>}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => onSave(form)}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-stone-200 hover:bg-stone-300 text-stone-900 transition disabled:opacity-50"
        >
          {saving ? '…' : 'Save (re-verify)'}
        </button>
        <button
          onClick={() => onSaveAndApprove(form)}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
        >
          {saving ? '…' : 'Save + Approve'}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-stone-300 hover:bg-stone-50 text-stone-700 transition disabled:opacity-50"
        >
          Cancel
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
