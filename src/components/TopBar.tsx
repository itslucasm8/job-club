'use client'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useRef } from 'react'
import { useTranslation } from '@/components/LanguageContext'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  jobId: string | null
  read: boolean
  createdAt: string
}

export default function TopBar({ onJobClick }: { onJobClick?: (jobId: string) => void }) {
  const { data: session } = useSession()
  const router = useRouter()
  const { t, language, setLanguage } = useTranslation()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const unreadCount = notifications.filter(n => !n.read).length

  useEffect(() => {
    fetchNotifications()
    // Poll every 60 seconds
    const interval = setInterval(fetchNotifications, 60000)
    return () => clearInterval(interval)
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  async function fetchNotifications() {
    try {
      const res = await fetch('/api/notifications?take=20')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.notifications || data)
      }
    } catch {}
  }

  async function markAllRead() {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markAllRead: true }),
      })
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
    } catch {}
  }

  async function handleNotificationClick(notif: Notification) {
    // Mark as read
    if (!notif.read) {
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [notif.id] }),
        })
        setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n))
      } catch {}
    }
    // Navigate to feed (optionally could open modal)
    if (notif.jobId) {
      setShowDropdown(false)
      router.push('/feed')
    }
  }

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return `${days}j`
  }

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
        {/* Language toggle */}
        <button
          onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
          className="px-2 py-1 rounded-lg text-xs font-bold bg-stone-100 hover:bg-stone-200 text-stone-600 transition"
        >
          {t.language.label}
        </button>

        {/* Notification bell */}
        <div className="relative" ref={dropdownRef}>
          <button
            className="relative p-1.5"
            title={t.notifications.title}
            onClick={() => setShowDropdown(!showDropdown)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-[22px] h-[22px] text-stone-500">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
            </svg>
            {unreadCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 rounded-full text-[10px] font-bold text-white px-1">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </button>

          {/* Dropdown */}
          {showDropdown && (
            <div className="absolute right-0 top-full mt-2 w-80 max-sm:fixed max-sm:left-2 max-sm:right-2 max-sm:w-auto bg-white rounded-xl shadow-xl border border-stone-200 overflow-hidden z-50 animate-dropdown-enter">
              <div className="flex items-center justify-between px-4 py-3 border-b border-stone-100">
                <span className="text-sm font-bold text-stone-800">{t.notifications.title}</span>
                {unreadCount > 0 && (
                  <button onClick={markAllRead} className="text-xs text-purple-600 font-medium hover:text-purple-800">
                    {t.notifications.markAllRead}
                  </button>
                )}
              </div>
              <div className="max-h-80 overflow-y-auto">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-stone-400">
                    {t.notifications.noNotifications}
                  </div>
                ) : (
                  notifications.map(notif => (
                    <button
                      key={notif.id}
                      onClick={() => handleNotificationClick(notif)}
                      className={`w-full text-left px-4 py-3 hover:bg-stone-50 transition border-b border-stone-50 ${!notif.read ? 'bg-purple-50/50' : ''}`}
                    >
                      <div className="flex items-start gap-3">
                        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${!notif.read ? 'bg-purple-500' : 'bg-transparent'}`} />
                        <div className="min-w-0">
                          <div className="text-sm font-medium text-stone-800 truncate">{notif.title}</div>
                          <div className="text-xs text-stone-500 truncate">{notif.message}</div>
                          <div className="text-[11px] text-stone-400 mt-0.5">{timeAgo(notif.createdAt)}</div>
                        </div>
                      </div>
                    </button>
                  ))
                )}
                {notifications.length > 0 && (
                  <button
                    onClick={() => { setShowDropdown(false); router.push('/notifications') }}
                    className="w-full text-center py-2.5 text-xs font-medium text-purple-600 hover:bg-stone-50 transition border-t border-stone-100"
                  >
                    {t.notifications.viewAll}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <button onClick={() => router.push('/profile')}
          className="w-8 h-8 rounded-full bg-purple-50 border-2 border-purple-300 flex items-center justify-center text-xs font-bold text-purple-700">
          {session?.user?.name?.[0]?.toUpperCase() || '?'}
        </button>
      </div>
    </header>
  )
}
