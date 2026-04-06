'use client'
import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { useSession } from 'next-auth/react'

type JobForm = {
  title: string
  company: string
  state: string
  location: string
  category: string
  type: string
  pay: string
  description: string
  applyUrl?: string
  sourceUrl?: string
  eligible88Days: boolean
}

export default function EditJobPage() {
  const router = useRouter()
  const params = useParams()
  const { data: session } = useSession()
  const jobId = params.id as string

  const [form, setForm] = useState<JobForm>({
    title: '',
    company: '',
    state: '',
    location: '',
    category: '',
    type: 'casual',
    pay: '',
    description: '',
    applyUrl: '',
    sourceUrl: '',
    eligible88Days: false,
  })

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchJob()
  }, [jobId])

  async function fetchJob() {
    try {
      const res = await fetch(`/api/jobs/${jobId}`)
      if (res.ok) {
        const job = await res.json()
        setForm({
          title: job.title,
          company: job.company,
          state: job.state,
          location: job.location || '',
          category: job.category,
          type: job.type || 'casual',
          pay: job.pay || '',
          description: job.description,
          applyUrl: job.applyUrl || '',
          sourceUrl: job.sourceUrl || '',
          eligible88Days: job.eligible88Days ?? false,
        })
      } else {
        setError('Offre introuvable')
      }
    } catch (err) {
      console.error('Erreur:', err)
      setError('Erreur lors du chargement de l\'offre')
    } finally {
      setLoading(false)
    }
  }

  function set(key: keyof JobForm, val: string) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  async function handleSave() {
    if (!form.title || !form.company || !form.state || !form.category || !form.description) {
      setError('Remplis tous les champs obligatoires *')
      return
    }

    setSaving(true)
    setError('')

    try {
      const res = await fetch(`/api/jobs/${jobId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })

      if (res.ok) {
        router.push('/admin/jobs')
      } else {
        const data = await res.json()
        setError(data.error || 'Erreur lors de la sauvegarde')
      }
    } catch (err) {
      console.error('Erreur:', err)
      setError('Erreur lors de la sauvegarde')
    } finally {
      setSaving(false)
    }
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 max-w-3xl">
        <p className="text-stone-500">Accès non autorisé</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 max-w-3xl">
        <p className="text-stone-500">Chargement de l'offre...</p>
      </div>
    )
  }

  if (error && loading) {
    return (
      <div className="px-4 sm:px-5 lg:px-7 py-5 max-w-3xl">
        <p className="text-red-600">{error}</p>
      </div>
    )
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Modifier l'offre</h1>
      <p className="text-sm text-stone-500 mb-6">Mets à jour les détails du poste</p>

      {error && !loading && (
        <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-200">
          <p className="text-sm text-red-700">{error}</p>
        </div>
      )}

      {/* Form */}
      <h2 className="text-base font-bold text-stone-800 mb-4">Détails du poste</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Field label="Titre du poste *" value={form.title} onChange={v => set('title', v)} placeholder="ex: Fruit Picker - Bundaberg" />
        <Field label="Entreprise *" value={form.company} onChange={v => set('company', v)} placeholder="ex: Sunny Farms QLD" />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">State *</label>
          <select value={form.state} onChange={e => set('state', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="">Sélectionner...</option>
            <option value="QLD">Queensland (QLD)</option>
            <option value="NSW">New South Wales (NSW)</option>
            <option value="VIC">Victoria (VIC)</option>
            <option value="SA">South Australia (SA)</option>
            <option value="WA">Western Australia (WA)</option>
            <option value="TAS">Tasmania (TAS)</option>
            <option value="NT">Northern Territory (NT)</option>
            <option value="ACT">ACT</option>
          </select>
        </div>
        <Field label="Ville / Région" value={form.location} onChange={v => set('location', v)} placeholder="ex: Bundaberg" />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">Catégorie *</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="">Sélectionner...</option>
            <option value="farm">Agriculture / Ferme</option>
            <option value="hospitality">Hôtellerie / Restauration</option>
            <option value="construction">Construction / BTP</option>
            <option value="retail">Commerce / Vente</option>
            <option value="cleaning">Nettoyage / Entretien</option>
            <option value="events">Événements / Festivals</option>
            <option value="animals">Animaux / Animalier</option>
            <option value="transport">Transport / Livraison</option>
            <option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">Type de contrat</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="casual">Casual</option>
            <option value="full_time">Temps plein</option>
            <option value="part_time">Temps partiel</option>
            <option value="contract">Contrat</option>
          </select>
        </div>
      </div>
      <div className="mb-4">
        <Field label="Salaire (optionnel)" value={form.pay} onChange={v => set('pay', v)} placeholder="ex: $28-32/h ou Piece rate" />
      </div>
      <div className="mb-6">
        <label className="block text-[13px] font-semibold text-stone-600 mb-1">Description *</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={5} placeholder="Décris le poste, les conditions, comment postuler..."
          className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 resize-y" />
        <label className="flex items-center gap-2 cursor-pointer mt-3">
          <input
            type="checkbox"
            checked={form.eligible88Days}
            onChange={e => setForm({ ...form, eligible88Days: e.target.checked })}
            className="w-4 h-4 rounded border-stone-300 text-yellow-500 focus:ring-yellow-400"
          />
          <span className="text-sm font-medium text-stone-700">Éligible 88 jours</span>
        </label>
      </div>

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex-1 py-3.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50"
        >
          {saving ? 'Enregistrement...' : 'Enregistrer'}
        </button>
        <button
          onClick={() => router.push('/admin/jobs')}
          className="px-6 py-3.5 rounded-xl bg-stone-200 hover:bg-stone-300 text-stone-900 font-bold text-[15px] transition"
        >
          Annuler
        </button>
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-stone-600 mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400" />
    </div>
  )
}
