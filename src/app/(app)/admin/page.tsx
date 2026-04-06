'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'

type User = {
  id: string
  email: string
  name: string | null
  role: string
  createdAt: string
}

export default function AdminPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [extracting, setExtracting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [url, setUrl] = useState('')
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({
    title: '', company: '', state: '', location: '', category: '', type: 'casual', pay: '', description: '', sourceUrl: '', eligible88Days: false,
  })

  // User management
  const [users, setUsers] = useState<User[]>([])
  const [usersLoading, setUsersLoading] = useState(true)
  const [togglingUser, setTogglingUser] = useState<string | null>(null)

  useEffect(() => {
    fetchUsers()
  }, [])

  async function fetchUsers() {
    try {
      const res = await fetch('/api/admin/users')
      if (res.ok) {
        const data = await res.json()
        setUsers(data)
      }
    } catch (err) {
      console.error('Erreur lors du chargement des utilisateurs:', err)
    } finally {
      setUsersLoading(false)
    }
  }

  async function toggleUserRole(userId: string, currentRole: string) {
    // Prevent self-demotion
    if (userId === (session?.user as any)?.id && currentRole === 'admin') {
      alert('Tu ne peux pas te rétrograder toi-même')
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
        const updated = await res.json()
        setUsers(users.map(u => u.id === userId ? { ...u, role: updated.role } : u))
      } else {
        alert('Erreur lors de la mise à jour du rôle')
      }
    } catch (err) {
      console.error('Erreur:', err)
      alert('Erreur lors de la mise à jour du rôle')
    } finally {
      setTogglingUser(null)
    }
  }

  function formatDate(dateString: string) {
    const date = new Date(dateString)
    return date.toLocaleDateString('fr-FR', { year: 'numeric', month: 'short', day: 'numeric' })
  }

  function set(key: string, val: string) { setForm(prev => ({ ...prev, [key]: val })) }

  async function handleExtract() {
    if (!url) return
    setExtracting(true)
    try {
      const res = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()

      // Track which fields were actually populated from extraction
      const fieldsToHighlight = new Set<string>()
      const updates: any = {}

      // Update all fields from extracted data
      if (data.title && data.title !== form.title) {
        updates.title = data.title
        fieldsToHighlight.add('title')
      }
      if (data.company && data.company !== form.company) {
        updates.company = data.company
        fieldsToHighlight.add('company')
      }
      if (data.state && data.state !== form.state) {
        updates.state = data.state
        fieldsToHighlight.add('state')
      }
      if (data.location && data.location !== form.location) {
        updates.location = data.location
        fieldsToHighlight.add('location')
      }
      if (data.category && data.category !== form.category) {
        updates.category = data.category
        fieldsToHighlight.add('category')
      }
      if (data.pay && data.pay !== form.pay) {
        updates.pay = data.pay
        fieldsToHighlight.add('pay')
      }
      if (data.description && data.description !== form.description) {
        updates.description = data.description
        fieldsToHighlight.add('description')
      }

      updates.sourceUrl = url

      setForm(prev => ({ ...prev, ...updates }))
      setHighlightedFields(fieldsToHighlight)

      // Clear highlight after 2 seconds
      setTimeout(() => setHighlightedFields(new Set()), 2000)
    } catch (err) {
      console.error('Extraction error:', err)
    }
    setExtracting(false)
  }

  async function handlePublish() {
    if (!form.title || !form.company || !form.state || !form.category || !form.description) {
      alert('Remplis tous les champs obligatoires *')
      return
    }
    setPublishing(true)
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) {
      router.push('/feed')
    } else {
      alert('Erreur lors de la publication')
    }
    setPublishing(false)
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Publier une offre</h1>
      <p className="text-sm text-stone-500 mb-6">Ajoute un nouveau job pour la communauté</p>

      {/* URL Extract */}
      <div className="mb-8">
        <h2 className="text-base font-bold text-stone-800 mb-2">&#9889; Extraction automatique</h2>
        <p className="text-[13px] text-stone-500 mb-3">Colle un lien Gumtree, Seek ou Facebook et on pré-remplit le formulaire.</p>
        <div className="flex gap-2">
          <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.gumtree.com.au/..."
            className="flex-1 px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400" />
          <button onClick={handleExtract} disabled={extracting}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-bold bg-amber-400 hover:bg-amber-300 text-stone-900 transition ${extracting ? 'animate-pulse' : ''}`}>
            {extracting ? 'Extraction...' : 'Extraire'}
          </button>
        </div>
      </div>

      {/* Form */}
      <h2 className="text-base font-bold text-stone-800 mb-4">Détails du poste</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Field label="Titre du poste *" value={form.title} onChange={v => set('title', v)} placeholder="ex: Fruit Picker - Bundaberg" highlighted={highlightedFields.has('title')} />
        <Field label="Entreprise *" value={form.company} onChange={v => set('company', v)} placeholder="ex: Sunny Farms QLD" highlighted={highlightedFields.has('company')} />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">State *</label>
          <select value={form.state} onChange={e => set('state', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none bg-white appearance-none transition-all ${
              highlightedFields.has('state')
                ? 'border-green-400 bg-green-50 focus:border-green-500'
                : 'border-stone-200 focus:border-purple-400'
            }`}>
            <option value="">Sélectionner...</option>
            <option value="QLD">Queensland (QLD)</option><option value="NSW">New South Wales (NSW)</option>
            <option value="VIC">Victoria (VIC)</option><option value="SA">South Australia (SA)</option>
            <option value="WA">Western Australia (WA)</option><option value="TAS">Tasmania (TAS)</option>
            <option value="NT">Northern Territory (NT)</option><option value="ACT">ACT</option>
          </select>
        </div>
        <Field label="Ville / Région" value={form.location} onChange={v => set('location', v)} placeholder="ex: Bundaberg" highlighted={highlightedFields.has('location')} />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">Catégorie *</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none bg-white appearance-none transition-all ${
              highlightedFields.has('category')
                ? 'border-green-400 bg-green-50 focus:border-green-500'
                : 'border-stone-200 focus:border-purple-400'
            }`}>
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
            <option value="casual">Casual</option><option value="full_time">Temps plein</option>
            <option value="part_time">Temps partiel</option><option value="contract">Contrat</option>
          </select>
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
      </div>
      <div className="mb-4">
        <Field label="Salaire (optionnel)" value={form.pay} onChange={v => set('pay', v)} placeholder="ex: $28-32/h ou Piece rate" highlighted={highlightedFields.has('pay')} />
      </div>
      <div className="mb-6">
        <label className="block text-[13px] font-semibold text-stone-600 mb-1">Description *</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={5} placeholder="Décris le poste, les conditions, comment postuler..."
          className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none resize-y transition-all ${
            highlightedFields.has('description')
              ? 'border-green-400 bg-green-50 focus:border-green-500'
              : 'border-stone-200 focus:border-purple-400'
          }`} />
      </div>

      <button onClick={handlePublish} disabled={publishing}
        className="w-full py-3.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50">
        {publishing ? 'Publication...' : '🚀 Publier l\'offre'}
      </button>

      {/* User Management Section */}
      <div className="mt-12 pt-12 border-t border-stone-200">
        <h2 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Gestion des utilisateurs</h2>
        <p className="text-sm text-stone-500 mb-6">Gérez les rôles des utilisateurs et les permissions d'administrateur</p>

        {usersLoading ? (
          <div className="text-center py-8 text-stone-500">Chargement des utilisateurs...</div>
        ) : users.length === 0 ? (
          <div className="text-center py-8 text-stone-500">Aucun utilisateur trouvé</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b-2 border-stone-200">
                  <th className="text-left px-4 py-3 font-semibold text-sm text-stone-700">Nom</th>
                  <th className="text-left px-4 py-3 font-semibold text-sm text-stone-700">Email</th>
                  <th className="text-left px-4 py-3 font-semibold text-sm text-stone-700">Rôle</th>
                  <th className="text-left px-4 py-3 font-semibold text-sm text-stone-700">Inscription</th>
                  <th className="text-center px-4 py-3 font-semibold text-sm text-stone-700">Action</th>
                </tr>
              </thead>
              <tbody>
                {users.map(user => (
                  <tr key={user.id} className="border-b border-stone-100 hover:bg-stone-50 transition">
                    <td className="px-4 py-3 text-sm text-stone-900">{user.name || 'N/A'}</td>
                    <td className="px-4 py-3 text-sm text-stone-700">{user.email}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`inline-block px-2.5 py-1 rounded-full text-xs font-semibold ${
                        user.role === 'admin'
                          ? 'bg-purple-100 text-purple-700'
                          : 'bg-stone-100 text-stone-700'
                      }`}>
                        {user.role === 'admin' ? 'Admin' : 'Utilisateur'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-stone-600">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3 text-center">
                      <button
                        onClick={() => toggleUserRole(user.id, user.role)}
                        disabled={togglingUser === user.id || (user.id === (session?.user as any)?.id && user.role === 'admin')}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                          user.role === 'admin'
                            ? 'bg-amber-100 hover:bg-amber-200 text-amber-900 disabled:opacity-50'
                            : 'bg-purple-100 hover:bg-purple-200 text-purple-900 disabled:opacity-50'
                        }`}
                      >
                        {togglingUser === user.id ? '...' : (user.role === 'admin' ? 'Rétrograder' : 'Promouvoir')}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, placeholder, highlighted = false }: { label: string; value: string; onChange: (v: string) => void; placeholder: string; highlighted?: boolean }) {
  return (
    <div>
      <label className="block text-[13px] font-semibold text-stone-600 mb-1">{label}</label>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none transition-all ${
          highlighted
            ? 'border-green-400 bg-green-50 focus:border-green-500'
            : 'border-stone-200 focus:border-purple-400'
        }`} />
    </div>
  )
}
