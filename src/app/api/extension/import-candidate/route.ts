import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { proxyExtract, isProxyConfigured } from '@/lib/sourcing/claude-proxy'
import { proxyResultToRaw } from '@/lib/sourcing/extractor'
import { ingestCandidate } from '@/lib/sourcing/ingest'

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let result = 0
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return result === 0
}

export async function POST(req: Request) {
  const expected = process.env.EXTENSION_SECRET
  if (!expected) {
    return NextResponse.json({ error: 'EXTENSION_SECRET not configured' }, { status: 503 })
  }

  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice('Bearer '.length) : ''
  if (!token || !timingSafeEqual(token, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const url: string = (body.url || '').toString().trim()
    const pageText: string = (body.page_text || '').toString()
    if (!url || !/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'valid url required' }, { status: 400 })
    }
    if (pageText.trim().length < 200) {
      return NextResponse.json({ error: 'page_text must be >= 200 chars' }, { status: 400 })
    }

    if (!isProxyConfigured()) {
      return NextResponse.json({ error: 'Claude proxy non configuré' }, { status: 503 })
    }

    const data = await proxyExtract(url, pageText.slice(0, 25000))
    if (data.extraction_failed) {
      return NextResponse.json({
        error: `Extraction échouée: ${data.failure_reason || 'unspecified'}`,
      }, { status: 422 })
    }

    const raw = proxyResultToRaw(data)

    const result = await ingestCandidate({
      source: 'extension',
      sourceUrl: url,
      raw,
      sourceText: pageText,
    })

    if (result.status === 'duplicate') {
      return NextResponse.json({
        status: 'duplicate',
        reason: result.reason,
        message: result.reason === 'source_id'
          ? 'Cette URL a déjà été importée'
          : 'Une annonce identique existe déjà',
      })
    }
    if (result.status === 'error') {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }

    return NextResponse.json({ status: 'inserted', candidateId: result.id, raw }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'extension-import-candidate' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
