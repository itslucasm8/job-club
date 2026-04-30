import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** Detail of a single SitePlaybook: full rules, ignore patterns, known
 *  errors, layout fingerprint, plus the list of member sources that share it.
 */
export async function GET(_req: Request, { params }: { params: { slug: string } }) {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const [site, sources] = await Promise.all([
    prisma.sitePlaybook.findUnique({ where: { slug: params.slug } }),
    prisma.jobSource.findMany({
      where: { siteSlug: params.slug },
      select: { slug: true, label: true, enabled: true, healthStatus: true, lastRunAt: true, totalApproved: true },
      orderBy: { slug: 'asc' },
    }),
  ])

  if (!site) return NextResponse.json({ error: 'Site introuvable' }, { status: 404 })

  return NextResponse.json({
    slug: site.slug,
    label: site.label,
    version: site.version,
    updatedAt: site.updatedAt,
    fieldRules: site.fieldRules,
    ignorePatterns: site.ignorePatterns,
    knownErrors: site.knownErrors,
    layoutFingerprint: site.layoutFingerprint,
    memberSources: sources,
  })
}
