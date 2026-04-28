import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { proxySaveReferenceData, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

const ALLOWED_FILES = new Set([
  'postcodes_agriculture.json',
  'postcodes_construction.json',
  'postcodes_tourism.json',
  'awards.json',
  'category_to_industry.json',
  'category_to_award.json',
])

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
    const filename = (body.filename || '').toString().trim()
    const mode = (body.mode || 'replace').toString().trim()
    const key = body.key ? body.key.toString().trim() : undefined
    const data = body.data

    if (!ALLOWED_FILES.has(filename)) {
      return NextResponse.json({ error: 'Nom de fichier non autorisé' }, { status: 400 })
    }
    if (mode !== 'replace' && mode !== 'upsert') {
      return NextResponse.json({ error: 'mode invalide' }, { status: 400 })
    }
    if (data === undefined || data === null) {
      return NextResponse.json({ error: 'data requis' }, { status: 400 })
    }

    const result = await proxySaveReferenceData({ filename, mode: mode as 'replace' | 'upsert', data, key })
    return NextResponse.json(result)
  } catch (e: any) {
    Sentry.captureException(e, { tags: { route: 'admin-reference-data-save' } })
    return NextResponse.json({ error: e?.message || 'Erreur serveur' }, { status: 500 })
  }
}
