import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { proxySaveAllPostcodes, isProxyConfigured } from '@/lib/sourcing/claude-proxy'

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
    const result = await proxySaveAllPostcodes({
      agriculture: body.agriculture ?? null,
      construction: body.construction ?? null,
      tourism: body.tourism ?? null,
    })
    return NextResponse.json(result)
  } catch (e: any) {
    Sentry.captureException(e, { tags: { route: 'admin-reference-data-save-all-postcodes' } })
    return NextResponse.json({ error: e?.message || 'Erreur serveur' }, { status: 500 })
  }
}
