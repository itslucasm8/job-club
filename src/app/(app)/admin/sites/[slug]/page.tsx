'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

type Rule = {
  id: string
  kind: 'css_selector' | 'regex'
  expression: string
  successCount: number
  failureCount: number
  status: 'candidate' | 'active'
  source: 'observed' | 'llm_proposed'
  scope: 'site' | 'source'
  createdAt: string
  promotedAt?: string
  lastFiredAt?: string
}

type SiteDetail = {
  slug: string
  label: string
  version: number
  updatedAt: string
  fieldRules: Partial<Record<'title'|'company'|'pay'|'location'|'description', Rule[]>>
  ignorePatterns: string[]
  knownErrors: { pattern: string; diagnosis: string; action: string }[]
  layoutFingerprint: { hash: string; capturedAt: string } | null
  memberSources: { slug: string; label: string; enabled: boolean; healthStatus: string | null; lastRunAt: string | null; totalApproved: number }[]
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function SiteDetailPage({ params }: { params: { slug: string } }) {
  const slug = params.slug
  const [site, setSite] = useState<SiteDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/admin/sites/${encodeURIComponent(slug)}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setSite)
      .catch(e => setError(e.message))
  }, [slug])

  if (error) return <div className="max-w-3xl mx-auto px-3 py-4 text-xs text-red-600">{error}</div>
  if (!site) return <div className="max-w-3xl mx-auto px-3 py-4 text-xs text-stone-500">Chargement…</div>

  return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <div className="mb-4">
        <Link href="/admin/sites" className="text-xs text-purple-600 hover:underline">← Sites partagés</Link>
        <h1 className="text-lg font-extrabold text-stone-900">{site.label}</h1>
        <div className="text-[11px] text-stone-500 font-mono">{site.slug} • v{site.version} • MAJ {fmtDate(site.updatedAt)}</div>
      </div>

      {/* Member sources */}
      <div className="mb-5">
        <h2 className="text-sm font-bold text-stone-900 mb-2">{site.memberSources.length} sources membres</h2>
        <div className="space-y-1">
          {site.memberSources.map(s => (
            <Link
              key={s.slug}
              href={`/admin/sources/${s.slug}`}
              className="flex items-center justify-between p-2 bg-white border border-stone-200 rounded-lg hover:border-purple-300 text-xs"
            >
              <div>
                <span className="font-bold text-stone-900">{s.label}</span>
                <span className="ml-2 text-[10px] text-stone-400 font-mono">{s.slug}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px] text-stone-500">
                <span className={s.enabled ? 'text-green-600' : 'text-stone-400'}>{s.enabled ? 'actif' : 'désactivé'}</span>
                <span className="tabular-nums">{s.totalApproved} approuvées</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      {/* Field rules */}
      <div className="mb-5">
        <h2 className="text-sm font-bold text-stone-900 mb-2">Règles d'extraction</h2>
        {(['title','company','pay','location','description'] as const).map(field => {
          const rules = site.fieldRules[field] ?? []
          return (
            <div key={field} className="p-2 mb-2 bg-white border border-stone-200 rounded-lg">
              <div className="text-[11px] font-bold text-stone-700 mb-1 capitalize">{field}</div>
              {rules.length === 0 ? (
                <div className="text-[11px] text-stone-400 italic">Aucune règle apprise.</div>
              ) : (
                <ul className="space-y-1">
                  {rules.map(r => {
                    const total = r.successCount + r.failureCount
                    const hitRate = total > 0 ? Math.round((r.successCount / total) * 100) : null
                    return (
                      <li key={r.id} className="flex items-center gap-2 text-[11px]">
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-stone-200 text-stone-600'}`}>
                          {r.status}
                        </span>
                        <span className="text-stone-400 text-[9px] uppercase">{r.kind === 'css_selector' ? 'css' : 'regex'}</span>
                        <code className="font-mono text-stone-800 truncate flex-1">{r.expression}</code>
                        <span className="text-stone-500 tabular-nums whitespace-nowrap">
                          {hitRate !== null ? `${hitRate}% • ${r.successCount}/${total}` : 'jamais déclenchée'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )
        })}
      </div>

      {/* Ignore patterns + known errors + fingerprint */}
      <div className="space-y-3">
        {site.ignorePatterns.length > 0 && (
          <div className="p-2 bg-white border border-stone-200 rounded-lg">
            <div className="text-[11px] font-bold text-stone-700 mb-1">Patterns ignorés</div>
            <ul className="text-[11px] font-mono text-stone-700 space-y-0.5">
              {site.ignorePatterns.map((p, i) => <li key={i}>{p}</li>)}
            </ul>
          </div>
        )}
        {site.knownErrors.length > 0 && (
          <div className="p-2 bg-white border border-stone-200 rounded-lg">
            <div className="text-[11px] font-bold text-stone-700 mb-1">Erreurs connues</div>
            <ul className="text-[11px] space-y-0.5">
              {site.knownErrors.map((e, i) => (
                <li key={i}>
                  <span className="font-mono text-stone-800">{e.pattern}</span>
                  <span className="text-stone-500"> → {e.diagnosis} ({e.action})</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {site.layoutFingerprint && (
          <div className="text-[10px] text-stone-400 font-mono">
            Empreinte page: {site.layoutFingerprint.hash}
            {' • capturée '}{fmtDate(site.layoutFingerprint.capturedAt)}
          </div>
        )}
      </div>
    </div>
  )
}
