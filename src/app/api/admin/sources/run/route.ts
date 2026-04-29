import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { executeRun, resolveSlugsToRun } from '@/lib/sourcing/runner'

export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  try {
    const body = await req.json().catch(() => ({}))
    const requestedSlugs: string[] | undefined = Array.isArray(body.slugs) ? body.slugs : undefined

    const slugs = await resolveSlugsToRun(requestedSlugs)
    if (slugs.length === 0) {
      return NextResponse.json({ error: 'Aucune source exécutable trouvée' }, { status: 400 })
    }

    // Refuse to start a new run if one is already running. Multiple concurrent
    // runs would just queue behind the proxy's single Playwright instance.
    const inFlight = await prisma.sourcingRun.findFirst({
      where: { status: 'running' },
      orderBy: { startedAt: 'desc' },
    })
    if (inFlight) {
      return NextResponse.json({
        error: 'Un scan est déjà en cours',
        runId: inFlight.id,
      }, { status: 409 })
    }

    const run = await prisma.sourcingRun.create({
      data: {
        status: 'pending',
        sourceSlugs: slugs as any,
        totalSources: slugs.length,
        triggeredBy: (session.user as any).id || (session.user as any).email || null,
      },
    })

    // Fire-and-forget. The runner is responsible for updating SourcingRun
    // status as it progresses; the UI polls /api/admin/sources/run/[id].
    executeRun(run.id, slugs).catch(async (e) => {
      Sentry.captureException(e, { tags: { route: 'sources-run', step: 'executeRun' } })
      await prisma.sourcingRun.update({
        where: { id: run.id },
        data: {
          status: 'failed',
          completedAt: new Date(),
          errorMessage: e?.message || String(e),
        },
      }).catch(() => {})
    })

    return NextResponse.json({ runId: run.id, slugs }, { status: 202 })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'sources-run' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
