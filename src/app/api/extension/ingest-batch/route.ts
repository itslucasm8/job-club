import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { authorizeExtensionRequest } from '@/lib/extension-auth'
import { canonicalizeUrl } from '@/lib/sourcing/url-canonical'
import { loadEffectivePlaybook, extractWithPlaybookFromHtml } from '@/lib/sourcing/playbook'
import { ingestCandidate } from '@/lib/sourcing/ingest'

type FbPostInput = {
  postId: string
  postUrl: string
  postedAt?: string
  authorName?: string
  html: string
}

/** POST /api/extension/ingest-batch
 *  Body: { sourceSlug, posts: FbPostInput[], scrapedAt?, scrollDuration? }
 *
 *  For each post:
 *   1. Canonicalize postUrl (strip fbclid / __cft__ / __tn__ / etc.)
 *   2. Run extractWithPlaybookFromHtml(facebook_groups playbook, postUrl, html)
 *      → playbook tries first; falls back to full LLM if playbook misses
 *   3. ingestCandidate (dedupe + insert), tagged with extractionMode +
 *      layoutFingerprint so the playbook learning loop can update.
 *
 *  Returns counts: { ingested, duplicates, errors, byMode: { playbook, full, failed } }
 */
export async function POST(req: Request) {
  const auth = await authorizeExtensionRequest(req)
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status })
  }

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'JSON invalide' }, { status: 400 }) }

  const sourceSlug = String(body?.sourceSlug || '').trim()
  const postsRaw = Array.isArray(body?.posts) ? body.posts : []
  if (!sourceSlug || postsRaw.length === 0) {
    return NextResponse.json({ error: 'sourceSlug et posts requis' }, { status: 400 })
  }
  if (postsRaw.length > 200) {
    return NextResponse.json({ error: 'Max 200 posts par batch' }, { status: 400 })
  }

  const source = await prisma.jobSource.findUnique({
    where: { slug: sourceSlug },
    select: { slug: true, adapter: true, siteSlug: true, enabled: true },
  })
  if (!source) return NextResponse.json({ error: 'Source introuvable' }, { status: 404 })
  if (source.adapter !== 'extension' || source.siteSlug !== 'facebook_groups') {
    return NextResponse.json({ error: 'Source pas configurée pour extension FB' }, { status: 400 })
  }

  const playbook = await loadEffectivePlaybook(sourceSlug)

  let ingested = 0
  let duplicates = 0
  let errors = 0
  const byMode = { playbook: 0, full: 0, failed: 0 }
  const errorDetails: { postId: string; reason: string }[] = []

  // Persist every received post to ExtensionCapture — even failures. Lets
  // /admin/extensions/captures show exactly what the scraper got, so we can
  // tune selectors and adjust playbook without re-running scrapes.
  async function recordCapture(p: FbPostInput, canonical: string, status: string, opts: {
    failureReason?: string
    extractionMode?: string
    extractionResult?: any
    layoutFingerprint?: string
  } = {}) {
    try {
      await prisma.extensionCapture.create({
        data: {
          source: sourceSlug,
          sourceJobId: p.postId,
          sourceUrl: canonical,
          html: p.html.slice(0, 200_000),  // hard cap — should already be 50KB but defend
          postedAt: p.postedAt || null,
          authorName: p.authorName || null,
          ingestStatus: status,
          failureReason: opts.failureReason ? opts.failureReason.slice(0, 1000) : null,
          extractionMode: opts.extractionMode || null,
          extractionResult: opts.extractionResult || undefined,
          layoutFingerprint: opts.layoutFingerprint || null,
        },
      })
    } catch (e) {
      // Capture write should never block the ingest pipeline.
      console.warn('[ingest-batch] capture write failed', e)
    }
  }

  // Process serially — keeps DB writes orderly and avoids hammering the proxy.
  for (const p of postsRaw as FbPostInput[]) {
    if (!p?.postId || !p?.postUrl || !p?.html) {
      errors++
      errorDetails.push({ postId: p?.postId || '?', reason: 'missing required field' })
      continue
    }
    const canonical = canonicalizeUrl(p.postUrl, 'facebook_groups')
    try {
      const r = await extractWithPlaybookFromHtml(playbook, canonical, p.html)
      if (r.extraction.extraction_failed) {
        errors++
        byMode.failed++
        const reason = r.extraction.failure_reason || 'unspecified'
        errorDetails.push({ postId: p.postId, reason })
        await recordCapture(p, canonical, 'extraction_failed', { failureReason: reason, extractionMode: r.mode })
        continue
      }
      const raw: any = { ...r.extraction.raw }
      if (!raw.category) raw.category = undefined  // let classifier suggest
      if (p.postedAt) raw.postedAt = p.postedAt
      // FB posts often only have an author, not a "company" — fall back to author
      // when extraction left company blank, so dedupe + display still work.
      if ((!raw.company || !raw.company.trim()) && p.authorName) {
        raw.company = p.authorName.trim()
      }

      const result = await ingestCandidate({
        source: sourceSlug,
        sourceUrl: canonical,
        sourceJobId: p.postId,
        raw,
        sourceText: r.extraction.sourceText,
        extractionMode: r.mode,
        layoutFingerprint: r.outcome.fingerprint,
      })

      if (result.status === 'inserted') {
        ingested++
        if (r.mode === 'playbook') byMode.playbook++
        else byMode.full++
        await recordCapture(p, canonical, 'ingested', {
          extractionMode: r.mode,
          extractionResult: raw,
          layoutFingerprint: r.outcome.fingerprint,
        })
      } else if (result.status === 'duplicate') {
        duplicates++
        await recordCapture(p, canonical, 'duplicate', { extractionMode: r.mode })
      } else {
        errors++
        const reason = (result as any).error || 'ingest error'
        errorDetails.push({ postId: p.postId, reason })
        await recordCapture(p, canonical, 'error', { failureReason: reason, extractionMode: r.mode })
      }
    } catch (e: any) {
      Sentry.captureException(e, { tags: { route: 'extension-ingest-batch', sourceSlug, postId: p.postId } })
      errors++
      byMode.failed++
      const reason = e?.message || String(e)
      errorDetails.push({ postId: p.postId, reason })
      await recordCapture(p, canonical, 'error', { failureReason: reason })
    }
  }

  // Update lastRunAt on the source so the GET /groups endpoint reflects activity.
  // Persist a compact error summary so we can diagnose silent extraction failures
  // without needing live docker logs (which rotate).
  const errorSummary = errors > 0 && ingested === 0
    ? `${errors}/${postsRaw.length} failed: ${errorDetails.slice(0, 3).map(d => d.reason).join(' | ')}`.slice(0, 500)
    : null
  await prisma.jobSource.update({
    where: { slug: sourceSlug },
    data: {
      lastRunAt: new Date(),
      lastRunStatus: errors > 0 && ingested === 0 ? 'error' : 'ok',
      lastRunError: errorSummary,
      totalSeen: { increment: postsRaw.length },
    },
  }).catch(() => {})

  logger.info('extension ingest-batch', {
    route: '/api/extension/ingest-batch',
    sourceSlug,
    received: postsRaw.length,
    ingested,
    duplicates,
    errors,
    byMode,
    sampleErrors: errorDetails.slice(0, 3),
  })

  return NextResponse.json({
    ok: true,
    sourceSlug,
    received: postsRaw.length,
    ingested,
    duplicates,
    errors,
    byMode,
    errorDetails: errorDetails.slice(0, 10),
  })
}
