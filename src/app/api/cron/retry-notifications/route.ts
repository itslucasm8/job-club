import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { verifyCronAuth } from '@/lib/cron-auth'
import { createJobNotifications } from '@/lib/notifications'

/**
 * Retry notification fan-out for Jobs whose initial fan-out crashed or never
 * fired (server restart between approve and notifications, Resend blip, etc).
 *
 * Selection rules:
 *  - notificationsSent = false
 *  - either notificationsAttemptedAt IS NULL (never tried — a real crash)
 *    OR notificationsAttemptedAt is older than 5 minutes (in-flight not
 *    completing within reasonable time → retry)
 *  - active = true (don't bother with already-expired/disabled jobs)
 *  - createdAt within last 7 days (don't backfill ancient history)
 *
 * Intended call cadence: every 5-10 minutes via the host crontab. With those
 * exclusion rules the worst case is one duplicate notification per subscriber
 * per failed Job — which `createJobNotifications` itself dedupes via a unique
 * constraint on (userId, jobId). Idempotent end-to-end.
 *
 * Usage:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        https://thejobclub.com.au/api/cron/retry-notifications
 */

const STALE_ATTEMPT_MINUTES = 5
const MAX_AGE_DAYS = 7
const MAX_PER_RUN = 25

export async function POST(req: Request) {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  try {
    const now = new Date()
    const staleBefore = new Date(now.getTime() - STALE_ATTEMPT_MINUTES * 60 * 1000)
    const ageHorizon = new Date(now.getTime() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000)

    const candidates = await prisma.job.findMany({
      where: {
        notificationsSent: false,
        active: true,
        createdAt: { gte: ageHorizon },
        OR: [
          { notificationsAttemptedAt: null },
          { notificationsAttemptedAt: { lt: staleBefore } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_PER_RUN,
    })

    if (candidates.length === 0) {
      return NextResponse.json({ message: 'No jobs need notification retry', retried: 0 })
    }

    let succeeded = 0
    let failed = 0
    const errors: { jobId: string; reason: string }[] = []

    for (const job of candidates) {
      try {
        // Stamp the attempt up-front so concurrent retries (overlapping cron
        // invocations) skip this row via the staleBefore filter.
        await prisma.job.update({
          where: { id: job.id },
          data: { notificationsAttemptedAt: new Date() },
        })
        await createJobNotifications(job)
        await prisma.job.update({
          where: { id: job.id },
          data: { notificationsSent: true },
        })
        succeeded++
      } catch (e: any) {
        failed++
        errors.push({ jobId: job.id, reason: e?.message || String(e) })
        Sentry.captureException(e, {
          tags: { route: 'cron-retry-notifications' },
          extra: { jobId: job.id },
        })
      }
    }

    logger.info('Notification retry batch complete', {
      route: '/api/cron/retry-notifications',
      considered: candidates.length,
      succeeded,
      failed,
    })

    return NextResponse.json({
      message: `Retried ${candidates.length} jobs (${succeeded} succeeded, ${failed} failed)`,
      retried: candidates.length,
      succeeded,
      failed,
      errors: errors.slice(0, 5),
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron-retry-notifications' } })
    logger.error('Cron retry-notifications failed', {
      route: '/api/cron/retry-notifications',
      error: String(e),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
