import { scraplingDiscover } from '../scrapling-client'
import type { SourceAdapter, ListingStub } from './types'

/** Workforce Australia is the federal government job board (replaced
 *  jobactive.gov.au in 2022). It's a SPA so we need a real browser to
 *  render. Discovery is delegated to the Scrapling sidecar (StealthyFetcher
 *  + Playwright) — this file just configures the slug, label, and search URL.
 *
 *  Search URL pattern observed:
 *    https://www.workforceaustralia.gov.au/individuals/jobs/search?keywords=farm
 *    + &distance=&location= for narrowing
 *
 *  Job detail URL pattern:
 *    /individuals/jobs/details/{NUMERIC_ID}[/{slug}]
 *
 *  We default to a regional-farm search since that's the highest-yield
 *  WHV-relevant slice. Admin can later add more variants for hospitality /
 *  construction / etc.
 */
const SEARCH_URL = 'https://www.workforceaustralia.gov.au/individuals/jobs/search?keywords=farm&distance=ANYWHERE'

export const workforceAustraliaAdapter: SourceAdapter = {
  slug: 'workforce_australia',
  label: 'Workforce Australia — farm',
  defaultCategory: 'farm',
  maxListings: 30,

  async discover(): Promise<ListingStub[]> {
    return scraplingDiscover('workforce_australia', SEARCH_URL, { maxListings: 30 })
  },
}
