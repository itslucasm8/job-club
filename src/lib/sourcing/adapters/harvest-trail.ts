import { scraplingDiscover } from '../scrapling-client'
import type { SourceAdapter, ListingStub } from './types'

/** Harvest Trail was previously its own site; in 2022 it was folded into
 *  Workforce Australia. The "harvest" filter / keyword on the same job
 *  search backend is the closest equivalent. We keep it as a separate
 *  adapter so admin can run it independently and yield is tracked
 *  separately from the broader farm search.
 *
 *  Distinct from workforce-australia because the keyword set is narrower
 *  (harvest-specific: picking, packing, fruit, vegetables, harvest) and
 *  this slice tends to have stronger 88-day signal.
 *
 *  Discovery is delegated to the Scrapling sidecar — same backend as
 *  workforce_australia, only the keywords differ. The sidecar registers
 *  both names against one Python implementation. */
const SEARCH_URL = 'https://www.workforceaustralia.gov.au/individuals/jobs/search?keywords=harvest+picking&distance=ANYWHERE'

export const harvestTrailAdapter: SourceAdapter = {
  slug: 'harvest_trail',
  label: 'Harvest Trail (via Workforce Australia)',
  defaultCategory: 'farm',
  maxListings: 30,

  async discover(): Promise<ListingStub[]> {
    return scraplingDiscover('harvest_trail', SEARCH_URL, { maxListings: 30 })
  },
}
