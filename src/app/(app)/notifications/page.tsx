'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/components/LanguageContext'
import { timeAgo } from '@/lib/utils'

interface Notification {
  id: string
  type: string
  title: string
  message: string
  jobId: string | null
  linkUrl: string | null
  read: boolean
  createdAt: string
}

export default function NotificationsPage() {
  const router = useRouter()
  const { t, language } = useTranslation()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [total, setTotal] = useState(0)

  useEffect(() => {
    fetchNotifications(0)
  }, [])

  async function fetchNotifications(skip: number) {
    try {
      const res = await fetch(`/api/notifications?skip=${skip}&take=20`)
      if (res.ok) {
        const data = await res.json()
        if (skip === 0) {
          setNotifications(data.notifications)
        } else {
          setNotifications(prev => [...prev, ...data.notifications])
        }
        setTotal(data.total)
      }
    } catch {
    } finally {
      setLoading(false)
      setLoadingMore(false)
    }
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

  async function handleClick(notif: Notification) {
    if (!notif.read) {
      try {
        await fetch('/api/notifications', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ids: [notif.id] }),
        })
        setNotifications(prev =>
          prev.map(n => (n.id === notif.id ? { ...n, read: true } : n))
        )
      } catch {}
    }
    if (notif.linkUrl) {
      router.push(notif.linkUrl)
    } else if (notif.jobId) {
      router.push('/feed')
    }
  }

  function loadMore() {
    setLoadingMore(true)
    fetchNotifications(notifications.length)
  }

  const unreadCount = notifications.filter(n => !n.read).length
  const hasMore = notifications.length < total

  if (loading) {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-2xl">
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-white border border-stone-200 animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-2xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900">{t.notifications.title}</h1>
          {unreadCount > 0 && (
            <p className="text-sm text-stone-500 mt-1">{unreadCount} {unreadCount > 1 ? t.notifications.unreadPlural : t.notifications.unread}</p>
          )}
        </div>
        {unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="text-sm text-purple-600 font-medium hover:text-purple-800 transition"
          >
            {t.notifications.markAllRead}
          </button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="text-center py-16">
          <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-stone-100 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-6 h-6 text-stone-400">
              <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 01-3.46 0" />
            </svg>
          </div>
          <p className="text-stone-500 text-sm mb-2">{t.notifications.empty}</p>
          <p className="text-stone-400 text-xs">{t.notifications.emptyHelp} <button onClick={() => router.push('/settings')} className="text-purple-600 hover:underline">{t.notifications.emptyHelpSettings}</button> {t.notifications.emptyHelpEnd}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {notifications.map(notif => (
            <button
              key={notif.id}
              onClick={() => handleClick(notif)}
              className={`w-full text-left px-4 py-3.5 rounded-xl border transition hover:shadow-sm ${
                !notif.read
                  ? 'bg-purple-50/60 border-purple-200 hover:bg-purple-50'
                  : 'bg-white border-stone-200 hover:bg-stone-50'
              }`}
            >
              <div className="flex items-start gap-3">
                <div className={`w-2 h-2 rounded-full mt-2 flex-shrink-0 ${
                  !notif.read ? 'bg-purple-500' : 'bg-transparent'
                }`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <div className="text-sm font-medium text-stone-900">{notif.title}</div>
                    <div className="text-xs text-stone-400 flex-shrink-0">{language === 'fr' ? `Il y a ${timeAgo(new Date(notif.createdAt), language)}` : `${timeAgo(new Date(notif.createdAt), language)} ago`}</div>
                  </div>
                  <div className="text-xs text-stone-500 mt-0.5">{notif.message}</div>
                </div>
              </div>
            </button>
          ))}

          {hasMore && (
            <div className="text-center pt-4">
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="px-6 py-3.5 rounded-lg text-sm font-medium text-purple-700 bg-purple-50 hover:bg-purple-100 transition disabled:opacity-50"
              >
                {loadingMore ? t.common.loading : t.notifications.loadMore}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
