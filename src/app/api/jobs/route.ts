import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { createJobSchema, jobQuerySchema, getFirstValidationError } from '@/lib/validation'
import { logger } from '@/lib/logger'
import { createJobNotifications } from '@/lib/notifications'

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const queryParams = Object.fromEntries(searchParams.entries())

    // Validate with Zod
    const result = jobQuerySchema.safeParse(queryParams)
    if (!result.success) {
      return NextResponse.json({ error: getFirstValidationError(result.error) }, { status: 400 })
    }

    const { state, category, q, page } = result.data
    const limit = 20

    const where: any = { active: true }
    if (state !== 'all') where.state = state
    if (category !== 'all') where.category = category
    if (q) {
      where.OR = [
        { title: { contains: q } },
        { company: { contains: q } },
        { description: { contains: q } },
        { location: { contains: q } },
      ]
    }

    const [jobs, total] = await Promise.all([
      prisma.job.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: limit }),
      prisma.job.count({ where }),
    ])

    return NextResponse.json({ jobs, total, page, pages: Math.ceil(total / limit) })
  } catch (e) {
    logger.error('GET /api/jobs failed', { route: '/api/jobs', error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || (session.user as any).role !== 'admin') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
    }
    const data = await req.json()

    // Validate with Zod
    const result = createJobSchema.safeParse(data)
    if (!result.success) {
      return NextResponse.json({ error: getFirstValidationError(result.error) }, { status: 400 })
    }

    const { title, company, state, location, category, type, pay, description, applyUrl, sourceUrl } = result.data

    const job = await prisma.job.create({
      data: {
        title,
        company,
        state,
        location,
        category,
        type,
        pay: pay || null,
        description,
        applyUrl: applyUrl || null,
        sourceUrl: sourceUrl || null,
      },
    })

    // Fire-and-forget notification creation
    createJobNotifications(job).catch((error) => {
      logger.error('Failed to trigger job notifications', {
        jobId: job.id,
        error: String(error),
      })
    })

    return NextResponse.json(job, { status: 201 })
  } catch (e) {
    logger.error('POST /api/jobs failed', { route: '/api/jobs', error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
