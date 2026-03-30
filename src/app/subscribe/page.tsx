'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function SubscribePage() {
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  async function handleSubscribe() {
    setLoading(true)
    const res = await fetch('/api/stripe/checkout', { method: 'POST' })
    const data = await res.json()
    if (data.url) {
      window.location.href = data.url
    } else {
      setLoading(false)
      alert('Erreur lors de la redirection vers le paiement')
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-600 flex items-center justify-center px-4">
      <div className="max-w-md w-full">
        <div className="text-center text-white mb-8">
          <svg viewBox="0 0 40 40" fill="none" className="w-10 h-10 mx-auto mb-3">
            <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
            <path d="M29 8L32 4 31 12" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <h1 className="text-2xl font-extrabold">Active ton abonnement</h1>
          <p className="text-sm opacity-80 mt-2">Accède à toutes les offres d&apos;emploi en Australie</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 text-center">
          <div className="mb-6">
            <span className="text-5xl font-extrabold text-stone-900">$39.99</span>
            <span className="text-stone-500"> / mois</span>
          </div>

          <ul className="text-left space-y-3 mb-8">
            {[
              '20-30 nouvelles offres par jour',
              'Filtres par state et catégorie',
              'Recherche par mots-clés',
              'Sauvegarde tes favoris',
              'Annulation à tout moment',
            ].map((f, i) => (
              <li key={i} className="flex items-center gap-3 text-sm text-stone-600">
                <span className="text-amber-500 text-lg">✓</span>{f}
              </li>
            ))}
          </ul>

          <button onClick={handleSubscribe} disabled={loading}
            className="w-full py-4 rounded-xl bg-amber-400 hover:bg-amber-300 text-stone-900 font-bold text-lg transition disabled:opacity-50 shadow-lg shadow-amber-400/30">
            {loading ? 'Redirection...' : "S'abonner maintenant"}
          </button>

          <p className="mt-4 text-xs text-stone-400">Paiement sécurisé via Stripe</p>
        </div>
      </div>
    </div>
  )
}
