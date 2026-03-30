'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

type Job = {
  id: string
  title: string
  company: string
  state: string
  category: string
  createdAt: string
  active: boolean
}

export default function AdminJobsPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [reactivatingId, setReactivatingId] = useState<string | null>(null)

  useEffect(() => {
    fetchJobs()
  }, [])

  async function fetchJobs() {
    setLoading(true)
    try {
      const res = await fetch('/api/admin/jobs')
      if (res.ok) {
        const data = await res.json()
        setJobs(data)
      } else if (res.status === 403) {
        // Not authorized
      } else {
        console.error('Erreur lors du chargement des offres')
      }
    } catch (err) {
      console.error('Erreur lors du chargement des offres:', err)
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(jobId: string) {
    if (!confirm('Êtes-vous sûr de vouloir supprimer cette offre ?')) return

    setDeletingId(jobId)
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'DELETE' })
      if (res.ok) {
        setJobs(jobs.map(j => j.id === jobId ? { ...j, active: false } : j))
      } else {
        alert('Erreur lors de la suppression')
      }
    } catch (err) {
      console.error('Erreur:', err)
      alert('Erreur lors de la suppression')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleReactivate(jobId: string) {
    setReactivatingId(jobId)
    try {
      const res = await fetch(`/api/jobs/${jobId}`, { method: 'PATCH' })
      if (res.ok) {
        setJobs(jobs.map(j => j.id === jobId ? { ...j, active: true } : j))
      } else {
        alert('Erreur lors de la réactivation')
      }
    } catch (err) {
      console.error('Erreur:', err)
      alert('Erreur lors de la réactivation')
    } finally {
      setReactivatingId(null)
    }
  }

  const filteredJobs = jobs.filter(job => {
    const q = searchQuery.toLowerCase()
    return (
      job.title.toLowerCase().includes(q) ||
      job.company.toLowerCase().includes(q)
    )
  })

  const activeCount = filteredJobs.filter(j => j.active).length
  const inactiveCount = filteredJobs.filter(j => !j.active).length

  const categoryLabels: { [key: string]: string } = {
    farm: 'Agriculture',
    hospitality: 'Hôtellerie',
    construction: 'Construction',
    trade: 'Métiers',
    retail: 'Commerce',
    cleaning: 'Nettoyage',
    other: 'Autre',
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 max-w-5xl">
        <p className="text-stone-500">Accès non autorisé</p>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-5xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Gérer les offres</h1>
      <p className="text-sm text-stone-500 mb-6">Modifiez ou supprimez les offres d'emploi publiées</p>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 mb-6">
        <div className="bg-gradient-to-br from-green-50 to-green-100 rounded-lg p-4 border border-green-200">
          <div className="text-2xl font-bold text-green-700">{activeCount}</div>
          <div className="text-xs font-medium text-green-600">Offres actives</div>
        </div>
        <div className="bg-gradient-to-br from-stone-50 to-stone-100 rounded-lg p-4 border border-stone-200">
          <div className="text-2xl font-bold text-stone-700">{inactiveCount}</div>
          <div className="text-xs font-medium text-stone-600">Offres inactives</div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Rechercher par titre ou entreprise..."
          className="w-full px-4 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400"
        />
      </div>

      {/* Jobs Table */}
      {loading ? (
        <div className="text-center py-12 text-stone-500">Chargement des offres...</div>
      ) : filteredJobs.length === 0 ? (
        <div className="text-center py-12 text-stone-500">Aucune offre trouvée</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b-2 border-stone-200">
                <th className="text-left px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">Titre</th>
                <th className="text-left px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">Entreprise</th>
                <th className="text-left px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">State</th>
                <th className="text-left px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">Catégorie</th>
                <th className="text-left px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">Date</th>
                <th className="text-left px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">Statut</th>
                <th className="text-center px-4 py-3 font-semibold text-xs sm:text-sm text-stone-700">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredJobs.map(job => (
                <tr key={job.id} className="border-b border-stone-100 hover:bg-stone-50 transition">
                  <td className="px-4 py-3 text-xs sm:text-sm text-stone-900 font-medium">{job.title}</td>
                  <td className="px-4 py-3 text-xs sm:text-sm text-stone-700">{job.company}</td>
                  <td className="px-4 py-3 text-xs sm:text-sm text-stone-700 font-semibold">{job.state}</td>
                  <td className="px-4 py-3 text-xs sm:text-sm text-stone-700">
                    {categoryLabels[job.category] || job.category}
                  </td>
                  <td className="px-4 py-3 text-xs sm:text-sm text-stone-600">{formatDate(job.createdAt)}</td>
                  <td className="px-4 py-3 text-xs sm:text-sm">
                    <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                      job.active
                        ? 'bg-green-100 text-green-700'
                        : 'bg-stone-100 text-stone-700'
                    }`}>
                      {job.active ? 'Actif' : 'Inactif'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex gap-1 sm:gap-2 justify-center flex-wrap">
                      <button
                        onClick={() => router.push(`/admin/jobs/${job.id}/edit`)}
                        className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-purple-100 hover:bg-purple-200 text-purple-900 transition"
                      >
                        Modifier
                      </button>
                      {job.active && (
                        <button
                          onClick={() => handleDelete(job.id)}
                          disabled={deletingId === job.id}
                          className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-red-100 hover:bg-red-200 text-red-900 transition disabled:opacity-50"
                        >
                          {deletingId === job.id ? '...' : 'Supprimer'}
                        </button>
                      )}
                      {!job.active && (
                        <button
                          onClick={() => handleReactivate(job.id)}
                          disabled={reactivatingId === job.id}
                          className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-bold bg-green-100 hover:bg-green-200 text-green-900 transition disabled:opacity-50"
                        >
                          {reactivatingId === job.id ? '...' : 'Réactiver'}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
