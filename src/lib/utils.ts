export const STATES = [
  { code: 'QLD', name: 'Queensland', followers: 141 },
  { code: 'NSW', name: 'New South Wales', followers: 261 },
  { code: 'VIC', name: 'Victoria', followers: 69 },
  { code: 'SA', name: 'South Australia', followers: 45 },
  { code: 'WA', name: 'Western Australia', followers: 88 },
  { code: 'TAS', name: 'Tasmania', followers: 39 },
  { code: 'NT', name: 'Northern Territory', followers: 52 },
  { code: 'ACT', name: 'Australian Capital Territory', followers: 35 },
] as const

export const CATEGORIES = [
  { key: 'all', label: 'Tout' },
  { key: 'farm', label: 'Agriculture' },
  { key: 'hospitality', label: 'Hôtellerie' },
  { key: 'construction', label: 'Construction' },
  { key: 'trade', label: 'Métiers' },
  { key: 'retail', label: 'Commerce' },
  { key: 'cleaning', label: 'Nettoyage' },
  { key: 'other', label: 'Autre' },
] as const

export function catLabel(key: string) {
  const map: Record<string, string> = { farm: 'Agriculture', hospitality: 'Hôtellerie', construction: 'Construction', trade: 'Métiers', retail: 'Commerce', cleaning: 'Nettoyage', other: 'Autre' }
  return map[key] || key
}

export function typeLabel(key: string) {
  const map: Record<string, string> = { casual: 'Casual', full_time: 'Temps plein', part_time: 'Temps partiel', contract: 'Contrat' }
  return map[key] || key
}

export function timeAgo(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 60) return `${diffMins}min`
  if (diffHours < 24) return `${diffHours}h`
  if (diffDays < 7) return `${diffDays}j`
  return `${Math.floor(diffDays / 7)}sem`
}
