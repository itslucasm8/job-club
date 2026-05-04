'use client'
import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'

type SourcingRun = {
  id: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  startedAt: string
  completedAt: string | null
  totalSources: number
  processedSources: number
  totalListingsFound: number
  totalImported: number
  totalErrors: number
}

const POLL_MS = 5000
// How long to keep the "Done" banner visible after a run finishes, so the
// admin notices the result even if they were on a different page.
const DONE_LINGER_MS = 15000

/** Sticky bottom-of-screen banner that surfaces an in-flight sourcing run on
 *  every admin page except /admin/sources (where the full progress card
 *  already lives). Polls every 5s while mounted. */
export default function RunStatusBanner() {
  const pathname = usePathname()
  const [run, setRun] = useState<SourcingRun | null>(null)
  const [doneAt, setDoneAt] = useState<number | null>(null)

  // Don't show on the catalog page (full card lives there) or outside /admin.
  const onSourcesPage = pathname === '/admin/sources'
  const onAdminPage = pathname?.startsWith('/admin') ?? false

  useEffect(() => {
    if (!onAdminPage) return
    let cancelled = false

    async function tick() {
      try {
        const res = await fetch('/api/admin/sources/runs')
        if (!res.ok) return
        const data = await res.json()
        const runs: SourcingRun[] = data.runs || []
        const active = runs.find(r => r.status === 'running' || r.status === 'pending') || null
        if (cancelled) return
        if (active) {
          setRun(active)
          setDoneAt(null)
        } else {
          // The most recent run, if it just completed, lingers briefly.
          const latest = runs[0]
          if (latest && (latest.status === 'completed' || latest.status === 'failed')) {
            // First time we see it as done → mark the linger start.
            setRun(prev => {
              if (!prev || prev.id !== latest.id) {
                setDoneAt(Date.now())
                return latest
              }
              if (prev.status === 'completed' || prev.status === 'failed') return prev
              setDoneAt(Date.now())
              return latest
            })
          }
        }
      } catch {/* swallow */}
    }

    tick()
    const id = setInterval(tick, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [onAdminPage])

  // Auto-clear the lingering "done" banner.
  useEffect(() => {
    if (!doneAt) return
    const id = setTimeout(() => setRun(null), DONE_LINGER_MS)
    return () => clearTimeout(id)
  }, [doneAt])

  if (!onAdminPage || onSourcesPage || !run) return null

  const isDone = run.status === 'completed' || run.status === 'failed'
  const pct = run.totalSources > 0 ? (run.processedSources / run.totalSources) * 100 : 0

  return (
    <div className="fixed bottom-3 left-3 right-3 sm:left-auto sm:right-4 sm:bottom-4 sm:max-w-md z-40">
      <div className={`rounded-lg shadow-lg border px-3 py-2 ${
        isDone && run.status === 'failed' ? 'bg-red-50 border-red-300' :
        isDone ? 'bg-green-50 border-green-300' :
        'bg-white border-purple-300'
      }`}>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-stone-900">
            {run.status === 'pending' && 'Starting scan…'}
            {run.status === 'running' && `Scanning ${run.processedSources}/${run.totalSources}`}
            {run.status === 'completed' && `✓ Scan done — ${run.totalImported} imported`}
            {run.status === 'failed' && `✗ Scan failed`}
          </span>
          <div className="flex-1" />
          <Link href="/admin/sources" className="text-purple-700 hover:underline font-semibold">
            View →
          </Link>
          {isDone && (
            <button onClick={() => setRun(null)} className="text-stone-400 hover:text-stone-700" aria-label="Dismiss">✕</button>
          )}
        </div>
        {!isDone && (
          <div className="mt-1.5 w-full h-1 bg-stone-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}
        {!isDone && (
          <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] font-semibold">
            <span className="px-1.5 py-0.5 rounded bg-stone-100 text-stone-700">{run.totalListingsFound} seen</span>
            <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-800">{run.totalImported} imported</span>
            {run.totalErrors > 0 && (
              <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-800">{run.totalErrors} errors</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
