'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html>
      <body className="min-h-screen bg-stone-50 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center">
          <div className="text-5xl mb-4">⚠️</div>
          <h2 className="text-xl font-bold text-stone-800 mb-2">Oups, quelque chose a planté</h2>
          <p className="text-sm text-stone-500 mb-6">
            Une erreur inattendue s&apos;est produite. Nos équipes ont été prévenues.
          </p>
          <button
            onClick={reset}
            className="px-6 py-3 bg-purple-700 text-white font-bold rounded-xl hover:bg-purple-600 transition"
          >
            Réessayer
          </button>
        </div>
      </body>
    </html>
  )
}
