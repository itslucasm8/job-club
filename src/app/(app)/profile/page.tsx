'use client'
import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'

export default function ProfilePage() {
  const { data: session } = useSession()
  const router = useRouter()
  const user = session?.user as any
  const [savedCount, setSavedCount] = useState(0)

  useEffect(() => {
    async function fetchSavedCount() {
      try {
        const res = await fetch('/api/jobs/saved')
        if (res.ok) {
          const data = await res.json()
          setSavedCount((data || []).length)
        }
      } catch {}
    }
    fetchSavedCount()
  }, [])

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-lg">
      {/* Header */}
      <div className="text-center px-5 py-7 bg-gradient-to-br from-purple-700 to-purple-500 rounded-2xl text-white mb-5">
        <div className="w-[72px] h-[72px] rounded-full bg-white/20 border-[3px] border-white/40 flex items-center justify-center text-3xl font-bold mx-auto mb-3">
          {user?.name?.[0]?.toUpperCase() || user?.email?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="text-xl font-bold">{user?.name || 'Membre'}</div>
        <div className="text-sm opacity-70">{user?.email}</div>
        <div className="flex justify-center gap-8 mt-4">
          <div className="text-center"><div className="text-2xl font-extrabold">{savedCount}</div><div className="text-[11px] opacity-70">Sauvegardés</div></div>
          <div className="text-center"><div className="text-2xl font-extrabold">0</div><div className="text-[11px] opacity-70">Consultées</div></div>
          <div className="text-center"><div className="text-2xl font-extrabold">∞</div><div className="text-[11px] opacity-70">Jours restants</div></div>
        </div>
      </div>

      {/* Menu */}
      <div className="space-y-0.5 mb-5">
        <MenuItem icon="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" label="Mes offres sauvegardées" onClick={() => router.push('/saved')} />
        <MenuItem icon="M12 12m-3 0a3 3 0 106 0 3 3 0 00-6 0 M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4" label="Paramètres du compte" />
        <MenuItem icon="M1 4h22v16a2 2 0 01-2 2H3a2 2 0 01-2-2V4z M1 10h22" label="Gérer mon abonnement" />
        <MenuItem icon="M12 12m-10 0a10 10 0 1020 0 10 10 0 00-20 0 M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3 M12 17h.01" label="Guide d'utilisation" />
      </div>

      <button onClick={() => signOut({ callbackUrl: '/' })}
        className="w-full py-3.5 rounded-xl border-2 border-red-500 text-red-500 font-bold text-[15px] hover:bg-red-50 transition">
        Se déconnecter
      </button>
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: string; label: string; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center justify-between w-full px-4 py-3.5 bg-white rounded-lg border border-stone-200 hover:border-purple-300 transition">
      <div className="flex items-center gap-3">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 text-stone-500">
          {icon.split(' M').map((d, i) => <path key={i} d={i === 0 ? d : 'M' + d} />)}
        </svg>
        <span className="text-sm font-medium text-stone-700">{label}</span>
      </div>
      <span className="text-stone-400 text-sm">›</span>
    </button>
  )
}
