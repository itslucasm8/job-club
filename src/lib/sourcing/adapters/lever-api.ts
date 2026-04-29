import * as cheerio from 'cheerio'
import { proxyReassessEligibility } from '../claude-proxy'
import type { SourceAdapter, ListingStub, AdapterExtraction } from './types'

/** Lever public-postings adapter — Flow A.
 *
 *  Lever hosts company job boards at jobs.lever.co/<slug> with a public API:
 *      https://api.lever.co/v0/postings/<slug>?mode=json
 *
 *  Lever returns both descriptionPlain (already-stripped) and a `lists`
 *  array with structured sections (responsibilities, requirements, benefits)
 *  that we concat so the description has the full picture. */

export type LeverConfig = {
  /** Lever account slug — the path segment after jobs.lever.co/. */
  boardSlug: string
  defaultCategory?: string
  defaultState?: string
  maxListings?: number
}

type LeverPosting = {
  id: string
  text: string
  categories?: {
    team?: string
    department?: string
    location?: string
    commitment?: string
    level?: string
  }
  additional?: string
  additionalPlain?: string
  description?: string
  descriptionPlain?: string
  lists?: Array<{ text: string; content: string }>
  applyUrl?: string
  hostedUrl?: string
  createdAt?: number
}

const AU_STATE_RE = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i

function htmlToText(html: string): string {
  if (!html) return ''
  const $ = cheerio.load(html)
  return $.root().text().replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function snippetFrom(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function normaliseCommitment(commitment: string | undefined): 'casual' | 'full_time' | 'part_time' | 'contract' {
  if (!commitment) return 'casual'
  const t = commitment.toLowerCase()
  if (t.includes('part')) return 'part_time'
  if (t.includes('contract')) return 'contract'
  if (t.includes('casual') || t.includes('temp')) return 'casual'
  if (t.includes('full')) return 'full_time'
  return 'casual'
}

function buildFullDescription(p: LeverPosting): string {
  const parts: string[] = []
  if (p.descriptionPlain) parts.push(p.descriptionPlain)
  else if (p.description) parts.push(htmlToText(p.description))
  if (Array.isArray(p.lists)) {
    for (const list of p.lists) {
      const heading = list.text || ''
      const body = htmlToText(list.content || '')
      if (body) parts.push(`\n\n${heading}:\n${body}`)
    }
  }
  if (p.additionalPlain) parts.push(`\n\n${p.additionalPlain}`)
  else if (p.additional) parts.push(`\n\n${htmlToText(p.additional)}`)
  return parts.join('').trim()
}

export function buildLeverAdapter(slug: string, label: string, config: LeverConfig): SourceAdapter {
  const jobCache = new Map<string, LeverPosting>()

  return {
    slug,
    label,
    defaultCategory: config.defaultCategory,
    defaultState: config.defaultState,
    maxListings: config.maxListings,

    async discover(): Promise<ListingStub[]> {
      jobCache.clear()
      if (!config.boardSlug) {
        throw new Error(`lever adapter for ${slug}: config.boardSlug missing`)
      }
      const apiUrl = `https://api.lever.co/v0/postings/${encodeURIComponent(config.boardSlug)}?mode=json`
      const res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) {
        throw new Error(`lever API ${apiUrl} -> HTTP ${res.status}`)
      }
      const data = await res.json() as LeverPosting[] | { error?: string }
      if (!Array.isArray(data)) {
        throw new Error(`lever API ${apiUrl} -> unexpected response shape`)
      }
      const stubs: ListingStub[] = []
      for (const p of data) {
        if (!p?.id || !(p.hostedUrl || p.applyUrl)) continue
        jobCache.set(p.id, p)
        stubs.push({
          url: p.hostedUrl || p.applyUrl!,
          sourceJobId: p.id,
          title: p.text,
          snippet: snippetFrom(buildFullDescription(p)),
          postedAt: p.createdAt ? new Date(p.createdAt).toISOString() : undefined,
        })
      }
      return stubs
    },

    async extractListing(stub: ListingStub): Promise<AdapterExtraction> {
      if (!stub.sourceJobId) {
        return { extraction_failed: true, failure_reason: 'lever: missing sourceJobId', raw: {} }
      }
      const posting = jobCache.get(stub.sourceJobId)
      if (!posting) {
        return { extraction_failed: true, failure_reason: `lever: posting ${stub.sourceJobId} not cached`, raw: {} }
      }

      const cat = posting.categories || {}
      const description = buildFullDescription(posting)
      const stateGuess = cat.location ? (AU_STATE_RE.exec(cat.location)?.[1].toUpperCase()) : undefined

      const raw: Record<string, any> = {
        title: posting.text || '',
        company: label,
        state: stateGuess || null,
        location: cat.location || '',
        category: null,
        type: normaliseCommitment(cat.commitment),
        pay: '',
        description,
        applyUrl: posting.applyUrl || posting.hostedUrl || '',
        eligible88Days: false,
      }

      try {
        const verdict = await proxyReassessEligibility(raw)
        Object.assign(raw, verdict)
      } catch {
        // Swallow.
      }

      return {
        raw,
        sourceText: `[lever_api ${config.boardSlug}/${stub.sourceJobId}]\n\nLocation: ${cat.location}\nDept: ${cat.department}\nTeam: ${cat.team}\nCommitment: ${cat.commitment}\n\n${description.slice(0, 8000)}`,
      }
    },
  }
}
