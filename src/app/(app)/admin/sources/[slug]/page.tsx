'use client'
import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import Link from 'next/link'

type SourceDetail = {
  id: string
  slug: string
  label: string
  category: string
  enabled: boolean
  adapter: string | null
  config: any
  healthStatus: string | null
  consecutiveFailures: number
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
  totalSeen: number
  totalApproved: number
  totalRejected: number
  createdAt: string
}

type Analytics = {
  slug: string
  label: string
  summary: { total: number; pending: number; approved: number; rejected: number; auto_rejected: number; duplicate: number }
  last30Days: { total: number; pending: number; approved: number; rejected: number; auto_rejected: number; duplicate: number }
  approvalRate: number | null
  avgListingsPerRun: number | null
  daily: Array<{ date: string; count: number }>
  recentRuns: Array<{
    startedAt: string
    status: 'ok' | 'error' | 'skipped'
    listingsFound: number
    listingsNew: number
    imported: number
    duplicates: number
    errors: number
    durationMs: number
    errorMessage?: string
  }>
}

type CandidatePreview = {
  id: string
  rawData: any
  status: string
  createdAt: string
}

const HEALTH_PILL: Record<string, { label: string, className: string }> = {
  working: { label: 'Working', className: 'bg-green-100 text-green-700' },
  partial: { label: 'Partial', className: 'bg-orange-100 text-orange-800' },
  broken: { label: 'Broken', className: 'bg-red-100 text-red-700' },
  unverified: { label: 'Untested', className: 'bg-amber-100 text-amber-800' },
  disabled: { label: 'Disabled', className: 'bg-stone-100 text-stone-500' },
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—'
  return new Date(s).toLocaleString('en-AU', { dateStyle: 'short', timeStyle: 'short' })
}

