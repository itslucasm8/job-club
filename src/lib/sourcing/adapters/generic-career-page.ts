import { scraplingDiscover } from '../scrapling-client'
import type { SourceAdapter, ListingStub, GenericCareerPageConfig } from './types'

/** Generic adapter for "this employer's careers page" type sources.
 *  Drives every behaviour from the JobSource.config row so admin can add a
 *  new source via UI without touching code.
 *
 *  Discovery is delegated to the Scrapling sidecar's `generic_html` adapter
 *  (StealthyFetcher + Playwright). The runner's per-listing LLM extraction
 *  path is unchanged — only URL discovery moved.
 *
 *  Behaviour params passed through to Python:
 *    - jobLinkSelector (CSS): which anchors to consider
 *    - jobLinkPattern (substring or /regex/flags): which hrefs to keep
 *    - maxListings: cap (default 30)
 *  No selector + no pattern → Python falls back to a /jobs|careers|positions|.../ heuristic. */

export function buildGenericCareerPageAdapter(slug: string, label: string, config: GenericCareerPageConfig): SourceAdapter {
  return {
    slug,
    label,
    defaultCategory: config.defaultCategory,
    defaultState: config.defaultState,
    maxListings: config.maxListings ?? 30,

    async discover(): Promise<ListingStub[]> {
      if (!config.url) throw new Error(`Source ${slug} has no url configured`)
      return scraplingDiscover('generic_html', config.url, {
        jobLinkSelector: config.jobLinkSelector,
        jobLinkPattern: config.jobLinkPattern,
        maxListings: config.maxListings ?? 30,
      })
    },
  }
}
