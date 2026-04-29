import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { extractFromUrl, proxyResultToRaw } from '@/lib/sourcing/extractor'
import { proxyExtract, isProxyConfigured } from '@/lib/sourcing/claude-proxy'
import { ingestCandidate } from '@/lib/sourcing/ingest'
import type { CandidateRaw } from '@/lib/sourcing/ingest'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const url: string = (body.url || '').toString().trim()
    const pasteText: string = (body.page_text || '').toString().trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'URL invalide' }, { status: 400 })
    }

    let raw: CandidateRaw
    let sourceText: string | undefined
    if (pasteText.length >= 200) {
      // Text paste mode — skip the headless fetch, send admin-pasted page text
      // straight to the LLM extractor. Used for sites that 403 datacenter IPs (Gumtree, Seek).
      if (!isProxyConfigured()) {
        return NextResponse.json({ error: 'Claude proxy non configuré' }, { status: 503 })
      }
      try {
        const data = await proxyExtract(url, pasteText.slice(0, 25000))
        if (data.extraction_failed) {
          return NextResponse.json({
            error: `Extraction échouée: ${data.failure_reason || 'unspecified'}`,
          }, { status: 422 })
        }
        raw = proxyResultToRaw(data)
        sourceText = pasteText
      } catch (e: any) {
        return NextResponse.json({
          error: `Erreur proxy: ${e?.message || String(e)}`,
        }, { status: 502 })
      }
    } else {
      // URL fetch mode — proxy fetches the page via headless Chromium
      const extraction = await extractFromUrl(url)
      if (extraction.extraction_failed) {
        return NextResponse.json({
          error: `Extraction échouée: ${extraction.failure_reason}`,
        }, { status: 422 })
      }
      raw = extraction.raw
      sourceText = extraction.sourceText
    }

    const result = await ingestCandidate({
      source: 'manual',
      sourceUrl: url,
      raw,
      sourceText,
    })

    if (result.status === 'duplicate') {
      return NextResponse.json({
        status: 'duplicate',
        reason: result.reason,
        message: result.reason === 'source_id'
          ? 'Cette URL a déjà été importée'
          : 'Une annonce identique existe déjà (dédupliquée par contenu)',
      })
    }
    if (result.status === 'error') {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ status: 'inserted', candidateId: result.id, raw }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-from-url' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
