'use client'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'
import { STATES } from '@/lib/utils'
import { useAdminView } from '@/components/AdminViewContext'
import { useTranslation } from '@/components/LanguageContext'

export default function Sidebar() {
  const { t } = useTranslation()

  const navItems = [
    { href: '/feed', label: t.nav.home, icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10' },
    { href: '/states', label: t.nav.allStates, icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10m-3 0a3 3 0 106 0 3 3 0 00-6 0' },
    { href: '/admin', label: t.nav.publishJob, icon: 'M12 5v14 M5 12h14', adminOnly: true },
    { href: '/admin/jobs', label: t.nav.manageJobs, icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 5a2 2 0 012-2h2a2 2 0 012 2', adminOnly: true },
    { href: '/saved', label: t.nav.savedJobs, icon: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z' },
    { href: '/profile', label: t.nav.myProfile, icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 7m-4 0a4 4 0 108 0 4 4 0 00-8 0' },
  ]
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const { viewAsUser } = useAdminView()
  const isAdmin = (session?.user as any)?.role === 'admin' && !viewAsUser
  const [showStates, setShowStates] = useState(false)
  const [stateCounts, setStateCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    fetch('/api/feed/stats')
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (data?.stateCounts) setStateCounts(data.stateCounts)
      })
      .catch(() => {})
  }, [])

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
      <button onClick={() => setShowStates(!showStates)} className="flex items-center justify-between w-full px-5 pt-5 pb-2 text-xs font-bold text-stone-500 uppercase tracking-wider hover:text-stone-700 transition">
        <span>{t.nav.states}</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 transition-transform ${showStates ? 'rotate-180' : ''}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {showStates && (
        <div className="px-3 pb-5 space-y-0.5">
          {STATES.map(s => (
            <button key={s.code} onClick={() => router.push(`/feed?state=${s.code}`)}
              className="w-full px-3 py-2 rounded-lg text-[13px] text-stone-500 hover:bg-stone-50 hover:text-stone-700 transition text-left flex items-center justify-between">
              <span>{s.code} — {s.name}</span>
              <span className="text-[12px] font-medium text-stone-400 tabular-nums">{stateCounts[s.code] ?? '\u2014'}</span>
            </button>
          ))}
        </div>
      )}

      {/* Profile */}
      <div className="mt-auto border-t border-stone-200 p-4 flex items-center gap-3">
        <div className="w-9 h-9 rounded-full bg-purple-50 border-2 border-purple-300 flex items-center justify-center text-xs font-bold text-purple-700 flex-shrink-0">
          {session?.user?.name?.[0]?.toUpperCase() || session?.user?.email?.[0]?.toUpperCase() || '?'}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-stone-800 truncate">{session?.user?.name || t.common.member}</div>
          <div className="text-[11px] text-stone-400 truncate">{session?.user?.email}</div>
        </div>
      </div>
    </aside>
  )
}
