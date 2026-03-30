'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { STATES } from '@/lib/utils'

const navItems = [
  { href: '/feed', label: 'Accueil', icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10' },
  { href: '/states', label: 'Tous les States', icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10m-3 0a3 3 0 106 0 3 3 0 00-6 0' },
  { href: '/admin', label: 'Publier une offre', icon: 'M12 5v14 M5 12h14', adminOnly: true },
  { href: '/profile', label: 'Mon Profil', icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 7m-4 0a4 4 0 108 0 4 4 0 00-8 0' },
]

export default function Sidebar() {
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const isAdmin = (session?.user as any)?.role === 'admin'

  return (
    <aside className="hidden lg:flex flex-col w-64 flex-shrink-0 bg-white border-r border-stone-200 h-screen sticky top-0 overflow-y-auto">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 pt-5 pb-4">
        <svg viewBox="0 0 40 40" fill="none" className="w-9 h-9">
          <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M29 8L32 4 31 12" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-xl font-extrabold text-purple-800">Job Club</span>
      </div>

      {/* Nav */}
      <nav className="px-3 space-y-0.5">
        {navItems.filter(n => !n.adminOnly || isAdmin).map(item => {
          const active = pathname.startsWith(item.href)
          return (
            <button key={item.href} onClick={() => router.push(item.href)}
              className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm font-medium transition ${active ? 'bg-purple-50 text-purple-700 font-semibold' : 'text-stone-500 hover:bg-stone-50 hover:text-stone-700'}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5 flex-shrink-0">
                {item.icon.split(' M').map((d, i) => <path key={i} d={i === 0 ? d : 'M' + d} />)}
              </svg>
              {item.label}
            </button>
          )
        })}
      </nav>

      {/* States section */}
      <div className="px-5 pt-5 pb-2 text-[11px] font-bold uppercase tracking-wider text-stone-400">States</div>
      <div className="px-3 pb-5 space-y-0.5">
        {STATES.map(s => (
          <button key={s.code} onClick={() => router.push(`/feed?state=${s.code}`)}
            className="flex items-center justify-between w-full px-3 py-2 rounded-lg text-[13px] text-stone-500 hover:bg-stone-50 hover:text-stone-700 transition">
            <span>{s.code} — {s.name}</span>
          </button>
        ))}
      </div>

      {/* Profile */}
      <div className="mt-auto border-t border-stone-200 p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-purple-50 border-2 border-purple-300 flex items-center justify-center text-xs font-bold text-purple-700 flex-shrink-0">
          {session?.user?.name?.[0]?.toUpperCase() || session?.user?.email?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-800 truncate">{session?.user?.name || 'Membre'}</div>
          <div className="text-[11px] text-stone-400 truncate">{session?.user?.email}</div>
        </div>
      </div>
    </aside>
  )
}