function timeAgo(dateStr: string | null): string {
  if (!dateStr) return '—'
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

export default function SourceDetailPage({ params }: { params: { slug: string } }) {
  const { data: session } = useSession()
  const slug = params.slug
  const [source, setSource] = useState<SourceDetail | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [recentCandidates, setRecentCandidates] = useState<CandidatePreview[]>([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function load() {
    setLoading(true)
    setError(null)
    try {
      const [srcRes, anRes, candRes] = await Promise.all([
        fetch(`/api/admin/sources`).then(r => r.ok ? r.json() : null),
        fetch(`/api/admin/sources/${encodeURIComponent(slug)}/analytics`),
        fetch(`/api/admin/candidates?source=${encodeURIComponent(slug)}&status=pending`),
      ])
      if (Array.isArray(srcRes)) {
        const found = srcRes.find((s: SourceDetail) => s.slug === slug)
        if (!found) {
          setNotFound(true)
          return
        }
        setSource(found)
      }
      if (anRes.ok) {
        setAnalytics(await anRes.json())
      } else if (anRes.status === 404) {
        setNotFound(true)
      } else {
        setError(`Analytics: HTTP ${anRes.status}`)
      }
      if (candRes.ok) {
        const data = await candRes.json()
        setRecentCandidates((data.candidates || []).slice(0, 5))
        setPendingCount(data.total || 0)
      }
    } catch (e: any) {
      setError(e?.message || 'Network error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug])

  async function toggleEnabled() {
    if (!source) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/sources/${encodeURIComponent(slug)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !source.enabled }),
      })
      if (res.ok) await load()
      else alert((await res.json().catch(() => ({}))).error || `Error ${res.status}`)
    } finally {
      setBusy(false)
    }
  }

  async function runNow() {
    setBusy(true)
    try {
      const res = await fetch('/api/admin/sources/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slugs: [slug] }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        alert(d?.error || `Error ${res.status}`)
      } else {
        // Bounce back to the catalog page where the run progress card lives.
        window.location.href = '/admin/sources'
      }
    } finally {
      setBusy(false)
    }
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 py-5"><p className="text-stone-500">Unauthorized</p></div>
  }

  if (loading) return <div className="px-4 py-12 text-center text-stone-500">Loading…</div>
  if (notFound) return (
    <div className="px-4 py-12 text-center">
      <p className="text-stone-500 mb-3">Source not found.</p>
      <Link href="/admin/sources" className="text-purple-700 hover:underline text-sm">← Back to sources</Link>
    </div>
  )
  if (error || !source || !analytics) return (
    <div className="px-4 py-12 text-center">
      <p className="text-red-600 mb-3">Error: {error || 'missing data'}</p>
      <Link href="/admin/sources" className="text-purple-700 hover:underline text-sm">← Back to sources</Link>
    </div>
  )

  const maxDaily = Math.max(1, ...analytics.daily.map(d => d.count))
  const healthMeta = source.healthStatus && HEALTH_PILL[source.healthStatus]

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-5xl">
      <Link href="/admin/sources" className="text-xs text-stone-500 hover:text-stone-900 mb-2 inline-block">← Back to sources</Link>

      <div className="mb-5 flex flex-wrap items-start gap-3">
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 break-words">{source.label}</h1>
          <div className="flex flex-wrap gap-1.5 items-center text-[11px] mt-1.5">
            <span className="font-mono text-stone-500">{source.slug}</span>
            {healthMeta && (
              <span className={`px-2 py-0.5 rounded-full font-bold ${healthMeta.className}`}>
                {healthMeta.label}
                {source.consecutiveFailures > 0 && ` · ${source.consecutiveFailures} fails`}
              </span>
            )}
            <span className={`px-2 py-0.5 rounded-full font-semibold ${
              source.enabled ? 'bg-green-50 text-green-700' : 'bg-stone-200 text-stone-600'
            }`}>
              {source.enabled ? 'Enabled' : 'Disabled'}
            </span>
            {source.adapter && <span className="px-2 py-0.5 rounded bg-stone-100 text-stone-700 font-mono">{source.adapter}</span>}
          </div>
          {source.lastRunError && (
            <div className="mt-2 text-[11px] text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1 max-w-2xl">
              Last error: {source.lastRunError}
            </div>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={toggleEnabled}
            disabled={busy}
            className="px-3 py-1.5 rounded-md text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-700 transition disabled:opacity-50"
          >
            {source.enabled ? 'Disable' : 'Enable'}
          </button>
          {source.adapter && (
            <button
              onClick={runNow}
              disabled={busy}
              className="px-3 py-1.5 rounded-md text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50"
            >
              ▶ Run now
            </button>
          )}
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard label="Imported (30d)" value={analytics.last30Days.total} />
        <StatCard label="Approved (30d)" value={analytics.last30Days.approved} className="text-green-700" />
        <StatCard
          label="Approval rate"
          value={analytics.approvalRate != null ? `${Math.round(analytics.approvalRate * 100)}%` : '—'}
        />
        <StatCard
          label="Avg listings / run"
          value={analytics.avgListingsPerRun != null ? analytics.avgListingsPerRun : '—'}
        />
      </div>

      <div className="mb-5 p-3 bg-white border border-stone-200 rounded-lg">
        <div className="text-xs font-bold text-stone-700 mb-2">Imports — last 14 days</div>
        <div className="flex items-end gap-0.5 h-16">
          {analytics.daily.map(d => {
            const pct = (d.count / maxDaily) * 100
            return (
              <div
                key={d.date}
                title={`${d.date}: ${d.count} imported`}
                className="flex-1 bg-purple-100 hover:bg-purple-200 rounded-t transition"
                style={{ height: `${Math.max(2, pct)}%`, minHeight: '2px' }}
              />
            )
          })}
        </div>
        <div className="flex justify-between text-[9px] text-stone-400 mt-1 font-mono">
          <span>{analytics.daily[0]?.date}</span>
          <span>{analytics.daily[analytics.daily.length - 1]?.date}</span>
        </div>
      </div>

      <div className="mb-5">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-stone-900">
            Pending candidates from this source ({pendingCount})
          </h2>
          {pendingCount > 0 && (
            <Link
              href={`/admin/candidates?source=${encodeURIComponent(slug)}`}
              className="text-xs text-purple-700 hover:underline"
            >
              Review all →
            </Link>
          )}
        </div>
        {recentCandidates.length === 0 ? (
          <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-500">
            No pending candidates from this source.
          </div>
        ) : (
          <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
            {recentCandidates.map(c => {
              const raw = c.rawData || {}
              return (
                <div key={c.id} className="px-3 py-2 border-b border-stone-100 last:border-0 text-xs hover:bg-stone-50/60">
                  <div className="font-bold text-stone-900 truncate">{raw.title || '(no title)'}</div>
                  <div className="text-[11px] text-stone-500 truncate">
                    {raw.company || '(no company)'}
                    {raw.location && <span> · {raw.location}</span>}
                    {raw.state && <span> · {raw.state}</span>}
                    <span className="ml-1 text-stone-400">· {timeAgo(c.createdAt)}</span>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="mb-5">
        <h2 className="text-sm font-bold text-stone-900 mb-2">Last 10 runs</h2>
        {analytics.recentRuns.length === 0 ? (
          <div className="p-3 bg-stone-50 border border-stone-200 rounded-lg text-xs text-stone-500">
            No runs recorded for this source yet.
          </div>
        ) : (
          <div className="overflow-x-auto bg-white border border-stone-200 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-stone-200 text-[11px]">
                  <th className="text-left px-3 py-2 font-semibold text-stone-700">When</th>
                  <th className="text-center px-3 py-2 font-semibold text-stone-700">Status</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Seen</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">New</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Imported</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Errors</th>
                  <th className="text-right px-3 py-2 font-semibold text-stone-700">Duration</th>
                  <th className="text-left px-3 py-2 font-semibold text-stone-700">Error</th>
                </tr>
              </thead>
              <tbody>
                {analytics.recentRuns.map((r, i) => (
                  <tr key={i} className="border-b border-stone-100">
                    <td className="px-3 py-1.5 text-stone-700">{timeAgo(r.startedAt)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={r.status === 'ok' ? 'text-green-700' : 'text-red-600'}>
                        {r.status === 'ok' ? '✓' : '✗'} {r.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{r.listingsFound}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-blue-700">{r.listingsNew}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-green-700">{r.imported}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-red-600">{r.errors}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-stone-500">{Math.round(r.durationMs / 1000)}s</td>
                    <td className="px-3 py-1.5 text-red-600 max-w-md truncate">{r.errorMessage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="text-[11px] text-stone-400">
        Created {fmtDate(source.createdAt)}
        {source.lastRunAt && <> · Last run {fmtDate(source.lastRunAt)}</>}
      </div>
    </div>
  )
}

function StatCard({ label, value, className }: { label: string; value: string | number; className?: string }) {
  return (
    <div className="p-3 bg-white border border-stone-200 rounded-lg">
      <div className="text-[11px] text-stone-500 mb-0.5">{label}</div>
      <div className={`text-xl font-extrabold tabular-nums ${className || 'text-stone-900'}`}>{value}</div>
    </div>
  )
}
