'use client'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'

export default function TopBar() {
  const { data: session } = useSession()
  const router = useRouter()

  return (
    <header className="sticky top-0 z-40 bg-white border-b border-stone-200 flex items-center justify-between px-4 sm:px-5 h-[60px]">
      <div className="flex items-center gap-2 lg:invisible">
        <svg viewBox="0 0 40 40" fill="none" className="w-8 h-8">
          <path d="M10 32L18 8 22 20 32 4" stroke="#f59e0b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M29 8L32 4 31 12" stroke="#f59e0b" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span className="text-lg font-extrabold text-purple-800">Job Club</span>
      </div>
      <div className="flex items-center gap-3">
        <button className="relative p-1.5" title="Notifications">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px] text-stone-500">
            <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
          </svg>
          <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
        </button>
        <button onClick={() => router.push('/profile')}
          className="w-8 h-8 rounded-full bg-purple-50 border-2 border-purple-300 flex items-center justify-center text-xs font-bold text-purple-700">
          {session?.user?.name?.[0]?.toUpperCase() || '?'}
        </button>
      </div>
    </header>
  )
}
