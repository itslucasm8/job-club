'use client'

import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation, translateApiError } from '@/components/LanguageContext'

export default function RegisterPage() {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const router = useRouter()
  const { t, language, setLanguage } = useTranslation()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    const res = await fetch('/api/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, preferredLanguage: language }),
    })

    if (!res.ok) {
      const data = await res.json()
      setError(translateApiError(data.error, t) || t.register.signupError)
      setLoading(false)
      return
    }

    // Auto sign in
    const signInRes = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (signInRes?.error) {
      setError(t.register.autoLoginError)
    } else {
      router.push('/subscribe')
    }
  }

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-4 relative">
      <div className="absolute top-4 right-4">
        <button
          onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
          className="px-2.5 py-1 rounded-lg text-xs font-bold bg-stone-200 hover:bg-stone-300 text-stone-700 transition"
        >
          {t.language.label}
        </button>
      </div>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10 mx-auto mb-3">
            <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 8L32 4 31 12" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-2xl font-extrabold text-purple-800">{t.register.title}</h1>
          <p className="text-stone-500 text-sm mt-1">{t.register.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg p-3">{error}</div>}

          <div>
            <label className="block text-sm font-semibold text-stone-600 mb-1">{t.register.firstName}</label>
            <input type="text" value={name} onChange={e => setName(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition" placeholder="Lucas" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-stone-600 mb-1">{t.register.emailLabel}</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition" placeholder="ton@email.com" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-stone-600 mb-1">{t.register.passwordLabel}</label>
            <div className="relative">
              <input type={showPassword ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)} required minLength={6}
                className="w-full px-4 py-3 pr-10 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition" placeholder={t.register.passwordPlaceholder} />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition"
              >
                {showPassword ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
                    <path d="M14.12 14.12a3 3 0 11-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50">
            {loading ? t.register.submitting : t.register.submit}
          </button>
        </form>

        <p className="text-center mt-4 text-sm text-stone-500">
          {t.register.alreadyMember}{' '}
          <Link href="/login" className="text-purple-700 font-semibold hover:underline">{t.register.signIn}</Link>
        </p>
      </div>
    </div>
  )
}
