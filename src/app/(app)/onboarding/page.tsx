'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { STATES, getCategories } from '@/lib/utils'
import { useTranslation } from '@/components/LanguageContext'

export default function OnboardingPage() {
  const router = useRouter()
  const { t, language } = useTranslation()
  const categories = getCategories(language)

  const [selectedStates, setSelectedStates] = useState<string[]>([])
  const [selectedCategories, setSelectedCategories] = useState<string[]>([])
  const [only88Days, setOnly88Days] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function toggleState(code: string) {
    setSelectedStates(prev =>
      prev.includes(code) ? prev.filter(s => s !== code) : [...prev, code]
    )
  }

  function toggleCategory(key: string) {
    setSelectedCategories(prev =>
      prev.includes(key) ? prev.filter(c => c !== key) : [...prev, key]
    )
  }

  async function handleSubmit() {
    if (selectedStates.length === 0) {
      setError(t.onboarding.statesRequired)
      return
    }
    if (selectedCategories.length === 0) {
      setError(t.onboarding.categoriesRequired)
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          preferredStates: selectedStates,
          preferredCategories: selectedCategories,
          only88Days,
          onboardingCompleted: true,
        }),
      })

      if (!res.ok) {
        setError(t.onboarding.error)
        setSaving(false)
        return
      }

      router.push('/feed')
    } catch {
      setError(t.onboarding.error)
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-warm-bg px-4 py-8 pb-24 lg:pb-10">
      <div className="max-w-lg mx-auto">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-purple-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-7 h-7 text-purple-700">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-extrabold text-stone-900">{t.onboarding.title}</h1>
          <p className="text-sm text-stone-500 mt-2">{t.onboarding.subtitle}</p>
        </div>

        <div className="bg-white rounded-2xl border border-stone-200 p-5 sm:p-6 shadow-sm">
          {/* States */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-stone-900 mb-3">{t.onboarding.statesLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {STATES.map(s => (
                <button
                  key={s.code}
                  onClick={() => toggleState(s.code)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                    selectedStates.includes(s.code)
                      ? 'bg-purple-700 text-white border-purple-700'
                      : 'bg-white text-stone-500 border-stone-200 hover:border-purple-300'
                  }`}
                >
                  {s.code}
                </button>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="mb-6">
            <h2 className="text-sm font-bold text-stone-900 mb-3">{t.onboarding.categoriesLabel}</h2>
            <div className="flex flex-wrap gap-2">
              {categories.filter(c => c.key !== 'all').map(c => (
                <button
                  key={c.key}
                  onClick={() => toggleCategory(c.key)}
                  className={`px-3.5 py-2 rounded-xl text-sm font-semibold border-2 transition ${
                    selectedCategories.includes(c.key)
                      ? 'bg-amber-400 text-stone-900 border-amber-400'
                      : 'bg-white text-stone-500 border-stone-200 hover:border-amber-300'
                  }`}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>

          {/* 88 days toggle */}
          <div className="flex items-center justify-between py-3 mb-6 border-t border-stone-100">
            <div>
              <div className="text-sm font-semibold text-stone-900">{t.onboarding.only88Days}</div>
              <div className="text-xs text-stone-500">{t.onboarding.only88DaysHelp}</div>
            </div>
            <button
              type="button"
              onClick={() => setOnly88Days(!only88Days)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                only88Days ? 'bg-purple-600' : 'bg-stone-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                only88Days ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-700 font-medium">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="w-full py-3.5 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-800 transition disabled:opacity-50 disabled:cursor-not-allowed text-base"
          >
            {saving ? t.onboarding.saving : t.onboarding.submit}
          </button>
        </div>
      </div>
    </div>
  )
}
