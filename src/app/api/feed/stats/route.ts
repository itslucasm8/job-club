import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session && process.env.NODE_ENV !== 'development') {
      return NextResponse.json({ error: 'Non autorisé' }, { status: 401 })
    }

    const userId = (session?.user as any)?.id
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const activeConditions = [
      { active: true },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    ]

    const [newJobsToday, savedJobs, user, stateCountsRaw] = await Promise.all([
      prisma.job.count({
        where: { AND: [...activeConditions, { createdAt: { gte: oneDayAgo } }] },
      }),
      userId
        ? prisma.savedJob.findMany({ where: { userId }, select: { jobId: true } })
        : Promise.resolve([]),
      userId
        ? prisma.user.findUnique({ where: { id: userId }, select: { preferredStates: true } })
        : Promise.resolve(null),
      prisma.job.groupBy({
        by: ['state'],
        where: { AND: activeConditions },
        _count: true,
      }),
    ])

    const stateCounts: Record<string, number> = {}
    for (const s of stateCountsRaw) {
      stateCounts[s.state] = s._count
    }

    const preferredStates = user?.preferredStates ? user.preferredStates.split(',') : []

    return NextResponse.json({
      newJobsToday,
      savedCount: savedJobs.length,
      savedIds: savedJobs.map(s => s.jobId),
      preferredState: preferredStates[0] || null,
      stateCounts,
    })
  } catch (e) {
    logger.error('GET /api/feed/stats failed', { route: '/api/feed/stats', error: String(e) })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
