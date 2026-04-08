import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as Sentry from '@sentry/nextjs'

export async function GET(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const jobs = await prisma.job.findMany({
      orderBy: { createdAt: 'desc' },
    })
    return NextResponse.json(jobs)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-jobs' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
