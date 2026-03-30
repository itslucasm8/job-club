'use client'
import { useEffect, useRef } from 'react'
import { catLabel, typeLabel, timeAgo } from '@/lib/utils'

interface Job {
  id: string; title: string; company: string; state: string; location: string;
  category: string; type: string; pay: string | null; description: string;
  createdAt: string;
}

const tagColor: Record<string, string> = {
  farm: 'bg-green-100 text-green-800',
  hospitality: 'bg-blue-100 text-blue-800',
  construction: 'bg-amber-100 text-amber-800',
  trade: 'bg-orange-100 text-orange-800',
  retail: 'bg-pink-100 text-pink-800',
  cleaning: 'bg-indigo-100 text-indigo-800',
  other: 'bg-stone-100 text-stone-600',
}

export default function JobModal({ job, saved, onSave, onClose }: { job: Job | null; saved: boolean; onSave: () => void; onClose: () => void }) {
  const startY = useRef(0)

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    if (job) { document.addEventListener('keydown', handleKey); document.body.style.overflow = 'hidden' }
    return () => { document.removeEventListener('keydown', handleKey); document.body.style.overflow = '' }
  }, [job, onClose])

  if (!job) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-end justify-center bg-black/50 transition-opacity ${job ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
      onClick={onClose}>
      <div className="w-full max-w-xl max-h-[88vh] bg-white rounded-t-2xl overflow-y-auto" onClick={e => e.stopPropagation()}
        onTouchStart={e => { startY.current = e.touches[0].clientY }}
        onTouchMove={e => { if (e.touches[0].clientY - startY.current > 80) onClose() }}>
        <div className="w-9 h-1 bg-stone-300 rounded-full mx-auto mt-2.5 mb-1" />
        <div className="px-5 sm:px-6 pb-8">
          <h2 className="text-xl font-extrabold text-stone-900 leading-snug mb-1">{job.title}</h2>
          <p className="text-sm font-semibold text-purple-700 mb-4">{job.company}</p>

          <div className="flex flex-wrap gap-2 mb-4">
            <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${tagColor[job.category] || tagColor.other}`}>{catLabel(job.category)}</span>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{typeLabel(job.type)}</span>
            <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">{job.state}</span>
          </div>

          {/* Details */}
          <div className="space-y-0 divide-y divide-stone-100">
            <Detail icon="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10m-3 0a3 3 0 106 0 3 3 0 00-6 0" label="Lieu" value={job.location} />
            {job.pay && <Detail icon="M12 1v22 M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6" label="Salaire" value={job.pay} />}
            <Detail icon="M2 7h20v14a2 2 0 01-2 2H4a2 2 0 01-2-2V7z M16 21V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v16" label="Type" value={typeLabel(job.type)} />
            <Detail icon="M12 12m-10 0a10 10 0 1020 0 10 10 0 00-20 0 M12 6v6l4 2" label="Publié" value={`Il y a ${timeAgo(new Date(job.createdAt))}`} />
          </div>

          <div className="mt-4 text-sm text-stone-700 leading-relaxed whitespace-pre-wrap">{job.description}</div>

          <div className="flex gap-3 mt-6">
            <button onClick={onSave}
              className={`flex-1 py-4 rounded-xl border-2 flex items-center justify-center transition font-bold text-base ${saved ? 'border-red-300 bg-red-50 text-red-600' : 'border-stone-200 hover:border-purple-300 text-stone-600'}`}>
              <svg viewBox="0 0 24 24" fill={saved ? '#dc2626' : 'none'} stroke={saved ? '#dc2626' : '#a8a29e'} strokeWidth="2" className="w-5 h-5 mr-2">
                <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
              </svg>
              {saved ? 'Sauvegardé' : 'Sauvegarder'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function Detail({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-start gap-2.5 py-2.5">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-[18px] h-[18px] text-stone-400 flex-shrink-0 mt-0.5">
        {icon.split(' M').map((d, i) => <path key={i} d={i === 0 ? d : 'M' + d} />)}
      </svg>
      <div>
        <div className="text-[12px] text-stone-400">{label}</div>
        <div className="text-[14px] text-stone-700 font-medium">{value}</div>
      </div>
    </div>
  )
}
