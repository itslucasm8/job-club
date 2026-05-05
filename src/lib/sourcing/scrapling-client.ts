/**
 * Thin client for the Scrapling sidecar at services/scrapling-scraper/.
 *
 * The sidecar runs in the same docker-compose network as `scraper`. It does
 * the actual fetching (Playwright, stealth, adaptive selectors) and returns
 * a list of discovered URLs. Per-listing LLM extraction stays in this app.
 *
 * Adapters call scraplingDiscover() instead of proxyFetchHtml() + cheerio.
 * Same SourceAdapter shape downstream — the runner doesn't know we swapped
 * the fetcher.
 */
import type { ListingStub } from './adapters/types'

const SCRAPER_URL = process.env.SCRAPER_URL || 'http://scraper:8091'
const SCRAPER_SECRET = process.env.SCRAPER_SECRET || ''

export type ScraplingListing = {
  url: string
  sourceJobId?: string | null
  title?: string | null
  snippet?: string | null
  postedAt?: string | null
  raw?: Record<string, any> | null
  sourceText?: string | null
}

export type ScrapingResponse = {
  ok: boolean
  listings: ScraplingListing[]
  errors: string[]
  debug?: Record<string, any>
}

/** Single round-trip discovery call. Returns ListingStubs ready to feed
 *  the runner's filterToNew + extract loop. Throws on transport error or
 *  non-2xx; logical errors (HTTP 4xx from origin) come back in `errors`. */
export async function scraplingDiscover(
  adapter: string,
  url: string,
  params: Record<string, any> = {},
  timeoutMs = 120_000,
): Promise<ListingStub[]> {
  if (!SCRAPER_SECRET) {
    throw new Error('SCRAPER_SECRET not set — cannot reach scrapling sidecar')
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(`${SCRAPER_URL}/scrape`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SCRAPER_SECRET}`,
      },
      body: JSON.stringify({ adapter, url, params }),
    })
    if (!res.ok) {
      throw new Error(`scrapling HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`)
    }
    const data = (await res.json()) as ScrapingResponse
    if (!data.ok) {
      const reason = data.errors?.[0] || 'unknown scrapling error'
      throw new Error(`scrapling adapter='${adapter}' failed: ${reason}`)
    }
    if (data.errors?.length) {
      // Logical (origin-side) errors — surface but don't throw. Caller can
      // decide whether an empty listing list is fatal.
      console.warn('[scrapling] origin errors', { adapter, errors: data.errors })
    }
    return data.listings.map(l => ({
      url: l.url,
      sourceJobId: l.sourceJobId || undefined,
      title: l.title || undefined,
      snippet: l.snippet || undefined,
      postedAt: l.postedAt || undefined,
    }))
  } finally {
    clearTimeout(timer)
  }
}
