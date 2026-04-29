'use client'
import { useEffect, useState, useCallback } from 'react'
import { useSession } from 'next-auth/react'

type FileStatus = {
  exists: boolean
  bytes?: number
  mtime?: number
  data?: any
  error?: string
}
type Status = Record<string, FileStatus>

type PasteKind = 'postcodes_agriculture' | 'postcodes_construction' | 'postcodes_tourism' | 'award'

type PasteConfig = {
  key: PasteKind
  label: string
  helpUrl: string
  helpText: string
  parseKind: 'postcodes' | 'award'
  /** For postcodes parses: tells the backend which section to extract from a
   *  multi-section Home Affairs page. Ignored for awards. */
  industry?: 'agriculture' | 'construction' | 'tourism'
  // For postcodes: deterministic filename. For award: filename derived after parsing (awards.json + key=award_id).
  filename?: string
}

const HA_URL = 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/work-holiday-417/specified-work'
const HA_HELP = "Toutes les industries 88 jours sont sur la MÊME page Home Affairs. Pas besoin de filtrer la section — fais juste Ctrl+A puis Ctrl+C sur toute la page, l'IA extraira automatiquement la section qui correspond à l'onglet sélectionné."

const PASTE_OPTIONS: PasteConfig[] = [
  {
    key: 'postcodes_agriculture',
    label: 'Postcodes — Agriculture',
    helpUrl: HA_URL,
    helpText: HA_HELP + " Cible: section 'Plant and animal cultivation' (cattle stations, farms, vergers, packhouses).",
    parseKind: 'postcodes',
    industry: 'agriculture',
    filename: 'postcodes_agriculture.json',
  },
  {
    key: 'postcodes_construction',
    label: 'Postcodes — Construction',
    helpUrl: HA_URL,
    helpText: HA_HELP + " Cible: section 'Construction' (bâtiment, chantiers).",
    parseKind: 'postcodes',
    industry: 'construction',
    filename: 'postcodes_construction.json',
  },
  {
    key: 'postcodes_tourism',
    label: 'Postcodes — Tourisme/Hospitalité (Northern AU)',
    helpUrl: HA_URL,
    helpText: HA_HELP + " Cible: 'Tourism and hospitality in Remote and Very Remote Australia' (= zones touristiques nord, applicable depuis le 22 juin 2021).",
    parseKind: 'postcodes',
    industry: 'tourism',
    filename: 'postcodes_tourism.json',
  },
  {
    key: 'award',
    label: 'Award Fair Work (à upserter)',
    helpUrl: 'https://www.fairwork.gov.au/employment-conditions/awards/awards-summary',
    helpText: "Cherche l'award (ex: Horticulture MA000028, Pastoral MA000035, Hospitality MA000009, Building MA000020, Cleaning MA000022). Ouvre la 'Pay Guide' (PDF ou page web), copie tout le contenu.",
    parseKind: 'award',
    // filename + key derived after parsing
  },
]

