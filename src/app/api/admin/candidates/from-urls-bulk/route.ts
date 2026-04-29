import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { extractFromUrl } from '@/lib/sourcing/extractor'
import { ingestCandidate } from '@/lib/sourcing/ingest'

// Long-running because each URL hits the headless Chromium fetcher + Claude
// extract (~5-15s each). With concurrency=4 and 20 URLs that's ~50-75s worst
// case, well under 300s.
export const maxDuration = 300

const MAX_URLS = 30
const CONCURRENCY = 4

type UrlResult =
  | { url: string; status: 'inserted'; candidateId: string; title?: string }
  | { url: string; status: 'duplicate'; reason: 'source_id' | 'dedupe_hash' }
  | { url: string; status: 'extraction_failed'; reason: string }
  | { url: string; status: 'error'; error: string }

async function processOne(url: string): Promise<UrlResult> {
  try {
    const extraction = await extractFromUrl(url)
    if (extraction.extraction_failed) {
      return { url, status: 'extraction_failed', reason: extraction.failure_reason || 'unspecified' }
    }
    const ingest = await ingestCandidate({
      source: 'manual',
      sourceUrl: url,
      raw: extraction.raw,
      sourceText: extraction.sourceText,
    })
    if (ingest.status === 'duplicate') return { url, status: 'duplicate', reason: ingest.reason }
    if (ingest.status === 'error') return { url, status: 'error', error: ingest.error }
    return { url, status: 'inserted', candidateId: ingest.id, title: extraction.raw.title }
  } catch (e: any) {
    return { url, status: 'error', error: e?.message || String(e) }
  }
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

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const rawUrls: string[] = Array.isArray(body.urls) ? body.urls : []
    // Normalise: trim, drop blanks, drop dupes within the batch, keep only http(s).
    const urls = Array.from(
      new Set(
        rawUrls
          .map((u) => (u || '').toString().trim())
          .filter((u) => /^https?:\/\//i.test(u))
      )
    )

    if (urls.length === 0) {
      return NextResponse.json({ error: 'Aucune URL valide trouvée' }, { status: 400 })
    }
    if (urls.length > MAX_URLS) {
      return NextResponse.json({ error: `Maximum ${MAX_URLS} URLs par lot (reçu ${urls.length})` }, { status: 400 })
    }

    const results = await runWithConcurrency(urls, CONCURRENCY, processOne)

    const counts = {
      inserted: results.filter((r) => r.status === 'inserted').length,
      duplicate: results.filter((r) => r.status === 'duplicate').length,
      extraction_failed: results.filter((r) => r.status === 'extraction_failed').length,
      error: results.filter((r) => r.status === 'error').length,
    }

    return NextResponse.json({ counts, results, processed: urls.length })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-from-urls-bulk' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
