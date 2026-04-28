import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { proxyParseReference, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

export const maxDuration = 200 // Sonnet on a full Fair Work pay guide can take a while.

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }
  if (!isProxyConfigured()) {
    return NextResponse.json({ error: 'Claude proxy non configuré' }, { status: 503 })
  }

  try {
    const body = await req.json()
    const kind = (body.kind || '').toString().trim()
    const pageText = (body.page_text || '').toString()
    if (kind !== 'postcodes' && kind !== 'award') {
      return NextResponse.json({ error: 'kind doit être "postcodes" ou "award"' }, { status: 400 })
    }
    if (pageText.length < 200) {
      return NextResponse.json({ error: 'Texte trop court (min 200 caractères)' }, { status: 400 })
    }

    const parsed = await proxyParseReference(kind, pageText.slice(0, 80000))
    return NextResponse.json(parsed)
  } catch (e: any) {
    Sentry.captureException(e, { tags: { route: 'admin-reference-data-parse' } })
    return NextResponse.json({ error: e?.message || 'Erreur serveur' }, { status: 500 })
  }
}