export default function AdminReferenceDataPage() {
  const { data: session } = useSession()
  const [status, setStatus] = useState<Status | null>(null)
  const [statusLoading, setStatusLoading] = useState(true)

  const [activeKind, setActiveKind] = useState<PasteKind>('postcodes_agriculture')
  const [pasteText, setPasteText] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<any | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)

  const [editingJson, setEditingJson] = useState('')
  const [editing, setEditing] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const config = PASTE_OPTIONS.find(o => o.key === activeKind)!

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const res = await fetch('/api/admin/reference-data/list')
      if (res.ok) setStatus(await res.json())
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => { loadStatus() }, [loadStatus])

  function resetParse() {
    setParsed(null)
    setParseError(null)
    setEditing(false)
    setEditingJson('')
    setSaveMsg(null)
  }

  async function runParse() {
    if (pasteText.trim().length < 200) {
      setParseError('Texte trop court (min 200 caractères)')
      return
    }
    setParsing(true)
    resetParse()
    try {
      const res = await fetch('/api/admin/reference-data/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: config.parseKind,
          page_text: pasteText,
          industry: config.industry,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setParseError(data.error || `HTTP ${res.status}`)
        return
      }
      if (data.parse_failed) {
        setParseError(`Parsing échoué: ${data.failure_reason || 'inconnu'}`)
        return
      }
      setParsed(data)
      setEditingJson(JSON.stringify(data, null, 2))
    } catch (e: any) {
      setParseError(`Erreur réseau: ${e?.message || e}`)
    } finally {
      setParsing(false)
    }
  }

  async function runSave() {
    if (!parsed) return
    const dataToSave = editing ? safeParseJson(editingJson) : parsed
    if (dataToSave === null) {
      setSaveMsg('✗ JSON invalide dans l\'éditeur')
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      let payload: any
      if (config.parseKind === 'postcodes') {
        payload = {
          filename: config.filename,
          mode: 'replace',
          data: dataToSave,
        }
      } else {
        // award upsert
        const awardId = (dataToSave as any)?.award_id
        if (!awardId) {
          setSaveMsg('✗ award_id manquant — corrige dans l\'éditeur avant de sauvegarder')
          setSaving(false)
          return
        }
        payload = {
          filename: 'awards.json',
          mode: 'upsert',
          key: awardId,
          data: dataToSave,
        }
      }
      const res = await fetch('/api/admin/reference-data/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = await res.json().catch(() => ({}))
      if (res.ok) {
        setSaveMsg(`✓ Enregistré: ${result.filename} (${result.bytes} octets, mode=${result.mode})`)
        setPasteText('')
        setParsed(null)
        setEditing(false)
        await loadStatus()
      } else {
        setSaveMsg(`✗ ${result.error || `HTTP ${res.status}`}`)
      }
    } catch (e: any) {
      setSaveMsg(`✗ Erreur réseau: ${e?.message || e}`)
    } finally {
      setSaving(false)
    }
  }

  if (!session || (session.user as any)?.role !== 'admin') {
    return <div className="px-4 sm:px-5 lg:px-7 py-5"><p className="text-stone-500">Non autorisé</p></div>
  }

  return (
    <div className="px-4 sm:px-5 lg:px-7 py-5 pb-24 lg:pb-10 max-w-5xl">
      <h1 className="text-xl sm:text-2xl font-extrabold text-stone-900 mb-1">Données de référence</h1>
      <p className="text-sm text-stone-500 mb-4">
        Postcodes 88 jours (Home Affairs) + tarifs minimum (Fair Work). Données utilisées par l'extracteur pour vérifier l'éligibilité 88 jours et le respect des awards.
      </p>

      {/* Status block */}
      <div className="mb-5 bg-stone-50 border border-stone-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-bold text-stone-700 uppercase tracking-wider">État actuel</div>
          <button onClick={loadStatus} className="text-[11px] text-purple-700 font-semibold hover:underline">↻ Recharger</button>
        </div>
        {statusLoading ? (
          <div className="text-xs text-stone-500">Chargement…</div>
        ) : status ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(status).map(([name, st]) => (
              <StatusRow key={name} name={name} st={st} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-stone-500">Erreur</div>
        )}
      </div>

      {/* Paste type selector */}
      <div className="mb-4">
        <div className="text-[11px] font-bold text-stone-600 uppercase tracking-wider mb-2">Type de page à coller</div>
        <div className="flex flex-wrap gap-2">
          {PASTE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => { setActiveKind(opt.key); setPasteText(''); resetParse() }}
              className={`px-3 py-1.5 rounded-full text-xs font-bold border transition ${
                activeKind === opt.key
                  ? 'bg-purple-700 text-white border-purple-700'
                  : 'bg-white text-stone-700 border-stone-200 hover:border-purple-300'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Help block */}
      <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <div className="text-xs text-amber-900">{config.helpText}</div>
        <a
          href={config.helpUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block mt-2 text-xs font-semibold text-amber-900 underline hover:no-underline"
        >
          Ouvrir la page officielle ↗
        </a>
      </div>

      {/* Paste textarea */}
      <div className="mb-3">
        <textarea
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
          rows={10}
          placeholder="Ctrl+A, Ctrl+C sur la page, puis Ctrl+V ici…"
          className="w-full px-3 py-2 rounded-lg border border-stone-300 bg-white text-xs font-mono focus:outline-none focus:border-purple-500"
        />
        <div className="text-[11px] text-stone-500 mt-1">
          {pasteText.length.toLocaleString()} caractères {pasteText.length >= 200 ? '✓' : '(min 200)'}
        </div>
      </div>

      {/* Parse button */}
      <div className="mb-4 flex flex-wrap gap-2 items-center">
        <button
          onClick={runParse}
          disabled={parsing || pasteText.length < 200}
          className="px-4 py-2 rounded-lg text-xs font-bold bg-purple-700 hover:bg-purple-800 text-white transition disabled:opacity-50"
        >
          {parsing ? 'Parsing avec Sonnet… (peut prendre 60-90s)' : '1. Parser avec IA'}
        </button>
        {parseError && <div className="text-xs text-red-700">{parseError}</div>}
      </div>

      {/* Preview + edit + save */}
      {parsed && (
        <div className="mb-4 p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-purple-900 uppercase tracking-wider">2. Vérifier puis enregistrer</div>
            <button
              onClick={() => setEditing(e => !e)}
              className="text-[11px] text-purple-700 font-semibold hover:underline"
            >
              {editing ? 'Mode lecture' : 'Éditer le JSON'}
            </button>
          </div>
          {editing ? (
            <textarea
              value={editingJson}
              onChange={e => setEditingJson(e.target.value)}
              rows={20}
              className="w-full px-3 py-2 rounded-lg border border-purple-300 bg-white text-[11px] font-mono focus:outline-none focus:border-purple-500"
            />
          ) : (
            <pre className="text-[11px] text-stone-800 bg-white border border-purple-200 rounded p-2 overflow-x-auto max-h-96 whitespace-pre-wrap">
              {JSON.stringify(parsed, null, 2)}
            </pre>
          )}
          <div className="mt-3 flex flex-wrap gap-2 items-center">
            <button
              onClick={runSave}
              disabled={saving}
              className="px-4 py-2 rounded-lg text-xs font-bold bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50"
            >
              {saving ? 'Enregistrement…' : config.parseKind === 'award'
                ? `3. Enregistrer (upsert dans awards.json)`
                : `3. Enregistrer (remplacer ${config.filename})`}
            </button>
            {saveMsg && <div className="text-xs text-stone-800">{saveMsg}</div>}
          </div>
        </div>
      )}
    </div>
  )
}

function StatusRow({ name, st }: { name: string; st: FileStatus }) {
  let summary = ''
  if (!st.exists) {
    summary = '— manquant'
  } else if (st.error) {
    summary = `⚠ erreur: ${st.error}`
  } else if (name.startsWith('postcodes_') && st.data?.states) {
    const states = Object.keys(st.data.states).length
    const totalRanges = Object.values(st.data.states as Record<string, any>).reduce(
      (sum, s: any) => sum + (s.include_all_state ? 1 : (s.postcodes?.length || 0)),
      0
    )
    summary = `${states} états · ${totalRanges} entrées · effectif ${st.data?.effective_from || '?'}`
  } else if (name === 'awards.json' && st.data && typeof st.data === 'object') {
    const ids = Object.keys(st.data)
    summary = ids.length === 0 ? 'vide' : `${ids.length} award(s): ${ids.join(', ')}`
  } else if (st.exists) {
    summary = `${st.bytes ?? 0} octets`
  }
  const updated = st.mtime ? new Date(st.mtime * 1000).toLocaleString('fr-FR') : ''
  return (
    <div className="bg-white border border-stone-200 rounded p-2 text-xs">
      <div className="font-mono font-semibold text-stone-800">{name}</div>
      <div className={`text-[11px] mt-0.5 ${st.exists ? 'text-stone-600' : 'text-stone-400'}`}>{summary}</div>
      {updated && <div className="text-[10px] text-stone-400">maj: {updated}</div>}
    </div>
  )
}

function safeParseJson(text: string): any | null {
  try { return JSON.parse(text) } catch { return null }
}
