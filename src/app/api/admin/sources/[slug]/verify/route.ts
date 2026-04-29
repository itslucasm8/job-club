import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getAdapterAsync } from '@/lib/sourcing/adapters/registry'

/** Manual sanity-check: runs the adapter's discover() phase only (no Claude,
 *  no Playwright extract) and updates healthStatus based on the outcome.
 *
 *  Outcomes:
 *    discover() throws        → broken (definite signal: API down / DNS fail / WAF block)
 *    discover() returns 0     → partial (could be normal quiet day, could be selector drift — flag for review)
 *    discover() returns N > 0 → working (or partial if N < profile.expectedMinListings)
 *
 *  Resets consecutiveFailures on any non-throwing outcome (we got *something* back).
 */

export async function POST(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const slug = params.slug
  const start = Date.now()

  try {
    // Fetch profile to know expected min listings (for partial-vs-working).
    const source = await prisma.jobSource.findUnique({
      where: { slug },
      select: { profile: true, label: true },
    })
    if (!source) {
      return NextResponse.json({ error: 'Source introuvable' }, { status: 404 })
    }
    const expectedMin = (source.profile as any)?.expectedMinListings as number | undefined

    const adapter = await getAdapterAsync(slug).catch(e => { throw new Error(`adapter resolution: ${e?.message || e}`) })

    let listings
    try {
      listings = await adapter.discover()
    } catch (e: any) {
      const message = `discover failed: ${e?.message || String(e)}`
      const updated = await prisma.jobSource.update({
        where: { slug },
        data: {
          lastRunAt: new Date(),
          lastRunStatus: 'error',
          lastRunError: message,
          healthStatus: 'broken',
          consecutiveFailures: { increment: 1 },
        },
        select: { healthStatus: true, consecutiveFailures: true },
      })
      return NextResponse.json({
        ok: false,
        listingsFound: 0,
        healthStatus: updated.healthStatus,
        consecutiveFailures: updated.consecutiveFailures,
        durationMs: Date.now() - start,
        message,
      }, { status: 200 })
    }

    const listingsFound = listings.length
    let newHealth: 'working' | 'partial'
    let message: string
    if (listingsFound === 0) {
      newHealth = 'partial'
      message = 'discover() a réussi mais 0 annonces trouvées — peut-être normal pour aujourd\'hui, peut-être un sélecteur cassé. À vérifier.'
    } else if (typeof expectedMin === 'number' && expectedMin > 0 && listingsFound < expectedMin) {
      newHealth = 'partial'
      message = `${listingsFound} annonces trouvées (attendu ≥ ${expectedMin}) — drift possible.`
    } else {
      newHealth = 'working'
      message = `${listingsFound} annonces découvertes. Source en bonne santé.`
    }

    const updated = await prisma.jobSource.update({
      where: { slug },
      data: {
        lastRunAt: new Date(),
        lastRunStatus: 'ok',
        lastRunError: null,
        healthStatus: newHealth,
        consecutiveFailures: 0,
      },
      select: { healthStatus: true, consecutiveFailures: true },
    })

    return NextResponse.json({
      ok: true,
      listingsFound,
      healthStatus: updated.healthStatus,
      consecutiveFailures: updated.consecutiveFailures,
      durationMs: Date.now() - start,
      message,
      sampleTitles: listings.slice(0, 3).map(l => l.title).filter(Boolean),
    })
  } catch (e: any) {
    Sentry.captureException(e, { tags: { route: 'admin-sources-verify' } })
    return NextResponse.json({
      ok: false,
      error: e?.message || 'Erreur serveur',
      durationMs: Date.now() - start,
    }, { status: 500 })
  }
}
