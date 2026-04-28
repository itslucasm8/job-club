import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createJobNotifications } from '@/lib/notifications'
import { logger } from '@/lib/logger'

function detect88Days(title: string, description: string): boolean {
  const text = `${title} ${description}`
  return /88[\s-]?days|88[\s-]?jours|second[\s-]?year[\s-]?visa|2nd[\s-]?year[\s-]?visa|subclass[\s-]?417|specified[\s-]?work|visa[\s-]?extension|whv[\s-]?eligible/i.test(text)
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const overrides = await req.json().catch(() => ({}))
    const candidate = await prisma.jobCandidate.findUnique({ where: { id: params.id } })
    if (!candidate) return NextResponse.json({ error: 'Introuvable' }, { status: 404 })
    if (candidate.status === 'approved' && candidate.promotedJobId) {
      return NextResponse.json({ error: 'Déjà approuvée' }, { status: 409 })
    }

    const raw = (candidate.rawData as any) || {}
    const title = overrides.title ?? raw.title
    const company = overrides.company ?? raw.company
    const state = overrides.state ?? raw.state ?? 'QLD'
    const location = overrides.location ?? raw.location ?? ''
    const category = overrides.category ?? raw.category ?? 'other'
    const type = overrides.type ?? raw.type ?? 'casual'
    const pay = overrides.pay ?? raw.pay ?? null
    const description = overrides.description ?? raw.description
    const applyUrl = overrides.applyUrl ?? raw.applyUrl ?? null
    const sourceUrl = overrides.sourceUrl ?? candidate.sourceUrl
    const eligible88Days = overrides.eligible88Days ?? raw.eligible88Days ?? detect88Days(title, description)

    if (!title || !company || !description) {
      return NextResponse.json({ error: 'Champs manquants (title/company/description)' }, { status: 400 })
    }

    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

    const job = await prisma.job.create({
      data: {
        title, company, state, location, category, type,
        pay: pay || null,
        description,
        applyUrl: applyUrl || null,
        sourceUrl: sourceUrl || null,
        eligible88Days,
        expiresAt,
      },
    })

    await prisma.jobCandidate.update({
      where: { id: candidate.id },
      data: {
        status: 'approved',
        promotedJobId: job.id,
        reviewedAt: new Date(),
        reviewedBy: (session.user as any).id || (session.user as any).email,
      },
    })

    await prisma.jobSource.update({
      where: { slug: candidate.source },
      data: { totalApproved: { increment: 1 } },
    }).catch(() => {})

    createJobNotifications(job).catch((error) => {
      logger.error('Failed to trigger job notifications from candidate approve', {
        jobId: job.id,
        candidateId: candidate.id,
        error: String(error),
      })
    })

    return NextResponse.json({ job, candidateId: candidate.id }, { status: 201 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-candidates-approve' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
