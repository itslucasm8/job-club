'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'

type Source = {
  id: string
  slug: string
  label: string
  category: string
  enabled: boolean
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  totalSeen: number
  totalApproved: number
  totalRejected: number
}

export default function AdminSourcesPage() {
  const { data: session } = useSession()
  const [sources, setSources] = useState<Source[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/sources')
      .then(r => r.ok ? r.json() : [])
      .then(d => setSources(d || []))
      .finally(() => setLoading(false))
  }, [])

  function timeAgo(dateStr: string | null) {
    if (!dateStr) return '—'
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    return `${Math.floor(hours / 24)}j`
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">Non autorisé</p></div>
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-6xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Sources</h1>
      <p className="text-sm text-stone-500 mb-6">Rendement de chaque source d&apos;annonces.</p>

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
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Catégorie</th>
                <th className="text-center px-3 py-2 font-semibold text-stone-700">État</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Vues</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Approuvées</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Rejetées</th>
                <th className="text-right px-3 py-2 font-semibold text-stone-700">Taux</th>
                <th className="text-left px-3 py-2 font-semibold text-stone-700">Dernier run</th>
              </tr>
            </thead>
            <tbody>
              {sources.map(s => {
                const denom = s.totalApproved + s.totalRejected
                const approvalRate = denom > 0 ? Math.round((s.totalApproved / denom) * 100) : 0
                return (
                  <tr key={s.id} className="border-b border-stone-100 text-xs">
                    <td className="px-3 py-2">
                      <div className="font-bold text-stone-900">{s.label}</div>
                      <div className="text-[10px] text-stone-500 font-mono">{s.slug}</div>
                    </td>
                    <td className="px-3 py-2 text-stone-700">{s.category}</td>
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
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
