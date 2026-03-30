'use client'
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

export default function JobCard({ job, saved, onSave, onClick }: { job: Job; saved: boolean; onSave: () => void; onClick: () => void }) {
  return (
    <div onClick={onClick} className="bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-full bg-purple-700 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
            {job.company[0]}
          </div>
          <div>
            <div className="text-[13px] font-bold text-stone-800">{job.company}</div>
            <div className="text-[11px] text-stone-400">Il y a {timeAgo(new Date(job.createdAt))}</div>
          </div>
        </div>
        <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700 flex-shrink-0">{job.state}</span>
      </div>

      <div className="px-4 py-3">
        <h3 className="text-[15px] font-bold text-stone-900 leading-snug mb-2">{job.title}</h3>
        <p className="text-[13px] text-stone-500 leading-relaxed line-clamp-3 mb-3">{job.description.split('\n')[0]}</p>
        <div className="flex flex-wrap gap-1.5">
          <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${tagColor[job.category] || tagColor.other}`}>{catLabel(job.category)}</span>
          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{typeLabel(job.type)}</span>
          {job.pay && <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{job.pay}</span>}
        </div>
      </div>

      <div className="flex items-center justify-between px-4 py-2.5 border-t border-stone-100 bg-stone-50/50">
        <button onClick={e => { e.stopPropagation(); onSave() }}
          className={`flex items-center gap-1.5 text-[12px] ${saved ? 'text-red-500' : 'text-stone-400 hover:text-purple-600'} transition`}>
          <svg viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className="w-[18px] h-[18px]">
            <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
          </svg>
          {saved ? 'Sauvegardé' : 'Sauvegarder'}
        </button>
      </div>
    </div>
  )
}
