import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { getAdapterAsync } from '@/lib/sourcing/adapters/registry'
import { loadEffectivePlaybook, extractWithPlaybook } from '@/lib/sourcing/playbook'
import { canonicalizeUrl } from '@/lib/sourcing/url-canonical'
import { prisma } from '@/lib/prisma'

export const maxDuration = 120

const TEST_LISTING_CAP = 3

type TestResult = {
  url: string
  ok: boolean
  title?: string
  company?: string
  pay?: string
  state?: string
  error?: string
}

/** Dry-run a source: discover listings, extract the first few, return what we
 *  found. No DB writes, no JobCandidate rows, no JobSource counter bumps.
 *  Used by the source-edit drawer "Test source" button so admins can validate
 *  a config before flipping it on. */
export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  const startedAt = Date.now()

  let adapter
  try {
    adapter = await getAdapterAsync(params.slug)
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Adapter resolution failed' }, { status: 400 })
  }

  let stubs
  try {
    stubs = await adapter.discover()
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      phase: 'discover',
      error: e?.message || String(e),
      durationMs: Date.now() - startedAt,
    })
  }

  // Match runOneSource: canonicalize URLs so test results match what a real
  // run would produce.
  const sourceRow = await prisma.jobSource.findUnique({
    where: { slug: params.slug },
    select: { siteSlug: true },
  }).catch(() => null)
  const siteSlug = sourceRow?.siteSlug ?? null
  const canonical = stubs.slice(0, TEST_LISTING_CAP).map(s => ({
    ...s,
    url: canonicalizeUrl(s.url, siteSlug),
  }))

  if (canonical.length === 0) {
    return NextResponse.json({
      ok: true,
      phase: 'discover',
      listingsFound: 0,
      results: [],
      message: 'discover() returned 0 listings — check your URL or selector',
      durationMs: Date.now() - startedAt,
    })
  }

  const playbook = adapter.extractListing ? null : await loadEffectivePlaybook(adapter.slug)

  const results: TestResult[] = []
  for (const stub of canonical) {
    try {
      let extraction
      if (adapter.extractListing) {
        extraction = await adapter.extractListing(stub)
      } else if (playbook) {
        const r = await extractWithPlaybook(playbook, stub.url)
        extraction = r.extraction
      } else {
        results.push({ url: stub.url, ok: false, error: 'No extraction path available' })
        continue
      }
      if (extraction.extraction_failed) {
        results.push({ url: stub.url, ok: false, error: extraction.failure_reason || 'Extraction failed' })
      } else {
        const raw: any = extraction.raw || {}
        results.push({
          url: stub.url,
          ok: true,
          title: raw.title,
          company: raw.company,
          pay: raw.pay,
          state: raw.state,
        })
      }
    } catch (e: any) {
      results.push({ url: stub.url, ok: false, error: e?.message || String(e) })
    }
  }

  const okCount = results.filter(r => r.ok).length
  return NextResponse.json({
    ok: true,
    phase: 'extract',
    listingsFound: stubs.length,
    listingsTested: canonical.length,
    results,
    summary: {
      okCount,
      failCount: results.length - okCount,
    },
    durationMs: Date.now() - startedAt,
  })
}
