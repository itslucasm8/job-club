import * as cheerio from 'cheerio'
import { proxyReassessEligibility } from '../claude-proxy'
import type { SourceAdapter, ListingStub, AdapterExtraction } from './types'

/** Workable public-board adapter — Flow A.
 *
 *  Workable hosts company job boards at apply.workable.com/<slug>/ and
 *  exposes their content via:
 *      https://apply.workable.com/api/v3/accounts/<slug>/jobs?state=published
 *
 *  The response includes structured fields Greenhouse doesn't expose
 *  (region_code → state, employment_type → type, salary range, city), so
 *  we get a richer raw record than the LLM path typically produces. */

export type WorkableConfig = {
  /** Account slug — the path segment after apply.workable.com/. */
  boardSlug: string
  defaultCategory?: string
  defaultState?: string
  maxListings?: number
}

type WorkableJob = {
  id?: string
  shortcode?: string
  title?: string
  description?: string  // HTML
  requirements?: string // HTML
  benefits?: string     // HTML
  url?: string
  shortlink?: string
  application_url?: string
  location?: {
    country?: string
    country_code?: string
    region?: string
    region_code?: string
    city?: string
    zip_code?: string
    workplace_type?: string
  }
  employment_type?: string
  industry?: string
  salary?: {
    salary_from?: number | null
    salary_to?: number | null
    salary_currency?: string | null
  }
  published_on?: string
  created_at?: string
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

function normaliseEmploymentType(workableType: string | undefined): 'casual' | 'full_time' | 'part_time' | 'contract' {
  if (!workableType) return 'casual'
  const t = workableType.toLowerCase()
  if (t.includes('part')) return 'part_time'
  if (t.includes('contract')) return 'contract'
  if (t.includes('casual') || t.includes('temp')) return 'casual'
  if (t.includes('full')) return 'full_time'
  return 'casual'
}

function formatPay(salary: WorkableJob['salary']): string {
  if (!salary) return ''
  const from = salary.salary_from
  const to = salary.salary_to
  const cur = salary.salary_currency || 'AUD'
  if (from && to && from !== to) return `$${from}-${to} ${cur}`
  if (from) return `$${from} ${cur}`
  if (to) return `$${to} ${cur}`
  return ''
}

function parseAuState(loc: WorkableJob['location']): string | undefined {
  if (!loc) return undefined
  // region_code is the cleanest source — Workable already extracted it.
  if (loc.region_code) {
    const m = AU_STATE_RE.exec(loc.region_code)
    if (m) return m[1].toUpperCase()
  }
  // Fallback: parse from "Brisbane, QLD" style strings.
  const composite = [loc.region, loc.country].filter(Boolean).join(' ')
  const m = AU_STATE_RE.exec(composite)
  return m ? m[1].toUpperCase() : undefined
}

export function buildWorkableAdapter(slug: string, label: string, config: WorkableConfig): SourceAdapter {
  const jobCache = new Map<string, WorkableJob>()

  return {
    slug,
    label,
    defaultCategory: config.defaultCategory,
    defaultState: config.defaultState,
    maxListings: config.maxListings,

    async discover(): Promise<ListingStub[]> {
      jobCache.clear()
      if (!config.boardSlug) {
        throw new Error(`workable adapter for ${slug}: config.boardSlug missing`)
      }
      const apiUrl = `https://apply.workable.com/api/v3/accounts/${encodeURIComponent(config.boardSlug)}/jobs?state=published`
      const res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) {
        throw new Error(`workable API ${apiUrl} -> HTTP ${res.status}`)
      }
      const data = await res.json() as { results?: WorkableJob[] }
      const jobs = Array.isArray(data?.results) ? data.results : []
      const stubs: ListingStub[] = []
      for (const job of jobs) {
        const id = job.shortcode || job.id
        const url = job.url || job.shortlink
        if (!id || !url) continue
        jobCache.set(String(id), job)
        stubs.push({
          url,
          sourceJobId: String(id),
          title: job.title,
          snippet: snippetFrom(htmlToText(job.description || '')),
          postedAt: job.published_on || job.created_at,
        })
      }
      return stubs
    },

    async extractListing(stub: ListingStub): Promise<AdapterExtraction> {
      if (!stub.sourceJobId) {
        return { extraction_failed: true, failure_reason: 'workable: missing sourceJobId', raw: {} }
      }
      const job = jobCache.get(stub.sourceJobId)
      if (!job) {
        return { extraction_failed: true, failure_reason: `workable: job ${stub.sourceJobId} not cached`, raw: {} }
      }

      // Workable splits content into description + requirements + benefits;
      // join them in a sensible order so the candidate has the full picture.
      const parts = [
        htmlToText(job.description || ''),
        job.requirements ? `\n\nExigences:\n${htmlToText(job.requirements)}` : '',
        job.benefits ? `\n\nAvantages:\n${htmlToText(job.benefits)}` : '',
      ].filter(Boolean)
      const description = parts.join('').trim()

      const loc = job.location || {}
      const locationStr = [loc.city, loc.region_code || loc.region, loc.country].filter(Boolean).join(', ')
      const stateGuess = parseAuState(loc)

      const raw: Record<string, any> = {
        title: job.title || '',
        company: label,
        state: stateGuess || null,
        location: locationStr,
        category: null,
        type: normaliseEmploymentType(job.employment_type),
        pay: formatPay(job.salary),
        description,
        applyUrl: job.application_url || job.url || '',
        eligible88Days: false,
      }

      try {
        const verdict = await proxyReassessEligibility(raw)
        Object.assign(raw, verdict)
      } catch {
        // Swallow — same rationale as Greenhouse.
      }

      return {
        raw,
        sourceText: `[workable_api ${config.boardSlug}/${stub.sourceJobId}]\n\nLocation: ${locationStr}\nEmployment: ${job.employment_type}\nIndustry: ${job.industry}\nPublished: ${job.published_on}\n\n${description.slice(0, 8000)}`,
      }
    },
  }
}
