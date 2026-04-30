import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/** List every SitePlaybook with the count + names of member sources.
 *  Read-only: site rules are managed indirectly through the per-source
 *  flow and Claude's playbook proposer.
 */
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session || (session.user as any).role !== 'admin') {
    return NextResponse.json({ error: 'Non autorisé' }, { status: 403 })
  }

  const [sites, sources] = await Promise.all([
    prisma.sitePlaybook.findMany({ orderBy: { slug: 'asc' } }),
    prisma.jobSource.findMany({
      where: { siteSlug: { not: null } },
      select: { slug: true, label: true, siteSlug: true, enabled: true },
    }),
  ])

  const bySite = new Map<string, typeof sources>()
  for (const s of sources) {
    if (!s.siteSlug) continue
    const arr = bySite.get(s.siteSlug) ?? []
    arr.push(s)
    bySite.set(s.siteSlug, arr)
  }

  return NextResponse.json(
    sites.map(site => ({
      slug: site.slug,
      label: site.label,
      version: site.version,
      updatedAt: site.updatedAt,
      memberSources: (bySite.get(site.slug) ?? []).map(s => ({ slug: s.slug, label: s.label, enabled: s.enabled })),
      memberCount: (bySite.get(site.slug) ?? []).length,
      ruleCount: countRules((site.fieldRules as any) || {}),
      ignoreCount: ((site.ignorePatterns as any[]) || []).length,
      knownErrorCount: ((site.knownErrors as any[]) || []).length,
      layoutFingerprint: site.layoutFingerprint,
    })),
  )
}

function countRules(fieldRules: Record<string, any[]>): number {
  let n = 0
  for (const list of Object.values(fieldRules)) if (Array.isArray(list)) n += list.length
  return n
}
