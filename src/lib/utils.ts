import { translations, type Language } from './translations'

export type { Language }

/** Safely coerce any value to a valid Language, defaulting to 'fr' */
export function normalizeLanguage(lang: string | null | undefined): Language {
  return lang === 'en' ? 'en' : 'fr'
}

export const STATES = [
  { code: 'QLD', name: 'Queensland' },
  { code: 'NSW', name: 'New South Wales' },
  { code: 'VIC', name: 'Victoria' },
  { code: 'SA', name: 'South Australia' },
  { code: 'WA', name: 'Western Australia' },
  { code: 'TAS', name: 'Tasmania' },
  { code: 'NT', name: 'Northern Territory' },
  { code: 'ACT', name: 'Australian Capital Territory' },
] as const

export function getCategories(lang: Language = 'fr') {
  const t = translations[lang]
  return [
    { key: 'all', label: t.categories.all },
    { key: 'farm', label: t.categories.farm },
    { key: 'hospitality', label: t.categories.hospitality },
    { key: 'construction', label: t.categories.construction },
    { key: 'retail', label: t.categories.retail },
    { key: 'cleaning', label: t.categories.cleaning },
    { key: 'events', label: t.categories.events },
    { key: 'animals', label: t.categories.animals },
    { key: 'transport', label: t.categories.transport },
    { key: 'other', label: t.categories.other },
  ]
}

// Keep CATEGORIES for backwards compat (defaults to French)
export const CATEGORIES = getCategories('fr')

export function catLabel(key: string, lang: Language = 'fr') {
  const cats = translations[lang].categories as Record<string, string>
  return cats[key] || key
}

export function typeLabel(key: string, lang: Language = 'fr') {
  const types = translations[lang].types as Record<string, string>
  return types[key] || key
}

export function timeAgo(date: Date, lang: Language = 'fr'): string {
  const t = translations[lang].time
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 60) return `${diffMins}${t.min}`
  if (diffHours < 24) return `${diffHours}${t.hours}`
  if (diffDays < 7) return `${diffDays}${t.days}`
  return `${Math.floor(diffDays / 7)}${t.weeks}`
}
