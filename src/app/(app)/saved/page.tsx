'use client'
import { useEffect, useState } from 'react'
import { useTranslation } from '@/components/LanguageContext'
import { useToast } from '@/components/Toast'
import JobCard from '@/components/JobCard'
import JobModal from '@/components/JobModal'
import JobCardSkeleton from '@/components/JobCardSkeleton'

export default function SavedPage() {
  const { t } = useTranslation()
  const { toast } = useToast()
  const [jobs, setJobs] = useState<any[]>([])
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set())
  const [selectedJob, setSelectedJob] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  const fetchSavedJobs = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/jobs/saved')
      if (!res.ok) throw new Error('Fetch failed')
      const data = await res.json()
      setJobs(data || [])
      setSavedIds(new Set((data || []).map((j: any) => j.id)))
    } catch {
      setJobs([])
    }
    setLoading(false)
  }

  useEffect(() => {
    fetchSavedJobs()
  }, [])

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
      if (!data.saved) {
        setJobs(prev => prev.filter(j => j.id !== jobId))
      }
      toast('success', data.saved ? t.feed.jobSaved : t.feed.jobRemoved)
    } catch {
      toast('error', t.common.networkError)
    }
  }

  return (
    <>
      {/* Header */}
      <div className="bg-white border-b border-stone-200 px-4 sm:px-5 lg:px-7 py-4">
        <h1 className="text-2xl font-extrabold text-stone-900">{t.saved.title}</h1>
      </div>

      {/* Job Grid */}
      <div className="px-4 sm:px-5 lg:px-7 py-4 pb-24 lg:pb-10 grid gap-4 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {loading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <JobCardSkeleton key={i} />
          ))
        ) : jobs.length === 0 ? (
          <div className="col-span-full text-center py-16">
            <div className="text-4xl mb-3">💔</div>
            <p className="text-stone-400">{t.saved.empty}</p>
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
