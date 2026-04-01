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

    const conditions: any[] = [
      { active: true },
      // Expiry filter: show jobs with no expiry or not yet expired
      { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    ]
    if (state !== 'all') conditions.push({ state })
    if (category !== 'all') conditions.push({ category })
    if (q) {
      conditions.push({
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { company: { contains: q, mode: 'insensitive' } },
          { description: { contains: q, mode: 'insensitive' } },
          { location: { contains: q, mode: 'insensitive' } },
        ],
      })
    }
    const where = { AND: conditions }

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

    // Default expiry: 30 days from now
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)

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
        expiresAt,
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
