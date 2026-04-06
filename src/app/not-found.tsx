'use client'

import Link from 'next/link'
import { useTranslation } from '@/components/LanguageContext'

export default function NotFound() {
  const { t } = useTranslation()

  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl font-extrabold text-purple-700 mb-2">404</div>
        <h2 className="text-xl font-bold text-stone-800 mb-2">{t.errors.notFound}</h2>
        <p className="text-sm text-stone-500 mb-6">
          {t.errors.notFoundMessage}
        </p>
        <Link
          href="/feed"
          className="inline-block px-6 py-3 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-600 transition"
        >
          {t.errors.backToJobs}
        </Link>
      </div>
    </div>
  )
}
