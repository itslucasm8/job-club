'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

type SiteSummary = {
  slug: string
  label: string
  version: number
  updatedAt: string
  memberCount: number
  ruleCount: number
  ignoreCount: number
  knownErrorCount: number
  memberSources: { slug: string; label: string; enabled: boolean }[]
  layoutFingerprint: { hash: string; capturedAt: string } | null
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function SitesIndexPage() {
  const [sites, setSites] = useState<SiteSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/sites')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setSites)
      .catch(e => setError(e.message))
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-3 py-4">
      <div className="mb-4">
        <Link href="/admin" className="text-xs text-purple-600 hover:underline">← Admin</Link>
        <h1 className="text-lg font-extrabold text-stone-900">Sites partagés</h1>
        <p className="text-xs text-stone-500 mt-0.5">
          Playbooks de site — chaque règle apprise ici bénéficie à toutes les sources membres.
        </p>
      </div>

      {error && <div className="text-xs text-red-600 mb-3">{error}</div>}
      {sites === null && !error && <div className="text-xs text-stone-500">Chargement…</div>}

      {sites && sites.length === 0 && (
        <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-500">
          Aucun site partagé pour l'instant.
        </div>
      )}

      <div className="space-y-3">
        {sites?.map(site => (
          <Link
            key={site.slug}
            href={`/admin/sites/${site.slug}`}
            className="block p-3 bg-white border border-stone-200 rounded-lg hover:border-purple-300 transition"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="font-bold text-stone-900 text-sm">{site.label}</div>
              <div className="text-[10px] text-stone-400 font-mono">v{site.version}</div>
            </div>
            <div className="text-[11px] text-stone-500 font-mono mb-2">{site.slug}</div>
            <div className="flex flex-wrap gap-3 text-[11px] text-stone-600">
              <span><b>{site.memberCount}</b> sources</span>
              <span><b>{site.ruleCount}</b> règles</span>
              <span><b>{site.ignoreCount}</b> patterns ignorés</span>
              <span><b>{site.knownErrorCount}</b> erreurs connues</span>
              <span className="text-stone-400">MAJ {fmtDate(site.updatedAt)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
