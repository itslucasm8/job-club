'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useTranslation, translateApiError } from '@/components/LanguageContext'

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stone-100 flex items-center justify-center"><div className="text-stone-400">...</div></div>}>
      <ResetPasswordContent />
    </Suspense>
  )
}

function ResetPasswordContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const token = searchParams.get('token')
  const { t, language, setLanguage } = useTranslation()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const isConfirmStep = !!token

  async function handleRequestReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccess('')

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(translateApiError(data.error, t) || t.resetPassword.requestError)
        return
      }

      setSuccess(t.resetPassword.requestSuccess)
      setEmail('')
    } catch (e) {
      setError(t.resetPassword.connectionError)
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirmReset(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')

    if (password !== confirmPassword) {
      setError(t.resetPassword.passwordsMismatch)
      setLoading(false)
      return
    }

    if (password.length < 8) {
      setError(t.resetPassword.passwordTooShort)
      setLoading(false)
      return
    }

    try {
      const res = await fetch('/api/auth/reset-password/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(translateApiError(data.error, t) || t.resetPassword.resetError)
        return
      }

      setSuccess(t.resetPassword.resetSuccess)
      setTimeout(() => {
        router.push('/login')
      }, 2000)
    } catch (e) {
      setError(t.resetPassword.connectionError)
      console.error(e)
    } finally {
      setLoading(false)
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
          <h1 className="text-2xl font-extrabold text-purple-800">
            {isConfirmStep ? t.resetPassword.newPasswordTitle : t.resetPassword.title}
          </h1>
          <p className="text-stone-500 text-sm mt-1">
            {isConfirmStep ? t.resetPassword.newPasswordSubtitle : t.resetPassword.subtitle}
          </p>
        </div>

        <form
          onSubmit={isConfirmStep ? handleConfirmReset : handleRequestReset}
          className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4"
        >
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg p-3">{error}</div>}
          {success && <div className="bg-green-50 text-green-600 text-sm rounded-lg p-3">{success}</div>}

          {!isConfirmStep ? (
            // Request step
            <>
              <div>
                <label className="block text-sm font-semibold text-stone-600 mb-1">{t.resetPassword.emailLabel}</label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition"
                  placeholder="ton@email.com"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50"
              >
                {loading ? t.resetPassword.sending : t.resetPassword.sendLink}
              </button>
            </>
          ) : (
            // Confirm step
            <>
              <div>
                <label className="block text-sm font-semibold text-stone-600 mb-1">{t.resetPassword.newPasswordLabel}</label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition"
                  placeholder="••••••••"
                  minLength={8}
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-stone-600 mb-1">{t.resetPassword.confirmPasswordLabel}</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  required
                  className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition"
                  placeholder="••••••••"
                  minLength={8}
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50"
              >
                {loading ? t.resetPassword.resetting : t.resetPassword.reset}
              </button>
            </>
          )}
        </form>

        <p className="text-center mt-4 text-sm text-stone-500">
          <Link href="/login" className="text-purple-700 font-semibold hover:underline">{t.resetPassword.backToLogin}</Link>
        </p>
      </div>
    </div>
  )
}
