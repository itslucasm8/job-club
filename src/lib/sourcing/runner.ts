import { prisma } from '@/lib/prisma'
import { ingestCandidate } from './ingest'
import type { ListingStub, SourceAdapter, AdapterRunResult } from './adapters/types'
import { getAdapter, listAdaptersForSlugsAsync } from './adapters/registry'
import { canonicalizeUrl } from './url-canonical'
import {
  loadEffectivePlaybook,
  extractWithPlaybook,
  updateFromOutcome,
  proposeUpdates,
  applyProposal,
  isLayoutDrifting,
  type EffectivePlaybook,
  type ListingOutcome,
} from './playbook'

const DEFAULT_MAX_LISTINGS_PER_SOURCE = 30
const DEFAULT_EXTRACT_CONCURRENCY = 4

/** Map a free-text failure_reason from the extractor into a coarse tag the
 *  playbook proposer can group on. Keep the set small — Claude only needs
 *  to know the failure mode, not parse English. */
function classifyFailureReason(reason: string | undefined): string {
  const r = (reason || '').toLowerCase()
  if (r.includes('http 4') || r.includes('blocked') || r.includes('403') || r.includes('captcha')) return 'page_blocked'
  if (r.includes('timeout') || r.includes('timed out')) return 'page_timeout'
  if (r.includes('fetch') && r.includes('error')) return 'fetch_error'
  if (r.includes('title') || r.includes('company') || r.includes('description')) return 'parse_required_field_missing'
  if (r.startsWith('known:')) return 'known_error_skip'
  if (r.includes('proxy')) return 'proxy_unreachable'
  return 'parse_failed'
}

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

type ListingResultKind = 'inserted' | 'duplicate' | 'error'

// Number of consecutive errors that flips healthStatus → 'broken'.
// 1 is too noisy (a transient WAF blip shouldn't burn a source's reputation);
// 2 means "happened twice in a row" which is a real signal.
const FAIL_BROKEN_THRESHOLD = 2

/** Persist a successful run to JobSource: bumps totalSeen, resets failure
 *  counter, and computes healthStatus from listingsFound vs profile expectations.
 *
 *  partial = succeeded but yield is below expectedMinListings (drift indicator).
 *  working = succeeded with yield at or above expectations (or no expectation set).
 */
async function markSourceSuccess(slug: string, listingsFound: number): Promise<void> {
  const row = await prisma.jobSource.findUnique({
    where: { slug },
    select: { profile: true },
  })
  const expectedMin = (row?.profile as any)?.expectedMinListings as number | undefined
  const newHealth: 'working' | 'partial' =
    typeof expectedMin === 'number' && expectedMin > 0 && listingsFound < expectedMin
      ? 'partial'
      : 'working'
  await prisma.jobSource.update({
    where: { slug },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: 'ok',
      lastRunError: null,
      totalSeen: { increment: listingsFound },
      healthStatus: newHealth,
      consecutiveFailures: 0,
    },
  })
}

/** Append an entry to JobSource.profile.fixHistory. Caps the array at 20
 *  entries to keep the JSON column bounded (oldest dropped). Used by the
 *  runner for auto-recorded diagnostics and by the Tier 2 suggest endpoint
 *  for AI-proposed fixes. Both share the same array — the entry's `kind`
 *  field discriminates ('high_error_rate' | 'ai_suggestion' | ...). */
async function appendFixHistoryEntry(slug: string, entry: any): Promise<void> {
  const row = await prisma.jobSource.findUnique({
    where: { slug },
    select: { profile: true },
  })
  if (!row) return
  const profile: any = (row.profile && typeof row.profile === 'object') ? row.profile : {}
  const history: any[] = Array.isArray(profile.fixHistory) ? profile.fixHistory : []
  history.push(entry)
  const trimmed = history.length > 20 ? history.slice(-20) : history
  await prisma.jobSource.update({
    where: { slug },
    data: { profile: { ...profile, fixHistory: trimmed } },
  })
}

/** Persist a failed run: increments consecutiveFailures and flips health to
 *  'broken' once the threshold is crossed. Two-step write because Prisma can't
 *  conditionally branch on the post-increment value in a single update. */
async function markSourceFailure(slug: string, errorMessage: string): Promise<void> {
  const updated = await prisma.jobSource.update({
    where: { slug },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: 'error',
      lastRunError: errorMessage,
      consecutiveFailures: { increment: 1 },
    },
    select: { consecutiveFailures: true, healthStatus: true },
  })
  if (updated.consecutiveFailures >= FAIL_BROKEN_THRESHOLD && updated.healthStatus !== 'broken') {
    await prisma.jobSource.update({
      where: { slug },
      data: { healthStatus: 'broken' },
    })
  }
}

