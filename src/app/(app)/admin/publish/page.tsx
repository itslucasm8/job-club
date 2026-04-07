'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useTranslation } from '@/components/LanguageContext'

export default function PublishJobPage() {
  const router = useRouter()
  const { t, language } = useTranslation()
  const [extracting, setExtracting] = useState(false)
  const [publishing, setPublishing] = useState(false)
  const [url, setUrl] = useState('')
  const [highlightedFields, setHighlightedFields] = useState<Set<string>>(new Set())
  const [form, setForm] = useState({
    title: '', company: '', state: '', location: '', category: '', type: 'casual', pay: '', description: '', sourceUrl: '', eligible88Days: false,
  })

  function set(key: string, val: string) { setForm(prev => ({ ...prev, [key]: val })) }

  async function handleExtract() {
    if (!url) return
    setExtracting(true)
    try {
      const res = await fetch('/api/extract', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) })
      const data = await res.json()

      const fieldsToHighlight = new Set<string>()
      const updates: any = {}

      if (data.title && data.title !== form.title) { updates.title = data.title; fieldsToHighlight.add('title') }
      if (data.company && data.company !== form.company) { updates.company = data.company; fieldsToHighlight.add('company') }
      if (data.state && data.state !== form.state) { updates.state = data.state; fieldsToHighlight.add('state') }
      if (data.location && data.location !== form.location) { updates.location = data.location; fieldsToHighlight.add('location') }
      if (data.category && data.category !== form.category) { updates.category = data.category; fieldsToHighlight.add('category') }
      if (data.pay && data.pay !== form.pay) { updates.pay = data.pay; fieldsToHighlight.add('pay') }
      if (data.description && data.description !== form.description) { updates.description = data.description; fieldsToHighlight.add('description') }

      updates.sourceUrl = url
      setForm(prev => ({ ...prev, ...updates }))
      setHighlightedFields(fieldsToHighlight)
      setTimeout(() => setHighlightedFields(new Set()), 2000)
    } catch (err) {
      console.error('Extraction error:', err)
    }
    setExtracting(false)
  }

  async function handlePublish() {
    if (!form.title || !form.company || !form.state || !form.category || !form.description) {
      alert(t.admin.fillRequired)
      return
    }
    setPublishing(true)
    const res = await fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) })
    if (res.ok) {
      router.push('/feed')
    } else {
      alert(t.admin.publishError)
    }
    setPublishing(false)
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-3xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">{t.admin.publishTitle}</h1>
      <p className="text-sm text-stone-500 mb-6">{t.admin.publishSubtitle}</p>

      {/* URL Extract */}
      <div className="mb-8">
        <h2 className="text-base font-bold text-stone-800 mb-2">{t.admin.autoExtract}</h2>
        <p className="text-[13px] text-stone-500 mb-3">{t.admin.autoExtractHelp}</p>
        <div className="flex gap-2">
          <input type="text" value={url} onChange={e => setUrl(e.target.value)} placeholder="https://www.gumtree.com.au/..."
            className="flex-1 px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400" />
          <button onClick={handleExtract} disabled={extracting}
            className={`flex-shrink-0 px-4 py-2.5 rounded-lg text-sm font-bold bg-amber-400 hover:bg-amber-300 text-stone-900 transition ${extracting ? 'animate-pulse' : ''}`}>
            {extracting ? t.admin.extracting : t.admin.extract}
          </button>
        </div>
      </div>

      {/* Form */}
      <h2 className="text-base font-bold text-stone-800 mb-4">{t.admin.jobDetails}</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <Field label={t.admin.jobTitle} value={form.title} onChange={v => set('title', v)} placeholder={t.admin.titlePlaceholder} highlighted={highlightedFields.has('title')} />
        <Field label={t.admin.company} value={form.company} onChange={v => set('company', v)} placeholder={t.admin.companyPlaceholder} highlighted={highlightedFields.has('company')} />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">{t.admin.state}</label>
          <select value={form.state} onChange={e => set('state', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none bg-white appearance-none transition-all ${
              highlightedFields.has('state')
                ? 'border-green-400 bg-green-50 focus:border-green-500'
                : 'border-stone-200 focus:border-purple-400'
            }`}>
            <option value="">{t.common.select}</option>
            <option value="QLD">Queensland (QLD)</option><option value="NSW">New South Wales (NSW)</option>
            <option value="VIC">Victoria (VIC)</option><option value="SA">South Australia (SA)</option>
            <option value="WA">Western Australia (WA)</option><option value="TAS">Tasmania (TAS)</option>
            <option value="NT">Northern Territory (NT)</option><option value="ACT">ACT</option>
          </select>
        </div>
        <Field label={t.admin.location} value={form.location} onChange={v => set('location', v)} placeholder={t.admin.locationPlaceholder} highlighted={highlightedFields.has('location')} />
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">{t.admin.category}</label>
          <select value={form.category} onChange={e => set('category', e.target.value)}
            className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none bg-white appearance-none transition-all ${
              highlightedFields.has('category')
                ? 'border-green-400 bg-green-50 focus:border-green-500'
                : 'border-stone-200 focus:border-purple-400'
            }`}>
            <option value="">{t.common.select}</option>
            <option value="farm">{t.categoryLabels.farm}</option>
            <option value="hospitality">{t.categoryLabels.hospitality}</option>
            <option value="construction">{t.categoryLabels.construction}</option>
            <option value="retail">{t.categoryLabels.retail}</option>
            <option value="cleaning">{t.categoryLabels.cleaning}</option>
            <option value="events">{t.categoryLabels.events}</option>
            <option value="animals">{t.categoryLabels.animals}</option>
            <option value="transport">{t.categoryLabels.transport}</option>
            <option value="other">{t.categoryLabels.other}</option>
          </select>
        </div>
        <div>
          <label className="block text-[13px] font-semibold text-stone-600 mb-1">{t.admin.contractType}</label>
          <select value={form.type} onChange={e => set('type', e.target.value)}
            className="w-full px-3 py-2.5 rounded-lg border border-stone-200 text-sm focus:outline-none focus:border-purple-400 bg-white appearance-none">
            <option value="casual">{t.types.casual}</option><option value="full_time">{t.types.full_time}</option>
            <option value="part_time">{t.types.part_time}</option><option value="contract">{t.types.contract}</option>
          </select>
          <label className="flex items-center gap-2 cursor-pointer mt-3">
            <input
              type="checkbox"
              checked={form.eligible88Days}
              onChange={e => setForm({ ...form, eligible88Days: e.target.checked })}
              className="w-4 h-4 rounded border-stone-300 text-yellow-500 focus:ring-yellow-400"
            />
            <span className="text-sm font-medium text-stone-700">{t.admin.eligible88Days}</span>
          </label>
        </div>
      </div>
      <div className="mb-4">
        <Field label={t.admin.salary} value={form.pay} onChange={v => set('pay', v)} placeholder={t.admin.salaryPlaceholder} highlighted={highlightedFields.has('pay')} />
      </div>
      <div className="mb-6">
        <label className="block text-[13px] font-semibold text-stone-600 mb-1">{t.admin.description}</label>
        <textarea value={form.description} onChange={e => set('description', e.target.value)} rows={5} placeholder={t.admin.descriptionPlaceholder}
          className={`w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none resize-y transition-all ${
            highlightedFields.has('description')
              ? 'border-green-400 bg-green-50 focus:border-green-500'
              : 'border-stone-200 focus:border-purple-400'
          }`} />
      </div>

      <button onClick={handlePublish} disabled={publishing}
        className="w-full py-3.5 rounded-xl bg-purple-700 hover:bg-purple-800 text-white font-bold text-[15px] transition disabled:opacity-50">
        {publishing ? t.admin.publishing : t.admin.publish}
      </button>
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
