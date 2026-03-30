'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function AdminPage() {
  const router = useRouter()
  const [extracting, setExtracting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [url, setUrl] = useState('')
  const [form, setForm] = useState({
    title: '', company: '', state: '', location: '', category: '', type: 'casual', pay: '', description: '', applyUrl: '', sourceUrl: '',
  })

  function set(key: string, val: string) { setForm(prev => ({ ...prev, [key]: val })) }

  async function handleExtract() {
    if (!url) return
    setExtracting(true)
    try {
      const res = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()
      setForm(prev => ({ ...prev, title: data.title || prev.title, description: data.description || prev.description, sourceUrl: url }))
    } catch {}
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
        <Field label="Titre du poste *" value={form.title} onChange={v => set('title', v)} placeholder="ex: Fruit Picker - Bundaberg" />
        <Field label="Entreprise *" value={form.company} onChange={v => set('company', v)} placeholder="ex: Sunny Farms QLD" />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">State *</label>
          <select value={form.state} onChange={e => set('state', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="">Sélectionner...</option>
            <option value="QLD">Queensland (QLD)</option><option value="NSW">New South Wales (NSW)</option>
            <option value="VIC">Victoria (VIC)</option><option value="SA">South Australia (SA)</option>
            <option value="WA">Western Australia (WA)</option><option value="TAS">Tasmania (TAS)</option>
            <option value="NT">Northern Territory (NT)</option><option value="ACT">ACT</option>
          </select>
        </div>
        <Field label="Ville / Région" value={form.location} onChange={v => set('location', v)} placeholder="ex: Bundaberg" />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">Catégorie *</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="">Sélectionner...</option>
            <option value="farm">Agriculture / Ferme</option><option value="hospitality">Hôtellerie / Restauration</option>
            <option value="construction">Construction / BTP</option><option value="trade">Métiers / Trade</option>
            <option value="retail">Commerce / Vente</option>
            <option value="cleaning">Nettoyage / Entretien</option><option value="other">Autre</option>
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">Type de contrat</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="casual">Casual</option><option value="full_time">Temps plein</option>
            <option value="part_time">Temps partiel</option><option value="contract">Contrat</option>
          </select>
        </div>
      </div>
      <div className="mb-4">
        <Field label="Salaire (optionnel)" value={form.pay} onChange={v => set('pay', v)} placeholder="ex: $28-32/h ou Piece rate" />
      </div>
      <div className="mb-4">
        <label className="block text-[13px] font-semibold text-stone-600 mb-1">Description *</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={5} placeholder="Décris le poste, les conditions, comment postuler..."
          className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 resize-y" />
      </div>
      <div className="mb-6">
        <Field label="Lien pour postuler" value={form.applyUrl} onChange={v => set('applyUrl', v)} placeholder="https://..." />
      </div>

      <button onClick={handlePublish} disabled={publishing}
        className="w-full py-3.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50">
        {publishing ? 'Publication...' : '🚀 Publier l\'offre'}
      </button>
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