async function runOneSource(
  adapter: SourceAdapter,
  onListingDone?: (outcome: ListingResultKind) => Promise<void> | void,
  onListingsDiscovered?: (count: number) => Promise<void> | void,
): Promise<AdapterRunResult> {
  const start = Date.now()
  const cap = adapter.maxListings ?? DEFAULT_MAX_LISTINGS_PER_SOURCE

  let listings: ListingStub[]
  try {
    listings = await adapter.discover()
  } catch (e: any) {
    const errorMessage = `discover failed: ${e?.message || String(e)}`
    // Persist the failure so the per-source row's lastRunStatus + health stay
    // honest. Two consecutive failures flip healthStatus to 'broken'.
    await markSourceFailure(adapter.slug, errorMessage).catch(() => {})
    return {
      slug: adapter.slug,
      status: 'error',
      listingsFound: 0,
      listingsNew: 0,
      imported: 0,
      duplicates: 0,
      errors: 1,
      errorMessage,
      durationMs: Date.now() - start,
    }
  }

  // Canonicalize URLs before any dedupe. Removes Seek-style tracking params
  // (?origin=, &ref=, #sol=...) that would otherwise let the same /job/<id>
  // sneak past filterToNew as 2-4 separate listings per run.
  const sourceRow = await prisma.jobSource.findUnique({
    where: { slug: adapter.slug },
    select: { siteSlug: true },
  }).catch(() => null)
  const siteSlug = sourceRow?.siteSlug ?? null
  const canonicalized: ListingStub[] = listings.map(l => ({
    ...l,
    url: canonicalizeUrl(l.url, siteSlug),
  }))

  // Trim to cap before any DB roundtrip — avoids loading hundreds of URLs
  // from a chatty source into memory just to drop them.
  const capped = canonicalized.slice(0, cap)
  const news = await filterToNew(adapter.slug, capped)
  if (onListingsDiscovered) await onListingsDiscovered(capped.length)

  // Load the merged (site + source) playbook once for this run. All
  // playbook-aware extractions use this snapshot. Adapters with their own
  // structured extractListing() bypass the playbook entirely (ATS APIs etc.)
  // because their data is already structured.
  const playbook = await loadEffectivePlaybook(adapter.slug)

  let imported = 0
  let duplicates = 0
  let errors = 0
  // Per-listing failure trail. Used to append a structured fixHistory entry
  // on the source when error rate is high — feeds the AI fix-suggestion flow.
  const failures: { url: string; reason: string }[] = []
  // Per-listing playbook outcomes — drives end-of-run hit/miss accounting
  // (so candidate rules can promote and stale rules deprecate). Captures
  // the layout fingerprint per page for drift detection too.
  const listingOutcomes: ListingOutcome[] = []
  // Page-text samples gathered during the run, used by the playbook proposer
  // at end-of-run when failure rate triggers a re-learn.
  const failurePageTexts: { url: string; failureTag: string; pageText: string }[] = []
  const successPageTexts: { url: string; pageText: string; extracted: Record<string, any> }[] = []

  if (news.length > 0) {
    const outcomes = await runWithConcurrency(news, DEFAULT_EXTRACT_CONCURRENCY, async (listing) => {
      let outcome: ListingResultKind = 'error'
      try {
        // Adapter with structured extractListing → bypass playbook (already
        // has structured data, no DOM scraping needed).
        // Otherwise → playbook-first path with full-Claude fallback.
        let extraction
        let extractionMode: 'playbook' | 'full' | 'failed' = 'failed'
        let listingOutcome: ListingOutcome = { rulesFired: [] }
        if (adapter.extractListing) {
          extraction = await adapter.extractListing(listing)
          extractionMode = extraction.extraction_failed ? 'failed' : 'full'
        } else {
          const r = await extractWithPlaybook(playbook, listing.url)
          extraction = r.extraction
          extractionMode = r.mode
          listingOutcome = r.outcome
          listingOutcomes.push(r.outcome)
        }
        if (extraction.extraction_failed) {
          // Capture failure context for the proposer.
          failurePageTexts.push({
            url: listing.url,
            failureTag: classifyFailureReason(extraction.failure_reason),
            pageText: (extraction.sourceText || '').slice(0, 6000),
          })
          outcome = 'error'
          if (onListingDone) await onListingDone(outcome)
          return { kind: 'error' as const, reason: extraction.failure_reason, url: listing.url }
        }
        const raw: any = { ...extraction.raw }
        if (!raw.category && adapter.defaultCategory) raw.category = adapter.defaultCategory
        if (!raw.state && adapter.defaultState) raw.state = adapter.defaultState
        // Capture success context for the proposer (only first 3 — diminishing returns).
        if (successPageTexts.length < 3 && extraction.sourceText) {
          successPageTexts.push({
            url: listing.url,
            pageText: extraction.sourceText.slice(0, 6000),
            extracted: { title: raw.title, company: raw.company, pay: raw.pay, location: raw.location },
          })
        }
        const result = await ingestCandidate({
          source: adapter.slug,
          sourceUrl: listing.url,
          sourceJobId: listing.sourceJobId,
          raw,
          sourceText: extraction.sourceText,
          extractionMode,
          layoutFingerprint: listingOutcome.fingerprint,
        })
        outcome = result.status === 'inserted' ? 'inserted' : result.status === 'duplicate' ? 'duplicate' : 'error'
        if (onListingDone) await onListingDone(outcome)
        return { kind: result.status, url: listing.url, ...result }
      } catch (e: any) {
        outcome = 'error'
        if (onListingDone) {
          try { await onListingDone(outcome) } catch {}
        }
        return { kind: 'error' as const, reason: e?.message || String(e), url: listing.url }
      }
    })

    for (const o of outcomes) {
      if (o.kind === 'inserted') imported++
      else if (o.kind === 'duplicate') duplicates++
      else {
        errors++
        failures.push({ url: (o as any).url, reason: (o as any).reason || 'unknown' })
      }
    }
  }

  // Apply the run's hit/miss tallies back to the right playbook layer
  // (site rules update SitePlaybook, source rules update profile.playbook).
  // Promotions of candidate → active happen here.
  if (!adapter.extractListing && listingOutcomes.length > 0) {
    await updateFromOutcome({ sourceSlug: adapter.slug, listings: listingOutcomes })
      .catch(e => console.error('[playbook] updateFromOutcome failed', e))
  }

  // Trigger the playbook proposer when the run shows clear signs of trouble:
  //   - At least 3 failures with captured page text (so Claude has data to reason from)
  //   - OR layout drift across the run (fingerprint diverges from the playbook's expected hash)
  // We always need at least one success sample to give Claude something to compare.
  const observedFingerprints = listingOutcomes.map(o => o.fingerprint).filter((x): x is string => !!x)
  const drifting = isLayoutDrifting(playbook, observedFingerprints)
  const shouldPropose =
    !adapter.extractListing &&
    successPageTexts.length > 0 &&
    (failurePageTexts.length >= 3 || drifting)
  if (shouldPropose) {
    try {
      const proposal = await proposeUpdates({
        sourceSlug: adapter.slug,
        failureSamples: failurePageTexts.slice(0, 5),
        successSamples: successPageTexts,
      })
      if (proposal) {
        await applyProposal(adapter.slug, proposal)
        await appendFixHistoryEntry(adapter.slug, {
          date: new Date().toISOString(),
          kind: 'playbook_proposal',
          status: 'applied',
          confidence: proposal.confidence,
          diagnosis: proposal.diagnosis,
          reasoning: proposal.reasoning,
          siteUpdates: proposal.siteUpdates ?? null,
          sourceUpdates: proposal.sourceUpdates ?? null,
          drifted: drifting,
        }).catch(() => {})
      }
    } catch (e) {
      console.error('[playbook] proposer failed', e)
    }
  }

  await markSourceSuccess(adapter.slug, capped.length).catch(() => {})

  // Tier 1 self-recording: when error rate is high, append a structured
  // entry to profile.fixHistory so the next admin session (or the Tier 2 AI
  // suggester) has the failure context preloaded — no need to re-diagnose.
  // Threshold: ≥3 errors AND ≥40% error rate AND we actually attempted some.
  if (news.length >= 3 && errors >= 3 && errors / news.length >= 0.4) {
    await appendFixHistoryEntry(adapter.slug, {
      date: new Date().toISOString(),
      kind: 'high_error_rate',
      status: 'open',
      errorRate: Number((errors / news.length).toFixed(2)),
      errorsCount: errors,
      attemptedCount: news.length,
      sampleFailures: failures.slice(0, 5),
    }).catch(() => {})
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
    // Live progress: bump SourcingRun totals after each listing completes
    // (not just after each source). Otherwise a 5-minute source looks frozen.
    const onListingDone = async (outcome: ListingResultKind) => {
      if (outcome === 'inserted') totals.totalImported += 1
      else if (outcome === 'duplicate') totals.totalDuplicates += 1
      else totals.totalErrors += 1
      await prisma.sourcingRun.update({
        where: { id: runId },
        data: { ...totals },
      }).catch(() => {})
    }
    const onListingsDiscovered = async (count: number) => {
      totals.totalListingsFound += count
      // listingsNew is settled later when the source finishes. We update found here
      // so admin can see "X listings discovered" mid-source.
      await prisma.sourcingRun.update({
        where: { id: runId },
        data: { totalListingsFound: totals.totalListingsFound },
      }).catch(() => {})
    }

    const result = await runOneSource(adapter, onListingDone, onListingsDiscovered).catch((e): AdapterRunResult => ({
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
    // Reconcile listingsNew at source completion (we don't know it during discovery).
    totals.totalListingsNew += result.listingsNew

    // Final per-source persistence: completed source list + processedSources counter.
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
