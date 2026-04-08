'use client'
import { useEffect, useState, useCallback, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { STATES, getCategories } from '@/lib/utils'
import { useTranslation } from '@/components/LanguageContext'
import { useToast } from '@/components/Toast'
import { usePostHog } from 'posthog-js/react'
import JobCard from '@/components/JobCard'
import JobModal from '@/components/JobModal'
import JobCardSkeleton from '@/components/JobCardSkeleton'

export default function FeedPage() {
  const { t } = useTranslation()
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="text-stone-400">{t.common.loading}</div></div>}>
      <FeedContent />
    </Suspense>
  )
}

interface FeedStats {
  newJobsToday: number
  savedCount: number
  savedIds: string[]
  preferredState: string | null
  stateCounts: Record<string, number>
}

function FeedContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const { t, language } = useTranslation()
  const categories = getCategories(language)
  const [jobs, setJobs] = useState<any[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(searchParams.get('q') || '')
  const [stats, setStats] = useState<FeedStats | null>(null)
  const [only88Days, setOnly88Days] = useState(false)
  const [page, setPage] = useState(1)
  const [pages, setPages] = useState(0)
  const [total, setTotal] = useState(0)
  const [loadingMore, setLoadingMore] = useState(false)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const loadingMoreRef = useRef(false)
  const posthog = usePostHog()

  const state = searchParams.get('state') || 'all'
  const category = searchParams.get('category') || 'all'

  // Fetch dashboard stats + saved IDs on mount
  useEffect(() => {
    fetch('/api/feed/stats')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data) {
          setStats(data)
          setSavedIds(new Set(data.savedIds || []))
        }
      })
      .catch(() => {})
  }, [])

  // Track successful subscription from Stripe redirect
  const subscribedTracked = useRef(false)
  useEffect(() => {
    if (searchParams.get('subscribed') === 'true' && posthog && !subscribedTracked.current) {
      subscribedTracked.current = true
      posthog.capture('subscription_started')
    }
  }, [searchParams, posthog])

  const fetchJobs = useCallback(async (pageNum: number, append = false) => {
    if (pageNum === 1) setLoading(true)
    else { setLoadingMore(true); loadingMoreRef.current = true }

    try {
      const params = new URLSearchParams()
      if (state !== 'all') params.set('state', state)
      if (category !== 'all') params.set('category', category)
      if (query) params.set('q', query)
      if (only88Days) params.set('eligible88Days', 'true')
      params.set('page', String(pageNum))

      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error('Fetch failed')
      const data = await res.json()

      // Track search/filter usage (only on fresh searches, not pagination)
      if (pageNum === 1 && posthog) {
        if (query) posthog.capture('search_performed', { query })
        if (state !== 'all' || category !== 'all' || only88Days) {
          posthog.capture('filter_applied', {
            state: state !== 'all' ? state : undefined,
            category: category !== 'all' ? category : undefined,
            only88Days: only88Days || undefined,
          })
        }
      }

      if (append) {
        setJobs(prev => [...prev, ...(data.jobs || [])])
      } else {
        setJobs(data.jobs || [])
      }
      setPage(data.page || pageNum)
      setPages(data.pages || 0)
      setTotal(data.total || 0)
    } catch {
      if (!append) setJobs([])
    }

    if (pageNum === 1) setLoading(false)
    else { setLoadingMore(false); loadingMoreRef.current = false }
  }, [state, category, query, only88Days, posthog])

  useEffect(() => {
    setJobs([])
    setPage(1)
    setPages(0)
    setTotal(0)
    window.scrollTo(0, 0)
    fetchJobs(1, false)
  }, [fetchJobs])

  // Infinite scroll: observe sentinel to load next page
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel) return

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && page < pages && !loadingMoreRef.current) {
          fetchJobs(page + 1, true)
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [page, pages, fetchJobs])

  function updateFilter(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString())
    if (value === 'all') params.delete(key)
    else params.set(key, value)
    router.push(`/feed?${params}`)
  }

  async function toggleSave(jobId: string) {
    try {
      const res = await fetch(`/api/jobs/${jobId}/save`, { method: 'POST' })
      if (!res.ok) {
        toast('error', t.feed.saveError)
        return
      }
      const data = await res.json()
      setSavedIds(prev => {
        const next = new Set(prev)
        if (data.saved) next.add(jobId); else next.delete(jobId)
        return next
      })
      setStats(prev => prev ? { ...prev, savedCount: prev.savedCount + (data.saved ? 1 : -1) } : prev)
      toast('success', data.saved ? t.feed.jobSaved : t.feed.jobRemoved)
    } catch {
      toast('error', t.common.networkError)
    }
  }

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) params.set('q', query); else params.delete('q')
      router.push(`/feed?${params}`)
    }, 400)
    return () => clearTimeout(timer)
  }, [query])

  return (
    <div className="min-h-screen bg-warm-bg">
      {/* Dashboard Stats Strip */}
      <div className="px-4 sm:px-5 lg:px-7 pt-4 pb-2">
        <div className="grid grid-cols-3 gap-2.5 sm:gap-3">
          {/* New today */}
          <div className="rounded-[14px] bg-gradient-to-br from-purple-50 via-purple-50 to-purple-100/80 border border-purple-200/60 p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-extrabold text-purple-700">
              {stats?.newJobsToday ?? '\u2014'}
            </div>
            <div className="text-[10px] sm:text-xs font-medium text-purple-600/70 mt-0.5 leading-tight">
              {t.feed.newToday}
            </div>
          </div>

          {/* Saved — clickable to /saved */}
          <Link href="/saved" className="rounded-[14px] bg-gradient-to-br from-amber-50 via-amber-50 to-amber-100/80 border border-amber-200/60 p-3 sm:p-4 hover:shadow-md transition-shadow group">
            <div className="text-2xl sm:text-3xl font-extrabold text-amber-700 group-hover:text-amber-800 transition-colors">
              {stats?.savedCount ?? '\u2014'}
            </div>
            <div className="text-[10px] sm:text-xs font-medium text-amber-600/70 mt-0.5 leading-tight">
              {t.feed.savedJobs}
            </div>
          </Link>

          {/* Preferred state */}
          <div className="rounded-[14px] bg-gradient-to-br from-emerald-50 via-emerald-50 to-emerald-100/80 border border-emerald-200/60 p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700">
              {stats?.preferredState || '\u2014'}
            </div>
            <div className="text-[10px] sm:text-xs font-medium text-emerald-600/70 mt-0.5 leading-tight">
              {t.feed.preferredState}
            </div>
          </div>
        </div>
      </div>

      {/* Sticky Search & Filters */}
      <div className="sticky top-[60px] z-30 bg-warm-bg border-b border-stone-200/80 px-4 sm:px-5 lg:px-7 py-3 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
        {/* Search bar */}
        <div className="flex items-center gap-2.5 bg-white rounded-xl px-3.5 py-2.5 border border-stone-200 focus-within:border-purple-400 focus-within:ring-2 focus-within:ring-purple-100 transition">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-stone-400 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder={t.feed.searchPlaceholder}
            className="flex-1 bg-transparent outline-none text-sm text-stone-800 placeholder:text-stone-400" />
        </div>

        {/* State chips */}
        <div className="relative">
          <div className="flex gap-2 overflow-x-auto mt-2.5 pb-0.5 scrollbar-none">
            <Chip active={state === 'all'} onClick={() => updateFilter('state', 'all')}>{t.common.all}</Chip>
            {STATES.map(s => <Chip key={s.code} active={state === s.code} onClick={() => updateFilter('state', s.code)}>{s.code}</Chip>)}
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-warm-bg to-transparent pointer-events-none" />
        </div>

        {/* Category tabs */}
        <div className="relative">
          <div className="flex gap-1.5 overflow-x-auto mt-2 pb-0.5 scrollbar-none">
            {categories.map(c => (
              <button key={c.key} onClick={() => updateFilter('category', c.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition whitespace-nowrap ${category === c.key ? 'bg-amber-400 text-stone-900 border-amber-400' : 'bg-white text-stone-500 border-stone-200 hover:border-purple-300'}`}>
                {c.label}
              </button>
            ))}
            <button
              onClick={() => setOnly88Days(!only88Days)}
              className={`flex-shrink-0 px-3 py-1.5 rounded-[10px] text-[12px] font-semibold border transition whitespace-nowrap ${only88Days ? 'bg-yellow-400 text-stone-900 border-yellow-400' : 'bg-white text-stone-500 border-stone-200 hover:border-yellow-300'}`}
            >
              {t.feed.days88}
            </button>
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-warm-bg to-transparent pointer-events-none" />
        </div>
      </div>

      {/* Total count */}
      {!loading && total > 0 && (
        <div className="px-4 sm:px-5 lg:px-7 pt-3 pb-1">
          <p className="text-xs font-medium text-stone-400">{t.feed.jobCount(total)}</p>
        </div>
      )}

      {/* Job Grid */}
      <div className="px-4 sm:px-5 lg:px-7 py-4 grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))
        ) : jobs.length === 0 ? (
          <div className="col-span-full text-center py-16 text-stone-400">
            <p className="text-sm">{t.feed.noResults}</p>
          </div>
        ) : (
          jobs.map(job => (
            <JobCard key={job.id} job={job} saved={savedIds.has(job.id)} onSave={() => toggleSave(job.id)} onClick={() => setSelectedJob(job)} />
          ))
        )}
      </div>

      {/* Infinite scroll sentinel + loading more indicator */}
      {!loading && jobs.length > 0 && (
        <div className="pb-24 lg:pb-10">
          {loadingMore && (
            <div className="px-4 sm:px-5 lg:px-7 pb-4 grid gap-[18px] grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <JobCardSkeleton key={`more-${i}`} />
              ))}
            </div>
          )}
          {page >= pages && !loadingMore && (
            <div className="text-center py-6">
              <p className="text-sm text-stone-400">{t.feed.allLoaded}</p>
            </div>
          )}
          {page < pages && <div ref={sentinelRef} className="h-1" />}
        </div>
      )}

      <JobModal job={selectedJob} saved={selectedJob ? savedIds.has(selectedJob.id) : false}
        onSave={() => { if (selectedJob) toggleSave(selectedJob.id) }}
        onClose={() => setSelectedJob(null)} />
    </div>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-shrink-0 px-3.5 py-1.5 rounded-[10px] text-[13px] font-semibold border transition whitespace-nowrap ${active ? 'bg-purple-700 text-white border-purple-700' : 'bg-white text-stone-500 border-stone-200 hover:border-purple-400 hover:text-purple-700'}`}>
      {children}
    </button>
  )
}
