'use client'

import { useTranslation } from '@/components/LanguageContext'

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center justify-center py-20 px-4">
      <div className="text-4xl mb-4">😕</div>
      <h2 className="text-lg font-bold text-stone-800 mb-2">{t.errors.pageError}</h2>
      <p className="text-sm text-stone-500 mb-6 text-center max-w-sm">
        {t.errors.pageErrorMessage}
      </p>
      <div className="flex gap-3">
        <button
          onClick={reset}
          className="px-5 py-2.5 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-600 transition text-sm"
        >
          {t.common.retry}
        </button>
        <a
          href="/feed"
          className="px-5 py-2.5 bg-stone-200 text-stone-700 font-bold rounded-xl hover:bg-stone-300 transition text-sm"
        >
          {t.errors.backToFeed}
        </a>
      </div>
    </div>
  )
}
