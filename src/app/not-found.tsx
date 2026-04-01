import Link from 'next/link'

export default function NotFound() {
  return (
    <div className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center">
        <div className="text-6xl font-extrabold text-purple-700 mb-2">404</div>
        <h2 className="text-xl font-bold text-stone-800 mb-2">Page introuvable</h2>
        <p className="text-sm text-stone-500 mb-6">
          Cette page n&apos;existe pas ou a été déplacée.
        </p>
        <Link
          href="/feed"
          className="inline-block px-6 py-3 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-600 transition"
        >
          Retour aux offres
        </Link>
      </div>
    </div>
  )
}
