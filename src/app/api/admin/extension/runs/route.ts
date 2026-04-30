import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** List recent extension runs + a quick aggregate. Powers the admin
 *  /admin/extensions page so Lucas can see "office machine ran X times
 *  this week, scraped Y posts". Read-only.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const runs = await prisma.extensionRun.findMany({
    orderBy: { startedAt: 'desc' },
    take: 30,
    select: {
      id: true,
      startedAt: true,
      completedAt: true,
      totalPosts: true,
      totalErrors: true,
      groupRuns: true,
      triggeredBy: true,
      errorMessage: true,
    },
  })

  // Aggregate: last 7 days posts + groups touched.
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
  const weekRuns = runs.filter(r => new Date(r.startedAt) >= weekAgo)
  const postsLast7Days = weekRuns.reduce((acc, r) => acc + (r.totalPosts || 0), 0)
  const errorsLast7Days = weekRuns.reduce((acc, r) => acc + (r.totalErrors || 0), 0)

  // Configured FB-group sources count.
  const groupCount = await prisma.jobSource.count({
    where: { adapter: 'extension', siteSlug: 'facebook_groups' },
  })
  const enabledGroupCount = await prisma.jobSource.count({
    where: { adapter: 'extension', siteSlug: 'facebook_groups', enabled: true },
  })

  return NextResponse.json({
    runs,
    summary: {
      runsLast7Days: weekRuns.length,
      postsLast7Days,
      errorsLast7Days,
      groupCount,
      enabledGroupCount,
      lastRunAt: runs[0]?.startedAt || null,
      lastRunCompletedAt: runs[0]?.completedAt || null,
    },
  })
}
