'use client'
import { usePathname, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useAdminView } from '@/components/AdminViewContext'
import { useTranslation } from '@/components/LanguageContext'

export default function BottomTabs() {
  const { t } = useTranslation()

  const tabs = [
    { href: '/feed', label: t.nav.home, icon: 'M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10' },
    { href: '/states', label: t.nav.states, icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z M12 10m-3 0a3 3 0 106 0 3 3 0 00-6 0' },
    { href: '/admin', label: t.nav.publish, icon: 'M12 5v14 M5 12h14', adminOnly: true },
    { href: '/profile', label: t.nav.profile, icon: 'M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2 M12 7m-4 0a4 4 0 108 0 4 4 0 00-8 0' },
  ]
  const pathname = usePathname()
  const router = useRouter()
  const { data: session } = useSession()
  const { viewAsUser } = useAdminView()
  const isAdmin = (session?.user as any)?.role === 'admin' && !viewAsUser

  return (
    <nav className="lg:hidden fixed bottom-0 inset-x-0 bg-white border-t border-stone-200 flex items-start justify-around pt-1.5 pb-[calc(0.375rem+env(safe-area-inset-bottom))] z-50">
      {tabs.filter(item => !item.adminOnly || isAdmin).map(tab => {
        const active = pathname.startsWith(tab.href)
        return (
          <button key={tab.href} onClick={() => router.push(tab.href)}
            className={`flex flex-col items-center gap-0.5 px-3 py-1 ${active ? 'text-purple-700' : 'text-stone-400'}`}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-6 h-6">
              {tab.icon.split(' M').map((d, i) => <path key={i} d={i === 0 ? d : 'M' + d} />)}
            </svg>
            <span className="text-[10px] font-semibold">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
