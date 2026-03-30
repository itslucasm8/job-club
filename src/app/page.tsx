import Link from 'next/link'

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-purple-900 via-purple-800 to-purple-600 flex flex-col items-center justify-center px-6 py-16 text-white text-center">
      {/* Logo */}
      <svg viewBox="0 0 120 120" fill="none" className="w-24 h-24 mb-6">
        <circle cx="60" cy="60" r="56" fill="#f59e0b" opacity="0.15"/>
        <path d="M35 85L55 25 65 55 85 15" stroke="#f59e0b" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
        <path d="M78 22L85 15 82 28" stroke="#f59e0b" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
      </svg>

      <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight mb-3">Job Club</h1>
      <p className="text-lg opacity-85 mb-10 max-w-md leading-relaxed">
        Trouve ton job en Australie. Des centaines d&apos;offres chaque semaine dans tous les states.
      </p>

      {/* Features */}
      <ul className="text-left max-w-sm w-full mb-10 space-y-3">
        {[
          '20-30 nouvelles offres par jour',
          'Offres par state et catégorie',
          'Recherche par mots-clés',
          'Sauvegarde tes offres favorites',
          'Communauté francophone',
        ].map((f, i) => (
          <li key={i} className="flex items-center gap-3 text-[15px] py-2 border-b border-white/10 last:border-0">
            <span className="text-amber-400 text-xl flex-shrink-0">✓</span>
            {f}
          </li>
        ))}
      </ul>

      {/* Pricing */}
      <div className="mb-6">
        <span className="text-5xl font-extrabold">$39.99</span>
        <span className="text-lg opacity-70"> / mois</span>
      </div>

      {/* CTAs */}
      <Link
        href="/register"
        className="block w-full max-w-sm bg-amber-400 hover:bg-amber-300 text-stone-900 font-bold text-lg py-4 rounded-full text-center shadow-lg shadow-amber-500/30 transition-all hover:-translate-y-0.5"
      >
        S&apos;abonner maintenant
      </Link>
      <p className="mt-4 text-sm opacity-70">
        Déjà membre ?{' '}
        <Link href="/login" className="underline opacity-100">Se connecter</Link>
      </p>
    </div>
  )
}
