'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { STATES } from '@/lib/utils'
import { useTranslation } from '@/components/LanguageContext'

const stateColors = ['from-purple-700 to-purple-500', 'from-purple-800 to-purple-600', 'from-violet-700 to-violet-500', 'from-purple-900 to-purple-700', 'from-indigo-700 to-indigo-500', 'from-purple-800 to-violet-600', 'from-violet-800 to-violet-600', 'from-purple-950 to-purple-800']

export default function StatesPage() {
  const router = useRouter()
  const { t } = useTranslation()
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    async function fetchCounts() {
      const res = await fetch('/api/feed/stats')
      if (!res.ok) return
      const data = await res.json()
      setCounts(data.stateCounts || {})
    }
    fetchCounts()
  }, [])

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">{t.statesPage.title}</h1>
      <p className="text-sm text-stone-500 mb-5">{t.statesPage.subtitle}</p>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
        {STATES.map((s, i) => (
          <div key={s.code} onClick={() => router.push(`/feed?state=${s.code}`)}
            className="bg-white rounded-xl border border-stone-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 transition-all cursor-pointer overflow-hidden">
            <div className={`h-20 sm:h-24 bg-gradient-to-br ${stateColors[i % stateColors.length]} flex items-center justify-center text-white text-center p-3`}>
              <div>
                <div className="text-sm sm:text-base font-extrabold leading-tight">{s.name}</div>
                <div className="text-xs opacity-80">({s.code})</div>
              </div>
            </div>
            <div className="p-3">
              <div className="text-sm font-bold text-stone-800">{s.code}</div>
              <div className="text-xs text-stone-500">
                <strong className="text-purple-700">{counts[s.code] || 0}</strong> {t.statesPage.jobs}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
