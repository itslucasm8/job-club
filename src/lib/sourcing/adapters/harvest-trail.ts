import * as cheerio from 'cheerio'
import { proxyFetchHtml } from '../claude-proxy'
import type { SourceAdapter, ListingStub } from './types'

/** Harvest Trail was previously its own site; in 2022 it was folded into
 *  Workforce Australia. The "harvest" filter / keyword on the same job
 *  search backend is the closest equivalent. We keep it as a separate
 *  adapter so admin can run it independently and yield is tracked
 *  separately from the broader farm search.
 *
 *  Distinct from workforce-australia because the keyword set is narrower
 *  (harvest-specific: picking, packing, fruit, vegetables, harvest) and
 *  this slice tends to have stronger 88-day signal. */
const SEARCH_URL = 'https://www.workforceaustralia.gov.au/individuals/jobs/search?keywords=harvest+picking&distance=ANYWHERE'

const DETAIL_URL_RE = /\/individuals\/jobs\/details\/(\d+)/i

export const harvestTrailAdapter: SourceAdapter = {
  slug: 'harvest_trail',
  label: 'Harvest Trail (via Workforce Australia)',
  defaultCategory: 'farm',
  maxListings: 30,

  async discover(): Promise<ListingStub[]> {
    const fetched = await proxyFetchHtml(SEARCH_URL, 90_000)
    if (!fetched.ok || !fetched.html) {
      throw new Error(fetched.error || `fetch failed (HTTP ${fetched.status})`)
    }
    const $ = cheerio.load(fetched.html)
    const seen = new Set<string>()
    const out: ListingStub[] = []
    $('a[href]').each((_, el) => {
      const href = $(el).attr('href') || ''
      const m = href.match(DETAIL_URL_RE)
      if (!m) return
      const sourceJobId = m[1]
      const absolute = href.startsWith('http')
        ? href
        : `https://www.workforceaustralia.gov.au${href.startsWith('/') ? href : `/${href}`}`
      if (seen.has(sourceJobId)) return
      seen.add(sourceJobId)
      const title = $(el).text().trim() || $(el).attr('aria-label') || undefined
      out.push({ url: absolute, sourceJobId, title })
    })
    return out
  },
}
