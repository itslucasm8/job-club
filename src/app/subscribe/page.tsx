'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTranslation } from '@/components/LanguageContext'

export default function SubscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-600 flex items-center justify-center"><div className="text-white/60">...</div></div>}>
      <SubscribeContent />
    </Suspense>
  )
}

function SubscribeContent() {
  const [loading, setLoading] = useState(false)
  const [plan, setPlan] = useState<'monthly' | 'yearly'>('monthly')
  const router = useRouter()
  const searchParams = useSearchParams()
  const [message, setMessage] = useState<{ type: 'success' | 'info'; text: string } | null>(null)
  const { t, language, setLanguage } = useTranslation()

  useEffect(() => {
    const subscribed = searchParams.get('subscribed')
    const canceled = searchParams.get('canceled')

    if (subscribed === 'true') {
      setMessage({
        type: 'success',
        text: t.subscribe.successMessage,
      })
      const timer = setTimeout(() => {
        router.push('/onboarding')
      }, 2000)
      return () => clearTimeout(timer)
    } else if (canceled === 'true') {
      setMessage({
        type: 'info',
        text: t.subscribe.canceledMessage,
      })
    }
  }, [searchParams, router])

  async function handleSubscribe() {
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    } else {
      setLoading(false)
      alert(t.subscribe.checkoutError)
    }
  }

  if (message) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-600 flex items-center justify-center px-4 relative">
        <div className="absolute top-4 right-4">
          <button
            onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
            className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30 text-white transition"
          >
            {t.language.label}
          </button>
        </div>
        <div className="max-w-md w-full">
          <div className={`rounded-2xl p-8 text-center ${
            message.type === 'success'
              ? 'bg-green-100 border-2 border-green-400'
              : 'bg-blue-100 border-2 border-blue-400'
          }`}>
            <div className={`text-4xl mb-4 ${
              message.type === 'success' ? 'text-green-500' : 'text-blue-500'
            }`}>
              {message.type === 'success' ? '✓' : 'ℹ'}
            </div>
            <p className={`text-lg font-bold ${
              message.type === 'success' ? 'text-green-700' : 'text-blue-700'
            }`}>
              {message.text}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-600 flex items-center justify-center px-4 relative">
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white/20 hover:bg-white/30 text-white transition"
        >
          {t.language.label}
        </button>
      </div>
      <div className="max-w-md w-full">
        <div className="text-center text-white mb-8">
          <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10 mx-auto mb-3">
            <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 8L32 4 31 12" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-2xl font-extrabold">{t.subscribe.title}</h1>
          <p className="text-sm opacity-80 mt-2">{t.subscribe.subtitle}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          {/* Plan toggle */}
          <div className="flex items-center justify-center gap-1 mb-6 bg-stone-100 rounded-xl p-1">
            <button
              onClick={() => setPlan('monthly')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition ${
                plan === 'monthly'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              {t.subscribe.monthly}
            </button>
            <button
              onClick={() => setPlan('yearly')}
              className={`flex-1 py-2.5 px-4 rounded-lg text-sm font-bold transition relative ${
                plan === 'yearly'
                  ? 'bg-white text-stone-900 shadow-sm'
                  : 'text-stone-400 hover:text-stone-600'
              }`}
            >
              {t.subscribe.yearly}
              <span className="absolute -top-2 -right-2 bg-green-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                -17%
              </span>
            </button>
          </div>

          {/* Price display */}
          <div className="mb-6">
            {plan === 'monthly' ? (
              <>
                <span className="text-5xl font-extrabold text-stone-900">$39.99</span>
                <span className="text-stone-500"> {t.common.perMonth}</span>
              </>
            ) : (
              <>
                <span className="text-5xl font-extrabold text-stone-900">$400</span>
                <span className="text-stone-500"> {t.common.perYear}</span>
                <p className="text-sm text-green-600 font-semibold mt-1">
                  ~$33.33{t.common.perMonth} — {t.subscribe.yearSavings}
                </p>
              </>
            )}
          </div>

          <ul className="text-left space-y-3 mb-8">
            {[
              t.subscribe.feature1,
              t.subscribe.feature2,
              t.subscribe.feature3,
              t.subscribe.feature4,
              t.subscribe.feature5,
            ].map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-stone-600">
                <span className="text-amber-500 text-lg">✓</span>{f}
              </li>
            ))}
          </ul>

          <button onClick={handleSubscribe} disabled={loading}
            className="w-full py-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-900 font-bold text-lg transition disabled:opacity-50 shadow-lg shadow-amber-400/30">
            {loading ? t.subscribe.redirecting : t.subscribe.subscribeNow}
          </button>

          <p className="mt-4 text-xs text-stone-400">{t.subscribe.securePayment}</p>
        </div>

        <p className="text-center text-[11px] text-white/40 mt-6">
          <a href="/privacy" className="hover:text-white/60">{t.legal.privacyTitle}</a>
          {' · '}
          <a href="/terms" className="hover:text-white/60">{t.legal.termsTitle}</a>
        </p>
      </div>
    </div>
  )
}
