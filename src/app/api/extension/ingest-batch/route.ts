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
  // Differentiate "LLM correctly rejected this post as a non-job" (soft —
  // the pipeline is healthy, the post just wasn't a job listing) from "the
  // scraper or extractor genuinely broke" (hard — needs investigation).
  // Used below to set lastRunStatus, so the source dashboard doesn't paint
  // healthy filtering as a red error.
  let softRejects = 0
  let hardErrors = 0
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
          html: p.html.slice(0, 200_000),
          postedAt: p.postedAt || null,
          authorName: p.authorName || null,
          ingestStatus: status,
          failureReason: opts.failureReason ? opts.failureReason.slice(0, 1000) : null,
          extractionMode: opts.extractionMode || null,
          extractionResult: opts.extractionResult ?? undefined,
          layoutFingerprint: opts.layoutFingerprint || null,
        },
      })
    } catch (e) {
      console.warn('[ingest-batch] capture write failed', e)
    }
  }

  // Process serially — keeps DB writes orderly and avoids hammering the proxy.
  for (const p of postsRaw as FbPostInput[]) {
    if (!p?.postId || !p?.postUrl || !p?.html) {
      errors++
      hardErrors++
      errorDetails.push({ postId: p?.postId || '?', reason: 'missing required field' })
      continue
    }
    const canonical = canonicalizeUrl(p.postUrl, 'facebook_groups')
    try {
      const r = await extractWithPlaybookFromHtml(playbook, canonical, p.html)
      if (r.extraction.extraction_failed) {
        errors++
        byMode.failed++
        // Soft reject — the LLM looked at the post and said "this isn't a
        // job listing" (job seeker, promo, event, etc). Healthy behavior.
        softRejects++
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
        hardErrors++
        const reason = (result as any).error || 'ingest error'
        errorDetails.push({ postId: p.postId, reason })
        await recordCapture(p, canonical, 'error', { failureReason: reason, extractionMode: r.mode })
      }
    } catch (e: any) {
      Sentry.captureException(e, { tags: { route: 'extension-ingest-batch', sourceSlug, postId: p.postId } })
      errors++
      hardErrors++
      byMode.failed++
      const reason = e?.message || String(e)
      errorDetails.push({ postId: p.postId, reason })
      await recordCapture(p, canonical, 'error', { failureReason: reason })
    }
  }

  // Update lastRunAt on the source so the GET /groups endpoint reflects
  // activity. Status is bucketed into 4 outcomes so the dashboard doesn't
  // paint healthy LLM-filtering as a red error:
  //   ok            — at least 1 job ingested, no hard errors
  //   partial       — at least 1 job ingested, but some hard errors too
  //   no_jobs_found — every post was rejected by the LLM as a non-job
  //                   (group full of job-seeker posts, promos, events, etc).
  //                   The pipeline is healthy; the feed just had no jobs.
  //   error         — at least 1 hard error AND nothing ingested
  //                   (scraper crash, ingest exception, malformed payload)
  let lastRunStatus: string
  if (ingested > 0 && hardErrors === 0) lastRunStatus = 'ok'
  else if (ingested > 0) lastRunStatus = 'partial'
  else if (hardErrors === 0 && softRejects > 0) lastRunStatus = 'no_jobs_found'
  else if (hardErrors > 0) lastRunStatus = 'error'
  else lastRunStatus = 'ok'  // empty batch — defer to caller

  // Build a status-appropriate summary. For 'no_jobs_found' the summary is
  // informational (not an error) — the dashboard should style it neutrally.
  let lastRunError: string | null = null
  if (lastRunStatus === 'error' || lastRunStatus === 'partial') {
    const hardSamples = errorDetails.filter(d => d.reason !== 'missing required field' || true).slice(0, 3)
    lastRunError = `${hardErrors} hard error(s): ${hardSamples.map(d => d.reason).join(' | ')}`.slice(0, 500)
  } else if (lastRunStatus === 'no_jobs_found') {
    lastRunError = `No job listings in ${softRejects} captured post(s) — LLM filtered all as non-jobs`.slice(0, 500)
  }

  // Mirror the runner's health-tracking discipline so the extension path
  // also benefits from auto-disable safety. Mirrors src/lib/sourcing/runner.ts:
  //   - 'ok' / 'partial' / 'no_jobs_found' resets consecutiveFailures (the
  //     pipeline is healthy even if this run found no jobs — soft rejects
  //     are not failures).
  //   - 'error' increments consecutiveFailures; at 2 we mark healthStatus
  //     'broken'; at 3 we auto-disable the source so a stuck FB group can't
  //     burn LLM tokens forever.
  const FAIL_BROKEN_THRESHOLD = 2
  const FAIL_AUTODISABLE_THRESHOLD = 3
  if (lastRunStatus === 'error') {
    const updated = await prisma.jobSource.update({
      where: { slug: sourceSlug },
      data: {
        lastRunAt: new Date(),
        lastRunStatus,
        lastRunError,
        totalSeen: { increment: postsRaw.length },
        consecutiveFailures: { increment: 1 },
      },
      select: { consecutiveFailures: true, healthStatus: true, enabled: true },
    }).catch(() => null)
    if (updated) {
      const followUp: any = {}
      if (updated.consecutiveFailures >= FAIL_BROKEN_THRESHOLD && updated.healthStatus !== 'broken') {
        followUp.healthStatus = 'broken'
      }
      if (updated.consecutiveFailures >= FAIL_AUTODISABLE_THRESHOLD && updated.enabled) {
        followUp.enabled = false
      }
      if (Object.keys(followUp).length > 0) {
        await prisma.jobSource.update({ where: { slug: sourceSlug }, data: followUp }).catch(() => {})
      }
    }
  } else {
    await prisma.jobSource.update({
      where: { slug: sourceSlug },
      data: {
        lastRunAt: new Date(),
        lastRunStatus,
        lastRunError,
        totalSeen: { increment: postsRaw.length },
        consecutiveFailures: 0,
        // Promote 'broken' → 'working' on a healthy run; leave 'partial' /
        // 'unverified' alone so the operator's labelling doesn't get stomped.
        ...(lastRunStatus === 'ok' ? { healthStatus: 'working' } : {}),
      },
    }).catch(() => {})
  }

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
