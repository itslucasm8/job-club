import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as Sentry from '@sentry/nextjs'

export async function GET() {
  try {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const now = new Date()
  const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const activeConditions = [
    { active: true },
    { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
  ]

  const [
    activeJobsCount,
    weeklyJobsCount,
    eligible88Count,
    totalUsers,
    adminCount,
    activeSubscribers,
    stateCountsRaw,
    recentJobs,
    adminUsers,
    latestSignup,
    expiredToday,
  ] = await Promise.all([
    prisma.job.count({ where: { AND: activeConditions } }),
    prisma.job.count({ where: { AND: [...activeConditions, { createdAt: { gte: oneWeekAgo } }] } }),
    prisma.job.count({ where: { AND: [...activeConditions, { eligible88Days: true }] } }),
    prisma.user.count(),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.user.count({ where: { subscriptionStatus: 'active', role: 'user' } }),
    prisma.job.groupBy({
      by: ['state'],
      where: { AND: activeConditions },
      _count: true,
    }),
    prisma.job.findMany({
      where: { AND: activeConditions },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, title: true, state: true, location: true, createdAt: true },
    }),
    prisma.user.findMany({
      where: { role: 'admin' },
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, email: true, role: true, createdAt: true },
    }),
    prisma.user.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { name: true, email: true, createdAt: true },
    }),
    prisma.job.count({
      where: {
        active: true,
        expiresAt: { lte: now },
      },
    }),
  ])

  const stateCounts: Record<string, number> = {}
  for (const s of stateCountsRaw) {
    stateCounts[s.state] = s._count
  }

  return NextResponse.json({
    activeJobs: activeJobsCount,
    weeklyJobs: weeklyJobsCount,
    eligible88: eligible88Count,
    totalUsers,
    adminCount,
    memberCount: totalUsers - adminCount,
    activeSubscribers,
    stateCounts,
    recentJobs,
    adminUsers,
    latestSignup,
    expiredToday,
  })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-dashboard' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
