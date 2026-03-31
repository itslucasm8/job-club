'use client'
import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { STATES, CATEGORIES } from '@/lib/utils'

type Toast = { type: 'success' | 'error'; message: string } | null

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  // Personal info state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [loadingPersonal, setLoadingPersonal] = useState(false)
  const [toastPersonal, setToastPersonal] = useState<Toast>(null)

  // Password state
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loadingPassword, setLoadingPassword] = useState(false)
  const [toastPassword, setToastPassword] = useState<Toast>(null)
  const [showCurrentPassword, setShowCurrentPassword] = useState(false)
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)

  // Preferences state
  const [preferredStates, setPreferredStates] = useState<string[]>([])
  const [preferredCategories, setPreferredCategories] = useState<string[]>([])
  const [emailAlerts, setEmailAlerts] = useState(true)
  const [loadingPreferences, setLoadingPreferences] = useState(false)
  const [toastPreferences, setToastPreferences] = useState<Toast>(null)

  // Initial load
  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/login')
      return
    }

    if (status === 'authenticated') {
      const user = session?.user as any
      setName(user?.name || '')
      setEmail(user?.email || '')

      // Fetch preferences
      fetchPreferences()
    }
  }, [status, session, router])

  async function fetchPreferences() {
    try {
      const res = await fetch('/api/user/settings')
      if (res.ok) {
        const data = await res.json()
        setPreferredStates(data.preferredStates || [])
        setPreferredCategories(data.preferredCategories || [])
        setEmailAlerts(data.emailAlerts !== false)
      }
    } catch (error) {
      console.error('Failed to fetch preferences:', error)
    }
  }

  // Toast cleanup
  useEffect(() => {
    if (toastPersonal) {
      const timer = setTimeout(() => setToastPersonal(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastPersonal])

  useEffect(() => {
    if (toastPassword) {
      const timer = setTimeout(() => setToastPassword(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastPassword])

  useEffect(() => {
    if (toastPreferences) {
      const timer = setTimeout(() => setToastPreferences(null), 3000)
      return () => clearTimeout(timer)
    }
  }, [toastPreferences])

  // Handle personal info save
  async function handleSavePersonal() {
    if (!name.trim() || !email.trim()) {
      setToastPersonal({ type: 'error', message: 'Le nom et l\'email sont obligatoires' })
      return
    }

    setLoadingPersonal(true)
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email }),
      })

      const data = await res.json()

      if (res.ok) {
        setToastPersonal({ type: 'success', message: 'Informations personnelles mises à jour' })
      } else {
        setToastPersonal({ type: 'error', message: data.error || 'Erreur lors de la mise à jour' })
      }
    } catch (error) {
      setToastPersonal({ type: 'error', message: 'Erreur réseau' })
    } finally {
      setLoadingPersonal(false)
    }
  }

  // Handle password save
  async function handleSavePassword() {
    if (!currentPassword || !newPassword || !confirmPassword) {
      setToastPassword({ type: 'error', message: 'Tous les champs sont obligatoires' })
      return
    }

    if (newPassword !== confirmPassword) {
      setToastPassword({ type: 'error', message: 'Les nouveaux mots de passe ne correspondent pas' })
      return
    }

    if (newPassword.length < 6) {
      setToastPassword({ type: 'error', message: 'Le nouveau mot de passe doit contenir au moins 6 caractères' })
      return
    }

    setLoadingPassword(true)
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      })

      const data = await res.json()

      if (res.ok) {
        setToastPassword({ type: 'success', message: 'Mot de passe mis à jour' })
        setCurrentPassword('')
        setNewPassword('')
        setConfirmPassword('')
      } else {
        setToastPassword({ type: 'error', message: data.error || 'Erreur lors de la mise à jour' })
      }
    } catch (error) {
      setToastPassword({ type: 'error', message: 'Erreur réseau' })
    } finally {
      setLoadingPassword(false)
    }
  }

  // Handle preferences save
  async function handleSavePreferences() {
    setLoadingPreferences(true)
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferredStates, preferredCategories, emailAlerts }),
      })

      const data = await res.json()

      if (res.ok) {
        setToastPreferences({ type: 'success', message: 'Préférences mises à jour' })
      } else {
        setToastPreferences({ type: 'error', message: data.error || 'Erreur lors de la mise à jour' })
      }
    } catch (error) {
      setToastPreferences({ type: 'error', message: 'Erreur réseau' })
    } finally {
      setLoadingPreferences(false)
    }
  }

  // Toggle state selection
  function toggleState(code: string) {
    setPreferredStates((prev) =>
      prev.includes(code) ? prev.filter((s) => s !== code) : [...prev, code]
    )
  }

  // Toggle category selection
  function toggleCategory(key: string) {
    setPreferredCategories((prev) =>
      prev.includes(key) ? prev.filter((c) => c !== key) : [...prev, key]
    )
  }

  if (status === 'loading') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 max-w-lg">Chargement...</div>
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-lg mx-auto">
      <h1 className="text-2xl font-bold text-stone-900 mb-8">Paramètres du compte</h1>

      {/* Personal Information Section */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-stone-900 mb-4">Informations personnelles</h2>
        <div className="space-y-4 bg-white p-5 rounded-lg border border-stone-200">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Nom</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-stone-900 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="Votre nom"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-4 py-2.5 rounded-lg border border-stone-300 text-stone-900 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              placeholder="votre.email@example.com"
            />
          </div>
          <button
            onClick={handleSavePersonal}
            disabled={loadingPersonal}
            className="w-full py-2.5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingPersonal ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        {toastPersonal && (
          <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${
            toastPersonal.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {toastPersonal.message}
          </div>
        )}
      </section>

      {/* Password Section */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-stone-900 mb-4">Changer le mot de passe</h2>
        <div className="space-y-4 bg-white p-5 rounded-lg border border-stone-200">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Mot de passe actuel</label>
            <div className="relative">
              <input
                type={showCurrentPassword ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 rounded-lg border border-stone-300 text-stone-900 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Votre mot de passe actuel"
              />
              <button
                type="button"
                onClick={() => setShowCurrentPassword(!showCurrentPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition"
              >
                {showCurrentPassword ? (
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
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Nouveau mot de passe</label>
            <div className="relative">
              <input
                type={showNewPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 rounded-lg border border-stone-300 text-stone-900 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Nouveau mot de passe"
              />
              <button
                type="button"
                onClick={() => setShowNewPassword(!showNewPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition"
              >
                {showNewPassword ? (
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
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-2">Confirmer le nouveau mot de passe</label>
            <div className="relative">
              <input
                type={showConfirmPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="w-full px-4 py-2.5 pr-10 rounded-lg border border-stone-300 text-stone-900 placeholder-stone-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                placeholder="Confirmer le nouveau mot de passe"
              />
              <button
                type="button"
                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 transition"
              >
                {showConfirmPassword ? (
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
          <button
            onClick={handleSavePassword}
            disabled={loadingPassword}
            className="w-full py-2.5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingPassword ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        {toastPassword && (
          <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${
            toastPassword.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {toastPassword.message}
          </div>
        )}
      </section>

      {/* Preferences Section */}
      <section className="mb-8">
        <h2 className="text-lg font-bold text-stone-900 mb-4">Préférences de notification</h2>
        <div className="bg-white p-5 rounded-lg border border-stone-200">
          <p className="text-sm text-stone-600 mb-5 italic">
            Tu recevras des notifications pour les nouvelles offres correspondant à tes préférences. Si aucune sélection, tu recevras toutes les notifications.
          </p>

          {/* Email alerts toggle */}
          <div className="flex items-center justify-between py-3 mb-4 border-b border-stone-100">
            <div>
              <div className="text-sm font-semibold text-stone-900">Alertes par email</div>
              <div className="text-xs text-stone-500">Recevoir un email à chaque nouvelle offre correspondante</div>
            </div>
            <button
              type="button"
              onClick={() => setEmailAlerts(!emailAlerts)}
              className={`relative w-11 h-6 rounded-full transition-colors ${
                emailAlerts ? 'bg-purple-600' : 'bg-stone-300'
              }`}
            >
              <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
                emailAlerts ? 'translate-x-5' : 'translate-x-0'
              }`} />
            </button>
          </div>

          {/* States */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-stone-900 mb-3">États</h3>
            <div className="grid grid-cols-2 gap-3">
              {STATES.map((state) => (
                <label key={state.code} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferredStates.includes(state.code)}
                    onChange={() => toggleState(state.code)}
                    className="w-4 h-4 rounded border-stone-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <span className="text-sm text-stone-700">{state.code}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Categories */}
          <div className="mb-6">
            <h3 className="text-sm font-bold text-stone-900 mb-3">Catégories</h3>
            <div className="grid grid-cols-2 gap-3">
              {CATEGORIES.filter((c) => c.key !== 'all').map((category) => (
                <label key={category.key} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={preferredCategories.includes(category.key)}
                    onChange={() => toggleCategory(category.key)}
                    className="w-4 h-4 rounded border-stone-300 text-purple-600 focus:ring-purple-500 cursor-pointer"
                  />
                  <span className="text-sm text-stone-700">{category.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button
            onClick={handleSavePreferences}
            disabled={loadingPreferences}
            className="w-full py-2.5 bg-purple-600 text-white font-bold rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingPreferences ? 'Enregistrement...' : 'Enregistrer'}
          </button>
        </div>
        {toastPreferences && (
          <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${
            toastPreferences.type === 'success'
              ? 'bg-green-100 text-green-700'
              : 'bg-red-100 text-red-700'
          }`}>
            {toastPreferences.message}
          </div>
        )}
      </section>
    </div>
  )
}
