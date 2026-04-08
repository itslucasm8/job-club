import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import * as Sentry from '@sentry/nextjs'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { z } from 'zod'

const markAsReadSchema = z.union([
  z.object({ ids: z.array(z.string()) }),
  z.object({ markAllRead: z.literal(true) }),
])

export async function GET(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const userId = (session.user as any).id

    const { searchParams } = new URL(req.url)
    const take = Math.min(parseInt(searchParams.get('take') || '20'), 50)
    const skip = parseInt(searchParams.get('skip') || '0')

    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.notification.count({ where: { userId } }),
    ])

    // Batch-fetch job titles for notifications
    const jobIds = notifications.filter(n => n.jobId).map(n => n.jobId!)
    const jobs = jobIds.length > 0
      ? await prisma.job.findMany({
          where: { id: { in: jobIds } },
          select: { id: true, title: true },
        })
      : []
    const jobMap = new Map(jobs.map(j => [j.id, j.title]))

    const notificationsWithJobs = notifications.map(notif => ({
      ...notif,
      jobTitle: notif.jobId ? jobMap.get(notif.jobId) || null : null,
    }))

    return NextResponse.json({ notifications: notificationsWithJobs, total })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'notifications', method: 'GET' } })
    logger.error('GET /api/notifications failed', {
      route: '/api/notifications',
      error: String(e),
    })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}

export async function PATCH(req: Request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || !session.user) {
      return NextResponse.json({ error: 'Non authentifié' }, { status: 401 })
    }

    const userId = (session.user as any).id
    const data = await req.json()

    // Validate request body
    const result = markAsReadSchema.safeParse(data)
    if (!result.success) {
      return NextResponse.json({ error: 'Format invalide' }, { status: 400 })
    }

    const validData = result.data

    if ('markAllRead' in validData) {
      // Mark all notifications as read
      const updated = await prisma.notification.updateMany({
        where: { userId },
        data: { read: true },
      })
      logger.info('Marked all notifications as read', {
        userId,
        count: updated.count,
      })
      return NextResponse.json({ marked: updated.count })
    } else {
      // Mark specific notifications as read
      const { ids } = validData

      // Verify all notifications belong to this user
      const notifications = await prisma.notification.findMany({
        where: { id: { in: ids }, userId },
      })

      if (notifications.length !== ids.length) {
        return NextResponse.json(
          { error: 'Certaines notifications sont introuvables' },
          { status: 404 }
        )
      }

      const updated = await prisma.notification.updateMany({
        where: { id: { in: ids } },
        data: { read: true },
      })

      logger.info('Marked specific notifications as read', {
        userId,
        count: updated.count,
      })

      return NextResponse.json({ marked: updated.count })
    }
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'notifications', method: 'PATCH' } })
    logger.error('PATCH /api/notifications failed', {
      route: '/api/notifications',
      error: String(e),
    })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
