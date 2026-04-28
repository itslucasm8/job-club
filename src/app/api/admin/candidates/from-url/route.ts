import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { extractFromUrl } from '@/lib/sourcing/extractor'
import { ingestCandidate } from '@/lib/sourcing/ingest'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const body = await req.json()
    const url: string = (body.url || '').toString().trim()
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'URL invalide' }, { status: 400 })
    }

    const extraction = await extractFromUrl(url)
    if (extraction.extraction_failed) {
      return NextResponse.json({
        error: `Extraction échouée: ${extraction.failure_reason}`,
      }, { status: 422 })
    }

    const result = await ingestCandidate({
      source: 'manual',
      sourceUrl: url,
      raw: extraction.raw,
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

    return NextResponse.json({ status: 'inserted', candidateId: result.id, raw: extraction.raw }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-from-url' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
