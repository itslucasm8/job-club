import { prisma } from '@/lib/prisma'
import { extractFromUrl } from './extractor'
import { ingestCandidate } from './ingest'
import type { ListingStub, SourceAdapter, AdapterRunResult } from './adapters/types'
import { getAdapter, listAdaptersForSlugsAsync } from './adapters/registry'

const DEFAULT_MAX_LISTINGS_PER_SOURCE = 30
const DEFAULT_EXTRACT_CONCURRENCY = 4

/** Cheap: filter listings down to ones we don't already have. We avoid calling
 *  the LLM for anything we can identify by URL or (source, sourceJobId). */
async function filterToNew(source: string, listings: ListingStub[]): Promise<ListingStub[]> {
  if (listings.length === 0) return []
  const urls = listings.map(l => l.url)
  const sourceJobIds = listings.map(l => l.sourceJobId).filter((x): x is string => !!x)

  const [byUrl, byPair] = await Promise.all([
    prisma.jobCandidate.findMany({
      where: { sourceUrl: { in: urls } },
      select: { sourceUrl: true },
    }),
    sourceJobIds.length > 0
      ? prisma.jobCandidate.findMany({
          where: { source, sourceJobId: { in: sourceJobIds } },
          select: { sourceJobId: true },
        })
      : Promise.resolve([] as { sourceJobId: string | null }[]),
  ])

  const knownUrls = new Set(byUrl.map(c => c.sourceUrl))
  const knownIds = new Set(byPair.map(c => c.sourceJobId).filter((x): x is string => !!x))

  return listings.filter(l => {
    if (knownUrls.has(l.url)) return false
    if (l.sourceJobId && knownIds.has(l.sourceJobId)) return false
    return true
  })
}

async function runWithConcurrency<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (true) {
      const i = cursor++
      if (i >= items.length) return
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

async function runOneSource(adapter: SourceAdapter): Promise<AdapterRunResult> {
  const start = Date.now()
  const cap = adapter.maxListings ?? DEFAULT_MAX_LISTINGS_PER_SOURCE

  let listings: ListingStub[]
  try {
    listings = await adapter.discover()
  } catch (e: any) {
    return {
      slug: adapter.slug,
      status: 'error',
      listingsFound: 0,
      listingsNew: 0,
      imported: 0,
      duplicates: 0,
      errors: 1,
      errorMessage: `discover failed: ${e?.message || String(e)}`,
      durationMs: Date.now() - start,
    }
  }

  // Trim to cap before any DB roundtrip — avoids loading hundreds of URLs
  // from a chatty source into memory just to drop them.
  const capped = listings.slice(0, cap)
  const news = await filterToNew(adapter.slug, capped)

  let imported = 0
  let duplicates = 0
  let errors = 0

  if (news.length > 0) {
    const outcomes = await runWithConcurrency(news, DEFAULT_EXTRACT_CONCURRENCY, async (listing) => {
      try {
        const extraction = await extractFromUrl(listing.url)
        if (extraction.extraction_failed) {
          return { kind: 'error' as const, reason: extraction.failure_reason }
        }
        // Apply the adapter's defaults so a per-source category/state survives
        // when Claude leaves them null.
        const raw = { ...extraction.raw }
        if (!raw.category && adapter.defaultCategory) raw.category = adapter.defaultCategory
        if (!raw.state && adapter.defaultState) raw.state = adapter.defaultState as any
        const result = await ingestCandidate({
          source: adapter.slug,
          sourceUrl: listing.url,
          sourceJobId: listing.sourceJobId,
          raw,
          sourceText: extraction.sourceText,
        })
        return { kind: result.status, ...result }
      } catch (e: any) {
        return { kind: 'error' as const, reason: e?.message || String(e) }
      }
    })

    for (const o of outcomes) {
      if (o.kind === 'inserted') imported++
      else if (o.kind === 'duplicate') duplicates++
      else errors++
    }
  }

  // Update JobSource counters opportunistically. totalSeen is "listings the
  // source surfaced this run" — useful for yield % later.
  try {
    await prisma.jobSource.update({
      where: { slug: adapter.slug },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'ok',
        lastRunError: null,
        totalSeen: { increment: capped.length },
      },
    })
  } catch {
    // Source row may not exist if seed missed — runner shouldn't break on this.
  }

  return {
    slug: adapter.slug,
    status: 'ok',
    listingsFound: capped.length,
    listingsNew: news.length,
    imported,
    duplicates,
    errors,
    durationMs: Date.now() - start,
  }
}

/** Run the source pipeline against the given slugs in sequence. Sources run
 *  one at a time (the per-listing extracts are already concurrent) so progress
 *  reporting stays tidy and the proxy isn't crushed. */
export async function executeRun(runId: string, slugs: string[]) {
  let adapters: SourceAdapter[]
  try {
    adapters = await listAdaptersForSlugsAsync(slugs)
  } catch (e: any) {
    await prisma.sourcingRun.update({
      where: { id: runId },
      data: {
        status: 'failed',
        completedAt: new Date(),
        errorMessage: `adapter resolution: ${e?.message || String(e)}`,
      },
    })
    return
  }

  await prisma.sourcingRun.update({
    where: { id: runId },
    data: { status: 'running', totalSources: adapters.length },
  })

  const perSourceResults: AdapterRunResult[] = []
  let totals = {
    totalListingsFound: 0,
    totalListingsNew: 0,
    totalImported: 0,
    totalDuplicates: 0,
    totalErrors: 0,
  }

  for (let i = 0; i < adapters.length; i++) {
    const adapter = adapters[i]
    const result = await runOneSource(adapter).catch((e): AdapterRunResult => ({
      slug: adapter.slug,
      status: 'error',
      listingsFound: 0,
      listingsNew: 0,
      imported: 0,
      duplicates: 0,
      errors: 1,
      errorMessage: e?.message || String(e),
      durationMs: 0,
    }))
    perSourceResults.push(result)
    totals.totalListingsFound += result.listingsFound
    totals.totalListingsNew += result.listingsNew
    totals.totalImported += result.imported
    totals.totalDuplicates += result.duplicates
    totals.totalErrors += result.errors

    // Persist progress after each source so the UI can poll meaningfully.
    await prisma.sourcingRun.update({
      where: { id: runId },
      data: {
        processedSources: i + 1,
        perSourceResults: perSourceResults as any,
        ...totals,
      },
    }).catch(() => {})
  }

  await prisma.sourcingRun.update({
    where: { id: runId },
    data: {
      status: 'completed',
      completedAt: new Date(),
      perSourceResults: perSourceResults as any,
      ...totals,
    },
  })
}

export async function resolveSlugsToRun(requested: string[] | undefined): Promise<string[]> {
  if (requested && requested.length > 0) return requested
  // Default: every enabled JobSource that has an adapter we know how to run.
  const sources = await prisma.jobSource.findMany({
    where: { enabled: true, adapter: { not: null } },
    select: { slug: true, adapter: true },
  })
  return sources.filter(s => !!s.adapter && getAdapter(s.slug) != null).map(s => s.slug)
}
