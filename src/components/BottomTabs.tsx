'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useAdminView } from '@/components/AdminViewContext'
import { useTranslation } from '@/components/LanguageContext'

export default function BottomTabs() {
  const { t } = useTranslation()
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const { viewAsUser, toggleViewAsUser } = useAdminView()
  const isAdmin = (session?.user as any)?.role === 'admin'
  const inUserMode = viewAsUser

  const adminTabs = [
    { href: '/admin', label: 'Board', icon: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z' },
    { href: '/admin/publish', label: t.nav.publish, icon: 'M12 5v14 M5 12h14' },
    { href: '/admin/jobs', label: (t.nav as any).manageJobs ? 'Annonces' : 'Jobs', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2 M9 5a2 2 0 002 2h2a2 2 0 002-2 M9 5a2 2 0 012-2h2a2 2 0 012 2' },
    { href: '/profile', label: t.nav.profile, icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 7m-4 0a4 4 0 108 0 4 4 0 00-8 0' },
  ]

  const userTabs = [
    { href: '/feed', label: t.nav.home, icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10' },
    { href: '/states', label: t.nav.states, icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10m-3 0a3 3 0 106 0 3 3 0 00-6 0' },
    { href: '/saved', label: (t.nav as any).saved || 'Sauv.', icon: 'M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z' },
    { href: '/profile', label: t.nav.profile, icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 7m-4 0a4 4 0 108 0 4 4 0 00-8 0' },
  ]

  const tabs = isAdmin && !inUserMode ? adminTabs : userTabs
  const activeColor = isAdmin && !inUserMode ? 'text-purple-700' : 'text-amber-600'

  return (
    <div className="lg:hidden fixed bottom-0 inset-x-0 z-50">
      {/* Mode Switch — only for admins */}
      {isAdmin && (
        <div className="bg-white border-t border-stone-200 px-3 pt-2 pb-1">
          <div className="bg-stone-100 rounded-lg p-0.5 flex gap-0.5">
            <button
              onClick={() => { if (inUserMode) toggleViewAsUser() }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                !inUserMode
                  ? 'bg-purple-700 text-white shadow-sm'
                  : 'text-stone-500'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
              </svg>
              {(t as any).modeSwitch?.admin || 'Admin'}
            </button>
            <button
              onClick={() => { if (!inUserMode) toggleViewAsUser() }}
              className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-md text-[10px] font-bold transition-all ${
                inUserMode
                  ? 'bg-amber-400 text-stone-900 shadow-sm'
                  : 'text-stone-500'
              }`}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="7" r="4"/><path d="M5.5 21a8.38 8.38 0 0113 0"/>
              </svg>
              {(t as any).modeSwitch?.client || 'Client'}
            </button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <nav className="bg-white border-t border-stone-200 flex items-start justify-around pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))]">
        {tabs.map(tab => {
          const active = tab.href === '/admin'
            ? pathname === '/admin'
            : pathname.startsWith(tab.href)
          return (
            <button key={tab.href} onClick={() => router.push(tab.href)}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 ${active ? activeColor : 'text-stone-400'}`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
                {tab.icon.split(' M').map((d, i) => <path key={i} d={i === 0 ? d : 'M' + d} />)}
              </svg>
              <span className="text-[10px] font-semibold">{tab.label}</span>
            </button>
          )
        })}
      </nav>
    </div>
  )
}
