import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { getStripe } from '@/lib/stripe'
import { logger } from '@/lib/logger'

/**
 * Cron endpoint to sync subscription statuses from Stripe.
 * Safety net for missed webhooks — runs nightly.
 *
 * Protected by a shared secret in the Authorization header.
 * Usage: curl -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://thejobclub.com.au/api/cron/sync-subscriptions
 */
export async function POST(req: Request) {
  const auth = req.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const stripe = getStripe()

    // Get all users who have a Stripe customer ID (i.e., have interacted with payments)
    const users = await prisma.user.findMany({
      where: { stripeCustomerId: { not: null } },
      select: { id: true, email: true, stripeCustomerId: true, subscriptionStatus: true, subscriptionId: true },
    })

    let synced = 0
    let mismatches = 0
    const issues: string[] = []

    for (const user of users) {
      try {
        // List active subscriptions for this customer
        const subscriptions = await stripe.subscriptions.list({
          customer: user.stripeCustomerId!,
          limit: 1,
        })

        const sub = subscriptions.data[0]
        let stripeStatus: string
        let stripeSubId: string | null

        if (!sub) {
          // No subscription found in Stripe
          stripeStatus = 'inactive'
          stripeSubId = null
        } else {
          stripeSubId = sub.id
          // Map Stripe status to our status
          if (sub.status === 'active' || sub.status === 'trialing') {
            stripeStatus = 'active'
          } else if (sub.status === 'past_due') {
            stripeStatus = 'past_due'
          } else if (sub.status === 'canceled' || sub.status === 'unpaid') {
            stripeStatus = 'canceled'
          } else {
            stripeStatus = 'inactive'
          }
        }

        // Check if our DB matches Stripe
        if (user.subscriptionStatus !== stripeStatus || user.subscriptionId !== stripeSubId) {
          mismatches++
          issues.push(`${user.email}: DB=${user.subscriptionStatus} → Stripe=${stripeStatus}`)

          await prisma.user.update({
            where: { id: user.id },
            data: { subscriptionStatus: stripeStatus, subscriptionId: stripeSubId },
          })
        }

        synced++
      } catch (e) {
        // Log per-user errors but continue syncing others
        issues.push(`${user.email}: error - ${String(e)}`)
        logger.error('Sync failed for user', {
          route: '/api/cron/sync-subscriptions',
          userId: user.id,
          error: String(e),
        })
      }
    }

    logger.info('Subscription sync completed', {
      route: '/api/cron/sync-subscriptions',
      total: users.length,
      synced,
      mismatches,
    })

    // Log mismatches as a warning in Sentry if any were found
    if (mismatches > 0) {
      Sentry.captureMessage(`Subscription sync: ${mismatches} mismatches fixed`, {
        level: 'warning',
        tags: { route: 'cron-sync-subscriptions' },
        extra: { issues },
      })
    }

    return NextResponse.json({
      message: `Synced ${synced}/${users.length} users, ${mismatches} mismatches fixed`,
      total: users.length,
      synced,
      mismatches,
      issues: mismatches > 0 ? issues : undefined,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron-sync-subscriptions' } })
    logger.error('Cron sync-subscriptions failed', {
      route: '/api/cron/sync-subscriptions',
      error: String(e),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
