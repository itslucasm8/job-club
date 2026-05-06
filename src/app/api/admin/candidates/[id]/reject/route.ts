import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { normalizeRejectReason, REJECT_REASONS } from '@/lib/reject-reasons'

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    // Validate against the canonical enum from src/lib/reject-reasons. Free-
    // text reasons used to flow through, which mucked up downstream
    // analytics on rejection patterns. The client uses the same enum.
    const reason = normalizeRejectReason(body?.reason)
    if (!reason) {
      return NextResponse.json({
        error: `Raison invalide. Valeurs acceptées: ${REJECT_REASONS.join(', ')}`,
      }, { status: 400 })
    }

    const candidate = await prisma.jobCandidate.findUnique({ where: { id: params.id } })
    if (!candidate) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })

    await prisma.jobCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'rejected',
        rejectReason: reason,
        reviewedAt: new Date(),
        reviewedBy: (session.user as any).id || (session.user as any).email,
      },
    })

    await prisma.jobSource.update({
      where: { slug: candidate.source },
      data: { totalRejected: { increment: 1 } },
    }).catch(() => {})

    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-reject' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
