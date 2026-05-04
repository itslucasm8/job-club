import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { verifyCronAuth } from '@/lib/cron-auth'

/**
 * Cron endpoint to deactivate expired jobs.
 * Call this daily via a cron job or external scheduler.
 *
 * Protected by a shared secret in the Authorization header.
 * Usage: curl -H "Authorization: Bearer $CRON_SECRET" https://thejobclub.com.au/api/cron/expire-jobs
 */
export async function POST(req: Request) {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  try {
    const now = new Date()

    // Deactivate jobs past their expiry date
    const result = await prisma.job.updateMany({
      where: {
        active: true,
        expiresAt: { not: null, lte: now },
      },
      data: { active: false },
    })

    logger.info('Expired jobs deactivated', {
      route: '/api/cron/expire-jobs',
      count: result.count,
    })

    // Clean up old password reset tokens (expired + used, or older than 7 days)
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    const tokenCleanup = await prisma.passwordReset.deleteMany({
      where: {
        OR: [
          { used: true, expiresAt: { lt: now } },
          { createdAt: { lt: sevenDaysAgo } },
        ],
      },
    })

    logger.info('Old password reset tokens cleaned up', {
      route: '/api/cron/expire-jobs',
      count: tokenCleanup.count,
    })

    return NextResponse.json({
      message: `Deactivated ${result.count} expired jobs, cleaned ${tokenCleanup.count} tokens`,
      expiredJobs: result.count,
      cleanedTokens: tokenCleanup.count,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron-expire-jobs' } })
    logger.error('Cron expire-jobs failed', {
      route: '/api/cron/expire-jobs',
      error: String(e),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
