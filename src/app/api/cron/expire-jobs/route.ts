import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'

/**
 * Cron endpoint to deactivate expired jobs.
 * Call this daily via a cron job or external scheduler.
 *
 * Protected by a shared secret in the Authorization header.
 * Usage: curl -H "Authorization: Bearer YOUR_CRON_SECRET" https://thejobclub.com.au/api/cron/expire-jobs
 */
export async function POST(req: Request) {
  // Verify cron secret
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

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

    return NextResponse.json({
      message: `Deactivated ${result.count} expired jobs`,
      count: result.count,
    })
  } catch (e) {
    logger.error('Cron expire-jobs failed', {
      route: '/api/cron/expire-jobs',
      error: String(e),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
