/** A discovered listing from a source's list page — *before* expensive
 *  Claude extraction. Keep this lean: just the URL + any cheap signals
 *  the list page already gave us so we can de-dupe and pre-filter
 *  before paying for the per-job extract. */
export type ListingStub = {
  /** Detail-page URL — used as JobCandidate.sourceUrl. */
  url: string
  /** Source-specific stable id (e.g. listing slug). Used with `source` to
   *  hit the unique constraint and skip re-imports across runs. */
  sourceJobId?: string
  /** Optional cheap signals from the list card — used for pre-filter. */
  title?: string
  snippet?: string
  postedAt?: string
}

export type AdapterRunContext = {
  /** Maximum listings to process per source per run. Hard cap so a runaway
   *  source can't burn the whole token budget. */
  maxListingsPerSource: number
  /** Concurrency for per-listing extracts (Playwright + Claude). */
  extractConcurrency: number
}

export type AdapterRunResult = {
  slug: string
  status: 'ok' | 'error' | 'skipped'
  listingsFound: number
  listingsNew: number
  imported: number
  duplicates: number
  errors: number
  errorMessage?: string
  durationMs: number
}

/** Result of an adapter-side extraction — same shape that the LLM
 *  extractor (extractFromUrl) returns, so the runner can treat both
 *  paths identically downstream. */
export type AdapterExtraction = {
  raw: Record<string, any>
  sourceText?: string
  extraction_failed?: boolean
  failure_reason?: string
}

/** A SourceAdapter is a small isolated unit that knows how to:
 *   1. Hit one source's list page
 *   2. Extract the URLs of individual job listings on that page
 *  Everything downstream (de-dupe, Claude extract, ingest) is shared
 *  pipeline. Adapters stay narrow on purpose so when a site redesigns,
 *  only that one file breaks.
 *
 *  Adapters that already have structured data after discover() (ATS APIs,
 *  RSS feeds) can implement extractListing to bypass Playwright + Claude
 *  entirely — the runner uses extractListing if present, else falls back
 *  to the LLM-based extractFromUrl. This is the Flow A cost cliff. */
export interface SourceAdapter {
  /** Stable identifier used as JobCandidate.source and JobSource.slug. */
  slug: string
  /** Human-readable label for the admin UI. */
  label: string
  /** Default category to pre-fill if Claude returns null. e.g. 'farm'. */
  defaultCategory?: string
  /** Default state to pre-fill if Claude returns null. e.g. 'QLD'. */
  defaultState?: string
  /** Hard cap on listings per run for this source (overrides global). */
  maxListings?: number
  /** Hit the source's list page and return discovered listings. */
  discover(): Promise<ListingStub[]>
  /** Optional: build the extraction result directly from data the adapter
   *  already has cached (e.g. ATS API response). When present, runner skips
   *  extractFromUrl entirely — no Playwright, no Claude. Bytes ~free. */
  extractListing?(stub: ListingStub): Promise<AdapterExtraction>
}

/** Config payload stored on JobSource.config for generic adapters. */
export type GenericCareerPageConfig = {
  url: string
  /** CSS selector that matches anchor links to individual job postings. */
  jobLinkSelector?: string
  /** URL substring or regex pattern that a job link href must match. */
  jobLinkPattern?: string
  defaultCategory?: string
  defaultState?: string
  maxListings?: number
}
