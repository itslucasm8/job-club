import * as cheerio from 'cheerio'
import { proxyFetchHtml } from '../claude-proxy'
import type { SourceAdapter, ListingStub } from './types'

/** Workforce Australia is the federal government job board (replaced
 *  jobactive.gov.au in 2022). It's a SPA so we need Playwright to render.
 *
 *  Search URL pattern observed:
 *    https://www.workforceaustralia.gov.au/individuals/jobs/search?keywords=farm
 *    + &distance=&location= for narrowing
 *
 *  Job detail URL pattern:
 *    /individuals/jobs/details/{NUMERIC_ID}[/{slug}]
 *
 *  We default to a regional-farm search since that's the highest-yield
 *  WHV-relevant slice. Admin can later add more variants (each as its own
 *  generic_career_page entry) for hospitality / construction / etc.
 */
const SEARCH_URL = 'https://www.workforceaustralia.gov.au/individuals/jobs/search?keywords=farm&distance=ANYWHERE'

const DETAIL_URL_RE = /\/individuals\/jobs\/details\/(\d+)/i

export const workforceAustraliaAdapter: SourceAdapter = {
  slug: 'workforce_australia',
  label: 'Workforce Australia — farm',
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
      // Normalise to absolute URL.
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
