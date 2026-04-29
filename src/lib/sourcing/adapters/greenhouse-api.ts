import * as cheerio from 'cheerio'
import { proxyReassessEligibility } from '../claude-proxy'
import type { SourceAdapter, ListingStub, AdapterExtraction } from './types'

/** Greenhouse public board adapter — Flow A.
 *
 *  Greenhouse hosts thousands of company job boards at boards.greenhouse.io
 *  and exposes their content via a public JSON API:
 *      https://boards-api.greenhouse.io/v1/boards/<slug>/jobs?content=true
 *
 *  The single API call returns title + location + full HTML body for every
 *  job — enough to ingest without ever opening Playwright or calling Claude.
 *  We cache the response in-closure during discover() and replay it from
 *  extractListing() to avoid a second HTTP round-trip per listing.
 *
 *  Eligibility (postcode + award) still runs via the proxy's
 *  /reassess-eligibility endpoint so structured-API jobs get the same
 *  verification badges as Playwright-extracted ones. */

export type GreenhouseConfig = {
  /** The company's Greenhouse board slug — the part after /boards.greenhouse.io/.
   *  e.g. for boards.greenhouse.io/atlassian → "atlassian". */
  boardSlug: string
  defaultCategory?: string
  defaultState?: string
  maxListings?: number
}

type GreenhouseJob = {
  id: number
  title: string
  absolute_url: string
  location?: { name?: string }
  content?: string
  updated_at?: string
  departments?: Array<{ name: string }>
}

const AU_STATE_RE = /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)\b/i

function htmlToText(html: string): string {
  if (!html) return ''
  // Greenhouse returns HTML-encoded content (often with &lt;p&gt; etc.). Cheerio
  // handles entity decoding + tag stripping in one pass.
  const $ = cheerio.load(html)
  return $.root().text().replace(/\s+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

function snippetFrom(text: string, max = 200): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max - 1) + '…' : t
}

function parseAuState(locationName: string | undefined): string | undefined {
  if (!locationName) return undefined
  const m = AU_STATE_RE.exec(locationName)
  return m ? m[1].toUpperCase() : undefined
}

export function buildGreenhouseAdapter(slug: string, label: string, config: GreenhouseConfig): SourceAdapter {
  // Per-run cache: discover() populates, extractListing() reads. Cleared at
  // the start of every discover() call so consecutive runs don't leak data.
  const jobCache = new Map<string, GreenhouseJob>()

  return {
    slug,
    label,
    defaultCategory: config.defaultCategory,
    defaultState: config.defaultState,
    maxListings: config.maxListings,

    async discover(): Promise<ListingStub[]> {
      jobCache.clear()
      if (!config.boardSlug) {
        throw new Error(`greenhouse adapter for ${slug}: config.boardSlug missing`)
      }
      const apiUrl = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(config.boardSlug)}/jobs?content=true`
      const res = await fetch(apiUrl, { headers: { 'Accept': 'application/json' } })
      if (!res.ok) {
        throw new Error(`greenhouse API ${apiUrl} -> HTTP ${res.status}`)
      }
      const data = await res.json() as { jobs?: GreenhouseJob[] }
      const jobs = Array.isArray(data?.jobs) ? data.jobs : []
      const stubs: ListingStub[] = []
      for (const job of jobs) {
        if (!job?.id || !job?.absolute_url) continue
        const id = String(job.id)
        jobCache.set(id, job)
        stubs.push({
          url: job.absolute_url,
          sourceJobId: id,
          title: job.title,
          snippet: snippetFrom(htmlToText(job.content || '')),
          postedAt: job.updated_at,
        })
      }
      return stubs
    },

    async extractListing(stub: ListingStub): Promise<AdapterExtraction> {
      if (!stub.sourceJobId) {
        return { extraction_failed: true, failure_reason: 'greenhouse: missing sourceJobId on stub', raw: {} }
      }
      const job = jobCache.get(stub.sourceJobId)
      if (!job) {
        // Cache miss — this can happen if extractListing is somehow called
        // outside the discover→extract cycle. Fail soft so the run continues.
        return { extraction_failed: true, failure_reason: `greenhouse: job ${stub.sourceJobId} not cached`, raw: {} }
      }

      const description = htmlToText(job.content || '')
      const locationName = job.location?.name || ''
      const stateGuess = parseAuState(locationName)

      const raw: Record<string, any> = {
        title: job.title || '',
        company: label,                    // Greenhouse boards are per-company; label IS the company.
        state: stateGuess || null,
        location: locationName,
        category: null,                    // runner applies adapter.defaultCategory when null
        type: 'casual',                    // ATS jobs are usually full-time; ingest will surface real type via classifier
        pay: '',                           // Greenhouse rarely exposes pay; leave empty rather than guess
        description,
        applyUrl: job.absolute_url,
        eligible88Days: false,             // overridden below by deterministic eligibility pass
      }

      // Deterministic post-pass: postcode + award. Same module Claude-extracted
      // listings flow through, so badges in the public UI render identically.
      try {
        const verdict = await proxyReassessEligibility(raw)
        Object.assign(raw, verdict)
      } catch {
        // Swallow — the candidate can still be ingested without verification fields,
        // it just won't show the green/red badges in /admin/candidates.
      }

      return {
        raw,
        sourceText: `[greenhouse_api ${config.boardSlug}/${stub.sourceJobId}]\n\nLocation: ${locationName}\nUpdated: ${job.updated_at}\n\n${description.slice(0, 8000)}`,
      }
    },
  }
}
