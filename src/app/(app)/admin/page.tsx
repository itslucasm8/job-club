'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { useTranslation } from '@/components/LanguageContext'

type DashboardData = {
  activeJobs: number
  weeklyJobs: number
  eligible88: number
  totalUsers: number
  adminCount: number
  memberCount: number
  activeSubscribers: number
  stateCounts: Record<string, number>
  recentJobs: { id: string; title: string; state: string; location: string; createdAt: string }[]
  adminUsers: { id: string; name: string | null; email: string; role: string; createdAt: string }[]
  latestSignup: { name: string | null; email: string; createdAt: string } | null
  expiredToday: number
  sourcing?: {
    pendingCandidates: number
    autoRejectedWeek: number
    sourcesActive: number
    sourcesBroken: number
    lastRun: { status: string; startedAt: string; completedAt: string | null; totalImported: number; totalErrors: number; totalSources: number } | null
  }
}

export default function AdminDashboardPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const { t, language } = useTranslation()
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [togglingUser, setTogglingUser] = useState<string | null>(null)
  const [expandedUser, setExpandedUser] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [savingPassword, setSavingPassword] = useState(false)
  const [addAdminEmail, setAddAdminEmail] = useState('')
  const [addAdminPassword, setAddAdminPassword] = useState('')
  const [addAdminName, setAddAdminName] = useState('')
  const [addingAdmin, setAddingAdmin] = useState(false)
  const [showAdmins, setShowAdmins] = useState(false)

  useEffect(() => {
    fetch('/api/admin/dashboard')
      .then(res => res.ok ? res.json() : null)
      .then(d => { if (d) setData(d) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  function timeAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    if (diff < 60000) return language === 'fr' ? 'à l\'instant' : 'just now'
    const mins = Math.floor(diff / 60000)
    if (mins < 0) return language === 'fr' ? 'à l\'instant' : 'just now'
    if (mins < 60) return `${mins} min`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h`
    const days = Math.floor(hours / 24)
    return language === 'fr' ? `${days}j` : `${days}d`
  }

  function formatDate(dateString: string) {
    return new Date(dateString).toLocaleDateString(language === 'fr' ? 'fr-FR' : 'en-AU', { day: 'numeric', month: 'short' })
  }

  async function toggleUserRole(userId: string, currentRole: string) {
    if (userId === (session?.user as any)?.id && currentRole === 'admin') {
      alert(t.admin.cannotDemoteSelf)
      return
    }
    const newRole = currentRole === 'admin' ? 'user' : 'admin'
    setTogglingUser(userId)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, role: newRole }),
      })
      if (res.ok) {
        setData(prev => prev ? {
          ...prev,
          adminUsers: newRole === 'admin'
            ? prev.adminUsers
            : prev.adminUsers.filter(u => u.id !== userId),
          adminCount: newRole === 'admin' ? prev.adminCount : prev.adminCount - 1,
          memberCount: newRole === 'admin' ? prev.memberCount : prev.memberCount + 1,
        } : prev)
      } else {
        alert(t.admin.roleUpdateError)
      }
    } catch { alert(t.admin.roleUpdateError) }
    finally { setTogglingUser(null) }
  }

  async function resetPassword(userId: string) {
    if (!newPassword || newPassword.length < 6) {
      alert(language === 'fr' ? 'Mot de passe trop court (min 6 caractères)' : 'Password too short (min 6 characters)')
      return
    }
    setSavingPassword(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, newPassword }),
      })
      if (res.ok) {
        setNewPassword('')
        setExpandedUser(null)
        alert(language === 'fr' ? 'Mot de passe mis à jour' : 'Password updated')
      } else {
        alert(language === 'fr' ? 'Erreur' : 'Error')
      }
    } catch { alert(language === 'fr' ? 'Erreur réseau' : 'Network error') }
    finally { setSavingPassword(false) }
  }

  async function addAdmin() {
    if (!addAdminEmail.trim() || !addAdminPassword.trim()) return
    if (addAdminPassword.length < 6) {
      alert(language === 'fr' ? 'Mot de passe trop court (min 6 caractères)' : 'Password too short (min 6 characters)')
      return
    }
    setAddingAdmin(true)
    try {
      const res = await fetch('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: addAdminEmail.trim(), password: addAdminPassword, name: addAdminName.trim() || undefined }),
      })
      if (res.ok) {
        const newAdmin = await res.json()
        setData(prev => prev ? {
          ...prev,
          adminUsers: [newAdmin, ...prev.adminUsers],
          adminCount: prev.adminCount + 1,
          totalUsers: prev.totalUsers + 1,
        } : prev)
        setAddAdminEmail('')
        setAddAdminPassword('')
        setAddAdminName('')
        alert(language === 'fr' ? 'Administrateur créé !' : 'Administrator created!')
      } else {
        const err = await res.json()
        alert(err.error || 'Erreur')
      }
    } catch { alert(language === 'fr' ? 'Erreur réseau' : 'Network error') }
    finally { setAddingAdmin(false) }
  }

  const stateOrder = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT']

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">{t.common.unauthorized}</p></div>
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-5xl">
        <div className="animate-pulse space-y-4">
          <div className="h-7 bg-stone-200 rounded w-48"></div>
          <div className="h-4 bg-stone-100 rounded w-64"></div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mt-6">
            {[1,2,3,4].map(i => <div key={i} className="h-24 bg-stone-100 rounded-xl"></div>)}
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">{t.common.networkError}</p></div>
  }

  const subscriberLabel = data.activeSubscribers === 1
    ? (language === 'fr' ? 'abonné payant' : 'paying subscriber')
    : (language === 'fr' ? 'abonnés payants' : 'paying subscribers')

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-5xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">
        {t.admin.dashboardTitle || 'Tableau de bord'}
      </h1>
      <p className="text-sm text-stone-500 mb-6">
        {t.admin.dashboardSubtitle || "Vue d'ensemble de votre Job Club"}
      </p>

      {/* Sourcing pipeline — daily-action panel. Lives above the stat cards
          so the team's eye lands on what's waiting for them, not on metrics. */}
      {data.sourcing && (
        <SourcingPanel sourcing={data.sourcing} router={router} />
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        <StatCard
          label={t.admin.activeJobs || 'Annonces actives'}
          value={data.activeJobs}
          sub={`+${data.weeklyJobs} ${t.admin.thisWeek || 'cette semaine'}`}
          color="purple"
        />
        <StatCard
          label={t.admin.users || 'Utilisateurs'}
          value={data.totalUsers}
          sub={`${data.adminCount} ${t.admin.adminsCount || 'admins'} · ${data.memberCount} ${t.admin.membersCount || 'membres'}`}
          color="green"
        />
        <StatCard
          label={t.admin.activeSubscribers || 'Abonnés actifs'}
          value={data.activeSubscribers}
          sub={`${data.activeSubscribers} ${subscriberLabel}`}
          color="amber"
        />
        <StatCard
          label={t.admin.eligible88 || 'Annonces 88 jours'}
          value={data.eligible88}
          sub={`${data.activeJobs > 0 ? Math.round((data.eligible88 / data.activeJobs) * 100) : 0}% ${t.admin.ofTotal || 'du total'}`}
          color="blue"
        />
      </div>

      {/* Recent Activity */}
      <div className="bg-white border border-stone-200 rounded-lg overflow-hidden mb-6">
        <div className="flex items-center justify-between px-4 sm:px-5 py-3 border-b border-stone-200">
          <h2 className="text-base font-bold text-stone-800">
            {t.admin.recentActivity || 'Activité récente'}
          </h2>
          <button onClick={() => router.push('/admin/jobs')} className="text-xs text-purple-600 font-semibold hover:text-purple-800">
            {t.admin.viewAll || 'Voir tout'} ›
          </button>
        </div>
        {data.recentJobs.slice(0, 4).map(job => (
          <div key={job.id} className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-stone-100 text-xs sm:text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0"></div>
            <span className="truncate">
              <strong>{job.title}</strong> — {job.location ? `${job.location}, ${job.state}` : job.state}
              {' '}{t.admin.published || 'publiée'}
            </span>
            <span className="ml-auto text-stone-400 text-[11px] flex-shrink-0">{timeAgo(job.createdAt)}</span>
          </div>
        ))}
        {data.latestSignup && (
          <div className="flex items-center gap-3 px-4 sm:px-5 py-3 border-b border-stone-100 text-xs sm:text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0"></div>
            <span>
              <strong>{data.latestSignup.name || data.latestSignup.email}</strong>
              {' '}{t.admin.registered || "s'est inscrit(e)"}
            </span>
            <span className="ml-auto text-stone-400 text-[11px] flex-shrink-0">{timeAgo(data.latestSignup.createdAt)}</span>
          </div>
        )}
        {data.expiredToday > 0 && (
          <div className="flex items-center gap-3 px-4 sm:px-5 py-3 text-xs sm:text-sm">
            <div className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0"></div>
            <span>
              <strong>{data.expiredToday} {language === 'fr' ? 'annonces' : 'jobs'}</strong>
              {' '}{t.admin.expired || 'expirées (30 jours)'}
            </span>
            <span className="ml-auto text-stone-400 text-[11px] flex-shrink-0">
              {t.admin.today || "aujourd'hui"}
            </span>
          </div>
        )}
      </div>

      {/* Two-column: Jobs by State + Admin Users */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Jobs by State */}
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <div className="px-4 sm:px-5 py-3 border-b border-stone-200">
            <h2 className="text-base font-bold text-stone-800">
              {t.admin.jobsByState || 'Annonces par état'}
            </h2>
          </div>
          <div className="p-4 grid grid-cols-3 sm:grid-cols-4 gap-2">
            {stateOrder.map(state => (
              <button key={state} onClick={() => router.push(`/feed?state=${state}`)}
                className="text-center py-3 px-1 bg-purple-50 hover:bg-purple-100 rounded-lg transition cursor-pointer">
                <div className="text-lg font-extrabold text-purple-800">{data.stateCounts[state] || 0}</div>
                <div className="text-[10px] font-semibold text-purple-600">{state}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Admin Users — collapsed by default. One-line summary; click to expand
            for password reset / role toggle / create admin. Setup task, not
            something to confront the team with on every dashboard load. */}
        <div className="bg-white border border-stone-200 rounded-lg overflow-hidden">
          <button
            onClick={() => setShowAdmins(s => !s)}
            className="w-full flex items-center justify-between px-4 sm:px-5 py-3 border-b border-stone-200 hover:bg-stone-50 transition"
          >
            <h2 className="text-base font-bold text-stone-800">Team</h2>
            <span className="flex items-center gap-2 text-xs text-stone-500">
              {data.adminCount} {data.adminCount === 1 ? 'admin' : 'admins'}
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-3.5 h-3.5 transition-transform ${showAdmins ? 'rotate-180' : ''}`}>
                <path d="M6 9l6 6 6-6" />
              </svg>
            </span>
          </button>
          {showAdmins && (
          <>
          <div className="divide-y divide-stone-100">
            {data.adminUsers.map(user => {
              const isExpanded = expandedUser === user.id
              const isSelf = user.id === (session?.user as any)?.id
              return (
                <div key={user.id}>
                  <button
                    onClick={() => { setExpandedUser(isExpanded ? null : user.id); setNewPassword('') }}
                    className="flex items-center gap-3 px-4 sm:px-5 py-3 w-full text-left hover:bg-stone-50 transition"
                  >
                    <div className="w-8 h-8 rounded-full bg-purple-50 border-2 border-purple-200 flex items-center justify-center text-xs font-bold text-purple-700 flex-shrink-0">
                      {(user.name || user.email)[0].toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold text-stone-900 truncate">{user.name || 'N/A'}{isSelf ? ' (toi)' : ''}</div>
                      <div className="text-xs text-stone-400 truncate">{user.email}</div>
                    </div>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={`w-4 h-4 text-stone-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                      <path d="M6 9l6 6 6-6"/>
                    </svg>
                  </button>
                  {isExpanded && (
                    <div className="px-4 sm:px-5 pb-4 pt-1 bg-stone-50 space-y-3">
                      {/* Email (copyable) */}
                      <div>
                        <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">Email</div>
                        <div className="text-sm text-stone-800 font-mono bg-white px-3 py-2 rounded-lg border border-stone-200 select-all">
                          {user.email}
                        </div>
                      </div>
                      {/* Reset password */}
                      <div>
                        <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-1">
                          {language === 'fr' ? 'Nouveau mot de passe' : 'New password'}
                        </div>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={newPassword}
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder={language === 'fr' ? '6 caractères minimum' : '6 characters minimum'}
                            className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
                          />
                          <button
                            onClick={() => resetPassword(user.id)}
                            disabled={savingPassword || !newPassword}
                            className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-50"
                          >
                            {savingPassword ? '...' : (language === 'fr' ? 'Changer' : 'Change')}
                          </button>
                        </div>
                      </div>
                      {/* Demote */}
                      {!isSelf && (
                        <button
                          onClick={() => toggleUserRole(user.id, user.role)}
                          disabled={togglingUser === user.id}
                          className="w-full py-2 rounded-lg text-xs font-bold bg-amber-100 hover:bg-amber-200 text-amber-900 transition disabled:opacity-50"
                        >
                          {togglingUser === user.id ? '...' : (language === 'fr' ? 'Retirer les droits admin' : 'Remove admin rights')}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          {/* Create admin */}
          <div className="px-4 sm:px-5 py-3 border-t border-stone-200 bg-stone-50">
            <div className="text-[10px] font-semibold text-stone-500 uppercase tracking-wider mb-2">
              {language === 'fr' ? 'Créer un administrateur' : 'Create an administrator'}
            </div>
            <div className="space-y-2">
              <input
                type="text"
                value={addAdminName}
                onChange={e => setAddAdminName(e.target.value)}
                placeholder={language === 'fr' ? 'Prénom (optionnel)' : 'Name (optional)'}
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
              />
              <input
                type="email"
                value={addAdminEmail}
                onChange={e => setAddAdminEmail(e.target.value)}
                placeholder="Email"
                className="w-full px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={addAdminPassword}
                  onChange={e => setAddAdminPassword(e.target.value)}
                  placeholder={language === 'fr' ? 'Mot de passe (min 6 car.)' : 'Password (min 6 chars)'}
                  className="flex-1 px-3 py-2 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
                  onKeyDown={e => e.key === 'Enter' && addAdmin()}
                />
                <button
                  onClick={addAdmin}
                  disabled={addingAdmin || !addAdminEmail.trim() || !addAdminPassword.trim()}
                  className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-600 hover:bg-purple-700 text-white transition disabled:opacity-50"
                >
                  {addingAdmin ? '...' : (language === 'fr' ? 'Créer' : 'Create')}
                </button>
              </div>
            </div>
          </div>
          </>
          )}
        </div>
      </div>
    </div>
  )
}

function SourcingPanel({
  sourcing,
  router,
}: {
  sourcing: NonNullable<DashboardData['sourcing']>
  router: ReturnType<typeof useRouter>
}) {
  const [running, setRunning] = useState(false)
  const lr = sourcing.lastRun
  const lrAgeMin = lr ? Math.floor((Date.now() - new Date(lr.startedAt).getTime()) / 60000) : null
  const lrAgo = lrAgeMin == null ? null : lrAgeMin < 60 ? `${lrAgeMin}m ago` : lrAgeMin < 1440 ? `${Math.floor(lrAgeMin / 60)}h ago` : `${Math.floor(lrAgeMin / 1440)}d ago`

  async function runAll() {
    setRunning(true)
    try {
      const res = await fetch('/api/admin/sources/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
      if (res.ok) {
        // Send the operator to the sources page where the full progress card lives.
        router.push('/admin/sources')
      } else {
        const d = await res.json().catch(() => ({}))
        alert(d.error || 'Could not start scan')
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="bg-white border border-stone-200 rounded-lg overflow-hidden mb-6">
      <div className="px-4 sm:px-5 py-3 border-b border-stone-200 flex items-center justify-between">
        <h2 className="text-base font-bold text-stone-800">Sourcing pipeline</h2>
        <button
          onClick={runAll}
          disabled={running || sourcing.sourcesActive === 0}
          className="px-3 py-1.5 rounded-md text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50"
        >
          {running ? 'Starting…' : `▶ Run all (${sourcing.sourcesActive})`}
        </button>
      </div>

      <button
        onClick={() => router.push('/admin/candidates')}
        className="w-full px-4 sm:px-5 py-4 flex items-center justify-between hover:bg-purple-50/50 transition border-b border-stone-100 text-left"
      >
        <div>
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-extrabold text-purple-700 tabular-nums">{sourcing.pendingCandidates}</span>
            <span className="text-sm font-semibold text-stone-700">candidates pending review</span>
          </div>
          <div className="text-xs text-stone-500 mt-0.5">
            {sourcing.autoRejectedWeek > 0
              ? `Classifier auto-rejected ${sourcing.autoRejectedWeek} this week`
              : 'No auto-rejects this week'}
          </div>
        </div>
        <span className="text-purple-700 font-bold text-sm">Review →</span>
      </button>

      <div className="px-4 sm:px-5 py-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <button
          onClick={() => router.push('/admin/sources')}
          className="text-left p-2 rounded hover:bg-stone-50 transition"
        >
          <div className="text-stone-500 mb-0.5">Sources</div>
          <div className="font-semibold text-stone-900">
            {sourcing.sourcesActive} active
            {sourcing.sourcesBroken > 0 && (
              <span className="ml-1 text-red-700 font-bold">· {sourcing.sourcesBroken} broken</span>
            )}
          </div>
        </button>
        <div className="p-2">
          <div className="text-stone-500 mb-0.5">Last scan</div>
          {lr ? (
            <div className="font-semibold text-stone-900">
              {lr.status === 'completed' && '✓'}
              {lr.status === 'failed' && '✗'}
              {(lr.status === 'running' || lr.status === 'pending') && '⏳'}
              {' '}
              {lr.totalImported} imported
              {lr.totalErrors > 0 && <span className="text-red-700"> · {lr.totalErrors} errors</span>}
              <span className="ml-1 font-normal text-stone-500">· {lrAgo}</span>
            </div>
          ) : (
            <div className="font-semibold text-stone-500">Never run</div>
          )}
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub: string; color: 'purple' | 'green' | 'amber' | 'blue' }) {
  const styles = {
    purple: { card: 'bg-gradient-to-br from-purple-50 to-purple-100 border-purple-200', value: 'text-purple-700', label: 'text-purple-600', sub: 'text-purple-500' },
    green: { card: 'bg-gradient-to-br from-green-50 to-green-100 border-green-200', value: 'text-green-700', label: 'text-green-600', sub: 'text-green-500' },
    amber: { card: 'bg-gradient-to-br from-amber-50 to-amber-100 border-amber-200', value: 'text-amber-700', label: 'text-amber-600', sub: 'text-amber-500' },
    blue: { card: 'bg-gradient-to-br from-blue-50 to-blue-100 border-blue-200', value: 'text-blue-700', label: 'text-blue-600', sub: 'text-blue-500' },
  }
  const s = styles[color]
  return (
    <div className={`rounded-lg p-4 border ${s.card}`}>
      <div className={`text-xs font-medium ${s.label} mb-1`}>{label}</div>
      <div className={`text-2xl font-bold ${s.value}`}>{value.toLocaleString()}</div>
      <div className={`text-[11px] ${s.sub} mt-0.5`}>{sub}</div>
    </div>
  )
}
