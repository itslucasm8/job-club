'use client'

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { useTranslation } from '@/components/LanguageContext'

export default function PastDueBanner() {
  const { data: session } = useSession()
  const { t } = useTranslation()
  const [dismissed, setDismissed] = useState(false)

  const status = (session?.user as any)?.subscriptionStatus
  if (status !== 'past_due' || dismissed) return null

  async function handleUpdate() {
    const res = await fetch('/api/stripe/portal', { method: 'POST' })
    if (res.ok) {
      const { url } = await res.json()
      window.location.href = url
    }
  }

  return (
    <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 flex items-center justify-between gap-3">
      <p className="text-sm text-amber-800 font-medium flex-1">
        {t.common.pastDueWarning}
      </p>
      <button
        onClick={handleUpdate}
        className="flex-shrink-0 px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-sm font-bold transition"
      >
        {t.common.updatePayment}
      </button>
      <button
        onClick={() => setDismissed(true)}
        className="flex-shrink-0 text-amber-400 hover:text-amber-600 transition"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
          <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}
