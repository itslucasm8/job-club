'use client'
import { useSession } from 'next-auth/react'
import { useAdminView } from '@/components/AdminViewContext'
import { useTranslation } from '@/components/LanguageContext'

export default function AdminViewBanner() {
  const { data: session } = useSession()
  const { viewAsUser, toggleViewAsUser } = useAdminView()
  const { t } = useTranslation()
  const isAdmin = (session?.user as any)?.role === 'admin'

  if (!isAdmin || !viewAsUser) return null

  return (
    <div className="fixed top-0 left-0 right-0 z-[60] bg-amber-400 text-amber-900 text-center py-1.5 px-4 text-xs font-bold flex items-center justify-center gap-3">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3.5 h-3.5">
        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
      </svg>
      <span>{t.adminView.banner}</span>
      <button
        onClick={toggleViewAsUser}
        className="px-2 py-0.5 rounded bg-amber-600 text-white hover:bg-amber-700 transition text-[11px] font-bold"
      >
        {t.adminView.exit}
      </button>
    </div>
  )
}
