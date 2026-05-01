'use client'
import { useEffect, useMemo, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

type Capture = {
  id: string
  source: string
  sourceJobId: string
  sourceUrl: string
  html: string
  postedAt: string | null
  authorName: string | null
  scrapedAt: string
  ingestStatus: string
  failureReason: string | null
  extractionMode: string | null
  extractionResult: any
}

const STATUS_COLORS: Record<string, string> = {
  ingested: 'bg-green-100 text-green-800',
  duplicate: 'bg-blue-100 text-blue-800',
  extraction_failed: 'bg-amber-100 text-amber-800',
  error: 'bg-red-100 text-red-800',
}

const STATUS_LABELS: Record<string, string> = {
  ingested: '✓ Ingéré',
  duplicate: '⊙ Doublon',
  extraction_failed: '✗ Extraction échouée',
  error: '✗ Erreur',
}

function fmtTime(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

function timeAgo(s: string) {
  const diff = Date.now() - new Date(s).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} j`
}

function bytesLabel(n: number) {
  if (n < 1024) return `${n} B`
  return `${(n / 1024).toFixed(1)} KB`
}

export default function CapturesPage() {
  const { data: session, status } = useSession()
  const [captures, setCaptures] = useState<Capture[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('all')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  async function load() {
    setLoading(true)
    const url = new URL('/api/admin/extension/captures', window.location.origin)
    if (filter !== 'all') url.searchParams.set('status', filter)
    url.searchParams.set('limit', '100')
    const res = await fetch(url.toString())
    if (res.ok) {
      const d = await res.json()
      setCaptures(d.captures || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    if (session?.user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, filter])

  function toggle(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { ingested: 0, duplicate: 0, extraction_failed: 0, error: 0 }
    for (const cap of captures) c[cap.ingestStatus] = (c[cap.ingestStatus] || 0) + 1
    return c
  }, [captures])

  if (status === 'loading') return <div className="p-8 text-stone-500">Chargement…</div>
  if (!session?.user || (session.user as any).role !== 'admin') {
    return <div className="p-8 text-red-600">Accès refusé.</div>
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-stone-900">Captures de l'extension FB</h1>
          <p className="text-sm text-stone-600 mt-1">
            Tous les posts capturés par le scraper, succès et échecs.
            <Link href="/admin/extensions" className="ml-2 text-brand-purple hover:underline">← Tableau de bord</Link>
          </p>
        </div>
        <button onClick={load} className="px-3 py-2 bg-stone-900 text-white text-sm rounded hover:bg-stone-700">
          Actualiser
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {[
          { key: 'all', label: `Tous (${captures.length})` },
          { key: 'ingested', label: `✓ Ingérés (${counts.ingested || 0})` },
          { key: 'duplicate', label: `⊙ Doublons (${counts.duplicate || 0})` },
          { key: 'extraction_failed', label: `✗ Échec extraction (${counts.extraction_failed || 0})` },
          { key: 'error', label: `✗ Erreurs (${counts.error || 0})` },
        ].map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 text-sm rounded border ${
              filter === f.key
                ? 'bg-stone-900 text-white border-stone-900'
                : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-50'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {loading && <div className="text-stone-500 py-8 text-center">Chargement…</div>}
      {!loading && captures.length === 0 && (
        <div className="text-stone-500 py-8 text-center bg-white rounded border border-stone-200">
          Aucune capture pour le moment.
        </div>
      )}

      <div className="space-y-2">
        {captures.map(c => {
          const isOpen = expanded.has(c.id)
          return (
            <div key={c.id} className="bg-white border border-stone-200 rounded">
              <button
                onClick={() => toggle(c.id)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-stone-50"
              >
                <span className={`px-2 py-0.5 text-xs font-medium rounded ${STATUS_COLORS[c.ingestStatus] || 'bg-stone-100 text-stone-700'}`}>
                  {STATUS_LABELS[c.ingestStatus] || c.ingestStatus}
                </span>
                <span className="text-xs text-stone-500 font-mono">{c.source}</span>
                <span className="text-xs text-stone-500">·</span>
                <span className="text-sm font-medium text-stone-900 truncate flex-1">
                  {c.authorName || c.sourceJobId}
                </span>
                <span className="text-xs text-stone-500">{bytesLabel(c.html.length)}</span>
                <span className="text-xs text-stone-500">{timeAgo(c.scrapedAt)}</span>
                <span className="text-stone-400 text-xs">{isOpen ? '▼' : '▶'}</span>
              </button>

              {isOpen && (
                <div className="border-t border-stone-200 p-4 space-y-4">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <div className="text-stone-500">Post ID</div>
                      <div className="font-mono text-stone-800">{c.sourceJobId}</div>
                    </div>
                    <div>
                      <div className="text-stone-500">Capturé</div>
                      <div className="text-stone-800">{fmtTime(c.scrapedAt)}</div>
                    </div>
                    <div>
                      <div className="text-stone-500">Auteur</div>
                      <div className="text-stone-800">{c.authorName || '—'}</div>
                    </div>
                    <div>
                      <div className="text-stone-500">Posté à</div>
                      <div className="text-stone-800">{c.postedAt || '—'}</div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-stone-500">URL</div>
                      <a href={c.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-brand-purple hover:underline break-all font-mono">
                        {c.sourceUrl}
                      </a>
                    </div>
                    <div>
                      <div className="text-stone-500">Mode d'extraction</div>
                      <div className="text-stone-800">{c.extractionMode || '—'}</div>
                    </div>
                    <div>
                      <div className="text-stone-500">Taille HTML</div>
                      <div className="text-stone-800">{bytesLabel(c.html.length)}</div>
                    </div>
                  </div>

                  {c.failureReason && (
                    <div className="bg-amber-50 border border-amber-200 rounded p-3">
                      <div className="text-xs font-medium text-amber-900 mb-1">Raison de l'échec</div>
                      <div className="text-sm text-amber-800">{c.failureReason}</div>
                    </div>
                  )}

                  {c.extractionResult && (
                    <div>
                      <div className="text-xs font-medium text-stone-600 mb-1">Résultat de l'extraction</div>
                      <pre className="bg-stone-50 border border-stone-200 rounded p-3 text-xs overflow-x-auto max-h-60">
                        {JSON.stringify(c.extractionResult, null, 2)}
                      </pre>
                    </div>
                  )}

                  <div>
                    <div className="text-xs font-medium text-stone-600 mb-1">Aperçu rendu</div>
                    <iframe
                      srcDoc={`<html><head><meta charset="UTF-8"><base target="_blank"><style>body{font-family:-apple-system,sans-serif;padding:12px;margin:0;font-size:13px;line-height:1.5;color:#1c1917}img{max-width:100%;height:auto}a{color:#6b21a8}</style></head><body>${c.html}</body></html>`}
                      sandbox="allow-popups"
                      className="w-full h-96 border border-stone-200 rounded bg-white"
                      title="Capture preview"
                    />
                  </div>

                  <details>
                    <summary className="text-xs font-medium text-stone-600 cursor-pointer hover:text-stone-900">
                      HTML brut ({bytesLabel(c.html.length)})
                    </summary>
                    <pre className="mt-2 bg-stone-50 border border-stone-200 rounded p-3 text-xs overflow-x-auto max-h-96">
                      {c.html}
                    </pre>
                  </details>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
