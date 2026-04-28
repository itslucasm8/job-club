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
    const sources = await prisma.jobSource.findMany({
      orderBy: [{ enabled: 'desc' }, { totalApproved: 'desc' }, { slug: 'asc' }],
    })
    return NextResponse.json(sources)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-sources' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
