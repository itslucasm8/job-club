import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const runs = await prisma.sourcingRun.findMany({
      orderBy: { startedAt: 'desc' },
      take: 20,
    })
    return NextResponse.json({ runs })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'sources-runs' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
