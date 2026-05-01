'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

type ExtensionRun = {
  id: string
  startedAt: string
  completedAt: string | null
  totalPosts: number
  totalErrors: number
  groupRuns: { sourceSlug: string; postsCaptured: number; scrollDuration?: number; error?: string }[] | null
  triggeredBy: string | null
  errorMessage: string | null
}

type Summary = {
  runsLast7Days: number
  postsLast7Days: number
  errorsLast7Days: number
  groupCount: number
  enabledGroupCount: number
  lastRunAt: string | null
  lastRunCompletedAt: string | null
}

function fmtTime(s: string | null): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' })
}

function timeAgo(s: string | null): string {
  if (!s) return '—'
  const diff = Date.now() - new Date(s).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "à l'instant"
  if (mins < 60) return `${mins} min`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours} h`
  return `${Math.floor(hours / 24)} j`
}

export default function ExtensionsPage() {
  const { data: session } = useSession()
  const [runs, setRuns] = useState<ExtensionRun[]>([])
  const [summary, setSummary] = useState<Summary | null>(null)
  const [hasToken, setHasToken] = useState(false)
  const [revealedToken, setRevealedToken] = useState<string | null>(null)
  const [tokenMsg, setTokenMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    const [runsRes, tokRes] = await Promise.all([
      fetch('/api/admin/extension/runs'),
      fetch('/api/admin/extension/token'),
    ])
    if (runsRes.ok) {
      const d = await runsRes.json()
      setRuns(d.runs || [])
      setSummary(d.summary || null)
    }
    if (tokRes.ok) {
      const d = await tokRes.json()
      setHasToken(!!d.hasToken)
    }
  }

  useEffect(() => { load() }, [])

  async function generateToken() {
    if (hasToken && !confirm('Régénérer remplacera l\'ancien token. L\'extension installée arrêtera de fonctionner jusqu\'à mise à jour. Continuer ?')) return
    setBusy(true)
    setTokenMsg(null)
    setRevealedToken(null)
    try {
      const res = await fetch('/api/admin/extension/token', { method: 'POST' })
      const d = await res.json()
      if (!res.ok) {
        setTokenMsg(`✗ ${d?.error || 'Erreur'}`)
      } else {
        setRevealedToken(d.token)
        setHasToken(true)
        setTokenMsg(d.message || 'Token généré')
      }
    } catch (e: any) {
      setTokenMsg(`✗ ${e?.message || 'Erreur réseau'}`)
    } finally {
      setBusy(false)
    }
  }

  async function revokeToken() {
    if (!confirm('Révoquer le token ? L\'extension installée arrêtera immédiatement de fonctionner.')) return
    setBusy(true)
    try {
      const res = await fetch('/api/admin/extension/token', { method: 'DELETE' })
      if (res.ok) {
        setHasToken(false)
        setRevealedToken(null)
        setTokenMsg('Token révoqué')
      }
    } finally {
      setBusy(false)
    }
  }

  if (!session) return <div className="p-6">Chargement…</div>
  if ((session.user as any).role !== 'admin') return <div className="p-6">Accès admin requis</div>

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl md:text-2xl font-extrabold text-stone-900">Extension navigateur</h1>
        <div className="flex gap-3 text-xs">
          <Link href="/admin/extensions/captures" className="text-purple-700 hover:text-purple-900 underline">
            Voir captures brutes →
          </Link>
          <Link href="/admin/sources?sheetTab=facebook" className="text-purple-700 hover:text-purple-900 underline">
            Gérer les groupes FB →
          </Link>
        </div>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded p-3 text-xs text-amber-900">
        Cette extension Chrome tourne sur l'ordinateur de bureau et scrape les groupes Facebook configurés
        deux fois par jour. Les posts arrivent comme candidats normaux dans <Link href="/admin/candidates" className="underline">/admin/candidates</Link>.
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card label="Dernier run" value={timeAgo(summary?.lastRunAt || null)} hint={summary?.lastRunCompletedAt ? `terminé ${timeAgo(summary.lastRunCompletedAt)}` : 'en cours…'} />
        <Card label="Runs (7 j)" value={summary?.runsLast7Days ?? 0} />
        <Card label="Posts capturés (7 j)" value={summary?.postsLast7Days ?? 0} />
        <Card label="Groupes configurés" value={`${summary?.enabledGroupCount ?? 0} / ${summary?.groupCount ?? 0}`} hint="actifs / total" />
      </div>

      {/* Token management */}
      <section className="bg-white border border-stone-200 rounded-lg p-4 space-y-3">
        <h2 className="text-sm font-bold text-stone-800">Token d'authentification</h2>
        <p className="text-xs text-stone-600">
          L'extension utilise ce token pour s'authentifier auprès de Job Club. Générez-le, copiez-le dans
          la page d'options de l'extension, puis sauvegardez. Il ne sera affiché qu'une seule fois.
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={generateToken}
            disabled={busy}
            className="px-3 py-1.5 rounded text-xs font-bold bg-stone-900 hover:bg-stone-800 text-white disabled:opacity-50"
          >
            {hasToken ? '↻ Régénérer le token' : '✨ Générer un token'}
          </button>
          {hasToken && (
            <button
              onClick={revokeToken}
              disabled={busy}
              className="px-3 py-1.5 rounded text-xs font-bold bg-red-100 hover:bg-red-200 text-red-800 disabled:opacity-50"
            >
              ✗ Révoquer
            </button>
          )}
          <span className="text-[11px] text-stone-500">
            {hasToken ? '🔒 Un token est actuellement actif' : '⚠ Pas de token actif'}
          </span>
        </div>
        {revealedToken && (
          <div className="bg-green-50 border border-green-300 rounded p-2 space-y-1">
            <div className="text-[11px] font-bold text-green-800">Copiez maintenant — il ne sera plus affiché :</div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-[11px] font-mono bg-white p-1.5 border border-green-200 rounded break-all">{revealedToken}</code>
              <button
                onClick={() => navigator.clipboard.writeText(revealedToken)}
                className="px-2 py-1 rounded text-[11px] font-bold bg-green-600 hover:bg-green-700 text-white"
              >
                Copier
              </button>
            </div>
          </div>
        )}
        {tokenMsg && !revealedToken && <div className="text-[11px] text-stone-700">{tokenMsg}</div>}
      </section>

      {/* Recent runs */}
      <section className="bg-white border border-stone-200 rounded-lg p-4">
        <h2 className="text-sm font-bold text-stone-800 mb-3">Runs récents</h2>
        {runs.length === 0 ? (
          <p className="text-xs text-stone-500 italic">Aucun run enregistré pour le moment. L'extension n'a pas encore tourné.</p>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-stone-500">
              <tr>
                <th className="text-left py-1">Démarré</th>
                <th className="text-left py-1">Durée</th>
                <th className="text-right py-1">Posts</th>
                <th className="text-right py-1">Groupes</th>
                <th className="text-left py-1">Trigger</th>
                <th className="text-left py-1">Statut</th>
              </tr>
            </thead>
            <tbody>
              {runs.map(r => {
                const dur = r.completedAt ? Math.round((new Date(r.completedAt).getTime() - new Date(r.startedAt).getTime()) / 1000) : null
                const groups = (r.groupRuns || []).length
                const status = r.errorMessage ? '✗ erreur' : r.completedAt ? '✓ ok' : '⌛ en cours'
                return (
                  <tr key={r.id} className="border-t border-stone-100 hover:bg-stone-50">
                    <td className="py-1">{fmtTime(r.startedAt)}</td>
                    <td className="py-1 tabular-nums">{dur != null ? `${dur} s` : '—'}</td>
                    <td className="py-1 text-right tabular-nums">{r.totalPosts}</td>
                    <td className="py-1 text-right tabular-nums">{groups}</td>
                    <td className="py-1">{r.triggeredBy || '—'}</td>
                    <td className="py-1">{status}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function Card({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="p-3 bg-white border border-stone-200 rounded-lg">
      <div className="text-[11px] text-stone-500 mb-0.5">{label}</div>
      <div className="text-xl font-extrabold tabular-nums text-stone-900">{value}</div>
      {hint && <div className="text-[10px] text-stone-500 mt-0.5">{hint}</div>}
    </div>
  )
}
