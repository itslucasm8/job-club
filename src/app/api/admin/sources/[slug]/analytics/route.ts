import { NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Per-source analytics — derives stats on demand from JobCandidate
 *  (createdAt + status) and SourcingRun.perSourceResults. No snapshot table;
 *  these queries are cheap at our scale (low thousands of candidates).
 *
 *  Returns:
 *    summary       — overall counts since the source was created
 *    last30Days    — candidates breakdown for the trend window
 *    daily         — 14-day daily import histogram for sparkline rendering
 *    recentRuns    — last 10 run results for this source (from SourcingRun JSON)
 */

type DailyBucket = { date: string; count: number }
type RunResult = {
  startedAt: string
  status: 'ok' | 'error' | 'skipped'
  listingsFound: number
  listingsNew: number
  imported: number
  duplicates: number
  errors: number
  durationMs: number
  errorMessage?: string
}

export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const slug = params.slug
  try {
    const source = await prisma.jobSource.findUnique({ where: { slug } })
    if (!source) {
      return NextResponse.json({ error: 'Source introuvable' }, { status: 404 })
    }

    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000)

    const [summaryByStatus, last30, last14ForChart, runs] = await Promise.all([
      // All-time counts grouped by status
      prisma.jobCandidate.groupBy({
        by: ['status'],
        where: { source: slug },
        _count: { _all: true },
      }),
      // Last 30 days, status counts
      prisma.jobCandidate.groupBy({
        by: ['status'],
        where: { source: slug, createdAt: { gte: thirtyDaysAgo } },
        _count: { _all: true },
      }),
      // Last 14 days raw rows for daily histogram (just createdAt, lightweight)
      prisma.jobCandidate.findMany({
        where: { source: slug, createdAt: { gte: fourteenDaysAgo } },
        select: { createdAt: true },
      }),
      // Recent SourcingRuns that included this slug — extract the matching
      // perSourceResults entry. Postgres JSON path query would be cleaner,
      // but we have low volume, so post-filter in JS for clarity.
      prisma.sourcingRun.findMany({
        where: { sourceSlugs: { array_contains: slug } as any },
        orderBy: { startedAt: 'desc' },
        take: 50,
        select: {
          id: true,
          startedAt: true,
          completedAt: true,
          status: true,
          perSourceResults: true,
        },
      }),
    ])

    const tally = (rows: { status: string, _count: { _all: number } }[]) => {
      const out = { total: 0, pending: 0, approved: 0, rejected: 0, auto_rejected: 0, duplicate: 0 }
      for (const r of rows) {
        out.total += r._count._all
        const k = r.status as keyof typeof out
        if (k in out) (out as any)[k] = r._count._all
      }
      return out
    }

    // Daily histogram for sparkline — fill missing days with 0.
    const dailyMap = new Map<string, number>()
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now.getTime() - i * 24 * 60 * 60 * 1000)
      const key = d.toISOString().slice(0, 10)
      dailyMap.set(key, 0)
    }
    for (const c of last14ForChart) {
      const key = c.createdAt.toISOString().slice(0, 10)
      if (dailyMap.has(key)) dailyMap.set(key, (dailyMap.get(key) || 0) + 1)
    }
    const daily: DailyBucket[] = Array.from(dailyMap.entries()).map(([date, count]) => ({ date, count }))

    // Extract this source's per-run results from the global SourcingRun JSON.
    const recentRuns: RunResult[] = []
    for (const run of runs) {
      const results = (run.perSourceResults as any[]) || []
      const match = results.find(r => r?.slug === slug)
      if (!match) continue
      recentRuns.push({
        startedAt: run.startedAt.toISOString(),
        status: match.status,
        listingsFound: match.listingsFound ?? 0,
        listingsNew: match.listingsNew ?? 0,
        imported: match.imported ?? 0,
        duplicates: match.duplicates ?? 0,
        errors: match.errors ?? 0,
        durationMs: match.durationMs ?? 0,
        errorMessage: match.errorMessage,
      })
      if (recentRuns.length >= 10) break
    }

    const summary = tally(summaryByStatus)
    const last30Days = tally(last30)
    const totalReviewed = summary.approved + summary.rejected + summary.auto_rejected
    const approvalRate = totalReviewed > 0 ? summary.approved / totalReviewed : null
    // Average listings per run, computed across recent successful runs.
    const okRuns = recentRuns.filter(r => r.status === 'ok')
    const avgListingsPerRun = okRuns.length > 0
      ? Math.round(okRuns.reduce((a, r) => a + r.listingsFound, 0) / okRuns.length)
      : null

    return NextResponse.json({
      slug,
      label: source.label,
      summary,
      last30Days,
      approvalRate,
      avgListingsPerRun,
      daily,
      recentRuns,
    })
  } catch (e) {
    Sentry.captureException(e, { tags: { route: 'admin-source-analytics' } })
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
