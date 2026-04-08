import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createJobSchema, getFirstValidationError } from '@/lib/validation'
import { logger } from '@/lib/logger'

export async function GET(req: Request, { params }: { params: { id: string } }) {
  try {
    const job = await prisma.job.findUnique({ where: { id: params.id } })
    if (!job) return NextResponse.json({ error: 'Offre introuvable' }, { status: 404 })
    return NextResponse.json(job)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'jobs-id' } })
    logger.error('GET /api/jobs/[id] failed', { route: '/api/jobs/[id]', jobId: params.id, error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }
    await prisma.job.update({ where: { id: params.id }, data: { active: false } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'jobs-id' } })
    logger.error('DELETE /api/jobs/[id] failed', { route: '/api/jobs/[id]', jobId: params.id, error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const data = await req.json()
    const result = createJobSchema.partial().safeParse(data)

    if (!result.success) {
      return NextResponse.json(
        { error: getFirstValidationError(result.error) },
        { status: 400 }
      )
    }

    const job = await prisma.job.update({
      where: { id: params.id },
      data: result.data,
    })
    return NextResponse.json(job)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'jobs-id' } })
    logger.error('PUT /api/jobs/[id] failed', { route: '/api/jobs/[id]', jobId: params.id, error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }

    const job = await prisma.job.update({
      where: { id: params.id },
      data: { active: true },
    })
    return NextResponse.json(job)
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'jobs-id' } })
    logger.error('PATCH /api/jobs/[id] failed', { route: '/api/jobs/[id]', jobId: params.id, error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
