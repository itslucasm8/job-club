import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { prisma } from '@/lib/prisma'
import { logger } from '@/lib/logger'
import { verifyCronAuth } from '@/lib/cron-auth'
import { executeRun, resolveSlugsToRun } from '@/lib/sourcing/runner'

/**
 * Cron-style endpoint to trigger a sourcing run without an admin session.
 * Mirrors /api/admin/sources/run but authenticated via Bearer CRON_SECRET
 * instead of NextAuth — for use by external schedulers (cron, GitHub
 * Actions) and one-off ops invocations.
 *
 * Body (optional): { "slugs": ["seek_fruit_picking", ...] }
 *   - omitted → all enabled sources with a runnable adapter
 *
 * Usage:
 *   curl -X POST -H "Authorization: Bearer $CRON_SECRET" \
 *        -H "Content-Type: application/json" \
 *        -d '{"slugs":["seek_fruit_picking"]}' \
 *        https://thejobclub.com.au/api/cron/run-sources
 *
 * Returns 202 with { runId } on accept; the run executes in the background
 * and completion is observed via /api/admin/sources/run/[id].
 */
export async function POST(req: Request) {
  const authError = verifyCronAuth(req)
  if (authError) return authError

  try {
    const body = await req.json().catch(() => ({}))
    const requested: string[] | undefined = Array.isArray(body?.slugs) ? body.slugs : undefined

    const slugs = await resolveSlugsToRun(requested)
    if (slugs.length === 0) {
      return NextResponse.json({ error: 'No runnable sources' }, { status: 400 })
    }

    // Same in-flight guard as the admin-session endpoint, in a serializable
    // transaction so two near-simultaneous triggers can't both pass.
    let run: { id: string }
    try {
      run = await prisma.$transaction(async (tx) => {
        const inFlight = await tx.sourcingRun.findFirst({
          where: { status: { in: ['pending', 'running'] } },
          orderBy: { startedAt: 'desc' },
          select: { id: true },
        })
        if (inFlight) {
          throw Object.assign(new Error('in_flight'), { runId: inFlight.id })
        }
        return tx.sourcingRun.create({
          data: {
            status: 'pending',
            sourceSlugs: slugs as any,
            totalSources: slugs.length,
            triggeredBy: 'cron',
          },
          select: { id: true },
        })
      }, { isolationLevel: 'Serializable' })
    } catch (e: any) {
      if (e?.message === 'in_flight') {
        return NextResponse.json({
          error: 'A scan is already in progress',
          runId: e.runId,
        }, { status: 409 })
      }
      throw e
    }

    // Fire-and-forget. Errors land in Sentry + the SourcingRun row.
    executeRun(run.id, slugs).catch(async (e) => {
      Sentry.captureException(e, { tags: { route: 'cron-run-sources', step: 'executeRun' } })
      await prisma.sourcingRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: e?.message || String(e),
        },
      }).catch(() => {})
    })

    logger.info('Cron sourcing run started', {
      route: '/api/cron/run-sources',
      runId: run.id,
      slugCount: slugs.length,
    })

    return NextResponse.json({ runId: run.id, slugs }, { status: 202 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'cron-run-sources' } })
    logger.error('Cron run-sources failed', {
      route: '/api/cron/run-sources',
      error: String(e),
    })
    return NextResponse.json({ error: 'Internal error' }, { status: 500 })
  }
}
