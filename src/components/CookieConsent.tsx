'use client'

import { useState, useEffect } from 'react'
import { usePostHog } from 'posthog-js/react'
import { useTranslation } from '@/components/LanguageContext'

export default function CookieConsent() {
  const [visible, setVisible] = useState(false)
  const posthog = usePostHog()
  const { t } = useTranslation()

  useEffect(() => {
    const consent = localStorage.getItem('cookie-consent')
    if (!consent) {
      setVisible(true)
    } else if (consent === 'declined') {
      posthog?.opt_out_capturing()
    }
  }, [posthog])

  function accept() {
    localStorage.setItem('cookie-consent', 'accepted')
    setVisible(false)
  }

  function decline() {
    localStorage.setItem('cookie-consent', 'declined')
    posthog?.opt_out_capturing()
    setVisible(false)
  }

  if (!visible) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 sm:p-6">
      <div className="max-w-lg mx-auto bg-white rounded-2xl shadow-lg border border-stone-200 p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <p className="text-sm text-stone-600 flex-1">
          {t.common.cookieText}{' '}
          <a href="/privacy" className="text-purple-600 hover:underline font-medium">
            {t.legal.privacyTitle}
          </a>
        </p>
        <div className="flex gap-2 flex-shrink-0">
          <button
            onClick={decline}
            className="px-4 py-2 text-sm font-medium text-stone-500 hover:text-stone-700 transition"
          >
            {t.common.decline}
          </button>
          <button
            onClick={accept}
            className="px-4 py-2 text-sm font-bold bg-purple-700 hover:bg-purple-800 text-white rounded-lg transition"
          >
            {t.common.accept}
          </button>
        </div>
      </div>
    </div>
  )
}
