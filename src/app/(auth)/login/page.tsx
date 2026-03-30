'use client'

import { signIn } from 'next-auth/react'
import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await signIn('credentials', { email, password, redirect: false })
    setLoading(false)
    if (res?.error) {
      setError('Email ou mot de passe incorrect')
    } else {
      router.push('/feed')
    }
  }

  return (
    <div className="min-h-screen bg-stone-100 flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10 mx-auto mb-3">
            <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 8L32 4 31 12" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-2xl font-extrabold text-purple-800">Se connecter</h1>
          <p className="text-stone-500 text-sm mt-1">Accède à tes offres d&apos;emploi</p>
        </div>

        <form onSubmit={handleSubmit} className="bg-white rounded-2xl shadow-sm border border-stone-200 p-6 space-y-4">
          {error && <div className="bg-red-50 text-red-600 text-sm rounded-lg p-3">{error}</div>}

          <div>
            <label className="block text-sm font-semibold text-stone-600 mb-1">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition" placeholder="ton@email.com" />
          </div>

          <div>
            <label className="block text-sm font-semibold text-stone-600 mb-1">Mot de passe</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
              className="w-full px-4 py-3 rounded-lg border border-stone-200 bg-stone-50 text-sm focus:outline-none focus:border-purple-400 transition" placeholder="••••••••" />
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-3.5 rounded-lg bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50">
            {loading ? 'Connexion...' : 'Se connecter'}
          </button>
        </form>

        <p className="text-center mt-3">
          <Link href="/reset-password" className="text-sm text-purple-600 hover:underline">Mot de passe oublié ?</Link>
        </p>

        <p className="text-center mt-4 text-sm text-stone-500">
          Pas encore membre ?{' '}
          <Link href="/register" className="text-purple-700 font-semibold hover:underline">Créer un compte</Link>
        </p>
      </div>
    </div>
  )
}
