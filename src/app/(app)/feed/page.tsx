'use client'
import { useEffect, useState, useCallback, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { STATES, CATEGORIES } from '@/lib/utils'
import { useToast } from '@/components/Toast'
import JobCard from '@/components/JobCard'
import JobModal from '@/components/JobModal'
import JobCardSkeleton from '@/components/JobCardSkeleton'

export default function FeedPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center py-20"><div className="text-stone-400">Chargement...</div></div>}>
      <FeedContent />
    </Suspense>
  )
}

function FeedContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const { toast } = useToast()
  const [jobs, setJobs] = useState<any[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState(searchParams.get('q') || '')

  const state = searchParams.get('state') || 'all'
  const category = searchParams.get('category') || 'all'

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (state !== 'all') params.set('state', state)
      if (category !== 'all') params.set('category', category)
      if (query) params.set('q', query)
      const res = await fetch(`/api/jobs?${params}`)
      if (!res.ok) throw new Error('Fetch failed')
      const data = await res.json()
      setJobs(data.jobs || [])
    } catch {
      setJobs([])
    }
    setLoading(false)
  }, [state, category, query])

  useEffect(() => { fetchJobs() }, [fetchJobs])

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
        toast('error', 'Erreur lors de la sauvegarde')
        return
      }
      const data = await res.json()
      setSavedIds(prev => {
        const next = new Set(prev)
        if (data.saved) next.add(jobId); else next.delete(jobId)
        return next
      })
      toast('success', data.saved ? 'Offre sauvegardée' : 'Offre retirée')
    } catch {
      toast('error', 'Erreur réseau')
    }
  }

  // Debounced search
  useEffect(() => {
    const t = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString())
      if (query) params.set('q', query); else params.delete('q')
      router.push(`/feed?${params}`)
    }, 400)
    return () => clearTimeout(t)
  }, [query])

  return (
    <>
      {/* Search */}
      <div className="bg-white border-b border-stone-200 px-4 sm:px-5 lg:px-7 py-3">
        <div className="flex items-center gap-2.5 bg-stone-100 rounded-xl px-3.5 py-2.5 border border-stone-200 focus-within:border-purple-400 transition">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px] text-stone-400 flex-shrink-0"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/></svg>
          <input type="text" value={query} onChange={e => setQuery(e.target.value)} placeholder="Rechercher un job..."
            className="flex-1 bg-transparent outline-none text-sm text-stone-800 placeholder:text-stone-400" />
        </div>

        {/* State chips */}
        <div className="relative">
          <div className="flex gap-2 overflow-x-auto mt-2.5 pb-0.5 scrollbar-none">
            <Chip active={state === 'all'} onClick={() => updateFilter('state', 'all')}>Tous</Chip>
            {STATES.map(s => <Chip key={s.code} active={state === s.code} onClick={() => updateFilter('state', s.code)}>{s.code}</Chip>)}
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
        </div>

        {/* Category tabs */}
        <div className="relative">
          <div className="flex gap-1.5 overflow-x-auto mt-2 pb-0.5 scrollbar-none">
            {CATEGORIES.map(c => (
              <button key={c.key} onClick={() => updateFilter('category', c.key)}
                className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition whitespace-nowrap ${category === c.key ? 'bg-amber-400 text-stone-900 border-amber-400' : 'bg-stone-50 text-stone-500 border-stone-200 hover:border-purple-300'}`}>
                {c.label}
              </button>
            ))}
          </div>
          <div className="absolute right-0 top-0 bottom-0 w-8 bg-gradient-to-l from-white to-transparent pointer-events-none" />
        </div>
      </div>

      {/* Banner */}
      <div className="mx-4 sm:mx-5 lg:mx-7 mt-4 rounded-xl bg-gradient-to-br from-purple-900 via-purple-800 to-purple-600 p-5 sm:p-6 text-white flex items-center gap-4 overflow-hidden relative">
        <div className="absolute -right-8 -bottom-8 w-36 h-36 bg-white/5 rounded-full" />
        <div><h2 className="text-lg sm:text-xl font-extrabold mb-1">Bienvenue sur Job Club</h2><p className="text-xs sm:text-sm opacity-80">Les dernières offres d&apos;emploi pour backpackers en Australie</p></div>
        <span className="text-4xl sm:text-5xl flex-shrink-0">&#127462;&#127482;</span>
      </div>

      {/* Job Grid */}
      <div className="px-4 sm:px-5 lg:px-7 py-4 pb-24 lg:pb-10 grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))
        ) : jobs.length === 0 ? (
          <div className="col-span-full text-center py-16 text-stone-400">
            <p className="text-sm">Aucune offre trouvée. Essaie d&apos;autres filtres.</p>
          </div>
        ) : (
          jobs.map(job => (
            <JobCard key={job.id} job={job} saved={savedIds.has(job.id)} onSave={() => toggleSave(job.id)} onClick={() => setSelectedJob(job)} />
          ))
        )}
      </div>

      <JobModal job={selectedJob} saved={selectedJob ? savedIds.has(selectedJob.id) : false}
        onSave={() => { if (selectedJob) toggleSave(selectedJob.id) }}
        onClose={() => setSelectedJob(null)} />
    </>
  )
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`flex-shrink-0 px-3.5 py-1.5 rounded-full text-[13px] font-semibold border transition whitespace-nowrap ${active ? 'bg-purple-700 text-white border-purple-700' : 'bg-stone-100 text-stone-500 border-stone-200 hover:border-purple-400 hover:text-purple-700'}`}>
      {children}
    </button>
  )
}
