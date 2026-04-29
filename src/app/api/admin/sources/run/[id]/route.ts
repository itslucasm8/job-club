import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const run = await prisma.sourcingRun.findUnique({ where: { id: params.id } })
    if (!run) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    return NextResponse.json({ run })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'sources-run-id' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
