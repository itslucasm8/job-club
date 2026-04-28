// Registry of every job source we ingest from.
// Seed via: npx tsx scripts/sourcing/seed-sources.ts

export type SourceCategory = 'government' | 'aggregator' | 'ats_rss' | 'competitor' | 'manual' | 'direct'

export type SourceConfig = {
  slug: string
  label: string
  category: SourceCategory
  enabled: boolean
}

export const SOURCES: SourceConfig[] = [
  { slug: 'manual', label: 'Manual entry', category: 'manual', enabled: true },
  { slug: 'extension', label: 'Browser extension', category: 'manual', enabled: true },
  { slug: 'harvest_trail', label: 'Harvest Trail', category: 'government', enabled: true },
  { slug: 'workforce_australia', label: 'Workforce Australia', category: 'government', enabled: false },
]
