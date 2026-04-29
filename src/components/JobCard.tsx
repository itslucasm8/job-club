'use client'
import { catLabel, typeLabel, timeAgo } from '@/lib/utils'
import { useTranslation } from '@/components/LanguageContext'

interface EligibilityData {
  eligibility_88_days?: boolean | null
  eligibility_confidence?: 'high' | 'medium' | 'low' | null
  pay_status?: 'above' | 'at' | 'below' | 'piece_rate' | 'unknown' | null
  award_id?: string | null
  award_min_casual_hourly?: number | null
  award_min_hourly?: number | null
  pay_gap?: number | null
}

interface Job {
  id: string; title: string; company: string; state: string; location: string;
  category: string; type: string; pay: string | null; description: string;
  createdAt: string; eligible88Days?: boolean; eligibilityData?: EligibilityData | null;
}

const tagColor: Record<string, string> = {
  farm: 'bg-green-100 text-green-800',
  hospitality: 'bg-blue-100 text-blue-800',
  construction: 'bg-amber-100 text-amber-800',
  retail: 'bg-pink-100 text-pink-800',
  cleaning: 'bg-indigo-100 text-indigo-800',
  events: 'bg-violet-100 text-violet-800',
  animals: 'bg-teal-100 text-teal-800',
  transport: 'bg-sky-100 text-sky-800',
  other: 'bg-stone-100 text-stone-600',
}

function isNewJob(createdAt: string): boolean {
  return Date.now() - new Date(createdAt).getTime() < 24 * 60 * 60 * 1000
}

function Eligibility88Tag({ job, t }: { job: Job; t: any }) {
  const det = job.eligibilityData?.eligibility_88_days
  const conf = job.eligibilityData?.eligibility_confidence
  // High-confidence verified positive — green check.
  if (det === true && conf === 'high') {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-800" title={t.jobCard.days88Verified}>{t.jobCard.days88Verified}</span>
  }
  // Medium/low confidence positive OR null verdict on a job the LLM flagged as 88-day → amber question mark.
  if (det === true || (det === null && job.eligible88Days)) {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800" title={t.jobCard.days88Unverified}>{t.jobCard.days88Unverified}</span>
  }
  // Legacy rows pre-eligibility module — show original yellow flag if LLM said yes.
  if (det === undefined && job.eligible88Days) {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-yellow-100 text-yellow-800">{t.jobCard.days88}</span>
  }
  return null
}

function PayTag({ job, t }: { job: Job; t: any }) {
  const status = job.eligibilityData?.pay_status
  if (status === 'above' || status === 'at') {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-green-100 text-green-800" title={t.jobCard.payAtAward}>✓ {t.jobCard.payAtAward}</span>
  }
  if (status === 'below') {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-red-100 text-red-800" title={t.jobCard.payBelowAward}>⚠ {t.jobCard.payBelowAward}</span>
  }
  if (status === 'piece_rate') {
    return <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-amber-100 text-amber-800" title={t.jobCard.payPiecework}>{t.jobCard.payPiecework}</span>
  }
  return null
}

export default function JobCard({ job, saved, onSave, onClick }: { job: Job; saved: boolean; onSave: () => void; onClick: () => void }) {
  const { t, language } = useTranslation()

  return (
    <div onClick={onClick}
      className="relative bg-warm-card rounded-[14px] shadow-[0_1px_3px_rgba(0,0,0,0.08)] hover:shadow-[0_4px_12px_rgba(0,0,0,0.1)] hover:-translate-y-0.5 transition-all cursor-pointer p-5"
    >
      {/* Heart save button */}
      <button
        onClick={e => { e.stopPropagation(); onSave() }}
        className={`absolute top-2 right-2 p-2.5 rounded-full transition-colors ${saved ? 'text-red-500 bg-red-50' : 'text-stone-300 hover:text-purple-500 hover:bg-purple-50'}`}
        aria-label={saved ? t.jobCard.removeFavorite : t.jobCard.addFavorite}
      >
        <svg viewBox="0 0 24 24" fill={saved ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" className="w-5 h-5">
          <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/>
        </svg>
      </button>

      {/* Header: company avatar + name + time + NEW badge */}
      <div className="flex items-center gap-2.5 pr-10">
        <div className="w-9 h-9 rounded-full bg-purple-700 text-white flex items-center justify-center text-sm font-bold flex-shrink-0">
          {job.company[0]}
        </div>
        <div className="min-w-0">
          <div className="text-[13px] font-bold text-stone-800 truncate">{job.company}</div>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] text-stone-400">{language === 'fr' ? `Il y a ${timeAgo(new Date(job.createdAt), language)}` : `${timeAgo(new Date(job.createdAt), language)} ago`}</span>
            {isNewJob(job.createdAt) && (
              <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-orange-400 text-white uppercase tracking-wide leading-none">
                NEW
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Title */}
      <h3 className="text-[15px] font-bold text-stone-900 leading-snug mt-3">{job.title}</h3>

      {/* Location line */}
      <div className="flex items-center gap-1 mt-1 text-[12px] text-stone-500">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-3.5 h-3.5 flex-shrink-0 text-stone-400">
          <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/>
          <circle cx="12" cy="10" r="3"/>
        </svg>
        <span>{job.location}, {job.state}</span>
      </div>

      {/* Description */}
      <p className="text-[13px] text-stone-500 leading-relaxed line-clamp-3 mt-2.5">{job.description.split('\n')[0]}</p>

      {/* Tags row: category + state + type + pay */}
      <div className="flex flex-wrap gap-1.5 mt-3">
        <Eligibility88Tag job={job} t={t} />
        <PayTag job={job} t={t} />
        <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${tagColor[job.category] || tagColor.other}`}>{catLabel(job.category, language)}</span>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-purple-50 text-purple-700">{job.state}</span>
        <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{typeLabel(job.type, language)}</span>
        {job.pay && <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-stone-100 text-stone-600">{job.pay}</span>}
      </div>
    </div>
  )
}
